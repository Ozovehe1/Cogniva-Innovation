/**
 * Provider layer for the agent: one call shape over Groq (OpenAI-compatible) and Gemini, drawing every call from
 * the shared LLM pool (pool.ts): every key × model is a slot with its real free-tier limits, budgets and health
 * are shared across instances in Postgres, and routing weighs quality per purpose × headroom × health.
 * Server only.
 *
 * Purposes (quality order inside the pool, see pool.ts quality()):
 *   chat      qwen3.8-27b ≈ gpt-oss-120b > Gemini flash > flash-lite > gpt-oss-20b   (tutor turns with tools)
 *   director  gpt-oss-120b > qwen > Gemini flash > …                                   (background, shed first)
 *   light     gpt-oss-20b > Gemini flash-lite > …                                     (classify, summarise, short JSON)
 *   json      gpt-oss-120b > qwen ≈ Gemini flash > …                                   (visual sub-generation)
 * Priority comes from the request or the surrounding withLlmContext() (live lesson > Ask > background).
 */
import { GoogleGenAI, ThinkingLevel, type Content, type Part } from '@google/genai'
import { runOnPool, inventory, groqModels, estTokens as poolEst, PoolBusyError, llmContext, poolStore, type Priority, type PoolPurpose, type SlotDef } from './pool'

export type Purpose = 'chat' | 'director' | 'light' | 'json'

export interface ToolCall { id: string; name: string; args: Record<string, unknown>; sig?: string }
export interface Msg {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  name?: string
}
export interface ToolDef { name: string; description: string; parameters: Record<string, unknown> }

export interface ChatRequest {
  purpose: Purpose
  messages: Msg[]
  tools?: ToolDef[]
  maxTokens?: number
  temperature?: number
  json?: boolean
  /** Streamed text deltas (the caller decides what to show). */
  onText?: (delta: string) => void
  /** 'required': the model must call one of the tools this step (used when the learner explicitly asks for a visual). */
  toolChoice?: 'auto' | 'required'
  /** Groq server-side tool (gpt-oss only): web search or code interpreter. Falls back to no tool elsewhere. */
  builtin?: 'browser_search' | 'code_interpreter'
  /** Stop trying further models after this absolute time. */
  deadline?: number
  /** Notes on models skipped or failed (diagnostics / eval). */
  trace?: string[]
  /** Priority class; defaults to the surrounding withLlmContext() or by purpose (director = background). */
  priority?: Priority
  /** The learner this call serves (fair-share budget). Defaults to the surrounding withLlmContext(). */
  learnerId?: string | null
}
export interface ChatResult {
  text: string
  toolCalls: ToolCall[]
  model: string
  provider: 'groq' | 'gemini'
  usage: { input: number; output: number; cached?: number }
  /** Groq built-in tool executions (browser_search / code_interpreter). */
  executed?: { type: string; arguments?: string; output?: string; search_results?: { results?: { title?: string; url?: string; content?: string }[] } }[]
  /** Pool slot that answered, and whether the degradation ladder was used. */
  slot?: string
  degraded?: 'trimmed' | 'lighter'
}

export class AllModelsBusyError extends Error {
  /** When the pool expects capacity again (ms). */
  retryAfterMs: number
  /** True when this was background work deferred to keep capacity for learners. */
  deferred: boolean
  constructor(msg: string, retryAfterMs = 60_000, deferred = false) { super(msg); this.name = 'AllModelsBusyError'; this.retryAfterMs = retryAfterMs; this.deferred = deferred }
}

/* ───────────── Models ───────────── */

export const GROQ_MODELS = { ...groqModels(), guard: (process.env.GROQ_MODEL_GUARD ?? '').trim() || 'meta-llama/llama-prompt-guard-2-86m' }
const GEMINI_LITE = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']

export const groqEnabled = () => inventory().some(s => s.provider === 'groq')

/** Rough token estimate (≈3.6 characters per token for English + JSON). */
export const estTokens = poolEst

/** Output caps per purpose (tokens): the caller's request is clipped to these. */
const MAX_OUT: Record<Purpose, number> = { chat: 1200, director: 1200, light: 700, json: 6000 }

/** Default priority per purpose when nothing says otherwise. */
function priorityFor(req: ChatRequest): Priority {
  if (req.priority) return req.priority
  const c = llmContext().priority
  if (c) return c
  return req.purpose === 'director' ? 'background' : 'ask'
}

/**
 * The trimmed variant of a request (rung 2 of the degradation ladder): keep the system prompt, the first user
 * turn's context and the last 3 messages, shorten old tool results, and cut max_tokens to 60 %.
 */
export function trimRequest(req: ChatRequest): ChatRequest {
  const sys = req.messages.filter(m => m.role === 'system')
  const rest = req.messages.filter(m => m.role !== 'system')
  // Never split an assistant tool call from its results: cut only at a user message.
  let cut = Math.max(0, rest.length - 3)
  while (cut > 0 && rest[cut].role !== 'user') cut--
  const kept = rest.slice(cut).map((m, i, a) => m.role === 'tool' && i < a.length - 2 ? { ...m, content: m.content.slice(0, 1800) } : m)
  const dropped = rest.slice(0, cut)
  const note: Msg[] = dropped.length ? [{ role: 'system', content: `Earlier in this conversation (shortened): ${dropped.filter(m => m.role === 'user').map(m => m.content.slice(0, 120)).join(' / ').slice(0, 600)}` }] : []
  return { ...req, messages: [...sys, ...note, ...kept], maxTokens: Math.max(300, Math.round((req.maxTokens ?? 1200) * 0.6)) }
}

function estimate(req: ChatRequest) {
  return estTokens(JSON.stringify(req.messages) + JSON.stringify(req.tools ?? [])) + (req.maxTokens ?? 1200) + (req.builtin === 'browser_search' ? 28_000 : req.builtin ? 4000 : 0)
}

/* ───────────── Public entry ───────────── */

/** One model step on the best pool slot, failing over across slots. Throws AllModelsBusyError when nothing could answer. */
export async function chat(input: ChatRequest): Promise<ChatResult> {
  const req: ChatRequest = { ...input, maxTokens: Math.min(input.maxTokens ?? 1200, MAX_OUT[input.purpose]) }
  const priority = priorityFor(req)
  const trimmed = trimRequest(req)
  const est = estimate(req)
  const estTrim = estimate(trimmed)
  let emitted = false
  const onText = req.onText ? (d: string) => { emitted = true; req.onText!(d) } : undefined
  const purpose: PoolPurpose = req.builtin ? 'builtin' : req.purpose
  try {
    const r = await runOnPool<ChatResult>({
      purpose, priority, learnerId: req.learnerId, estTokens: est, trimmedEstTokens: estTrim < est * 0.85 ? estTrim : undefined,
      providers: req.builtin ? ['groq'] : undefined, deadline: req.deadline, trace: req.trace,
      preferFast: req.purpose === 'light',
      timeoutMs: req.builtin ? 45_000 : undefined,
      // Text already streamed to the learner cannot be taken back: surface the error instead of re-answering.
      stopOn: () => emitted,
    }, async (slot, o) => {
      const use = o.trimmed ? trimmed : req
      const res = slot.provider === 'groq' ? await groqChat(slot, use, onText, o.timeoutMs) : await geminiChat(slot, use, onText, o.timeoutMs)
      return { value: { ...res, slot: slot.id }, usage: res.usage }
    })
    if (r.trimmed && estTrim < est) void poolStore().count('saved_trim_tokens', est - estTrim)
    return { ...r.value, degraded: r.lighter ? 'lighter' : r.trimmed ? 'trimmed' : undefined }
  } catch (err) {
    if (err instanceof PoolBusyError) throw new AllModelsBusyError(err.message, err.retryAfterMs, err.name === 'PoolDeferredError')
    throw err
  }
}

/** Strict JSON from the 'json' chain. */
export async function chatJson(prompt: string, opts: { system?: string; maxTokens?: number; purpose?: Purpose; trace?: string[]; deadline?: number; priority?: Priority } = {}): Promise<unknown> {
  const messages: Msg[] = [...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []), { role: 'user', content: prompt }]
  const ask = () => chat({ purpose: opts.purpose ?? 'json', json: true, maxTokens: opts.maxTokens ?? 3000, temperature: 0.4, trace: opts.trace, deadline: opts.deadline, priority: opts.priority, messages })
  const r = await ask()
  try { return parseJsonLoose(r.text) } catch (err) {
    // One retry with the parse error (often a stray backslash or a truncated array).
    opts.trace?.push(`${r.model}: ${err instanceof Error ? err.message : err}`)
    messages.push({ role: 'assistant', content: r.text.slice(0, 6000) }, { role: 'user', content: `That was not valid JSON (${err instanceof Error ? err.message : 'parse error'}). Reply again with the complete, valid JSON only. Escape every backslash in strings as \\\\.` })
    return parseJsonLoose((await ask()).text)
  }
}

export function parseJsonLoose(raw: string): unknown {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  const body = a >= 0 && b > a ? t.slice(a, b + 1) : t
  for (const candidate of [t, body, body.replace(/\\(?!["\\/bfnrtu])/g, '\\\\'), body.replace(/,\s*([\]}])/g, '$1')]) {
    try { return JSON.parse(candidate) } catch { /* next repair */ }
  }
  throw new Error('The model returned malformed JSON')
}

/** Abort after `firstMs` unless the first byte/chunk arrived; then allow up to `totalMs`. */
function firstByteTimer(firstMs: number, totalMs: number) {
  const ac = new AbortController()
  let t = setTimeout(() => ac.abort(new Error(`timed out waiting ${Math.round(firstMs / 1000)} s for the first token`)), firstMs)
  let started = false
  return {
    signal: ac.signal,
    started() { if (started) return; started = true; clearTimeout(t); t = setTimeout(() => ac.abort(new Error(`timed out after ${Math.round(totalMs / 1000)} s`)), totalMs) },
    done() { clearTimeout(t) },
  }
}

/* ───────────── Groq (OpenAI-compatible) ───────────── */

function toOpenAI(messages: Msg[]) {
  return messages.map(m => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return { role: 'assistant', content: m.content || null, tool_calls: m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
    }
    return { role: m.role, content: m.content }
  })
}

async function groqChat(slot: SlotDef, req: ChatRequest, onText?: (d: string) => void, firstMs = 30_000): Promise<ChatResult> {
  const model = slot.model
  const stream = !!onText && !req.builtin
  const body: Record<string, unknown> = {
    model,
    messages: toOpenAI(req.messages),
    max_completion_tokens: req.maxTokens ?? 1200,
    temperature: req.temperature ?? 0.5,
    stream,
  }
  if (req.builtin) { body.tools = [{ type: req.builtin }]; body.tool_choice = 'required' }
  else if (req.tools?.length) { body.tools = req.tools.map(t => ({ type: 'function', function: t })); body.tool_choice = req.toolChoice ?? 'auto'; body.parallel_tool_calls = true }
  // Groq's strict JSON mode rejects long generations with LaTeX escapes ("Failed to generate JSON"); big JSON is asked for in the prompt and parsed loosely.
  if (req.json && !req.tools?.length && !req.builtin && (req.maxTokens ?? 1200) <= 1500) body.response_format = { type: 'json_object' }
  if (/gpt-oss/.test(model)) { body.reasoning_effort = 'low'; body.include_reasoning = false }
  else if (/qwen/.test(model)) { body.reasoning_format = 'hidden'; body.reasoning_effort = req.purpose === 'chat' ? 'none' : 'default' }
  // Fast failover: a live turn that has not started within firstMs moves to the next slot; once tokens flow it may run on.
  const timer = firstByteTimer(stream ? firstMs : Math.max(firstMs, 20_000), req.builtin ? 60_000 : 90_000)
  try {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${slot.apiKey}` },
    body: JSON.stringify(body),
    signal: timer.signal,
  })
  if (!res.ok) {
    const ra = res.headers.get('retry-after')
    throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 400)}${ra ? ` (try again in ${ra}s)` : ''}`)
  }
  if (!stream) {
    const j = await res.json() as { choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; executed_tools?: ChatResult['executed'] } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }
    const m = j.choices?.[0]?.message
    const text = m?.content ?? ''
    if (onText && text) onText(text)
    return {
      text, model, provider: 'groq', executed: m?.executed_tools,
      toolCalls: (m?.tool_calls ?? []).map(c => ({ id: c.id, name: c.function.name, args: safeArgs(c.function.arguments) })),
      usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0, cached: j.usage?.prompt_tokens_details?.cached_tokens ?? 0 },
    }
  }
  // SSE stream: text deltas go out as they arrive; tool-call fragments are stitched by index.
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = '', text = ''
  const calls = new Map<number, { id: string; name: string; args: string }>()
  let usage = { input: 0, output: 0, cached: 0 }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    timer.started()
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      let j: { choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[]; x_groq?: { usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }; error?: { message?: string } }
      try { j = JSON.parse(data) } catch { continue }
      if (j.error) throw new Error(`Groq stream: ${j.error.message ?? 'error'}`)
      const d = j.choices?.[0]?.delta
      if (d?.content) { text += d.content; onText!(d.content) }
      for (const tc of d?.tool_calls ?? []) {
        const c = calls.get(tc.index) ?? { id: '', name: '', args: '' }
        if (tc.id) c.id = tc.id
        if (tc.function?.name) c.name += tc.function.name
        if (tc.function?.arguments) c.args += tc.function.arguments
        calls.set(tc.index, c)
      }
      if (j.x_groq?.usage) usage = { input: j.x_groq.usage.prompt_tokens ?? 0, output: j.x_groq.usage.completion_tokens ?? 0, cached: j.x_groq.usage.prompt_tokens_details?.cached_tokens ?? 0 }
    }
  }
  return {
    text, model, provider: 'groq', usage,
    toolCalls: [...calls.values()].filter(c => c.name).map((c, k) => ({ id: c.id || `call_${k}`, name: c.name, args: safeArgs(c.args) })),
  }
  } finally { timer.done() }
}

function safeArgs(s: string): Record<string, unknown> {
  try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : { value: v } } catch { return { __invalid: s.slice(0, 500) } }
}

/* ───────────── Gemini ───────────── */

const gemClients = new Map<string, GoogleGenAI>()
function gemClient(apiKey: string) {
  let c = gemClients.get(apiKey)
  if (!c) { c = new GoogleGenAI({ apiKey }); gemClients.set(apiKey, c) }
  return c
}

/** Gemini 3 requires the thought signature of each function call to come back; calls made by another provider get the documented bypass value. */
const FOREIGN_SIG = 'skip_thought_signature_validator'

function toGemini(messages: Msg[]): { system: string; contents: Content[] } {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
  const contents: Content[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') contents.push({ role: 'user', parts: [{ text: m.content || ' ' }] })
    else if (m.role === 'assistant') {
      const parts: Part[] = []
      if (m.content) parts.push({ text: m.content })
      for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.args }, thoughtSignature: c.sig ?? FOREIGN_SIG })
      if (parts.length) contents.push({ role: 'model', parts })
    } else {
      const part: Part = { functionResponse: { name: m.name ?? 'tool', response: { result: m.content } } }
      const last = contents[contents.length - 1]
      if (last && last.role === 'user' && last.parts?.every(p => p.functionResponse)) last.parts.push(part)
      else contents.push({ role: 'user', parts: [part] })
    }
  }
  return { system, contents }
}

async function geminiChat(slot: SlotDef, req: ChatRequest, onText?: (d: string) => void, firstMs = 30_000): Promise<ChatResult> {
  const model = slot.model
  const { system, contents } = toGemini(req.messages)
  const timer = firstByteTimer(onText ? firstMs : Math.max(firstMs, 25_000), 90_000)
  const config: Record<string, unknown> = {
    abortSignal: timer.signal,
    // Gemini 3 flash thinks before answering and the thoughts count as output: leave room so it does not stop at MAX_TOKENS empty.
    maxOutputTokens: Math.max(req.maxTokens ?? 1200, 1024) + (model.startsWith('gemini-3') && !/lite/.test(model) ? 1024 : 0),
    temperature: req.temperature ?? 0.5,
    ...(system ? { systemInstruction: system } : {}),
    ...(model.startsWith('gemini-3') ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : model.startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
  }
  if (req.tools?.length) {
    config.tools = [{ functionDeclarations: req.tools.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }]
    if (req.toolChoice === 'required') config.toolConfig = { functionCallingConfig: { mode: 'ANY' } }
  }
  if (req.json && !req.tools?.length) config.responseMimeType = 'application/json'
  const client = gemClient(slot.apiKey)
  let text = ''
  const calls: ToolCall[] = []
  let usage = { input: 0, output: 0, cached: 0 }
  let finish = ''
  const take = (r: { candidates?: { content?: Content; finishReason?: string }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number } }) => {
    timer.started()
    for (const p of r.candidates?.[0]?.content?.parts ?? []) {
      if (p.thought) continue
      if (p.functionCall) calls.push({ id: `g${calls.length}_${Date.now().toString(36)}`, name: p.functionCall.name ?? '', args: (p.functionCall.args ?? {}) as Record<string, unknown>, sig: p.thoughtSignature })
      else if (p.text) { text += p.text; onText?.(p.text) }
    }
    if (r.candidates?.[0]?.finishReason) finish = String(r.candidates[0].finishReason)
    if (r.usageMetadata) usage = { input: r.usageMetadata.promptTokenCount ?? 0, output: r.usageMetadata.candidatesTokenCount ?? 0, cached: r.usageMetadata.cachedContentTokenCount ?? 0 }
  }
  try {
    if (onText) {
      const stream = await client.models.generateContentStream({ model, contents, config })
      for await (const chunk of stream) take(chunk)
    } else {
      take(await client.models.generateContent({ model, contents, config }))
    }
  } finally { timer.done() }
  // An empty answer (e.g. MALFORMED_FUNCTION_CALL on a big tool schema) is a failure: let the chain try the next model.
  if (!text.trim() && !calls.some(c => c.name)) throw new Error(`empty answer (finish ${finish || 'unknown'})`)
  return { text, toolCalls: calls.filter(c => c.name), model, provider: 'gemini', usage }
}

/* ───────────── Prompt-injection classifier (Groq Llama Prompt Guard 2) ───────────── */

/** The guard model has its own large free quota (30 RPM / 14.4K RPD per org): rotate over every Groq key. */
const guardSkip = new Map<string, number>()
let guardTurn = 0

/** Probability-ish score that `text` is a jailbreak / injection, or null when the guard model is unavailable. */
export async function promptGuardScore(text: string): Promise<number | null> {
  const keys = [...new Map(inventory().filter(s => s.provider === 'groq').map(s => [s.apiKey, s.keyEnv])).entries()]
  if (!keys.length || !text.trim()) return null
  const model = GROQ_MODELS.guard
  for (let i = 0; i < keys.length; i++) {
    const [apiKey, env] = keys[(guardTurn + i) % keys.length]
    if ((guardSkip.get(env) ?? 0) > Date.now()) continue
    guardTurn++
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: text.slice(0, 1800) }], max_completion_tokens: 8, temperature: 0 }),
        signal: AbortSignal.timeout(6000),
      })
      if (!res.ok) { guardSkip.set(env, Date.now() + (res.status === 429 ? 30_000 : 300_000)); continue }
      const j = await res.json() as { choices?: { message?: { content?: string } }[] }
      const v = Number.parseFloat(String(j.choices?.[0]?.message?.content ?? '').trim())
      return Number.isFinite(v) ? v : null
    } catch { /* next key */ }
  }
  return null
}

/* ───────────── Vision (board snapshots) ───────────── */

/**
 * Ask a vision-capable model (Gemini flash-lite first, then flash, over every free key in the pool) about a PNG.
 * Returns parsed JSON, or null when no vision model answered in time (the caller then relies on its deterministic
 * checks). Signature is stable: the correctness guard calls it.
 */
export async function visionJson(prompt: string, pngBase64: string, opts: { deadline?: number; trace?: string[]; priority?: Priority } = {}): Promise<unknown | null> {
  const deadline = opts.deadline ?? Date.now() + 20_000
  try {
    const r = await runOnPool<unknown>({
      purpose: 'vision', priority: opts.priority, providers: ['gemini'], estTokens: 1800 + 1200 + estTokens(prompt), deadline, trace: opts.trace, maxAttempts: 4, preferFast: true,
    }, async (slot, o) => {
      const left = deadline - Date.now()
      const res = await gemClient(slot.apiKey).models.generateContent({
        model: slot.model,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: pngBase64 } }, { text: prompt }] }],
        config: { httpOptions: { timeout: Math.max(2500, Math.min(18_000, left, o.timeoutMs)) }, maxOutputTokens: 1200, temperature: 0.2, responseMimeType: 'application/json', ...(slot.model.startsWith('gemini-3') ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : slot.model.startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
      })
      const text = (res.candidates?.[0]?.content?.parts ?? []).filter(p => !p.thought && p.text).map(p => p.text).join('')
      opts.trace?.push(`vision ${slot.id}: ok`)
      return { value: parseJsonLoose(text), usage: { input: res.usageMetadata?.promptTokenCount ?? 0, output: res.usageMetadata?.candidatesTokenCount ?? 0 } }
    })
    return r.value
  } catch (err) {
    opts.trace?.push(`vision: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`)
    return null
  }
}

/** Gemini flash-lite model ids (light purposes elsewhere). */
export const GEMINI_LITE_MODELS = GEMINI_LITE

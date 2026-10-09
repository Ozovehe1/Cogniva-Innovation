/**
 * Provider layer for the agent: one call shape over Groq (OpenAI-compatible, free tier, primary) and
 * Gemini (the existing free keys, fallback), with an ordered fallback chain per purpose, streaming,
 * tool calling, and a per-model budget guard shared by every server instance (Postgres counters, see
 * agent_budget_take). Without GROQ_API_KEY every chain is Gemini only. Server only.
 *
 * Purposes and their chains (Groq models spread the load; each has its own free quota):
 *   chat      qwen3.8-27b → gpt-oss-120b → gpt-oss-20b → Gemini flash-lite → Gemini flash
 *   director  gpt-oss-120b → qwen3.8-27b → gpt-oss-20b → Gemini flash-lite → Gemini flash
 *   light     gpt-oss-20b → qwen3.8-27b → Gemini flash-lite        (routing, summaries, classifiers)
 *   json      gpt-oss-120b → qwen3.8-27b → Gemini (lesson chain)    (visual sub-generation)
 */
import { GoogleGenAI, ThinkingLevel, type Content, type Part } from '@google/genai'
import { GEMINI_KEYS, isQuotaError, isRetryable } from '../gemini'
import { createAdminClient } from '../supabase/admin'

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
}
export interface ChatResult {
  text: string
  toolCalls: ToolCall[]
  model: string
  provider: 'groq' | 'gemini'
  usage: { input: number; output: number }
  /** Groq built-in tool executions (browser_search / code_interpreter). */
  executed?: { type: string; arguments?: string; output?: string; search_results?: { results?: { title?: string; url?: string; content?: string }[] } }[]
}

export class AllModelsBusyError extends Error {
  constructor(msg: string) { super(msg); this.name = 'AllModelsBusyError' }
}

/* ───────────── Models and limits ───────────── */

const env = (k: string, d: string) => (process.env[k] ?? '').trim() || d
export const GROQ_MODELS = {
  qwen: env('GROQ_MODEL_CHAT', 'qwen/qwen3.8-27b'),
  big: env('GROQ_MODEL_DIRECTOR', 'openai/gpt-oss-120b'),
  small: env('GROQ_MODEL_LIGHT', 'openai/gpt-oss-20b'),
  guard: env('GROQ_MODEL_GUARD', 'meta-llama/llama-prompt-guard-2-86m'),
}
/** Free-tier limits per Groq model (2026-10-08): 30 RPM, 1K RPD, 8K TPM, 200K TPD. */
const GROQ_LIMITS = {
  rpm: Number(env('GROQ_RPM', '30')), rpd: Number(env('GROQ_RPD', '1000')),
  tpm: Number(env('GROQ_TPM', '8000')), tpd: Number(env('GROQ_TPD', '200000')),
}
const GEMINI_LITE = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
const GEMINI_FLASH = ['gemini-3.8-flash', 'gemini-2.5-flash']

export const groqEnabled = () => !!(process.env.GROQ_API_KEY ?? '').trim()

type Slot = { provider: 'groq'; model: string } | { provider: 'gemini'; model: string; key: number }

function chainFor(purpose: Purpose): Slot[] {
  const g = (m: string): Slot => ({ provider: 'groq', model: m })
  const groq: Slot[] = !groqEnabled() ? [] :
    purpose === 'chat' ? [g(GROQ_MODELS.qwen), g(GROQ_MODELS.big), g(GROQ_MODELS.small)]
    : purpose === 'director' ? [g(GROQ_MODELS.big), g(GROQ_MODELS.qwen), g(GROQ_MODELS.small)]
    : purpose === 'light' ? [g(GROQ_MODELS.small), g(GROQ_MODELS.qwen)]
    : [g(GROQ_MODELS.big), g(GROQ_MODELS.qwen)]
  const keys = GEMINI_KEYS.length ? GEMINI_KEYS.map((_, i) => i) : [0]
  const gem: Slot[] = []
  for (const m of purpose === 'light' ? GEMINI_LITE : [...GEMINI_LITE, ...GEMINI_FLASH]) for (const k of keys) gem.push({ provider: 'gemini', model: m, key: k })
  return [...groq, ...gem]
}

const slotName = (s: Slot) => s.provider === 'groq' ? s.model : `${s.model}${s.key ? `#${s.key + 1}` : ''}`

/** In-instance memory of models that answered 429 / are missing, so the next call skips them at once. */
const skipUntil = new Map<string, number>()

/** Rough token estimate (≈3.6 characters per token for English + JSON). */
export function estTokens(s: string) { return Math.ceil(s.length / 3.6) }

/** Shared per-model budget (RPM, RPD, TPM, TPD) across instances. Fails open when the DB is unreachable. */
async function takeBudget(model: string, tokens: number): Promise<boolean> {
  try {
    const db = createAdminClient()
    const { data, error } = await db.rpc('agent_budget_take', { p_model: model, p_tokens: tokens, p_rpm: GROQ_LIMITS.rpm, p_rpd: GROQ_LIMITS.rpd, p_tpm: GROQ_LIMITS.tpm, p_tpd: GROQ_LIMITS.tpd })
    if (error) return true
    return data !== false
  } catch { return true }
}
async function adjustBudget(model: string, delta: number) {
  if (!delta) return
  try { await createAdminClient().rpc('agent_budget_adjust', { p_model: model, p_delta: delta }) } catch { /* best effort */ }
}

/* ───────────── Public entry ───────────── */

/** One model step with fallback across the purpose's chain. Throws AllModelsBusyError when nothing could answer. */
export async function chat(req: ChatRequest): Promise<ChatResult> {
  const chain = chainFor(req.purpose)
  const now = Date.now()
  const live = chain.filter(s => (skipUntil.get(slotName(s)) ?? 0) <= now)
  const order = live.length ? live : chain
  const errors: string[] = []
  let emitted = false
  const onText = req.onText ? (d: string) => { emitted = true; req.onText!(d) } : undefined
  for (const slot of order) {
    if (req.deadline && Date.now() > req.deadline - 3000) break
    if (req.builtin && !(slot.provider === 'groq' && /gpt-oss/.test(slot.model))) {
      // Built-in tools exist only on Groq gpt-oss; callers fall back to their own implementation.
      if (slot.provider === 'gemini') break
      continue
    }
    const name = slotName(slot)
    try {
      if (slot.provider === 'groq') {
        const est = estTokens(JSON.stringify(req.messages) + JSON.stringify(req.tools ?? [])) + (req.maxTokens ?? 1200) + (req.builtin === 'browser_search' ? 28_000 : 0)
        if (!(await takeBudget(slot.model, est))) { errors.push(`${name}: budget`); req.trace?.push(`${name}: over its free-tier budget, skipped`); continue }
        const r = await groqChat(slot.model, req, onText)
        void adjustBudget(slot.model, r.usage.input + r.usage.output - est)
        return r
      }
      return await geminiChat(slot.model, slot.key, req, onText)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${name}: ${msg.slice(0, 160)}`)
      req.trace?.push(`${name}: ${msg.slice(0, 160)}`)
      // Text already streamed to the learner cannot be taken back: surface the error instead of re-answering.
      if (emitted) throw err
      if (/\b429\b|rate.?limit|RESOURCE_EXHAUSTED|quota/i.test(msg) || isQuotaError(err)) {
        const m = /try again in ([\d.]+)s/i.exec(msg)
        skipUntil.set(name, Date.now() + Math.min(120_000, m ? Number(m[1]) * 1000 + 500 : 30_000))
      } else if (/\b404\b|not found|does not exist|decommissioned|NOT_FOUND/i.test(msg)) {
        skipUntil.set(name, Date.now() + 3600_000)
      } else if (!isRetryable(err) && !/\b(400|413|5\d\d)\b|tool|parse|fetch failed|timeout|aborted|JSON/i.test(msg)) {
        // Unknown error class: still try the next model, but remember briefly.
        skipUntil.set(name, Date.now() + 10_000)
      }
    }
  }
  throw new AllModelsBusyError(`No model could answer (${errors.slice(0, 6).join(' | ') || 'all skipped'})`)
}

/** Strict JSON from the 'json' chain. */
export async function chatJson(prompt: string, opts: { system?: string; maxTokens?: number; purpose?: Purpose; trace?: string[]; deadline?: number } = {}): Promise<unknown> {
  const messages: Msg[] = [...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []), { role: 'user', content: prompt }]
  const ask = () => chat({ purpose: opts.purpose ?? 'json', json: true, maxTokens: opts.maxTokens ?? 3000, temperature: 0.4, trace: opts.trace, deadline: opts.deadline, messages })
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

async function groqChat(model: string, req: ChatRequest, onText?: (d: string) => void): Promise<ChatResult> {
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
  const timeout = req.builtin ? 45_000 : 30_000
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 400)}`)
  if (!stream) {
    const j = await res.json() as { choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; executed_tools?: ChatResult['executed'] } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    const m = j.choices?.[0]?.message
    const text = m?.content ?? ''
    if (onText && text) onText(text)
    return {
      text, model, provider: 'groq', executed: m?.executed_tools,
      toolCalls: (m?.tool_calls ?? []).map(c => ({ id: c.id, name: c.function.name, args: safeArgs(c.function.arguments) })),
      usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0 },
    }
  }
  // SSE stream: text deltas go out as they arrive; tool-call fragments are stitched by index.
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = '', text = ''
  const calls = new Map<number, { id: string; name: string; args: string }>()
  let usage = { input: 0, output: 0 }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      let j: { choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[]; x_groq?: { usage?: { prompt_tokens?: number; completion_tokens?: number } }; error?: { message?: string } }
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
      if (j.x_groq?.usage) usage = { input: j.x_groq.usage.prompt_tokens ?? 0, output: j.x_groq.usage.completion_tokens ?? 0 }
    }
  }
  return {
    text, model, provider: 'groq', usage,
    toolCalls: [...calls.values()].filter(c => c.name).map((c, k) => ({ id: c.id || `call_${k}`, name: c.name, args: safeArgs(c.args) })),
  }
}

function safeArgs(s: string): Record<string, unknown> {
  try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : { value: v } } catch { return { __invalid: s.slice(0, 500) } }
}

/* ───────────── Gemini ───────────── */

const gemClients = new Map<number, GoogleGenAI>()
function gemClient(k: number) {
  let c = gemClients.get(k)
  if (!c) { c = new GoogleGenAI({ apiKey: GEMINI_KEYS[k] ?? '' }); gemClients.set(k, c) }
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

async function geminiChat(model: string, key: number, req: ChatRequest, onText?: (d: string) => void): Promise<ChatResult> {
  const { system, contents } = toGemini(req.messages)
  const config: Record<string, unknown> = {
    httpOptions: { timeout: 30_000 },
    maxOutputTokens: Math.max(req.maxTokens ?? 1200, 1024),
    temperature: req.temperature ?? 0.5,
    ...(system ? { systemInstruction: system } : {}),
    ...(model.startsWith('gemini-3') ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : model.startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
  }
  if (req.tools?.length) {
    config.tools = [{ functionDeclarations: req.tools.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }]
    if (req.toolChoice === 'required') config.toolConfig = { functionCallingConfig: { mode: 'ANY' } }
  }
  if (req.json && !req.tools?.length) config.responseMimeType = 'application/json'
  const client = gemClient(key)
  let text = ''
  const calls: ToolCall[] = []
  let usage = { input: 0, output: 0 }
  const take = (r: { candidates?: { content?: Content }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }) => {
    for (const p of r.candidates?.[0]?.content?.parts ?? []) {
      if (p.thought) continue
      if (p.functionCall) calls.push({ id: `g${calls.length}_${Date.now().toString(36)}`, name: p.functionCall.name ?? '', args: (p.functionCall.args ?? {}) as Record<string, unknown>, sig: p.thoughtSignature })
      else if (p.text) { text += p.text; onText?.(p.text) }
    }
    if (r.usageMetadata) usage = { input: r.usageMetadata.promptTokenCount ?? 0, output: r.usageMetadata.candidatesTokenCount ?? 0 }
  }
  if (onText) {
    const stream = await client.models.generateContentStream({ model, contents, config })
    for await (const chunk of stream) take(chunk)
  } else {
    take(await client.models.generateContent({ model, contents, config }))
  }
  return { text, toolCalls: calls.filter(c => c.name), model, provider: 'gemini', usage }
}

/* ───────────── Prompt-injection classifier (Groq Llama Prompt Guard 2) ───────────── */

/** Probability-ish score that `text` is a jailbreak / injection, or null when the guard model is unavailable. */
export async function promptGuardScore(text: string): Promise<number | null> {
  if (!groqEnabled() || !text.trim()) return null
  const model = GROQ_MODELS.guard
  if ((skipUntil.get(model) ?? 0) > Date.now()) return null
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: text.slice(0, 1800) }], max_completion_tokens: 8, temperature: 0 }),
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) { if (res.status === 429) skipUntil.set(model, Date.now() + 30_000); return null }
    const j = await res.json() as { choices?: { message?: { content?: string } }[] }
    const v = Number.parseFloat(String(j.choices?.[0]?.message?.content ?? '').trim())
    return Number.isFinite(v) ? v : null
  } catch { return null }
}

/* ───────────── Vision (board snapshots) ───────────── */

/**
 * Ask a vision-capable model (Gemini flash-lite, then flash, over every free key) about a PNG. Returns parsed JSON, or
 * null when no vision model answered in time (the caller then relies on its deterministic checks).
 */
export async function visionJson(prompt: string, pngBase64: string, opts: { deadline?: number; trace?: string[] } = {}): Promise<unknown | null> {
  const deadline = opts.deadline ?? Date.now() + 20_000
  const keys = GEMINI_KEYS.length ? GEMINI_KEYS.map((_, i) => i) : []
  for (const model of [...GEMINI_LITE, ...GEMINI_FLASH]) {
    for (const key of keys) {
      const name = `${model}#${key + 1}`
      if ((skipUntil.get(name) ?? 0) > Date.now()) continue
      const left = deadline - Date.now()
      if (left < 2500) return null
      try {
        const r = await gemClient(key).models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: pngBase64 } }, { text: prompt }] }],
          config: { httpOptions: { timeout: Math.min(18_000, left) }, maxOutputTokens: 1200, temperature: 0.2, responseMimeType: 'application/json', ...(model.startsWith('gemini-3') ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : model.startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
        })
        const text = (r.candidates?.[0]?.content?.parts ?? []).filter(p => !p.thought && p.text).map(p => p.text).join('')
        opts.trace?.push(`vision ${name}: ok`)
        return parseJsonLoose(text)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        opts.trace?.push(`vision ${name}: ${msg.slice(0, 80)}`)
        if (/\b429\b|quota|RESOURCE_EXHAUSTED|not found|404/i.test(msg)) skipUntil.set(name, Date.now() + 60_000)
      }
    }
  }
  return null
}

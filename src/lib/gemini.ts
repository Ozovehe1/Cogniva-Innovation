import { GoogleGenAI, ThinkingLevel } from '@google/genai'

// Verified from production on 2026-10-07: every model below answered (or was only rate-limited)
// for this key, each with its own free-tier quota. 2.0-flash and 2.5-flash-lite are retired (404).
const MODEL_CHAIN = [
  'gemini-3.8-flash', 'gemini-2.5-flash',
  'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash',
  'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite',
] as const

// Primary model first; fall back when Google returns overload/quota errors or the
// model is not available to this key. The lite models have their own free-tier quotas.
export const GEMINI_MODELS = MODEL_CHAIN
const ATTEMPT_TIMEOUT_MS = 25_000

/** Errors where the next model in the chain may still succeed. */
export function isRetryable(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  return /\b(503|429|500|504|404)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|NOT_FOUND|not found|is not supported|unsupported|overloaded|high demand|timed? ?out|aborted/i.test(msg)
}

/** True when the error is a quota / rate limit (429) rather than an outage. */
export function isQuotaError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  return /\b429\b|RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg)
}

/** Thrown when every model in the chain is out of quota. `retryAfterMs` comes from Google's RetryInfo when present. */
export class GeminiQuotaError extends Error {
  retryAfterMs: number | null
  daily: boolean
  constructor(message: string, retryAfterMs: number | null, daily: boolean) {
    super(message)
    this.name = 'GeminiQuotaError'
    this.retryAfterMs = retryAfterMs
    this.daily = daily
  }
}

function retryDelayMs(msg: string): number | null {
  const m = /retry(?:Delay)?["'\s:]*(?:in\s*)?["']?(\d+(?:\.\d+)?)\s*s/i.exec(msg)
  return m ? Math.round(Number(m[1]) * 1000) : null
}

export interface GenerateOptions {
  /** Ask the model for strict JSON output (responseMimeType application/json). */
  json?: boolean
  systemInstruction?: string
  /** Per-attempt timeout; defaults to 25s. */
  timeoutMs?: number
  temperature?: number
  /** 'minimal' trades depth for latency (live tutoring); default 'low'. */
  thinking?: 'minimal' | 'low'
  /** Timeout for the primary model only; the fallback model gets timeoutMs. Use to cap latency. */
  primaryTimeoutMs?: number
  /** Collects short notes on models that failed before one succeeded (diagnostics). */
  trace?: string[]
  /** Override the model chain (diagnostics). */
  models?: readonly string[]
  /** Absolute time (ms since epoch) after which no further model is tried; attempts are cut to fit. */
  deadline?: number
  /** Called with the model that answered (safe under concurrency, unlike lastGeminiModel). */
  onModel?: (model: string) => void
}

/* ───────────── Free-tier pacing ─────────────
 * Free-tier limits per model (AI Studio, 2026-10-07): flash models 5 requests a minute,
 * flash-lite models 15. Calls are spread so one instance never bursts past them: a model
 * whose last-minute window is full is skipped for the next model in the chain, and when
 * every model is full the call waits for the first free slot. Other instances are
 * covered by the 429 handling (skipUntil + backoff). */
const RPM_LITE = 15
const RPM_FLASH = 5
export function modelRpm(model: string) { return /lite/.test(model) ? RPM_LITE : RPM_FLASH }
const recent = new Map<string, number[]>()
/** ms until `model` has a free request slot in this instance (0 = free now). */
export function slotWaitMs(model: string, now = Date.now()) {
  const list = (recent.get(model) ?? []).filter(t => now - t < 60_000)
  recent.set(model, list)
  if (list.length < modelRpm(model)) return 0
  return 60_000 - (now - list[0]) + 50
}
function takeSlot(model: string) {
  const list = recent.get(model) ?? []
  list.push(Date.now())
  recent.set(model, list)
}

/** Per-instance memory of models that are out of quota or missing, so later calls skip them quickly. */
const skipUntil = new Map<string, number>()

/** Which model produced the last successful response (for diagnostics). */
export let lastGeminiModel: string | null = null

/**
 * Thinking settings per model family:
 * - gemini-3.x (flash and flash-lite): thinkingLevel; flash rejects MINIMAL, so always LOW.
 * - gemini-2.5-flash: thinkingBudget 0..24576 (0 = off).
 * - gemini-2.5-flash-lite: thinking is off by default; budget is 0 or 512..24576, so 0.
 * - gemini-2.0-*: no thinking support, send no thinkingConfig.
 */
export function thinkingFor(model: string, thinking: GenerateOptions['thinking']) {
  if (model.startsWith('gemini-3')) return { thinkingLevel: ThinkingLevel.LOW }
  if (model.startsWith('gemini-2.5-flash-lite')) return { thinkingBudget: 0 }
  if (model.startsWith('gemini-2.5')) return { thinkingBudget: thinking === 'minimal' ? 0 : 128 }
  return undefined
}

/** Calls Gemini with the primary model and falls back on overload/quota/not-found errors. Returns raw text. */
export async function generateText(prompt: string, opts: GenerateOptions = {}): Promise<string> {
  let lastErr: unknown
  let quotaCount = 0
  let retryAfter: number | null = null
  let daily = false
  let otherFailures = 0
  const chain = opts.models ?? GEMINI_MODELS
  const now = Date.now()
  const live = chain.filter(m => (skipUntil.get(m) ?? 0) <= now)
  // If everything is marked as skipped, try the whole chain anyway (quota may have reset).
  let order = opts.models ? [...chain] : live.length ? live : [...chain]
  // Spread calls under the free-tier per-minute limits: prefer models with a free slot,
  // and when none has one, wait for the first slot (bounded by the deadline).
  for (let waits = 0; waits < 3; waits++) {
    const free = order.filter(m => slotWaitMs(m) === 0)
    if (free.length) { order = [...free, ...order.filter(m => !free.includes(m))]; break }
    const wait = Math.min(...order.map(m => slotWaitMs(m)))
    if (opts.deadline && Date.now() + wait > opts.deadline - 5_000) break
    await new Promise(r => setTimeout(r, Math.min(wait, 30_000)))
  }
  let attempted = 0
  for (const model of order) {
    let timeout = (attempted === 0 ? opts.primaryTimeoutMs : undefined) ?? opts.timeoutMs ?? ATTEMPT_TIMEOUT_MS
    if (opts.deadline) {
      const left = opts.deadline - Date.now()
      if (left < 6_000) break
      timeout = Math.min(timeout, left)
    }
    attempted++
    takeSlot(model)
    try {
      const thinkingConfig = thinkingFor(model, opts.thinking)
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          httpOptions: { timeout },
          ...(thinkingConfig ? { thinkingConfig } : {}),
          ...(opts.json ? { responseMimeType: 'application/json' } : {}),
          ...(opts.systemInstruction ? { systemInstruction: opts.systemInstruction } : {}),
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        },
      })
      lastGeminiModel = model
      opts.onModel?.(model)
      return response.text ?? ''
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      opts.trace?.push(`${model}: ${msg.slice(0, 160)}`)
      if (!isRetryable(err)) throw err
      if (isQuotaError(err)) {
        quotaCount++
        const d = retryDelayMs(msg)
        if (d !== null) retryAfter = retryAfter === null ? d : Math.min(retryAfter, d)
        const isDaily = /PerDay|per day|daily/i.test(msg)
        if (isDaily) daily = true
        skipUntil.set(model, Date.now() + (isDaily ? 10 * 60_000 : Math.min(d ?? 30_000, 60_000)))
      } else if (/\b404\b|NOT_FOUND|not found|not supported|unsupported/i.test(msg)) {
        skipUntil.set(model, Date.now() + 6 * 3600_000)
      } else otherFailures++
      console.warn(`Gemini ${model} unavailable, trying next model:`, msg.slice(0, 200))
    }
  }
  // Every model that exists for this key is out of quota: report it as a quota error.
  if (quotaCount > 0 && otherFailures === 0) {
    throw new GeminiQuotaError(`Gemini quota reached on every model (${quotaCount} of ${order.length} tried)`, retryAfter, daily)
  }
  throw lastErr ?? new Error('Gemini: no model could be tried before the deadline (timed out)')
}

async function generateJson(prompt: string, opts: GenerateOptions = {}) {
  return parseGeminiJson(await generateText(prompt, opts))
}

/** Strict-JSON generation (responseMimeType application/json) with the same model fallback. */
export async function generateStructuredJson(prompt: string, opts: Omit<GenerateOptions, 'json'> = {}): Promise<unknown> {
  return generateJson(prompt, { ...opts, json: true })
}

export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

export function parseGeminiJson(raw: string) {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('AI returned malformed JSON')
  }
}

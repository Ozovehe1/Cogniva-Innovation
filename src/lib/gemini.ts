import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import { GEMINI_TEXT_MODELS, PoolBusyError, discoverKeys, geminiLimits, runOnPool, type Priority } from './agent/pool'

// Verified from production on 2026-10-07: every model below answered (or was only rate-limited)
// for this key, each with its own free-tier quota. 2.0-flash and 2.5-flash-lite are retired (404).
const MODEL_CHAIN = GEMINI_TEXT_MODELS

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
  /** Latency first: try the flash-lite models (fast, 15 RPM / 500 RPD free) before the flash models. */
  preferFast?: boolean
  /** LLM-pool priority (live > ask > background); defaults to the surrounding withLlmContext(), else 'ask'. */
  priority?: Priority
  /** The learner this call serves (fair-share budget); defaults to the surrounding withLlmContext(). */
  learnerId?: string | null
}

/** Per-model RPM on the free tier (kept for callers/diagnostics; the shared pool enforces the real limits). */
export function modelRpm(model: string) { return geminiLimits(model).rpm }
/** Kept for compatibility: the pool now paces calls across instances, so there is never an in-instance wait. */
export function slotWaitMs(): number { return 0 }

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

const clientsByKey = new Map<string, GoogleGenAI>()
function clientFor(apiKey: string) {
  let c = clientsByKey.get(apiKey)
  if (!c) { c = new GoogleGenAI({ apiKey }); clientsByKey.set(apiKey, c) }
  return c
}

/**
 * One Gemini call on the best slot of the shared LLM pool (every GEMINI_API_KEY_n × model, shared budgets and
 * health in Postgres), failing over on overload / quota / missing-model errors. Returns raw text.
 * Priority and learner come from opts or the surrounding withLlmContext() (lesson drafting sets them).
 */
export async function generateText(prompt: string, opts: GenerateOptions = {}): Promise<string> {
  // Output is not known up front: lesson JSON runs 1.5-4K tokens, plain text ~1.5K.
  const est = Math.ceil((prompt.length + (opts.systemInstruction?.length ?? 0)) / 3.6) + (opts.json ? 3500 : 1500)
  try {
    const r = await runOnPool<string>({
      purpose: 'lesson', priority: opts.priority, learnerId: opts.learnerId, estTokens: est, providers: ['gemini'],
      models: opts.models, preferFast: opts.preferFast, deadline: opts.deadline, trace: opts.trace, maxAttempts: 12,
      timeoutMs: opts.timeoutMs ?? ATTEMPT_TIMEOUT_MS, firstTimeoutMs: opts.primaryTimeoutMs,
      stopOn: err => !isRetryable(err),
    }, async (slot, o) => {
      const thinkingConfig = thinkingFor(slot.model, opts.thinking)
      const response = await clientFor(slot.apiKey).models.generateContent({
        model: slot.model,
        contents: prompt,
        config: {
          httpOptions: { timeout: o.timeoutMs },
          ...(thinkingConfig ? { thinkingConfig } : {}),
          ...(opts.json ? { responseMimeType: 'application/json' } : {}),
          ...(opts.systemInstruction ? { systemInstruction: opts.systemInstruction } : {}),
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        },
      })
      const u = response.usageMetadata
      return { value: response.text ?? '', usage: u ? { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), cached: u.cachedContentTokenCount ?? 0 } : undefined }
    })
    lastGeminiModel = r.slot.key > 1 ? `${r.slot.model} (key ${r.slot.key})` : r.slot.model
    opts.onModel?.(r.slot.model)
    return r.value
  } catch (err) {
    if (err instanceof PoolBusyError) {
      // Every slot is busy, out of quota, or (background) held back for learners: callers pause and retry.
      const daily = err.retryAfterMs >= 10 * 60_000 || /daily/.test(err.message)
      throw new GeminiQuotaError(`Gemini quota reached on every model (${err.message.slice(0, 300)})`, err.retryAfterMs, daily)
    }
    throw err
  }
}

async function generateJson(prompt: string, opts: GenerateOptions = {}) {
  return parseGeminiJson(await generateText(prompt, opts))
}

/** Strict-JSON generation (responseMimeType application/json) with the same model fallback. */
export async function generateStructuredJson(prompt: string, opts: Omit<GenerateOptions, 'json'> = {}): Promise<unknown> {
  return generateJson(prompt, { ...opts, json: true })
}

/** API keys in key-number order: GEMINI_API_KEY, GEMINI_API_KEY_2 … any n (each ideally its own project and free quota). */
export const GEMINI_KEYS = discoverKeys('GEMINI_API_KEY').map(k => k.value)
export const ai = new GoogleGenAI({ apiKey: GEMINI_KEYS[0] ?? '' })

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

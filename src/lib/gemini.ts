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
  const order = opts.models ? chain : live.length ? live : chain
  for (const [i, model] of order.entries()) {
    try {
      const thinkingConfig = thinkingFor(model, opts.thinking)
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          httpOptions: { timeout: (i === 0 ? opts.primaryTimeoutMs : undefined) ?? opts.timeoutMs ?? ATTEMPT_TIMEOUT_MS },
          ...(thinkingConfig ? { thinkingConfig } : {}),
          ...(opts.json ? { responseMimeType: 'application/json' } : {}),
          ...(opts.systemInstruction ? { systemInstruction: opts.systemInstruction } : {}),
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        },
      })
      lastGeminiModel = model
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
  throw lastErr
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

export async function generateIntelligenceProfile(answers: Record<string, number>, studentName: string) {
  const prompt = `You are an educational psychologist expert in Howard Gardner's Theory of Multiple Intelligences.
A student named ${studentName} has completed a behavioural intelligence assessment.
Their scores per intelligence type (0-10 scale) are: ${JSON.stringify(answers)}

Generate a JSON response with exactly these keys:
- dominantIntelligence: string (the single highest-scoring intelligence type key)
- intelligenceScores: object — return the exact scores provided, do not alter them
- personalityInsight: string (2 sentences: how this person naturally thinks and processes information, grounded in their specific score pattern)
- learningPath: array of 5 specific, actionable learning strategies tailored to their dominant intelligence
- careerSuggestions: array of 7 specific job role titles only (e.g. "Content Strategist", "Data Scientist", "UX Researcher") — no descriptions, no fields, just role names that match their intelligence profile
- studyTips: array of 4 concrete, personalised study techniques (not generic advice — specific to their top 2 intelligences)
- geniusStatement: string (one short, powerful sentence written in third person describing this learner, e.g. "A Spatial thinker who sees structure in chaos before others see anything at all" — do NOT start with "You")

Intelligence type keys: linguistic, logicalMathematical, spatial, musical, bodilyKinesthetic, interpersonal, intrapersonal, naturalist
Return ONLY valid JSON, no markdown, no explanation.`

  return generateJson(prompt)
}

export async function generateProjectForStudent(studentProfile: object, subject: string, difficulty: string) {
  const prompt = `You are a creative educational designer.
Student intelligence profile: ${JSON.stringify(studentProfile)}
Create a personalized learning project for subject: "${subject}" at difficulty: "${difficulty}"

Return JSON with these keys:
- title: string
- description: string (2-3 paragraphs)
- objectives: array of 3-4 learning objectives
- steps: array of 5-7 actionable steps
- deliverables: array of submission items
- estimatedHours: number
- intelligenceActivated: array of Gardner intelligence type keys

Return ONLY valid JSON, no markdown.`

  return generateJson(prompt)
}

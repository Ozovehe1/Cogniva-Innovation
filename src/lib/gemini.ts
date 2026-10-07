import { GoogleGenAI, ThinkingLevel } from '@google/genai'

// Primary model first; fall back when Google returns overload/quota errors.
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-2.5-flash'] as const
const ATTEMPT_TIMEOUT_MS = 25_000

function isRetryable(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  return /\b(503|429|500|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|timed? ?out|aborted/i.test(msg)
}

export interface GenerateOptions {
  /** Ask the model for strict JSON output (responseMimeType application/json). */
  json?: boolean
  systemInstruction?: string
  /** Per-attempt timeout; defaults to 25s. */
  timeoutMs?: number
  temperature?: number
}

/** Calls Gemini with the primary model and falls back on overload/quota errors. Returns raw text. */
export async function generateText(prompt: string, opts: GenerateOptions = {}): Promise<string> {
  let lastErr: unknown
  for (const model of GEMINI_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          httpOptions: { timeout: opts.timeoutMs ?? ATTEMPT_TIMEOUT_MS },
          thinkingConfig: model.startsWith('gemini-3')
            ? { thinkingLevel: ThinkingLevel.LOW }
            : { thinkingBudget: 128 },
          ...(opts.json ? { responseMimeType: 'application/json' } : {}),
          ...(opts.systemInstruction ? { systemInstruction: opts.systemInstruction } : {}),
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        },
      })
      return response.text ?? ''
    } catch (err) {
      lastErr = err
      if (!isRetryable(err)) throw err
      console.warn(`Gemini ${model} unavailable, trying next model:`, err instanceof Error ? err.message : err)
    }
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

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

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

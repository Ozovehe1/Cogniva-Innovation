import { GoogleGenAI } from '@google/genai'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

function parseGeminiJson(raw: string) {
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
- geniusStatement: string (one short, powerful sentence that names their dominant intelligence and what it gives them, e.g. "You are a Spatial thinker who sees structure in chaos before others see anything at all")

Intelligence type keys: linguistic, logicalMathematical, spatial, musical, bodilyKinesthetic, interpersonal, intrapersonal, naturalist
Return ONLY valid JSON, no markdown, no explanation.`

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      thinkingConfig: { thinkingBudget: 128 },
    },
  })

  return parseGeminiJson(response.text ?? '')
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

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      thinkingConfig: { thinkingBudget: 128 },
    },
  })

  return parseGeminiJson(response.text ?? '')
}

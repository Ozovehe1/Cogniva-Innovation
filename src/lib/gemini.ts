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
A student named ${studentName} has completed an intelligence assessment.
Their scores per intelligence type (0-10 scale) are: ${JSON.stringify(answers)}

Generate a JSON response with exactly these keys:
- dominantIntelligence: string (the top intelligence type key)
- intelligenceScores: object with all 8 intelligence type keys and number values 0-10
- personalityInsight: string (2-3 sentences about how this student thinks and learns)
- learningPath: array of 5 specific actionable learning strategies
- careerSuggestions: array of 5 career paths aligned to their strengths
- studyTips: array of 4 concrete personalized study tips
- geniusStatement: string (one powerful sentence, e.g. "You are a Spatial Genius who sees patterns where others see chaos")

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

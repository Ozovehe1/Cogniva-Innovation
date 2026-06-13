import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export const geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' })

export async function generateIntelligenceProfile(answers: Record<string, number>, studentName: string) {
  const prompt = `
You are an educational psychologist expert in Howard Gardner's Theory of Multiple Intelligences.
A student named ${studentName} has completed an intelligence assessment.
Their scores per intelligence type (0-10 scale) are:
${JSON.stringify(answers, null, 2)}

Based on these scores, generate a comprehensive JSON response with:
1. dominantIntelligence: The top intelligence type
2. intelligenceScores: Object with all 8 types and percentage scores
3. personalityInsight: 2-3 sentence description of how this student thinks and learns
4. learningPath: Array of 5 specific, actionable learning strategies matched to their intelligence profile
5. careerSuggestions: Array of 5 career paths that align with their intelligence strengths
6. studyTips: Array of 4 concrete study tips personalized for their intelligence type
7. geniusStatement: One powerful sentence declaring their genius (e.g. "You are a Spatial Genius who sees patterns where others see chaos")

Intelligence types: linguistic, logicalMathematical, spatial, musical, bodilyKinesthetic, interpersonal, intrapersonal, naturalist

Return ONLY valid JSON, no markdown.
`
  const result = await geminiModel.generateContent(prompt)
  const text = result.response.text()
  return JSON.parse(text)
}

export async function generateProjectForStudent(studentProfile: object, subject: string, difficulty: string) {
  const prompt = `
You are a creative educational designer.
A student has this intelligence profile: ${JSON.stringify(studentProfile)}
Create a personalized learning project for subject: "${subject}" at difficulty: "${difficulty}"

Return JSON with:
1. title: Project title
2. description: Full project description (2-3 paragraphs)
3. objectives: Array of 3-4 learning objectives
4. steps: Array of 5-7 actionable steps to complete the project
5. deliverables: Array of what the student should submit
6. estimatedHours: Estimated completion time
7. intelligenceActivated: Which of Gardner's intelligences this project activates

Return ONLY valid JSON, no markdown.
`
  const result = await geminiModel.generateContent(prompt)
  return JSON.parse(result.response.text())
}

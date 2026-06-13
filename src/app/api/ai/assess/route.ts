import { createClient } from '@/lib/supabase/server'
import { generateIntelligenceProfile } from '@/lib/gemini'
import { NextResponse } from 'next/server'

export const maxDuration = 60 // extend Vercel function timeout to 60s (Pro) or max allowed (Hobby)

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ hasProfile: false })

  const { data: profile } = await supabase.from('profiles').select('id').eq('user_id', user.id).single()
  if (!profile) return NextResponse.json({ hasProfile: false })

  const { data: intel } = await supabase
    .from('intelligence_profiles')
    .select('*')
    .eq('student_id', (profile as { id: string }).id)
    .maybeSingle()

  if (!intel) return NextResponse.json({ hasProfile: false })
  return NextResponse.json({ hasProfile: true, profile: intel })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { answers } = await request.json()
  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  let aiProfile
  try {
    aiProfile = await generateIntelligenceProfile(answers, (profile as { full_name: string }).full_name)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Gemini error:', message)
    return NextResponse.json({ error: `AI analysis failed: ${message}` }, { status: 500 })
  }

  const { data, error } = await supabase.from('intelligence_profiles').upsert({
    student_id: (profile as { id: string }).id,
    dominant_intelligence: aiProfile.dominantIntelligence,
    intelligence_scores: aiProfile.intelligenceScores,
    personality_insight: aiProfile.personalityInsight,
    learning_path: aiProfile.learningPath,
    career_suggestions: aiProfile.careerSuggestions,
    study_tips: aiProfile.studyTips,
    genius_statement: aiProfile.geniusStatement,
    updated_at: new Date().toISOString()
  }, { onConflict: 'student_id' }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from('student_growth').upsert(
    { student_id: (profile as { id: string }).id },
    { onConflict: 'student_id' }
  )

  return NextResponse.json({ profile: data })
}

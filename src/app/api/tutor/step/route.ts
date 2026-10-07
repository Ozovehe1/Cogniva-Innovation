import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { nextTutorSteps, type StudentProfileLite, type TutorReason } from '@/lib/lesson-ai'
import { validateScript, type CheckStep, type Step } from '@/lib/lesson-schema'

export const maxDuration = 60

const REASONS: TutorReason[] = ['explain_differently', 'wrong_answer', 'continue']

/**
 * POST /api/tutor/step
 * Body: { lessonId, reason, checkIndex?, answer?, played: Step[], history?: {reason, answer?}[] }
 * Returns { steps: Step[] } — the next whiteboard steps, validated against the lesson schema.
 */
export async function POST(request: Request) {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = await request.text()
  if (raw.length > 200_000) return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  let body: {
    lessonId?: unknown; reason?: unknown; checkIndex?: unknown; answer?: unknown; played?: unknown; history?: unknown
  }
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const lessonId = typeof body.lessonId === 'string' ? body.lessonId : null
  const reason = REASONS.includes(body.reason as TutorReason) ? (body.reason as TutorReason) : null
  if (!lessonId || !reason) return NextResponse.json({ error: 'lessonId and reason are required' }, { status: 400 })

  // RLS: students see approved lessons, tutors also see their own drafts.
  const { data: lesson } = await supabase
    .from('lessons').select('id, title, subject, objectives, status, tutor_id').eq('id', lessonId).maybeSingle()
  if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 })

  // The played steps are the client's view of the board; validate them before using them as context.
  const playedCheck = validateScript(Array.isArray(body.played) ? body.played.slice(0, 250) : [], { maxSteps: 250 })
  const played: Step[] = playedCheck.steps
  // The client sends the script up to and including the check being answered.
  const checkIndex = played.length - 1
  const checkStep = played[checkIndex]
  const check = checkStep?.type === 'check' ? (checkStep as CheckStep) : undefined
  const answer = typeof body.answer === 'string' ? body.answer.slice(0, 300) : undefined
  const history = Array.isArray(body.history)
    ? body.history.slice(-10).filter((h): h is { reason: string; answer?: string } => !!h && typeof (h as { reason?: unknown }).reason === 'string')
    : []

  let studentProfile: StudentProfileLite | null = null
  if (profile.role === 'student') {
    const { data } = await supabase
      .from('intelligence_profiles')
      .select('dominant_intelligence, intelligence_scores, study_tips, personality_insight')
      .eq('student_id', profile.id)
      .maybeSingle()
    studentProfile = (data as StudentProfileLite | null) ?? null
  }

  const l = lesson as { title: string; subject: string; objectives: string[] | null }
  try {
    const steps = await nextTutorSteps({
      lesson: { title: l.title, subject: l.subject, objectives: l.objectives ?? [] },
      played: played.slice(0, checkIndex + 1),
      reason,
      check,
      answer,
      profile: studentProfile,
      history,
    })
    return NextResponse.json({ steps })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Tutor step error:', message)
    return NextResponse.json({ error: 'The tutor could not prepare a new explanation right now.' }, { status: 502 })
  }
}

import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { nextTutorSteps, type GenMeta, type StudentProfileLite, type TutorReason } from '@/lib/lesson-ai'
import { validateScript, type CheckStep, type Step } from '@/lib/lesson-schema'
import { warmTts } from '@/lib/tts-server'
import { loadLearner, learnerLite } from '@/lib/learner'
import { detectDistress } from '@/lib/safety'
import { withLlmContext } from '@/lib/agent/pool'
import { withPlaybook } from '@/lib/playbook/context'
import { createAdminClient } from '@/lib/supabase/admin'
import { learnerFacts, tutorState } from '@/lib/agent/tutor-state'
import { ensureIds } from '@/lib/agent/board-scene'
import { levelLine } from '@/lib/intake'

export const maxDuration = 60

const REASONS: TutorReason[] = ['explain_differently', 'wrong_answer', 'continue', 'worked_example']

/**
 * POST /api/tutor/step
 * Body: { lessonId, reason, checkIndex?, answer?, played: Step[], history?: {reason, answer?}[] }
 * Returns { steps: Step[] } — the next whiteboard steps, validated against the lesson schema.
 */
export async function POST(request: Request) {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Wake the voice while Gemini writes the new explanation, so its narration is quick to synthesize.
  warmTts()

  const raw = await request.text()
  if (raw.length > 200_000) return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  let body: {
    lessonId?: unknown; reason?: unknown; checkIndex?: unknown; answer?: unknown; played?: unknown; history?: unknown
  }
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const lessonId = typeof body.lessonId === 'string' ? body.lessonId : null
  const reason = REASONS.includes(body.reason as TutorReason) ? (body.reason as TutorReason) : null
  if (!lessonId || !reason) return NextResponse.json({ error: 'lessonId and reason are required' }, { status: 400 })

  // RLS: shared approved lessons, or the learner's own AI lessons.
  const { data: lesson } = await supabase
    .from('lessons').select('id, title, subject, objectives, status, tutor_id').eq('id', lessonId).maybeSingle()
  if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 })

  // The played steps are the client's view of the board; validate them before using them as context.
  const playedCheck = validateScript(Array.isArray(body.played) ? body.played.slice(0, 250) : [], { maxSteps: 250 })
  // (validated with cues and variables; continuations may refer to both)
  const played: Step[] = playedCheck.steps
  // The client sends the script up to and including the check being answered.
  // For a worked example the client sends the board up to the current step (it need not end in a check).
  const checkIndex = played.length - 1
  const checkStep = played[checkIndex]
  const check = checkStep?.type === 'check' ? (checkStep as CheckStep) : undefined
  const answer = typeof body.answer === 'string' ? body.answer.slice(0, 300) : undefined
  const history = Array.isArray(body.history)
    ? body.history.slice(-10).filter((h): h is { reason: string; answer?: string } => !!h && typeof (h as { reason?: unknown }).reason === 'string')
    : []

  // A typed answer that shows distress pauses the lesson instead of being taught to.
  if (answer && detectDistress(answer)) return NextResponse.json({ steps: [], safety: true })

  // What the AI tutor knows about this learner: level, goal, confidence, examples (never a "type").
  let studentProfile: StudentProfileLite | null = null
  const learner = await loadLearner(supabase, profile.id)
  if (learner) {
    const { data: c } = await supabase.from('learner_checkins').select('mood, confidence').eq('student_id', profile.id).order('created_at', { ascending: false }).limit(1)
    const last = (c ?? [])[0] as { mood: number | null; confidence: number | null } | undefined
    studentProfile = learnerLite(learner, last ? Math.min(last.mood ?? 5, last.confidence ?? 5) : null)
  }

  const l = lesson as { title: string; subject: string; objectives: string[] | null }
  // The tutor state: the board in view (with ids), this event, mastery and known misconceptions (own rows only).
  let stateText: string | null = null
  try {
    const facts = await learnerFacts(createAdminClient(), profile.id, { lessonId, level: learner ? levelLine(learner) || null : null })
    const from = (() => { for (let k = played.length - 1; k >= 0; k--) { const st = played[k]; if (st.type === 'clear' && !(st as { targets?: unknown }).targets) return k + 1 } return 0 })()
    const onBoard = played.slice(from).filter(st => !['check', 'stage', 'manim_clip', 'pause'].includes(st.type))
    const prior = history.filter(h => h.reason !== 'continue').length
    stateText = tutorState({
      surface: 'reteach',
      event: reason === 'wrong_answer' ? { kind: 'answer', text: `check "${(check?.prompt ?? '').slice(0, 110)}", they answered "${answer ?? ''}"${prior > 1 ? ` (${prior} re-teaches already this lesson)` : ''}`, correct: false, expected: check?.kind === 'choice' && check.options && typeof check.answer === 'number' ? check.options[check.answer] : check?.accept?.[0] ?? null } : { kind: 'reteach', text: `${reason.replace('_', ' ')}${check?.prompt ? ` at check "${check.prompt.slice(0, 110)}"` : ''}` },
      lesson: { title: l.title, cursor: Math.max(0, checkIndex), total: played.length },
      board: onBoard.length ? { doc: { steps: ensureIds(onBoard), groups: {}, rev: 0 }, where: 'the lesson board' } : null,
      learner: facts,
    })
  } catch { stateText = null }
  const meta: GenMeta = { ms: 0, repaired: false, model: null, dropped: 0 }
  try {
    // The learner is inside the lesson waiting for the tutor: live priority in the LLM pool.
    const steps = await withLlmContext({ priority: 'live', learnerId: profile.id, label: 'tutor-step' }, () => withPlaybook({ lessonId, studentId: profile.id }, () => nextTutorSteps({
      meta,
      lesson: { title: l.title, subject: l.subject, objectives: l.objectives ?? [] },
      played: played.slice(0, checkIndex + 1),
      reason,
      check,
      answer,
      profile: studentProfile,
      history,
      tutorState: stateText,
    })))
    return NextResponse.json({ steps, meta })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Tutor step error:', message)
    return NextResponse.json({ error: 'The tutor could not prepare a new explanation right now.', detail: message.slice(0, 300) }, { status: 502 })
  }
}

import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'

/**
 * POST /api/lessons/:id/progress  (students only; also sent with navigator.sendBeacon)
 * Body: {
 *   stepIndex?: number      — position: number of script steps done (the player's cursor)
 *   sectionIndex?: number   — section that position is in
 *   scriptSteps?: number    — length of the script the position refers to
 *   furthest?: number       — furthest position reached
 *   answers?: { [checkIndex]: { r: response, c?: correct, a?: answer } } — merged into saved answers
 *   event?: object, completed?: boolean, restart?: boolean
 * }
 * Upserts the student's progress row and appends the event (capped at 500 events).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (profile.role !== 'student') return NextResponse.json({ ok: true, skipped: 'not a student' })

  const raw = await request.text().catch(() => '')
  if (raw.length > 60_000) return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  let body: Record<string, unknown> = {}
  try { body = raw ? JSON.parse(raw) : {} } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { data: lesson } = await supabase.from('lessons').select('id').eq('id', id).eq('status', 'approved').maybeSingle()
  if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 })

  const { data: existing } = await supabase
    .from('lesson_progress').select('step_index, section_index, furthest_index, answers, events, completed_at, script_steps')
    .eq('student_id', profile.id).eq('lesson_id', id).maybeSingle()
  const prev = existing as {
    step_index: number; section_index: number; furthest_index: number; answers: Record<string, unknown> | null
    events: unknown[]; completed_at: string | null; script_steps: number | null
  } | null

  const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null)

  const events = Array.isArray(prev?.events) ? [...prev!.events] : []
  if (body.event && typeof body.event === 'object' && JSON.stringify(body.event).length < 2000) {
    events.push({ ...(body.event as object), at: new Date().toISOString() })
  }
  const restart = body.restart === true
  let answers: Record<string, unknown> = restart ? {} : { ...(prev?.answers ?? {}) }
  if (body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)) {
    for (const [k, v] of Object.entries(body.answers as Record<string, unknown>)) {
      if (/^\d{1,5}$/.test(k) && v && typeof v === 'object' && JSON.stringify(v).length < 600) answers[k] = v
    }
    const keys = Object.keys(answers)
    if (keys.length > 400) answers = Object.fromEntries(keys.slice(-400).map(k => [k, answers[k]]))
  }

  const stepIndex = int(body.stepIndex) ?? prev?.step_index ?? 0
  const sectionIndex = int(body.sectionIndex) ?? prev?.section_index ?? 0
  const furthest = Math.max(int(body.furthest) ?? 0, restart ? 0 : prev?.furthest_index ?? 0, stepIndex)
  const completed = body.completed === true

  const { error } = await supabase.from('lesson_progress').upsert({
    student_id: profile.id,
    lesson_id: id,
    step_index: completed ? 0 : stepIndex,
    section_index: completed ? 0 : sectionIndex,
    furthest_index: furthest,
    script_steps: int(body.scriptSteps) ?? prev?.script_steps ?? null,
    answers: completed ? {} : answers,
    events: events.slice(-500),
    completed_at: completed ? new Date().toISOString() : restart ? null : prev?.completed_at ?? null,
  }, { onConflict: 'student_id,lesson_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

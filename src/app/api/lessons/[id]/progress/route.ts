import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'

/**
 * POST /api/lessons/:id/progress  (students only)
 * Body: { stepIndex?: number, event?: object, completed?: boolean }
 * Upserts the student's progress row and appends the event (capped at 500 events).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (profile.role !== 'student') return NextResponse.json({ ok: true, skipped: 'not a student' })

  const body = await request.json().catch(() => ({}))
  const { data: lesson } = await supabase.from('lessons').select('id').eq('id', id).eq('status', 'approved').maybeSingle()
  if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 })

  const { data: existing } = await supabase
    .from('lesson_progress').select('step_index, events, completed_at').eq('student_id', profile.id).eq('lesson_id', id).maybeSingle()
  const prev = existing as { step_index: number; events: unknown[]; completed_at: string | null } | null

  const events = Array.isArray(prev?.events) ? [...prev!.events] : []
  if (body.event && typeof body.event === 'object' && JSON.stringify(body.event).length < 2000) {
    events.push({ ...body.event, at: new Date().toISOString() })
  }
  const stepIndex = typeof body.stepIndex === 'number' && body.stepIndex >= 0 ? Math.floor(body.stepIndex) : prev?.step_index ?? 0

  const { error } = await supabase.from('lesson_progress').upsert({
    student_id: profile.id,
    lesson_id: id,
    step_index: stepIndex,
    events: events.slice(-500),
    completed_at: body.completed ? new Date().toISOString() : prev?.completed_at ?? null,
  }, { onConflict: 'student_id,lesson_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

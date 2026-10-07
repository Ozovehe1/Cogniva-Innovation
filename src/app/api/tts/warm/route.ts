import { NextResponse, after } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateScript } from '@/lib/lesson-schema'
import { pregenerateNarration, warmTts } from '@/lib/tts-server'
import { warmServices } from '@/lib/warm'

export const maxDuration = 300

let lastWarm = 0
/** Lessons this server instance is voicing or voiced recently (id -> when). */
const voicing = new Map<string, number>()

/**
 * POST /api/tts/warm   body: { lessonId?, manim? }
 * Called when a lesson page opens. Wakes the narration voice container (it
 * scales to zero when idle) so the first lines are ready by the time the student
 * presses Start, and, for a signed-in student, voices every line of the lesson in
 * the background (cached lines cost one storage lookup). This covers AI-generated
 * lessons, which are not pre-voiced by a tutor approval.
 * manim: true (signed-in learners only; sent when a new learner opens the intake) also boots a
 * Manim render container, so the first lesson's animation renders without a cold start.
 */
export async function POST(request: Request) {
  if (Date.now() - lastWarm > 30_000) {
    lastWarm = Date.now()
    warmTts()
  }
  const body = await request.json().catch(() => ({})) as { lessonId?: unknown; manim?: unknown }
  const id = typeof body.lessonId === 'string' && /^[0-9a-f-]{36}$/i.test(body.lessonId) ? body.lessonId : null
  if (body.manim === true) {
    const { profile } = await getSessionProfile()
    if (profile) warmServices({ everyMs: 30_000 })
  }
  if (!id || Date.now() - (voicing.get(id) ?? 0) < 10 * 60_000) return NextResponse.json({ ok: true })
  const { profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ ok: true })
  voicing.set(id, Date.now())
  after(async () => {
    try {
      const admin = createAdminClient()
      const { data } = await admin.from('lessons').select('script').eq('id', id).maybeSingle()
      const { steps } = validateScript((data as { script?: unknown } | null)?.script ?? [], { maxSteps: 2000 })
      if (steps.length) {
        const r = await pregenerateNarration(steps, 280_000)
        console.log('Lesson narration warmed:', id, r)
        if (!r.done) voicing.delete(id)
      }
    } catch (err) {
      voicing.delete(id)
      console.warn('Lesson narration warm failed:', err instanceof Error ? err.message : err)
    }
  })
  return NextResponse.json({ ok: true, voicing: true })
}

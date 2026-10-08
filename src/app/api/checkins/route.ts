import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { kickDirector } from '@/lib/agent/director'

// The Learning Director's turn runs after the response.
export const maxDuration = 300

/**
 * POST /api/checkins  { context: 'lesson'|'mastery', lessonId?, mood?, energy?, confidence? }  (1-5 each)
 * Private, short-lived: only the learner can read them and they expire after 14 days.
 * Returns { low } so the lesson can slow down and offer a worked example or a break.
 */
export async function POST(request: Request) {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await request.json().catch(() => ({})) as Record<string, unknown>
  const s = (v: unknown) => (typeof v === 'number' && v >= 1 && v <= 5 ? Math.round(v) : null)
  const row = {
    student_id: profile.id,
    context: b.context === 'mastery' ? 'mastery' : 'lesson',
    lesson_id: typeof b.lessonId === 'string' && /^[0-9a-f-]{36}$/i.test(b.lessonId) ? b.lessonId : null,
    mood: s(b.mood), energy: s(b.energy), confidence: s(b.confidence),
  }
  if (row.mood === null && row.confidence === null && row.energy === null) return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })
  const { error } = await supabase.from('learner_checkins').insert(row)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Two very low moods in a row (sustained) is a safety signal, not just a pacing one.
  const { data: recent } = await supabase.from('learner_checkins').select('mood').eq('student_id', profile.id).order('created_at', { ascending: false }).limit(2)
  const sustainedLow = (recent ?? []).length === 2 && (recent ?? []).every(r => (r as { mood: number | null }).mood === 1)
  // Low mood/energy/confidence: the Learning Director re-plans today (lighter); a normal check-in needs no turn.
  const low = (row.mood ?? 3) <= 2 || (row.energy ?? 3) <= 2 || (row.confidence ?? 3) <= 2
  if (low) await kickDirector('checkin', profile.id, { mood: row.mood, energy: row.energy, confidence: row.confidence, lesson_id: row.lesson_id, checkin_id: new Date().toISOString().slice(0, 13) }, new URL(request.url).origin).catch(() => undefined)
  return NextResponse.json({ ok: true, low: (row.mood ?? 3) <= 2 || (row.confidence ?? 3) <= 2, sustainedLow })
}

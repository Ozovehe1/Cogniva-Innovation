import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { answersToColumns, loadLearner } from '@/lib/learner'
import { INTAKE, isMinor, type Answers } from '@/lib/intake'
import { detectDistress } from '@/lib/safety'
import { warmServices } from '@/lib/warm'

const IDS = new Set([...INTAKE.map(i => i.id)])
const FREE_TEXT = ['goal', 'why', 'barriers']

/** GET /api/intake — the learner's saved intake (for resume). */
export async function GET() {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const l = await loadLearner(supabase, profile.id)
  return NextResponse.json({ answers: l?.answers ?? {}, currentItem: l?.current_item ?? null, completed: !!l?.completed_at, consent: !!l?.guardian_consent_at })
}

/**
 * POST /api/intake  { answers: Answers (patch), currentItem?, complete?, consent?: { guardianEmail } }
 * Saves answers as they are given (so the intake resumes). Free text is screened for distress:
 * on a match nothing in that text is stored and { safety: true } is returned.
 * Under-18s: nothing beyond age is stored until a parent/guardian consent is recorded (NDPA 2023 s.31).
 */
export async function POST(request: Request) {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const raw = await request.text()
  if (raw.length > 20_000) return NextResponse.json({ error: 'Too large' }, { status: 413 })
  let body: { answers?: Answers; currentItem?: string; complete?: boolean; consent?: { guardianEmail?: string } }
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const prev = await loadLearner(supabase, profile.id)
  const patch: Answers = {}
  for (const [k, v] of Object.entries(body.answers ?? {})) {
    if (!IDS.has(k) || !v || typeof v !== 'object') continue
    if (JSON.stringify(v).length > 2000) continue
    patch[k] = v
  }
  for (const k of FREE_TEXT) {
    const t = patch[k]?.v
    if (typeof t === 'string' && detectDistress(t)) {
      return NextResponse.json({ safety: true, minor: isMinor({ ...(prev?.answers ?? {}), ...patch }) })
    }
  }
  const answers: Answers = { ...(prev?.answers ?? {}), ...patch }
  const minor = isMinor(answers)

  const row: Record<string, unknown> = { student_id: profile.id }
  if (body.consent) {
    const email = String(body.consent.guardianEmail ?? '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return NextResponse.json({ error: 'Enter your parent or guardian’s email address.' }, { status: 400 })
    row.guardian_email = email
    row.guardian_consent_at = new Date().toISOString()
    answers.consent = { v: true }
  }
  const consented = !!(row.guardian_consent_at || prev?.guardian_consent_at)
  // Before consent, a minor's record holds only status and age.
  const store: Answers = minor && !consented ? Object.fromEntries(Object.entries(answers).filter(([k]) => k === 'status' || k === 'age')) : answers
  Object.assign(row, answersToColumns(store), { answers: store })
  if (typeof body.currentItem === 'string' && IDS.has(body.currentItem)) row.current_item = body.currentItem
  if (body.complete) {
    // The diagnostic (and the first lesson, drafted during it) comes next: keep the voice and render containers awake.
    warmServices()
    if (minor && !consented) return NextResponse.json({ error: 'A parent or guardian needs to agree first.' }, { status: 400 })
    row.completed_at = new Date().toISOString()
  }

  const { error } = await supabase.from('learner_profiles').upsert(row, { onConflict: 'student_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // The intake's mood/energy answer is also a short-lived check-in (private, deleted after 14 days).
  const f = patch.feeling?.v as { mood?: number; energy?: number } | undefined
  if (f && (!minor || consented)) {
    const ok = (n: unknown) => (typeof n === 'number' && n >= 1 && n <= 5 ? Math.round(n) : null)
    try { await createAdminClient().from('learner_checkins').insert({ student_id: profile.id, context: 'intake', mood: ok(f.mood), energy: ok(f.energy) }) } catch {}
  }
  return NextResponse.json({ ok: true, needsConsent: minor && !consented })
}

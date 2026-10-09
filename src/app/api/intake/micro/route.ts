import { NextResponse, after } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { answersToColumns, learnerSnapshot, listPaths, loadLearner, reflectWhy, PATH_SNAPSHOT_KEYS } from '@/lib/learner'
import { MICRO_QUESTIONS, fill, isMinor, itemById, type Answer, type Answers, type MicroId } from '@/lib/intake'
import { updateOwnPathAnswers } from '@/lib/path-edit'
import { detectDistress } from '@/lib/safety'

/** At most one micro-question every this often (and one per lesson end). */
const GAP_MS = 12 * 3_600_000

function nextMicro(a: Answers): MicroId | null {
  const last = (a._micro?.v as { lastAskedAt?: string } | undefined)?.lastAskedAt
  if (last && Date.now() - Date.parse(last) < GAP_MS) return null
  for (const id of MICRO_QUESTIONS) {
    if (a[id]) continue // answered (now or in the v1 intake) or skipped
    const it = itemById(id)
    if (it?.when && !it.when(a)) continue
    return id
  }
  return null
}

/**
 * GET /api/intake/micro — the one deferred onboarding question to ask now (at the end of a lesson), or null.
 * POST /api/intake/micro { id, answer: { v } | { skipped: true } } — save it (progressive profiling,
 * docs/design/onboarding.md) and apply it to the learner's goals so the next lessons use it.
 */
export async function GET() {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const l = await loadLearner(supabase, profile.id)
  if (!l?.completed_at) return NextResponse.json({ question: null })
  const a = l.answers ?? {}
  if (isMinor(a) && !l.guardian_consent_at) return NextResponse.json({ question: null })
  const id = nextMicro(a)
  const it = id ? itemById(id) : null
  if (!it) return NextResponse.json({ question: null })
  return NextResponse.json({ question: { id: it.id, kind: it.kind, ask: fill(it.ask, a), sub: it.sub ? fill(it.sub, a) : undefined, choices: it.choices, anchors: it.anchors, placeholder: it.placeholder } })
}

export async function POST(request: Request) {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { id?: string; answer?: Answer }
  const id = body.id as MicroId
  if (!MICRO_QUESTIONS.includes(id)) return NextResponse.json({ error: 'Unknown question' }, { status: 400 })
  const raw = body.answer && typeof body.answer === 'object' ? body.answer : { skipped: true }
  if (JSON.stringify(raw).length > 1500) return NextResponse.json({ error: 'Too large' }, { status: 413 })
  const ans: Answer = raw.skipped ? { skipped: true, at: new Date().toISOString() } : { v: raw.v, at: new Date().toISOString() }
  if (typeof ans.v === 'string') {
    ans.v = ans.v.trim().slice(0, 600)
    if (detectDistress(ans.v as string)) return NextResponse.json({ safety: true })
  }
  if (id === 'anxiety' && !ans.skipped && !(typeof ans.v === 'number' && ans.v >= 1 && ans.v <= 5)) return NextResponse.json({ error: 'Pick 1 to 5' }, { status: 400 })
  const l = await loadLearner(supabase, profile.id)
  if (!l?.completed_at) return NextResponse.json({ error: 'Finish getting started first.' }, { status: 400 })
  if (isMinor(l.answers ?? {}) && !l.guardian_consent_at) return NextResponse.json({ error: 'A parent or guardian needs to agree first.' }, { status: 400 })
  const answers: Answers = { ...(l.answers ?? {}), [id]: ans, _micro: { v: { lastAskedAt: new Date().toISOString() } } }
  const cols = answersToColumns({ [id]: ans })
  const { error } = await supabase.from('learner_profiles').update({ answers, ...cols }).eq('student_id', profile.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let reflection: string | null = null
  if (!ans.skipped) {
    const paths = await listPaths(supabase, profile.id)
    if (id === 'hours') {
      // Weekly time belongs to a goal: re-plan the newest one (pace, lesson length, due dates).
      const p = paths.find(x => x.status === 'ready')
      if (p) await updateOwnPathAnswers(p.id, { hours: Number(ans.v) })
    } else {
      // Learner-wide traits: every goal's lessons from now on use them.
      const keys = Object.keys(cols).filter(k => (PATH_SNAPSHOT_KEYS as readonly string[]).includes(k))
      for (const p of paths) {
        if (!keys.length) break
        const snap = { ...(p.learner_snapshot ?? learnerSnapshot(l)) } as Record<string, unknown>
        for (const k of keys) snap[k] = (cols as Record<string, unknown>)[k]
        await supabase.from('learning_paths').update({ learner_snapshot: snap }).eq('id', p.id).eq('student_id', profile.id)
      }
    }
    if (id === 'why' && typeof ans.v === 'string' && ans.v.length > 2) {
      try {
        const r = await reflectWhy({ why: ans.v, goal: l.goal || l.goal_text || '' })
        reflection = r.reflection || null
        if (r.valueType) after(async () => {
          await supabase.from('learner_profiles').update({ value_type: r.valueType }).eq('student_id', profile.id)
          for (const p of paths) await supabase.from('learning_paths').update({ learner_snapshot: { ...(p.learner_snapshot ?? {}), value_type: r.valueType, why_text: ans.v } }).eq('id', p.id).eq('student_id', profile.id)
        })
      } catch { /* the answer is saved; the reflection is a nicety */ }
    }
  }
  return NextResponse.json({ ok: true, reflection })
}

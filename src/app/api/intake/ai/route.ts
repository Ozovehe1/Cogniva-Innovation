import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { loadLearner, reflectWhy, suggestGoals } from '@/lib/learner'
import { levelLine } from '@/lib/intake'
import { detectDistress } from '@/lib/safety'

export const maxDuration = 60

/** Per-instance cap on intake AI calls per learner (cheap abuse guard). */
const calls = new Map<string, { n: number; day: string }>()

/**
 * POST /api/intake/ai  { kind: 'goals', goal } | { kind: 'why', why, goal }
 * goals: 3-4 narrowed goal suggestions with subject + a reflection.
 * why: a one-sentence reflection and the value type (intrinsic/attainment/utility).
 * Falls back gracefully: the client keeps going without AI if this fails.
 */
export async function POST(request: Request) {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const day = new Date().toISOString().slice(0, 10)
  const c = calls.get(profile.id)
  const n = c && c.day === day ? c.n : 0
  if (n >= 40) return NextResponse.json({ error: 'Too many requests today' }, { status: 429 })
  calls.set(profile.id, { n: n + 1, day })

  const body = await request.json().catch(() => ({})) as { kind?: string; goal?: string; why?: string }
  const goal = typeof body.goal === 'string' ? body.goal.trim().slice(0, 600) : ''
  const why = typeof body.why === 'string' ? body.why.trim().slice(0, 600) : ''
  if (detectDistress(goal) || detectDistress(why)) return NextResponse.json({ safety: true })
  const l = await loadLearner(supabase, profile.id)
  try {
    if (body.kind === 'goals') {
      if (goal.length < 3) return NextResponse.json({ error: 'Tell me a little more' }, { status: 400 })
      return NextResponse.json(await suggestGoals({ goal, level: l ? levelLine(l) : '' }))
    }
    if (body.kind === 'why') {
      if (why.length < 2) return NextResponse.json({ reflection: '', valueType: 'mixed' })
      const r = await reflectWhy({ why, goal: goal || l?.goal || l?.goal_text || '' })
      if (r.valueType) await supabase.from('learner_profiles').update({ value_type: r.valueType }).eq('student_id', profile.id)
      return NextResponse.json(r)
    }
  } catch (err) {
    return NextResponse.json({ error: 'AI unavailable', detail: (err instanceof Error ? err.message : String(err)).slice(0, 200) }, { status: 502 })
  }
  return NextResponse.json({ error: 'Unknown kind' }, { status: 400 })
}

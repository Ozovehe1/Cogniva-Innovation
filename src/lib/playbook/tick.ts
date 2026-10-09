/**
 * The playbook's background job (pg_cron 'playbook-tick' → GET /api/playbook/tick every 20 minutes):
 *   1. harvest   new signals from the app's own tables (signals.ts) + that learner's private teaching notes
 *   2. credit    deterministic ACE counters: a strong lesson credits every bullet that was injected into it (helpful + 1)
 *   3. reflect   batches of NEW global signals per target → delta ops (reflector.ts, cheap model, background priority)
 *   4. curate    deterministic merge (curator.ts): privacy check, dedupe by embedding, caps, auto-retire
 *   5. gate      up to N candidates: batch probe with vs without (gate.ts); pass → live, else stays candidate / rejected
 * Bounded by a deadline; a quiet tick (nothing new) makes no model call. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { harvest, learnerTerms } from './signals'
import { reflect } from './reflector'
import { applyOps } from './curator'
import { gateBullet } from './gate'
import { BULLET_COLS, loadBullets, logEvent, rowToBullet } from './store'
import type { Bullet, SignalForReflection, Target } from './types'
import { TARGETS } from './types'

/** Learner names / emails behind a batch: checked against every proposed bullet, never sent to a model. */
export async function forbiddenFor(admin: SupabaseClient, studentIds: string[]): Promise<string[]> {
  return [...(await learnerTerms(admin, studentIds)).values()].flat()
}

export async function creditSuccesses(admin: SupabaseClient): Promise<number> {
  const { data } = await admin.from('playbook_signals').select('id, lesson_id').eq('source', 'success').eq('status', 'new').not('lesson_id', 'is', null).limit(50)
  let n = 0
  for (const s of (data ?? []) as { id: number; lesson_id: string }[]) {
    const { data: used } = await admin.from('playbook_usage').select('id, bullet_id').eq('lesson_id', s.lesson_id).eq('credited', false)
    for (const u of (used ?? []) as { id: number; bullet_id: string }[]) {
      const { data: b } = await admin.from('playbook_bullets').select('helpful').eq('id', u.bullet_id).maybeSingle()
      if (!b) continue
      await admin.from('playbook_bullets').update({ helpful: (b as { helpful: number }).helpful + 1 }).eq('id', u.bullet_id)
      await admin.from('playbook_usage').update({ credited: true }).eq('id', u.id)
      await logEvent(admin, u.bullet_id, 'helpful', { signal: s.id, via: 'success credit' })
      n++
    }
  }
  return n
}

export interface TickResult { harvested: Record<string, number>; credited: number; reflected: number; ops: number; added: string[]; merged: string[]; privacyRejected: number; gated: { id: string; pass: boolean; stage: string; reason: string }[]; models: string[]; errors: string[] }

export async function playbookTick(admin: SupabaseClient, opts: { deadline?: number; maxGates?: number; maxBatches?: number } = {}): Promise<TickResult> {
  const deadline = opts.deadline ?? Date.now() + 240_000
  const res: TickResult = { harvested: {}, credited: 0, reflected: 0, ops: 0, added: [], merged: [], privacyRejected: 0, gated: [], models: [], errors: [] }
  try { res.harvested = await harvest(admin) } catch (err) { res.errors.push(`harvest: ${err instanceof Error ? err.message : err}`) }
  try { res.credited = await creditSuccesses(admin) } catch (err) { res.errors.push(`credit: ${err instanceof Error ? err.message : err}`) }

  // Reflect: strongest external evidence first, a batch per target.
  const { data: fresh } = await admin.from('playbook_signals').select('id, source, target, external, subject, topic, skill, payload, weight, student_id, lesson_id').eq('status', 'new').eq('scope', 'global').order('weight', { ascending: false }).order('created_at').limit(60)
  const rows = (fresh ?? []) as (SignalForReflection & { student_id: string | null; lesson_id: string | null })[]
  const byTarget = new Map<Target, typeof rows>()
  for (const r of rows) byTarget.set(r.target, [...(byTarget.get(r.target) ?? []), r])
  let batches = 0
  for (const target of TARGETS) {
    const group = byTarget.get(target) ?? []
    // Successes alone are weak evidence: wait for a few before reflecting on them.
    if (!group.length || (group.every(g => g.source === 'success') && group.length < 3)) continue
    if (batches >= (opts.maxBatches ?? 3) || Date.now() > deadline - 90_000) break
    const batch = group.slice(0, 12)
    batches++
    try {
      const existing = await loadBullets(admin, target, { statuses: ['live', 'candidate'], fresh: true })
      const lessons = [...new Set(batch.map(b => b.lesson_id).filter(Boolean))] as string[]
      let used: Bullet[] = []
      if (lessons.length) {
        const { data: u } = await admin.from('playbook_usage').select('bullet_id').in('lesson_id', lessons).limit(60)
        const ids = [...new Set(((u ?? []) as { bullet_id: string }[]).map(x => x.bullet_id))]
        if (ids.length) used = ((await admin.from('playbook_bullets').select(BULLET_COLS).in('id', ids)).data ?? []).map(r => rowToBullet(r as Record<string, unknown>))
      }
      const { ops, model } = await reflect(target, batch.map(b => ({ id: b.id, source: b.source, target: b.target, external: b.external, subject: b.subject, topic: b.topic, skill: b.skill, payload: b.payload, weight: b.weight })), existing, used, { deadline: deadline - 60_000 })
      if (model) res.models.push(model)
      const cur = await applyOps(admin, ops, { forbidden: await forbiddenFor(admin, batch.map(b => b.student_id ?? '')) })
      res.ops += ops.length; res.added.push(...cur.added); res.merged.push(...cur.merged); res.privacyRejected += cur.rejected.filter(r => r.text.startsWith('(withheld')).length
      await admin.from('playbook_signals').update({ status: 'reflected' }).in('id', batch.map(b => b.id))
      res.reflected += batch.length
    } catch (err) {
      res.errors.push(`reflect ${target}: ${err instanceof Error ? err.message.slice(0, 200) : err}`)
    }
  }

  // Gate: newest-evidence candidates that have not been gated since their evidence last grew.
  const { data: cands } = await admin.from('playbook_bullets').select(BULLET_COLS).eq('status', 'candidate').eq('scope', 'global').lt('gate_attempts', 4).order('evidence', { ascending: false }).order('created_at').limit(10)
  const pending = ((cands ?? []).map(r => rowToBullet(r as Record<string, unknown>))).filter(b => !b.gate || b.gate.stage === 'inconclusive' || (b.evidence >= 3 && b.gate_attempts < 2))
  for (const b of pending.slice(0, opts.maxGates ?? 2)) {
    if (Date.now() > deadline - 70_000) break
    try {
      const v = await gateBullet(admin, b, { deadline: Math.min(deadline - 10_000, Date.now() + 100_000) })
      res.gated.push({ id: b.id, pass: v.pass, stage: v.stage, reason: v.reason })
    } catch (err) { res.errors.push(`gate ${b.id.slice(0, 8)}: ${err instanceof Error ? err.message.slice(0, 160) : err}`) }
  }
  return res
}

/**
 * Curator (ACE): deterministic merge of the reflector's delta ops into the playbook — no model call.
 *   add       privacy check (hard rule) → embed → near-duplicate of an existing bullet (same target, cosine ≥ DUP_SIM or
 *             the same normalised text)? merge: evidence + 1, sources appended (the wording that passed the gate stays).
 *             Otherwise insert as a CANDIDATE (only the gate makes it live).
 *   helpful / harmful   counters; a live bullet with harmful ≥ 3 and harmful > helpful is retired automatically.
 *   caps (grow-and-refine, avoids context collapse): per target+topic ≤ CAP_TOPIC live and ≤ CAP_CAND candidates,
 *             per target ≤ CAP_TARGET live; the lowest-scoring (helpful + evidence − harmful) are retired / rejected.
 * Incremental: bullets are never rewritten wholesale, so nothing learned is lost to a summarising rewrite.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { privacyCheck, stringsOf } from './privacy'
import { bulletEmbedText, bulletScore, clearPlaybookCache, cosine, embedOne, loadBullets, logEvent, topicKey } from './store'
import type { Bullet, DeltaOp, Target } from './types'

export const DUP_SIM = 0.92
export const CAP_TOPIC = 8
export const CAP_CAND = 12
export const CAP_TARGET = 150
export const RETIRE_HARMFUL = 3

export const normText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Nearest existing bullet that counts as the same rule (pure; exported for the eval). */
export function nearDuplicate(text: string, vec: number[] | null, pool: Pick<Bullet, 'id' | 'text' | 'embedding'>[]): { id: string; sim: number } | null {
  const n = normText(text)
  let best: { id: string; sim: number } | null = null
  for (const b of pool) {
    const sim = normText(b.text) === n ? 1 : vec && b.embedding ? cosine(vec, b.embedding) : 0
    if (sim >= DUP_SIM && (!best || sim > best.sim)) best = { id: b.id, sim }
  }
  return best
}

/** Which bullets a size cap removes (pure): the lowest-scoring beyond `cap`, oldest first on ties. */
export function overCap<T extends Pick<Bullet, 'id' | 'helpful' | 'harmful' | 'evidence' | 'created_at'>>(rows: T[], cap: number): T[] {
  if (rows.length <= cap) return []
  return [...rows].sort((a, b) => bulletScore(a) - bulletScore(b) || a.created_at.localeCompare(b.created_at)).slice(0, rows.length - cap)
}

export interface CurateResult { added: string[]; merged: string[]; rejected: { text: string; problems: string[] }[]; countered: number; retired: string[] }

export async function applyOps(admin: SupabaseClient, ops: DeltaOp[], opts: { scope?: 'global' | 'eval'; forbidden?: string[]; actor?: string } = {}): Promise<CurateResult> {
  const scope = opts.scope ?? 'global'
  const res: CurateResult = { added: [], merged: [], rejected: [], countered: 0, retired: [] }
  const touched = new Set<Target>()
  for (const op of ops) {
    if (op.op === 'add' && op.text && op.target) {
      // HARD RULE: nothing learner-specific enters the global playbook.
      const pv = privacyCheck(stringsOf({ t: op.text, c: op.check, p: op.probes, h: op.hints, s: op.subject, o: op.topic, k: op.skill }).join('\n'), opts.forbidden ?? [])
      if (!pv.ok) {
        res.rejected.push({ text: '(withheld: failed the privacy check)', problems: pv.problems })
        await logEvent(admin, null, 'privacy_reject', { target: op.target, problems: pv.problems, evidence: op.evidence ?? [] }, opts.actor)
        continue
      }
      const tags = { subject: op.subject ?? '', topic: op.topic ?? '', skill: op.skill ?? '', text: op.text }
      const vec = await embedOne(bulletEmbedText(tags))
      const pool = await loadBullets(admin, op.target, { statuses: ['candidate', 'live'], scope, fresh: true })
      const dup = nearDuplicate(op.text, vec, pool)
      const sources = (op.evidence ?? []).map(signal => ({ signal }))
      if (dup) {
        const b = pool.find(x => x.id === dup.id)!
        await admin.from('playbook_bullets').update({ evidence: b.evidence + 1, sources: [...b.sources, ...sources].slice(-40), updated_at: new Date().toISOString() }).eq('id', b.id)
        await logEvent(admin, b.id, 'merge', { similarity: Number(dup.sim.toFixed(3)), evidence: op.evidence ?? [], proposed: op.text }, opts.actor)
        res.merged.push(b.id)
      } else {
        const { data, error } = await admin.from('playbook_bullets').insert({
          target: op.target, kind: op.kind ?? 'avoid', ...tags, topic_key: topicKey(`${tags.topic} ${tags.skill}`), check_q: op.check ?? null, probes: op.probes ?? [], hints: op.hints ?? {},
          status: 'candidate', scope, sources, embedding: vec ? JSON.stringify(vec) : null,
        }).select('id').single()
        if (error || !data) { res.rejected.push({ text: op.text, problems: [error?.message ?? 'insert failed'] }); continue }
        await logEvent(admin, (data as { id: string }).id, 'add', { evidence: op.evidence ?? [], kind: op.kind }, opts.actor)
        res.added.push((data as { id: string }).id)
      }
      touched.add(op.target)
    } else if ((op.op === 'helpful' || op.op === 'harmful') && op.id) {
      const { data } = await admin.from('playbook_bullets').select('id, target, status, helpful, harmful').eq('id', op.id).maybeSingle()
      const b = data as { id: string; target: Target; status: string; helpful: number; harmful: number } | null
      if (!b) continue
      const upd = op.op === 'helpful' ? { helpful: b.helpful + 1 } : { harmful: b.harmful + 1 }
      const harmful = op.op === 'harmful' ? b.harmful + 1 : b.harmful
      const retire = b.status === 'live' && harmful >= RETIRE_HARMFUL && harmful > b.helpful
      await admin.from('playbook_bullets').update({ ...upd, ...(retire ? { status: 'retired', retired_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() }).eq('id', b.id)
      await logEvent(admin, b.id, op.op, { evidence: op.evidence ?? [] }, opts.actor)
      if (retire) { await logEvent(admin, b.id, 'retire', { reason: `harmful ${harmful} > helpful ${b.helpful}` }, opts.actor); res.retired.push(b.id) }
      res.countered++
      touched.add(b.target)
    }
  }
  for (const t of touched) res.retired.push(...await enforceCaps(admin, t, scope))
  clearPlaybookCache()
  return res
}

/** Grow-and-refine: keep each target and topic within its caps. */
export async function enforceCaps(admin: SupabaseClient, target: Target, scope: 'global' | 'eval' = 'global'): Promise<string[]> {
  const all = await loadBullets(admin, target, { statuses: ['candidate', 'live'], scope, fresh: true })
  const out: string[] = []
  const now = new Date().toISOString()
  const byTopic = new Map<string, Bullet[]>()
  for (const b of all) byTopic.set(b.topic_key, [...(byTopic.get(b.topic_key) ?? []), b])
  for (const [, rows] of byTopic) {
    for (const b of overCap(rows.filter(r => r.status === 'live'), CAP_TOPIC)) { await admin.from('playbook_bullets').update({ status: 'retired', retired_at: now }).eq('id', b.id); await logEvent(admin, b.id, 'retire', { reason: 'topic cap' }); out.push(b.id) }
    for (const b of overCap(rows.filter(r => r.status === 'candidate'), CAP_CAND)) { await admin.from('playbook_bullets').update({ status: 'rejected' }).eq('id', b.id); await logEvent(admin, b.id, 'reject', { reason: 'candidate cap' }); out.push(b.id) }
  }
  const live = all.filter(b => b.status === 'live' && !out.includes(b.id))
  for (const b of overCap(live, CAP_TARGET)) { await admin.from('playbook_bullets').update({ status: 'retired', retired_at: now }).eq('id', b.id); await logEvent(admin, b.id, 'retire', { reason: 'target cap' }); out.push(b.id) }
  return out
}

/**
 * Playbook storage helpers: bullets (cached per target), embeddings (gte-small via the "embed" Edge Function), the
 * lifecycle log and harvester watermarks. Service role only. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { embedTexts } from '../agent/memory'
import { topicKey } from '../correctness/blocklist'
import type { Bullet, Target } from './types'

export const BULLET_COLS = 'id, target, kind, subject, topic, topic_key, skill, text, check_q, probes, hints, status, scope, helpful, harmful, evidence, sources, embedding, gate, gate_attempts, version, decided_by, created_at, updated_at, live_at, retired_at'

export function parseVec(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[]
  if (typeof v === 'string' && v.startsWith('[')) { try { return JSON.parse(v) as number[] } catch { return null } }
  return null
}

export function cosine(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!a || !b || a.length !== b.length) return 0
  let d = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? d / Math.sqrt(na * nb) : 0
}

export function rowToBullet(r: Record<string, unknown>): Bullet {
  return { ...(r as unknown as Bullet), probes: Array.isArray(r.probes) ? r.probes as string[] : [], hints: (r.hints ?? {}) as Bullet['hints'], sources: Array.isArray(r.sources) ? r.sources as Bullet['sources'] : [], embedding: parseVec(r.embedding) }
}

/** Text a bullet is embedded by: its tags and the rule (so topic words weigh in retrieval and dedupe). */
export function bulletEmbedText(b: Pick<Bullet, 'subject' | 'topic' | 'skill' | 'text'>): string {
  return `${[b.subject, b.topic, b.skill].filter(Boolean).join(' · ')}: ${b.text}`.slice(0, 600)
}

const cache = new Map<string, { at: number; rows: Bullet[] }>()
const TTL = 5 * 60_000
export function clearPlaybookCache() { cache.clear() }

/** Bullets of one target with the given statuses (live global ones are cached for five minutes). */
export async function loadBullets(admin: SupabaseClient, target: Target | null, opts: { statuses?: Bullet['status'][]; scope?: 'global' | 'eval'; fresh?: boolean } = {}): Promise<Bullet[]> {
  const statuses = opts.statuses ?? ['live']
  const scope = opts.scope ?? 'global'
  const key = `${target ?? '*'}|${statuses.join(',')}|${scope}`
  const hit = cache.get(key)
  if (!opts.fresh && hit && Date.now() - hit.at < TTL) return hit.rows
  let q = admin.from('playbook_bullets').select(BULLET_COLS).in('status', statuses).eq('scope', scope).order('created_at').limit(800)
  if (target) q = q.eq('target', target)
  const { data, error } = await q
  if (error) { if (hit) return hit.rows; throw new Error(error.message) }
  const rows = (data ?? []).map(r => rowToBullet(r as Record<string, unknown>))
  cache.set(key, { at: Date.now(), rows })
  return rows
}

export async function embedOne(text: string, timeoutMs = 6000): Promise<number[] | null> {
  return (await embedTexts([text.slice(0, 1200)], timeoutMs))?.[0] ?? null
}

export async function logEvent(admin: SupabaseClient, bulletId: string | null, op: string, detail: Record<string, unknown> = {}, actor = 'system') {
  try { await admin.from('playbook_events').insert({ bullet_id: bulletId, op, detail, actor }) } catch { /* best effort */ }
}

export async function getState<T>(admin: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data } = await admin.from('playbook_state').select('value').eq('key', key).maybeSingle()
  return ((data as { value?: T } | null)?.value ?? fallback) as T
}
export async function setState(admin: SupabaseClient, key: string, value: unknown) {
  await admin.from('playbook_state').upsert({ key, value, updated_at: new Date().toISOString() })
}

export { topicKey }

/** Rank for size caps: evidence and helpful count up, harmful counts down (ACE counters). */
export function bulletScore(b: Pick<Bullet, 'helpful' | 'harmful' | 'evidence'>): number {
  return b.helpful * 1.0 + b.evidence * 0.5 - b.harmful * 1.5
}

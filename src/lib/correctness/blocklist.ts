/**
 * The correctness blocklist, fed by confirmed mistake reports (admin triage): illustration ids that were wrong for a
 * topic (or everywhere), and prompt patterns / clip specs the generators must avoid. Read with the service role and
 * cached for five minutes per server instance. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

export interface BlockRow { kind: 'illustration' | 'prompt_pattern' | 'clip_spec'; value: string; topic: string; reason: string | null }

let cache: { at: number; rows: BlockRow[] } | null = null
const TTL = 5 * 60_000

export async function loadBlocklist(admin?: SupabaseClient | null): Promise<BlockRow[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.rows
  try {
    const db = admin ?? createAdminClient()
    const { data } = await db.from('correctness_blocklist').select('kind, value, topic, reason').limit(2000)
    cache = { at: Date.now(), rows: (data ?? []) as BlockRow[] }
  } catch {
    cache = { at: Date.now() - TTL + 30_000, rows: cache?.rows ?? [] }
  }
  return cache.rows
}
export function clearBlocklistCache() { cache = null }

/** Topic key used by the blocklist and the vision verdict cache: lowercase words, sorted, no filler. */
export function topicKey(topic: string): string {
  const STOP = new Set('a an the of and or in on to for with by diagram picture image illustration labelled labeled simple basic school show me draw drawing'.split(' '))
  return [...new Set((topic.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(w => w.length > 1 && !STOP.has(w)))].sort().join(' ').slice(0, 80)
}

/** Illustration ids not to show for this topic (blocked for the topic or everywhere). */
export async function blockedIllustrations(topic: string, admin?: SupabaseClient | null): Promise<Set<string>> {
  const key = topicKey(topic)
  return new Set((await loadBlocklist(admin)).filter(r => r.kind === 'illustration' && (!r.topic || r.topic === key)).map(r => r.value))
}

/** Confirmed mistakes to steer the writers away from, as prompt lines ("Avoid: …"). */
export async function avoidLines(kinds: BlockRow['kind'][] = ['prompt_pattern'], admin?: SupabaseClient | null): Promise<string[]> {
  return (await loadBlocklist(admin)).filter(r => kinds.includes(r.kind)).slice(-12).map(r => `Avoid (a confirmed past mistake): ${r.value.slice(0, 200)}${r.reason ? ` (${r.reason.slice(0, 120)})` : ''}`)
}

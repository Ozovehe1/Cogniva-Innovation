/**
 * Illustration guard: does the chosen library picture actually show the topic, at school level?
 *   1. blocklist  ids confirmed wrong (for this topic or everywhere) are never picked
 *   2. re-rank    known weak topics prefer the textbook picture ("atom" → a Bohr / shell model, not a QM helium cloud)
 *   3. title/tags the item's title and keywords must name the topic (or a school synonym)
 *   4. vision     the rendered picture is shown to a vision model with the query ("is this a school-level picture of
 *                 an atom?"); a no or low confidence moves on to the next candidate; verdicts are cached per item+topic
 * When nothing passes, the caller falls back to a drawn diagram. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LibraryItem } from '../illustrations/types'
import { tokens } from '../illustrations/search'
import { blockedIllustrations, topicKey } from './blocklist'

/** Topics where ranking alone has picked the wrong picture before: what the right one is titled, and what to avoid. */
export const WEAK_TOPICS: { topic: RegExp; want: RegExp; avoid: RegExp }[] = [
  { topic: /^(atom|atoms|atomic|atomic structure|atom structure|atom model|structure atom|model atom|bohr)$/, want: /\bbohr\b|schematic atom|atom model|electron shell/i, avoid: /\bqm\b|quantum|logo|icon|pinhead|photon emission|spectrum|quark|start distart|\b(mr|ml|ne|uk|de|cs|mul|spanish)\b/i },
  { topic: /^(circuit|electric circuit|simple circuit|electrical circuit)$/, want: /simple (electric )?circuit|series and parallel|ohm/i, avoid: /h.?bridge|logic|integrated|transistor|amplifier/i },
  { topic: /^(cell|animal cell)$/, want: /animal cell/i, avoid: /membrane|cancer|stem|blood cell|cell phone/i },
  { topic: /^(lever|levers)$/, want: /\blever/i, avoid: /torque|firearm|gear/i },
  { topic: /^(heart|human heart)$/, want: /\bheart\b|cardiac/i, avoid: /icon|emoji|symbol|card/i },
  { topic: /^(refraction|light refraction|refraction light)$/, want: /refraction|snell/i, avoid: /double refraction|birefring|atmospher/i },
  { topic: /^(magnet|magnetic field|bar magnet)$/, want: /magnet.*field|field lines|bar magnet/i, avoid: /mri|logo/i },
]

function weak(topic: string) {
  const k = topic.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
  return WEAK_TOPICS.find(w => w.topic.test(k)) ?? null
}

/** Drop blocked items; on a weak topic put the textbook picture first and the known-bad ones last. */
export async function vetOrder<T extends { item: LibraryItem; score: number }>(hits: T[], topic: string, admin: SupabaseClient | null, trace?: string[]): Promise<T[]> {
  const blocked = await blockedIllustrations(topic, admin).catch(() => new Set<string>())
  let out = hits.filter(h => !blocked.has(h.item.id))
  if (out.length < hits.length) trace?.push(`guard: blocked ${hits.length - out.length} illustration(s) for "${topic}"`)
  const w = weak(topic)
  if (w) {
    const rank = (h: T) => (w.avoid.test(h.item.t) ? 2 : w.want.test(h.item.t) ? 0 : 1)
    out = [...out].sort((a, b) => rank(a) - rank(b) || b.score - a.score)
  }
  return out
}

const SCHOOL_SYN: Record<string, string[]> = { atom: ['atomic', 'bohr'], heart: ['cardiac'], lung: ['respiratory', 'pulmonary'], cell: ['cellular'], circuit: ['electric', 'electrical'], dna: ['helix'], lever: ['fulcrum'] }

/** Does the item's title or keywords name the topic? (Most main words, or a school synonym for them.) */
export function titleMatches(item: LibraryItem, topic: string): boolean {
  const main = tokens(topicKey(topic))
  if (!main.length) return true
  const have = new Set(tokens(`${item.t} ${item.k} ${item.d ?? ''}`))
  const hit = main.filter(w => have.has(w) || (SCHOOL_SYN[w] ?? []).some(s => have.has(s)))
  const w = weak(topic)
  if (w && w.avoid.test(item.t)) return false
  return hit.length >= Math.ceil(main.length * 0.66)
}

export interface Verdict { ok: boolean; confidence: number | null; depicts: string; via: 'cache' | 'vision' | 'title'; model?: string }

/**
 * Vision check of one prepared picture against the topic (cached per item + topic). Returns null when no vision model
 * answered in time; the caller then trusts the title/tag check.
 */
export async function visionVerdict(item: LibraryItem, svg: string, topic: string, admin: SupabaseClient | null, opts: { deadline?: number; trace?: string[] } = {}): Promise<Verdict | null> {
  const key = topicKey(topic)
  if (admin) {
    const { data } = await admin.from('illustration_verdicts').select('ok, confidence, depicts').eq('item_id', item.id).eq('topic', key).maybeSingle()
    if (data) return { ok: !!data.ok, confidence: data.confidence ?? null, depicts: data.depicts ?? '', via: 'cache' }
  }
  const { svgToPng } = await import('../agent/board-render')
  const { visionJson } = await import('../agent/llm')
  const png = await svgToPng(svg, 640)
  if (!png) return null
  const trace: string[] = []
  const j = await visionJson(`A secondary-school learner asked for a picture of: "${topic.slice(0, 120)}".
Look at this image (a library illustration; ignore the small credit line at the bottom).
Return JSON only: {"depicts": "<what it shows, under 12 words>", "matches": <true if it clearly shows ${JSON.stringify(topic.slice(0, 80))} so a learner would recognise it>, "school_level": <true if it is the picture a school textbook would use for this (not a research figure, logo, icon or a different object)>, "confidence": <0..1>}`, png, { deadline: opts.deadline ?? Date.now() + 9_000, trace }) as { depicts?: unknown; matches?: unknown; school_level?: unknown; confidence?: unknown } | null
  opts.trace?.push(...trace.slice(-2))
  if (!j || typeof j !== 'object') return null
  const confidence = typeof j.confidence === 'number' ? Math.max(0, Math.min(1, j.confidence)) : null
  const ok = j.matches === true && j.school_level !== false && (confidence === null || confidence >= 0.6)
  const v: Verdict = { ok, confidence, depicts: String(j.depicts ?? '').slice(0, 120), via: 'vision', model: trace.find(t => / ok$/.test(t))?.replace(/^vision\s+|: ok$/g, '') }
  if (admin) await admin.from('illustration_verdicts').upsert({ item_id: item.id, topic: key, ok: v.ok, confidence, depicts: v.depicts, model: v.model ?? null }).then(() => {}, () => {})
  return v
}

/** Title/tag check, then the vision check within the remaining budget. */
export async function vetIllustration(item: LibraryItem, svg: string, topic: string, admin: SupabaseClient | null, opts: { deadline?: number; trace?: string[]; vision?: boolean } = {}): Promise<Verdict> {
  const titled = titleMatches(item, topic)
  if (opts.vision === false || (opts.deadline && opts.deadline - Date.now() < 3000)) return { ok: titled, confidence: null, depicts: item.t, via: 'title' }
  const v = await visionVerdict(item, svg, topic, admin, opts).catch(() => null)
  if (!v) return { ok: titled, confidence: null, depicts: item.t, via: 'title' }
  return v
}

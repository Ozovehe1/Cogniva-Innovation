/**
 * find_illustration: library first (offline index -> live Wikimedia Commons), each result credited.
 * Returns null when nothing usable was found, so the caller can fall back to a drawn (LLM-written) SVG.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { searchLibrary, type Hit } from './search'
import { prepareIllustration, searchCommonsLive, type Prepared } from './prepare'
import { creditLine, SOURCE_NAME, type LibraryItem } from './types'
import { vetIllustration, vetOrder } from '../correctness/illustration'

export interface Found extends Prepared {
  item: LibraryItem
  alt: string
  creditText: string
  alternatives: string[]
  /** Servier and Bioicons drawings carry no labels; most Commons diagrams do. */
  labelled: boolean
  via: 'library' | 'commons-live'
}

const MIN_SCORE = 6

export async function findIllustration(
  args: { topic: string; keywords?: string[]; want?: 'diagram' | 'icon' | 'any'; alternative?: number; exclude?: string[] },
  admin: SupabaseClient | null,
  trace?: string[],
): Promise<Found | null> {
  const topic = args.topic.trim().slice(0, 120)
  let hits: Hit[] = await searchLibrary(topic, { extra: args.keywords, want: args.want ?? 'diagram', limit: 8 })
  hits = hits.filter(h => h.score >= MIN_SCORE)
  let via: Found['via'] = 'library'
  if (!hits.length) {
    const live = await searchCommonsLive(topic)
    hits = live.map((item, i) => ({ item, score: MIN_SCORE - i * 0.1, coverage: 1 }))
    via = 'commons-live'
  }
  // Correctness guard: blocklisted ids out, weak topics re-ranked, then each candidate checked against the topic.
  hits = await vetOrder(hits, topic, admin, trace)
  // Pictures this learner has reported (still open or confirmed) are never shown to them again, even before triage.
  if (args.exclude?.length) {
    const ex = new Set(args.exclude), n = hits.length
    hits = hits.filter(h => !ex.has(h.item.id))
    if (hits.length < n) trace?.push(`guard: skipped ${n - hits.length} illustration(s) this learner reported`)
  }
  if (!hits.length) return null
  const skip = Math.max(0, Math.min(3, Math.round(args.alternative ?? 0)))
  const order = [...hits.slice(skip), ...hits.slice(0, skip)]
  const deadline = Date.now() + 14_000
  for (const h of order.slice(0, 4)) {
    try {
      const p = await prepareIllustration(h.item, admin)
      trace?.push(`illustration: ${h.item.id} (${h.score.toFixed(1)}) ${p.cached ? 'cached' : 'fetched'} ${p.ms} ms`)
      const v = await vetIllustration(h.item, p.svg, topic, admin, { deadline, trace })
      trace?.push(`guard: ${h.item.id} ${v.ok ? 'ok' : 'rejected'} via ${v.via}${v.confidence !== null ? ` ${v.confidence.toFixed(2)}` : ''}${v.depicts ? ` (${v.depicts.slice(0, 60)})` : ''}`)
      if (!v.ok) continue
      const labelled = h.item.src === 'commons' && !/blank|without text|no text|unlabel|numbered|numlabels/i.test(h.item.t)
      return {
        ...p, item: h.item, via, labelled,
        alt: `${h.item.t.replace(/\s+(en|EN|eng)$/, "")}${h.item.d ? ` — ${h.item.d.slice(0, 160)}` : ''} (${SOURCE_NAME[h.item.src]})`.slice(0, 280),
        creditText: creditLine(p.credit),
        alternatives: hits.filter(x => x !== h).slice(0, 3).map(x => `${x.item.t} [${SOURCE_NAME[x.item.src]}]`),
      }
    } catch (err) {
      trace?.push(`illustration skip ${h.item.id}: ${err instanceof Error ? err.message.slice(0, 80) : err}`)
    }
  }
  return null
}

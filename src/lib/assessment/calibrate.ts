/**
 * Difficulty calibration from learners' responses (docs/design/assessment.md §8): the Elo rating system as used in
 * adaptive practice (Pelánek 2016). An answer is a "match" between the learner (skill θ) and the item (difficulty d):
 *   P(correct) = 1 / (1 + e^-(θ - d))     θ += K(r - P)     d -= K(r - P)
 * with an uncertainty-decaying K = a / (1 + b·n). Items are never shared between learners (personal content), so an
 * item's rating moves only with its own learner's attempts; what IS pooled across learners is the calibration of the
 * writer's 1-5 difficulty tag per subject and Bloom level (statistics only, no content), which seeds new items.
 *
 * Pure maths here; storage is jsonb on the rows that already hold the items (path_topics.mastery, learning_paths
 * diagnostic, agent_actions.result) plus the optional `assessment_calibration` table (see migration).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AssessItem } from './spec'

export const ELO_SCALE = 1
/** Writer's 1-5 tag → initial difficulty on the logit scale. */
export const seedDifficulty = (tag?: number) => (typeof tag === 'number' ? (tag - 3) * 0.8 : 0)
export const pCorrect = (theta: number, d: number, options = 4) => {
  // Guessing floor: with k options a learner who knows nothing still gets 1/k (3PL-style lower asymptote).
  const g = 1 / Math.max(2, options)
  return g + (1 - g) / (1 + Math.exp(-(theta - d) / ELO_SCALE))
}
export const kFactor = (n: number, a = 0.8, b = 0.15) => a / (1 + b * n)

export interface Rating { r: number; n: number }

/**
 * One answer. Confidence-weighted (Gardner-Medwin's certainty-based marking): a confident correct answer counts fully,
 * a guessed correct answer counts as half evidence, a confident wrong answer counts more against than an unsure one.
 */
export function update(learner: Rating, item: Rating, correct: boolean, opts: { options?: number; confidence?: 'guess' | 'fairly' | 'sure' | null } = {}): { learner: Rating; item: Rating; p: number } {
  const p = pCorrect(learner.r, item.r, opts.options)
  const w = correct ? (opts.confidence === 'guess' ? 0.5 : 1) : (opts.confidence === 'sure' ? 1.25 : 1)
  const delta = w * ((correct ? 1 : 0) - p)
  return {
    p,
    learner: { r: learner.r + kFactor(learner.n) * delta, n: learner.n + 1 },
    item: { r: item.r - kFactor(item.n, 0.6) * delta, n: item.n + 1 },
  }
}

/** Expected-score target for practice: items the learner gets right about 70-80% of the time (desirable difficulty). */
export function pickByTarget<T extends AssessItem>(items: T[], theta: number, target = 0.75): T[] {
  return [...items].sort((a, b) => Math.abs(pCorrect(theta, a.elo ?? seedDifficulty(a.difficulty), a.options.length) - target) - Math.abs(pCorrect(theta, b.elo ?? seedDifficulty(b.difficulty), b.options.length) - target))
}

/** Learner skill rating per path node, kept in the item container's jsonb (no new learner table needed). */
export function applyResponses(items: AssessItem[], answers: (number | null)[], learner: Rating, confidence?: ('guess' | 'fairly' | 'sure' | null)[]): { items: AssessItem[]; learner: Rating } {
  let L = learner
  const out = items.map((it, i) => {
    const a = answers[i]
    if (typeof a !== 'number') return it
    const r = update(L, { r: it.elo ?? seedDifficulty(it.difficulty), n: (it as { eloN?: number }).eloN ?? 0 }, a === it.answer, { options: it.options.length, confidence: confidence?.[i] })
    L = r.learner
    return { ...it, elo: Math.round(r.item.r * 1000) / 1000, eloN: r.item.n } as AssessItem
  })
  return { items: out, learner: L }
}

/**
 * Pooled calibration of the writer's difficulty tag (subject × bloom × tag → observed logit offset). Best effort: the
 * table may not exist yet (migration 20261020091000_assessment_calibration.sql); then nothing is pooled.
 */
export async function recordTagOutcome(db: SupabaseClient, key: { subject: string; bloom?: string; tag?: number }, correct: boolean, theta: number): Promise<void> {
  if (!key.tag) return
  const id = `${key.subject.toLowerCase().slice(0, 40)}|${key.bloom ?? 'any'}|${key.tag}`
  try {
    const { data } = await db.from('assessment_calibration').select('offset_logit, n').eq('key', id).maybeSingle()
    const row = (data ?? { offset_logit: 0, n: 0 }) as { offset_logit: number; n: number }
    const d = seedDifficulty(key.tag) + row.offset_logit
    const p = pCorrect(theta, d)
    const k = kFactor(row.n, 0.3, 0.02)
    await db.from('assessment_calibration').upsert({ key: id, offset_logit: row.offset_logit - k * ((correct ? 1 : 0) - p), n: row.n + 1, updated_at: new Date().toISOString() })
  } catch { /* table not there yet: calibration stays per item */ }
}

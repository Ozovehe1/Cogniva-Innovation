/**
 * Layout learning for the animation scene engine, without retraining any model.
 *
 * Every scene-language render reports its layout outcome on manim_jobs.verdict.layout (modal_app/gm_stage.py
 * Stage.layout_report + the frame probe): per-label clearance, distance from target and ownership margin, the smallest text
 * in phone px, and the general failure PATTERNS they add up to (label_touching, label_far, label_ambiguous, text_small, ...).
 *
 * When the same pattern recurs (RECUR renders since its last adjustment) two things happen, both per pattern and general
 * (never per learner, never a cached answer for some content):
 *  1. the label solver's weight tied to that pattern takes one bounded step (table scene_layout_weights; the engine clamps
 *     again to its own bounds), and is sent with every new render (dispatchFreeform -> tuning.weights);
 *  2. an "avoid" note for the scene writer is added to the correctness blocklist (kind clip_spec, topic 'scene-layout') and
 *     sent with every new render (tuning.avoid), next to the confirmed-mistake avoid-lines the other writers get.
 * A confirmed learner report on a clip counts as RECUR - 1 hits for the patterns its render showed (and becomes a regression
 * scene, see reports.ts sceneCaseFromReport).
 * Server only (service role).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { clearBlocklistCache, loadBlocklist } from './blocklist'

/** Hits of one pattern (renders showing it) since its last adjustment before it adjusts again. */
export const RECUR = 3
export const LAYOUT_TOPIC = 'scene-layout'

export interface LayoutRule {
  /** The weight this pattern tunes: multiply by `factor` or add `delta`, clamped to the row's [lo, hi]. */
  weight?: { key: string; factor?: number; delta?: number }
  /** The note the scene writer gets once the pattern recurs. */
  avoid: string
}

export const LAYOUT_RULES: Record<string, LayoutRule> = {
  label_touching: { weight: { key: 'clear', factor: 1.12 }, avoid: 'Labels ended up touching their own symbol (battery plates, arrow tips): keep labelled parts apart and do not crowd several labelled things into a small area.' },
  label_far: { weight: { key: 'anchor', factor: 1.15 }, avoid: 'Labels drifted away from what they name: keep labels short (one to three words) so they fit right next to their object; put long explanations in the narration.' },
  label_ambiguous: { weight: { key: 'own', factor: 1.2 }, avoid: 'A label sat nearer another line than its own: do not draw labelled lines or arrows close and parallel; space them, or label only the one that matters.' },
  label_overlap: { weight: { key: 'clear_w', factor: 1.15 }, avoid: 'Labels collided with other text: use fewer labels per beat and hide ones that are no longer needed.' },
  text_overlap: { weight: { key: 'clear_w', factor: 1.15 }, avoid: 'Text collided with other text: use fewer, shorter texts on screen at once.' },
  label_crossed: { weight: { key: 'stroke_in', factor: 1.15 }, avoid: 'A line ran through a label: leave open space beside labelled lines.' },
  label_culled: { weight: { key: 'reach', factor: 1.08 }, avoid: 'A label had no free spot and was dropped: fewer labels, or more room around the labelled objects.' },
  text_small: { weight: { key: 'min_xh_px', delta: 0.2 }, avoid: 'Text had to shrink below phone size: fewer words in readouts, boxes and equations so they stay large.' },
  text_off_frame: { avoid: 'Text ran off the frame: keep readouts and labels short.' },
  sky_below_ground: { avoid: 'The sun or clouds ended up below the sea or land: give sky things an explicit "above" relation to the ground things.' },
}

export interface LayoutOutcome { patterns?: Record<string, number>; [k: string]: unknown }
export interface WeightRow { key: string; value: number; lo: number; hi: number }
export interface PatternRow { pattern: string; hits: number; adjusted_hits: number; adjustments: number }

/** One bounded step of a weight (pure; unit-tested). */
export function stepWeight(row: WeightRow, rule: NonNullable<LayoutRule['weight']>): number {
  const raw = rule.factor ? row.value * rule.factor : row.value + (rule.delta ?? 0)
  return Math.round(Math.min(row.hi, Math.max(row.lo, raw)) * 10000) / 10000
}

/** Which patterns are due for an adjustment after these hits (pure; unit-tested). */
export function duePatterns(rows: PatternRow[]): string[] {
  return rows.filter(r => r.hits - r.adjusted_hits >= RECUR).map(r => r.pattern)
}

/** Patterns a render's layout outcome shows (known ones only). */
export function patternsOf(layout: unknown): string[] {
  const p = (layout && typeof layout === 'object' ? (layout as LayoutOutcome).patterns : null) ?? {}
  return Object.entries(p).filter(([k, v]) => k in LAYOUT_RULES && Number(v) > 0).map(([k]) => k)
}

/**
 * Record a render's layout outcome; adjust weights and add avoid notes for patterns that recur. `hits` = how much this
 * outcome counts (1 per render; a confirmed learner report counts more). Never throws (learning is best effort).
 */
export async function learnFromLayout(admin: SupabaseClient, layout: unknown, hits = 1): Promise<{ recorded: string[]; adjusted: { pattern: string; key?: string; from?: number; to?: number }[] }> {
  const out = { recorded: [] as string[], adjusted: [] as { pattern: string; key?: string; from?: number; to?: number }[] }
  const pats = patternsOf(layout)
  if (!pats.length) return out
  try {
    const now = new Date().toISOString()
    const { data: existing } = await admin.from('scene_layout_patterns').select('pattern, hits, adjusted_hits, adjustments').in('pattern', pats)
    const byP = new Map(((existing ?? []) as PatternRow[]).map(r => [r.pattern, r]))
    const rows: PatternRow[] = pats.map(p => {
      const r = byP.get(p) ?? { pattern: p, hits: 0, adjusted_hits: 0, adjustments: 0 }
      return { ...r, hits: r.hits + hits }
    })
    const due = new Set(duePatterns(rows))
    const { data: wdata } = await admin.from('scene_layout_weights').select('key, value, lo, hi')
    const weights = new Map(((wdata ?? []) as WeightRow[]).map(w => [w.key, w]))
    const avoid: { kind: string; value: string; topic: string; reason: string }[] = []
    for (const r of rows) {
      const rule = LAYOUT_RULES[r.pattern]
      if (due.has(r.pattern)) {
        r.adjusted_hits = r.hits
        r.adjustments += 1
        const w = rule.weight ? weights.get(rule.weight.key) : undefined
        if (rule.weight && w) {
          const to = stepWeight(w, rule.weight)
          if (to !== w.value) {
            await admin.from('scene_layout_weights').update({ value: to, updated_at: now, note: `${r.pattern} recurred (${r.hits} renders)` }).eq('key', w.key)
            out.adjusted.push({ pattern: r.pattern, key: w.key, from: w.value, to })
            w.value = to
          } else out.adjusted.push({ pattern: r.pattern, key: w.key, from: w.value, to })
        } else out.adjusted.push({ pattern: r.pattern })
        avoid.push({ kind: 'clip_spec', value: rule.avoid, topic: LAYOUT_TOPIC, reason: `layout pattern ${r.pattern} recurred` })
      }
      out.recorded.push(r.pattern)
    }
    await admin.from('scene_layout_patterns').upsert(rows.map(r => ({ ...r, last_seen: now, ...(due.has(r.pattern) ? { last_adjusted: now } : {}) })), { onConflict: 'pattern' })
    if (avoid.length) {
      await admin.from('correctness_blocklist').upsert(avoid, { onConflict: 'kind,value,topic', ignoreDuplicates: true })
      clearBlocklistCache()
    }
  } catch (err) {
    console.warn('[layout-learning] skipped:', err instanceof Error ? err.message : err)
  }
  return out
}

/** What a new render gets: the learned solver weights and the scene writer's avoid notes. */
export async function layoutTuning(admin: SupabaseClient): Promise<{ weights: Record<string, number>; avoid: string[] }> {
  const weights: Record<string, number> = {}
  try {
    const { data } = await admin.from('scene_layout_weights').select('key, value')
    for (const w of (data ?? []) as { key: string; value: number }[]) if (Number.isFinite(Number(w.value))) weights[w.key] = Number(w.value)
  } catch { /* defaults in the engine */ }
  const avoid = (await loadBlocklist(admin).catch(() => [])).filter(r => r.kind === 'clip_spec' && r.topic === LAYOUT_TOPIC).slice(-8).map(r => r.value.slice(0, 240))
  return { weights, avoid }
}

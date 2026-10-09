/**
 * The shared item gate every writer uses (diagnostic bank, mastery check, practice set): parse → validate (accuracy,
 * cues, form, fairness, alignment, figure need) → draw the figure → balance keys. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { rawItems, type RawItem } from '../question-quality'
import { toPlainText } from '../math-text'
import { balanceKeys, rawSpec, setFindings, validateItem, type ItemContext, type ItemVerdict } from './validate'
import { renderItemFigure, withoutFigure } from './figure'
import type { AssessItem } from './spec'

export interface Rejected { raw: RawItem; problems: string[] }
export interface GateResult<T extends AssessItem> { good: T[]; rejected: Rejected[]; verdicts: ItemVerdict[] }

/** Raw model items with the spec's extra fields (figure, objective, why, calcs, …) and any extra keys (hint) kept. */
export function parseItems(raw: unknown): (RawItem & Partial<AssessItem> & Record<string, unknown>)[] {
  const list = Array.isArray(raw) ? raw : []
  const out: (RawItem & Partial<AssessItem> & Record<string, unknown>)[] = []
  for (const x of list) {
    const [r] = rawItems([x])
    if (!r || !x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    out.push({ ...r, ...rawSpec(o), ...(typeof o.hint === 'string' ? { hint: o.hint.slice(0, 300) } : {}), ...(typeof o.n === 'number' ? { n: o.n } : {}) })
  }
  return out
}

/**
 * Validate and draw a batch. An unneeded figure is dropped (the item becomes text-only) rather than losing the item;
 * a needed figure that cannot be drawn accurately rejects the item.
 */
export async function gateItems<T extends AssessItem = AssessItem>(raws: (RawItem & Partial<AssessItem> & Record<string, unknown>)[], ctx: ItemContext, opts: { admin?: SupabaseClient | null; trace?: string[]; render?: boolean } = {}): Promise<GateResult<T>> {
  const good: T[] = []
  const rejected: Rejected[] = []
  const verdicts: ItemVerdict[] = []
  await Promise.all(raws.map(async raw => {
    let src = raw
    let v = validateItem(src, ctx)
    const figOnly = v.findings.filter(f => f.severity === 'block').every(f => f.code === 'figure-unneeded' || f.code === 'figure-unreferenced')
    if (!v.ok && raw.figure && figOnly && v.findings.some(f => f.code === 'figure-unneeded')) { src = withoutFigure(raw); v = validateItem(src, ctx) }
    if (v.ok && v.item.figure && opts.render !== false) {
      const figProblems = await renderItemFigure(v.item, { admin: opts.admin, trace: opts.trace })
      if (figProblems.length) { v = { ...v, ok: false, problems: figProblems, findings: [...v.findings, ...figProblems.map(d => ({ code: 'figure-render', severity: 'block' as const, detail: d }))] } }
    }
    verdicts.push(v)
    if (v.ok) good.push({ ...src, ...v.item } as unknown as T)
    else rejected.push({ raw, problems: v.problems })
  }))
  return { good, rejected, verdicts }
}

/** Final set: no duplicate stems, keys spread over positions. */
export function finishSet<T extends AssessItem>(items: T[], seed?: number): T[] {
  const seen = new Set<string>()
  const uniq = items.filter(i => { const k = toPlainText(i.q).toLowerCase().replace(/\d+(\.\d+)?/g, '#'); if (seen.has(k)) return false; seen.add(k); return true })
  const out = balanceKeys(uniq, seed ?? uniq.length * 31 + 7)
  if (setFindings(out).some(f => f.severity === 'block')) return out.slice(0, Math.max(1, out.length - 1))
  return out
}

/** Re-ask feedback in the shape the writers already use. */
export function feedbackLines(rejected: Rejected[]): string {
  return rejected.slice(0, 8).map((r, i) => `${i + 1}. "${toPlainText(r.raw.q).slice(0, 140)}" - ${r.problems.slice(0, 3).join('; ')}`).join('\n')
}

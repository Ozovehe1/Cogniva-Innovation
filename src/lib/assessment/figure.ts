/**
 * Figures inside items (docs/design/assessment.md §7): rendered once on the server when the item is written, stored
 * with the item as a static SVG (or a library URL), and shown the same way in the diagnostic, mastery check, practice
 * set and re-check. Accuracy is checked here too: the graph spec validates and every point lies on the axes
 * (validate.ts), the Penrose layout meets every constraint (unmet === 0), a library illustration passes the
 * correctness guard's vision check (findIllustration → vetIllustration). Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { interactiveSvg, validateInteractive } from '../agent/interactive'
import { renderMathDiagram, type DiagramLibrary } from '../agent/math-diagram'
import { findIllustration } from '../illustrations/find'
import type { AssessItem, ItemFigure } from './spec'

/** Phone legibility: every text in a 640-wide figure at least 20 viewBox units (≈11 px on a 360-390 px screen). */
export function phoneSvg(svg: string, minFont = 20, scale = 1.5): string {
  return svg
    .replace(/font-size="(\d+(?:\.\d+)?)(px)?"/g, (_m, n: string) => `font-size="${Math.max(minFont, Math.round(Number(n) * scale))}"`)
    .replace(/font-size:\s*(\d+(?:\.\d+)?)px/g, (_m, n: string) => `font-size:${Math.max(minFont, Math.round(Number(n) * scale))}px`)
}

/** Draw a graph figure as a static, phone-legible SVG. */
export function graphSvg(spec0: Record<string, unknown>): { svg: string | null; error?: string } {
  const v = validateInteractive({ ...spec0, sliders: [{ name: 'zz', min: 0, max: 1, value: 0 }] })
  if (!v.spec) return { svg: null, error: v.errors[0] ?? 'invalid graph' }
  const spec = { ...v.spec, sliders: [], points: v.spec.points.map(p => ({ ...p, drag: false, color: p.color === 'clay' ? 'accent' as const : p.color })) }
  try { return { svg: phoneSvg(interactiveSvg(spec)) } } catch (err) { return { svg: null, error: err instanceof Error ? err.message : String(err) } }
}

/**
 * Render (or find) an item's figure in place. Returns blocking problems: an item whose figure cannot be drawn
 * accurately does not ship (the writer re-asks, or the item is dropped).
 */
export async function renderItemFigure(item: AssessItem, opts: { admin?: SupabaseClient | null; trace?: string[] } = {}): Promise<string[]> {
  const f = item.figure
  if (!f) return []
  if (('svg' in f && f.svg) || ('src' in f && f.src)) return []
  try {
    if (f.kind === 'graph') {
      const r = graphSvg(f.spec)
      if (!r.svg) return [`the graph cannot be drawn: ${r.error}`]
      f.svg = r.svg
      return []
    }
    if (f.kind === 'diagram') {
      const sub = f.substance.replace(/\\n/g, '\n').replace(/;\s*/g, '\n')
      let d = await renderMathDiagram(f.library as DiagramLibrary, sub, { timeoutMs: 8_000 })
      // A cold start can cut the layout search to one variation; once warm, try again before giving up.
      if (d.unmet > 0) d = await renderMathDiagram(f.library as DiagramLibrary, sub, { timeoutMs: 10_000 })
      if (d.unmet > 0) return [`the diagram's layout leaves ${d.unmet} constraint(s) unmet (it would be drawn wrongly)`]
      f.svg = phoneSvg(d.svg, 20, 1)
      return []
    }
    if (f.kind === 'illustration') {
      if (/\blabell?ed\s+[A-Z]\b|\bpart [A-Z]\b/.test(item.q)) return ['a library picture has no letter labels; use a diagram the question can point at, or name the part in words']
      const found = await findIllustration({ topic: f.topic, keywords: f.labels, want: 'diagram' }, opts.admin ?? null, opts.trace)
      if (!found) return [`no accurate library illustration of "${f.topic}" passed the picture check`]
      const named = (f.labels ?? []).filter(l => new RegExp(`\\b${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(item.q))
      if (named.length && !found.labelled) return [`the picture has no labels, but the question names ${named.join(', ')}`]
      if (found.url) f.src = found.url
      else f.svg = found.svg
      f.credit = found.creditText
      return []
    }
  } catch (err) {
    return [`the figure failed to render: ${(err instanceof Error ? err.message : String(err)).slice(0, 140)}`]
  }
  return []
}

/** Drop a figure an item does not need (the validator said so) instead of losing the item. */
export function withoutFigure<T extends AssessItem>(item: T): T { const { figure: _f, ...rest } = item; void _f; return rest as T }

export type { ItemFigure }

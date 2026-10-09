/**
 * The agent's visual tools, as data the chat renders inline. Everything is validated server-side:
 *  - board:    a mini whiteboard scene in the lesson Step schema (validateScript + maths gate + layout fix),
 *              played by the existing WhiteboardPlayer with Kokoro narration.
 *  - plot:     functions, points and data drawn with the board's own axes/function/point elements.
 *  - svg:      an illustration the model writes as SVG, rebuilt through a strict allowlist (no scripts, no
 *              event handlers, no external references); shown as an <img> data URI, so nothing in it can run.
 *  - sim:      a declarative simulation: sliders → expressions compiled by the board's safe parser (no eval).
 * Server only (the sim spec type is shared with the client).
 */
import { BOARD_H, BOARD_W, SCRIPT_SCHEMA_PROMPT, compileExpr, validateScript, type Step } from '../lesson-schema'
import { normalizeLessonMath } from '../lesson-math'
import { autoFixLayout } from '../lesson-layout'
import { LAYOUT_RULES, SHOW_DONT_TELL, TUTOR_VOICE } from '../lesson-ai'
import { chatJson } from './llm'

/* ───────────── Whiteboard scene ───────────── */

export const BOARD_MAX_STEPS = 16

/** Fill in a missing "type" on steps and cues from their keys (the most common model slip in scene JSON). */
function inferType(o: Record<string, unknown>): string | null {
  if (typeof o.type === 'string') return o.type
  if (o.vars && typeof o.vars === 'object') return 'set'
  if (typeof o.var === 'string') return 'animate'
  if (o.shape) return 'draw'
  if (typeof o.zoom === 'number') return 'camera'
  if (Array.isArray(o.targets)) return 'clear'
  if (typeof o.target === 'string') {
    if (typeof o.tex === 'string' || typeof o.text === 'string') return 'transform'
    if (Array.isArray(o.by) || Array.isArray(o.to)) return 'move'
    if (typeof o.by === 'number') return 'scale'
    if (typeof o.to === 'number') return 'fade'
    if (typeof o.color === 'string') return 'color'
    return 'highlight'
  }
  if (typeof o.tex === 'string') return 'math'
  if (typeof o.text === 'string') return 'write'
  return null
}
export function fillTypes(raw: unknown): unknown {
  const steps = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { steps?: unknown }).steps) ? (raw as { steps: unknown[] }).steps : null
  if (!steps) return raw
  for (const st of steps) {
    if (!st || typeof st !== 'object') continue
    const o = st as Record<string, unknown>
    const t = inferType(o); if (t) o.type = t
    if (Array.isArray(o.cues)) o.cues = o.cues.filter(c => c && typeof c === 'object').map(c => { const q = c as Record<string, unknown>; const ct = inferType(q); if (ct) q.type = ct; return q }).filter(q => typeof q.type === 'string')
  }
  return raw
}

export async function makeBoardScene(brief: string, learnerLine: string, trace?: string[]): Promise<{ steps: Step[]; repaired: boolean }> {
  const prompt = `Write a SHORT whiteboard scene (6 to 12 steps, about 40-70 seconds) that explains this, for one learner in a chat:
"""${brief.slice(0, 900)}"""
Learner: ${learnerLine || 'secondary-school level'}.
${SHOW_DONT_TELL}

${SCRIPT_SCHEMA_PROMPT}

${LAYOUT_RULES}
- Start with a title (write, size lg, y 30). Draw the picture first, then move/animate it while "say" explains.
- No "check" or "manim_clip" steps. Every step that teaches has a "say" (one or two short sentences).
- Every step AND every cue object has its "type".
Return {"steps": [...]} only.`
  const system = TUTOR_VOICE
  let raw = fillTypes(await chatJson(prompt, { system, maxTokens: 4000, trace }))
  let v = validateScript(raw, { maxSteps: BOARD_MAX_STEPS })
  let repaired = false
  if (!v.ok || v.steps.length < 3) {
    repaired = true
    raw = await chatJson(`${prompt}\n\nYour previous answer failed validation:\n${v.errors.slice(0, 10).join('\n') || 'too few valid steps'}\nPrevious answer:\n${JSON.stringify(raw).slice(0, 5000)}\nReturn a corrected {"steps": [...]} only.`, { system, maxTokens: 4000, trace }).then(fillTypes)
    v = validateScript(raw, { maxSteps: BOARD_MAX_STEPS })
  }
  // Keep only the steps that validate (validateScript drops invalid ones); refuse a scene with nothing to show.
  const steps = v.steps.filter(s => s.type !== 'check' && s.type !== 'manim_clip')
  if (steps.length < 2) throw new Error(`The board scene did not validate: ${v.errors.slice(0, 3).join('; ')}`)
  const norm = normalizeLessonMath(steps).steps
  return { steps: autoFixLayout(norm), repaired }
}

/* ───────────── Plot (board graph elements, no model call) ───────────── */

export interface PlotSpec {
  title?: string
  functions?: { expr: string; label?: string; color?: string; domain?: [number, number] }[]
  points?: { x: number; y: number; label?: string }[]
  series?: { label?: string; points: [number, number][]; color?: string }[]
  xRange?: [number, number]
  yRange?: [number, number]
  xLabel?: string
  yLabel?: string
  say?: string
}
const INKS = ['accent', 'clay', 'navy', 'amber', 'ink', 'muted']
const num = (v: unknown) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const t = v.replace(/[−–—]/g, '-').replace(/\s+/g, '')
  return t !== '' && Number.isFinite(Number(t)) ? Number(t) : null
}

export function buildPlot(spec: PlotSpec): { steps: Step[]; errors: string[]; roots?: Record<string, number[]>; xRange?: [number, number]; yRange?: [number, number] } {
  const errors: string[] = []
  const fns = (spec.functions ?? []).slice(0, 4).filter(f => {
    const e = String(f?.expr ?? '').replace(/^\s*y\s*=\s*/i, '').replace(/\*\*/g, '^')
    const c = compileExpr(e)
    if (!c.ok) { errors.push(`function "${f?.expr}": ${c.error}`); return false }
    f.expr = e
    return true
  })
  // Points: numbers (unicode minus accepted), duplicates at the same spot merged.
  const pts = (spec.points ?? []).slice(0, 12).filter(p => num(p?.x) !== null && num(p?.y) !== null).map(p => ({ ...p, x: num(p.x)!, y: num(p.y)! }))
    .filter((p, i, all) => all.findIndex(q => Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9) === i)
  const series = (spec.series ?? []).slice(0, 3).map(s => ({ ...s, points: (s?.points ?? []).filter(p => Array.isArray(p) && num(p[0]) !== null && num(p[1]) !== null).slice(0, 200) as [number, number][] })).filter(s => s.points.length >= 2)
  if (!fns.length && !pts.length && !series.length) errors.push('nothing to plot: give at least one valid function, point or series')
  // Ranges: given, or fitted to the data / function samples.
  let xr = Array.isArray(spec.xRange) && num(spec.xRange[0]) !== null && num(spec.xRange[1]) !== null && spec.xRange[0] < spec.xRange[1] ? [Number(spec.xRange[0]), Number(spec.xRange[1])] as [number, number] : null
  const allX = [...pts.map(p => Number(p.x)), ...series.flatMap(s => s.points.map(p => Number(p[0])))]
  // With a function, the default view is -5..5 widened to include the points; data alone is fitted to the data.
  if (!xr) xr = fns.length ? pad([Math.min(-5, ...allX), Math.max(5, ...allX)]) : allX.length ? pad([Math.min(...allX), Math.max(...allX)]) : [-5, 5]
  let yr = Array.isArray(spec.yRange) && num(spec.yRange[0]) !== null && num(spec.yRange[1]) !== null && spec.yRange[0] < spec.yRange[1] ? [Number(spec.yRange[0]), Number(spec.yRange[1])] as [number, number] : null
  if (!yr) {
    const ys = [...pts.map(p => Number(p.y)), ...series.flatMap(s => s.points.map(p => Number(p[1])))]
    for (const f of fns) {
      const c = compileExpr(f.expr)
      if (!c.ok) continue
      for (let i = 0; i <= 60; i++) { const x = xr[0] + (xr[1] - xr[0]) * i / 60; const y = c.fn(x); if (Number.isFinite(y) && Math.abs(y) < 1e6) ys.push(y) }
    }
    yr = ys.length ? pad([Math.min(...ys), Math.max(...ys)]) : [-5, 5]
  }
  if (errors.length && !fns.length && !pts.length && !series.length) return { steps: [], errors }
  const roots = computeRoots(fns, xr)
  // Marked points are checked against the curves, never trusted: a point that claims a root (y = 0) but is not on
  // any curve moves to an unmarked computed root; any other point off every curve is reported (data points may be).
  if (fns.length) {
    const compiled = fns.map(f => compileExpr(f.expr)).filter(c => c.ok) as { ok: true; fn: (x: number) => number }[]
    const tol = Math.max(1e-6, (yr[1] - yr[0]) * 0.01)
    const onCurve = (x: number, y: number) => compiled.some(c => { const v = c.fn(x); return Number.isFinite(v) && Math.abs(v - y) <= tol })
    const allRoots = Object.values(roots).flat()
    for (const p of pts) {
      if (onCurve(p.x, p.y)) continue
      if (Math.abs(p.y) <= tol && allRoots.length) {
        const free = allRoots.filter(r => !pts.some(q => q !== p && Math.abs(q.y) <= tol && Math.abs(q.x - r) < 1e-6))
        const pick = (free.length ? free : allRoots).reduce((a, b) => (Math.abs(b - p.x) < Math.abs(a - p.x) ? b : a))
        const old = `(${fmtNum(p.x)}, ${fmtNum(p.y)})`
        p.x = pick; p.y = 0
        if (p.label && /^\s*\(?\s*[-−\d.]+\s*,\s*[-−\d.]+\s*\)?\s*$/.test(String(p.label))) p.label = `(${fmtNum(pick)}, 0)`
        errors.push(`point ${old} claimed a root but is not on the curve; moved to the computed root (${fmtNum(pick)}, 0)`)
      } else {
        const vals = compiled.map(c => c.fn(p.x)).filter(Number.isFinite).map(fmtNum)
        errors.push(`point (${fmtNum(p.x)}, ${fmtNum(p.y)}) is not on the curve (there y = ${vals.join(' / ')}); call plot again if it should be`)
      }
    }
    // Merge points that now coincide.
    for (let i = pts.length - 1; i >= 0; i--) if (pts.findIndex(q => Math.abs(q.x - pts[i].x) < 1e-9 && Math.abs(q.y - pts[i].y) < 1e-9) !== i) pts.splice(i, 1)
  }
  // The y view always holds what the lesson is about: the marked points, the roots (y = 0) and each curve's turning
  // points and y-intercept. A fitted view that lets a steep tail squash those into a sliver is tightened around them.
  {
    const key: number[] = [...pts.map(p => p.y), ...series.flatMap(s => s.points.map(q => Number(q[1])))]
    for (const f of fns) {
      const c = compileExpr(f.expr)
      if (!c.ok) continue
      if ((roots[f.expr] ?? []).length) key.push(0)
      const y0 = c.fn(0); if (xr[0] <= 0 && xr[1] >= 0 && Number.isFinite(y0)) key.push(y0)
      const N = 400; let prev = c.fn(xr[0]), cur = c.fn(xr[0] + (xr[1] - xr[0]) / N)
      for (let i = 2; i <= N; i++) {
        const next = c.fn(xr[0] + (xr[1] - xr[0]) * i / N)
        if ([prev, cur, next].every(Number.isFinite) && ((cur < prev && cur <= next) || (cur > prev && cur >= next))) key.push(cur)
        prev = cur; cur = next
      }
    }
    if (key.length) {
      const lo = Math.min(...key), hi = Math.max(...key), span = Math.max(hi - lo, 2)
      if (spec.yRange && yr) {
        // A given range is widened (never narrowed) to show every key value.
        if (lo < yr[0] || hi > yr[1]) yr = pad([Math.min(lo, yr[0]), Math.max(hi, yr[1])])
        else if (fns.length && (yr[1] - yr[0]) > 6 * span) yr = [round(lo - 0.6 * span), round(hi + 1.6 * span)]
      } else if (fns.length && (yr[1] - yr[0]) > 3.5 * span) {
        yr = [round(lo - 0.6 * span), round(hi + 1.6 * span)]
      }
    }
  }
  const title = (spec.title ?? 'Graph').slice(0, 34)
  const steps: Step[] = [
    { type: 'write', id: 'title', text: title, x: 24, y: 28, size: 'lg', say: spec.say?.slice(0, 300) || undefined } as Step,
    // Tick numbers on both axes, so marked values (roots, vertex) can be read off the graph.
    { type: 'draw', id: 'ax', shape: { kind: 'axes', frame: { x: 70, y: 100, w: 640, h: 360 }, xRange: xr, yRange: yr, xStep: tickStep(xr[1] - xr[0], 10), yStep: tickStep(yr[1] - yr[0], 6), xLabel: spec.xLabel?.slice(0, 16), yLabel: spec.yLabel?.slice(0, 16) } } as Step,
  ]
  fns.forEach((f, i) => {
    steps.push({ type: 'draw', id: `f${i}`, on: 'ax', color: (INKS.includes(f.color ?? '') ? f.color : INKS[i % INKS.length]) as never, width: 3, shape: { kind: 'function', expr: f.expr, ...(Array.isArray(f.domain) && f.domain.length === 2 ? { domain: [Number(f.domain[0]), Number(f.domain[1])] } : {}) } } as Step)
    steps.push({ type: 'write', id: `fl${i}`, text: (f.label || `y = ${f.expr}`).slice(0, 40), x: 470, y: 100 + i * 32, size: 'sm', color: (INKS.includes(f.color ?? '') ? f.color : INKS[i % INKS.length]) as never } as Step)
  })
  series.forEach((s, i) => {
    steps.push({ type: 'draw', id: `s${i}`, on: 'ax', color: (INKS.includes(s.color ?? '') ? s.color : INKS[(i + 2) % INKS.length]) as never, width: 2.5, shape: { kind: 'polyline', points: s.points } } as Step)
    if (s.label) steps.push({ type: 'write', id: `sl${i}`, text: s.label.slice(0, 40), x: 470, y: 100 + (fns.length + i) * 32, size: 'sm' } as Step)
  })
  pts.forEach((p, i) => steps.push({ type: 'draw', id: `p${i}`, on: 'ax', color: 'clay', shape: { kind: 'point', at: [Number(p.x), Number(p.y)], ...(p.label ? { label: String(p.label).slice(0, 20) } : {}) } } as Step))
  const v = validateScript(steps, { maxSteps: 60 })
  return { steps: v.steps, errors: [...errors, ...v.errors], roots, xRange: xr, yRange: yr }
}
/** Exact real roots of each function in the x view (sign changes + bisection), for the model to quote and the points to snap to. */
function computeRoots(fns: { expr: string }[], xr: [number, number]): Record<string, number[]> {
  const roots: Record<string, number[]> = {}
  for (const f of fns) {
    const c = compileExpr(f.expr)
    if (!c.ok) continue
    const out: number[] = []
    const N = 800
    let px = xr[0], py = c.fn(px)
    for (let i = 1; i <= N; i++) {
      const x = xr[0] + (xr[1] - xr[0]) * i / N, y = c.fn(x)
      if (Number.isFinite(py) && Number.isFinite(y)) {
        if (py === 0) out.push(px)
        else if (py * y < 0) { let lo = px, hi = x; for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (c.fn(lo) * c.fn(m) <= 0) hi = m; else lo = m } out.push((lo + hi) / 2) }
      }
      px = x; py = y
    }
    roots[f.expr] = [...new Set(out.map(r => Number(r.toPrecision(8))))].slice(0, 10)
  }
  return roots
}
/** A 1-2-5 step giving about `count` ticks over `span`. */
export function tickStep(span: number, count: number): number {
  const raw = span / count
  if (!(raw > 0)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p
  return Number(((m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p).toPrecision(6))
}
const fmtNum = (v: number) => String(Number(v.toPrecision(6)))
function pad([a, b]: [number, number]): [number, number] {
  if (a === b) { a -= 1; b += 1 }
  const d = (b - a) * 0.08
  return [round(a - d), round(b + d)]
}
const round = (v: number) => Number(v.toPrecision(3))

/* ───────────── SVG illustration (allowlist sanitiser) ───────────── */

const SVG_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'marker', 'lineargradient', 'radialgradient', 'stop', 'title', 'desc', 'clippath'])
const SVG_ATTRS = new Set([
  'viewbox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'id',
  'marker-end', 'marker-start', 'markerwidth', 'markerheight', 'refx', 'refy', 'orient', 'markerunits', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'clip-path', 'dx', 'dy',
  'xmlns', 'preserveaspectratio', 'letter-spacing', 'fill-rule', 'clip-rule', 'gradienttransform', 'x1', 'fx', 'fy',
])
const CASE: Record<string, string> = { viewbox: 'viewBox', lineargradient: 'linearGradient', radialgradient: 'radialGradient', clippath: 'clipPath', markerwidth: 'markerWidth', markerheight: 'markerHeight', refx: 'refX', refy: 'refY', markerunits: 'markerUnits', gradientunits: 'gradientUnits', preserveaspectratio: 'preserveAspectRatio', gradienttransform: 'gradientTransform' }
const esc = (s: string) => s.replace(/&(?!(amp|lt|gt|quot|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;')

/** Rebuild an SVG from allowed tags and attributes only. Returns null when there is no usable <svg>. */
export function sanitizeSvg(input: string): { svg: string | null; removed: string[] } {
  const removed: string[] = []
  const src = String(input ?? '').slice(0, 60_000).replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, () => { removed.push('cdata'); return '' })
  const start = src.search(/<svg[\s>]/i)
  if (start < 0) return { svg: null, removed: ['no <svg> element'] }
  const tokenRe = /<\/?([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+)/g
  const out: string[] = []
  const stack: string[] = []
  let skipDepth = 0
  let m: RegExpExecArray | null
  tokenRe.lastIndex = start
  while ((m = tokenRe.exec(src))) {
    const [whole, rawTag, attrs, selfClose, text] = m
    if (text !== undefined) { if (!skipDepth && stack.length) out.push(esc(text.replace(/&nbsp;/g, ' '))); continue }
    const tag = rawTag.toLowerCase().replace(/^svg:/, '')
    const closing = whole.startsWith('</')
    const allowed = SVG_TAGS.has(tag)
    if (closing) {
      if (!allowed) { if (skipDepth) skipDepth--; continue }
      if (skipDepth) continue
      const i = stack.lastIndexOf(tag)
      if (i >= 0) while (stack.length > i) { const t = stack.pop()!; out.push(`</${CASE[t] ?? t}>`) }
      if (!stack.length) break
      continue
    }
    if (!allowed) { removed.push(tag); if (!selfClose && !/^(br|img|image|use)$/.test(tag)) skipDepth++; continue }
    if (skipDepth) continue
    const kept: string[] = []
    const attrRe = /([^\s=>/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
    let a: RegExpExecArray | null
    while ((a = attrRe.exec(attrs ?? ''))) {
      const name = a[1].toLowerCase()
      const val = (a[3] ?? a[4] ?? a[5] ?? '').trim()
      if (!SVG_ATTRS.has(name)) { removed.push(`@${name}`); continue }
      // Only local references (url(#id)); never javascript:, data:, or external URLs.
      if (/url\s*\(/i.test(val) && !/^url\(\s*#[\w-]+\s*\)$/i.test(val)) { removed.push(`@${name}=url`); continue }
      if (/javascript:|data:|expression\(|@import|<|>/i.test(val)) { removed.push(`@${name}`); continue }
      kept.push(`${CASE[name] ?? name}="${escAttr(val).slice(0, 4000)}"`)
    }
    if (tag === 'svg' && !stack.length && !kept.some(k => k.startsWith('xmlns='))) kept.push('xmlns="http://www.w3.org/2000/svg"')
    out.push(`<${CASE[tag] ?? tag}${kept.length ? ' ' + kept.join(' ') : ''}${selfClose ? '/>' : '>'}`)
    if (!selfClose) stack.push(tag)
  }
  while (stack.length) { const t = stack.pop()!; out.push(`</${CASE[t] ?? t}>`) }
  const svg = out.join('')
  if (!/^<svg[\s>]/.test(svg)) return { svg: null, removed }
  return { svg: svg.length > 50_000 ? null : svg, removed: [...new Set(removed)] }
}

export async function makeIllustration(brief: string, trace?: string[]): Promise<{ svg: string; removed: string[]; alt: string }> {
  const prompt = `Draw a clean, labelled teaching diagram as a single SVG for: """${brief.slice(0, 800)}"""
Composition: use the WHOLE viewBox: the main subject spans 60-80% of the width and is centred; leave a clear margin of 24 for labels. Every label sits in empty space next to what it names (offset 8-14 px from the line or arrow tip, with a thin leader line if needed); no label may overlap a shape, an arrow or another label. Arrows are long enough to read (60-140 px).
Style: editorial and calm on a white background: thin ink lines (#14141A, stroke-width 2), deep green (#1F4D3A) for the key idea, warm clay (#A4502A) for contrast, navy (#23406A) and amber (#8A5A00) as extra colours, light fills only (opacity 0.12-0.2). Font: font-family="Inter, sans-serif", labels 14-18px, never overlapping lines or each other. viewBox="0 0 640 400". Arrows via a <marker> in <defs>. Physically and scientifically correct proportions and labels.
Allowed elements only: svg g path rect circle ellipse line polyline polygon text tspan defs marker linearGradient radialGradient stop title desc clipPath. No <style>, <script>, <image>, <foreignObject>, <use>, no CSS, no event attributes, no external links.
Return JSON {"alt": one-sentence description, "svg": "<svg ...>...</svg>"}.`
  const raw = await chatJson(prompt, { maxTokens: 5000, trace }) as { svg?: unknown; alt?: unknown }
  const s = sanitizeSvg(typeof raw?.svg === 'string' ? raw.svg : '')
  if (!s.svg) throw new Error('The illustration was not a usable SVG')
  return { svg: s.svg, removed: s.removed, alt: typeof raw?.alt === 'string' ? raw.alt.slice(0, 300) : brief.slice(0, 200) }
}

/* ───────────── Simulation (declarative, no code) ───────────── */

export interface SimSpec {
  title: string
  params: { name: string; label: string; min: number; max: number; step: number; value: number; unit?: string }[]
  /** Readouts computed from the params. */
  outputs: { label: string; expr: string; unit?: string; digits?: number }[]
  /** Curves y = f(x; params) drawn on axes. */
  plot?: { xLabel?: string; yLabel?: string; xRange: [number, number]; yRange: [number, number]; curves: { expr: string; label?: string }[] }
  /** A dot that moves along a parametric path (x(t), y(t)) as time plays, for motion demos. */
  motion?: { x: string; y: string; tMax: string; label?: string; anchor?: [string, string] }
  explain?: string
}

/** Validate and normalise a simulation spec. Every expression must compile with only its declared names. */
export function validateSim(input: unknown): { spec: SimSpec | null; errors: string[] } {
  const errors: string[] = []
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  // Slider names with digits or underscores (theta0, v_0) are renamed to letters everywhere instead of rejected.
  const renames = new Map<string, string>()
  for (const p of Array.isArray(o.params) ? o.params : []) {
    const n = String((p as Record<string, unknown> | null)?.name ?? '')
    if (/^[a-zA-Z][a-zA-Z0-9_]{0,11}$/.test(n) && /[0-9_]/.test(n)) {
      let alias = n.replace(/_/g, '').replace(/\d/g, d => 'abcdefghij'[Number(d)]).slice(0, 12)
      while ([...renames.values()].includes(alias) || (Array.isArray(o.params) && o.params.some(q => String((q as Record<string, unknown> | null)?.name) === alias))) alias = `${alias.slice(0, 11)}z`
      renames.set(n, alias)
    }
  }
  const ren = (e: unknown) => (renames.size && typeof e === 'string' ? e.replace(/\b[a-zA-Z][a-zA-Z0-9_]*\b/g, w => renames.get(w) ?? w) : e)
  const params = (Array.isArray(o.params) ? o.params : []).slice(0, 5).flatMap((p, i) => {
    const q = (p ?? {}) as Record<string, unknown>
    const name = String(ren(String(q.name ?? '')))
    if (!/^[a-zA-Z]{1,12}$/.test(name) || ['x', 'e', 'pi', 't'].includes(name)) { errors.push(`params[${i}].name "${name}" must be letters only (not x, e, pi or t)`); return [] }
    const min = num(q.min), max = num(q.max)
    if (min === null || max === null || min >= max) { errors.push(`params[${i}] needs min < max`); return [] }
    const step = num(q.step) ?? (max - min) / 100
    const value = Math.min(max, Math.max(min, num(q.value) ?? (min + max) / 2))
    return [{ name, label: String(q.label ?? name).slice(0, 40), min, max, step: step > 0 ? step : (max - min) / 100, value, unit: q.unit ? String(q.unit).slice(0, 12) : undefined }]
  })
  if (!params.length) errors.push('at least one slider param is required')
  const names = params.map(p => p.name)
  const check = (expr: unknown, at: string, extra: string[] = [], allowX = false) => {
    const e = String(ren(expr) ?? '').replace(/\*\*/g, '^').trim()
    const c = compileExpr(e, [...names, ...extra], allowX)
    if (!c.ok) { errors.push(`${at} "${e}": ${c.error}`); return null }
    return e
  }
  const outputs = (Array.isArray(o.outputs) ? o.outputs : []).slice(0, 4).flatMap((x, i) => {
    const q = (x ?? {}) as Record<string, unknown>
    const expr = check(q.expr, `outputs[${i}].expr`)
    return expr ? [{ label: String(q.label ?? `Output ${i + 1}`).slice(0, 40), expr, unit: q.unit ? String(q.unit).slice(0, 12) : undefined, digits: Math.min(6, Math.max(0, num(q.digits) ?? 3)) }] : []
  })
  let plot: SimSpec['plot']
  if (o.plot && typeof o.plot === 'object') {
    const q = o.plot as Record<string, unknown>
    const xr = Array.isArray(q.xRange) ? q.xRange.map(Number) : []
    const yr = Array.isArray(q.yRange) ? q.yRange.map(Number) : []
    const curves = (Array.isArray(q.curves) ? q.curves : []).slice(0, 3).flatMap((c, i) => {
      const cc = (c ?? {}) as Record<string, unknown>
      const expr = check(cc.expr, `plot.curves[${i}].expr`, [], true)
      // A curve label that only repeats the y-axis title is dropped ("Angle (rad)" shown twice).
      const lab = cc.label ? String(cc.label).slice(0, 30) : undefined
      return expr ? [{ expr, label: lab && q.yLabel && lab.trim().toLowerCase() === String(q.yLabel).trim().toLowerCase() ? undefined : lab }] : []
    })
    if (xr.length === 2 && yr.length === 2 && xr.every(Number.isFinite) && yr.every(Number.isFinite) && xr[0] < xr[1] && yr[0] < yr[1] && curves.length) {
      plot = { xRange: [xr[0], xr[1]], yRange: [yr[0], yr[1]], curves, xLabel: q.xLabel ? String(q.xLabel).slice(0, 16) : undefined, yLabel: q.yLabel ? String(q.yLabel).slice(0, 16) : undefined }
    } else errors.push('plot needs xRange, yRange (min < max) and at least one valid curve')
  }
  let motion: SimSpec['motion']
  if (o.motion && typeof o.motion === 'object') {
    const q = o.motion as Record<string, unknown>
    const x = check(q.x, 'motion.x', ['t']), y = check(q.y, 'motion.y', ['t']), tMax = check(q.tMax, 'motion.tMax')
    const an = Array.isArray(q.anchor) && q.anchor.length === 2 ? [check(String(q.anchor[0]), 'motion.anchor[0]'), check(String(q.anchor[1]), 'motion.anchor[1]')] : null
    if (x && y && tMax) motion = { x, y, tMax, label: q.label ? String(q.label).slice(0, 20) : undefined, ...(an && an[0] && an[1] ? { anchor: [an[0], an[1]] as [string, string] } : {}) }
    if (motion && !plot) errors.push('motion needs a plot (its axes)')
  }
  if (!outputs.length && !plot) errors.push('give at least one output or a plot')
  if (errors.length && (!params.length || (!outputs.length && !plot))) return { spec: null, errors }
  return { spec: { title: String(o.title ?? 'Simulation').slice(0, 60), params, outputs, plot, motion: plot ? motion : undefined, explain: o.explain ? String(o.explain).slice(0, 400) : undefined }, errors }
}

export const BOARD_SIZE = { w: BOARD_W, h: BOARD_H }

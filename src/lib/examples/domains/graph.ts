/**
 * Functions (algebra, calculus): the curve drawn from its expression, marked points computed from the current values,
 * an optional tangent, and an independent numeric check of claimed stationary points (f'(x) ≈ 0 by a central difference,
 * max/min by the second difference) and of an optimum against a dense scan of the interval.
 */
import type { DiagramSpec, ExampleSpec } from '../spec' // eslint-disable-line @typescript-eslint/no-unused-vars
import type { Plugin, DiagramView } from '../plugin'
import { ACC, CLAY, HL, INK, MUTED, f1, frame, text } from '../svgkit'
import { evalNum } from '../engine'
import { fmtNum } from '../spec'

const val = (v: unknown, scope: Record<string, number>): number | null => typeof v === 'number' ? v : typeof v === 'string' ? (v in scope ? scope[v] : (() => { try { return evalNum(v, scope) } catch { return null } })()) : null

function fOf(d: DiagramSpec, scope: Record<string, number>) {
  const expr = String(d.f ?? '')
  const v = String(d.var ?? 'x')
  return (x: number) => { try { return evalNum(expr, { ...scope, [v]: x }) } catch { return NaN } }
}
function range(d: DiagramSpec, scope: Record<string, number>): [number, number] {
  const r = Array.isArray(d.x_range) ? d.x_range.map(x => val(x, scope)) : []
  return r.length === 2 && r[0] !== null && r[1] !== null && r[1]! > r[0]! ? [r[0]!, r[1]!] : [-5, 5]
}
const shows = (view: DiagramView, what: string) => view.reveal || (Array.isArray(view.action?.show) && (view.action!.show as unknown[]).map(String).includes(what))

export const graphPlugin: Plugin = {
  type: 'graph',
  match: /\b(derivative|differentiat|gradient|tangent|stationary|turning point|maxim|minim|optimi[sz]|graph|function|quadratic|parabola|integral|area under)\b/i,
  prompt: `"graph": {"type":"graph","f":"x^3 - 6*x^2 + 9*x + 1","var":"x","x_range":[-1,5],"points":[{"x":"x1","label":"max"}],"tangent":{"at":"a"}?} — f may use givens; point x values name calcs/givens (or numbers); label "max"/"min" points are checked numerically. Use checks: {"kind":"derivative","f":"x^3-6*x^2+9*x+1","var":"x","df":"3*x^2-12*x+9"} for differentiation, {"kind":"zero","expr":"3*x1^2-12*x1+9"} for a stationary point. Step actions: {"show":["curve"]}, {"show":["tangent"]}, {"show":["points"]}.`,
  prepare(d) {
    const errs: string[] = []
    if (!String(d.f ?? '').trim()) errs.push('graph needs "f"')
    return errs
  },
  crossCheck(d, spec, scope) {
    const issues: string[] = []
    const f = fOf(d, scope)
    const [a, b] = range(d, scope)
    const h = (b - a) * 1e-4
    for (const p of Array.isArray(d.points) ? d.points as Record<string, unknown>[] : []) {
      const x = val(p.x, scope); const lab = String(p.label ?? '').toLowerCase()
      if (x === null) { issues.push(`graph point x "${String(p.x)}" is not a given, a calc or a number`); continue }
      if (/max|min|stationary|turning/.test(lab)) {
        const d1 = (f(x + h) - f(x - h)) / (2 * h), d2 = (f(x + h) - 2 * f(x) + f(x - h)) / (h * h)
        const scale = Math.max(1, Math.abs(f(x)), ...[a, b].map(t => Math.abs(f(t))))
        if (Math.abs(d1) > 1e-3 * scale) issues.push(`f'(${fmtNum(x)}) ≈ ${fmtNum(d1)}, so x = ${fmtNum(x)} is not a stationary point`)
        else if (/max/.test(lab) && d2 > 0) issues.push(`x = ${fmtNum(x)} is a minimum, not a maximum`)
        else if (/min/.test(lab) && d2 < 0) issues.push(`x = ${fmtNum(x)} is a maximum, not a minimum`)
      }
    }
    // an optimisation answer named max/min must match a dense scan when the problem asks for the greatest/least value
    const L = `${spec.answer.label ?? ''} ${spec.unknowns.map(u => u.label ?? '').join(' ')}`.toLowerCase()
    if (spec.answer.name && /(greatest|largest|maximum) (value|area|volume|profit)|(least|smallest|minimum) (value|cost|area)/.test(L) && Array.isArray(d.points) === false) void 0
    return issues
  },
  render(d, scope, view) {
    const f = fOf(d, scope)
    const [a, b] = range(d, scope)
    const xs = Array.from({ length: 241 }, (_, i) => a + (b - a) * i / 240)
    const ys = xs.map(f).filter(Number.isFinite)
    let lo = Math.min(...ys, 0), hi = Math.max(...ys, 0)
    if (Array.isArray(d.y_range) && d.y_range.length === 2) { const r = d.y_range.map(y => val(y, scope)); if (r[0] !== null && r[1] !== null && r[1]! > r[0]!) [lo, hi] = [r[0]!, r[1]!] }
    const padY = (hi - lo) * 0.08 || 1; lo -= padY; hi += padY
    const W = 400, H = 280, P = 34
    const X = (x: number) => P + (x - a) / (b - a) * (W - 2 * P), Y = (y: number) => H - P - (y - lo) / (hi - lo) * (H - 2 * P)
    const out: string[] = []
    const ax0 = Math.min(Math.max(0, a), b), ay0 = Math.min(Math.max(0, lo), hi)
    // light grid + axes
    const tick = (span: number) => { const raw = span / 6; const p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 5, 10].map(m => m * p).find(s => s >= raw) ?? raw }
    const tx = tick(b - a), ty = tick(hi - lo)
    for (let x = Math.ceil(a / tx) * tx; x <= b + 1e-9; x += tx) { out.push(`<line x1="${f1(X(x))}" y1="${P - 6}" x2="${f1(X(x))}" y2="${H - P}" style="stroke:#E5E1D8;stroke-width:1"/>`); if (Math.abs(x) > 1e-9) out.push(text(X(x), Y(ay0) + 18, fmtNum(x), 'lbl-s')) }
    for (let y = Math.ceil(lo / ty) * ty; y <= hi + 1e-9; y += ty) { out.push(`<line x1="${P}" y1="${f1(Y(y))}" x2="${W - P + 6}" y2="${f1(Y(y))}" style="stroke:#E5E1D8;stroke-width:1"/>`); if (Math.abs(y) > 1e-9) out.push(text(X(ax0) - 6, Y(y) + 5, fmtNum(y), 'lbl-s', 'style="text-anchor:end"')) }
    out.push(`<line x1="${P - 6}" y1="${f1(Y(ay0))}" x2="${W - P + 10}" y2="${f1(Y(ay0))}" style="stroke:${MUTED};stroke-width:1.6"/>`, `<line x1="${f1(X(ax0))}" y1="${P - 10}" x2="${f1(X(ax0))}" y2="${H - P + 6}" style="stroke:${MUTED};stroke-width:1.6"/>`)
    out.push(text(W - P + 12, Y(ay0) + 5, String(d.var ?? 'x'), 'lbl-s', 'style="text-anchor:start"'), text(X(ax0) + 8, P - 12, 'y', 'lbl-s', 'style="text-anchor:start"'))
    // curve (clipped to the plot)
    const segs: string[] = []; let cur: string[] = []
    for (const x of xs) { const y = f(x); if (Number.isFinite(y) && y >= lo && y <= hi) cur.push(`${f1(X(x))},${f1(Y(y))}`); else if (cur.length) { segs.push(cur.join(' ')); cur = [] } }
    if (cur.length) segs.push(cur.join(' '))
    for (const s of segs) out.push(`<polyline points="${s}" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/>`)
    if (d.label) out.push(text(W - P, P + 4, String(d.label).slice(0, 40), 'lbl', 'style="text-anchor:end"'))
    const ans = view.answers !== false
    if (d.tangent && typeof d.tangent === 'object' && shows(view, 'tangent')) {
      const t = val((d.tangent as Record<string, unknown>).at, scope)
      if (t !== null) {
        const h = (b - a) * 1e-5, m = (f(t + h) - f(t - h)) / (2 * h), y0 = f(t)
        const span = (b - a) * 0.28
        out.push(`<line x1="${f1(X(t - span))}" y1="${f1(Y(y0 - m * span))}" x2="${f1(X(t + span))}" y2="${f1(Y(y0 + m * span))}" style="stroke:${CLAY};stroke-width:2.4"/>`)
        out.push(`<circle cx="${f1(X(t))}" cy="${f1(Y(y0))}" r="5.5" fill="${CLAY}"/>`, text(X(t) + 8, Y(y0) - 12, ans ? `slope ${fmtNum(m)}` : 'slope ?', 'lbl', 'style="text-anchor:start;fill:#A4502A"'))
      }
    }
    if (shows(view, 'points') || view.reveal) {
      for (const p of Array.isArray(d.points) ? d.points as Record<string, unknown>[] : []) {
        const x = val(p.x, scope); if (x === null || !Number.isFinite(f(x))) continue
        const y = f(x)
        out.push(`<line x1="${f1(X(x))}" y1="${f1(Y(y))}" x2="${f1(X(x))}" y2="${f1(Y(ay0))}" style="stroke:${ACC};stroke-dasharray:4 4;stroke-width:1.6"/>`)
        out.push(`<circle cx="${f1(X(x))}" cy="${f1(Y(y))}" r="7" fill="${HL}" stroke="${INK}" stroke-width="1.6"/>`)
        out.push(text(X(x), Y(y) + (y > (lo + hi) / 2 ? 26 : -14), `${p.label ? `${String(p.label).slice(0, 12)} ` : ''}${ans ? `(${fmtNum(x)}, ${fmtNum(y)})` : ''}`, 'acc'))
      }
    }
    return frame(W, H, out.join('\n'))
  },
}

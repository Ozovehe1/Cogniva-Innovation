/**
 * Function, secant and tangent: y = f(x) with a point P at x = a and a second point Q at a + h. The secant PQ, its
 * rise/run triangle and slope Δy/Δx; as h → 0 the secant turns into the tangent and its slope becomes f′(a) (central
 * difference, exact to ~1e-6). The strip below draws f′(x) with a marker at a, so the derivative is seen as a graph.
 */
import { arrowHead, font, halo, num, stageBackground, type KindRuntime, type Params } from '../engine'
import { compileFx } from '../expr'
import { axes, curve, point } from '../primitives'
import { NL } from '../tokens'
import type { KindInfo } from '../types'

export const TANGENT_INFO: KindInfo = {
  id: 'tangent',
  blurb: 'function / derivative: y = f(x) (expr), point P at x = a, secant to Q at a + h with rise/run, h → 0 turns it into the tangent (slope = f′(a)); strip graphs f′(x); drag P along the curve',
  params: {
    expr: { type: 'expr', default: 'x^3/3 - x', label: 'f(x)' },
    a: { type: 'number', min: -10, max: 10, default: -1.6, step: 0.01, label: 'Point P at x =' },
    h: { type: 'number', min: 0, max: 3, default: 1.6, step: 0.01, label: 'Gap h to Q' },
    x_min: { type: 'number', min: -20, max: 0, default: -2.6, label: 'x from' },
    x_max: { type: 'number', min: 0.5, max: 20, default: 2.6, label: 'x to' },
    show_derivative: { type: 'bool', default: true, label: "Graph f'(x) below" },
  },
  targets: ['curve', 'point', 'secant', 'tangent', 'triangle', 'slope', 'derivative'],
  dragParam: 'a',
  example: {
    title: 'From secant to tangent: the derivative',
    params: { expr: 'x^3/3 - x', a: -1.6, h: 1.6 },
    beats: [
      { do: 'reveal', target: 'curve', dur: 1.2, caption: 'The curve y = x³/3 − x' },
      { do: 'highlight', target: 'triangle', dur: 1.8, caption: 'Secant slope = rise ÷ run' },
      { do: 'move', param: 'h', to: 0, dur: 2.6, caption: 'Shrink the gap: secant becomes tangent' },
      { do: 'move', param: 'a', to: 1.8, dur: 3.2, caption: 'Slide P: the slope is the derivative' },
      { do: 'pulse', target: 'derivative', dur: 1.6, caption: "Below: the slope at each x is f'(x)" },
    ],
    controls: [{ param: 'a' }, { param: 'h' }],
    labels: [],
    drag: true,
    alt: 'A curve with a secant line through two points; as the second point slides onto the first, the secant becomes the tangent and its slope is the derivative, graphed below.',
  },
}

interface S { f: (x: number) => number; key: string; ylo: number; yhi: number; dlo: number; dhi: number }

const fnOf = (P: Params) => compileFx(String(P.expr ?? 'x^2')) ?? ((x: number) => x * x)
const D = (f: (x: number) => number, x: number) => (f(x + 1e-4) - f(x - 1e-4)) / 2e-4

function ranges(P: Params) {
  const f = fnOf(P), x0 = num(P, 'x_min'), x1 = num(P, 'x_max')
  let lo = Infinity, hi = -Infinity, dlo = Infinity, dhi = -Infinity
  for (let i = 0; i <= 200; i++) {
    const x = x0 + (x1 - x0) * i / 200, y = f(x), d = D(f, x)
    if (Number.isFinite(y) && Math.abs(y) < 1e4) { lo = Math.min(lo, y); hi = Math.max(hi, y) }
    if (Number.isFinite(d) && Math.abs(d) < 1e4) { dlo = Math.min(dlo, d); dhi = Math.max(dhi, d) }
  }
  if (!Number.isFinite(lo)) { lo = -1; hi = 1 }
  const pad = Math.max(0.4, (hi - lo) * 0.14)
  return { f, ylo: Math.min(lo - pad, -0.3), yhi: Math.max(hi + pad, 0.3), dlo: Math.min(dlo, 0), dhi: Math.max(dhi, 0) }
}

const fmt = (x: number) => (Math.abs(x) < 0.005 ? '0.00' : x.toFixed(2))

export const tangent: KindRuntime<S> = {
  info: TANGENT_INFO,
  aspect: 0.72,
  stretch: true,
  plot: P => (P.show_derivative === false ? 0 : 0.3),
  world: P => { const r = ranges(P); return { x0: num(P, 'x_min'), x1: num(P, 'x_max'), y0: r.ylo, y1: r.yhi } },
  init: P => { const r = ranges(P); return { ...r, key: String(P.expr) } },
  step: (s, P) => { if (String(P.expr) !== s.key) Object.assign(s, ranges(P), { key: String(P.expr) }) },
  draw: (c, s, P, v, fx) => {
    stageBackground(c, v, 0.5, 0.4)
    const x0 = num(P, 'x_min'), x1 = num(P, 'x_max'), f = s.f
    const box = { x0, x1, y0: s.ylo, y1: s.yhi }
    const span = x1 - x0
    axes(c, v.X, v.Y, box, { step: span > 12 ? 2 : span > 5 ? 1 : 0.5, labelStep: span > 12 ? 4 : span > 5 ? 1 : 1 })
    const cr = fx.reveal('curve'), ce = fx.emph('curve')
    curve(c, f, v.X, v.Y, x0, x1, { color: NL.field, w: 2.6 + ce, glow: 8 + 10 * ce, upto: x0 + span * cr, ylim: [s.ylo, s.yhi] })
    const a = Math.max(x0, Math.min(x1, num(P, 'a'))), h = num(P, 'h')
    const ya = f(a)
    const m = D(f, a)
    // Secant (h > small) and its rise/run triangle.
    const sr = fx.reveal('secant')
    const xq = Math.min(x1, a + h), yq = f(xq)
    const ms = h > 0.004 ? (yq - ya) / (xq - a) : m
    const se = fx.emph('secant'), tr = fx.emph('triangle')
    const lineAt = (slope: number, color: string, w: number, glowB: number, alpha: number) => {
      const L = span * 0.42
      c.save(); c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = w; c.shadowColor = color; c.shadowBlur = glowB; c.lineCap = 'round'
      const xa = Math.max(x0, a - L), xb = Math.min(x1, a + L)
      c.beginPath(); c.moveTo(v.X(xa), v.Y(ya + slope * (xa - a))); c.lineTo(v.X(xb), v.Y(ya + slope * (xb - a))); c.stroke(); c.restore()
    }
    const tanness = Math.max(0, 1 - h / 0.25) // 1 when Q has merged with P
    if (h > 0.004 && sr > 0.02) {
      lineAt(ms, 'rgba(232,236,243,0.85)', 1.8 + se, 4 + 8 * se, sr * (1 - tanness * 0.7))
      // Triangle: run (horizontal) then rise (vertical), dashed, with Δx/Δy.
      const ta = Math.max(sr * 0.9, tr)
      if (h > 0.12 && ta > 0.02) {
        c.save(); c.globalAlpha = ta; c.setLineDash([4, 4]); c.lineWidth = 1.6 + tr
        c.strokeStyle = NL.field; c.beginPath(); c.moveTo(v.X(a), v.Y(ya)); c.lineTo(v.X(xq), v.Y(ya)); c.stroke()
        c.strokeStyle = NL.gold; c.beginPath(); c.moveTo(v.X(xq), v.Y(ya)); c.lineTo(v.X(xq), v.Y(yq)); c.stroke()
        c.setLineDash([]); font(c, 11, 700); c.textBaseline = 'middle'
        c.fillStyle = NL.field; c.textAlign = 'center'; c.fillText('Δx', (v.X(a) + v.X(xq)) / 2, v.Y(ya) + (yq > ya ? 11 : -11))
        c.fillStyle = NL.gold; c.textAlign = 'left'; c.fillText('Δy', v.X(xq) + 6, (v.Y(ya) + v.Y(yq)) / 2)
        c.restore()
      }
      point(c, v.X(xq), v.Y(yq), { color: NL.text, r: 5 })
    }
    // Tangent: appears as the gap closes (or when it is the target).
    const te = fx.emph('tangent'), trv = fx.reveal('tangent')
    const ta2 = Math.max(tanness, te) * trv
    if (ta2 > 0.02) lineAt(m, NL.gold, 2.6 + te, 10 + 12 * te, ta2)
    // P.
    const pe = fx.emph('point')
    point(c, v.X(a), v.Y(ya), { color: NL.gold, r: 6.5, emph: pe })
    // Slope readout chip next to P (kept inside the stage).
    const sl = h > 0.004 ? ms : m
    const txt = h > 0.004 && tanness < 1 ? `secant slope ${fmt(sl)}` : `slope f′(${a.toFixed(1)}) = ${fmt(m)}`
    font(c, 12, 700)
    const w = c.measureText(txt).width + 16
    let lx = v.X(a) + 12, ly = v.Y(ya) + (m > 0 ? 14 : -36)
    if (lx + w > v.W - 6) lx = v.X(a) - 12 - w
    ly = Math.max(v.top + 2, Math.min(v.SH - 26, ly))
    const sE = fx.emph('slope')
    if (sE > 0) halo(c, lx + w / 2, ly + 11, w * 0.7, NL.goldRgb, sE)
    c.fillStyle = 'rgba(14,19,34,0.85)'; c.strokeStyle = tanness >= 1 ? 'rgba(255,209,102,0.6)' : 'rgba(255,255,255,0.18)'; c.lineWidth = 1
    c.beginPath(); c.roundRect(lx, ly, w, 22, 11); c.fill(); c.stroke()
    c.fillStyle = tanness >= 1 ? NL.gold : NL.text; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(txt, lx + 8, ly + 11.5)
  },
  anchors: (s, P, v) => {
    const f = s.f, a = num(P, 'a'), h = num(P, 'h'), x0 = num(P, 'x_min'), x1 = num(P, 'x_max')
    const xc = x0 + (x1 - x0) * 0.85
    return {
      curve: { x: v.X(xc), y: v.Y(f(xc)), r: 4 },
      point: { x: v.X(a), y: v.Y(f(a)), r: 8 },
      secant: { x: v.X(Math.min(x1, a + h)), y: v.Y(f(Math.min(x1, a + h))), r: 6 },
      tangent: { x: v.X(a), y: v.Y(f(a)), r: 8 },
      triangle: { x: v.X(a + h / 2), y: v.Y(f(a)), r: 4 },
      slope: { x: v.X(a), y: v.Y(f(a)), r: 30 },
      derivative: { x: v.W / 2, y: v.SH - 4, r: 2 },
    }
  },
  hit: (s, P, v, x, y) => { const a = num(P, 'a'); return Math.hypot(x - v.X(a), y - v.Y(s.f(a))) < 34 },
  drag: (s, P, v, x) => Math.max(num(P, 'x_min'), Math.min(num(P, 'x_max'), v.ix(x))),
  readouts: (s, P) => {
    const a = num(P, 'a'), h = num(P, 'h'), f = s.f
    const ms = h > 0.004 ? (f(a + h) - f(a)) / h : D(f, a)
    return [
      { label: 'x at P', value: a.toFixed(2), color: NL.text },
      { label: h > 0.004 ? 'Secant slope Δy/Δx' : 'Tangent slope', value: fmt(ms), color: NL.text },
      { label: "f'(x) at P", value: fmt(D(f, a)), color: NL.gold },
    ]
  },
  drawPlot: (c, s, P, v, fx) => {
    const x0 = num(P, 'x_min'), x1 = num(P, 'x_max'), f = s.f
    const y0 = v.SH + 22, H = v.PH - 30
    const lo = s.dlo, hi = s.dhi, span = Math.max(1e-6, hi - lo)
    const X = (x: number) => v.X(x), Y = (d: number) => y0 + H - (d - lo) / span * H
    const de = fx.emph('derivative'), dr = fx.reveal('derivative')
    c.save(); c.globalAlpha = Math.max(0.2, dr)
    font(c, 11.5, 600); c.textBaseline = 'top'; c.textAlign = 'left'
    c.fillStyle = NL.gold; c.fillText("f'(x): the slope at every x", 12, v.SH + 6)
    if (lo <= 0 && hi >= 0) { c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1; c.beginPath(); c.moveTo(X(x0), Y(0)); c.lineTo(X(x1), Y(0)); c.stroke() }
    const a = num(P, 'a')
    c.strokeStyle = 'rgba(255,209,102,0.35)'; c.lineWidth = 1.5; c.beginPath()
    for (let i = 0; i <= 160; i++) { const x = x0 + (x1 - x0) * i / 160; const yy = Y(D(f, x)); if (i) c.lineTo(X(x), yy); else c.moveTo(X(x), yy) }
    c.stroke()
    // The part already swept by P glows.
    c.strokeStyle = NL.gold; c.lineWidth = 2.4 + de; c.shadowColor = NL.gold; c.shadowBlur = 8 + 10 * de; c.beginPath()
    for (let i = 0; i <= 160; i++) { const x = x0 + (Math.min(x1, Math.max(x0, a)) - x0) * i / 160; const yy = Y(D(f, x)); if (i) c.lineTo(X(x), yy); else c.moveTo(X(x), yy) }
    c.stroke(); c.shadowBlur = 0
    point(c, X(a), Y(D(f, a)), { color: NL.gold, r: 4.5 })
    c.restore()
    void arrowHead
  },
  yourTurn: 'Your turn: drag P along the curve',
}

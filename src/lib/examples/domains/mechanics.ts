/**
 * Mechanics setups: a projectile and a block on an incline. Each has its own small solver (closed-form kinematics /
 * Newton's second law along the slope) that re-derives the answer independently of the model's steps, and an SVG
 * drawn to scale from the current values.
 */
import type { DiagramSpec, ExampleSpec } from '../spec'
import type { Plugin, DiagramView } from '../plugin'
import { ACC, CLAY, HL, INK, MUTED, arrow, f1, frame, text } from '../svgkit'
import { fmtNum } from '../spec'

/** A diagram field is a given's name or a number. */
export function ref(d: DiagramSpec, key: string, scope: Record<string, number>, dflt?: number): number {
  const v = d[key]
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v in scope) return scope[v]
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v)
  if (dflt !== undefined) return dflt
  throw new Error(`diagram.${key} must be a given's name or a number`)
}
const shows = (view: DiagramView, what: string) => view.reveal || (Array.isArray(view.action?.show) && (view.action!.show as unknown[]).map(String).includes(what))
const near = (a: number, b: number) => Math.abs(a - b) <= 0.015 * Math.max(Math.abs(a), Math.abs(b), 1e-9)
const lbl = (spec: ExampleSpec) => `${spec.answer.label ?? ''} ${spec.unknowns.map(u => `${u.label ?? ''} ${u.name}`).join(' ')} ${spec.answer.name ?? ''}`.toLowerCase()

/* ───────── projectile ───────── */

function projectile(d: DiagramSpec, scope: Record<string, number>) {
  const u = ref(d, 'u', scope), th = ref(d, 'angle', scope), h0 = ref(d, 'h0', scope, 0), g = ref(d, 'g', scope, 9.8)
  if (!(u > 0) || !(g > 0) || th < -89 || th > 90 || h0 < 0) throw new Error('projectile needs u > 0, g > 0, 0 ≤ h0 and -89° < angle ≤ 90°')
  const r = th * Math.PI / 180
  const ux = u * Math.cos(r), uy = u * Math.sin(r)
  const tH = Math.max(0, uy / g)
  const H = h0 + uy * uy / (2 * g) * (uy > 0 ? 1 : 0)
  const T = (uy + Math.sqrt(uy * uy + 2 * g * h0)) / g
  return { u, th, h0, g, ux, uy, tH, H, T, R: ux * T }
}

export const projectilePlugin: Plugin = {
  type: 'projectile',
  match: /\b(projectile|launched|thrown|kicked|fired|trajectory|range|horizontally|cliff|cannon|ball is (thrown|kicked))\b/i,
  prompt: `"projectile": {"type":"projectile","u":"u","angle":"theta","h0":"h"?,"g":"g"} — each field names a given (or is a number). Angle in degrees above horizontal (0 = thrown horizontally). Code solves it independently: facts proj_ux, proj_uy, proj_tH (time to top), proj_H (max height above ground), proj_T (time of flight), proj_R (range). Use sind/cosd for degrees in calc. Step diagram actions: {"show":["components"]} velocity components, {"show":["apex"]} the top, {"show":["range"]}, {"show":["path"]} the ball flying.`,
  facts(d, scope) { const p = projectile(d, scope); return { proj_ux: p.ux, proj_uy: p.uy, proj_tH: p.tH, proj_H: p.H, proj_T: p.T, proj_R: p.R } },
  crossCheck(d, spec, scope, answer) {
    if (answer === null) return []
    const p = projectile(d, scope)
    const L = lbl(spec)
    const cands: [RegExp, number[]][] = [[/range|horizontal distance|how far/, [p.R]], [/max(imum)? height|highest|how high/, [p.H, p.H - p.h0]], [/time of flight|in the air|how long|time to land|hits the ground/, [p.T]], [/time to (reach )?(the )?(top|max)/, [p.tH]]]
    for (const [re, vals] of cands) if (re.test(L) && !vals.some(v => near(v, answer))) return [`the projectile solver gives ${vals.map(v => fmtNum(v)).join(' or ')} for this, but the steps give ${fmtNum(answer)}`]
    return []
  },
  render(d, scope, view) {
    const p = projectile(d, scope)
    const W = 400, H0 = 250, PAD = 30
    const xmax = Math.max(p.R, 1e-6), ymax = Math.max(p.H, p.h0, 1e-6)
    const sx = (W - 2 * PAD - 20) / xmax, sy = (H0 - 2 * PAD - 40) / ymax
    const s = Math.min(sx, sy * 3, sx)
    const syy = Math.min(sy, s * 3)
    const X = (x: number) => PAD + 10 + x * s, Y = (y: number) => H0 - PAD - y * syy
    const pts: string[] = []
    for (let i = 0; i <= 60; i++) { const t = p.T * i / 60; pts.push(`${f1(X(p.ux * t))},${f1(Y(p.h0 + p.uy * t - 0.5 * p.g * t * t))}`) }
    const ans = view.answers !== false
    const b: string[] = []
    b.push(`<line x1="${PAD - 10}" y1="${f1(Y(0))}" x2="${W - 8}" y2="${f1(Y(0))}" style="stroke:${MUTED};stroke-width:2"/>`)
    for (let x = PAD; x < W - 8; x += 14) b.push(`<line x1="${x}" y1="${f1(Y(0) + 1)}" x2="${x - 7}" y2="${f1(Y(0) + 8)}" style="stroke:${MUTED};stroke-width:1.2"/>`)
    if (p.h0 > 0) b.push(`<rect x="${PAD - 10}" y="${f1(Y(p.h0))}" width="${f1(X(0) - PAD + 10)}" height="${f1(Y(0) - Y(p.h0))}" fill="#E9E2D3" stroke="${MUTED}" stroke-width="1.5"/>`, text(PAD + 2, Y(p.h0 / 2) + 5, `${fmtNum(p.h0)} m`, 'lbl-s', 'style="text-anchor:start"'))
    b.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="6 6"/>`)
    // launch velocity
    const L0 = 62, r = p.th * Math.PI / 180
    const x0 = X(0), y0 = Y(p.h0)
    b.push(arrow(x0, y0, x0 + L0 * Math.cos(r), y0 - L0 * Math.sin(r), CLAY, 3, 11))
    b.push(text(x0 + L0 * Math.cos(r) + 6, y0 - L0 * Math.sin(r) - 6, `u = ${fmtNum(p.u)} m/s`, 'lbl', 'style="text-anchor:start;fill:#A4502A"'))
    if (p.th !== 0) { b.push(`<path d="M${f1(x0 + 30)},${f1(y0)} A30,30 0 0 0 ${f1(x0 + 30 * Math.cos(r))},${f1(y0 - 30 * Math.sin(r))}" fill="none" stroke="${INK}" stroke-width="1.6"/>`, text(x0 + 40, y0 - 6, `${fmtNum(p.th)}°`, 'lbl-s', 'style="text-anchor:start"')) }
    if (shows(view, 'components')) {
      b.push(arrow(x0, y0, x0 + L0 * Math.cos(r), y0, ACC, 2.4, 9), text(x0 + L0 * Math.cos(r) / 2 + 4, y0 + 20, ans ? `uₓ = ${fmtNum(p.ux)}` : 'uₓ', 'acc'))
      if (p.th !== 0) b.push(arrow(x0, y0, x0, y0 - L0 * Math.sin(r), ACC, 2.4, 9), text(x0 + 8, y0 - L0 * Math.sin(r) - 4, ans ? `u_y = ${fmtNum(p.uy)}` : 'u_y', 'acc', 'style="text-anchor:start"'))
    }
    if (shows(view, 'apex') && p.uy > 0) {
      const ax = X(p.ux * p.tH), ay = Y(p.H)
      b.push(`<circle cx="${f1(ax)}" cy="${f1(ay)}" r="6" fill="${HL}" stroke="${INK}" stroke-width="1.5"/>`, `<line x1="${f1(ax)}" y1="${f1(ay)}" x2="${f1(ax)}" y2="${f1(Y(0))}" style="stroke:${ACC};stroke-dasharray:5 5;stroke-width:1.8"/>`)
      b.push(text(ax + 8, (ay + Y(0)) / 2, ans ? `H = ${fmtNum(p.H)} m` : 'H = ?', 'acc', 'style="text-anchor:start"'), text(ax, ay - 12, 'v_y = 0 at the top', 'lbl-s'))
    }
    if (shows(view, 'range')) {
      const yR = Y(0) + 44
      b.push(arrow(X(0) + 30, yR, X(p.R), yR, ACC, 2, 8), arrow(X(p.R) - 30, yR, X(0), yR, ACC, 2, 8), `<rect x="${f1((X(0) + X(p.R)) / 2 - 58)}" y="${f1(yR - 11)}" width="116" height="22" fill="#FBF8F2"/>`, text((X(0) + X(p.R)) / 2, yR + 6, ans ? `R = ${fmtNum(p.R)} m` : 'R = ?', 'acc'))
    }
    const ball = `<circle cx="${f1(x0)}" cy="${f1(y0)}" r="8" fill="${INK}"/>`
    if (shows(view, 'path') && !view.static) b.push(`<circle r="8" fill="${INK}"><animateMotion dur="${Math.min(4, Math.max(1.5, p.T)).toFixed(2)}s" repeatCount="indefinite" path="M${pts.join(' L')}"/></circle>`)
    else b.push(ball)
    if (ans && view.reveal) b.push(`<circle cx="${f1(X(p.R))}" cy="${f1(Y(0))}" r="5" fill="${ACC}"/>`)
    return frame(W, H0 + 30, b.join('\n'))
  },
}

/* ───────── incline ───────── */

function incline(d: DiagramSpec, scope: Record<string, number>) {
  const m = ref(d, 'm', scope), th = ref(d, 'angle', scope), g = ref(d, 'g', scope, 9.8), mu = ref(d, 'mu', scope, 0)
  if (!(m > 0) || !(th > 0 && th < 90) || mu < 0) throw new Error('incline needs m > 0, 0 < angle < 90 and mu ≥ 0')
  const r = th * Math.PI / 180
  const W = m * g, N = W * Math.cos(r), Wpar = W * Math.sin(r), fmax = mu * N
  const slides = Wpar > fmax
  const f = slides ? fmax : Wpar
  const a = slides ? (Wpar - fmax) / m : 0
  return { m, th, g, mu, W, N, Wpar, f, a, slides }
}

export const inclinePlugin: Plugin = {
  type: 'incline',
  match: /\b(incline|inclined plane|slope|ramp|free[- ]body|friction|normal (force|reaction))\b/i,
  prompt: `"incline": {"type":"incline","m":"m","angle":"theta","mu":"mu"?,"g":"g"} — a block on a fixed slope (fields name givens or are numbers; angle in degrees; mu = kinetic friction coefficient, omit for smooth). Code solves Newton's 2nd law along/perpendicular to the slope: facts inc_W (weight), inc_N (normal force), inc_Wpar (weight component down the slope), inc_f (friction), inc_a (acceleration down the slope, 0 if it does not slide). Step actions: {"show":["forces"]}, {"show":["components"]}, {"show":["accel"]}.`,
  facts(d, scope) { const p = incline(d, scope); return { inc_W: p.W, inc_N: p.N, inc_Wpar: p.Wpar, inc_f: p.f, inc_a: p.a } },
  crossCheck(d, spec, scope, answer) {
    if (answer === null) return []
    const p = incline(d, scope); const L = lbl(spec)
    const cands: [RegExp, number[]][] = [[/accel/, [p.a]], [/normal/, [p.N]], [/friction/, [p.f]], [/weight\b(?!.*component)/, [p.W]]]
    for (const [re, vals] of cands) if (re.test(L) && !vals.some(v => near(v, answer))) return [`Newton's second law along the slope gives ${vals.map(v => fmtNum(v)).join(' or ')} here, but the steps give ${fmtNum(answer)}`]
    return []
  },
  render(d, scope, view) {
    const p = incline(d, scope)
    const ans = view.answers !== false
    const W = 400, H = 280
    const r = p.th * Math.PI / 180
    const baseL = 330, x0 = 30, y0 = H - 30
    const hgt = Math.min(baseL * Math.tan(r), H - 70), bl = hgt / Math.tan(r)
    const xb = x0 + bl
    const b: string[] = []
    b.push(`<polygon points="${f1(x0)},${f1(y0)} ${f1(xb)},${f1(y0)} ${f1(xb)},${f1(y0 - hgt)}" fill="#EFE8DA" stroke="${INK}" stroke-width="2.2"/>`)
    b.push(`<path d="M${f1(x0 + 40)},${f1(y0)} A40,40 0 0 0 ${f1(x0 + 40 * Math.cos(r))},${f1(y0 - 40 * Math.sin(r))}" fill="none" stroke="${INK}" stroke-width="1.5"/>`, text(x0 + 50, y0 - 8, `${fmtNum(p.th)}°`, 'lbl-s', 'style="text-anchor:start"'))
    // block centred at 55% up the slope
    const s = 0.55, cxs = x0 + bl * s, cys = y0 - hgt * s
    const bw = 58, bh = 38
    const nx = -Math.sin(r), ny = -Math.cos(r) // outward normal (screen coords)
    const cx = cxs + nx * bh / 2, cy = cys + ny * bh / 2
    b.push(`<g transform="translate(${f1(cx)},${f1(cy)}) rotate(${f1(-p.th)})"><rect x="${-bw / 2}" y="${-bh / 2}" width="${bw}" height="${bh}" rx="3" fill="#D9CDB4" stroke="${INK}" stroke-width="2.2"/><text x="0" y="6" class="lbl">${fmtNum(p.m)} kg</text></g>`)
    const scale = 70 / p.W
    const fl = (v: number) => Math.max(26, v * scale)
    const showF = view.step >= 0 && (shows(view, 'forces') || shows(view, 'components') || shows(view, 'accel') || view.reveal)
    const v = (x: number) => ans ? ` = ${fmtNum(x)} N` : ''
    if (showF) {
      b.push(arrow(cx, cy, cx, cy + fl(p.W), INK, 2.8, 10), text(cx + 8, cy + fl(p.W) + 4, `W${v(p.W)}`, 'lbl', 'style="text-anchor:start"'))
      b.push(arrow(cx, cy, cx + nx * fl(p.N), cy + ny * fl(p.N), ACC, 2.8, 10), text(cx + nx * fl(p.N) - 6, cy + ny * fl(p.N) - 6, `N${v(p.N)}`, 'acc', 'style="text-anchor:end"'))
      if (p.f > 1e-9) { const ux = Math.cos(r), uy = -Math.sin(r); b.push(arrow(cx + ux * 30, cy + uy * 30, cx + ux * (30 + fl(p.f)), cy + uy * (30 + fl(p.f)), CLAY, 2.8, 10), text(cx + ux * (34 + fl(p.f)) + 4, cy + uy * (34 + fl(p.f)), `f${v(p.f)}`, 'lbl', 'style="text-anchor:start;fill:#A4502A"')) }
    }
    if (shows(view, 'components')) {
      const ux = -Math.cos(r), uy = Math.sin(r) // down the slope
      b.push(arrow(cx, cy, cx + ux * fl(p.Wpar), cy + uy * fl(p.Wpar), CLAY, 2, 8), text(cx + ux * fl(p.Wpar) - 4, cy + uy * fl(p.Wpar) + 18, `W sinθ${v(p.Wpar)}`, 'lbl-s', 'style="text-anchor:end"'))
      b.push(`<line x1="${f1(cx)}" y1="${f1(cy)}" x2="${f1(cx - nx * fl(p.N))}" y2="${f1(cy - ny * fl(p.N))}" style="stroke:${MUTED};stroke-dasharray:4 4;stroke-width:1.8"/>`)
    }
    if (shows(view, 'accel') && p.a > 0) {
      const ux = -Math.cos(r), uy = Math.sin(r)
      const ax = cx - nx * 60, ay = cy - ny * 60
      b.push(arrow(ax, ay, ax + ux * 50, ay + uy * 50, '#8A5A00', 3, 10), text(ax + ux * 50 - 6, ay + uy * 50 + 20, ans ? `a = ${fmtNum(p.a)} m/s²` : 'a = ?', 'lbl', 'style="text-anchor:end;fill:#8A5A00"'))
    }
    return frame(W, H, b.join('\n'))
  },
}

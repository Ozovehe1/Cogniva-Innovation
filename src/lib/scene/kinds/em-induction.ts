/**
 * Electromagnetic induction: a bar magnet moving through a coil. Real physics: the magnet is two poles ±q; flux
 * through each turn is the solid-angle share of each pole's flux (+1 inside the magnet's body); EMF = −dΦ/dt; the
 * galvanometer needle is a damped spring; field lines are traced from the real field and particles advect along it.
 * Without the coil (show_coil=false) it is the bar magnet's field on its own.
 */
import { glow, halo, num, rng, stageBackground, trace, type KindRuntime, type Params } from '../engine'
import { coilHalf, fieldLine, legend, magnet, meter, streaks, trace2, wire, type Particle, type Pt } from '../primitives'
import { NL } from '../tokens'
import type { KindInfo } from '../types'

export const EM_INFO: KindInfo = {
  id: 'em_induction',
  blurb: 'bar magnet moving in/out of a coil: real field lines, flux, induced current (galvanometer swings), live flux/EMF graph; show_coil=false = a bar magnet\'s field alone',
  params: {
    magnet_x: { type: 'number', min: -4.2, max: 3.6, default: -3.4, label: 'Magnet position' },
    turns: { type: 'number', min: 4, max: 14, default: 9, step: 1, label: 'Turns on the coil' },
    strength: { type: 'number', min: 0.5, max: 2, default: 1, label: 'Magnet strength' },
    show_coil: { type: 'bool', default: true, label: 'Show the coil and meter' },
  },
  targets: ['magnet', 'coil', 'field', 'meter', 'graph'],
  dragParam: 'magnet_x',
  example: {
    title: 'A moving magnet makes a current',
    params: { magnet_x: -3.4, turns: 9 },
    beats: [
      { do: 'reveal', target: 'field', dur: 1.6, caption: "A magnet's field loops from N round to S" },
      { do: 'move', param: 'magnet_x', to: 2.4, dur: 2.6, caption: 'Push it in: flux through the coil rises' },
      { do: 'hold', dur: 1.6, caption: 'Magnet still: flux steady, no current' },
      { do: 'move', param: 'magnet_x', to: -3.4, dur: 1.1, caption: 'Pull out fast: bigger current, other way' },
      { do: 'pulse', target: 'meter', dur: 1.4, caption: 'Current depends on how fast flux changes' },
    ],
    controls: [],
    labels: [{ target: 'coil', text: 'coil' }],
    drag: true,
    alt: 'A bar magnet is pushed into a coil and pulled out; a meter swings one way, then the other, only while it moves.',
  },
}

const COIL = { x: 2.4, R: 0.85, L: 2.2 }
const MAG = { L: 1.8, T: 0.55 }
const d = MAG.L / 2 - 0.12

function B(x: number, y: number, m: number): [number, number] {
  const ax = x - (m + d), bx = x - (m - d)
  const ra = (ax * ax + y * y) ** 1.5 + 1e-6, rb = (bx * bx + y * y) ** 1.5 + 1e-6
  return [ax / ra - bx / rb, y / ra - y / rb]
}
function loopFlux(xk: number, m: number) {
  const part = (xq: number, q: number) => { const dz = xk - xq; return q * 0.5 * (1 - Math.abs(dz) / Math.hypot(dz, COIL.R)) * Math.sign(dz) }
  let f = part(m + d, 1) + part(m - d, -1)
  if (xk > m - d && xk < m + d) f += 1
  return f
}
const turnsX = (n: number) => Array.from({ length: n }, (_, k) => COIL.x - COIL.L / 2 + COIL.L * (k + 0.5) / n)
const flux = (m: number, n: number, k: number) => turnsX(n).reduce((a, xk) => a + loopFlux(xk, m), 0) * k

/** Field lines relative to the magnet's centre (traced once). */
const LINES: Pt[][] = (() => {
  const out: Pt[][] = []
  const n = 14
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) / n * 2 * Math.PI
    out.push(trace((x, y) => B(x, y, 0), d + 0.18 * Math.cos(a), 0.18 * Math.sin(a), { h: 0.05, n: 900, stop: (x, y) => Math.hypot(x + d, y) < 0.16 || Math.abs(x) > 11 || Math.abs(y) > 8 }))
  }
  return out
})()

interface S { m: number; prevM: number; phi: number; emf: number; needle: number; nv: number; phase: number; hist: [number, number, number][]; t: number; ps: Particle[]; r: () => number; dir: number }

function spawn(s: S, p: Particle, anywhere: boolean) {
  if (anywhere) { const L = LINES[Math.floor(s.r() * LINES.length)]; const k = Math.floor(s.r() * L.length); p.x = L[k][0] + (s.r() - 0.5) * 0.25; p.y = L[k][1] + (s.r() - 0.5) * 0.25 }
  else { const a = s.r() * 2 * Math.PI; p.x = d + 0.2 * Math.cos(a); p.y = 0.2 * Math.sin(a) }
  p.life = 0; p.max = 2 + s.r() * 3; p.px = p.x; p.py = p.y
  return p
}

const showCoil = (P: Params) => P.show_coil !== false

export const emInduction: KindRuntime<S> = {
  info: EM_INFO,
  aspect: 0.7,
  plot: P => (showCoil(P) ? 0.26 : 0),
  world: P => (showCoil(P) ? { x0: -5, x1: 5, y0: -2.25, y1: 2.0 } : { x0: -3.6, x1: 3.6, y0: -2.2, y1: 2.2 }),
  init: P => {
    const m = num(P, 'magnet_x')
    const s: S = { m, prevM: m, phi: flux(m, num(P, 'turns'), num(P, 'strength')), emf: 0, needle: 0, nv: 0, phase: 0, hist: [], t: 0, ps: [], r: rng(7), dir: 0 }
    for (let i = 0; i < 170; i++) s.ps.push(spawn(s, { x: 0, y: 0, px: 0, py: 0, life: 0, max: 1 }, true))
    s.ps.forEach(p => { p.life = s.r() * p.max })
    return s
  },
  step: (s, P, dt) => {
    s.prevM = s.m
    s.m = showCoil(P) ? num(P, 'magnet_x') : 0
    const n = Math.round(num(P, 'turns')), k = num(P, 'strength')
    const phi = flux(s.m, n, k), raw = -(phi - s.phi) / Math.max(1e-4, dt)
    s.phi = phi
    s.emf += (raw - s.emf) * Math.min(1, dt * 14)
    const target = Math.max(-70, Math.min(70, s.emf * 9 / Math.max(0.6, n / 9)))
    s.nv += ((target - s.needle) * 60 - s.nv * 9) * dt
    s.needle += s.nv * dt
    s.phase += s.emf * dt * 2.2 / Math.max(0.6, n / 9)
    s.t += dt
    s.dir = Math.abs(s.m - s.prevM) > 1e-4 ? Math.sign(s.m - s.prevM) : 0
    s.hist.push([s.t, phi, s.emf]); while (s.hist.length && s.hist[0][0] < s.t - 9) s.hist.shift()
    for (const p of s.ps) {
      const [u, v] = B(p.x, p.y, 0); const r = Math.hypot(u, v) || 1; const sp = (0.55 + 0.9 * Math.min(1, r ** 0.35)) * Math.min(1.4, 0.7 + 0.3 * k)
      p.px = p.x; p.py = p.y; p.x += dt * sp * u / r; p.y += dt * sp * v / r; p.life += dt
      if (p.life > p.max || Math.hypot(p.x + d, p.y) < 0.2 || Math.abs(p.x) > 7 || Math.abs(p.y) > 5) spawn(s, p, false)
    }
  },
  draw: (c, s, P, v, fx) => {
    stageBackground(c, v)
    const coil = showCoil(P)
    const n = Math.round(num(P, 'turns'))
    const xs = turnsX(n).map(v.X), rx = Math.max(4, 0.16 * COIL.R * v.u), ry = COIL.R * v.u, cy = v.Y(0)
    const coilA = fx.reveal('coil'), I = s.emf / 3 / Math.max(0.6, n / 9)
    if (coil && coilA > 0) { c.save(); c.globalAlpha = coilA; coilHalf(c, xs, cy, rx, ry, false); c.restore() }
    // Field: lines (revealed by drawing along), then particles flowing along them.
    const fr = fx.reveal('field'), fe = fx.emph('field')
    const X = (x: number) => v.X(x + s.m)
    for (const L of LINES) fieldLine(c, L, X, v.Y, { reveal: fr, at: 0.35, color: fe > 0.05 ? `rgba(160,205,255,${0.3 + 0.4 * fe})` : NL.fieldLine, w: 1.5 + fe })
    if (fr > 0.3 && !fx.reduced) streaks(c, s.ps, X, v.Y, { alpha: Math.min(1, (fr - 0.3) / 0.5) * Math.min(1.3, num(P, 'strength')) })
    // Magnet (glows when emphasised), with a motion arrow while it moves.
    const me = fx.emph('magnet')
    if (me > 0) halo(c, v.X(s.m), cy, MAG.L * v.u, NL.goldRgb, me)
    magnet(c, v.X(s.m), cy, MAG.L * v.u, MAG.T * v.u, { alpha: fx.reveal('magnet') })
    if (s.dir) {
      const ay = cy - MAG.T * v.u / 2 - 12, x0 = v.X(s.m) - s.dir * 12, x1 = v.X(s.m) + s.dir * (MAG.L * v.u / 2 + 6)
      c.strokeStyle = NL.text; c.lineWidth = 2.2; c.beginPath(); c.moveTo(x0, ay); c.lineTo(x1, ay); c.stroke()
      c.fillStyle = NL.text; c.beginPath(); c.moveTo(x1 + s.dir * 7, ay); c.lineTo(x1 - s.dir * 2, ay - 5); c.lineTo(x1 - s.dir * 2, ay + 5); c.fill()
    }
    if (!coil) return
    if (coilA > 0) {
      c.save(); c.globalAlpha = coilA
      const ce = fx.emph('coil')
      if (ce > 0) halo(c, v.X(COIL.x), cy, COIL.L * v.u, NL.goldRgb, ce)
      coilHalf(c, xs, cy, rx, ry, true, { current: I, phase: s.phase })
      // Leads down to the meter.
      const R = Math.min(30, v.u * 0.62), mcx = (xs[0] + xs[xs.length - 1]) / 2, mcy = Math.min(v.SH - R - 8, cy + ry + R + 14)
      const yb = cy + ry
      wire(c, [[xs[0], yb], [xs[0], mcy], [mcx - R, mcy]], { current: I, phase: s.phase, w: 2.4 })
      wire(c, [[xs[xs.length - 1], yb], [xs[xs.length - 1], mcy], [mcx + R, mcy]], { current: I, phase: -s.phase, w: 2.4 })
      meter(c, mcx, mcy, R, s.needle, { emph: Math.max(fx.emph('meter'), Math.min(1, Math.abs(I)) * 0.6), letter: 'G' })
      c.restore()
    }
  },
  anchors: (s, P, v) => {
    const n = Math.round(num(P, 'turns')), xs = turnsX(n).map(v.X), cy = v.Y(0), ry = COIL.R * v.u
    const R = Math.min(30, v.u * 0.62), mcx = (xs[0] + xs[xs.length - 1]) / 2, mcy = Math.min(v.SH - R - 8, cy + ry + R + 14)
    return {
      magnet: { x: v.X(s.m), y: cy, r: MAG.L * v.u / 2 },
      coil: { x: v.X(COIL.x), y: cy - ry, r: 6 },
      field: { x: v.X(s.m), y: v.Y(1.25), r: 4 },
      meter: { x: mcx, y: mcy, r: R },
      graph: { x: v.W / 2, y: v.SH - 6, r: 2 },
    }
  },
  keepouts: (s, P, v) => {
    const cy = v.Y(0), ry = COIL.R * v.u
    return [
      { x: v.X(s.m) - MAG.L * v.u / 2, y: cy - MAG.T * v.u / 2 - 18, w: MAG.L * v.u, h: MAG.T * v.u + 18 },
      { x: v.X(COIL.x - COIL.L / 2) - 8, y: cy - ry, w: COIL.L * v.u + 16, h: 2 * ry },
      ...(showCoil(P) ? [{ x: v.X(COIL.x) - 34, y: cy + ry, w: 68, h: v.SH - cy - ry }] : []),
    ]
  },
  hit: (s, P, v, x, y) => Math.abs(x - v.X(s.m)) < MAG.L * v.u / 2 + 18 && Math.abs(y - v.Y(0)) < Math.max(26, MAG.T * v.u),
  drag: (s, P, v, x) => Math.max(-4.2, Math.min(3.6, v.ix(x))),
  readouts: (s, P) => (P.show_coil === false ? [] : [
    { label: 'Flux through coil', value: (s.phi / 9).toFixed(2), color: NL.field },
    { label: 'Current', value: Math.abs(s.emf) < 0.05 ? '0' : `${s.emf > 0 ? '+' : '−'}${Math.abs(s.emf / 3).toFixed(2)}`, color: NL.gold },
  ]),
  drawPlot: (c, s, P, v, fx) => {
    const y0 = v.SH, pad = 12, H = v.PH
    c.globalAlpha = fx.reveal('graph')
    c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 1; c.beginPath(); c.moveTo(pad, y0 + H / 2 + 8); c.lineTo(v.W - pad, y0 + H / 2 + 8); c.stroke()
    const t1 = Math.max(9, s.t), t0 = t1 - 9, n = Math.round(num(P, 'turns')), k = num(P, 'strength')
    const rect = { x: pad, y: y0 + 24, w: v.W - 2 * pad, h: H - 28 }
    trace2(c, s.hist.map(h => [h[0], h[1] / (n * k)] as [number, number]), rect, { t0, t1, scale: rect.h * 0.4, color: 'rgba(127,178,255,0.7)' })
    trace2(c, s.hist.map(h => [h[0], Math.tanh(h[2] / (5 * Math.max(0.6, n / 9) * k))] as [number, number]), rect, { t0, t1, scale: rect.h * 0.42, color: NL.gold, glow: true })
    legend(c, pad, y0 + 7, [['flux Φ', NL.field], ['current ∝ −dΦ/dt', NL.gold]])
    c.globalAlpha = 1
    void glow
  },
}

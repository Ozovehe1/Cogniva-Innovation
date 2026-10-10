/**
 * A simple circuit: cell, resistor, bulb and ammeter in one loop. Real physics: I = V / (R + R_bulb) (Ohm's law), the
 * same current everywhere in the loop (electrons drift at the same speed in every part), bulb brightness ∝ I²R_bulb,
 * resistor heat ∝ I²R. Electrons (blue, −) drift from − round to +; conventional current (gold arrows) the other way.
 */
import { arrowHead, halo, num, rng, stageBackground, type KindRuntime, type Params, type View } from '../engine'
import { along, bulb, cellBattery, charge, meter, polyLen, resistor, type Pt } from '../primitives'
import { font } from '../engine'
import { NL } from '../tokens'
import type { KindInfo } from '../types'

export const CIRCUIT_INFO: KindInfo = {
  id: 'circuit',
  blurb: 'cell + resistor + bulb + ammeter in a loop: electrons drift (same speed everywhere), conventional current arrows, I = V/R live, bulb brightness and resistor heat; sliders voltage/resistance',
  params: {
    voltage: { type: 'number', min: 0, max: 12, default: 6, step: 0.5, label: 'Cell voltage V', unit: 'V' },
    resistance: { type: 'number', min: 1, max: 12, default: 4, step: 0.5, label: 'Resistance R', unit: 'Ω' },
    show: { type: 'enum', options: ['both', 'electrons', 'conventional'], default: 'both', label: 'Show electrons / current' },
  },
  targets: ['battery', 'wire', 'charges', 'current', 'resistor', 'bulb', 'ammeter'],
  example: {
    title: 'Current: charge flowing round a circuit',
    params: { voltage: 0, resistance: 4, show: 'both' },
    beats: [
      { do: 'hold', dur: 1.2, caption: 'No push: free electrons only jiggle' },
      { do: 'set', param: 'voltage', to: 6, dur: 1.8, caption: 'The cell pushes: electrons drift round' },
      { do: 'pulse', target: 'ammeter', dur: 1.8, caption: 'Same current in every part of the loop' },
      { do: 'move', param: 'resistance', to: 10, dur: 2.2, caption: 'More resistance: less current, dim bulb' },
      { do: 'move', param: 'voltage', to: 12, dur: 2.0, caption: 'More voltage: more current again' },
    ],
    controls: [{ param: 'voltage' }, { param: 'resistance' }],
    labels: [],
    drag: false,
    alt: 'A loop with a cell, resistor, bulb and ammeter; electrons drift round at the same speed everywhere, faster for more voltage or less resistance.',
  },
}

const RB = 2
const X0 = -3.1, X1 = 3.1, Y0 = -1.75, Y1 = 1.75
/** Clockwise from the cell's + terminal (conventional current direction). */
const LOOP: Pt[] = [[X0, 0.42], [X0, Y1], [X1, Y1], [X1, Y0], [X0, Y0], [X0, -0.42]]
const current = (P: Params) => num(P, 'voltage') / (num(P, 'resistance') + RB)

interface S { f: number[]; jig: number[]; t: number; drift: number; needle: number; nv: number }

const screenLoop = (v: View): Pt[] => LOOP.map(([x, y]) => [v.X(x), v.Y(y)])

export const circuit: KindRuntime<S> = {
  info: CIRCUIT_INFO,
  aspect: 0.8,
  plot: 0,
  world: () => ({ x0: -3.85, x1: 3.75, y0: -2.55, y1: 2.35 }),
  init: () => {
    const r = rng(3)
    const n = 34
    return { f: Array.from({ length: n }, (_, i) => (i + r() * 0.6) / n), jig: Array.from({ length: n }, () => r() * 10), t: 0, drift: 0, needle: 0, nv: 0 }
  },
  step: (s, P, dt) => {
    const I = current(P)
    s.t += dt
    // Electrons drift against the conventional direction (anticlockwise), speed ∝ I.
    s.drift -= I * dt * 0.022
    const goal = Math.min(70, I * 26) - 35
    s.nv += ((goal - s.needle) * 60 - s.nv * 9) * dt
    s.needle += s.nv * dt
  },
  draw: (c, s, P, v, fx) => {
    stageBackground(c, v, 0.5, 0.5)
    const I = current(P), Imax = 12 / (1 + RB)
    const a = Math.min(1, I / Imax * 1.6)
    const pts = screenLoop(v)
    const we = fx.emph('wire'), show = String(P.show ?? 'both')
    // The wire as a channel (the electrons travel inside it).
    c.save(); c.lineJoin = 'round'; c.lineCap = 'round'
    const path = () => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))) }
    path(); c.strokeStyle = NL.copperD; c.lineWidth = 17; c.stroke()
    path(); c.strokeStyle = we > 0.05 ? `rgba(255,209,102,${0.25 + 0.3 * we})` : '#2A1B14'; c.lineWidth = 12; c.stroke()
    path(); c.strokeStyle = 'rgba(217,134,74,0.25)'; c.lineWidth = 1; c.stroke()
    c.restore()
    // Components over the channel.
    const top = v.Y(Y1), right = v.X(X1), bot = v.Y(Y0)
    resistor(c, v.X(-0.95), top, v.X(0.95), { heat: Math.min(1, (I * I * num(P, 'resistance')) / 20) * (0.4 + 0.6 * fx.emph('resistor') + 0.6) })
    const bE = fx.emph('bulb')
    c.fillStyle = NL.bg; c.fillRect(right - 14, v.Y(0.62), 28, v.Y(-0.62) - v.Y(0.62))
    bulb(c, right, v.Y(0), Math.max(14, 0.48 * v.u), Math.min(1, (I * I * RB) / 14) + 0.25 * bE)
    const amR = Math.max(17, 0.45 * v.u)
    c.fillStyle = NL.bg; c.beginPath(); c.arc(v.X(0), bot, amR + 4, 0, Math.PI * 2); c.fill()
    meter(c, v.X(0), bot, amR, s.needle, { emph: fx.emph('ammeter'), letter: 'A' })
    c.fillStyle = NL.bg; c.fillRect(v.X(X0) - 14, v.Y(0.62), 28, v.Y(-0.62) - v.Y(0.62))
    cellBattery(c, v.X(X0), v.Y(0), Math.max(46, 1.25 * v.u), 22, { vertical: true, glow: fx.emph('battery') })
    // Ohm's law, live, in the middle of the loop.
    c.textAlign = 'center'; c.textBaseline = 'middle'
    font(c, 15, 700); c.fillStyle = NL.gold; c.fillText('I = V / R', v.X(0), v.Y(0.35))
    font(c, 12.5, 600); c.fillStyle = NL.muted
    c.fillText(`${num(P, 'voltage').toFixed(1)} V ÷ ${(num(P, 'resistance') + RB).toFixed(1)} Ω = ${I.toFixed(2)} A`, v.X(0), v.Y(-0.2))
    // Electrons (skip where a component sits so they read as passing through).
    const L = polyLen(pts)
    const cr = fx.reveal('charges'), ce = fx.emph('charges')
    if (show !== 'conventional' && cr > 0.02) {
      s.f.forEach((f0, i) => {
        const p = along(pts, f0 + s.drift)
        const jx = fx.reduced ? 0 : Math.sin(s.t * 9 + s.jig[i]) * 2.2, jy = fx.reduced ? 0 : Math.cos(s.t * 7.3 + s.jig[i] * 1.7) * 2.2
        const nearComp = Math.hypot(p.x - v.X(0), p.y - bot) < amR + 2 || Math.hypot(p.x - right, p.y - v.Y(0)) < 0.5 * v.u + 4 || (Math.abs(p.x - v.X(X0)) < 16 && Math.abs(p.y - v.Y(0)) < Math.max(46, 1.25 * v.u) / 2 + 8)
        if (nearComp) return
        if (ce > 0) halo(c, p.x, p.y, 12, '143,193,255', ce)
        charge(c, p.x + jx, p.y + jy, 4.6, -1, cr)
      })
    }
    // Conventional current: gold chevrons moving clockwise (+ → round → −), speed ∝ I.
    const cuR = fx.reveal('current'), cuE = fx.emph('current')
    if (show !== 'electrons' && a > 0.03 && cuR > 0.02) {
      const n = 10, off = (-s.drift * 0.9) % 1
      c.save(); c.globalAlpha = cuR * (0.45 + 0.55 * a); c.shadowColor = NL.gold; c.shadowBlur = 8 + 10 * cuE
      for (let k = 0; k < n; k++) {
        const p = along(pts, (k / n + off + 1) % 1)
        const off2 = 15
        const nx = -Math.sin(p.ang) * off2, ny = Math.cos(p.ang) * off2
        arrowHead(c, p.x - nx, p.y - ny, p.ang, 9 + 3 * cuE, NL.gold)
      }
      c.restore()
    }
    void L
  },
  anchors: (s, P, v) => ({
    battery: { x: v.X(X0), y: v.Y(0), r: 20 },
    wire: { x: v.X(-2), y: v.Y(Y1), r: 9 },
    charges: { x: v.X(1.9), y: v.Y(Y1), r: 9 },
    current: { x: v.X(1.9), y: v.Y(Y1) + 16, r: 6 },
    resistor: { x: v.X(0), y: v.Y(Y1), r: 10 },
    bulb: { x: v.X(X1), y: v.Y(0), r: Math.max(14, 0.48 * v.u) },
    ammeter: { x: v.X(0), y: v.Y(Y0), r: Math.max(17, 0.45 * v.u) },
  }),
  keepouts: (s, P, v) => {
    const k = 10
    return [
      { x: v.X(X0) - k, y: v.Y(Y1) - k, w: v.X(X1) - v.X(X0) + 2 * k, h: 2 * k },
      { x: v.X(X0) - k, y: v.Y(Y0) - k, w: v.X(X1) - v.X(X0) + 2 * k, h: 2 * k },
      { x: v.X(X0) - 24, y: v.Y(Y1), w: 48, h: v.Y(Y0) - v.Y(Y1) },
      { x: v.X(X1) - 24, y: v.Y(Y1), w: 48, h: v.Y(Y0) - v.Y(Y1) },
    ]
  },
  readouts: (s, P) => [
    { label: 'Voltage', value: `${num(P, 'voltage').toFixed(1)} V`, color: NL.text },
    { label: 'Resistance', value: `${num(P, 'resistance').toFixed(1)} + ${RB} Ω`, color: NL.text },
    { label: 'Current I = V/R', value: `${current(P).toFixed(2)} A`, color: NL.gold },
  ],
}

/**
 * DC electric motor: a rectangular coil on an axle between N and S poles, fed through a split-ring commutator and
 * carbon brushes from a cell. Real physics: B is uniform (N → S); the force on each long side is F = I L × B (one side
 * up, the other down); torque τ = 2·F·a·|cos θ| because the commutator reverses the coil's current every half turn
 * (and briefly breaks contact at the gap); J dω/dt = τ − bω − friction. Drawn in a 3D oblique projection, back to front.
 */
import { arrow, font, freeSpot, halo, num, rng, stageBackground, type KindRuntime, type Params, type View } from '../engine'
import { cellBattery, type Particle } from '../primitives'
import { NL } from '../tokens'
import type { KindInfo } from '../types'

export const MOTOR_INFO: KindInfo = {
  id: 'motor',
  blurb: 'DC electric motor: coil between N/S poles, split-ring commutator + brushes, cell; forces F = BIL on the coil sides (one up, one down), commutator flips the current every half turn so it keeps turning',
  params: {
    current: { type: 'number', min: -2, max: 2, default: 1, step: 0.1, label: 'Current I', unit: 'A' },
    field: { type: 'number', min: 0.4, max: 1.6, default: 1, step: 0.1, label: 'Magnet strength' },
    show_forces: { type: 'bool', default: true, label: 'Show forces' },
  },
  targets: ['magnets', 'field', 'coil', 'current', 'forces', 'commutator', 'brushes', 'battery'],
  example: {
    title: 'How an electric motor turns',
    params: { current: 0, field: 1 },
    beats: [
      { do: 'reveal', target: 'field', dur: 1.4, caption: 'Magnets: a field from N across to S' },
      { do: 'set', param: 'current', to: 1.2, dur: 1.8, caption: 'Current flows round the coil' },
      { do: 'pulse', target: 'forces', dur: 2.2, caption: 'Force up on one side, down on the other' },
      { do: 'highlight', target: 'commutator', dur: 2.6, caption: 'Commutator flips current each half turn' },
      { do: 'hold', dur: 2.0, caption: 'So the push never reverses: it spins' },
    ],
    controls: [{ param: 'current' }],
    labels: [{ target: 'commutator', text: 'split-ring commutator' }, { target: 'brushes', text: 'brush' }],
    drag: false,
    alt: 'A coil between the poles of a magnet spins on an axle; force arrows push one side up and the other down, and a split-ring commutator reverses the current every half turn.',
  },
}

const A = 1.15, D = 1.35, RC = 0.36, DC = D + 0.75
const KX = -0.3, KY = -0.48
const P3 = (v: View, x: number, y: number, z: number): [number, number] => [v.X(x + KX * z), v.Y(y + KY * z)]

interface S { th: number; w: number; ps: Particle[]; r: () => number; phase: number; IA: number; tau: number }

const gapFactor = (th: number) => { const c = Math.abs(Math.cos(th)); return Math.min(1, Math.max(0, (c - 0.05) / 0.12)) }

function sideCurrents(th: number, I: number) {
  const g = gapFactor(th) * I
  const ia = Math.cos(th) < 0 ? g : -g // the side on the left carries current towards the viewer (+z)
  return { ia, ib: -ia }
}

function spawn(s: S, p: Particle, anywhere: boolean) {
  p.y = (s.r() - 0.5) * 2.1; p.x = anywhere ? -2.3 + s.r() * 4.7 : -2.3; (p as Particle & { z: number }).z = (s.r() - 0.5) * 1.6
  p.px = p.x; p.py = p.y; p.life = 0; p.max = 1.6 + s.r() * 2
  return p
}

function box(c: CanvasRenderingContext2D, v: View, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, pole: 'N' | 'S', emph: number) {
  const base = pole === 'N' ? ['#FF8A7E', NL.north, '#B8362C', '#8E2820'] : ['#8DB6FF', NL.south, '#2F62C2', '#244C99']
  const q = (pts: [number, number, number][], fill: string | CanvasGradient) => { c.beginPath(); pts.forEach(([x, y, z], i) => { const [X, Y] = P3(v, x, y, z); if (i) c.lineTo(X, Y); else c.moveTo(X, Y) }); c.closePath(); c.fillStyle = fill; c.fill() }
  c.save(); c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 18; c.shadowOffsetY = 6
  q([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], base[1])
  c.restore()
  q([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], base[0]) // top
  q([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], base[2]) // +x side
  q([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], base[1]) // front
  const [fx0, fy0] = P3(v, x0, y1, z1), [fx1] = P3(v, x1, y1, z1)
  c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(fx0 + 3, fy0 + 3, fx1 - fx0 - 6, 4)
  const [cx, cy] = P3(v, (x0 + x1) / 2, (y0 + y1) / 2, z1)
  if (emph > 0) halo(c, cx, cy, 60, pole === 'N' ? '255,107,94' : '76,141,255', emph)
  c.fillStyle = '#fff'; font(c, Math.max(14, Math.min(22, (x1 - x0) * v.u * 0.45)), 800); c.textAlign = 'center'; c.textBaseline = 'middle'
  c.fillText(pole, cx, cy)
}

/** A copper tube between two screen points (shadow + body + highlight). */
function tube(c: CanvasRenderingContext2D, a: [number, number], b: [number, number], w: number, hot: number) {
  c.lineCap = 'round'
  c.strokeStyle = NL.copperD; c.lineWidth = w + 2.5; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke()
  c.strokeStyle = hot > 0.05 ? `rgb(${Math.round(217 + 30 * hot)},${Math.round(134 + 40 * hot)},${Math.round(74 + 10 * hot)})` : NL.copper
  c.lineWidth = w; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke()
  c.strokeStyle = NL.copperHi; c.lineWidth = 1.1; c.beginPath(); c.moveTo(a[0], a[1] - w * 0.25); c.lineTo(b[0], b[1] - w * 0.25); c.stroke()
}

function dashes(c: CanvasRenderingContext2D, pts: [number, number][], I: number, phase: number) {
  const a = Math.min(1, Math.abs(I))
  if (a < 0.04) return
  c.save(); c.shadowColor = NL.gold; c.shadowBlur = 10 * a; c.setLineDash([4, 11]); c.lineDashOffset = -phase * 26 * Math.sign(I)
  c.strokeStyle = `rgba(${NL.goldRgb},${0.35 + 0.65 * a})`; c.lineWidth = 2.6; c.lineCap = 'round'
  c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); c.restore()
}

export const motor: KindRuntime<S> = {
  info: MOTOR_INFO,
  aspect: 0.86,
  plot: 0,
  world: () => ({ x0: -4.25, x1: 4.25, y0: -3.65, y1: 2.05 }),
  init: () => {
    const s: S = { th: Math.PI * 0.88, w: 0, ps: [], r: rng(5), phase: 0, IA: 0, tau: 0 }
    for (let i = 0; i < 46; i++) s.ps.push(spawn(s, { x: 0, y: 0, px: 0, py: 0, life: 0, max: 1 }, true))
    s.ps.forEach(p => { p.life = s.r() * p.max })
    return s
  },
  step: (s, P, dt) => {
    const I = num(P, 'current'), Bf = num(P, 'field')
    const { ia } = sideCurrents(s.th, I)
    s.IA = ia
    // Left side (+z current) is pushed up (z × x = +y): torque turns the coil clockwise seen from the front (θ decreasing).
    const tau = -2 * Bf * Math.abs(ia) * A * Math.abs(Math.cos(s.th)) * 2.4 * Math.sign(I || 1)
    s.tau = tau
    const fr = Math.abs(s.w) < 0.05 && Math.abs(tau) < 0.25 ? -s.w / Math.max(dt, 1e-3) : -0.25 * Math.sign(s.w)
    s.w += (tau - 1.1 * s.w + fr) * dt
    s.th += s.w * dt
    s.phase += dt * Math.min(1.6, Math.abs(I))
    for (const p of s.ps) {
      p.px = p.x; p.py = p.y; p.x += dt * 1.3 * Math.min(1.3, Bf); p.life += dt
      if (p.x > 2.45 || p.life > p.max) spawn(s, p, false)
    }
  },
  draw: (c, s, P, v, fx) => {
    stageBackground(c, v, 0.5, 0.42)
    const I = num(P, 'current'), Bf = num(P, 'field')
    const me = fx.emph('magnets')
    // Back of the axle.
    // Poles.
    box(c, v, -3.75, -2.4, -1.2, 1.2, -1.45, 1.45, 'N', me)
    // Field between the poles (mid-depth), with particles flowing N → S.
    const fr = fx.reveal('field'), fe = fx.emph('field')
    c.save(); c.globalAlpha = fr * Math.min(1, 0.5 + 0.5 * Bf)
    for (const y of [-0.95, -0.48, 0, 0.48, 0.95]) {
      const a = P3(v, -2.4, y, 0), b = P3(v, 2.5, y, 0)
      const xr = a[0] + (b[0] - a[0]) * Math.min(1, fr * 1.05)
      c.strokeStyle = fe > 0.05 ? `rgba(160,205,255,${0.35 + 0.45 * fe})` : NL.fieldLine; c.lineWidth = 1.5 + fe
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(xr, b[1]); c.stroke()
      if (fr > 0.98) { const m = P3(v, 1.55, y, 0); c.fillStyle = NL.fieldHi; c.beginPath(); c.moveTo(m[0] + 7, m[1]); c.lineTo(m[0] - 4, m[1] - 5); c.lineTo(m[0] - 4, m[1] + 5); c.fill() }
    }
    c.restore()
    if (fr > 0.3 && !fx.reduced) {
      c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round'; c.lineWidth = 1.8
      for (const p of s.ps) {
        const z = (p as Particle & { z: number }).z, fade = Math.min(1, p.life * 3, (p.max - p.life) * 2) * fr
        const [x1, y1] = P3(v, p.x, p.y, z), [x0] = P3(v, p.x - 0.22, p.y, z)
        c.strokeStyle = `rgba(${NL.particle},${0.38 * fade})`; c.beginPath(); c.moveTo(x0, y1); c.lineTo(x1, y1); c.stroke()
      }
      c.restore()
    }
    box(c, v, 2.5, 3.85, -1.2, 1.2, -1.45, 1.45, 'S', me)
    // Coil geometry.
    const th = s.th, ca = Math.cos(th), sa = Math.sin(th)
    const sideA = { x: A * ca, y: A * sa }, sideB = { x: -A * ca, y: -A * sa }
    const { ia, ib } = sideCurrents(th, I)
    const hot = Math.min(1, Math.abs(I) * gapFactor(th))
    const ce = Math.max(fx.emph('coil'), fx.emph('current'))
    const coilA = fx.reveal('coil')
    c.save(); c.globalAlpha = coilA
    // Axle (back part).
    c.strokeStyle = NL.steelD; c.lineWidth = 5; c.lineCap = 'round'
    { const a = P3(v, 0, 0, -D - 0.5), b = P3(v, 0, 0, DC + 0.55); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); c.strokeStyle = NL.steel; c.lineWidth = 2; c.beginPath(); c.moveTo(a[0], a[1] - 1); c.lineTo(b[0], b[1] - 1); c.stroke() }
    if (ce > 0) { const m = P3(v, 0, 0, 0); halo(c, m[0], m[1], 2.2 * A * v.u, NL.goldRgb, ce) }
    // Back end (z = −D): side A → side B.
    const aBack = P3(v, sideA.x, sideA.y, -D), bBack = P3(v, sideB.x, sideB.y, -D)
    const aFront = P3(v, sideA.x, sideA.y, D), bFront = P3(v, sideB.x, sideB.y, D)
    // The loop's face: a faint pane so the rectangle reads at every angle (gold while current flows).
    c.fillStyle = `rgba(255,209,102,${0.05 + 0.1 * hot})`
    c.beginPath(); c.moveTo(aBack[0], aBack[1]); c.lineTo(aFront[0], aFront[1]); c.lineTo(bFront[0], bFront[1]); c.lineTo(bBack[0], bBack[1]); c.closePath(); c.fill()
    // Three turns of wire, stacked along the loop's normal.
    const nx = -sa * 0.07, ny = ca * 0.07
    for (const k of [-1, 0, 1]) {
      const q = (p: typeof sideA, z: number) => P3(v, p.x + nx * k, p.y + ny * k, z)
      const ab = q(sideA, -D), af = q(sideA, D), bb = q(sideB, -D), bf = q(sideB, D)
      tube(c, ab, bb, 3.2, hot)
      const sides: [number, [number, number], [number, number]][] = [[sideA.y, ab, af], [sideB.y, bb, bf]]
      sides.sort((p, r) => r[0] - p[0])
      for (const [, b0, f0] of sides) tube(c, b0, f0, 3.6, hot)
    }
    // Front leads to the commutator halves.
    const segA = P3(v, RC * Math.cos(th), RC * Math.sin(th), DC - 0.25), segB = P3(v, -RC * Math.cos(th), -RC * Math.sin(th), DC - 0.25)
    tube(c, aFront, segA, 3.2, hot); tube(c, bFront, segB, 3.2, hot)
    // Current flow along the loop (direction from side A's current): commutator → A front → A back → B back → B front.
    const loop: [number, number][] = [segA, aFront, aBack, bBack, bFront, segB]
    dashes(c, ia >= 0 ? [...loop].reverse() : loop, ia, s.phase)
    c.restore()
    // Commutator: a split ring turning with the coil (gaps line up with the brushes when the coil is vertical).
    const cmE = fx.emph('commutator'), [ccx, ccy] = P3(v, 0, 0, DC), rcp = RC * v.u
    const [ccx2, ccy2] = P3(v, 0, 0, DC - 0.3)
    if (cmE > 0) halo(c, ccx, ccy, rcp * 4, NL.goldRgb, cmE)
    c.lineCap = 'butt'
    for (const [cx0, cy0, dark] of [[ccx2, ccy2, true], [ccx, ccy, false]] as [number, number, boolean][]) {
      for (const k of [0, 1]) {
        const a0 = -(th + Math.PI / 2) + k * Math.PI + 0.18, a1 = a0 + Math.PI - 0.36
        c.strokeStyle = dark ? NL.copperD : k ? '#E9A46B' : NL.copper
        c.lineWidth = 8
        c.beginPath(); c.arc(cx0, cy0, rcp, a0, a1); c.stroke()
      }
    }
    // Axle tip.
    { const b = P3(v, 0, 0, DC + 0.55); c.fillStyle = NL.steel; c.beginPath(); c.arc(b[0], b[1], 3.5, 0, Math.PI * 2); c.fill() }
    // Brushes (fixed, left and right of the ring) and leads down to the cell.
    const bE = fx.emph('brushes')
    const bw = 12, bh = 16
    const bl = [ccx - rcp - 4 - bw, ccy - bh / 2], br = [ccx + rcp + 4, ccy - bh / 2]
    for (const [x, y] of [bl, br]) {
      if (bE > 0) halo(c, x + bw / 2, y + bh / 2, 28, NL.goldRgb, bE)
      const g = c.createLinearGradient(x, y, x, y + bh); g.addColorStop(0, '#5B6278'); g.addColorStop(1, '#2C3142')
      c.fillStyle = g; c.beginPath(); c.roundRect(x, y, bw, bh, 2); c.fill(); c.strokeStyle = bE > 0.05 ? NL.gold : '#7C849C'; c.lineWidth = 1; c.stroke()
    }
    const [batX, batY] = P3(v, 0, -2.25, DC)
    const yb = batY
    const leadL: [number, number][] = [[bl[0], ccy], [bl[0] - 22, ccy], [bl[0] - 22, yb], [batX - 25, yb]]
    const leadR: [number, number][] = [[br[0] + bw, ccy], [br[0] + bw + 22, ccy], [br[0] + bw + 22, yb], [batX + 27, yb]]
    for (const L of [leadL, leadR]) { c.strokeStyle = NL.copperD; c.lineWidth = 2.6; c.lineJoin = 'round'; c.beginPath(); L.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke() }
    const Ion = Math.abs(I) > 0.03 ? Math.sign(I) * Math.min(1, Math.abs(I)) * (0.4 + 0.6 * gapFactor(th)) : 0
    dashes(c, I >= 0 ? [...leadL].reverse() : leadL, Ion, s.phase)
    dashes(c, I >= 0 ? leadR : [...leadR].reverse(), Ion, s.phase)
    cellBattery(c, batX, yb, 50, 20, { glow: fx.emph('battery') })
    // Forces on the long sides (F = BIL, vertical), at mid-depth.
    if (P.show_forces !== false) {
      const fE = fx.emph('forces'), fr2 = fx.reveal('forces')
      for (const [side, cur] of [[sideA, ia], [sideB, ib]] as [typeof sideA, number][]) {
        const F = Bf * cur // +: up (current towards the viewer)
        if (Math.abs(F) < 0.04) continue
        const [x0, y0] = P3(v, side.x, side.y, 0.15)
        const len = Math.min(1.3, Math.abs(F) * 0.85) * v.u
        arrow(c, x0, y0, x0, y0 - Math.sign(F) * len, { color: NL.gold, w: 3 + 1.5 * fE, glow: 10 + 14 * fE, alpha: fr2 })
        if (fE > 0.02 || fr2 > 0.9) {
          // "F" beside the shaft (right, left, then past the tip), on the first side clear of every label.
          const ym = y0 - Math.sign(F) * len * 0.7, yt = y0 - Math.sign(F) * (len + 12)
          const spot = freeSpot([{ x: x0 + 6, y: ym - 8, w: 11, h: 16 }, { x: x0 - 17, y: ym - 8, w: 11, h: 16 }, { x: x0 - 5, y: yt - 8, w: 11, h: 16 }, { x: x0 + 6, y: y0 - 8, w: 11, h: 16 }], fx.labels)
          c.save(); c.globalAlpha = fr2; c.fillStyle = NL.gold; font(c, 13, 800); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('F', spot.x + 1, spot.y + 8); c.restore()
        }
      }
    }
    // Spin cue: a curved arrow round the axle's far end shows which way it turns.
    if (Math.abs(s.w) > 0.4) {
      const [ex, ey] = P3(v, 0, 0, -D - 0.5), r = 18, dir = s.w < 0 ? 1 : -1
      c.save(); c.strokeStyle = 'rgba(232,236,243,0.7)'; c.lineWidth = 2; c.beginPath(); c.arc(ex, ey, r, -2.6, -0.5); c.stroke()
      const a = dir > 0 ? -0.5 : -2.6
      const hx = ex + r * Math.cos(a), hy = ey + r * Math.sin(a)
      c.fillStyle = 'rgba(232,236,243,0.85)'; c.beginPath(); const tg = a + dir * Math.PI / 2; c.moveTo(hx + 7 * Math.cos(tg), hy + 7 * Math.sin(tg)); c.lineTo(hx + 5 * Math.cos(tg + 2.4), hy + 5 * Math.sin(tg + 2.4)); c.lineTo(hx + 5 * Math.cos(tg - 2.4), hy + 5 * Math.sin(tg - 2.4)); c.fill(); c.restore()
    }
  },
  anchors: (s, P, v) => {
    const [ccx, ccy] = P3(v, 0, 0, DC), rcp = RC * v.u
    const [bx, by] = P3(v, 0, -2.25, DC)
    const top = Math.sin(s.th) > 0 ? { x: A * Math.cos(s.th), y: A * Math.sin(s.th) } : { x: -A * Math.cos(s.th), y: -A * Math.sin(s.th) }
    const [cx, cy] = P3(v, top.x, top.y, -0.6)
    const [nx, ny] = P3(v, -2.95, 1.25, 0)
    return {
      commutator: { x: ccx, y: ccy + rcp, r: 4 },
      brushes: { x: ccx + rcp + 16, y: ccy, r: 9 },
      coil: { x: cx, y: cy, r: 4 },
      field: { x: v.X(0.1), y: v.Y(-1.0), r: 3 },
      magnets: { x: nx, y: ny, r: 4 },
      battery: { x: bx, y: by, r: 18 },
      forces: { x: cx, y: cy - 30, r: 6 },
      current: { x: cx, y: cy, r: 4 },
    }
  },
  keepouts: (s, P, v) => {
    const [ccx, ccy] = P3(v, 0, 0, DC), rcp = RC * v.u
    const c0 = P3(v, -A - 0.1, A + 0.1, D), c1 = P3(v, A + 0.1, -A - 0.1, -D)
    return [
      { x: ccx - rcp - 40, y: ccy - rcp - 6, w: 2 * rcp + 80, h: 2 * rcp + 12 },
      { x: Math.min(c0[0], c1[0]), y: Math.min(c0[1], c1[1]), w: Math.abs(c1[0] - c0[0]), h: Math.abs(c1[1] - c0[1]) },
    ]
  },
  readouts: (s, P) => [
    { label: 'Turns per s', value: (Math.abs(s.w) / (2 * Math.PI)).toFixed(2), color: NL.text },
    { label: 'Torque', value: Math.abs(s.tau).toFixed(2), color: NL.gold },
    { label: 'Current', value: `${num(P, 'current').toFixed(1)} A`, color: NL.gold },
  ],
}
export type { Params }

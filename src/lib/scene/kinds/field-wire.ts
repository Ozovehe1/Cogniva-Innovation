/**
 * Magnetic field of a current: a straight wire seen end on (dot = current towards you, cross = away), or a solenoid
 * seen from the side. Real physics in the plane: every wire is a line current, B = Σ I·(−dy, dx)/r² (Biot–Savart
 * for long straight wires); field lines are traced from that field, particles circulate at a speed ∝ |B|, and the
 * compass needles turn (damped) to the local field plus a weak northward Earth field.
 */
import { arrow, font, halo, num, rng, stageBackground, trace, type KindRuntime, type Params } from '../engine'
import { coilHalf, fieldLine, streaks, type Particle, type Pt } from '../primitives'
import { NL } from '../tokens'
import type { KindInfo } from '../types'

export const FIELD_WIRE_INFO: KindInfo = {
  id: 'field_wire',
  blurb: 'magnetic field of a current: form "wire" (straight wire end-on, rings + compasses) or "solenoid" (coil from the side, uniform field inside, N/S ends); current slider reverses it',
  params: {
    form: { type: 'enum', options: ['wire', 'solenoid'], default: 'wire', label: 'Wire or solenoid' },
    current: { type: 'number', min: -3, max: 3, default: 2, step: 0.1, label: 'Current I (A)', unit: 'A' },
    turns: { type: 'number', min: 4, max: 12, default: 8, step: 1, label: 'Turns (solenoid)' },
  },
  targets: ['wire', 'field', 'compass', 'coil', 'poles'],
  example: {
    title: 'The magnetic field around a wire',
    params: { form: 'wire', current: 0 },
    beats: [
      { do: 'hold', dur: 1.2, caption: 'No current: compasses all point north' },
      { do: 'move', param: 'current', to: 2.4, dur: 1.8, caption: 'Switch on: the field circles the wire' },
      { do: 'pulse', target: 'compass', dur: 1.6, caption: 'Each compass lines up with the field' },
      { do: 'move', param: 'current', to: -2.4, dur: 2.2, caption: 'Reverse the current: field turns around' },
      { do: 'highlight', target: 'field', dur: 1.6, caption: 'Stronger close to the wire, weaker far out' },
    ],
    controls: [{ param: 'current' }],
    labels: [],
    drag: false,
    alt: 'A wire seen end on with magnetic field rings around it; compass needles line up with the rings and swing round when the current reverses.',
  },
}

interface Wire { x: number; y: number; s: 1 | -1 }
const solR = 1.0
function wiresFor(P: Params): Wire[] {
  if (P.form !== 'solenoid') return [{ x: 0, y: 0, s: 1 }]
  const n = Math.round(num(P, 'turns')), L = 5.2
  const out: Wire[] = []
  for (let k = 0; k < n; k++) { const x = -L / 2 + L * (k + 0.5) / n; out.push({ x, y: solR, s: 1 }, { x, y: -solR, s: -1 }) }
  return out
}
const Bfield = (ws: Wire[], I: number) => (x: number, y: number): [number, number] => {
  let bx = 0, by = 0
  for (const w of ws) { const dx = x - w.x, dy = y - w.y, r2 = dx * dx + dy * dy + 0.02; bx += -w.s * I * dy / r2; by += w.s * I * dx / r2 }
  return [bx, by]
}

interface S { lines: Pt[][]; key: string; ps: Particle[]; r: () => number; comp: { x: number; y: number; a: number; w: number }[]; phase: number; sign: number }

function buildLines(P: Params): Pt[][] {
  const ws = wiresFor(P)
  const B = Bfield(ws, 1)
  if (P.form !== 'solenoid') {
    return [0.45, 0.8, 1.2, 1.65, 2.15].map(r => {
      const pts = trace(B, r, 0, { h: 0.04, n: 600, stop: () => false })
      // Cut at one full turn.
      let k = pts.length - 1
      for (let i = 30; i < pts.length; i++) if (Math.hypot(pts[i][0] - r, pts[i][1]) < 0.05) { k = i; break }
      return pts.slice(0, k + 1)
    })
  }
  const out: Pt[][] = []
  for (const y0 of [-0.75, -0.45, -0.15, 0.15, 0.45, 0.75]) {
    const pts = trace(B, -2.6 + 0.01, y0, { h: 0.045, n: 1200, stop: () => false })
    let k = pts.length - 1
    for (let i = 40; i < pts.length; i++) if (Math.hypot(pts[i][0] + 2.6, pts[i][1] - y0) < 0.06) { k = i; break }
    out.push(pts.slice(0, k + 1).filter(p => Math.abs(p[0]) < 6 && Math.abs(p[1]) < 4.2))
  }
  return out
}

function spawn(s: S, p: Particle) {
  const L = s.lines[Math.floor(s.r() * s.lines.length)]
  const k = Math.floor(s.r() * L.length)
  p.x = L[k][0]; p.y = L[k][1]; p.px = p.x; p.py = p.y; p.life = 0; p.max = 1.5 + s.r() * 2.5
  return p
}

export const fieldWire: KindRuntime<S> = {
  info: FIELD_WIRE_INFO,
  aspect: 0.78,
  plot: 0,
  world: P => (P.form === 'solenoid' ? { x0: -4.6, x1: 4.6, y0: -2.9, y1: 2.6 } : { x0: -3.1, x1: 3.1, y0: -2.55, y1: 2.55 }),
  init: P => {
    const s: S = { lines: buildLines(P), key: `${P.form}:${P.turns}`, ps: [], r: rng(11), comp: [], phase: 0, sign: 1 }
    for (let i = 0; i < (P.form === 'solenoid' ? 150 : 110); i++) { const p = spawn(s, { x: 0, y: 0, px: 0, py: 0, life: 0, max: 1 }); p.life = s.r() * p.max; s.ps.push(p) }
    const pos: [number, number][] = P.form === 'solenoid'
      ? [[-3.9, 0], [3.9, 0], [0, 2.05], [0, -2.05], [-2.6, 2.0], [2.6, 2.0]]
      : Array.from({ length: 8 }, (_, k) => { const a = k * Math.PI / 4 + Math.PI / 8; return [2.15 * Math.cos(a) * 1.08, 2.0 * Math.sin(a)] as [number, number] })
    s.comp = pos.map(([x, y]) => ({ x, y, a: Math.PI / 2, w: 0 }))
    return s
  },
  step: (s, P, dt) => {
    const key = `${P.form}:${Math.round(num(P, 'turns'))}`
    if (key !== s.key) { const f = fieldWire.init(P, null as never); Object.assign(s, f) }
    const I = num(P, 'current')
    const B = Bfield(wiresFor(P), I)
    s.sign = I >= 0 ? 1 : -1
    for (const p of s.ps) {
      const [u, v] = B(p.x, p.y), m = Math.hypot(u, v) || 1
      const sp = Math.min(2.2, 0.35 * m ** 0.6) * Math.min(1, Math.abs(I) / 1.2)
      p.px = p.x; p.py = p.y; p.x += dt * sp * u / m; p.y += dt * sp * v / m; p.life += dt
      if (p.life > p.max || Math.abs(p.x) > 6 || Math.abs(p.y) > 4.4) spawn(s, p)
    }
    for (const q of s.comp) {
      const [u, v] = B(q.x, q.y)
      const goal = Math.atan2(v + 0.12, u) // + weak Earth field towards "north" (up)
      let da = goal - q.a; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI
      q.w += (da * 40 - q.w * 7) * dt; q.a += q.w * dt
    }
    s.phase += dt * I
  },
  draw: (c, s, P, v, fx) => {
    stageBackground(c, v, 0.5, 0.52)
    const I = num(P, 'current'), mag = Math.min(1, Math.abs(I) / 2.4), sol = P.form === 'solenoid'
    const fr = fx.reveal('field'), fe = fx.emph('field')
    // Lines: drawn in the direction of B (reversed when the current reverses).
    for (const [i, L] of s.lines.entries()) {
      const pts = I >= 0 ? L : [...L].reverse()
      const near = sol ? 1 : 1 - i * 0.14
      fieldLine(c, pts, v.X, v.Y, { reveal: fr, at: sol ? 0.18 : 0.12 + 0.1 * i, alpha: (0.15 + 0.85 * mag) * near, color: fe > 0.05 ? `rgba(160,205,255,${0.35 + 0.45 * fe})` : NL.fieldLine, w: 1.5 + (sol ? 0 : (1 - i * 0.2) * 0.8) + fe })
    }
    if (fr > 0.3 && mag > 0.03 && !fx.reduced) streaks(c, s.ps, v.X, v.Y, { alpha: mag * Math.min(1, (fr - 0.3) / 0.5), tail: 4 })
    const we = Math.max(fx.emph('wire'), fx.emph('coil'))
    if (!sol) {
      const R = 0.28 * v.u, cx = v.X(0), cy = v.Y(0)
      halo(c, cx, cy, R * 4, NL.goldRgb, Math.max(we, mag * 0.5))
      const g = c.createRadialGradient(cx - R * 0.3, cy - R * 0.3, 1, cx, cy, R)
      g.addColorStop(0, '#F3B07A'); g.addColorStop(1, NL.copperD)
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill()
      c.strokeStyle = mag > 0.05 ? NL.gold : NL.copperD; c.lineWidth = 2; c.stroke()
      if (mag > 0.03) {
        c.strokeStyle = '#fff'; c.fillStyle = '#fff'; c.lineWidth = 3
        if (I > 0) { c.beginPath(); c.arc(cx, cy, R * 0.28, 0, Math.PI * 2); c.fill() } else { const k = R * 0.42; c.beginPath(); c.moveTo(cx - k, cy - k); c.lineTo(cx + k, cy + k); c.moveTo(cx + k, cy - k); c.lineTo(cx - k, cy + k); c.stroke() }
      }
    } else {
      const n = Math.round(num(P, 'turns')), L = 5.2
      const xs = Array.from({ length: n }, (_, k) => v.X(-L / 2 + L * (k + 0.5) / n))
      const rx = Math.max(4, 0.2 * v.u), ry = solR * v.u, cy = v.Y(0)
      const ca = fx.reveal('coil')
      c.save(); c.globalAlpha = ca
      coilHalf(c, xs, cy, rx, ry, false)
      halo(c, v.X(0), cy, L * v.u * 0.6, NL.goldRgb, we)
      coilHalf(c, xs, cy, rx, ry, true, { current: mag, phase: s.phase })
      // Leads + current direction arrow.
      c.strokeStyle = NL.copperD; c.lineWidth = 2.4
      c.beginPath(); c.moveTo(xs[0], cy + ry); c.lineTo(xs[0], v.Y(-2.45)); c.moveTo(xs[n - 1], cy + ry); c.lineTo(xs[n - 1], v.Y(-2.45)); c.stroke()
      if (mag > 0.03) arrow(c, I > 0 ? xs[0] - 14 : xs[n - 1] + 14, v.Y(-2.0), I > 0 ? xs[0] - 14 : xs[n - 1] + 14, v.Y(-1.4), { color: NL.gold, w: 2, glow: 8 })
      c.restore()
      // Poles: the end the field leaves is N.
      const pa = fx.reveal('poles') * mag, pe = fx.emph('poles')
      if (pa > 0.05) {
        const nRight = I > 0
        for (const [x, lab] of [[v.X(L / 2) + 26, nRight ? 'N' : 'S'], [v.X(-L / 2) - 26, nRight ? 'S' : 'N']] as [number, string][]) {
          halo(c, x, cy, 30, lab === 'N' ? '255,107,94' : '76,141,255', 0.6 * pa + pe)
          c.globalAlpha = pa; c.fillStyle = lab === 'N' ? NL.north : NL.south; font(c, 18, 800); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(lab, x, cy); c.globalAlpha = 1
        }
      }
    }
    // Compasses.
    const ce = fx.emph('compass'), cr = fx.reveal('compass')
    if (cr > 0.02) for (const q of s.comp) {
      const x = v.X(q.x), y = v.Y(q.y), r = Math.max(13, Math.min(17, v.u * 0.3))
      c.save(); c.globalAlpha = cr
      if (ce > 0) halo(c, x, y, r * 2.4, NL.goldRgb, ce)
      c.fillStyle = 'rgba(232,236,243,0.08)'; c.strokeStyle = ce > 0.05 ? NL.gold : 'rgba(232,236,243,0.45)'; c.lineWidth = 1.4
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.stroke()
      const a = -q.a, k = r * 0.8, wdt = r * 0.24
      const tip = (s2: number) => [x + s2 * k * Math.cos(a), y + s2 * k * Math.sin(a)]
      const [nx, ny] = tip(1), [sx, sy] = tip(-1)
      const px = -Math.sin(a) * wdt, py = Math.cos(a) * wdt
      c.fillStyle = NL.north; c.beginPath(); c.moveTo(nx, ny); c.lineTo(x + px, y + py); c.lineTo(x - px, y - py); c.fill()
      c.fillStyle = '#C9D2E3'; c.beginPath(); c.moveTo(sx, sy); c.lineTo(x + px, y + py); c.lineTo(x - px, y - py); c.fill()
      c.fillStyle = NL.bg; c.beginPath(); c.arc(x, y, 2, 0, Math.PI * 2); c.fill()
      c.restore()
    }
  },
  anchors: (s, P, v) => {
    const sol = P.form === 'solenoid'
    const q = s.comp[0]
    return {
      wire: { x: v.X(0), y: v.Y(0), r: sol ? 6 : 0.28 * v.u },
      coil: { x: v.X(sol ? 1.3 : 0), y: v.Y(sol ? solR : 0), r: 6 },
      field: sol ? { x: v.X(-1.2), y: v.Y(0), r: 4 } : { x: v.X(0), y: v.Y(-1.2), r: 4 },
      compass: q ? { x: v.X(q.x), y: v.Y(q.y), r: 17 } : { x: v.X(0), y: v.Y(0), r: 4 },
      poles: { x: v.X(sol ? 2.6 : 0) + 26, y: v.Y(0), r: 14 },
    }
  },
  keepouts: (s, P, v) => s.comp.map(q => ({ x: v.X(q.x) - 18, y: v.Y(q.y) - 18, w: 36, h: 36 })),
  readouts: (s, P) => {
    const I = num(P, 'current')
    return [
      { label: 'Current', value: `${I >= 0 ? '' : '−'}${Math.abs(I).toFixed(1)} A`, color: NL.gold },
      { label: P.form === 'solenoid' ? 'Field inside (rel.)' : 'Field at 1 unit (rel.)', value: (Math.abs(I) * (P.form === 'solenoid' ? num(P, 'turns') / 8 : 1)).toFixed(2), color: NL.field },
    ]
  },
}

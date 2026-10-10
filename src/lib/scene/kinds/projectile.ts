/**
 * Projectile motion / equations of motion: a ball launched at speed u and angle θ. Real kinematics (no drag):
 * x = u cosθ·t, y = u sinθ·t − ½gt², vx constant, vy = u sinθ − gt. A strobe trail (one ghost every 0.1 s), the
 * velocity vector and its components, the apex (vy = 0) and the equations with live numbers in the strip below.
 * The launcher can be dragged to change the angle once the learner has control.
 */
import { arrow, font, halo, num, stageBackground, type KindRuntime, type Params } from '../engine'
import { body } from '../primitives'
import { MONO, NL } from '../tokens'
import type { KindInfo } from '../types'

export const PROJECTILE_INFO: KindInfo = {
  id: 'projectile',
  blurb: 'projectile / equations of motion: ball launched at speed u and angle θ, strobe trail, velocity components (vx constant, vy shrinking to 0 at the top), apex, live x = u cosθ t and y = u sinθ t − ½gt²; play runs the flight',
  params: {
    speed: { type: 'number', min: 5, max: 25, default: 15, step: 0.5, label: 'Launch speed u', unit: 'm/s' },
    angle: { type: 'number', min: 10, max: 80, default: 50, step: 1, label: 'Launch angle θ', unit: '°' },
    gravity: { type: 'number', min: 1.6, max: 20, default: 9.8, step: 0.1, label: 'Gravity g', unit: 'm/s²' },
    time: { type: 'number', min: 0, max: 10, default: 0, step: 0.01, label: 'Time t', unit: 's' },
    show_components: { type: 'bool', default: true, label: 'Show velocity components' },
  },
  targets: ['ball', 'path', 'velocity', 'components', 'apex', 'launcher', 'equations'],
  playParam: 'time',
  dragParam: 'angle',
  example: {
    title: 'A ball thrown up and forward',
    params: { speed: 15, angle: 55 },
    beats: [
      { do: 'reveal', target: 'launcher', dur: 0.8, caption: 'Launch at 15 m/s, 55° above the ground' },
      { do: 'play', to: 1.25, dur: 1.7, ease: 'linear', caption: 'Rising: gravity shrinks vy, vx stays' },
      { do: 'pulse', target: 'apex', dur: 1.6, caption: 'At the top vy = 0, but vx is unchanged' },
      { do: 'play', dur: 1.7, caption: 'Falling: vy grows downward' },
      { do: 'highlight', target: 'equations', dur: 2.0, caption: 'x = u cosθ·t,  y = u sinθ·t − ½gt²' },
    ],
    controls: [{ param: 'speed' }, { param: 'angle' }],
    labels: [],
    drag: true,
    alt: 'A ball launched at an angle follows a parabola; its horizontal velocity stays the same while its vertical velocity shrinks to zero at the top and then grows downward.',
  },
}

const deg = (P: Params) => num(P, 'angle') * Math.PI / 180
const flightT = (P: Params) => 2 * num(P, 'speed') * Math.sin(deg(P)) / num(P, 'gravity')
const pos = (P: Params, t: number) => { const u = num(P, 'speed'), a = deg(P), g = num(P, 'gravity'); return { x: u * Math.cos(a) * t, y: u * Math.sin(a) * t - 0.5 * g * t * t, vx: u * Math.cos(a), vy: u * Math.sin(a) - g * t } }

interface S { tf: number; key: string; lastTime: number; trail: { x: number; y: number }[]; sinceGhost: number; land: number }

export const projectile: KindRuntime<S> = {
  info: PROJECTILE_INFO,
  aspect: 0.6,
  plot: 0.2,
  playTo: P => flightT(P),
  world: P => {
    const u = num(P, 'speed') * 1.12, g = num(P, 'gravity')
    const R = u * u / g, H = Math.max(u * u * Math.sin(deg(P)) ** 2 / (2 * g), R * 0.32)
    return { x0: -0.08 * R, x1: R * 1.04, y0: -0.12 * H, y1: H * 1.12 }
  },
  init: () => ({ tf: 0, key: '', lastTime: -1, trail: [], sinceGhost: 0, land: 0 }),
  step: (s, P, dt) => {
    const T = flightT(P)
    const key = `${num(P, 'speed')}:${num(P, 'angle')}:${num(P, 'gravity')}`
    const t = num(P, 'time')
    if (P.__owned) {
      // The learner's turn: relaunch whenever they change speed/angle, and replay after each landing.
      if (key !== s.key) { s.key = key; s.tf = 0; s.trail = []; s.sinceGhost = 0 }
      s.tf += dt
      if (s.tf > T + 1.4) { s.tf = 0; s.trail = []; s.sinceGhost = 0 }
    } else {
      if (t < s.lastTime - 1e-6) { s.trail = []; s.sinceGhost = 0 }
      s.tf = t; s.key = key
    }
    s.lastTime = t
    const tt = Math.min(s.tf, T)
    s.sinceGhost += dt
    const lastGhostT = s.trail.length ? (s.trail.length - 1) * 0.1 : -1
    while (tt - lastGhostT >= 0.1 && s.trail.length * 0.1 <= tt + 1e-9) { const p = pos(P, s.trail.length * 0.1); s.trail.push({ x: p.x, y: Math.max(0, p.y) }); if (s.trail.length > 200) break }
    s.land = s.tf >= T ? Math.min(1, (s.tf - T) * 3) : 0
  },
  draw: (c, s, P, v, fx) => {
    stageBackground(c, v, 0.35, 0.3)
    const T = flightT(P), t = Math.min(s.tf, T), p = pos(P, t)
    const u = num(P, 'speed'), a = deg(P), g = num(P, 'gravity')
    // Ground.
    const gy = v.Y(0)
    const gg = c.createLinearGradient(0, gy, 0, v.SH); gg.addColorStop(0, '#1B2A2A'); gg.addColorStop(1, '#0E1517')
    c.fillStyle = gg; c.fillRect(0, gy, v.W, v.SH - gy)
    c.strokeStyle = 'rgba(123,211,137,0.55)'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, gy); c.lineTo(v.W, gy); c.stroke()
    // Distance ticks every nice step.
    const R = u * u * Math.sin(2 * a) / g
    const step = R > 40 ? 10 : R > 16 ? 5 : 2
    c.fillStyle = NL.faint; font(c, 10, 500); c.textAlign = 'center'; c.textBaseline = 'top'
    for (let x = step; v.X(x) < v.W - 10; x += step) { c.fillRect(v.X(x) - 0.5, gy, 1, 5); c.fillText(`${x} m`, v.X(x), gy + 7) }
    // Predicted path (dashed, faint) and the travelled path (glowing).
    const pr = fx.reveal('path'), pe = fx.emph('path')
    c.save(); c.setLineDash([4, 6]); c.strokeStyle = `rgba(127,178,255,${0.25 + 0.35 * pe})`; c.lineWidth = 1.5
    c.beginPath(); for (let i = 0; i <= 80; i++) { const q = pos(P, T * i / 80); if (i) c.lineTo(v.X(q.x), v.Y(Math.max(0, q.y))); else c.moveTo(v.X(q.x), v.Y(q.y)) } c.globalAlpha = pr; c.stroke(); c.restore()
    if (t > 0) {
      c.save(); c.strokeStyle = NL.field; c.lineWidth = 2.4; c.shadowColor = NL.field; c.shadowBlur = 8
      c.beginPath(); for (let i = 0; i <= 60; i++) { const q = pos(P, t * i / 60); if (i) c.lineTo(v.X(q.x), v.Y(Math.max(0, q.y))); else c.moveTo(v.X(q.x), v.Y(q.y)) } c.stroke(); c.restore()
    }
    // Strobe ghosts.
    s.trail.forEach((q, i) => { if (i * 0.1 > t - 0.05) return; c.fillStyle = `rgba(255,209,102,${0.18 + 0.2 * (i / Math.max(1, s.trail.length))})`; c.beginPath(); c.arc(v.X(q.x), v.Y(q.y), 4, 0, Math.PI * 2); c.fill() })
    // Apex.
    const ta = u * Math.sin(a) / g, ap = pos(P, ta)
    const ae = fx.emph('apex')
    if (t >= ta - 0.02 || ae > 0) {
      const ax = v.X(ap.x), ay = v.Y(ap.y)
      halo(c, ax, ay, 26, NL.goldRgb, ae)
      c.save(); c.setLineDash([2, 4]); c.strokeStyle = 'rgba(232,236,243,0.35)'; c.lineWidth = 1; c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax, gy); c.stroke(); c.restore()
      c.fillStyle = ae > 0.05 ? NL.gold : NL.muted; font(c, 11, 700); c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText('vy = 0', ax, ay - 12)
    }
    // Launcher (a short barrel at the angle).
    const le = fx.emph('launcher'), lr = fx.reveal('launcher')
    c.save(); c.globalAlpha = Math.max(0.25, lr)
    const lx = v.X(0), ly = gy, bl = 26
    if (le > 0) halo(c, lx, ly, 34, NL.goldRgb, le)
    c.translate(lx, ly); c.rotate(-a)
    const bg = c.createLinearGradient(0, -6, 0, 6); bg.addColorStop(0, '#C6CEE0'); bg.addColorStop(1, '#5D6884')
    c.fillStyle = bg; c.beginPath(); c.roundRect(-4, -6, bl, 12, 4); c.fill()
    c.restore()
    c.fillStyle = '#3A4560'; c.beginPath(); c.arc(lx, ly, 9, Math.PI, 0); c.fill()
    // Angle arc.
    c.strokeStyle = 'rgba(232,236,243,0.5)'; c.lineWidth = 1.2; c.beginPath(); c.arc(lx, ly, 38, -a, 0); c.stroke()
    c.fillStyle = NL.muted; font(c, 11, 600); c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText(`${Math.round(num(P, 'angle'))}°`, lx + 42, ly - 4)
    // Ball + velocity vectors.
    const bx = v.X(p.x), by = v.Y(Math.max(0, p.y))
    const be = fx.emph('ball')
    if (be > 0) halo(c, bx, by, 30, NL.goldRgb, be)
    const k = (v.W * 0.26) / u
    const vr = fx.reveal('velocity'), ce = fx.emph('components')
    if (s.land < 1 && (t > 0 || P.__owned)) {
      if (P.show_components !== false) {
        arrow(c, bx, by, bx + p.vx * k, by, { color: NL.field, w: 2.4 + ce, glow: 6 + 10 * ce, alpha: vr })
        arrow(c, bx, by, bx, by - p.vy * k, { color: NL.gold, w: 2.4 + ce, glow: 6 + 10 * ce, alpha: vr })
        if (ce > 0.05 || vr > 0.95) {
          c.save(); c.globalAlpha = vr; font(c, 11, 700); c.textBaseline = 'middle'
          c.fillStyle = NL.field; c.textAlign = 'left'; c.fillText('vx', bx + p.vx * k + 6, by + 10)
          if (Math.abs(p.vy) * k > 20) { c.fillStyle = NL.gold; c.fillText('vy', bx + 8, by - p.vy * k * 0.6) }
          c.restore()
        }
      }
      arrow(c, bx, by, bx + p.vx * k, by - p.vy * k, { color: 'rgba(232,236,243,0.9)', w: 1.8, alpha: vr * 0.8 })
    }
    body(c, bx, by - 8, 8, { ball: true })
  },
  anchors: (s, P, v) => {
    const T = flightT(P), t = Math.min(s.tf, T), p = pos(P, t), u = num(P, 'speed'), g = num(P, 'gravity'), a = deg(P)
    const ap = pos(P, u * Math.sin(a) / g)
    return {
      ball: { x: v.X(p.x), y: v.Y(Math.max(0, p.y)) - 8, r: 10 },
      path: { x: v.X(ap.x * 1.5), y: v.Y(pos(P, T * 0.75).y), r: 4 },
      apex: { x: v.X(ap.x), y: v.Y(ap.y), r: 8 },
      launcher: { x: v.X(0), y: v.Y(0), r: 26 },
      velocity: { x: v.X(p.x), y: v.Y(Math.max(0, p.y)), r: 16 },
      components: { x: v.X(p.x), y: v.Y(Math.max(0, p.y)), r: 16 },
      equations: { x: v.W / 2, y: v.SH - 4, r: 2 },
    }
  },
  hit: (s, P, v, x, y) => Math.hypot(x - v.X(0), y - v.Y(0)) < 56,
  drag: (s, P, v, x, y) => Math.max(10, Math.min(80, Math.atan2(v.Y(0) - y, Math.max(1, x - v.X(0))) * 180 / Math.PI)),
  readouts: (s, P) => {
    const T = flightT(P), t = Math.min(s.tf, T), p = pos(P, t)
    return [
      { label: 'Time', value: `${t.toFixed(2)} s`, color: NL.text },
      { label: 'Height', value: `${Math.max(0, p.y).toFixed(1)} m`, color: NL.text },
      { label: 'vy', value: `${p.vy.toFixed(1)} m/s`, color: NL.gold },
    ]
  },
  drawPlot: (c, s, P, v, fx) => {
    const T = flightT(P), t = Math.min(s.tf, T), u = num(P, 'speed'), a = deg(P), g = num(P, 'gravity'), p = pos(P, t)
    const e = fx.emph('equations')
    const y0 = v.SH
    if (e > 0) { c.fillStyle = `rgba(255,209,102,${0.08 * e})`; c.fillRect(0, y0, v.W, v.PH) }
    const size = v.W < 360 ? 11 : 12
    c.font = `600 ${size}px ${MONO}`; c.textBaseline = 'middle'; c.textAlign = 'left'
    const l1 = `x = ${(u * Math.cos(a)).toFixed(1)}·t = ${p.x.toFixed(1)} m`
    const l2 = `y = ${(u * Math.sin(a)).toFixed(1)}·t − ${(g / 2).toFixed(1)}·t² = ${Math.max(0, p.y).toFixed(1)} m`
    c.fillStyle = NL.field; c.fillText(l1, 14, y0 + v.PH * 0.32)
    c.fillStyle = e > 0.05 ? NL.gold : NL.text; c.fillText(l2, 14, y0 + v.PH * 0.68)
  },
  yourTurn: 'Your turn: drag the launcher or move a slider',
}

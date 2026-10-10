/**
 * Blood flow through the heart (front view: the body's right side on the screen's left). One cardiac cycle repeats:
 * atrial systole (atria squeeze, tricuspid/mitral open), ventricular systole (AV valves shut, pulmonary/aortic valves
 * open, ventricles eject), diastole (everything relaxes and fills). Blood cells follow the real route: body → vena
 * cava → right atrium → right ventricle → pulmonary artery → lungs → pulmonary veins → left atrium → left ventricle →
 * aorta → body, and queue at a valve while it is shut. Deoxygenated blue, oxygenated red.
 */
import { font, halo, num, rng, stageBackground, type KindRuntime, type Params } from '../engine'
import { along, polyLen, type Pt } from '../primitives'
import { NL } from '../tokens'
import type { KindInfo } from '../types'

export const HEART_INFO: KindInfo = {
  id: 'heart',
  blurb: 'blood flow through the heart: 4 chambers, valves opening/closing by phase, blue blood body → right atrium → right ventricle → lungs, red blood lungs → left atrium → left ventricle → aorta; bpm and slow-motion sliders',
  params: {
    bpm: { type: 'number', min: 40, max: 180, default: 70, step: 1, label: 'Heart rate', unit: 'bpm' },
    slow_motion: { type: 'number', min: 0.15, max: 1, default: 0.35, step: 0.05, label: 'Playback speed' },
    show: { type: 'enum', options: ['both', 'right', 'left'], default: 'both', label: 'Which side' },
  },
  targets: ['right_atrium', 'right_ventricle', 'left_atrium', 'left_ventricle', 'valves', 'aorta', 'pulmonary_artery', 'vena_cava', 'pulmonary_veins', 'septum'],
  example: {
    title: 'How blood flows through the heart',
    params: { bpm: 70, slow_motion: 0.35, show: 'both' },
    beats: [
      { do: 'highlight', target: 'vena_cava', dur: 2.2, caption: 'Blue blood from the body enters the RA' },
      { do: 'highlight', target: 'right_ventricle', dur: 2.4, caption: 'RV pumps it to the lungs for oxygen' },
      { do: 'highlight', target: 'left_atrium', dur: 2.2, caption: 'Red blood returns to the left atrium' },
      { do: 'highlight', target: 'left_ventricle', dur: 2.4, caption: 'Thick LV pumps it out round the body' },
      { do: 'pulse', target: 'valves', dur: 2.4, caption: 'Valves shut behind the blood: one way' },
    ],
    controls: [{ param: 'bpm' }],
    labels: [],
    drag: false,
    alt: 'A heart cut open from the front: blue blood flows from the body into the right atrium and ventricle and out to the lungs; red blood returns into the left atrium and ventricle and is pumped out through the aorta; the valves open and shut in turn.',
  },
}

const DEOXY_A: Pt[] = [[-1.55, 3.15], [-1.5, 1.7], [-1.35, 0.85], [-1.1, 0.12], [-1.0, -0.75], [-0.95, -1.65], [-0.62, -1.0], [-0.45, -0.3], [-0.32, 1.2], [-0.38, 2.25], [-1.25, 2.7], [-2.85, 2.8]]
const DEOXY_B: Pt[] = [[-2.75, -2.0], [-2.3, -0.4], [-1.65, 0.45], [-1.1, 0.12], [-1.0, -0.75], [-0.95, -1.65], [-0.62, -1.0], [-0.45, -0.3], [-0.32, 1.2], [-0.38, 2.25], [-1.25, 2.7], [-2.85, 2.8]]
const OXY: Pt[] = [[2.95, 0.62], [1.95, 0.8], [1.2, 0.72], [0.95, 0.12], [0.95, -0.9], [0.9, -1.95], [0.6, -1.15], [0.4, -0.3], [0.3, 1.2], [0.42, 2.4], [1.3, 2.9], [2.15, 2.45], [2.35, 1.75]]
/** Arc length at the AV valve (index 3) and the semilunar valve (index 7). */
const gate = (p: Pt[], k: number) => polyLen(p.slice(0, k + 1))
const PATHS = [DEOXY_A, DEOXY_B, OXY].map(p => ({ p, L: polyLen(p), av: gate(p, 3), sl: gate(p, 7), atr: gate(p, 2) }))

interface Cell { k: number; s: number; j: number }
interface S { cells: Cell[]; ph: number; clock: number }

const phase = (s: S) => s.ph % 1
const isAtrial = (f: number) => f < 0.14
const isVent = (f: number) => f >= 0.16 && f < 0.48
const avOpen = (f: number) => f < 0.15 || f > 0.5
const slOpen = (f: number) => f > 0.17 && f < 0.47
const sqz = (f: number, a: number, b: number) => (f >= a && f < b ? Math.sin(Math.PI * (f - a) / (b - a)) : 0)

const VEIN_BLUE = '#3E57A8', ART_RED = '#B8434F'

function tubeW(c: CanvasRenderingContext2D, pts: [number, number][], w: number, col: string, emph: number) {
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round'
  const path = () => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))) }
  if (emph > 0) { c.shadowColor = NL.gold; c.shadowBlur = 22 * emph }
  path(); c.strokeStyle = emph > 0.05 ? `rgba(255,209,102,${0.6 + 0.4 * emph})` : 'rgba(0,0,0,0.5)'; c.lineWidth = w + 4; c.stroke()
  c.shadowBlur = 0
  path(); c.strokeStyle = col; c.lineWidth = w; c.stroke()
  path(); c.strokeStyle = 'rgba(10,8,16,0.55)'; c.lineWidth = w * 0.55; c.stroke()
  c.restore()
}

export const heart: KindRuntime<S> = {
  info: HEART_INFO,
  aspect: 0.98,
  plot: 0,
  world: () => ({ x0: -3.05, x1: 3.05, y0: -3.15, y1: 3.2 }),
  init: () => {
    const r = rng(9)
    const cells: Cell[] = []
    for (let i = 0; i < 64; i++) { const k = i % 3; cells.push({ k, s: r() * PATHS[k].L, j: (r() - 0.5) * 2 }) }
    return { cells, ph: 0.55, clock: 0 }
  },
  step: (s, P, dt) => {
    const rate = num(P, 'bpm') / 60 * num(P, 'slow_motion')
    s.ph += dt * rate
    s.clock += dt
    const f = phase(s), sp = Math.max(0.6, rate * 1.6)
    // Advance each cell by the region it is in; valves that are shut hold the cells in a queue behind them.
    const order = [...s.cells].sort((a, b) => b.s - a.s)
    for (const c of order) {
      const P2 = PATHS[c.k]
      let v: number
      if (c.s < P2.atr) v = 0.45
      else if (c.s < P2.av) v = isAtrial(f) ? 1.7 : avOpen(f) ? 0.55 : 0.15
      else if (c.s < P2.sl) v = isVent(f) ? 2.4 : 0.22
      else v = slOpen(f) ? 2.0 : 0.7
      let ns = c.s + v * sp * dt
      if (c.s < P2.av && ns >= P2.av && !avOpen(f)) ns = P2.av - 0.06 - Math.abs(c.j) * 0.12
      if (c.s < P2.sl && ns >= P2.sl && !slOpen(f)) ns = P2.sl - 0.05 - Math.abs(c.j) * 0.12
      if (ns > P2.L) c.s = ns - P2.L
      else c.s = Math.max(c.s, ns)
    }
  },
  draw: (c, s, P, v, fx) => {
    stageBackground(c, v, 0.5, 0.45)
    const f = phase(s)
    const S2 = (p: Pt): [number, number] => [v.X(p[0]), v.Y(p[1])]
    const u = v.u
    const em = (k: string) => fx.emph(k)
    // Vessels behind the heart body (the pulmonary trunk passes behind the vena cava).
    tubeW(c, [[-0.45, -0.3], [-0.32, 1.2], [-0.38, 2.25], [-1.25, 2.7], [-2.85, 2.8]].map(p => S2(p as Pt)), 0.42 * u, '#4A63B8', em('pulmonary_artery'))
    tubeW(c, [[-1.55, 3.15], [-1.5, 1.4]].map(p => S2(p as Pt)), 0.42 * u, VEIN_BLUE, em('vena_cava'))
    tubeW(c, [[-2.75, -2.0], [-2.3, -0.4], [-1.8, 0.25]].map(p => S2(p as Pt)), 0.4 * u, VEIN_BLUE, em('vena_cava'))
    tubeW(c, [[2.95, 0.62], [1.8, 0.8]].map(p => S2(p as Pt)), 0.3 * u, '#B8434F', em('pulmonary_veins'))
    tubeW(c, [[0.4, -0.3], [0.3, 1.2], [0.42, 2.4], [1.3, 2.9], [2.15, 2.45], [2.35, 1.75]].map(p => S2(p as Pt)), 0.5 * u, ART_RED, em('aorta'))
    // Heart body (myocardium): one organic outline.
    const body: Pt[] = [[-2.15, 1.35], [-2.45, 0.2], [-2.0, -1.4], [-0.6, -2.7], [0.55, -3.0], [1.75, -2.2], [2.35, -0.6], [2.25, 0.85], [1.75, 1.45], [0.6, 1.1], [-0.6, 1.25], [-1.4, 1.55]]
    const beat = 1 - 0.035 * sqz(f, 0.16, 0.48)
    const ctr: Pt = [0, -0.6]
    const bp = body.map(([x, y]) => S2([ctr[0] + (x - ctr[0]) * beat, ctr[1] + (y - ctr[1]) * beat]))
    c.save(); c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 24; c.shadowOffsetY = 6
    const g = c.createRadialGradient(v.X(-0.6), v.Y(0.4), 10, v.X(0), v.Y(-0.8), 3.4 * u)
    g.addColorStop(0, '#D06A79'); g.addColorStop(0.6, NL.tissue); g.addColorStop(1, NL.tissueD)
    c.fillStyle = g; c.beginPath()
    // Smooth closed curve through the body points (quadratic midpoints).
    for (let i = 0; i < bp.length; i++) { const a = bp[i], b = bp[(i + 1) % bp.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (i === 0) { const z = bp[bp.length - 1]; c.moveTo((z[0] + a[0]) / 2, (z[1] + a[1]) / 2) } c.quadraticCurveTo(a[0], a[1], m[0], m[1]) }
    c.closePath(); c.fill(); c.restore()
    c.strokeStyle = 'rgba(255,190,200,0.18)'; c.lineWidth = 1.5; c.stroke()
    // Chambers (cavities), squeezing in their own phase.
    const ch = (key: string, cx: number, cy: number, rx: number, ry: number, k: number, col: string, tip = 0) => {
      const e = em(key), X = v.X(cx), Y = v.Y(cy)
      c.save(); c.translate(X, Y); c.scale(k, k)
      c.beginPath()
      // A rounded shape that narrows towards the bottom when tip > 0 (ventricles).
      for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2; const sy = Math.sin(a), sx = Math.cos(a); const nar = sy < 0 ? 1 - tip * (-sy) * 0.55 : 1; const x = sx * rx * u * nar, y = -sy * ry * u; if (i) c.lineTo(x, y); else c.moveTo(x, y) }
      c.closePath()
      const gg = c.createRadialGradient(0, 0, 2, 0, 0, Math.max(rx, ry) * u)
      gg.addColorStop(0, col); gg.addColorStop(1, '#1A0F1C')
      c.fillStyle = gg; c.fill()
      c.lineWidth = 2.2; c.strokeStyle = e > 0.05 ? `rgba(255,209,102,${0.5 + 0.5 * e})` : 'rgba(40,10,20,0.6)'
      if (e > 0) { c.shadowColor = NL.gold; c.shadowBlur = 18 * e }
      c.stroke(); c.restore()
    }
    const sa = 1 - 0.08 * sqz(f, 0, 0.14), sv = 1 - 0.09 * sqz(f, 0.16, 0.48)
    ch('right_atrium', -1.3, 0.72, 0.78, 0.55, sa, '#2C2F57')
    ch('left_atrium', 1.22, 0.78, 0.72, 0.48, sa, '#4F2433')
    ch('right_ventricle', -1.0, -1.05, 0.78, 0.9, sv, '#262A50', 0.5)
    ch('left_ventricle', 0.92, -1.2, 0.6, 1.05, sv, '#4A2030', 0.55)
    // Septum.
    const se = em('septum')
    c.save(); c.strokeStyle = se > 0.05 ? NL.gold : 'rgba(255,190,200,0.22)'; c.lineWidth = 2 + 2 * se; c.setLineDash([3, 5])
    c.beginPath(); c.moveTo(v.X(-0.02), v.Y(1.05)); c.quadraticCurveTo(v.X(0.05), v.Y(-1.0), v.X(0.3), v.Y(-2.55)); c.stroke(); c.restore()
    // Valves: AV (horizontal pairs of leaflets), semilunar (in the artery roots).
    const ve = em('valves')
    const av = avOpen(f) ? 1 : 0, sl = slOpen(f) ? 1 : 0
    const leaflets = (cx: number, cy: number, w: number, open: number, rot: number) => {
      const X = v.X(cx), Y = v.Y(cy), L = w * u / 2
      c.save(); c.translate(X, Y); c.rotate(rot)
      if (ve > 0) { c.shadowColor = NL.gold; c.shadowBlur = 14 * ve }
      c.strokeStyle = ve > 0.05 ? NL.gold : '#F2D7DC'; c.lineWidth = 3; c.lineCap = 'round'
      const ang = open ? 1.25 : 0.08
      c.beginPath(); c.moveTo(-L, 0); c.lineTo(-L + Math.cos(ang) * L * 0.98, Math.sin(ang) * L * 0.98)
      c.moveTo(L, 0); c.lineTo(L - Math.cos(ang) * L * 0.98, Math.sin(ang) * L * 0.98); c.stroke()
      c.restore()
    }
    leaflets(-1.08, 0.13, 0.95, av, 0.05)
    leaflets(0.95, 0.13, 0.8, av, -0.05)
    leaflets(-0.43, -0.22, 0.44, sl, Math.PI + 0.1)
    leaflets(0.39, -0.22, 0.5, sl, Math.PI - 0.1)
    // Blood cells.
    const show = String(P.show ?? 'both')
    for (const cell of s.cells) {
      if ((show === 'right' && cell.k === 2) || (show === 'left' && cell.k !== 2)) continue
      const P2 = PATHS[cell.k]
      const a = along(P2.p, cell.s / P2.L)
      const inCh = cell.s > P2.atr - 0.3 && cell.s < P2.sl + 0.1
      const off = cell.j * (inCh ? 0.26 : 0.09) * u
      const x = v.X(a.x) - Math.sin(-a.ang) * off, y = v.Y(a.y) - Math.cos(-a.ang) * off
      const oxy = cell.k === 2
      const col = oxy ? NL.oxy : NL.deoxy
      c.save(); c.shadowColor = col; c.shadowBlur = 8
      c.fillStyle = col; c.beginPath(); c.ellipse(x, y, 4.6, 3.4, a.ang, 0, Math.PI * 2); c.fill()
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.ellipse(x - 1, y - 1, 1.8, 1.2, a.ang, 0, Math.PI * 2); c.fill()
      c.restore()
    }
    // Way-finding words at the vessel ends (fixed, small).
    font(c, 10.5, 600); c.fillStyle = NL.muted; c.textBaseline = 'middle'
    c.textAlign = 'left'; c.fillText('to lungs', v.X(-2.95), v.Y(2.33))
    c.textAlign = 'right'; c.fillText('from body', v.X(-1.9), v.Y(3.08))
    c.textAlign = 'right'; c.fillText('from lungs', v.X(2.98), v.Y(0.98))
    c.textAlign = 'center'; c.fillText('from body', v.X(-2.45), v.Y(-2.42))
    c.textAlign = 'left'; c.fillText('to body', v.X(2.62), v.Y(1.62))
    // Phase chip (what the heart is doing now).
    const label = isAtrial(f) ? 'atria squeeze' : isVent(f) ? 'ventricles squeeze' : 'relax and fill'
    font(c, 11, 700)
    const w = c.measureText(label).width + 16, x0 = v.W - w - 10, y0 = v.SH - 30
    halo(c, x0 + w / 2, y0 + 10, w * 0.6, NL.goldRgb, isVent(f) || isAtrial(f) ? 0.5 : 0)
    c.fillStyle = 'rgba(14,19,34,0.85)'; c.strokeStyle = 'rgba(255,209,102,0.45)'; c.lineWidth = 1
    c.beginPath(); c.roundRect(x0, y0, w, 20, 10); c.fill(); c.stroke()
    c.fillStyle = NL.gold; c.textAlign = 'left'; c.fillText(label, x0 + 8, y0 + 10.5)
  },
  anchors: (s, P, v) => ({
    right_atrium: { x: v.X(-1.3), y: v.Y(0.72), r: 0.5 * v.u },
    left_atrium: { x: v.X(1.22), y: v.Y(0.78), r: 0.45 * v.u },
    right_ventricle: { x: v.X(-1.0), y: v.Y(-1.05), r: 0.6 * v.u },
    left_ventricle: { x: v.X(0.92), y: v.Y(-1.2), r: 0.55 * v.u },
    valves: { x: v.X(-1.08), y: v.Y(0.13), r: 8 },
    aorta: { x: v.X(1.3), y: v.Y(2.9), r: 0.25 * v.u },
    pulmonary_artery: { x: v.X(-1.25), y: v.Y(2.7), r: 0.22 * v.u },
    vena_cava: { x: v.X(-1.52), y: v.Y(2.2), r: 0.22 * v.u },
    pulmonary_veins: { x: v.X(2.5), y: v.Y(0.66), r: 0.16 * v.u },
    septum: { x: v.X(0.08), y: v.Y(-0.9), r: 4 },
  }),
  keepouts: (s, P, v) => [{ x: v.X(-2.3), y: v.Y(1.5), w: v.X(2.3) - v.X(-2.3), h: v.Y(-2.8) - v.Y(1.5) }],
  readouts: (s, P) => [
    { label: 'Heart rate', value: `${num(P, 'bpm').toFixed(0)} bpm`, color: NL.text },
    { label: 'Now', value: isAtrial(phase(s)) ? 'atria squeeze' : isVent(phase(s)) ? 'ventricles squeeze' : 'relax, fill', color: NL.gold },
  ],
}
export type { Params }

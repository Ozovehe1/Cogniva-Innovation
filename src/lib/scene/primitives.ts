/**
 * The primitive vocabulary: every scene kind is composed from these, so every scene shares one look (Night Lab).
 * Each primitive draws in screen px on a Canvas2D context and takes semantic options (no colours from specs). The
 * registry lets the catalogue/tests enumerate them; kinds call the functions directly.
 */
import { arrow, arrowHead, font, glow, halo } from './engine'
import { FONT, NL } from './tokens'

type C = CanvasRenderingContext2D
export type Pt = [number, number]

/** Bar magnet: S (blue) | N (red), rounded, top highlight, drop shadow. `angle` rotates it (radians). */
export function magnet(c: C, cx: number, cy: number, L: number, T: number, o: { flip?: boolean; angle?: number; letters?: boolean; alpha?: number } = {}) {
  c.save(); c.translate(cx, cy); if (o.angle) c.rotate(o.angle); c.globalAlpha = o.alpha ?? 1
  const x = -L / 2, y = -T / 2, r = Math.min(7, T * 0.25)
  const left = o.flip ? 'N' : 'S'
  const g = (top: string, mid: string, bot: string) => { const q = c.createLinearGradient(0, y, 0, y + T); q.addColorStop(0, top); q.addColorStop(0.5, mid); q.addColorStop(1, bot); return q }
  const gS = g('#7FAEFF', NL.south, '#2C5BB8'), gN = g('#FF9C8F', NL.north, '#C23B30')
  c.save(); c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 14; c.shadowOffsetY = 4
  c.beginPath(); c.roundRect(x, y, L / 2, T, [r, 0, 0, r]); c.fillStyle = left === 'S' ? gS : gN; c.fill()
  c.beginPath(); c.roundRect(x + L / 2, y, L / 2, T, [0, r, r, 0]); c.fillStyle = left === 'S' ? gN : gS; c.fill()
  c.restore()
  c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(x + 3, y + 2, L - 6, T * 0.2)
  if (o.letters !== false) {
    c.fillStyle = '#fff'; font(c, Math.max(11, Math.round(Math.min(T * 0.6, L * 0.22))), 700); c.textAlign = 'center'; c.textBaseline = 'middle'
    c.fillText(left, x + L / 4, 1); c.fillText(left === 'S' ? 'N' : 'S', x + (3 * L) / 4, 1)
  }
  c.restore()
}

/** A magnet pole block (motor/generator): a tall rounded block with its letter, facing in. */
export function poleBlock(c: C, x: number, y: number, w: number, h: number, pole: 'N' | 'S') {
  const base = pole === 'N' ? NL.north : NL.south
  const g = c.createLinearGradient(x, 0, x + w, 0)
  if (pole === 'N') { g.addColorStop(0, '#C23B30'); g.addColorStop(0.6, base); g.addColorStop(1, '#FF9C8F') } else { g.addColorStop(0, '#7FAEFF'); g.addColorStop(0.4, base); g.addColorStop(1, '#2C5BB8') }
  c.save(); c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 16; c.shadowOffsetY = 5
  c.fillStyle = g; c.beginPath(); c.roundRect(x, y, w, h, 8); c.fill(); c.restore()
  c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(x + 4, y + 3, w - 8, 5)
  c.fillStyle = '#fff'; font(c, Math.max(13, Math.min(22, w * 0.5)), 700); c.textAlign = 'center'; c.textBaseline = 'middle'
  c.fillText(pole, x + w / 2, y + h / 2)
}

/** One half of a coil's turns (ellipses): back halves first (under), front halves after (over); front glows with I. */
export function coilHalf(c: C, xs: number[], cy: number, rx: number, ry: number, front: boolean, o: { current?: number; phase?: number } = {}) {
  for (const cx of xs) {
    c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, front ? -Math.PI / 2 : Math.PI / 2, front ? Math.PI / 2 : (3 * Math.PI) / 2)
    c.lineCap = 'round'; c.lineWidth = front ? 3.4 : 2.6; c.strokeStyle = front ? NL.copper : NL.copperD; c.stroke()
    if (!front) continue
    c.lineWidth = 1; c.strokeStyle = NL.copperHi
    c.beginPath(); c.ellipse(cx - 1, cy, rx, ry * 0.96, 0, -Math.PI / 2.4, Math.PI / 2.4); c.stroke()
    const a = Math.min(1, Math.abs(o.current ?? 0))
    if (a > 0.03) {
      c.save(); c.shadowColor = NL.gold; c.shadowBlur = 12 * a; c.setLineDash([3, 9]); c.lineDashOffset = -(o.phase ?? 0) * 30
      c.strokeStyle = `rgba(${NL.goldRgb},${0.25 + 0.75 * a})`; c.lineWidth = 2.6
      c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, -Math.PI / 2, Math.PI / 2); c.stroke(); c.restore()
    }
  }
}

/** A copper wire along a polyline; when a current flows, gold dashes travel along it (speed ∝ current). */
export function wire(c: C, pts: Pt[], o: { current?: number; phase?: number; w?: number; dim?: boolean } = {}) {
  if (pts.length < 2) return
  const path = () => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))) }
  c.save(); c.lineJoin = 'round'; c.lineCap = 'round'
  path(); c.strokeStyle = NL.copperD; c.lineWidth = (o.w ?? 3) + 1.6; c.stroke()
  path(); c.strokeStyle = o.dim ? '#9A6440' : NL.copper; c.lineWidth = o.w ?? 3; c.stroke()
  const a = Math.min(1, Math.abs(o.current ?? 0))
  if (a > 0.03) {
    path(); c.shadowColor = NL.gold; c.shadowBlur = 10 * a; c.setLineDash([3, 10]); c.lineDashOffset = -(o.phase ?? 0) * 30
    c.strokeStyle = `rgba(${NL.goldRgb},${0.3 + 0.7 * a})`; c.lineWidth = 2.4; c.stroke()
  }
  c.restore()
}

/** Points along a polyline at arc-length fraction f (0..1). */
export function along(pts: Pt[], f: number): { x: number; y: number; ang: number } {
  const seg: number[] = []; let L = 0
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L += d }
  let s = ((f % 1) + 1) % 1 * L
  for (let i = 0; i < seg.length; i++) {
    if (s <= seg[i] || i === seg.length - 1) {
      const u = seg[i] ? Math.min(1, s / seg[i]) : 0
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]
      return { x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u, ang: Math.atan2(y1 - y0, x1 - x0) }
    }
    s -= seg[i]
  }
  return { x: pts[0][0], y: pts[0][1], ang: 0 }
}
export const polyLen = (pts: Pt[]) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0)

/** Cell / battery: long thin plate (+) and short thick plate (−), with signs. Vertical when `vertical`. */
export function battery(c: C, x: number, y: number, o: { vertical?: boolean; size?: number; glow?: number; label?: string } = {}) {
  const s = o.size ?? 22
  c.save(); c.translate(x, y); if (o.vertical) c.rotate(Math.PI / 2)
  halo(c, 0, 0, s * 1.6, NL.goldRgb, o.glow ?? 0)
  c.fillStyle = NL.bg; c.fillRect(-s * 0.55, -s, s * 1.1, s * 2)
  c.strokeStyle = NL.text; c.lineCap = 'round'
  c.lineWidth = 2.4; c.beginPath(); c.moveTo(-s * 0.22, -s * 0.95); c.lineTo(-s * 0.22, s * 0.95); c.stroke()
  c.lineWidth = 5.5; c.beginPath(); c.moveTo(s * 0.22, -s * 0.5); c.lineTo(s * 0.22, s * 0.5); c.stroke()
  c.restore()
  c.save(); c.fillStyle = NL.muted; font(c, 12, 700); c.textAlign = 'center'; c.textBaseline = 'middle'
  const ox = o.vertical ? s * 0.95 : 0, oy = o.vertical ? 0 : -s * 1.25
  if (o.vertical) { c.fillText('+', x - ox - 4, y - s * 0.24); c.fillText('−', x - ox - 4, y + s * 0.26) } else { c.fillText('+', x - s * 0.55, y + oy); c.fillText('−', x + s * 0.6, y + oy) }
  c.restore()
}

/** A real cell (cylinder): steel body, gold + cap with a nub, − at the flat end; vertical puts + on top. */
export function cellBattery(c: C, x: number, y: number, len: number, thick: number, o: { vertical?: boolean; glow?: number } = {}) {
  c.save(); c.translate(x, y); if (o.vertical) c.rotate(-Math.PI / 2)
  halo(c, 0, 0, len * 0.9, NL.goldRgb, o.glow ?? 0)
  const L = len, T = thick
  c.save(); c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 10; c.shadowOffsetY = 3
  const g = c.createLinearGradient(0, -T / 2, 0, T / 2); g.addColorStop(0, '#9AA6BF'); g.addColorStop(0.35, '#3A4560'); g.addColorStop(1, '#1C2233')
  c.fillStyle = g; c.beginPath(); c.roundRect(-L / 2, -T / 2, L, T, 4); c.fill(); c.restore()
  const gg = c.createLinearGradient(0, -T / 2, 0, T / 2); gg.addColorStop(0, '#FFE6A3'); gg.addColorStop(0.4, NL.gold); gg.addColorStop(1, '#9C7520')
  c.fillStyle = gg; c.beginPath(); c.roundRect(L / 2 - L * 0.3, -T / 2, L * 0.3, T, [0, 4, 4, 0]); c.fill()
  c.fillStyle = '#C9CED9'; c.beginPath(); c.roundRect(L / 2, -T * 0.18, 4, T * 0.36, 1.5); c.fill()
  c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(-L / 2 + 3, -T / 2 + 2, L - 6, T * 0.16)
  c.rotate(o.vertical ? Math.PI / 2 : 0)
  c.fillStyle = '#3A2A00'; font(c, Math.max(10, T * 0.62), 800); c.textAlign = 'center'; c.textBaseline = 'middle'
  const px = o.vertical ? 0 : L / 2 - L * 0.15, py = o.vertical ? -(L / 2 - L * 0.15) : 0
  c.fillText('+', px, py + 0.5)
  c.fillStyle = NL.text; const mx = o.vertical ? 0 : -L / 2 + L * 0.18, my = o.vertical ? L / 2 - L * 0.18 : 0
  c.fillText('−', mx, my + 0.5)
  c.restore()
}

/** Resistor: a zigzag (IEC box looks flat on dark): heats (glow) with power. */
export function resistor(c: C, x0: number, y: number, x1: number, o: { heat?: number; vertical?: boolean } = {}) {
  const n = 6, L = x1 - x0, amp = 7
  c.save()
  halo(c, (x0 + x1) / 2, y, L * 0.8, '255,140,90', o.heat ?? 0)
  c.strokeStyle = NL.bg; c.lineWidth = 8; c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke()
  c.beginPath(); c.moveTo(x0, y)
  for (let i = 0; i < n; i++) c.lineTo(x0 + L * (i + 0.5) / n, y + (i % 2 ? amp : -amp))
  c.lineTo(x1, y)
  const h = Math.min(1, o.heat ?? 0)
  c.strokeStyle = h > 0.05 ? `rgb(${Math.round(217 + 38 * h)},${Math.round(134 - 30 * h)},${Math.round(74 - 30 * h)})` : NL.copper
  c.lineWidth = 2.6; c.lineJoin = 'round'; c.stroke()
  c.restore()
}

/** Bulb: glass circle with a filament; brightness 0..1 glows gold. */
export function bulb(c: C, x: number, y: number, r: number, bright: number) {
  const b = Math.max(0, Math.min(1, bright))
  halo(c, x, y, r * (2.2 + 2 * b), NL.goldRgb, b)
  c.save()
  c.fillStyle = b > 0.02 ? `rgba(255,${Math.round(220 + 20 * b)},${Math.round(150 + 60 * b)},${0.15 + 0.75 * b})` : 'rgba(255,255,255,0.06)'
  c.strokeStyle = 'rgba(232,236,243,0.6)'; c.lineWidth = 1.6
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.stroke()
  c.strokeStyle = b > 0.05 ? '#FFF4C8' : NL.steel; c.lineWidth = 1.8
  if (b > 0.05) { c.shadowColor = NL.gold; c.shadowBlur = 14 * b }
  c.beginPath(); c.moveTo(x - r * 0.45, y + r * 0.5); c.lineTo(x - r * 0.3, y - r * 0.1)
  for (let i = 0; i < 4; i++) c.lineTo(x - r * 0.3 + (i + 1) * r * 0.15, y - r * 0.1 + (i % 2 ? 0 : -r * 0.18))
  c.lineTo(x + r * 0.45, y + r * 0.5); c.stroke()
  c.restore()
}

/** A charge: electron (blue, −) or positive (coral, +). */
export function charge(c: C, x: number, y: number, r: number, sign: -1 | 1, alpha = 1) {
  c.save(); c.globalAlpha = alpha
  const col = sign < 0 ? '#8FC1FF' : NL.north
  const g = c.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r)
  g.addColorStop(0, '#fff'); g.addColorStop(0.35, col); g.addColorStop(1, sign < 0 ? '#2C5BB8' : '#B83A2E')
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill()
  c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = Math.max(1.2, r * 0.28)
  c.beginPath(); c.moveTo(x - r * 0.45, y); c.lineTo(x + r * 0.45, y)
  if (sign > 0) { c.moveTo(x, y - r * 0.45); c.lineTo(x, y + r * 0.45) }
  c.stroke(); c.restore()
}

/** A dial meter (galvanometer / ammeter): cream face, ticks, springy needle (degrees), gold rim on emphasis. */
export function meter(c: C, cx: number, cy: number, R: number, needleDeg: number, o: { emph?: number; letter?: string } = {}) {
  const e = o.emph ?? 0
  c.save(); if (e > 0) { c.shadowColor = NL.gold; c.shadowBlur = 24 * e }
  c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fillStyle = NL.dial; c.fill()
  c.lineWidth = 2.5 + 2 * e; c.strokeStyle = e > 0.05 ? NL.gold : '#2A3350'; c.stroke(); c.restore()
  for (let i = -4; i <= 4; i++) {
    const an = -Math.PI / 2 + i * Math.PI / 12
    c.strokeStyle = i ? '#555' : '#111'; c.lineWidth = i ? 1 : 1.6
    c.beginPath(); c.moveTo(cx + Math.cos(an) * R * 0.72, cy + Math.sin(an) * R * 0.72); c.lineTo(cx + Math.cos(an) * R * 0.86, cy + Math.sin(an) * R * 0.86); c.stroke()
  }
  if (o.letter) { c.fillStyle = '#555'; font(c, Math.max(9, R * 0.36), 700); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(o.letter, cx, cy + R * 0.5) }
  const an = -Math.PI / 2 + needleDeg * Math.PI / 180
  c.strokeStyle = NL.needle; c.lineWidth = 2.4; c.lineCap = 'round'
  c.beginPath(); c.moveTo(cx, cy + R * 0.25); c.lineTo(cx + Math.cos(an) * R * 0.8, cy + Math.sin(an) * R * 0.8); c.stroke()
  c.fillStyle = '#14141A'; c.beginPath(); c.arc(cx, cy + R * 0.25, 3, 0, 7); c.fill()
}

/** Particles advected along a field and drawn as additive streaks (motion inside the field). */
export interface Particle { x: number; y: number; px: number; py: number; life: number; max: number }
export function streaks(c: C, ps: Particle[], X: (x: number) => number, Y: (y: number) => number, o: { rgb?: string; alpha?: number; w?: number; tail?: number }) {
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round'; c.lineWidth = o.w ?? 1.8
  for (const p of ps) {
    const fade = Math.min(1, p.life * 3, (p.max - p.life) * 2) * (o.alpha ?? 1)
    if (fade <= 0.02) continue
    c.strokeStyle = `rgba(${o.rgb ?? NL.particle},${0.55 * fade})`
    const k = o.tail ?? 5, dx = p.x - p.px, dy = p.y - p.py
    c.beginPath(); c.moveTo(X(p.x - dx * k), Y(p.y - dy * k)); c.lineTo(X(p.x), Y(p.y)); c.stroke()
  }
  c.restore()
}

/** A world polyline drawn as a field line, partially revealed, with an arrowhead at fraction `at`. */
export function fieldLine(c: C, pts: Pt[], X: (x: number) => number, Y: (y: number) => number, o: { reveal?: number; at?: number | null; alpha?: number; color?: string; w?: number }) {
  const n = Math.floor(pts.length * (o.reveal ?? 1))
  if (n < 2) return
  c.save(); c.globalAlpha = o.alpha ?? 1
  c.strokeStyle = o.color ?? NL.fieldLine; c.lineWidth = o.w ?? 1.5
  c.beginPath(); for (let i = 0; i < n; i++) { const xx = X(pts[i][0]), yy = Y(pts[i][1]); if (i) c.lineTo(xx, yy); else c.moveTo(xx, yy) } c.stroke()
  if (o.at !== null && (o.reveal ?? 1) > 0.98 && pts.length > 6) {
    const k = Math.min(pts.length - 4, Math.max(0, Math.floor(pts.length * (o.at ?? 0.35))))
    const [x1, y1] = pts[k], [x2, y2] = pts[k + 3]
    arrowHead(c, X(x1), Y(y1), Math.atan2(Y(y2) - Y(y1), X(x2) - X(x1)), 7.5, NL.fieldHi)
  }
  c.restore()
}

/** Axes with light ticks for maths scenes. */
export function axes(c: C, X: (x: number) => number, Y: (y: number) => number, box: { x0: number; x1: number; y0: number; y1: number }, o: { step?: number; labels?: boolean; labelStep?: number } = {}) {
  c.save(); c.strokeStyle = NL.grid; c.lineWidth = 1
  const st = o.step ?? 1
  for (let x = Math.ceil(box.x0 / st) * st; x <= box.x1 + 1e-9; x += st) { c.beginPath(); c.moveTo(X(x), Y(box.y0)); c.lineTo(X(x), Y(box.y1)); c.stroke() }
  for (let y = Math.ceil(box.y0 / st) * st; y <= box.y1 + 1e-9; y += st) { c.beginPath(); c.moveTo(X(box.x0), Y(y)); c.lineTo(X(box.x1), Y(y)); c.stroke() }
  c.strokeStyle = 'rgba(232,236,243,0.45)'; c.lineWidth = 1.5
  if (box.y0 <= 0 && box.y1 >= 0) { c.beginPath(); c.moveTo(X(box.x0), Y(0)); c.lineTo(X(box.x1), Y(0)); c.stroke(); arrowHead(c, X(box.x1), Y(0), 0, 7, 'rgba(232,236,243,0.6)') }
  if (box.x0 <= 0 && box.x1 >= 0) { c.beginPath(); c.moveTo(X(0), Y(box.y0)); c.lineTo(X(0), Y(box.y1)); c.stroke(); arrowHead(c, X(0), Y(box.y1), -Math.PI / 2, 7, 'rgba(232,236,243,0.6)') }
  if (o.labels !== false) {
    c.fillStyle = NL.faint; font(c, 10, 500); c.textAlign = 'center'; c.textBaseline = 'top'
    const ls = o.labelStep ?? st
    let lastX = -1e9
    for (let x = Math.ceil(box.x0 / ls) * ls; x <= box.x1; x += ls) {
      if (Math.abs(x) < 1e-9 || X(x) > X(box.x1) - 12 || X(x) - lastX < 26) continue
      lastX = X(x)
      const yy = box.y0 <= 0 && box.y1 >= 0 ? Y(0) + 4 : Y(box.y0) - 14
      c.fillText(String(Math.round(x * 100) / 100).replace('-', '−'), X(x), yy)
    }
  }
  c.restore()
}

/** A function curve y = f(x) over [x0, x1] (breaks at non-finite values), optional glow. */
export function curve(c: C, f: (x: number) => number, X: (x: number) => number, Y: (y: number) => number, x0: number, x1: number, o: { color?: string; w?: number; glow?: number; ylim?: [number, number]; upto?: number; dash?: number[] } = {}) {
  c.save(); c.strokeStyle = o.color ?? NL.field; c.lineWidth = o.w ?? 2.4; c.lineJoin = 'round'; c.lineCap = 'round'
  if (o.glow) { c.shadowColor = o.color ?? NL.field; c.shadowBlur = o.glow }
  if (o.dash) c.setLineDash(o.dash)
  const n = 220, end = o.upto ?? x1
  c.beginPath(); let pen = false
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n
    if (x > end) break
    const y = f(x)
    if (!Number.isFinite(y) || (o.ylim && (y < o.ylim[0] - 50 || y > o.ylim[1] + 50))) { pen = false; continue }
    if (pen) c.lineTo(X(x), Y(y)); else { c.moveTo(X(x), Y(y)); pen = true }
  }
  c.stroke(); c.restore()
}

/** A point: filled dot with a ring; glows when emphasised. */
export function point(c: C, x: number, y: number, o: { color?: string; r?: number; emph?: number; ring?: boolean } = {}) {
  const r = o.r ?? 6, col = o.color ?? NL.gold
  if (o.emph) halo(c, x, y, r * 5, NL.goldRgb, o.emph)
  glow(c, col, 10, () => { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill() })
  if (o.ring !== false) { c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1.8; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke() }
}

/** A body / mass: a shaded block (spring, incline) or ball. */
export function body(c: C, x: number, y: number, s: number, o: { ball?: boolean; label?: string; color?: string } = {}) {
  c.save(); c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 12; c.shadowOffsetY = 4
  if (o.ball) {
    const g = c.createRadialGradient(x - s * 0.35, y - s * 0.35, 1, x, y, s)
    g.addColorStop(0, '#FFF3D1'); g.addColorStop(0.45, o.color ?? NL.gold); g.addColorStop(1, '#B98A1C')
    c.fillStyle = g; c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill()
  } else {
    const g = c.createLinearGradient(0, y - s, 0, y + s); g.addColorStop(0, '#C6CEE0'); g.addColorStop(1, '#6C7896')
    c.fillStyle = g; c.beginPath(); c.roundRect(x - s, y - s, 2 * s, 2 * s, 5); c.fill()
  }
  c.restore()
  if (o.label) { c.fillStyle = o.ball ? '#3A2A00' : NL.bg; font(c, Math.max(10, s * 0.8), 700); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(o.label, x, y + 1) }
}

/** A spring between two points (coils count fixed, stretches). */
export function spring(c: C, x0: number, y0: number, x1: number, y1: number, o: { coils?: number; width?: number } = {}) {
  const n = o.coils ?? 10, w = o.width ?? 8, L = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0)
  c.save(); c.translate(x0, y0); c.rotate(ang)
  c.strokeStyle = NL.steel; c.lineWidth = 2; c.lineJoin = 'round'
  c.beginPath(); c.moveTo(0, 0); c.lineTo(L * 0.1, 0)
  for (let i = 0; i < n * 2; i++) c.lineTo(L * 0.1 + (L * 0.8) * (i + 0.5) / (n * 2), i % 2 ? w : -w)
  c.lineTo(L * 0.9, 0); c.lineTo(L, 0); c.stroke(); c.restore()
}

/** A pendulum: pivot, rod and bob at angle θ (radians from vertical). Returns the bob position. */
export function pendulum(c: C, px: number, py: number, L: number, theta: number, o: { r?: number } = {}): { x: number; y: number } {
  const x = px + L * Math.sin(theta), y = py + L * Math.cos(theta)
  c.save(); c.strokeStyle = NL.steelD; c.lineWidth = 5; c.beginPath(); c.moveTo(px - 26, py); c.lineTo(px + 26, py); c.stroke()
  c.strokeStyle = NL.steel; c.lineWidth = 2; c.beginPath(); c.moveTo(px, py); c.lineTo(x, y); c.stroke(); c.restore()
  body(c, x, y, o.r ?? 12, { ball: true })
  return { x, y }
}

/** An organelle-like blob: a smooth closed shape (radii jitter), membrane stroke, soft fill. */
export function blob(c: C, cx: number, cy: number, rx: number, ry: number, o: { fill: string; stroke: string; wobble?: number; seed?: number; t?: number; w?: number; alpha?: number }) {
  const n = 48, s = o.seed ?? 1, wob = o.wobble ?? 0.06, t = o.t ?? 0
  c.save(); c.globalAlpha = o.alpha ?? 1
  c.beginPath()
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const k = 1 + wob * (Math.sin(3 * a + s) * 0.6 + Math.sin(5 * a + s * 2.3 + t * 0.8) * 0.4)
    const x = cx + Math.cos(a) * rx * k, y = cy + Math.sin(a) * ry * k
    if (i) c.lineTo(x, y); else c.moveTo(x, y)
  }
  c.closePath(); c.fillStyle = o.fill; c.fill(); c.strokeStyle = o.stroke; c.lineWidth = o.w ?? 2; c.stroke()
  c.restore()
}

/** A live graph trace strip: series of [t, value] mapped into a rect, newest at the right. */
export function trace2(c: C, hist: [number, number][], rect: { x: number; y: number; w: number; h: number }, o: { t0: number; t1: number; scale: number; color: string; glow?: boolean; w?: number }) {
  if (hist.length < 2) return
  c.save(); c.beginPath(); c.rect(rect.x, rect.y, rect.w, rect.h); c.clip()
  c.strokeStyle = o.color; c.lineWidth = o.w ?? 2; c.lineJoin = 'round'
  if (o.glow) { c.shadowColor = o.color; c.shadowBlur = 6 }
  c.beginPath()
  hist.forEach(([t, v], i) => {
    const x = rect.x + (t - o.t0) / (o.t1 - o.t0) * rect.w, y = rect.y + rect.h / 2 - v * o.scale
    if (i) c.lineTo(x, y); else c.moveTo(x, y)
  })
  c.stroke(); c.restore()
}

/** Small legend text in the plot strip. */
export function legend(c: C, x: number, y: number, items: [string, string][]) {
  font(c, 11.5, 600); c.textBaseline = 'top'; c.textAlign = 'left'
  let xx = x
  for (const [t, col] of items) { c.fillStyle = col; c.fillText(t, xx, y); xx += c.measureText(t).width + 16 }
}

export { arrow, FONT }

/** The registry: name → drawing function (enumerated by the catalogue and tests). */
export const PRIMITIVES = {
  magnet, pole: poleBlock, coil: coilHalf, wire, battery, cell: cellBattery, resistor, bulb, charge, meter, particles: streaks, field_line: fieldLine,
  arrow, axes, function_curve: curve, point, body, spring, pendulum, organelle: blob, graph_trace: trace2, legend,
} as const
export type PrimitiveName = keyof typeof PRIMITIVES
const extra = new Map<string, (...a: never[]) => void>()
/** Register a new primitive (growth loop: recurring requests become primitives, written once). */
export function registerPrimitive(name: string, draw: (...a: never[]) => void) { extra.set(name, draw) }
export function primitiveNames(): string[] { return [...Object.keys(PRIMITIVES), ...extra.keys()] }

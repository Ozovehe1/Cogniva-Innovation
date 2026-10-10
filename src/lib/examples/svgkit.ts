/** Shared look for every worked-example diagram: cream paper, dark ink, deep-green current/answer accents, clay highlights. */
export const PAPER = '#FBF8F2'
export const INK = '#14141A'
export const MUTED = '#66666F'
export const ACC = '#1F4D3A'
export const FLOW = '#2E7D5B'
export const CLAY = '#A4502A'
export const HL = '#F4D35E'
export const SOFT = '#E7EFEA'

export const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const f1 = (n: number) => (Math.round(n * 10) / 10).toString()

/** Wrap an SVG body in the standard paper frame. Text sizes are in viewBox units chosen so ~16 px at 360 px wide. */
export function frame(w: number, h: number, body: string, extraCss = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f1(w)} ${f1(h)}" width="${f1(w)}" height="${f1(h)}" font-family="Inter, 'DejaVu Sans', Arial, sans-serif">
<style>line,.w{stroke:${INK};stroke-width:2.4;stroke-linecap:round;fill:none}.lbl{font-size:17px;fill:${INK};text-anchor:middle}.lbl-s{font-size:14px;fill:${MUTED};text-anchor:middle}.acc{font-size:16px;fill:${ACC};font-weight:600;text-anchor:middle}.clay{fill:${CLAY}}.flow{stroke:${FLOW};stroke-width:3.4;stroke-dasharray:1 15;stroke-linecap:round;fill:none;animation:gmflow 1s linear infinite}@keyframes gmflow{to{stroke-dashoffset:-32}}@media (prefers-reduced-motion:reduce){.flow{animation:none;stroke-dasharray:none;opacity:.35}}${extraCss}</style>
<rect width="100%" height="100%" fill="${PAPER}"/>
${body}
</svg>`
}

export function arrow(x1: number, y1: number, x2: number, y2: number, color = ACC, width = 2.6, head = 9) {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const hx = x2 - head * Math.cos(a), hy = y2 - head * Math.sin(a)
  const p1 = [hx + head * 0.5 * Math.sin(a), hy - head * 0.5 * Math.cos(a)], p2 = [hx - head * 0.5 * Math.sin(a), hy + head * 0.5 * Math.cos(a)]
  return `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(hx)}" y2="${f1(hy)}" style="stroke:${color};stroke-width:${width}"/><path d="M${f1(x2)},${f1(y2)} L${f1(p1[0])},${f1(p1[1])} L${f1(p2[0])},${f1(p2[1])} z" fill="${color}"/>`
}

export function text(x: number, y: number, s: string, cls = 'lbl', extra = '') {
  return `<text x="${f1(x)}" y="${f1(y)}" class="${cls}" ${extra}>${esc(s)}</text>`
}

/** Unicode subscript for labels in SVG (R23 -> R₂₃, R_eq -> R_eq kept readable). */
export function sub(id: string) {
  const m = /^([A-Za-z]+)_?([0-9]+)$/.exec(id)
  if (!m) return id.replace(/_eq$/, 'ₑq')
  return m[1] + [...m[2]].map(c => '₀₁₂₃₄₅₆₇₈₉'[Number(c)]).join('')
}

/* ───────── label placement with a collision check ───────── */

type Box = { x: number; y: number; w: number; h: number }
const SIZE: Record<string, { fs: number; k: number }> = { lbl: { fs: 17, k: 0.6 }, 'lbl-s': { fs: 14, k: 0.58 }, acc: { fs: 16, k: 0.64 } }
/** Estimated box of a text label (baseline y, anchor start | middle | end). */
export function textBox(x: number, y: number, s: string, cls = 'lbl', anchor: 'start' | 'middle' | 'end' = 'middle'): Box {
  const { fs, k } = SIZE[cls] ?? SIZE.lbl
  const w = [...s].length * fs * k + 8
  const left = anchor === 'start' ? x - 2 : anchor === 'end' ? x - w + 2 : x - w / 2
  return { x: left, y: y - fs * 0.8 - 2, w, h: fs + 4 }
}
const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const area = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
function segHitsBox(x1: number, y1: number, x2: number, y2: number, b: Box) {
  const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 3))
  for (let i = 0; i <= n; i++) { const x = x1 + (x2 - x1) * i / n, y = y1 + (y2 - y1) * i / n; if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return true }
  return false
}
export interface LabelCand { x: number; y: number; anchor?: 'start' | 'middle' | 'end' }

/**
 * Places diagram labels so they never overlap each other or the drawing's marks: each label tries its candidate
 * positions in order and takes the first that is clear of placed labels, obstacle boxes and segments (arrows,
 * slopes) and stays inside the frame; if none is clear it takes the one with the least overlap. `collisions` counts
 * labels that could not be placed clear (tests assert 0).
 */
export class LabelLayout {
  private placed: Box[] = []
  private boxes: Box[] = []
  private segs: [number, number, number, number, number][] = []
  private out: string[] = []
  collisions = 0
  /** labels that overlap another label (the bug to never ship) */
  hard = 0
  constructor(private W: number, private H: number) {}
  box(x: number, y: number, w: number, h: number) { this.boxes.push({ x, y, w, h }); return this }
  circle(cx: number, cy: number, r: number) { return this.box(cx - r, cy - r, 2 * r, 2 * r) }
  /** A mark labels must not cross; `weight` lower for soft marks (a dashed path) so a label may touch it rather than wander off. */
  seg(x1: number, y1: number, x2: number, y2: number, weight = 60) { this.segs.push([x1, y1, x2, y2, weight]); return this }
  /** A rotated rectangle (centre, size, degrees anticlockwise): its four sides become segments plus its inner box. */
  rotRect(cx: number, cy: number, w: number, h: number, deg: number) {
    const r = -deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r)
    const p = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c])
    for (let i = 0; i < 4; i++) this.seg(p[i][0], p[i][1], p[(i + 1) % 4][0], p[(i + 1) % 4][1])
    const m = Math.min(w, h) * 0.35
    return this.box(cx - m, cy - m, 2 * m, 2 * m)
  }
  private cost(b: Box) {
    let c = 0
    for (const p of this.placed) if (hit(b, p)) c += 5000 + area(b, p) * 10
    for (const o of this.boxes) c += area(b, o)
    for (const s of this.segs) if (segHitsBox(s[0], s[1], s[2], s[3], b)) c += s[4]
    const outX = Math.max(0, 2 - b.x) + Math.max(0, b.x + b.w - (this.W - 2)), outY = Math.max(0, 2 - b.y) + Math.max(0, b.y + b.h - (this.H - 2))
    return c + (outX + outY) * 200
  }
  label(s: string, cls: string, cands: LabelCand[], extraStyle = '') {
    let best: { c: LabelCand; b: Box; cost: number } | null = null
    // first clear spot wins (candidates come in preference order); otherwise least overlap, nearer preferred
    const c0 = cands[0]
    for (const c of cands) {
      const b = textBox(c.x, c.y, s, cls, c.anchor ?? 'middle')
      const raw = this.cost(b)
      // nearer the preferred spot is better: brushing a soft mark (the dashed path) beats wandering far off
      const cost = raw + Math.hypot(c.x - c0.x, c.y - c0.y) * 0.25
      if (!best || cost < best.cost) best = { c, b, cost }
      if (cost === 0) break
    }
    if (!best) return
    best.cost = this.cost(best.b)
    // nothing clear among the preferred spots: widen the search around the first one (closer is better)
    if (best.cost > 0 && cands.length) {
      const c0 = cands[0]
      for (const c of LabelLayout.ring(c0.x, c0.y - 5, 22, 18, 0, 16)) {
        const b = textBox(c.x, c.y, s, cls, c.anchor ?? 'middle')
        const cost = this.cost(b) + Math.hypot(c.x - c0.x, c.y - c0.y) * 0.4
        if (cost < best.cost) best = { c, b, cost }
      }
      best.cost = this.cost(best.b)
    }
    if (best.cost >= 1) this.collisions++
    this.hard += best.cost >= 1 && this.placed.some(p => hit(p, best!.b)) ? 1 : 0
    this.placed.push(best.b)
    // the placed label is a mark too: later segments are not added after it, but later labels avoid it
    this.out.push(text(best.c.x, best.c.y, s, cls, `style="text-anchor:${best.c.anchor ?? 'middle'}${extraStyle ? `;${extraStyle}` : ''}"`))
  }
  /** Candidates on a ring around a point, starting at a preferred angle (radians, screen y down). */
  static ring(x: number, y: number, rx: number, ry: number, start = 0, n = 12): LabelCand[] {
    const out: LabelCand[] = []
    for (const scale of [1, 1.5, 2.1, 2.8, 3.6]) for (let i = 0; i < n; i++) {
      const k = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2)
      const a = start + k * (2 * Math.PI / n)
      const cx = x + Math.cos(a) * rx * scale, cy = y + Math.sin(a) * ry * scale
      out.push({ x: cx, y: cy + 5, anchor: Math.cos(a) > 0.35 ? 'start' : Math.cos(a) < -0.35 ? 'end' : 'middle' })
    }
    return out
  }
  svg() { return this.out.join('\n') }
}

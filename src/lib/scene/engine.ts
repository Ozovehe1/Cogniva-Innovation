/**
 * The scene engine: a deterministic beat timeline over a kind's parameters, a layered Canvas2D renderer in the Night
 * Lab style, label placement, and pointer/slider control. Pure TS (no React, no DOM at import), so the validator can
 * run the same layout code on the server. A scene is a function of (spec, time, learner input): seek(t) replays the
 * physics at a fixed 1/60 s step, which is how tests and screenshots get identical frames.
 */
import { CAPTION_MAX, EASE, FONT, NL, type EaseName } from './tokens'
import type { KindInfo, ParamValue, SceneBeat, SceneSpec } from './types'

/* ───────────── View: world → screen ───────────── */

export interface View {
  /** Stage width/height in CSS px (the canvas also holds a plot strip below the stage: PH). */
  W: number
  SH: number
  PH: number
  H: number
  /** Px per world unit and the world → screen maps. */
  u: number
  X: (x: number) => number
  Y: (y: number) => number
  ix: (px: number) => number
  iy: (py: number) => number
  /** Top band kept clear for the caption pill. */
  top: number
}

export interface WorldBox { x0: number; x1: number; y0: number; y1: number }

export function makeView(W: number, aspect: number, plot: number, world: WorldBox, top = 46, pad = 10, stretch = false): View {
  const SH = Math.round(W * aspect), PH = Math.round(W * plot)
  const ww = world.x1 - world.x0, wh = world.y1 - world.y0
  const availH = SH - top - pad
  const fx = (W - 2 * pad) / ww, fy = availH / wh
  const u = Math.min(fx, fy)
  // Graphs may stretch to fill the stage (x and y scales differ); physical scenes keep one scale.
  const ux = stretch ? fx : u, uy = stretch ? fy : u
  const ox = (W - ww * ux) / 2, oy = top + (availH - wh * uy) / 2
  return {
    W, SH, PH, H: SH + PH, u, top,
    X: x => ox + (x - world.x0) * ux,
    Y: y => oy + (world.y1 - y) * uy,
    ix: px => (px - ox) / ux + world.x0,
    iy: py => world.y1 - (py - oy) / uy,
  }
}

/* ───────────── Kinds ───────────── */

export interface Rect { x: number; y: number; w: number; h: number }
export interface Anchor { x: number; y: number; r: number }
export type Params = Record<string, ParamValue>

export interface Fx {
  /** 0..1: how far a target has been revealed (1 if the spec never reveals it). */
  reveal: (target: string) => number
  /** 0..1: pulse/highlight emphasis on a target right now. */
  emph: (target: string) => number
  /** Seconds since the scene started (clock, not timeline). */
  t: number
  reduced: boolean
}

export interface Readout { label: string; value: string; color?: string }

export interface KindRuntime<S = unknown> {
  info: KindInfo
  /** Stage height / width, and the plot strip height / width (0 = none). */
  aspect: number
  plot: number | ((P: Params) => number)
  /** Fill the stage with independent x/y scales (graphs). */
  stretch?: boolean
  world: (P: Params) => WorldBox
  init: (P: Params, v: View) => S
  step: (s: S, P: Params, dt: number, v: View) => void
  draw: (c: CanvasRenderingContext2D, s: S, P: Params, v: View, fx: Fx) => void
  anchors: (s: S, P: Params, v: View) => Record<string, Anchor>
  keepouts?: (s: S, P: Params, v: View) => Rect[]
  /** Pointer on the drag handle? (screen px) */
  hit?: (s: S, P: Params, v: View, x: number, y: number) => boolean
  /** New value of info.dragParam for a pointer at (x, y). */
  drag?: (s: S, P: Params, v: View, x: number, y: number) => number
  readouts?: (s: S, P: Params) => Readout[]
  drawPlot?: (c: CanvasRenderingContext2D, s: S, P: Params, v: View, fx: Fx) => void
  /** Where a play beat runs the play param to (e.g. the flight time). */
  playTo?: (P: Params) => number
  /** What the caption says once the learner has control. */
  yourTurn?: string
}

/* ───────────── Timeline ───────────── */

interface Tween { param: string; from: number; to: number; i: number; ease: EaseName; t0: number; t1: number }

export class Timeline {
  readonly starts: number[]
  readonly total: number
  readonly tweens: Tween[] = []
  private reveals = new Map<string, [number, number]>()
  constructor(readonly beats: SceneBeat[], base: Params, info: KindInfo, playTo?: (P: Params) => number) {
    let a = 0
    this.starts = beats.map(b => { const s = a; a += b.dur; return s })
    this.total = a
    const vals: Params = { ...base }
    beats.forEach((b, i) => {
      const t0 = this.starts[i]
      if ((b.do === 'move' || b.do === 'set') && b.param && typeof b.to === 'number') {
        const from = Number(vals[b.param] ?? 0)
        const dur = b.do === 'set' ? Math.min(b.dur, 0.6) : b.dur
        this.tweens.push({ param: b.param, from, to: b.to, i, ease: b.ease ?? (b.do === 'set' ? 'out' : 'inOut'), t0, t1: t0 + dur })
        vals[b.param] = b.to
      } else if (b.do === 'play' && info.playParam) {
        const p = info.playParam
        const end = playTo ? playTo(vals) : Number(vals[p] ?? 0)
        const from0 = Number(vals[p] ?? 0)
        // A play beat continues from where the clock stands (restarts after the end); "to" stops it early.
        const from = from0 >= end - 1e-6 ? 0 : from0
        const to = typeof b.to === 'number' ? Math.min(end, Math.max(from, b.to)) : end
        this.tweens.push({ param: p, from, to, i, ease: b.ease ?? 'linear', t0, t1: t0 + b.dur })
        vals[p] = to
      }
      if (b.do === 'reveal' && b.target && !this.reveals.has(b.target)) this.reveals.set(b.target, [t0, t0 + b.dur])
    })
  }
  beatAt(t: number): number {
    if (!this.beats.length) return -1
    if (t >= this.total) return this.beats.length - 1
    for (let i = this.beats.length - 1; i >= 0; i--) if (t >= this.starts[i]) return i
    return 0
  }
  /** Numeric params at time t (tweens applied in order). */
  apply(t: number, P: Params): Params {
    const out: Params = { ...P }
    for (const w of this.tweens) {
      if (t < w.t0) continue
      const u = w.t1 > w.t0 ? Math.min(1, (t - w.t0) / (w.t1 - w.t0)) : 1
      out[w.param] = w.from + (w.to - w.from) * EASE[w.ease](u)
    }
    return out
  }
  reveal(target: string, t: number): number {
    const r = this.reveals.get(target)
    if (!r) return 1
    if (t <= r[0]) return 0
    return EASE.inOut(Math.min(1, (t - r[0]) / Math.max(0.01, r[1] - r[0])))
  }
  emph(target: string, t: number): number {
    let e = 0
    this.beats.forEach((b, i) => {
      if (b.target !== target || (b.do !== 'pulse' && b.do !== 'highlight' && b.do !== 'ask')) return
      const u = (t - this.starts[i]) / b.dur
      if (u < 0 || u > 1) return
      e = Math.max(e, b.do === 'pulse' ? Math.sin(Math.PI * Math.min(1, u * Math.max(1, Math.round(b.dur / 1.2))) % Math.PI) ** 2 : Math.min(1, u * 5, (1 - u) * 5))
    })
    return e
  }
}

/* ───────────── Labels: deterministic placement, shared with the validator ───────────── */

export const estTextW = (text: string, size: number) => text.length * size * 0.56
export interface PlacedLabel { text: string; target: string; x: number; y: number; w: number; h: number; ax: number; ay: number; ok: boolean }

const overlap = (a: Rect, b: Rect, m = 3) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m

export function placeLabels(labels: { target: string; text: string }[], anchors: Record<string, Anchor>, v: View, keep: Rect[] = []): PlacedLabel[] {
  const out: PlacedLabel[] = []
  const taken: Rect[] = [...keep, { x: 0, y: 0, w: v.W, h: v.top - 4 }]
  const h = 22
  for (const l of labels) {
    const a = anchors[l.target]
    const w = estTextW(l.text, 12) + 16
    if (!a) { out.push({ text: l.text, target: l.target, x: 0, y: 0, w, h, ax: 0, ay: 0, ok: false }); continue }
    let best: PlacedLabel | null = null
    // Candidates round the anchor (right, left, below, above, diagonals), two distances.
    // Prefer the side facing away from the stage centre (labels sit outside the picture).
    const ox = a.x - v.W / 2, oy = a.y - (v.top + v.SH) / 2
    const angs = [0, Math.PI, Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4]
      .map(g => ({ g, d: Math.cos(g) * ox + Math.sin(g) * oy * 0.6 }))
      .sort((p, q) => q.d - p.d).map(o => o.g)
    for (const dist of [a.r + 12, a.r + 30]) {
      for (const ang of angs) {
        const cxp = a.x + Math.cos(ang) * dist, cyp = a.y + Math.sin(ang) * dist
        const x = Math.cos(ang) > 0.3 ? cxp : Math.cos(ang) < -0.3 ? cxp - w : cxp - w / 2
        const y = Math.sin(ang) > 0.3 ? cyp : Math.sin(ang) < -0.3 ? cyp - h : cyp - h / 2
        const r = { x, y, w, h }
        if (x < 4 || y < v.top || x + w > v.W - 4 || y + h > v.SH - 4) continue
        if (taken.some(t => overlap(r, t))) continue
        best = { text: l.text, target: l.target, x, y, w, h, ax: a.x, ay: a.y, ok: true }
        break
      }
      if (best) break
    }
    if (best) { taken.push(best); out.push(best) } else out.push({ text: l.text, target: l.target, x: 0, y: 0, w, h, ax: a.x, ay: a.y, ok: false })
  }
  return out
}

/* ───────────── Drawing helpers (the primitive vocabulary's base) ───────────── */

export function font(c: CanvasRenderingContext2D, size: number, weight = 500) { c.font = `${weight} ${size}px ${FONT}` }

export function glow<T>(c: CanvasRenderingContext2D, color: string, blur: number, fn: () => T): T {
  c.save(); c.shadowColor = color; c.shadowBlur = blur; const r = fn(); c.restore(); return r
}

export function arrowHead(c: CanvasRenderingContext2D, x: number, y: number, ang: number, size: number, color: string) {
  c.fillStyle = color
  c.beginPath()
  c.moveTo(x + size * Math.cos(ang), y + size * Math.sin(ang))
  c.lineTo(x + size * 0.7 * Math.cos(ang + 2.5), y + size * 0.7 * Math.sin(ang + 2.5))
  c.lineTo(x + size * 0.7 * Math.cos(ang - 2.5), y + size * 0.7 * Math.sin(ang - 2.5))
  c.closePath(); c.fill()
}

export function arrow(c: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, o: { color: string; w?: number; head?: number; glow?: number; alpha?: number }) {
  const L = Math.hypot(x2 - x1, y2 - y1)
  if (L < 2) return
  const ang = Math.atan2(y2 - y1, x2 - x1), hs = o.head ?? Math.max(8, (o.w ?? 2) * 3.2)
  c.save()
  c.globalAlpha = o.alpha ?? 1
  if (o.glow) { c.shadowColor = o.color; c.shadowBlur = o.glow }
  c.strokeStyle = o.color; c.lineWidth = o.w ?? 2; c.lineCap = 'round'
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2 - Math.cos(ang) * hs * 0.6, y2 - Math.sin(ang) * hs * 0.6); c.stroke()
  arrowHead(c, x2 - Math.cos(ang) * hs * 0.35, y2 - Math.sin(ang) * hs * 0.35, ang, hs, o.color)
  c.restore()
}

export function pill(c: CanvasRenderingContext2D, x: number, y: number, text: string, o: { size?: number; color?: string; bg?: string; border?: string; weight?: number; h?: number } = {}) {
  const size = o.size ?? 12
  font(c, size, o.weight ?? 600)
  const w = c.measureText(text).width + 16, h = o.h ?? size + 10
  c.fillStyle = o.bg ?? 'rgba(14,19,34,0.82)'
  c.strokeStyle = o.border ?? 'rgba(255,255,255,0.14)'
  c.lineWidth = 1
  c.beginPath(); c.roundRect(x, y, w, h, h / 2); c.fill(); c.stroke()
  c.fillStyle = o.color ?? NL.text; c.textAlign = 'left'; c.textBaseline = 'middle'
  c.fillText(text, x + 8, y + h / 2 + 0.5)
  return { w, h }
}

/** A soft radial halo (additive) behind something that is changing. */
export function halo(c: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number) {
  if (a <= 0.01) return
  c.save(); c.globalCompositeOperation = 'lighter'
  const g = c.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, `rgba(${rgb},${0.35 * a})`); g.addColorStop(1, `rgba(${rgb},0)`)
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.restore()
}

export function stageBackground(c: CanvasRenderingContext2D, v: View, cx = 0.45, cy = 0.5) {
  const g = c.createRadialGradient(v.W * cx, v.SH * cy, 10, v.W * cx, v.SH * cy, v.W * 0.85)
  g.addColorStop(0, NL.bgLift); g.addColorStop(1, NL.bg)
  c.fillStyle = g; c.fillRect(0, 0, v.W, v.SH)
}

/** Seeded RNG so particles are identical on every run (deterministic frames). */
export function rng(seed = 7) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647) }

/** Trace a streamline of a 2D field (RK2) from (x, y); stops at sinks/bounds or after n steps. */
export function trace(B: (x: number, y: number) => [number, number], x: number, y: number, o: { h: number; n: number; stop: (x: number, y: number) => boolean; dir?: 1 | -1 }): [number, number][] {
  const pts: [number, number][] = [[x, y]]
  const d = o.dir ?? 1
  for (let i = 0; i < o.n; i++) {
    const [u1, v1] = B(x, y); const n1 = Math.hypot(u1, v1) || 1
    const mx = x + d * 0.5 * o.h * u1 / n1, my = y + d * 0.5 * o.h * v1 / n1
    const [u2, v2] = B(mx, my); const n2 = Math.hypot(u2, v2) || 1
    x += d * o.h * u2 / n2; y += d * o.h * v2 / n2
    pts.push([x, y])
    if (o.stop(x, y)) break
  }
  return pts
}

/* ───────────── The running scene ───────────── */

export interface SceneUi {
  beat: number
  beats: number
  caption: string
  done: boolean
  playing: boolean
  asking: boolean
  readouts: Readout[]
  params: Params
}

export class Scene<S = unknown> {
  v!: View
  s!: S
  t = 0
  clock = 0
  playing = true
  /** Learner overrides (sliders, drag) once they take control. */
  user: Params = {}
  owned = false
  dragging = false
  waitAsk = -1
  reduced = false
  labelsPlaced: PlacedLabel[] = []
  readonly tl: Timeline
  readonly base: Params
  constructor(readonly spec: SceneSpec, readonly kind: KindRuntime<S>) {
    this.base = defaultsFor(kind.info, spec.params)
    this.tl = new Timeline(spec.beats, this.base, kind.info, kind.playTo)
  }
  get params(): Params {
    const p = this.tl.apply(Math.min(this.t, this.tl.total), this.base)
    return this.owned ? { ...p, ...this.user, __owned: true } : p
  }
  layout(W: number) {
    const first = !this.v
    this.v = makeView(W, this.kind.aspect, typeof this.kind.plot === 'function' ? this.kind.plot(this.base) : this.kind.plot, this.kind.world(this.base), 46, 10, !!this.kind.stretch)
    if (first) this.s = this.kind.init(this.params, this.v)
  }
  fx(): Fx {
    const t = this.owned ? Infinity : this.t
    return { reveal: k => (this.owned ? 1 : this.tl.reveal(k, t)), emph: k => (this.owned ? 0 : this.tl.emph(k, t)), t: this.clock, reduced: this.reduced }
  }
  /** Advance by dt seconds: timeline (unless paused, dragging or waiting on an ask), then physics. */
  step(dt: number) {
    if (this.playing && !this.dragging && !this.owned && this.waitAsk < 0) {
      const before = this.tl.beatAt(this.t)
      this.t += dt
      const b = this.spec.beats[before]
      // An ask beat holds at its end until the learner taps on (live only; seek ignores asks).
      if (b?.do === 'ask' && this.t >= this.tl.starts[before] + b.dur && !this.seeking) { this.t = this.tl.starts[before] + b.dur; this.waitAsk = before }
      if (this.t >= this.tl.total + 0.6 && !this.seeking) this.handOver()
    }
    this.clock += dt
    this.kind.step(this.s, this.params, dt, this.v)
  }
  private seeking = false
  /** Deterministic replay to time t (fixed 1/60 s steps). */
  seek(t: number) {
    this.seeking = true
    this.t = 0; this.clock = 0; this.owned = false; this.user = {}
    this.s = this.kind.init(this.params, this.v)
    const dt = 1 / 60
    while (this.t < t - 1e-9) this.step(dt)
    this.seeking = false
  }
  continueAsk() { if (this.waitAsk >= 0) { this.t += 0.01; this.waitAsk = -1 } }
  handOver() { if (this.owned) return; this.user = { ...this.tl.apply(this.tl.total, this.base) }; this.owned = true }
  restart() { this.t = 0; this.owned = false; this.user = {}; this.waitAsk = -1; this.playing = true; this.s = this.kind.init(this.params, this.v) }
  setParam(name: string, value: ParamValue) { if (!this.owned) this.handOver(); this.user[name] = value }
  pointerDown(x: number, y: number): boolean {
    if (!this.spec.drag || !this.kind.hit || !this.kind.info.dragParam) return false
    if (!this.kind.hit(this.s, this.params, this.v, x, y)) return false
    this.dragging = true
    this.handOver()
    return true
  }
  pointerMove(x: number, y: number) {
    if (!this.dragging || !this.kind.drag || !this.kind.info.dragParam) return
    this.user[this.kind.info.dragParam] = this.kind.drag(this.s, this.params, this.v, x, y)
  }
  pointerUp() { this.dragging = false }
  caption(): string {
    if (this.owned) return this.kind.yourTurn ?? (this.spec.drag ? 'Your turn: drag it and watch' : 'Your turn: move the slider')
    const i = this.tl.beatAt(this.t)
    return i >= 0 ? this.spec.beats[i].caption : this.spec.title
  }
  ui(): SceneUi {
    const P = this.params
    return { beat: this.tl.beatAt(this.t), beats: this.spec.beats.length, caption: this.caption(), done: this.owned, playing: this.playing, asking: this.waitAsk >= 0, readouts: this.kind.readouts?.(this.s, P) ?? [], params: P }
  }
  draw(c: CanvasRenderingContext2D) {
    const v = this.v, P = this.params, fx = this.fx()
    c.save()
    c.beginPath(); c.rect(0, 0, v.W, v.SH); c.clip()
    this.kind.draw(c, this.s, P, v, fx)
    // Labels (placed deterministically, same code as the validator's layout check).
    const anchors = this.kind.anchors(this.s, P, v)
    this.labelsPlaced = placeLabels(this.spec.labels, anchors, v, this.kind.keepouts?.(this.s, P, v))
    for (const l of this.labelsPlaced) {
      if (!l.ok) continue
      const a = Math.min(fx.reveal(l.target), 1)
      if (a < 0.05) continue
      c.save(); c.globalAlpha = a
      const ex = Math.max(l.x, Math.min(l.x + l.w, l.ax)), ey = Math.max(l.y, Math.min(l.y + l.h, l.ay))
      c.strokeStyle = 'rgba(232,236,243,0.45)'; c.lineWidth = 1.2; c.setLineDash([2, 3])
      c.beginPath(); c.moveTo(ex, ey); c.lineTo(l.ax, l.ay); c.stroke(); c.setLineDash([])
      c.fillStyle = NL.text; c.beginPath(); c.arc(l.ax, l.ay, 2.2, 0, Math.PI * 2); c.fill()
      pill(c, l.x, l.y, l.text, { size: 12, h: l.h, weight: 600 })
      c.restore()
    }
    drawCaption(c, v, this.caption(), this.owned || this.waitAsk >= 0)
    c.restore()
    if (v.PH > 0) {
      c.save(); c.translate(0, 0)
      c.fillStyle = NL.panel; c.fillRect(0, v.SH, v.W, v.PH)
      this.kind.drawPlot?.(c, this.s, P, v, fx)
      c.restore()
    }
  }
}

function drawCaption(c: CanvasRenderingContext2D, v: View, text: string, accent: boolean) {
  let size = 13
  font(c, size, 600)
  while (c.measureText(text).width > v.W - 44 && size > 11) { size -= 0.5; font(c, size, 600) }
  const w = Math.min(v.W - 20, c.measureText(text).width + 26)
  c.fillStyle = 'rgba(14,19,34,0.80)'; c.strokeStyle = accent ? 'rgba(255,209,102,0.55)' : 'rgba(255,255,255,0.13)'; c.lineWidth = 1
  c.beginPath(); c.roundRect(10, 10, w, 28, 14); c.fill(); c.stroke()
  c.fillStyle = accent ? NL.gold : NL.text; c.textAlign = 'left'; c.textBaseline = 'middle'
  let t = text
  while (c.measureText(t).width > w - 26 && t.length > 4) t = `${t.slice(0, -2)}…`
  c.fillText(t, 23, 24.5)
}

export function defaultsFor(info: KindInfo, p: Params): Params {
  const out: Params = {}
  for (const [k, d] of Object.entries(info.params)) out[k] = p[k] ?? d.default
  return out
}

export const num = (P: Params, k: string) => Number(P[k] ?? 0)
export { CAPTION_MAX }

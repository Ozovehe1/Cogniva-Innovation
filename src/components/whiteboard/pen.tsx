'use client'
/**
 * The pen: one clock that writes everything on the board and moves the hand.
 *
 * Writers (handwritten text, KaTeX reveal, diagram strokes) hand the engine a
 * list of segments: each segment is one stroke of the pen, placed on the job's
 * own clock (ms from when it was queued). Every animation frame the engine
 * advances each segment (`apply`, e.g. a stroke-dashoffset or a clip path) and
 * puts the marker tip exactly where the newest active stroke is being drawn
 * (`point`, in client coordinates). Between strokes the hand lifts and travels
 * to the next one; when nothing is being written it drifts to the board edge and
 * after a while slides off. One requestAnimationFrame loop for the whole board,
 * and the hand is moved with transforms only, so it stays cheap on phones.
 */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react'

export interface Pt { x: number; y: number }

export interface PenSegment {
  /** ms from the start of the job. */
  start: number
  /** ms. */
  dur: number
  /** Show the stroke up to progress p (0..1). Called once per frame while active, then once with 1. */
  apply?: (p: number) => void
  /** Where the pen tip is at progress p, in client (viewport) coordinates; null = not measurable. */
  point: (p: number) => Pt | null
}

interface Job {
  t0: number
  segs: PenSegment[]
  end: number
  last: number[]
  cancelled: boolean
}

/** Where the hand is this frame (overlay-local px) and how it is moving. */
export interface HandState {
  /** Marker tip position. */
  x: number
  y: number
  /** 0 = pen on the board, 1 = lifted. */
  lift: number
  /** Wrist angle in the board plane (deg). */
  rot: number
  /** 0..1 while strokes are being drawn (drives finger and wrist motion). */
  writing: number
  /** 0..1 opacity / presence. */
  visible: number
  /** Board size in px. */
  w: number
  h: number
  now: number
}

export interface HandView {
  root: HTMLElement
  /** Rendered hand size in px (used for the resting spot). */
  size: () => { w: number; h: number }
  render: (s: HandState) => void
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

export class PenEngine {
  private jobs: Job[] = []
  private raf = 0
  private view: HandView | null = null
  /** Hand state, in overlay-local px. */
  private pos: Pt | null = null
  private lift = 1
  private writing = 0
  private lastActive = 0
  private lastFrame = 0
  private visible = 0

  attach(view: HandView | null) {
    this.view = view
    if (view) { this.pos = null; this.kick() }
  }

  /** Queue a writing job. Returns a cancel function (the job's strokes are left as they are). */
  run(segs: PenSegment[]): () => void {
    const job: Job = { t0: performance.now(), segs, end: segs.reduce((m, s) => Math.max(m, s.start + s.dur), 0), last: segs.map(() => -1), cancelled: false }
    this.jobs.push(job)
    this.step(job, job.t0)
    this.kick()
    return () => {
      if (job.cancelled) return
      job.cancelled = true
      this.jobs = this.jobs.filter(j => j !== job)
    }
  }

  /** Finish every running job at once (e.g. skip). */
  flush() {
    for (const j of this.jobs) j.segs.forEach((s, i) => { if (j.last[i] < 1) { s.apply?.(1); j.last[i] = 1 } })
    this.jobs = []
  }

  private kick() {
    if (!this.raf && typeof window !== 'undefined') {
      this.lastFrame = performance.now()
      this.raf = requestAnimationFrame(this.frame)
    }
  }

  private step(job: Job, now: number) {
    const local = now - job.t0
    job.segs.forEach((s, i) => {
      if (job.last[i] >= 1) return
      const p = s.dur <= 0 ? (local >= s.start ? 1 : 0) : clamp01((local - s.start) / s.dur)
      if (p === job.last[i]) return
      job.last[i] = p
      s.apply?.(p)
    })
  }

  private frame = (now: number) => {
    this.raf = 0
    const dt = Math.min(64, now - this.lastFrame)
    this.lastFrame = now
    for (const j of this.jobs) this.step(j, now)
    const active = this.jobs.filter(j => now - j.t0 <= j.end)
    this.jobs = this.jobs.filter(j => now - j.t0 <= j.end + 50)
    const job = active.length ? active.reduce((a, b) => (b.t0 > a.t0 ? b : a)) : null
    this.moveHand(job, now, dt)
    const handBusy = this.view && (job || this.visible > 0.01)
    if (this.jobs.length || handBusy) this.raf = requestAnimationFrame(this.frame)
  }

  private moveHand(job: Job | null, now: number, dt: number) {
    const v = this.view
    if (!v) return
    const rr = v.root.getBoundingClientRect()
    if (!rr.width) return
    const { w: hw, h: hh } = v.size()
    const toLocal = (p: Pt | null): Pt | null => (p ? { x: p.x - rr.left, y: p.y - rr.top } : null)
    let target: Pt | null = null
    let lift = 1
    let writing = 0
    let snap = false
    if (job) {
      this.lastActive = now
      const local = now - job.t0
      const segs = job.segs
      let k = segs.findIndex(s => local < s.start + s.dur)
      if (k < 0) k = segs.length - 1
      const s = segs[k]
      if (local >= s.start) {
        // Pen down on this stroke: the tip sits exactly on it.
        target = toLocal(s.point(clamp01((local - s.start) / Math.max(1, s.dur))))
        lift = 0
        writing = 1
        snap = true
      } else {
        // Between strokes: lift and travel from the end of the last stroke to the start of the next.
        const prev = k > 0 ? segs[k - 1] : null
        const from = prev ? toLocal(prev.point(1)) : this.pos
        const to = toLocal(s.point(0))
        const gapStart = prev ? prev.start + prev.dur : 0
        const q = clamp01((local - gapStart) / Math.max(1, s.start - gapStart))
        if (from && to) {
          const e = easeInOut(q)
          target = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e }
          const dist = Math.hypot(to.x - from.x, to.y - from.y)
          lift = Math.min(1, 0.25 + dist / 160) * Math.sin(Math.PI * q)
          snap = !!prev
        } else target = to
      }
    } else {
      const idle = now - this.lastActive
      // Rest at the lower right edge of the board; slide off after a while.
      const off = idle > 3500 || !this.lastActive
      target = { x: rr.width - hw * (off ? -0.15 : 0.32), y: rr.height - Math.min(rr.height * 0.12, 40) + (off ? hh * 0.25 : 0) }
      lift = 1
    }
    if (!target) return
    if (!this.pos) this.pos = { x: rr.width + hw * 0.2, y: rr.height }
    if (snap) this.pos = target
    else {
      const k = 1 - Math.exp(-dt / (job ? 70 : 260))
      this.pos = { x: this.pos.x + (target.x - this.pos.x) * k, y: this.pos.y + (target.y - this.pos.y) * k }
    }
    const kl = 1 - Math.exp(-dt / 60)
    this.lift += (lift - this.lift) * kl
    this.writing += (writing - this.writing) * (1 - Math.exp(-dt / 120))
    const wantVisible = job || now - this.lastActive < 3500 ? 1 : 0
    this.visible += (wantVisible - this.visible) * (1 - Math.exp(-dt / 220))

    // Wrist angle follows where on the board the hand is; fingers flex a little while writing.
    const xf = this.pos.x / rr.width - 0.5
    const wobble = this.writing * (Math.sin(now / 1000 * Math.PI * 2 * 4.2) * 1.3 + Math.sin(now / 1000 * Math.PI * 2 * 1.7) * 0.6)
    v.render({ x: this.pos.x, y: this.pos.y, lift: this.lift, rot: -4 + xf * 9 + wobble, writing: this.writing, visible: this.visible, w: rr.width, h: rr.height, now })
  }

  dispose() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.jobs = []
  }
}

export const PenContext = createContext<PenEngine | null>(null)

const standalone = { pen: null as PenEngine | null }
function standalonePen() {
  if (!standalone.pen) standalone.pen = new PenEngine()
  return standalone.pen
}
/** The board's pen, or a hand-less one for writers rendered outside a board. */
export function usePen(): PenEngine {
  return useContext(PenContext) ?? standalonePen()
}

/** The marker tip inside the fallback hand image (fractions of its width and height). */
const TIP = { x: 3.5 / 520, y: 341 / 344 }
const HAND_RATIO = 344 / 520
/** The sleeve is cut at the image edge: fade it out towards the top right instead of showing a hard line. */
const SLEEVE_FADE = 'radial-gradient(ellipse 118% 150% at 0% 100%, #000 66%, transparent 86%)'

/** Hand width for a board of this width (px). */
export function handWidth(boardW: number) {
  return Math.max(120, Math.min(270, boardW * 0.34))
}

/**
 * Whether to use the 3D hand: WebGL available, motion allowed, and the device not obviously low-end
 * (little memory, few cores, data saver). `?hand=photo` / `?hand=3d` force either hand.
 */
function canUse3D(): boolean {
  if (typeof window === 'undefined') return false
  const q = window.location.search
  if (/[?&]hand=photo\b/.test(q)) return false
  if (!/[?&]hand=3d\b/.test(q)) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
    if ((nav.deviceMemory ?? 4) < 2 || (nav.hardwareConcurrency ?? 4) < 3 || nav.connection?.saveData) return false
  }
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch { return false }
}

/**
 * Warm the 3D hand (its code and compressed model) while the student is elsewhere, e.g. on the dashboard or the
 * lesson list, so a lesson can swap it in at once. Does nothing where the 3D hand would not be used.
 */
export function preloadHand3D() {
  if (!canUse3D()) return
  import('./hand3d').then(m => m.loadHandModel()).catch(() => {})
}

/** The 3D hand falls back to the photo hand if drawing it takes longer than this per frame (median, ms). */
const MAX_FRAME_MS = 12

/**
 * The hand holding the marker. Writing never waits for it: the photographic hand (a pre-rendered sprite moved
 * with transforms) appears at once, and where WebGL is available the real-time 3D hand (three.js, lazy-loaded:
 * a rigged glTF hand posed in a writing grip around a modelled marker, lit, casting a shadow on the board)
 * takes over as soon as it has loaded. It hands back to the photo hand if the GPU loses its context or the
 * device turns out too slow to draw it.
 */
export function HandOverlay({ pen, hidden = false }: { pen: PenEngine; hidden?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const handRef = useRef<HTMLImageElement>(null)
  const shadowRef = useRef<HTMLImageElement>(null)
  const [mode, setMode] = useState<'photo' | '3d'>('photo')
  useEffect(() => {
    const root = rootRef.current
    if (!root || hidden) return
    let live = true
    let dispose: (() => void) | null = null
    const size = () => { const w = handWidth(root.clientWidth); return { w, h: w * HAND_RATIO } }
    const photo = () => {
      const hand = handRef.current, shadow = shadowRef.current
      if (!hand || !shadow || !live) return
      setMode('photo')
      pen.attach({ root, size, render: st => renderPhoto(hand, shadow, st) })
    }
    const toPhoto = (why: string) => {
      if (!live) return
      console.warn(`3D hand: ${why}; using the photo hand.`)
      dispose?.(); dispose = null
      photo()
    }
    photo()
    if (canUse3D()) {
      const t0 = performance.now()
      import('./hand3d')
        .then(m => m.createHand3D(root, () => toPhoto('WebGL context lost')))
        .then(h => {
          if (!live) { h.dispose(); return }
          dispose = h.dispose
          root.dataset.handLoadMs = String(Math.round(performance.now() - t0))
          // Draw cost per frame (CPU side, ms); the first frames include shader compilation and are skipped.
          const costs: number[] = []
          let frames = 0
          const render = (st: HandState) => {
            const a = performance.now()
            h.render(st)
            if (st.visible < 0.05 || ++frames <= 5) return
            costs.push(performance.now() - a)
            if (costs.length === 60) {
              const med = costs.slice().sort((x, y) => x - y)[30]
              root.dataset.handFrameMs = med.toFixed(2)
              costs.length = 0
              if (med > MAX_FRAME_MS) toPhoto(`drawing took ${med.toFixed(1)} ms a frame`)
            }
          }
          setMode('3d')
          pen.attach({ root, size, render })
        })
        .catch(err => toPhoto(`unavailable (${err instanceof Error ? err.message : String(err)})`))
    }
    return () => { live = false; pen.attach(null); dispose?.() }
  }, [pen, hidden])
  const photoOn = mode === 'photo' && !hidden
  return (
    <div ref={rootRef} aria-hidden data-hand={hidden ? 'none' : mode} className="pointer-events-none absolute inset-0 z-[15] overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={shadowRef} src={photoOn ? '/whiteboard/hand-shadow.webp' : undefined} alt="" draggable={false} decoding="async"
        className="absolute left-0 top-0 max-w-none select-none" style={{ width: 200, opacity: 0, display: photoOn ? undefined : 'none', transformOrigin: `${TIP.x * 100}% ${TIP.y * 100}%`, willChange: 'transform, opacity', WebkitMaskImage: SLEEVE_FADE, maskImage: SLEEVE_FADE }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={handRef} src={photoOn ? '/whiteboard/hand.webp' : undefined} alt="" draggable={false} decoding="async"
        className="absolute left-0 top-0 max-w-none select-none"
        style={{ width: 200, opacity: 0, display: photoOn ? undefined : 'none', transformOrigin: `${TIP.x * 100}% ${TIP.y * 100}%`, willChange: 'transform, opacity', WebkitMaskImage: SLEEVE_FADE, maskImage: SLEEVE_FADE }} />
    </div>
  )
}

/** Fallback: move the photographic hand sprite (tip pinned to the pen point). */
function renderPhoto(hand: HTMLElement, shadow: HTMLElement, st: HandState) {
  const hw = handWidth(st.w), hh = hw * HAND_RATIO
  if (hand.style.width !== `${hw}px`) hand.style.width = shadow.style.width = `${hw}px`
  const l = st.lift
  const tx = st.x - TIP.x * hw + l * 7
  const ty = st.y - TIP.y * hh - l * 11
  const sc = 1 + l * 0.035
  hand.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) rotate(${st.rot.toFixed(2)}deg) scale(${sc.toFixed(3)})`
  shadow.style.transform = `translate3d(${(tx + 6 + l * 16).toFixed(1)}px, ${(ty + 9 + l * 20).toFixed(1)}px, 0) rotate(${st.rot.toFixed(2)}deg) scale(${sc.toFixed(3)})`
  shadow.style.opacity = String((0.34 - l * 0.14) * st.visible)
  hand.style.opacity = String(st.visible)
}

/** A pen engine owned by one board. */
export function usePenEngine(): PenEngine {
  const [pen] = useState(() => new PenEngine())
  useEffect(() => () => pen.dispose(), [pen])
  return pen
}

export function PenProvider({ pen, children }: { pen: PenEngine; children: React.ReactNode }) {
  return <PenContext.Provider value={pen}>{children}</PenContext.Provider>
}

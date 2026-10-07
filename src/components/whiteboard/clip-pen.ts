/**
 * The hand on a Manim clip. The render service exports, next to each clip (`<clip>.pen.json`, see
 * modal_app/pen_export.py), every drawing animation in it: the stroke's cubic bezier control points in frame
 * coordinates and how much of it Manim has revealed at each moment. Here the marker tip is put on exactly that point
 * (the end of the revealed part, on the same curve Manim is on), read from the video's own time, so it traces each
 * line as it appears; between strokes it lifts toward the next one, and during pure motion it rests.
 *
 * The video itself is kept on the step's narration clock (nudging its rate, seeking only on a large drift and pausing
 * while the clock is held), so voice, picture and hand share one clock.
 */
import type { FollowTip, PenEngine } from './pen'

export interface PenStroke { t0: number; t1: number; kind: string; curves: [number, number][]; p: [number, number][] }
export interface PenPaths { v: number; frame: { w: number; h: number; px: [number, number] }; duration?: number; strokes: PenStroke[] }

const cache = new Map<string, Promise<PenPaths | null>>()

/** The clip's pen paths (null when the clip was rendered without them). */
export function loadPenPaths(videoUrl: string): Promise<PenPaths | null> {
  const url = videoUrl.replace(/\.mp4(\?.*)?$/i, '.pen.json')
  if (url === videoUrl) return Promise.resolve(null)
  let p = cache.get(url)
  if (!p) {
    p = fetch(url, { cache: 'force-cache' })
      .then(r => (r.ok ? (r.json() as Promise<PenPaths>) : null))
      .then(d => (d && Array.isArray(d.strokes) ? d : null))
      .catch(() => null)
    cache.set(url, p)
  }
  return p
}

/** Revealed proportion of a stroke at time t (s), from its samples. */
function proportionAt(s: PenStroke, t: number): number {
  const p = s.p
  if (!p.length || t <= p[0][0]) return p.length ? p[0][1] : 0
  if (t >= p[p.length - 1][0]) return p[p.length - 1][1]
  let lo = 0, hi = p.length - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m][0] <= t) lo = m; else hi = m }
  const [ta, pa] = p[lo], [tb, pb] = p[hi]
  return pa + (pb - pa) * ((t - ta) / Math.max(1e-6, tb - ta))
}

/** The end of the revealed part, as Manim's pointwise_become_partial(0, prop) leaves it (frame-normalised). */
export function tipOf(s: PenStroke, prop: number): [number, number] | null {
  const nc = Math.floor(s.curves.length / 4)
  if (!nc) return null
  const x = Math.max(0, Math.min(1, prop)) * nc
  let i = Math.floor(x)
  let r = x - i
  if (i >= nc) { i = nc - 1; r = 1 }
  const [a, b, c, d] = [s.curves[i * 4], s.curves[i * 4 + 1], s.curves[i * 4 + 2], s.curves[i * 4 + 3]]
  const u = 1 - r
  const w0 = u * u * u, w1 = 3 * u * u * r, w2 = 3 * u * r * r, w3 = r * r * r
  return [a[0] * w0 + b[0] * w1 + c[0] * w2 + d[0] * w3, a[1] * w0 + b[1] * w1 + c[1] * w2 + d[1] * w3]
}

/** Where the tip is at video time t: on the newest stroke being drawn, gliding to the next within 0.45 s, else null. */
export function tipAt(paths: PenPaths, t: number): { at: [number, number]; down: boolean } | null {
  let best: PenStroke | null = null
  let bestP = 0
  for (const s of paths.strokes) {
    if (s.t0 > t) break
    if (t > s.t1) continue
    const p = proportionAt(s, t)
    if (p > 0 && p < 1 && (!best || s.t0 >= best.t0)) { best = s; bestP = p }
  }
  if (best) { const at = tipOf(best, bestP); return at ? { at, down: true } : null }
  const next = paths.strokes.find(s => s.t0 > t && s.t0 - t < 0.45)
  if (next) { const at = tipOf(next, 0); return at ? { at, down: false } : null }
  return null
}

/** Client position of a frame-normalised point inside a <video> drawn with object-fit: contain. */
function toClient(video: HTMLVideoElement, n: [number, number]): { x: number; y: number } | null {
  const r = video.getBoundingClientRect()
  const vw = video.videoWidth, vh = video.videoHeight
  if (!r.width || !vw || !vh) return null
  const k = Math.min(r.width / vw, r.height / vh)
  const w = vw * k, h = vh * k
  return { x: r.left + (r.width - w) / 2 + n[0] * w, y: r.top + (r.height - h) / 2 + n[1] * h }
}

/**
 * Drive the board's hand from the clip and keep the clip on the narration clock. Returns a stop function.
 * `log` (optional) receives each frame's tip and stroke for measurements.
 */
export function followClip(pen: PenEngine, video: HTMLVideoElement, paths: PenPaths): () => void {
  let raf = 0
  let lastClock = -1, lastClockAt = 0
  const sync = () => {
    raf = requestAnimationFrame(sync)
    const c = pen.clockMs()
    if (c === null || video.readyState < 2) return
    const now = performance.now()
    if (c !== lastClock) { lastClock = c; lastClockAt = now }
    const held = now - lastClockAt > 250
    if (held) { if (!video.paused) video.pause(); return }
    if (video.paused && !video.ended && c / 1000 < (video.duration || Infinity)) void video.play().catch(() => {})
    const diff = c / 1000 - video.currentTime
    if (Math.abs(diff) > 0.35) video.currentTime = Math.max(0, c / 1000)
    else video.playbackRate = Math.max(0.9, Math.min(1.1, 1 + diff * 0.8))
  }
  raf = requestAnimationFrame(sync)
  pen.setFollow((): FollowTip | null => {
    const tip = tipAt(paths, video.currentTime)
    if (!tip) return null
    const p = toClient(video, tip.at)
    if (!p) return null
    if (typeof window !== 'undefined') {
      const w = window as unknown as { __clipTip?: unknown[] }
      if (w.__clipTip) w.__clipTip.push([video.currentTime, tip.at[0], tip.at[1], tip.down ? 1 : 0])
    }
    return { x: p.x, y: p.y, down: tip.down }
  })
  return () => { cancelAnimationFrame(raf); pen.setFollow(null); video.playbackRate = 1 }
}

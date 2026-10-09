/**
 * Hand-drawn marks (annotate steps): the pen's centre line for a circle / underline / cross / tick / bracket / arrow
 * around a target box, and its ink as a pressure-shaped outline (perfect-freehand). Pure: used by the board and by the
 * server-side snapshot renderer.
 */
import { getStroke } from 'perfect-freehand'
import type { AnnotateStep, Pt } from '@/lib/lesson-schema'
import { BOARD_H, BOARD_W } from '@/lib/lesson-schema'

export interface MarkBox { x: number; y: number; w: number; h: number }
export interface MarkGeometry {
  /** Strokes of the mark, each a list of points along the pen (drawing order). */
  strokes: Pt[][]
  /** Filled outline path of each stroke. */
  outlines: string[]
  /** Where a note sits (text anchor, left aligned) and its box. */
  note?: { x: number; y: number; box: MarkBox }
}

/** A small deterministic wobble so marks look hand-made but never change between renders. */
function wobble(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return (k: number) => {
    const v = Math.sin((h % 9973) * 0.001 + k * 12.9898) * 43758.5453
    return v - Math.floor(v) - 0.5
  }
}

const NOTE_PX = 24
const noteWidth = (note: string) => note.length * NOTE_PX * 0.48

export function markGeometry(mark: AnnotateStep['mark'], box: MarkBox, seed: string, note?: string, width = 3.2): MarkGeometry {
  const r = wobble(seed)
  const strokes: Pt[][] = []
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2
  if (mark === 'circle') {
    // An ellipse a little bigger than the box, starting at the upper left and overshooting its start.
    // Kept inside the board's left/right/top edges (a big figure's ring would otherwise be clipped by the frame).
    const OVER = 1.12
    const rx = Math.max(24, Math.min(box.w / 2 + 14, (Math.min(cx, BOARD_W - cx) - 4) / OVER))
    const ry = Math.max(20, Math.min(box.h / 2 + 12, (cy - 4) / OVER))
    const pts: Pt[] = []
    const a0 = 2.4 + r(1) * 0.3
    for (let i = 0; i <= 44; i++) {
      const t = i / 40
      const a = a0 - t * Math.PI * 2
      const k = 1 + 0.05 * Math.sin(t * 5 + r(2) * 4) + (t > 1 ? 0.06 * (t - 1) * 10 : 0)
      pts.push([cx + rx * k * Math.cos(a), cy - ry * k * Math.sin(a)])
    }
    strokes.push(pts)
  } else if (mark === 'underline') {
    const y = box.y + box.h + 6
    const pts: Pt[] = []
    for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push([box.x - 4 + (box.w + 8) * t, y + Math.sin(t * Math.PI) * 3 + r(i) * 1.2]) }
    strokes.push(pts)
  } else if (mark === 'cross') {
    const p = 6
    strokes.push([[box.x - p, box.y - p], [box.x + box.w + p, box.y + box.h + p]].map(([x, y], i) => [x + r(i) * 3, y + r(i + 4) * 3] as Pt))
    strokes.push([[box.x + box.w + p, box.y - p], [box.x - p, box.y + box.h + p]].map(([x, y], i) => [x + r(i + 8) * 3, y + r(i + 12) * 3] as Pt))
  } else if (mark === 'tick') {
    const s = Math.max(22, Math.min(40, box.h))
    const x = box.x + box.w + 12, y = cy
    strokes.push([[x, y], [x + s * 0.35, y + s * 0.4], [x + s, y - s * 0.6]])
  } else if (mark === 'bracket') {
    const x = box.x + box.w + 10, y0 = box.y - 4, y1 = box.y + box.h + 4
    strokes.push([[x, y0], [x + 8, y0 + 6], [x + 8, (y0 + y1) / 2 - 6], [x + 16, (y0 + y1) / 2], [x + 8, (y0 + y1) / 2 + 6], [x + 8, y1 - 6], [x, y1]])
  }
  // Note placement: right of the target if it fits, else above, else below.
  let notePos: MarkGeometry['note']
  if (note) {
    const w = noteWidth(note), h = NOTE_PX * 1.2
    const rightX = box.x + box.w + (mark === 'tick' || mark === 'bracket' ? 60 : 40)
    const cand: MarkBox[] = [
      { x: rightX, y: cy - h / 2 - (mark === 'arrow' ? 40 : 0), w, h },
      { x: Math.max(24, cx - w / 2), y: box.y - h - 34, w, h },
      { x: Math.max(24, cx - w / 2), y: box.y + box.h + 30, w, h },
      { x: Math.max(24, box.x - w - 44), y: cy - h / 2, w, h },
    ]
    const fits = (b: MarkBox) => b.x >= 16 && b.y >= 12 && b.x + b.w <= BOARD_W - 16 && b.y + b.h <= BOARD_H - 12
    const b = cand.find(fits) ?? cand[0]
    notePos = { x: b.x, y: b.y, box: b }
  }
  if (mark === 'arrow') {
    // From the note (or from the upper right) to the target's edge.
    const from: Pt = notePos ? [notePos.box.x - 6, notePos.box.y + notePos.box.h / 2] : [box.x + box.w + 70, box.y - 40]
    const to: Pt = [from[0] < box.x ? box.x - 6 : box.x + box.w + 6, from[1] < box.y ? box.y - 4 : from[1] > box.y + box.h ? box.y + box.h + 4 : cy]
    const mid: Pt = [(from[0] + to[0]) / 2 + r(3) * 10, (from[1] + to[1]) / 2 - 14]
    const line: Pt[] = []
    for (let i = 0; i <= 14; i++) { const t = i / 14; line.push([(1 - t) * (1 - t) * from[0] + 2 * (1 - t) * t * mid[0] + t * t * to[0], (1 - t) * (1 - t) * from[1] + 2 * (1 - t) * t * mid[1] + t * t * to[1]]) }
    strokes.push(line)
    const a = Math.atan2(to[1] - line[12][1], to[0] - line[12][0])
    const s = 14
    strokes.push([[to[0] - s * Math.cos(a - 0.5), to[1] - s * Math.sin(a - 0.5)], to, [to[0] - s * Math.cos(a + 0.5), to[1] - s * Math.sin(a + 0.5)]])
  }
  const outlines = strokes.map(pts => outlinePath(getStroke(pts, { size: width * 2, thinning: 0.55, smoothing: 0.6, streamline: 0.45, simulatePressure: true, last: true })))
  return { strokes, outlines, note: notePos }
}

export function centerPath(pts: Pt[]) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
}

/** perfect-freehand outline points → a closed smooth SVG path. */
function outlinePath(stroke: number[][]): string {
  if (!stroke.length) return ''
  const d = stroke.reduce<string[]>((acc, [x0, y0], i, arr) => {
    const [x1, y1] = arr[(i + 1) % arr.length]
    acc.push(`${x0.toFixed(1)},${y0.toFixed(1)}`, `${((x0 + x1) / 2).toFixed(1)},${((y0 + y1) / 2).toFixed(1)}`)
    return acc
  }, ['M', `${stroke[0][0].toFixed(1)},${stroke[0][1].toFixed(1)}`, 'Q'])
  return `${d.join(' ')} Z`
}

export const MARK_NOTE_PX = NOTE_PX

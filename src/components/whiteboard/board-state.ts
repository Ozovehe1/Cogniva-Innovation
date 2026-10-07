import type { CheckStep, DrawStep, Ink, Step, TextSize } from '@/lib/lesson-schema'
import { BOARD_H, BOARD_W } from '@/lib/lesson-schema'

export const INK_HEX: Record<Ink, string> = {
  ink: '#14141A',
  accent: '#1F4D3A',
  clay: '#A4502A',
  navy: '#23406A',
  amber: '#8A5A00',
  muted: '#66666F',
}

export const SIZE_PX: Record<TextSize, number> = { sm: 22, md: 30, lg: 40, xl: 54 }

export interface AxesDef {
  id: string
  frame: { x: number; y: number; w: number; h: number }
  xRange: [number, number]
  yRange: [number, number]
}

interface ElBase {
  /** Stable React key. */
  key: string
  /** Author id (may be undefined for anonymous elements). */
  id?: string
  /** Index of the step that created the element. */
  born: number
}

export interface TextEl extends ElBase {
  kind: 'text' | 'math'
  content: string
  prevContent?: string
  prevX?: number
  prevY?: number
  /** Index of the transform step that last changed this element. */
  morphedAt?: number
  x: number
  y: number
  size: TextSize
  color: Ink
  font: 'serif' | 'sans'
  align: 'left' | 'center' | 'right'
  maxWidth?: number
}

export interface ShapeEl extends ElBase {
  kind: 'shape'
  step: DrawStep
  axes?: AxesDef
}

export interface HighlightEl extends ElBase {
  kind: 'highlight'
  target: string
  style: 'box' | 'underline'
  color: Ink
}

export type BoardEl = TextEl | ShapeEl | HighlightEl

export interface BoardState {
  els: BoardEl[]
  axes: Record<string, AxesDef>
}

export const emptyBoard = (): BoardState => ({ els: [], axes: {} })

/** Apply one step to a board (pure, returns a new state). Unknown targets are ignored. */
export function applyStep(state: BoardState, step: Step, index: number): BoardState {
  const els = state.els
  const axes = state.axes
  const anon = `s${index}`
  switch (step.type) {
    case 'write':
    case 'math': {
      const el: TextEl = {
        kind: step.type === 'write' ? 'text' : 'math',
        key: `${step.id ?? anon}@${index}`,
        id: step.id,
        born: index,
        content: step.type === 'write' ? step.text : step.tex,
        x: step.x,
        y: step.y,
        size: step.size ?? 'md',
        color: step.color ?? 'ink',
        font: step.type === 'write' ? step.font ?? 'serif' : 'serif',
        align: step.align ?? 'left',
        maxWidth: step.type === 'write' ? step.maxWidth : undefined,
      }
      const rest = step.id ? els.filter(e => e.id !== step.id) : els
      return { els: [...rest, el], axes }
    }
    case 'draw': {
      const axesDef = step.on ? axes[step.on] : undefined
      if (step.on && !axesDef) return state
      const el: ShapeEl = { kind: 'shape', key: `${step.id ?? anon}@${index}`, id: step.id, born: index, step, axes: axesDef }
      const rest = step.id ? els.filter(e => e.id !== step.id) : els
      let nextAxes = axes
      if (step.shape.kind === 'axes' && step.id) {
        nextAxes = { ...axes, [step.id]: { id: step.id, frame: step.shape.frame, xRange: step.shape.xRange, yRange: step.shape.yRange } }
      }
      return { els: [...rest, el], axes: nextAxes }
    }
    case 'highlight': {
      if (!els.some(e => e.id === step.target && e.kind !== 'highlight')) return state
      const el: HighlightEl = {
        kind: 'highlight',
        key: `hl-${step.target}@${index}`,
        born: index,
        target: step.target,
        style: step.style ?? 'box',
        color: step.color ?? 'amber',
      }
      // One highlight per target at a time.
      return { els: [...els.filter(e => !(e.kind === 'highlight' && e.target === step.target)), el], axes }
    }
    case 'transform': {
      let changed = false
      const next = els.map(e => {
        if (changed || e.id !== step.target || (e.kind !== 'text' && e.kind !== 'math')) return e
        changed = true
        const content = step.tex ?? step.text ?? e.content
        const kind: TextEl['kind'] = step.tex !== undefined ? 'math' : step.text !== undefined ? 'text' : e.kind
        return {
          ...e,
          kind,
          prevContent: e.kind === kind ? e.content : undefined,
          prevX: e.x,
          prevY: e.y,
          content,
          x: step.x ?? e.x,
          y: step.y ?? e.y,
          color: step.color ?? e.color,
          morphedAt: index,
        } satisfies TextEl
      })
      if (!changed) return state
      // Highlights on a morphing element would point at stale geometry.
      return { els: next.filter(e => !(e.kind === 'highlight' && e.target === step.target)), axes }
    }
    case 'clear': {
      if (!step.targets) return emptyBoard()
      const drop = new Set(step.targets)
      const nextAxes = { ...axes }
      for (const t of drop) delete nextAxes[t]
      return {
        els: els.filter(e => !(e.id && drop.has(e.id)) && !(e.kind === 'highlight' && drop.has(e.target))),
        axes: nextAxes,
      }
    }
    default:
      return state
  }
}

export function buildBoard(steps: Step[], count: number): BoardState {
  let s = emptyBoard()
  for (let i = 0; i < Math.min(count, steps.length); i++) s = applyStep(s, steps[i], i)
  return s
}

/* ───────────── Timing ───────────── */

const SHAPE_MS: Record<string, number> = {
  line: 700, arrow: 800, circle: 900, rect: 900, polyline: 1000, polygon: 1000, arc: 800, sector: 900, point: 380, axes: 1200, function: 1600,
}

/** How long a step's own animation runs, in ms. */
export function animMs(step: Step): number {
  switch (step.type) {
    case 'write': return clamp(320 + step.text.length * 30, 520, 2400)
    case 'math': return clamp(450 + step.tex.length * 14, 650, 1800)
    case 'draw': return SHAPE_MS[step.shape.kind] ?? 800
    case 'highlight': return 650
    case 'transform': return 950
    case 'clear': return 420
    case 'pause': return step.ms
    default: return 0
  }
}

/** How long to dwell on a step before the next one starts, in ms. */
export function dwellMs(step: Step): number {
  const words = step.say ? step.say.trim().split(/\s+/).length : 0
  const reading = words ? Math.min(5200, 700 + words * 210) : 0
  return Math.max(animMs(step) + 320, reading)
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/* ───────────── Geometry ───────────── */

export function toBoard(axes: AxesDef | undefined, p: [number, number]): [number, number] {
  if (!axes) return p
  const { frame, xRange, yRange } = axes
  const x = frame.x + ((p[0] - xRange[0]) / (xRange[1] - xRange[0])) * frame.w
  const y = frame.y + frame.h - ((p[1] - yRange[0]) / (yRange[1] - yRange[0])) * frame.h
  return [x, y]
}

export function xScale(axes: AxesDef | undefined) {
  return axes ? axes.frame.w / (axes.xRange[1] - axes.xRange[0]) : 1
}

export interface Box { x: number; y: number; w: number; h: number }

/** Bounding box of a shape element in board units. */
export function shapeBox(el: ShapeEl): Box | null {
  const { shape } = el.step
  const pts: [number, number][] = []
  switch (shape.kind) {
    case 'line':
    case 'arrow': pts.push(toBoard(el.axes, shape.from), toBoard(el.axes, shape.to)); break
    case 'polyline':
    case 'polygon': shape.points.forEach(p => pts.push(toBoard(el.axes, p))); break
    case 'arc':
    case 'sector': {
      const [cx, cy] = toBoard(el.axes, shape.center)
      const r = shape.r * xScale(el.axes)
      pts.push([cx - r, cy - r], [cx + r, cy + r]); break
    }
    case 'point': { const [x, y] = toBoard(el.axes, shape.at); pts.push([x - 6, y - 6], [x + 6, y + 6]); break }
    case 'rect': pts.push(toBoard(el.axes, [shape.x, shape.y]), toBoard(el.axes, [shape.x + shape.w, shape.y + shape.h])); break
    case 'circle': {
      const [cx, cy] = toBoard(el.axes, shape.center)
      const r = shape.r * xScale(el.axes)
      pts.push([cx - r, cy - r], [cx + r, cy + r]); break
    }
    case 'axes': {
      const f = shape.frame
      pts.push([f.x, f.y], [f.x + f.w, f.y + f.h]); break
    }
    case 'function': {
      if (!el.axes) return null
      const f = el.axes.frame
      pts.push([f.x, f.y], [f.x + f.w, f.y + f.h]); break
    }
  }
  if (!pts.length) return null
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** The step index where the current "segment" began: just after the previous check or full clear. */
export function segmentStart(steps: Step[], checkIndex: number): number {
  for (let i = checkIndex - 1; i >= 0; i--) {
    const s = steps[i]
    if (s.type === 'check') return i + 1
    if (s.type === 'clear' && !s.targets) return i + 1
  }
  return 0
}

export function isBlocking(step: Step | undefined): step is CheckStep {
  return !!step && step.type === 'check'
}

export const BOARD = { W: BOARD_W, H: BOARD_H }

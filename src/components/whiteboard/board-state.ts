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

/* ───────────── Text size estimates ───────────── */

// Average glyph width as a fraction of font size, measured on the board (Newsreader / Inter).
const CHAR_W = { serif: 0.44, sans: 0.5 }

export function visibleTexLength(tex: string) {
  // A fraction is as wide as its wider part.
  let t = tex
  for (let i = 0; i < 6; i++) {
    const next = t.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a: string, b: string) => (a.length >= b.length ? a : b))
    if (next === t) break
    t = next
  }
  return t
    .replace(/\\(text|mathrm|mathbf|operatorname)\{([^}]*)\}/g, '$2')
    .replace(/\\(frac|dfrac|tfrac)/g, '')
    .replace(/\\(left|right|displaystyle|quad|qquad|,|;|!)/g, ' ')
    .replace(/\\[a-zA-Z]+/g, 'x')
    .replace(/[{}^_]/g, '')
    .replace(/\s+/g, '').length
}

/** Rough box of a text or math element in board units. */
export function estimateTextBox(el: TextEl): Box {
  const size = SIZE_PX[el.size]
  let w: number
  let h: number
  if (el.kind === 'math') {
    const fs = size * 0.86 * 1.21
    w = visibleTexLength(el.content) * fs * 0.5
    const tall = /\\(frac|dfrac|sum|int|lim|begin)/.test(el.content)
    const rows = (el.content.match(/\\\\/g)?.length ?? 0) + 1
    h = fs * (tall ? 2.1 : 1.25) * (/\\begin/.test(el.content) ? rows : 1)
  } else {
    const natural = el.content.length * size * CHAR_W[el.font]
    const max = el.maxWidth ?? Infinity
    w = Math.min(natural, max)
    const lines = Math.max(1, Math.ceil(natural / Math.min(max, BOARD_W)))
    h = lines * size * 1.18
  }
  const x = el.align === 'center' ? el.x - w / 2 : el.align === 'right' ? el.x - w : el.x
  return { x, y: el.y, w, h }
}



/* ───────────── Compact (phone) layout ───────────── */

/** Longest text that still counts as a diagram label on a phone; longer text reflows below the diagram. */
export const LABEL_MAX_CHARS = 24
/** How close (board units) text must sit to a drawing to count as its label. */
export const LABEL_GAP = 16

function visibleLength(el: TextEl) {
  return el.kind === 'math' ? visibleTexLength(el.content) : el.content.length
}

function near(a: Box, b: Box, gap: number) {
  return a.x < b.x + b.w + gap && a.x + a.w > b.x - gap && a.y < b.y + b.h + gap && a.y + a.h > b.y - gap
}

export interface CompactLayout {
  /** Region of the board holding the drawings and their labels, or null when nothing is drawn. */
  region: Box | null
  /** Text/math ids (element keys) drawn inside the diagram as labels. */
  labels: Set<string>
  /** Text/math elements shown as reflowed notes under the diagram, in reading order. */
  notes: TextEl[]
}

/**
 * On narrow screens the 800x500 board is too small to read. The diagram
 * (shapes plus short labels that touch them) is cropped and zoomed to the
 * screen width, and every other text or math element reflows below it as a
 * readable note, top-to-bottom then left-to-right. lesson-layout's lint uses
 * the same rule so authored scripts read well both ways.
 */
export function compactPartition(board: BoardState): CompactLayout {
  const shapes: Box[] = []
  for (const el of board.els) {
    if (el.kind !== 'shape') continue
    const b = shapeBox(el)
    if (b) shapes.push(b)
  }
  const labels = new Set<string>()
  const notes: TextEl[] = []
  const labelBoxes: Box[] = []
  for (const el of board.els) {
    if (el.kind !== 'text' && el.kind !== 'math') continue
    const box = estimateTextBox(el)
    if (shapes.length && visibleLength(el) <= LABEL_MAX_CHARS && shapes.some(s => near(box, s, LABEL_GAP))) {
      labels.add(el.key)
      labelBoxes.push(box)
    } else notes.push(el)
  }
  notes.sort((a, b) => (Math.abs(a.y - b.y) < 18 ? a.x - b.x : a.y - b.y))
  if (!shapes.length) return { region: null, labels, notes }
  const all = [...shapes, ...labelBoxes]
  const pad = 30 // room for tick numbers, axis names and point labels
  const x0 = Math.max(0, Math.min(...all.map(b => b.x)) - pad)
  const y0 = Math.max(0, Math.min(...all.map(b => b.y)) - pad)
  const x1 = Math.min(BOARD_W, Math.max(...all.map(b => b.x + b.w)) + pad)
  const y1 = Math.min(BOARD_H, Math.max(...all.map(b => b.y + b.h)) + pad)
  return { region: { x: x0, y: y0, w: Math.max(80, x1 - x0), h: Math.max(60, y1 - y0) }, labels, notes }
}

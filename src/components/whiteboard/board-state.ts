import type { CheckStep, Cue, CueAction, DrawStep, Ink, Num, Step, TextSize, Vars } from '@/lib/lesson-schema'
import { ACTION_TYPES, BOARD_H, BOARD_W, TEMPLATE_RE, compileExpr } from '@/lib/lesson-schema'

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

/** Motion applied to an element after it was drawn (move / fade / scale / color pulse). */
export interface Fx {
  dx: number
  dy: number
  scale: number
  opacity: number
  /** Action key of the last pulse (Indicate). */
  pulse?: string
  /** Action key of the last change, so the player can animate it over that action's duration. */
  act: string
}

interface ElBase {
  /** Stable React key. */
  key: string
  /** Author id (may be undefined for anonymous elements). */
  id?: string
  /** Index of the step that created the element. */
  born: number
  /** Action that created it: "<step>.<k>" (k = 0 for the step itself, k >= 1 for its cues). */
  act: string
  fx?: Fx
  /** Geometry or text depends on board variables (re-rendered while they animate). */
  dyn?: boolean
}

export interface TextEl extends ElBase {
  kind: 'text' | 'math'
  content: string
  prevContent?: string
  prevX?: number
  prevY?: number
  /** Index of the transform step that last changed this element. */
  morphedAt?: number
  /** Action key of that transform. */
  morphAct?: string
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

export interface Camera { zoom: number; cx: number; cy: number; act: string }

export interface BoardState {
  els: BoardEl[]
  axes: Record<string, AxesDef>
  /** Board variables (set / animate), at their final values. */
  vars: Vars
  camera: Camera | null
}

export const emptyBoard = (vars: Vars = {}): BoardState => ({ els: [], axes: {}, vars, camera: null })

/* ───────────── Actions: a step's own action plus its narration cues ───────────── */

export type Action = Exclude<Step, { type: 'check' | 'pause' | 'manim_clip' }> | CueAction

export interface StepAction {
  /** 0 = the step's own action, k >= 1 = cues[k - 1]. */
  k: number
  key: string
  action: Action
  at?: Cue
  until?: Cue
}

const isActionType = (t: string) => (ACTION_TYPES as readonly string[]).includes(t)

/** The actions a step performs, in order: its own (when it is an action type) then its cues. */
export function stepActions(step: Step, index: number): StepAction[] {
  const out: StepAction[] = []
  if (isActionType(step.type)) out.push({ k: 0, key: `${index}.0`, action: step as Action, at: step.at, until: step.until })
  const cues = (step as { cues?: CueAction[] }).cues
  if (Array.isArray(cues)) cues.forEach((c, i) => out.push({ k: i + 1, key: `${index}.${i + 1}`, action: c, at: c.at, until: c.until }))
  return out
}

const hasVarRef = (v: Num | undefined) => typeof v === 'string'
function shapeIsDyn(step: DrawStep): boolean {
  const sh = step.shape
  switch (sh.kind) {
    case 'line': case 'arrow': return sh.from.some(hasVarRef) || sh.to.some(hasVarRef)
    case 'point': return sh.at.some(hasVarRef)
    case 'secant': return hasVarRef(sh.x1) || hasVarRef(sh.x2) || /[a-wyz]/i.test(sh.expr.replace(/sin|cos|tan|exp|ln|log|sqrt|abs|pi|e\b/g, ''))
    case 'tangent': return hasVarRef(sh.at) || /[a-wyz]/i.test(sh.expr.replace(/sin|cos|tan|exp|ln|log|sqrt|abs|pi|e\b/g, ''))
    case 'function': return /[a-wyz]/i.test(sh.expr.replace(/sin|cos|tan|exp|ln|log|sqrt|abs|pi|e\b|asin|acos|atan|sinh|cosh|tanh|floor|ceil/g, ''))
    default: return false
  }
}
const hasTemplate = (t: string) => { TEMPLATE_RE.lastIndex = 0; return TEMPLATE_RE.test(t) }

/* ───────────── Evaluating expressions ───────────── */

const exprCache = new Map<string, ReturnType<typeof compileExpr>>()
function compiled(src: string, vars: Vars) {
  const ck = `${src}|${Object.keys(vars).sort().join(',')}`
  let c = exprCache.get(ck)
  if (!c) { c = compileExpr(src, Object.keys(vars)); if (exprCache.size > 500) exprCache.clear(); exprCache.set(ck, c) }
  return c
}

/** A number, or an expression evaluated with the board variables. */
export function evalNum(v: Num, vars: Vars, x = 0): number {
  if (typeof v === 'number') return v
  const c = compiled(v, vars)
  return c.ok ? c.fn(x, vars) : NaN
}

/** A function of x (with variables). */
export function evalFn(expr: string, vars: Vars): (x: number) => number {
  const c = compiled(expr, vars)
  return c.ok ? (x: number) => c.fn(x, vars) : () => NaN
}

/** Fill {{expr}} / {{expr:2}} templates with live values. */
export function fillTemplates(text: string, vars: Vars): string {
  if (!text.includes('{{')) return text
  return text.replace(TEMPLATE_RE, (_, ex: string, dp?: string) => {
    const v = evalNum(ex.trim(), vars)
    if (!Number.isFinite(v)) return '?'
    const d = dp !== undefined ? Number(dp) : 2
    const r = v.toFixed(d)
    return r === '-0' || /^-0\.0*$/.test(r) ? r.slice(1) : r
  })
}

/** Apply a whole step (its own action and all its cues) to a board (pure). */
export function applyStep(state: BoardState, step: Step, index: number): BoardState {
  let s = state
  for (const a of stepActions(step, index)) s = applyAction(s, a.action, index, a.k)
  return s
}

const baseFx = (el: BoardEl, act: string): Fx => ({ dx: 0, dy: 0, scale: 1, opacity: 1, ...el.fx, act })

/** Apply one action to a board (pure, returns a new state). Unknown targets are ignored. */
export function applyAction(state: BoardState, step: Action, index: number, k = 0): BoardState {
  const els = state.els
  const axes = state.axes
  const act = `${index}.${k}`
  const anon = k ? `s${index}c${k}` : `s${index}`
  const keyOf = (id?: string) => `${id ?? anon}@${k ? act : index}`
  switch (step.type) {
    case 'write':
    case 'math': {
      const content = step.type === 'write' ? step.text : step.tex
      const el: TextEl = {
        kind: step.type === 'write' ? 'text' : 'math',
        key: keyOf(step.id),
        id: step.id,
        born: index,
        act,
        dyn: hasTemplate(content) || undefined,
        content,
        x: step.x,
        y: step.y,
        size: step.size ?? 'md',
        color: step.color ?? 'ink',
        font: step.type === 'write' ? step.font ?? 'serif' : 'serif',
        align: step.align ?? 'left',
        maxWidth: step.type === 'write' ? step.maxWidth : undefined,
      }
      const rest = step.id ? els.filter(e => e.id !== step.id) : els
      return { ...state, els: [...rest, el] }
    }
    case 'draw': {
      const axesDef = step.on ? axes[step.on] : undefined
      if (step.on && !axesDef) return state
      const plain: DrawStep = { type: 'draw', id: step.id, shape: step.shape, color: step.color, width: step.width, dashed: step.dashed, fill: step.fill, on: step.on }
      const el: ShapeEl = { kind: 'shape', key: keyOf(step.id), id: step.id, born: index, act, step: plain, axes: axesDef, dyn: shapeIsDyn(plain) || undefined }
      const rest = step.id ? els.filter(e => e.id !== step.id) : els
      let nextAxes = axes
      if (step.shape.kind === 'axes' && step.id) {
        nextAxes = { ...axes, [step.id]: { id: step.id, frame: step.shape.frame, xRange: step.shape.xRange, yRange: step.shape.yRange } }
      }
      return { ...state, els: [...rest, el], axes: nextAxes }
    }
    case 'highlight': {
      if (!els.some(e => e.id === step.target && e.kind !== 'highlight')) return state
      const el: HighlightEl = {
        kind: 'highlight',
        key: `hl-${step.target}@${k ? act : index}`,
        born: index,
        act,
        target: step.target,
        style: step.style ?? 'box',
        color: step.color ?? 'amber',
      }
      // One highlight per target at a time.
      return { ...state, els: [...els.filter(e => !(e.kind === 'highlight' && e.target === step.target)), el] }
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
          dyn: hasTemplate(content) || undefined,
          x: step.x ?? e.x,
          y: step.y ?? e.y,
          color: step.color ?? e.color,
          morphedAt: index,
          morphAct: act,
        } satisfies TextEl
      })
      if (!changed) return state
      // Highlights on a morphing element would point at stale geometry.
      return { ...state, els: next.filter(e => !(e.kind === 'highlight' && e.target === step.target)) }
    }
    case 'clear': {
      if (!step.targets) return emptyBoard(state.vars)
      const drop = new Set(step.targets)
      const nextAxes = { ...axes }
      for (const t of drop) delete nextAxes[t]
      return {
        ...state,
        els: els.filter(e => !(e.id && drop.has(e.id)) && !(e.kind === 'highlight' && drop.has(e.target))),
        axes: nextAxes,
      }
    }
    case 'set':
      return { ...state, vars: { ...state.vars, ...step.vars } }
    case 'animate':
      // there_and_back returns to where it started.
      return { ...state, vars: { ...state.vars, [step.var]: step.ease === 'there_and_back' ? step.from ?? state.vars[step.var] ?? step.to : step.to } }
    case 'move':
    case 'fade':
    case 'scale':
    case 'color': {
      let changed = false
      const next = els.map(e => {
        if (changed || e.id !== step.target || e.kind === 'highlight') return e
        changed = true
        const fx = baseFx(e, act)
        if (step.type === 'move') {
          if (step.by) {
            const sx = e.kind === 'shape' && e.axes ? xScale(e.axes) : 1
            const sy = e.kind === 'shape' && e.axes ? e.axes.frame.h / (e.axes.yRange[1] - e.axes.yRange[0]) : 1
            fx.dx += step.by[0] * sx
            fx.dy -= e.kind === 'shape' && e.axes ? step.by[1] * sy : -step.by[1]
          } else if (step.to) {
            if (e.kind === 'shape') {
              const b = shapeBox(e, state.vars)
              if (b) { fx.dx = step.to[0] - (b.x + b.w / 2); fx.dy = step.to[1] - (b.y + b.h / 2) }
            } else { fx.dx = step.to[0] - e.x; fx.dy = step.to[1] - e.y }
          }
        } else if (step.type === 'fade') fx.opacity = step.to
        else if (step.type === 'scale') fx.scale = fx.scale * step.by
        else if (step.type === 'color') {
          if (step.pulse) fx.pulse = act
          if (e.kind === 'shape') return { ...e, fx, step: { ...e.step, color: step.color } }
          return { ...e, fx, color: step.color }
        }
        return { ...e, fx }
      })
      return changed ? { ...state, els: next } : state
    }
    case 'camera': {
      if (step.zoom <= 1.001) return { ...state, camera: null }
      let c: [number, number] = step.center ?? [BOARD_W / 2, BOARD_H / 2]
      if (step.on && axes[step.on]) {
        const a = axes[step.on]
        c = step.center ? toBoard(a, step.center) : [a.frame.x + a.frame.w / 2, a.frame.y + a.frame.h / 2]
      }
      return { ...state, camera: { zoom: step.zoom, cx: c[0], cy: c[1], act } }
    }
    default:
      return state
  }
}

/** Variables set by steps before `from` (a full clear keeps variables). */
function varsBefore(steps: Step[], from: number): Vars {
  const v: Vars = {}
  for (let i = 0; i < from; i++) {
    for (const a of stepActions(steps[i], i)) {
      if (a.action.type === 'set') Object.assign(v, a.action.vars)
      else if (a.action.type === 'animate') v[a.action.var] = a.action.to
    }
  }
  return v
}

export function buildBoard(steps: Step[], count: number): BoardState {
  const n = Math.min(count, steps.length)
  // A full clear empties the board, so only the steps after the last one matter
  // (keeps long lessons cheap: the cost is bounded by one section, not the lesson).
  let from = 0
  for (let k = n - 1; k >= 0; k--) {
    const st = steps[k]
    if (st.type === 'clear' && !st.targets) { from = k + 1; break }
  }
  let s = emptyBoard(from > 0 ? varsBefore(steps, from) : {})
  for (let i = from; i < n; i++) s = applyStep(s, steps[i], i)
  return s
}

/* ───────────── Timing ───────────── */

const SHAPE_MS: Record<string, number> = {
  line: 700, arrow: 800, circle: 900, rect: 900, polyline: 1000, polygon: 1000, arc: 800, sector: 900, point: 380, axes: 1200, function: 1600, secant: 700, tangent: 700,
}

/** How long a step's own animation runs, in ms (its natural length, before narration stretches it). */
export function animMs(step: Step | Action): number {
  switch (step.type) {
    case 'set': return 0
    case 'animate': return 1500
    case 'move': return 900
    case 'fade': return 600
    case 'scale': return 700
    case 'color': return 650
    case 'camera': return 1100
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
  if (step.type === 'check' || step.type === 'manim_clip') return 0
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
export function shapeBox(el: ShapeEl, vars: Vars = {}): Box | null {
  const { shape } = el.step
  const pts: [number, number][] = []
  const P = (p: [Num, Num]): [number, number] => toBoard(el.axes, [evalNum(p[0], vars), evalNum(p[1], vars)])
  switch (shape.kind) {
    case 'line':
    case 'arrow': pts.push(P(shape.from), P(shape.to)); break
    case 'polyline':
    case 'polygon': shape.points.forEach(p => pts.push(toBoard(el.axes, p))); break
    case 'arc':
    case 'sector': {
      const [cx, cy] = toBoard(el.axes, shape.center)
      const r = shape.r * xScale(el.axes)
      pts.push([cx - r, cy - r], [cx + r, cy + r]); break
    }
    case 'point': { const [x, y] = P(shape.at); if (!Number.isFinite(x) || !Number.isFinite(y)) return null; pts.push([x - 6, y - 6], [x + 6, y + 6]); break }
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
    case 'function':
    case 'secant':
    case 'tangent': {
      if (!el.axes) return null
      const f = el.axes.frame
      pts.push([f.x, f.y], [f.x + f.w, f.y + f.h]); break
    }
  }
  if (pts.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null
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
    const b = shapeBox(el, board.vars)
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

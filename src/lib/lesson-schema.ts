/**
 * Live Tutor lesson "scene script".
 *
 * A lesson is an ordered array of steps that the whiteboard engine plays back.
 * Coordinates are in board units: the board is BOARD_W x BOARD_H (16:10) with
 * the origin at the top-left. A draw step may instead use the coordinate system
 * of a previously drawn `axes` shape by setting `on` to that shape's id.
 *
 * The validator below is hand-written (no schema library) and is used both for
 * scripts stored in Supabase and for anything Gemini returns.
 */

export const BOARD_W = 800
export const BOARD_H = 500

export const INKS = ['ink', 'accent', 'clay', 'navy', 'amber', 'muted'] as const
export type Ink = (typeof INKS)[number]

export const SIZES = ['sm', 'md', 'lg', 'xl'] as const
export type TextSize = (typeof SIZES)[number]

export type Pt = [number, number]
export interface Frame { x: number; y: number; w: number; h: number }

interface StepBase {
  /** Optional element id so later steps can highlight, transform or clear it. */
  id?: string
  /**
   * Narration for this step: spoken aloud by the tutor's voice and added to the
   * lesson transcript. Plain spoken English; inline math may be written as
   * $...$ (rendered with KaTeX in the transcript, read out in words).
   */
  say?: string
  /**
   * Narration sync. The step's own action starts when the word `at` is spoken and
   * lasts until the word `until` (defaults: starts with the narration, natural length
   * stretched to the phrase). A cue is a 0-based word index into `say`, or a word or
   * short phrase that appears in `say`.
   */
  at?: Cue
  until?: Cue
  /** More actions fired at words of this step's narration (in spoken order). */
  cues?: CueAction[]
}

/** A moment in a step's narration: a 0-based word index into `say`, or a word/phrase from `say`. */
export type Cue = number | string
/** A number, or an expression in the board's variables (see `set` / `animate`), e.g. "a + h". */
export type Num = number | string
export type PtX = [Num, Num]

export interface WriteStep extends StepBase {
  type: 'write'
  text: string
  x: number
  y: number
  size?: TextSize
  color?: Ink
  font?: 'serif' | 'sans'
  /** Anchor of x: left edge (default), centre, or right edge. */
  align?: 'left' | 'center' | 'right'
  /** Max width in board units before wrapping. */
  maxWidth?: number
}

export interface MathStep extends StepBase {
  type: 'math'
  tex: string
  x: number
  y: number
  size?: TextSize
  color?: Ink
  align?: 'left' | 'center' | 'right'
}

export type Shape =
  | { kind: 'line'; from: PtX; to: PtX }
  | { kind: 'arrow'; from: PtX; to: PtX }
  | { kind: 'circle'; center: Pt; r: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'polyline'; points: Pt[] }
  /** Closed polygon. */
  | { kind: 'polygon'; points: Pt[] }
  /** Arc of a circle; angles in degrees, counter-clockwise from the +x direction. */
  | { kind: 'arc'; center: Pt; r: number; from: number; to: number }
  /** Pie wedge (sector); angles as for arc. */
  | { kind: 'sector'; center: Pt; r: number; from: number; to: number }
  | { kind: 'point'; at: PtX; label?: string; labelPos?: 'ne' | 'nw' | 'se' | 'sw' }
  /** Line through the curve at x1 and x2, extended past both; becomes the tangent as x2 -> x1. Needs `on`. */
  | { kind: 'secant'; expr: string; x1: Num; x2: Num; extend?: number }
  /** Tangent to the curve at x = at (numerical slope). Needs `on`. `len` = length in x units (default: the axes width). */
  | { kind: 'tangent'; expr: string; at: Num; len?: number }
  | {
      kind: 'axes'
      frame: Frame
      xRange: [number, number]
      yRange: [number, number]
      xLabel?: string
      yLabel?: string
      /** Tick spacing in graph units; omitted = no ticks. */
      xStep?: number
      yStep?: number
    }
  | {
      kind: 'function'
      /** Expression in x (and board variables), e.g. "x^2", "sin(x) + 0.5*x", "m*(x - 1) + 1". */
      expr: string
      /** Defaults to the axes' x range. */
      domain?: [number, number]
    }

export interface DrawStep extends StepBase {
  type: 'draw'
  shape: Shape
  color?: Ink
  width?: number
  dashed?: boolean
  /** Fill closed shapes (circle, rect, polygon, sector) with a light tint of the colour. */
  fill?: boolean
  /** Id of an axes shape whose graph coordinates this shape uses. Required for `function`. */
  on?: string
}

export interface HighlightStep extends StepBase {
  type: 'highlight'
  target: string
  style?: 'box' | 'underline'
  color?: Ink
}

export interface TransformStep extends StepBase {
  type: 'transform'
  /** Id of the write/math element to morph. Keeps the same id afterwards. */
  target: string
  tex?: string
  text?: string
  x?: number
  y?: number
  color?: Ink
}

export interface ClearStep extends StepBase {
  type: 'clear'
  /** Ids to remove. Omit to clear the whole board. */
  targets?: string[]
}

export interface PauseStep extends StepBase {
  type: 'pause'
  /** Milliseconds, 200..10000. */
  ms: number
}

export interface CheckStep extends StepBase {
  type: 'check'
  kind: 'understand' | 'choice' | 'short'
  prompt: string
  /** For kind=choice. */
  options?: string[]
  /** For kind=choice: index of the correct option. */
  answer?: number
  /** For kind=short: accepted answers (case/space-insensitive). */
  accept?: string[]
  /** Shown after a correct answer. */
  explanation?: string
  /** Pre-written alternative explanation, used instantly or when the AI tutor is unavailable. */
  reteach?: Step[]
}

export interface ManimClipStep extends StepBase {
  type: 'manim_clip'
  url: string
  caption?: string
  /** Id of the manim_jobs row the clip came from, when inserted by a tutor. */
  jobId?: string
}

/** Set board variables instantly (used by expressions in shapes and {{...}} in text). */
export interface SetStep extends StepBase {
  type: 'set'
  vars: Record<string, number>
}

/** Smoothly animate a board variable (like Manim's ValueTracker) over the step's narration. */
export interface AnimateStep extends StepBase {
  type: 'animate'
  var: string
  to: number
  /** Start value (defaults to the variable's current value). */
  from?: number
  ease?: 'smooth' | 'linear' | 'there_and_back'
}

/** Move an element: `by` [dx, dy] in board units (or graph units for shapes on axes), or `to` [x, y] for text. */
export interface MoveStep extends StepBase {
  type: 'move'
  target: string
  by?: Pt
  to?: Pt
}

/** Fade an element to an opacity (0 hides it but keeps its id). */
export interface FadeStep extends StepBase {
  type: 'fade'
  target: string
  to: number
}

/** Scale an element about its centre. */
export interface ScaleStep extends StepBase {
  type: 'scale'
  target: string
  by: number
}

/** Recolour an element; `pulse` briefly enlarges it to draw the eye (like Manim's Indicate). */
export interface ColorStep extends StepBase {
  type: 'color'
  target: string
  color: Ink
  pulse?: boolean
}

/** Camera: zoom into a point of the board (or of an axes' graph with `on`); zoom 1 resets. */
export interface CameraStep extends StepBase {
  type: 'camera'
  zoom: number
  center?: Pt
  on?: string
}

export type Step =
  | SetStep
  | AnimateStep
  | MoveStep
  | FadeStep
  | ScaleStep
  | ColorStep
  | CameraStep
  | WriteStep
  | MathStep
  | DrawStep
  | HighlightStep
  | TransformStep
  | ClearStep
  | PauseStep
  | CheckStep
  | ManimClipStep

export type StepType = Step['type']
export const STEP_TYPES: StepType[] = ['write', 'math', 'draw', 'highlight', 'transform', 'clear', 'pause', 'check', 'manim_clip', 'set', 'animate', 'move', 'fade', 'scale', 'color', 'camera']

/** Step types that can also be fired as cues during another step's narration. */
export const ACTION_TYPES = ['write', 'math', 'draw', 'highlight', 'transform', 'clear', 'set', 'animate', 'move', 'fade', 'scale', 'color', 'camera'] as const
export type ActionType = (typeof ACTION_TYPES)[number]
type ActionStep = Extract<Step, { type: ActionType }>
/** An action fired at a word of the step's narration. */
export type CueAction = (ActionStep extends infer A ? A extends ActionStep ? Omit<A, 'say' | 'cues' | 'at'> & { at: Cue } : never : never)

/** Variables usable in expressions: letters/digits, starting with a letter, not reserved names. */
const VAR_RE = /^[a-zA-Z]{1,12}$/
const RESERVED = new Set(['x', 'e', 'pi', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'ln', 'log', 'sqrt', 'abs', 'sinh', 'cosh', 'tanh', 'floor', 'ceil', 'min', 'max'])
export function isVarName(v: unknown): v is string {
  return typeof v === 'string' && VAR_RE.test(v) && !RESERVED.has(v.toLowerCase())
}

/** {{expr}} or {{expr:2}} (decimals) inside write text / math tex: replaced by the live value. */
export const TEMPLATE_RE = /\{\{([^{}:]+)(?::(\d))?\}\}/g

/* ───────────── Validation ───────────── */

export interface ValidationResult {
  ok: boolean
  steps: Step[]
  errors: string[]
  /** Number of top-level steps in the input. */
  total: number
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isPt = (v: unknown): v is Pt => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1])
const isRange = (v: unknown): v is [number, number] => isPt(v) && (v as number[])[0] < (v as number[])[1]
const ID_RE = /^[A-Za-z][\w-]{0,39}$/

interface Ctx { ids: Set<string>; axes: Set<string>; vars: Set<string>; depth: number }

/** A number or an expression over the known variables. */
function isNumX(v: unknown, vars: Set<string>): boolean {
  if (isNum(v)) return true
  if (!isStr(v) || !v.trim() || v.length > 120) return false
  const c = compileExpr(v, vars, false)
  return c.ok
}
const isPtX = (v: unknown, vars: Set<string>) => Array.isArray(v) && v.length === 2 && isNumX(v[0], vars) && isNumX(v[1], vars)

/** Check {{expr}} templates in text against the known variables. */
function checkTemplates(text: unknown, errs: string[], at: string, vars: Set<string>) {
  if (!isStr(text)) return
  for (const m of text.matchAll(TEMPLATE_RE)) {
    const c = compileExpr(m[1], vars, false)
    if (!c.ok) errs.push(`${at}: {{${m[1]}}} — ${c.error}`)
  }
}

function optEnum<T extends string>(o: Obj, key: string, allowed: readonly T[], errs: string[], at: string) {
  if (o[key] === undefined) return
  if (!isStr(o[key]) || !allowed.includes(o[key] as T)) errs.push(`${at}.${key} must be one of ${allowed.join('|')}`)
}
function optStr(o: Obj, key: string, errs: string[], at: string, max = 2000) {
  if (o[key] === undefined) return
  if (!isStr(o[key])) errs.push(`${at}.${key} must be a string`)
  else if ((o[key] as string).length > max) errs.push(`${at}.${key} is too long`)
}
function reqStr(o: Obj, key: string, errs: string[], at: string, max = 2000) {
  if (!isStr(o[key]) || !(o[key] as string).trim()) errs.push(`${at}.${key} is required (string)`)
  else if ((o[key] as string).length > max) errs.push(`${at}.${key} is too long`)
}
function reqNum(o: Obj, key: string, errs: string[], at: string, min = -10_000, max = 10_000) {
  if (!isNum(o[key])) errs.push(`${at}.${key} is required (number)`)
  else if ((o[key] as number) < min || (o[key] as number) > max) errs.push(`${at}.${key} out of range ${min}..${max}`)
}
function optNum(o: Obj, key: string, errs: string[], at: string, min = -10_000, max = 10_000) {
  if (o[key] === undefined) return
  reqNum(o, key, errs, at, min, max)
}

function validateShape(s: unknown, errs: string[], at: string, vars: Set<string> = new Set()) {
  if (!isObj(s)) { errs.push(`${at} must be an object`); return }
  switch (s.kind) {
    case 'line':
    case 'arrow':
      if (!isPtX(s.from, vars)) errs.push(`${at}.from must be [x,y] (numbers or expressions in set variables)`)
      if (!isPtX(s.to, vars)) errs.push(`${at}.to must be [x,y] (numbers or expressions in set variables)`)
      break
    case 'circle':
      if (!isPt(s.center)) errs.push(`${at}.center must be [x,y]`)
      reqNum(s, 'r', errs, at, 0, 2000)
      break
    case 'rect':
      reqNum(s, 'x', errs, at); reqNum(s, 'y', errs, at)
      reqNum(s, 'w', errs, at, 0); reqNum(s, 'h', errs, at, 0)
      break
    case 'polyline':
    case 'polygon':
      if (!Array.isArray(s.points) || s.points.length < 2 || s.points.length > 400 || !s.points.every(isPt))
        errs.push(`${at}.points must be 2..400 [x,y] pairs`)
      break
    case 'arc':
    case 'sector':
      if (!isPt(s.center)) errs.push(`${at}.center must be [x,y]`)
      reqNum(s, 'r', errs, at, 0, 2000)
      reqNum(s, 'from', errs, at, -1440, 1440)
      reqNum(s, 'to', errs, at, -1440, 1440)
      break
    case 'point':
      if (!isPtX(s.at, vars)) errs.push(`${at}.at must be [x,y] (numbers or expressions in set variables)`)
      optStr(s, 'label', errs, at, 60)
      optEnum(s, 'labelPos', ['ne', 'nw', 'se', 'sw'] as const, errs, at)
      break
    case 'axes': {
      const f = s.frame
      if (!isObj(f) || !isNum(f.x) || !isNum(f.y) || !isNum(f.w) || !isNum(f.h) || f.w <= 0 || f.h <= 0)
        errs.push(`${at}.frame must be {x,y,w,h} with positive w,h`)
      if (!isRange(s.xRange)) errs.push(`${at}.xRange must be [min,max] with min<max`)
      if (!isRange(s.yRange)) errs.push(`${at}.yRange must be [min,max] with min<max`)
      optStr(s, 'xLabel', errs, at, 40); optStr(s, 'yLabel', errs, at, 40)
      optNum(s, 'xStep', errs, at, 0.0001); optNum(s, 'yStep', errs, at, 0.0001)
      break
    }
    case 'function':
      reqStr(s, 'expr', errs, at, 200)
      if (isStr(s.expr)) {
        const e = compileExpr(s.expr, vars)
        if (!e.ok) errs.push(`${at}.expr: ${e.error}`)
      }
      if (s.domain !== undefined && !isRange(s.domain)) errs.push(`${at}.domain must be [min,max] with min<max`)
      break
    case 'secant':
    case 'tangent': {
      reqStr(s, 'expr', errs, at, 200)
      if (isStr(s.expr)) {
        const e = compileExpr(s.expr, vars)
        if (!e.ok) errs.push(`${at}.expr: ${e.error}`)
      }
      if (s.kind === 'secant') {
        if (!isNumX(s.x1, vars)) errs.push(`${at}.x1 must be a number or an expression in set variables`)
        if (!isNumX(s.x2, vars)) errs.push(`${at}.x2 must be a number or an expression in set variables`)
        optNum(s, 'extend', errs, at, 0, 1000)
      } else {
        if (!isNumX(s.at, vars)) errs.push(`${at}.at must be a number or an expression in set variables`)
        optNum(s, 'len', errs, at, 0.0001, 100000)
      }
      break
    }
    default:
      errs.push(`${at}.kind must be one of line|arrow|circle|rect|polyline|polygon|arc|sector|point|axes|function|secant|tangent`)
  }
}

function validateCue(v: unknown, step: Obj, errs: string[], at: string, key: string) {
  if (v === undefined) return
  if (isNum(v)) {
    const n = cueWordCount(step)
    if (!Number.isInteger(v) || v < 0 || (n > 0 && v >= n)) errs.push(`${at}.${key} must be a word index 0..${Math.max(0, n - 1)} of "say"`)
    return
  }
  if (!isStr(v) || !v.trim() || v.length > 80) { errs.push(`${at}.${key} must be a word index or a short phrase from "say"`); return }
  if (cueWordCount(step) > 0 && findCueWord(step, v) < 0) errs.push(`${at}.${key} "${v}" does not appear in this step's "say"`)
}

function validateStep(raw: unknown, errs: string[], at: string, ctx: Ctx, cueOf?: Obj): raw is Step {
  const before = errs.length
  if (!isObj(raw)) { errs.push(`${at} must be an object`); return false }
  const s = raw
  if (s.id !== undefined && (!isStr(s.id) || !ID_RE.test(s.id))) errs.push(`${at}.id must match ${ID_RE}`)
  if (cueOf) {
    // A cue: an action fired during another step's narration.
    if (!(ACTION_TYPES as readonly string[]).includes(s.type as string)) errs.push(`${at}.type must be one of ${ACTION_TYPES.join('|')} (a cue cannot be a ${String(s.type)})`)
    if (s.say !== undefined) errs.push(`${at}: a cue has no "say" (the step's narration is spoken)`)
    if (s.cues !== undefined) errs.push(`${at}: cues cannot be nested`)
    if (s.at === undefined) errs.push(`${at}.at is required (the word of the step's "say" that fires it)`)
    validateCue(s.at, cueOf, errs, at, 'at')
    validateCue(s.until, cueOf, errs, at, 'until')
  } else {
    optStr(s, 'say', errs, at, 400)
    validateCue(s.at, s, errs, at, 'at')
    validateCue(s.until, s, errs, at, 'until')
  }
  switch (s.type) {
    case 'set':
      if (!isObj(s.vars) || Object.keys(s.vars).length === 0 || Object.keys(s.vars).length > 8) errs.push(`${at}.vars must be an object of 1..8 {name: number}`)
      else for (const [k, v] of Object.entries(s.vars)) {
        if (!isVarName(k)) errs.push(`${at}.vars: "${k}" is not a valid variable name (letters/digits, not x, e or pi)`)
        else if (!isNum(v)) errs.push(`${at}.vars.${k} must be a number`)
      }
      break
    case 'animate':
      if (!isVarName(s.var)) errs.push(`${at}.var must be a variable name (letters/digits, not x, e or pi)`)
      else if (!ctx.vars.has(s.var) && !isNum(s.from)) errs.push(`${at}.var "${s.var}" is not set yet: add "from" or a set step first`)
      reqNum(s, 'to', errs, at, -1e6, 1e6)
      optNum(s, 'from', errs, at, -1e6, 1e6)
      optEnum(s, 'ease', ['smooth', 'linear', 'there_and_back'] as const, errs, at)
      break
    case 'move':
      reqStr(s, 'target', errs, at, 40)
      if (isStr(s.target) && !ctx.ids.has(s.target)) errs.push(`${at}.target "${s.target}" is not an element on the board`)
      if (s.by === undefined && s.to === undefined) errs.push(`${at} needs "by" [dx,dy] or "to" [x,y]`)
      if (s.by !== undefined && !isPt(s.by)) errs.push(`${at}.by must be [dx,dy]`)
      if (s.to !== undefined && !isPt(s.to)) errs.push(`${at}.to must be [x,y]`)
      break
    case 'fade':
      reqStr(s, 'target', errs, at, 40)
      if (isStr(s.target) && !ctx.ids.has(s.target)) errs.push(`${at}.target "${s.target}" is not an element on the board`)
      reqNum(s, 'to', errs, at, 0, 1)
      break
    case 'scale':
      reqStr(s, 'target', errs, at, 40)
      if (isStr(s.target) && !ctx.ids.has(s.target)) errs.push(`${at}.target "${s.target}" is not an element on the board`)
      reqNum(s, 'by', errs, at, 0.2, 4)
      break
    case 'color':
      reqStr(s, 'target', errs, at, 40)
      if (isStr(s.target) && !ctx.ids.has(s.target)) errs.push(`${at}.target "${s.target}" is not an element on the board`)
      if (!isStr(s.color) || !(INKS as readonly string[]).includes(s.color)) errs.push(`${at}.color must be one of ${INKS.join('|')}`)
      if (s.pulse !== undefined && typeof s.pulse !== 'boolean') errs.push(`${at}.pulse must be boolean`)
      break
    case 'camera':
      reqNum(s, 'zoom', errs, at, 1, 4)
      if (s.center !== undefined && !isPt(s.center)) errs.push(`${at}.center must be [x,y]`)
      if (s.on !== undefined && (!isStr(s.on) || !ctx.axes.has(s.on))) errs.push(`${at}.on refers to unknown axes "${String(s.on)}"`)
      break
    case 'write':
      reqStr(s, 'text', errs, at, 300)
      checkTemplates(s.text, errs, `${at}.text`, ctx.vars)
      reqNum(s, 'x', errs, at, 0, BOARD_W); reqNum(s, 'y', errs, at, 0, BOARD_H)
      optEnum(s, 'size', SIZES, errs, at); optEnum(s, 'color', INKS, errs, at)
      optEnum(s, 'font', ['serif', 'sans'] as const, errs, at)
      optEnum(s, 'align', ['left', 'center', 'right'] as const, errs, at)
      optNum(s, 'maxWidth', errs, at, 40, BOARD_W)
      break
    case 'math':
      reqStr(s, 'tex', errs, at, 400)
      checkTemplates(s.tex, errs, `${at}.tex`, ctx.vars)
      reqNum(s, 'x', errs, at, 0, BOARD_W); reqNum(s, 'y', errs, at, 0, BOARD_H)
      optEnum(s, 'size', SIZES, errs, at); optEnum(s, 'color', INKS, errs, at)
      optEnum(s, 'align', ['left', 'center', 'right'] as const, errs, at)
      break
    case 'draw':
      validateShape(s.shape, errs, `${at}.shape`, ctx.vars)
      optEnum(s, 'color', INKS, errs, at)
      optNum(s, 'width', errs, at, 0.5, 12)
      if (s.dashed !== undefined && typeof s.dashed !== 'boolean') errs.push(`${at}.dashed must be boolean`)
      if (s.fill !== undefined && typeof s.fill !== 'boolean') errs.push(`${at}.fill must be boolean`)
      if (s.on !== undefined) {
        if (!isStr(s.on)) errs.push(`${at}.on must be an axes id`)
        else if (!ctx.axes.has(s.on)) errs.push(`${at}.on refers to unknown axes "${s.on}"`)
      }
      if (isObj(s.shape) && (s.shape.kind === 'function' || s.shape.kind === 'secant' || s.shape.kind === 'tangent') && !isStr(s.on)) errs.push(`${at}: a ${s.shape.kind} shape needs "on" (an axes id)`)
      if (isObj(s.shape) && s.shape.kind === 'axes') {
        if (!isStr(s.id)) errs.push(`${at}: axes need an "id" so plots can reference them`)
        else ctx.axes.add(s.id)
      }
      break
    case 'highlight':
      reqStr(s, 'target', errs, at, 40)
      if (isStr(s.target) && !ctx.ids.has(s.target)) errs.push(`${at}.target "${s.target}" is not an earlier element id`)
      optEnum(s, 'style', ['box', 'underline'] as const, errs, at)
      optEnum(s, 'color', INKS, errs, at)
      break
    case 'transform':
      reqStr(s, 'target', errs, at, 40)
      if (isStr(s.target) && !ctx.ids.has(s.target)) errs.push(`${at}.target "${s.target}" is not an earlier element id`)
      if (s.tex === undefined && s.text === undefined && s.x === undefined && s.y === undefined)
        errs.push(`${at} must change something (tex, text, x or y)`)
      optStr(s, 'tex', errs, at, 400); optStr(s, 'text', errs, at, 300)
      checkTemplates(s.tex, errs, `${at}.tex`, ctx.vars); checkTemplates(s.text, errs, `${at}.text`, ctx.vars)
      optNum(s, 'x', errs, at, 0, BOARD_W); optNum(s, 'y', errs, at, 0, BOARD_H)
      optEnum(s, 'color', INKS, errs, at)
      break
    case 'clear':
      if (s.targets !== undefined && (!Array.isArray(s.targets) || !s.targets.every(isStr)))
        errs.push(`${at}.targets must be an array of ids`)
      break
    case 'pause':
      reqNum(s, 'ms', errs, at, 200, 10_000)
      break
    case 'check': {
      optEnum(s, 'kind', ['understand', 'choice', 'short'] as const, errs, at)
      if (s.kind === undefined) errs.push(`${at}.kind is required (understand|choice|short)`)
      reqStr(s, 'prompt', errs, at, 400)
      if (s.kind === 'choice') {
        if (!Array.isArray(s.options) || s.options.length < 2 || s.options.length > 6 || !s.options.every(o => isStr(o) && o.length <= 200))
          errs.push(`${at}.options must be 2..6 strings`)
        else if (!isNum(s.answer) || !Number.isInteger(s.answer) || s.answer < 0 || s.answer >= s.options.length)
          errs.push(`${at}.answer must be the index of the correct option`)
      }
      if (s.kind === 'short' && (!Array.isArray(s.accept) || s.accept.length === 0 || !s.accept.every(isStr)))
        errs.push(`${at}.accept must be a non-empty array of accepted answers`)
      optStr(s, 'explanation', errs, at, 600)
      if (s.reteach !== undefined) {
        if (ctx.depth > 0) errs.push(`${at}.reteach cannot be nested`)
        else if (!Array.isArray(s.reteach) || s.reteach.length > 30) errs.push(`${at}.reteach must be an array of up to 30 steps`)
        else {
          // reteach runs from the board state at this point; validate with a copy of the ids.
          const sub = { ids: new Set(ctx.ids), axes: new Set(ctx.axes), vars: new Set(ctx.vars), depth: 1 }
          s.reteach.forEach((r, i) => validateStep(r, errs, `${at}.reteach[${i}]`, sub))
        }
      }
      break
    }
    case 'manim_clip':
      reqStr(s, 'url', errs, at, 1000)
      if (isStr(s.url) && !/^https:\/\/[^\s]+$/i.test(s.url) && !s.url.startsWith('/')) errs.push(`${at}.url must be an https URL`)
      optStr(s, 'caption', errs, at, 300)
      optStr(s, 'jobId', errs, at, 64)
      break
    default:
      errs.push(`${at}.type must be one of ${STEP_TYPES.join('|')}`)
  }
  let ok = errs.length === before
  if (ok) registerEffects(s, ctx)
  // Cues run during this step's narration, after its own action, in order.
  if (s.cues !== undefined && !cueOf) {
    if (!Array.isArray(s.cues) || s.cues.length > 16) { errs.push(`${at}.cues must be an array of up to 16 actions`); ok = false }
    else {
      const b = errs.length
      s.cues.forEach((c, k) => { validateStep(c, errs, `${at}.cues[${k}]`, ctx, s) })
      if (errs.length > b) ok = false
    }
  }
  return ok
}

/** What a valid step adds to / removes from the board context. */
function registerEffects(s: Obj, ctx: Ctx) {
  if (isStr(s.id) && ['write', 'math', 'draw'].includes(s.type as string)) ctx.ids.add(s.id)
  if (s.type === 'clear') {
    if (Array.isArray(s.targets)) for (const t of s.targets) { ctx.ids.delete(t as string); ctx.axes.delete(t as string) }
    else { ctx.ids.clear(); ctx.axes.clear() }
  }
  if (s.type === 'set' && isObj(s.vars)) for (const k of Object.keys(s.vars)) ctx.vars.add(k)
  if (s.type === 'animate' && isStr(s.var)) ctx.vars.add(s.var)
}

/* ───────────── Narration cues ───────────── */

/** The words of a step's narration that cues index into (its `say`, or the written text). */
export function cueWords(step: { say?: unknown; type?: unknown; text?: unknown }): string[] {
  const src = isStr(step.say) && step.say.trim() ? step.say : step.type === 'write' && isStr(step.text) ? step.text : ''
  return splitSayWords(src)
}

/** Split narration into words, keeping each inline $...$ formula (with attached punctuation) as one word. */
export function splitSayWords(say: string): string[] {
  return say.match(/(?:[^\s$]*\$[^$]*\$)+[^\s$]*|[^\s]+/g) ?? []
}

function cueWordCount(step: Obj) { return cueWords(step).length }

const normWord = (w: string) => w.toLowerCase().replace(/\$/g, '').replace(/[^\p{L}\p{N}^'+\-=/.]/gu, '').replace(/^[.'-]+|[.'-]+$/g, '')

/** Index of the word a cue refers to in `cueWords(step)`, searching from `from` first; -1 if absent. */
export function findCueWord(step: { say?: unknown; type?: unknown; text?: unknown }, cue: Cue, from = 0): number {
  const words = cueWords(step)
  if (typeof cue === 'number') return cue >= 0 && cue < words.length ? Math.floor(cue) : -1
  const want = splitSayWords(cue).map(normWord).filter(Boolean)
  if (!want.length) return -1
  const have = words.map(normWord)
  const scan = (start: number) => {
    for (let i = start; i + want.length <= have.length; i++) {
      if (want.every((w, k) => have[i + k] === w)) return i
    }
    // Looser: a word that starts with the cue word ("tangent" matches "tangent:").
    for (let i = start; i + want.length <= have.length; i++) {
      if (want.every((w, k) => have[i + k]?.startsWith(w))) return i
    }
    return -1
  }
  const hit = scan(Math.max(0, from))
  return hit >= 0 ? hit : from > 0 ? scan(0) : -1
}

const INK_ALIASES: Record<string, Ink> = {
  black: 'ink', dark: 'ink', default: 'ink', green: 'accent', primary: 'accent', red: 'clay', orange: 'clay',
  blue: 'navy', yellow: 'amber', gold: 'amber', gray: 'muted', grey: 'muted',
}
const SIZE_ALIASES: Record<string, TextSize> = { small: 'sm', medium: 'md', large: 'lg', xlarge: 'xl', 'x-large': 'xl', s: 'sm', m: 'md', l: 'lg' }

/**
 * Coerces common near-misses from the model before strict validation: colour and
 * size aliases, unknown colours to ink, numeric strings, `wedge` -> sector, and
 * `shape` fields put directly on a draw step.
 */
export function normalizeScript(input: unknown): unknown {
  const arr = isObj(input) && Array.isArray(input.steps) ? input.steps : input
  if (!Array.isArray(arr)) return input
  const fixStep = (raw: unknown): unknown => {
    if (!isObj(raw)) return raw
    const s: Obj = { ...raw }
    if (isStr(s.color)) {
      const c = s.color.toLowerCase()
      s.color = (INKS as readonly string[]).includes(c) ? c : INK_ALIASES[c] ?? 'ink'
    }
    if (isStr(s.size)) {
      const z = s.size.toLowerCase()
      s.size = (SIZES as readonly string[]).includes(z) ? z : SIZE_ALIASES[z] ?? 'md'
    }
    for (const k of ['x', 'y', 'ms', 'maxWidth', 'width']) {
      if (isStr(s[k]) && s[k] !== '' && Number.isFinite(Number(s[k]))) s[k] = Number(s[k])
    }
    if (s.type === 'draw' && !isObj(s.shape) && isStr(s.kind)) {
      const { type, id, say, color, width, dashed, fill, on, ...shape } = s
      return fixStep({ type, id, say, color, width, dashed, fill, on, shape })
    }
    if (s.type === 'draw' && isObj(s.shape)) {
      const sh: Obj = { ...s.shape }
      if (sh.kind === 'wedge' || sh.kind === 'pie') sh.kind = 'sector'
      if (sh.kind === 'triangle' || sh.kind === 'path') sh.kind = Array.isArray(sh.points) ? (sh.kind === 'triangle' ? 'polygon' : 'polyline') : sh.kind
      if (sh.kind === 'dot') sh.kind = 'point'
      if ((sh.kind === 'arc' || sh.kind === 'sector') && sh.from === undefined && isNum(sh.startAngle)) { sh.from = sh.startAngle; sh.to = sh.endAngle }
      s.shape = sh
    }
    for (const k of ['zoom', 'by', 'to', 'from']) {
      if (isStr(s[k]) && s[k] !== '' && Number.isFinite(Number(s[k]))) s[k] = Number(s[k])
    }
    if (s.type === 'check' && Array.isArray(s.reteach)) s.reteach = s.reteach.map(fixStep)
    if (Array.isArray(s.cues)) s.cues = s.cues.map(fixStep)
    else if (s.cues === null) delete s.cues
    return s
  }
  return arr.map(fixStep)
}

/**
 * Validate a script. `knownIds` lets a continuation (AI next steps) refer to
 * elements already on the board.
 */
export function validateScript(input: unknown, opts: { knownIds?: Iterable<string>; knownAxes?: Iterable<string>; knownVars?: Iterable<string>; maxSteps?: number } = {}): ValidationResult {
  const errors: string[] = []
  const arr = normalizeScript(input)
  if (!Array.isArray(arr)) return { ok: false, steps: [], errors: ['script must be an array of steps (or {"steps": [...]})'], total: 0 }
  const max = opts.maxSteps ?? 200
  if (arr.length === 0) errors.push('script has no steps')
  if (arr.length > max) errors.push(`script has more than ${max} steps`)
  const ctx: Ctx = { ids: new Set(opts.knownIds ?? []), axes: new Set(opts.knownAxes ?? []), vars: new Set(opts.knownVars ?? []), depth: 0 }
  const steps: Step[] = []
  arr.slice(0, max).forEach((raw, i) => {
    if (validateStep(raw, errors, `steps[${i}]`, ctx)) steps.push(raw as Step)
  })
  return { ok: errors.length === 0, steps, errors, total: arr.length }
}

/** The ids, axes and variables that exist on the board after playing `steps` (cues included). */
export function boardIdsAfter(steps: Step[]): { ids: string[]; axes: string[]; vars: string[] } {
  const ids = new Set<string>()
  const axes = new Set<string>()
  const vars = new Set<string>()
  const one = (s: Step | CueAction) => {
    if ((s.type === 'write' || s.type === 'math' || s.type === 'draw') && s.id) {
      ids.add(s.id)
      if (s.type === 'draw' && s.shape.kind === 'axes') axes.add(s.id)
    }
    if (s.type === 'clear') {
      if (s.targets) for (const t of s.targets) { ids.delete(t); axes.delete(t) }
      else { ids.clear(); axes.clear() }
    }
    if (s.type === 'set') Object.keys(s.vars).forEach(k => vars.add(k))
    if (s.type === 'animate') vars.add(s.var)
  }
  for (const s of steps) {
    one(s)
    if ('cues' in s && Array.isArray(s.cues)) s.cues.forEach(c => one(c as CueAction))
  }
  return { ids: [...ids], axes: [...axes], vars: [...vars] }
}

/* ───────────── Safe math expressions (for function plots) ───────────── */

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string }
const FUNCS: Record<string, (a: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  exp: Math.exp, ln: Math.log, log: Math.log10, sqrt: Math.sqrt, abs: Math.abs,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, floor: Math.floor, ceil: Math.ceil,
}
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E }

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j++
      const v = Number(src.slice(i, j))
      if (!Number.isFinite(v)) throw new Error(`bad number "${src.slice(i, j)}"`)
      out.push({ t: 'num', v }); i = j; continue
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++
      out.push({ t: 'id', v: src.slice(i, j).toLowerCase() }); i = j; continue
    }
    if ('+-*/^()'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue }
    throw new Error(`unexpected character "${c}"`)
  }
  return out
}

export type Vars = Record<string, number>
type Node = (x: number, v?: Vars) => number

/**
 * Compile an expression in x (and named board variables) without eval. Supports
 * + - * / ^, parentheses, implicit multiplication (2x), and common functions.
 * `vars`: the variable names allowed (unknown names are an error); `allowX`: x may appear.
 */
export function compileExpr(src: string, vars?: Iterable<string>, allowX = true): { ok: true; fn: Node } | { ok: false; error: string } {
  const allowed = new Set([...(vars ?? [])].map(v => v.toLowerCase()))
  try {
    const toks = tokenize(src)
    let p = 0
    const peek = () => toks[p]
    const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v
    const startsPrimary = () => { const t = peek(); return !!t && (t.t === 'num' || t.t === 'id' || (t.t === 'op' && t.v === '(')) }

    function expr(): Node {
      let left = term()
      while (isOp('+') || isOp('-')) {
        const op = toks[p++].v
        const l = left, r = term()
        left = op === '+' ? (x, v) => l(x, v) + r(x, v) : (x, v) => l(x, v) - r(x, v)
      }
      return left
    }
    function term(): Node {
      let left = unary()
      for (;;) {
        if (isOp('*') || isOp('/')) {
          const op = toks[p++].v
          const l = left, r = unary()
          left = op === '*' ? (x, v) => l(x, v) * r(x, v) : (x, v) => l(x, v) / r(x, v)
        } else if (startsPrimary()) {
          const l = left, r = power()
          left = (x, v) => l(x, v) * r(x, v)
        } else break
      }
      return left
    }
    function unary(): Node {
      if (isOp('-')) { p++; const u = unary(); return (x, v) => -u(x, v) }
      if (isOp('+')) { p++; return unary() }
      return power()
    }
    function power(): Node {
      const base = primary()
      if (isOp('^')) { p++; const e = unary(); return (x, v) => Math.pow(base(x, v), e(x, v)) }
      return base
    }
    function primary(): Node {
      const t = toks[p++]
      if (!t) throw new Error('unexpected end of expression')
      if (t.t === 'num') return () => t.v
      if (t.t === 'op' && t.v === '(') {
        const e = expr()
        if (!isOp(')')) throw new Error('missing ")"')
        p++
        return e
      }
      if (t.t === 'id') {
        if (t.v === 'x') { if (!allowX) throw new Error('x is only allowed in function expressions'); return x => x }
        if (t.v in CONSTS) { const c = CONSTS[t.v]; return () => c }
        if (t.v in FUNCS) {
          const f = FUNCS[t.v]
          if (!isOp('(')) throw new Error(`${t.v} needs parentheses`)
          const arg = primary()
          return (x, v) => f(arg(x, v))
        }
        if (allowed.has(t.v)) {
          const name = t.v
          return (_x, v) => {
            if (!v) return NaN
            if (name in v) return v[name]
            const k = Object.keys(v).find(key => key.toLowerCase() === name)
            return k ? v[k] : NaN
          }
        }
        throw new Error(`unknown name "${t.v}"${/^[a-z]+$/.test(t.v) ? ' (set it as a variable first)' : ''}`)
      }
      throw new Error(`unexpected "${t.v}"`)
    }
    const fn = expr()
    if (p !== toks.length) throw new Error(`unexpected "${(toks[p] as Tok).v}"`)
    return { ok: true, fn }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/* ───────────── Prompt helper ───────────── */

/** Compact description of the schema for Gemini prompts. */
export const SCRIPT_SCHEMA_PROMPT = `Board: ${BOARD_W} wide x ${BOARD_H} tall units, origin top-left, y grows downward. Keep everything inside x 24..${BOARD_W - 24}, y 24..${BOARD_H - 24}. Text y is the TOP of the text line.
Return a JSON object {"steps": Step[]}. Each Step is one of:
- {"type":"write","id"?,"text","x","y","size"?:"sm|md|lg|xl","color"?,"font"?:"serif|sans","align"?:"left|center|right","maxWidth"?,"say"?}
- {"type":"math","id"?,"tex" (KaTeX LaTeX, no $ delimiters),"x","y","size"?,"color"?,"align"?,"say"?}
- {"type":"draw","id"?,"shape",...,"color"?,"width"? (0.5..12, default 2.5),"dashed"?,"fill"? (light tint inside circle/rect/polygon/sector),"on"? (axes id: shape coordinates are then GRAPH units),"say"?}
  shape is one of {"kind":"line","from":[x,y],"to":[x,y]} | {"kind":"arrow","from","to"} | {"kind":"circle","center":[x,y],"r"} | {"kind":"rect","x","y","w","h"} | {"kind":"polyline","points":[[x,y],...]} | {"kind":"polygon","points":[[x,y],...]} (closed) | {"kind":"arc"|"sector","center":[x,y],"r","from","to"} (degrees, counter-clockwise from +x; sector = pie wedge) | {"kind":"point","at":[x,y],"label"?,"labelPos"?:"ne|nw|se|sw"} | {"kind":"axes","frame":{"x","y","w","h"},"xRange":[min,max],"yRange":[min,max],"xLabel"?,"yLabel"?,"xStep"?,"yStep"?} (axes MUST have an id) | {"kind":"function","expr":"x^2 - 1","domain"?:[a,b]} (function MUST set "on" to an axes id; expr uses x, + - * / ^, sin cos tan exp ln log sqrt abs pi e).
- {"type":"highlight","target": id of an element on the board,"style"?:"box|underline","color"?,"say"?}
- {"type":"transform","target": id of a write/math element,"tex"? or "text"? (new content),"x"?,"y"? (new position),"color"?,"say"?}  — morphs the element, e.g. one equation into the next.
- {"type":"clear","targets"?: [ids]} — omit targets to wipe the board.
- {"type":"pause","ms": 200..10000}
- {"type":"check","kind":"understand"|"choice"|"short","prompt","options"? (choice: 2..6),"answer"? (choice: index),"accept"? (short: accepted answers),"explanation"?}
- {"type":"manim_clip","url","caption"?} — only reuse URLs you were given; never invent one.
Motion (like Manim's ValueTracker and animate):
- {"type":"set","vars":{"h":1}} — named numeric variables (letters only, not x, e or pi). Coordinates of line/arrow/point, secant x1/x2, tangent "at", and function "expr" may use them as expressions ("1 + h", "(1+h)^2"); write/math text may show a live value with {{expr}} or {{expr:2}} (2 decimals).
- {"type":"animate","var":"h","to":0.05,"from"?,"ease"?:"smooth|linear|there_and_back"} — glides a variable; everything that depends on it moves continuously (a point sliding along a curve, a secant turning into a tangent, a live number counting).
- {"type":"move","target","by":[dx,dy] | "to":[x,y]} | {"type":"fade","target","to":0..1} | {"type":"scale","target","by"} | {"type":"color","target","color","pulse"?} | {"type":"camera","zoom":1..4,"center"?:[x,y],"on"?: axes id} (zoom 1 resets).
- Extra shapes (need "on"): {"kind":"secant","expr","x1","x2","extend"?} (line through the curve at x1 and x2) | {"kind":"tangent","expr","at","len"?}.
Timing to the voice (every step may use these):
- "at": the word (or short phrase, or 0-based word index) of the step's "say" at which its action starts; "until": the word where it should be finished. Without them the action starts with the narration and stretches to fill the sentence.
- "cues": [{...action, "at": "word"}] — further actions (any of write, math, draw, highlight, transform, clear, set, animate, move, fade, scale, color, camera; no "say") fired as their word is spoken, in spoken order. Use cues so the board moves while the sentence is spoken: name a thing, and it appears or moves on that word.
- Each action runs from its cue word until the next cue, so motion is continuous through the sentence. Prefer one step with a sentence and 2-4 cues over several silent steps; prefer animate over clearing and redrawing something in a new position.
Colors: ink (default), accent (deep green, for the key idea), clay (warm red, for contrast/mistakes), navy, amber, muted.
Sizes: sm 22, md 30, lg 40, xl 54 units tall. Roughly 0.5 x size units per character of width.
Ids: letters, digits, - or _, start with a letter, unique on the board.
"say" is the tutor's narration: it is spoken aloud and written into the transcript. Write it as natural speech, one or two sentences, saying what the student should notice; do not just read the board out. Inline math in "say" goes in $...$ (e.g. "the slope is $f'(1) = 2$"); it is read out in words. A write or math step without "say" is read out as written.
Phones: the diagram (drawings plus text that touches them) is zoomed to the screen width and all other text reflows below it in reading order (top-to-bottom, then left-to-right). So text on a drawing must be a short label (under 24 characters), and notes should each make sense on their own line.
Maths in any text field (say, write text, check prompt/options/explanation) goes inside $...$ as valid KaTeX, e.g. "$B = \\mu_0 n I$", "$1.26 \\times 10^{-2}$ T"; never write LaTeX commands (\\times, \\frac, ^{...}) outside $...$. A math step's tex is valid KaTeX without $.`

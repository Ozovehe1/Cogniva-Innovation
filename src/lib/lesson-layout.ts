/**
 * Layout checks for AI-written scene scripts. Gemini places elements by
 * coordinates and often stacks text on top of earlier text or drawings. These
 * helpers estimate element boxes, report overlaps (fed back to the model as a
 * repair hint) and, as a last resort, insert `clear` steps so nothing is drawn
 * over something still on the board.
 */
import { BOARD_H, BOARD_W, type Step } from './lesson-schema'
import { SIZE_PX, applyStep, emptyBoard, shapeBox, type BoardEl, type BoardState, type Box, type TextEl } from '@/components/whiteboard/board-state'

// Average glyph width as a fraction of font size, measured on the board (Newsreader / Inter).
const CHAR_W = { serif: 0.44, sans: 0.5 }

function visibleTexLength(tex: string) {
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

export function elementBox(el: BoardEl): Box | null {
  if (el.kind === 'text' || el.kind === 'math') return estimateTextBox(el)
  if (el.kind === 'shape') return shapeBox(el)
  return null
}

function interArea(a: Box, b: Box) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** Shapes that text may legitimately sit inside (labels on a graph) or next to. */
function isBackdrop(el: BoardEl) {
  if (el.kind !== 'shape') return false
  const k = el.step.shape.kind
  return k === 'axes' || k === 'function' || k === 'line' || k === 'arrow' || k === 'point' || k === 'polyline'
}

function describe(el: BoardEl) {
  if (el.kind === 'text') return `write "${el.content.slice(0, 30)}"${el.id ? ` (id ${el.id})` : ''}`
  if (el.kind === 'math') return `math "${el.content.slice(0, 30)}"${el.id ? ` (id ${el.id})` : ''}`
  if (el.kind === 'shape') return `${el.step.shape.kind}${el.id ? ` (id ${el.id})` : ''}`
  return 'highlight'
}

interface Collision { index: number; el: BoardEl; others: BoardEl[]; outOfBounds: boolean }

/** Simulate the board and find steps whose new element collides with something still on it. */
function collisions(steps: Step[], start: BoardState = emptyBoard(), offset = 0): Collision[] {
  let board = start
  const out: Collision[] = []
  steps.forEach((step, i) => {
    const index = offset + i
    board = applyStep(board, step, index)
    if (step.type !== 'write' && step.type !== 'math' && step.type !== 'transform' && step.type !== 'draw') return
    const el =
      step.type === 'transform'
        ? board.els.find(e => e.id === step.target && (e.kind === 'text' || e.kind === 'math'))
        : board.els.find(e => e.born === index && e.kind !== 'highlight')
    if (!el) return
    const box = elementBox(el)
    if (!box) return
    const isText = el.kind === 'text' || el.kind === 'math'
    const others = board.els.filter(o => {
      if (o === el || o.kind === 'highlight') return false
      const ob = elementBox(o)
      if (!ob) return false
      const oText = o.kind === 'text' || o.kind === 'math'
      if (!isText && !oText) return false // shape on shape is usually intentional
      if (isText && !oText && isBackdrop(o)) return false
      if (!isText && oText && isBackdrop(el)) return false
      // A short label inside a large circle/rect is intentional.
      if (isText && !oText && box.w * box.h < 0.12 * ob.w * ob.h && box.x >= ob.x && box.x + box.w <= ob.x + ob.w) return false
      if (!isText && oText && ob.w * ob.h < 0.12 * box.w * box.h && ob.x >= box.x && ob.x + ob.w <= box.x + box.w) return false
      const a = interArea(box, ob)
      return a > 0.2 * Math.min(box.w * box.h, ob.w * ob.h)
    })
    const outOfBounds = isText && (box.x < 4 || box.y < 4 || box.x + box.w > BOARD_W - 4 || box.y + box.h > BOARD_H - 4)
    if (others.length || outOfBounds) out.push({ index, el, others, outOfBounds })
  })
  return out
}

/** Human-readable layout problems for a repair prompt. */
export function layoutIssues(steps: Step[], start?: BoardState, offset = 0): string[] {
  return collisions(steps, start, offset).slice(0, 15).map(c => {
    const parts: string[] = []
    if (c.others.length) parts.push(`overlaps ${c.others.map(describe).join(', ')} which is still on the board`)
    if (c.outOfBounds) parts.push(`runs off the ${BOARD_W}x${BOARD_H} board`)
    return `steps[${c.index - offset}] ${describe(c.el)} ${parts.join(' and ')}. Move it to free space, shorten it, or clear the old element first.`
  })
}

/**
 * Last-resort fix: give anonymous elements ids, then before any step whose new
 * element overlaps older elements, clear those older elements.
 */
export function autoFixLayout(steps: Step[], start: BoardState = emptyBoard(), offset = 0): Step[] {
  // Assign ids so anything can be cleared.
  const used = new Set<string>(start.els.map(e => e.id).filter((x): x is string => !!x))
  steps.forEach(s => { if ('id' in s && s.id) used.add(s.id) })
  let n = 0
  const withIds: Step[] = steps.map(s => {
    if ((s.type === 'write' || s.type === 'math' || s.type === 'draw') && !s.id && !(s.type === 'draw' && s.shape.kind === 'axes')) {
      let id: string
      do { id = `el${++n}` } while (used.has(id))
      used.add(id)
      return { ...s, id }
    }
    return s
  })

  // Ids that later steps still need (highlight/transform targets, axes for plots).
  const neededAfter = (i: number) => {
    const need = new Set<string>()
    for (const s of withIds.slice(i + 1)) {
      if (s.type === 'highlight' || s.type === 'transform') need.add(s.target)
      if (s.type === 'draw' && s.on) need.add(s.on)
      if (s.type === 'clear' && s.targets) s.targets.forEach(t => need.add(t))
    }
    return need
  }

  const fixed: Step[] = []
  let board = start
  for (const [i, step] of withIds.entries()) {
    const index = offset + fixed.length
    const trial = applyStep(board, step, index)
    const c = collisions([step], board, index)[0]
    if (c && c.others.length && step.type !== 'transform') {
      const need = neededAfter(i)
      const targets = c.others.map(o => o.id).filter((x): x is string => !!x && !need.has(x))
      if (targets.length) {
        const clear: Step = { type: 'clear', targets }
        board = applyStep(board, clear, index)
        fixed.push(clear)
        board = applyStep(board, step, index + 1)
        fixed.push(step)
        continue
      }
    }
    board = trial
    fixed.push(step)
  }
  return fixed
}

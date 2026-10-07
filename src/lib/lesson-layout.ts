/**
 * Layout checks for AI-written scene scripts. Gemini places elements by
 * coordinates and often stacks text on top of earlier text or drawings. These
 * helpers estimate element boxes, report overlaps (fed back to the model as a
 * repair hint) and, as a last resort, insert `clear` steps so nothing is drawn
 * over something still on the board.
 */
import { BOARD_H, BOARD_W, type Step } from './lesson-schema'
import { LABEL_MAX_CHARS, applyStep, visibleTexLength, emptyBoard, estimateTextBox, shapeBox, type BoardEl, type BoardState, type Box } from '@/components/whiteboard/board-state'

export { estimateTextBox }

export function elementBox(el: BoardEl, vars?: BoardState['vars']): Box | null {
  if (el.kind === 'text' || el.kind === 'math') {
    const b = estimateTextBox(el)
    return el.fx ? { ...b, x: b.x + el.fx.dx, y: b.y + el.fx.dy } : b
  }
  if (el.kind === 'shape') return shapeBox(el, vars)
  return null
}

/** Step types (or cues) that put something new on the board or move it. */
const PLACING = new Set(['write', 'math', 'transform', 'draw', 'move'])
const placing = (step: Step) => PLACING.has(step.type) || (Array.isArray((step as { cues?: { type: string }[] }).cues) && (step as { cues: { type: string }[] }).cues.some(c => PLACING.has(c.type)))

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
    if (!placing(step)) return
    // Everything this step (and its cues) placed, transformed or moved.
    const targets = new Set<string>()
    if (step.type === 'transform' || step.type === 'move') targets.add(step.target)
    for (const c of (step as { cues?: { type: string; target?: string }[] }).cues ?? []) if ((c.type === 'transform' || c.type === 'move') && c.target) targets.add(c.target)
    const placed = board.els.filter(e => e.kind !== 'highlight' && ((e.born === index && e.fx === undefined) || (e.id && targets.has(e.id))))
    for (const el of placed) {
    const box = elementBox(el, board.vars)
    if (!box) continue
    const isText = el.kind === 'text' || el.kind === 'math'
    const others = board.els.filter(o => {
      if (o === el || o.kind === 'highlight') return false
      const ob = elementBox(o, board.vars)
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
    }
  })
  return out
}

/**
 * Phone-layout problems: on narrow screens text touching a drawing is zoomed
 * with the diagram as a label, everything else reflows below it (see
 * compactPartition). Long text sitting on a drawing would be pulled out of the
 * diagram on phones, so flag it.
 */
function compactIssues(steps: Step[], start: BoardState = emptyBoard(), offset = 0): string[] {
  let board = start
  const out: string[] = []
  steps.forEach((step, i) => {
    const index = offset + i
    board = applyStep(board, step, index)
    for (const el of board.els) {
    if (el.born !== index || (el.kind !== 'text' && el.kind !== 'math')) continue
    const len = el.kind === 'math' ? visibleTexLength(el.content) : el.content.length
    if (len <= LABEL_MAX_CHARS) continue
    const box = estimateTextBox(el)
    const onShape = board.els.some(o => {
      if (o.kind !== 'shape') return false
      const k = o.step.shape.kind
      if (k !== 'axes' && k !== 'function') return false
      const b = shapeBox(o, board.vars)
      return !!b && box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y
    })
    if (onShape) out.push(`steps[${i}] ${describe(el)} is long text inside a graph. Labels on a drawing must be under ${LABEL_MAX_CHARS} characters; move longer text to the notes column.`)
    }
  })
  return out
}

/** Human-readable layout problems for a repair prompt. */
export function layoutIssues(steps: Step[], start?: BoardState, offset = 0): string[] {
  return [...collisionIssues(steps, start, offset), ...compactIssues(steps, start, offset)].slice(0, 15)
}

function collisionIssues(steps: Step[], start?: BoardState, offset = 0): string[] {
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

  // Ids that later steps (or their cues) still need: targets, axes for plots.
  const neededAfter = (i: number) => {
    const need = new Set<string>()
    const add = (s: { type: string; target?: string; on?: string; targets?: string[] }) => {
      if (s.target) need.add(s.target)
      if (s.on) need.add(s.on)
      if (s.type === 'clear' && s.targets) s.targets.forEach(t => need.add(t))
    }
    withIds.forEach((s, k) => {
      if (k > i) add(s as never)
      // Cues of this very step run after its own action.
      if (k >= i) for (const c of (s as { cues?: never[] }).cues ?? []) add(c)
    })
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

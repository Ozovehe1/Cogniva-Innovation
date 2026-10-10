/**
 * Move-first teaching: before any tool, the tutor names the teaching MOVE it is making and why, in one line.
 * The move is the decision; tools are how it is carried out. Code never picks the move. It only logs it, enforces
 * budgets/safety/correctness, and gives the model two cheap ways to declare it:
 *   - the `teaching_move` tool (call it together with the move's tools in the same response), or
 *   - a first text line `MOVE: <move> — <reason>` (filtered out of what the learner sees).
 * Intent verbs layered on what exists: `point_at` (annotate an element already on the board, a thin wrapper over
 * board_edit). Changing a live figure is re-calling `interactive` with the changed spec.
 */
import type { ToolDef } from './llm'

export const MOVES = ['explain', 'point_at', 'modify_existing', 'show_new_visual', 'worked_example', 'ask_learner', 'wait'] as const
export type Move = typeof MOVES[number]

export interface MoveDecision { move: Move; reason: string; target?: string; via: 'tool' | 'text' | 'inferred' }

const ALIASES: Record<string, Move> = {
  explain: 'explain', words: 'explain', recap: 'explain', hint: 'ask_learner', probe: 'ask_learner', ask: 'ask_learner', ask_learner: 'ask_learner', check: 'ask_learner',
  point: 'point_at', point_at: 'point_at', annotate: 'point_at', highlight: 'point_at',
  change: 'modify_existing', modify: 'modify_existing', modify_existing: 'modify_existing', edit: 'modify_existing',
  show: 'show_new_visual', show_new_visual: 'show_new_visual', new_visual: 'show_new_visual', visual: 'show_new_visual',
  worked_example: 'worked_example', example: 'worked_example', wait: 'wait',
}

export function normMove(v: unknown): Move | null {
  const k = String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return ALIASES[k] ?? null
}

export const TEACHING_MOVE_TOOL: ToolDef = {
  name: 'teaching_move',
  description: 'Declare the teaching move you are making this turn and why (one line, about what the learner needs now, read from the TUTOR STATE). Call it FIRST, in the same response as the tools that carry the move out (or alone when the move needs no tool: explain, ask_learner, wait). It changes nothing on screen.',
  parameters: {
    type: 'object',
    properties: {
      move: { type: 'string', enum: [...MOVES] },
      reason: { type: 'string', description: 'one short line: what the learner needs now and why this move gives it' },
      target: { type: 'string', description: 'for point_at / modify_existing: the id of the board element or visual you will act on' },
    },
    required: ['move', 'reason'],
    additionalProperties: false,
  },
}

export const POINT_AT_TOOL: ToolDef = {
  name: 'point_at',
  description: 'Point at something ALREADY on the board (by its id from BOARD IN VIEW): circle, underline, arrow, tick, cross or highlight it, with an optional short note written beside it and a spoken line. Use it instead of drawing a new scene when the thing the learner needs to look at is already there.',
  parameters: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'element id from BOARD IN VIEW, e.g. "m2"' },
      how: { type: 'string', enum: ['circle', 'underline', 'arrow', 'tick', 'cross', 'bracket', 'highlight', 'glow'] },
      note: { type: 'string', description: 'a few words written beside it (optional)' },
      say: { type: 'string', description: 'one short spoken line as it happens' },
      also: { type: 'array', items: { type: 'string' }, maxItems: 3, description: 'up to 3 more ids to mark the same way (optional)' },
    },
    required: ['target', 'how'],
    additionalProperties: false,
  },
}

/** point_at → board_edit ops. */
export function pointAtOps(a: Record<string, unknown>): Record<string, unknown>[] {
  const how = String(a.how ?? 'circle')
  const ids = [String(a.target ?? ''), ...(Array.isArray(a.also) ? a.also.map(String) : [])].filter(Boolean).slice(0, 4)
  const say = typeof a.say === 'string' ? a.say.slice(0, 200) : undefined
  const note = typeof a.note === 'string' ? a.note.slice(0, 60) : undefined
  return ids.map((id, i) => (how === 'highlight' || how === 'glow'
    ? { op: 'highlight', id, style: how === 'glow' ? 'glow' : 'box', color: 'amber', ...(i === 0 && say ? { say } : {}) }
    : { op: 'annotate', id, mark: how, color: 'clay', ...(i === 0 && note ? { note } : {}), ...(i === 0 && say ? { say } : {}) }))
}

/** "MOVE: point_at — the sign error is in m2" (also "MOVE point_at: …", "[move: …]"). */
const MOVE_LINE = /^\s*\[?\s*move\s*[:=]?\s*([a-z_ -]+?)\s*(?:[—–:-]+|\(|\bbecause\b)\s*(.*?)\]?\s*$/i

export function parseMoveLine(line: string): MoveDecision | null {
  const m = MOVE_LINE.exec(line)
  if (!m) return null
  const move = normMove(m[1].split(/\s+/)[0]) ?? normMove(m[1])
  if (!move) return null
  const reason = m[2].replace(/^\)?\s*/, '').trim()
  const target = /\b(?:target|on|at)\s*[:=]?\s*([a-z]{1,3}\d{1,3})\b/i.exec(reason)?.[1]
  return { move, reason: reason.slice(0, 200), target, via: 'text' }
}

/**
 * Wrap a text stream so a leading MOVE line (at the start of any model step) never reaches the learner. Text is held
 * only until the first newline (or 160 chars) of each step, so streaming stays live.
 */
export function moveLineFilter(out: (d: string) => void, onMove: (m: MoveDecision) => void) {
  let buf = ''
  let open = true
  const flush = () => { if (buf) out(buf); buf = ''; open = false }
  return {
    push(d: string) {
      if (!open) { out(d); return }
      buf += d
      const nl = buf.indexOf('\n')
      if (nl < 0 && buf.length < 160) {
        // Not a move line after all: release as soon as that is clear.
        if (buf.trim().length >= 6 && !/^\s*\[?\s*m(o(v(e)?)?)?/i.test(buf)) flush()
        return
      }
      const line = nl >= 0 ? buf.slice(0, nl) : buf
      const m = parseMoveLine(line)
      if (m) { onMove(m); buf = nl >= 0 ? buf.slice(nl + 1).replace(/^\s+/, '') : ''; open = false; if (buf) { out(buf); buf = '' } }
      else flush()
    },
    /** A new model step: its first line may be a move line again. */
    step() { if (buf) flush(); open = true },
    end() { if (buf) { const m = parseMoveLine(buf); if (m) { onMove(m); buf = '' } else flush() } },
  }
}

/** When the model declared nothing, the move its tools amount to (for logs and evals; never a gate). */
export function inferMove(tools: string[], text = ''): Move {
  const t = new Set(tools)
  if (t.has('point_at')) return 'point_at'
  if ([...t].some(n => /example/.test(n))) return 'worked_example'
  if (t.has('board_edit')) return 'modify_existing'
  if (['find_illustration', 'illustrate', 'interactive', 'simulate', 'animate_concept', 'plot', 'math_diagram', 'draw_on_board', 'run_python'].some(n => t.has(n)) || [...t].some(n => /scene/.test(n) && n !== 'board_inspect')) return 'show_new_visual'
  if (/\?\s*$/.test(text.trim())) return 'ask_learner'
  return 'explain'
}

export function moveLine(d: MoveDecision): string {
  return `move: ${d.move}${d.target ? ` @${d.target}` : ''} (${d.via}) — ${d.reason.slice(0, 160)}`
}

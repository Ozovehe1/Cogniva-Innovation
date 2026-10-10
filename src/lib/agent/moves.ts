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

/* ───────────── Phase 2 start: say/do lines streamed inline ───────────── */

/**
 * While the tutor talks it may act on the board inline, one action per line, without a tool round trip:
 *   DO: {"point":"m2","how":"circle","note":"sign!"}
 *   DO: {"write":"÷2 keeps the minus","near":"m2"}   DO: {"math":"x = -5","at":"E3"}
 *   DO: {"rewrite":"m3","tex":"x = -5"}             DO: {"erase":["k1"]}
 * Each line is compiled to board_edit ops the moment it arrives (anchors are grid cells or element ids, never raw
 * coordinates) and drawn while the words keep streaming. Lines never reach the learner.
 */
export const DO_LINE = /^\s*DO\s*:\s*(\{.*\})\s*$/i

export interface AnchorScene { width: number; height: number; elements: { id: string; bbox: [number, number, number, number] }[] }

function cellXY(cell: string, w: number, h: number): [number, number] | null {
  const m = /^([A-F])([1-6])$/i.exec(cell.trim())
  if (!m) return null
  const c = 'ABCDEF'.indexOf(m[1].toUpperCase())
  const r = Number(m[2]) - 1
  return [Math.round((c / 6) * w + 8), Math.round((r / 6) * h + 12)]
}

/** Compile one DO line to board_edit ops (null: not a DO line or nothing usable). */
export function compileDo(line: string, scene: AnchorScene): { ops: Record<string, unknown>[]; label: string } | null {
  const m = DO_LINE.exec(line)
  if (!m) return null
  let a: Record<string, unknown>
  try { a = JSON.parse(m[1]) as Record<string, unknown> } catch { return null }
  const ids = new Set(scene.elements.map(e => e.id))
  const say = typeof a.say === 'string' ? a.say.slice(0, 200) : undefined
  if (typeof a.point === 'string' || typeof a.target === 'string') {
    const target = String(a.point ?? a.target)
    if (!ids.has(target)) return null
    return { ops: pointAtOps({ target, how: a.how ?? 'circle', note: a.note, say, also: Array.isArray(a.also) ? a.also.filter(x => ids.has(String(x))) : undefined }), label: `point ${target}` }
  }
  if (typeof a.rewrite === 'string' && ids.has(a.rewrite) && (typeof a.tex === 'string' || typeof a.text === 'string')) {
    return { ops: [{ op: 'transform', id: a.rewrite, ...(typeof a.tex === 'string' ? { tex: a.tex.slice(0, 300) } : { text: String(a.text).slice(0, 200) }), ...(say ? { say } : {}) }], label: `rewrite ${a.rewrite}` }
  }
  if (Array.isArray(a.erase)) {
    const e = a.erase.map(String).filter(x => ids.has(x))
    return e.length ? { ops: [{ op: 'erase', ids: e }], label: `erase ${e.join(',')}` } : null
  }
  const body = typeof a.write === 'string' ? { text: a.write.slice(0, 120) } : typeof a.math === 'string' ? { tex: a.math.slice(0, 200) } : null
  if (!body) return null
  let xy: [number, number] | null = null
  if (typeof a.near === 'string') {
    const el = scene.elements.find(x => x.id === a.near)
    if (el) {
      const [x, y, w, h] = el.bbox
      // To the right of it when there is room, else just below.
      xy = x + w + 24 + 160 < scene.width ? [x + w + 24, y + Math.max(0, h / 2 - 14)] : [x, Math.min(scene.height - 40, y + h + 14)]
    }
  }
  if (!xy && typeof a.at === 'string') xy = cellXY(a.at, scene.width, scene.height)
  if (!xy) return null
  return { ops: [{ op: 'add', ...body, x: Math.round(xy[0]), y: Math.round(xy[1]), color: typeof a.color === 'string' ? a.color : 'clay', size: 'sm', ...(say ? { say } : {}) }], label: `${body.text ? 'write' : 'math'} ${typeof a.near === 'string' ? `near ${a.near}` : `at ${a.at}`}` }
}

/** Remove DO lines from a finished text. */
export function stripDoLines(t: string): string {
  return t.split('\n').filter(l => !DO_LINE.test(l)).join('\n').replace(/\n{3,}/g, '\n\n')
}

/**
 * The learner-facing stream: MOVE line at the start of a step and DO lines anywhere are taken out and handed over;
 * everything else streams as it arrives. Text is held only while a line could still turn out to be one of them.
 */
export function sayDoStream(out: (d: string) => void, onMove: (m: MoveDecision) => void, onDo: (line: string) => void) {
  let buf = ''
  let atLineStart = true
  let firstLine = true
  const looksLikeAction = (s: string) => {
    const u = s.trimStart().toUpperCase()
    if (!u) return true
    if ('DO:'.startsWith(u) || /^DO\s*:/.test(u)) return true
    return firstLine && (/^\[?\s*MOVE/.test(u) || 'MOVE'.startsWith(u) || '[MOVE'.startsWith(u))
  }
  const handleLine = (line: string, nl: boolean) => {
    if (DO_LINE.test(line)) { onDo(line); return }
    if (firstLine) { const m = parseMoveLine(line); if (m) { onMove(m); return } }
    out(line + (nl ? '\n' : ''))
  }
  return {
    push(d: string) {
      let s = d
      while (s.length) {
        if (!atLineStart) {
          const nl = s.indexOf('\n')
          if (nl < 0) { out(s); return }
          out(s.slice(0, nl + 1)); s = s.slice(nl + 1); atLineStart = true; firstLine = false
          continue
        }
        buf += s; s = ''
        const nl = buf.indexOf('\n')
        if (nl >= 0) {
          const line = buf.slice(0, nl); const rest = buf.slice(nl + 1)
          buf = ''
          handleLine(line, true)
          firstLine = firstLine && !line.trim() ? firstLine : false
          s = rest
          continue
        }
        if (!looksLikeAction(buf) || buf.length > 600) { out(buf); buf = ''; atLineStart = false; firstLine = false }
      }
    },
    /** A new model step: its first line may be a MOVE line again. */
    step() { if (buf) { handleLine(buf, false); buf = '' } atLineStart = true; firstLine = true },
    end() { if (buf) { handleLine(buf, false); buf = '' } },
  }
}

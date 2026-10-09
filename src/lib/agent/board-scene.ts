/**
 * The chat's persistent board: one scene per chat session that the agent owns, inspects and revises.
 *   - The board is stored as the step list that draws it (lesson Step schema), plus named groups, in
 *     chat_sessions.board. Every element has a stable id (ids are filled in for anything drawn without one).
 *   - The scene graph is derived from those steps by the board's own engine (buildBoard), so what the agent
 *     reads is exactly what the learner sees: id, type, label, bounding box, layer (diagram / note / mark).
 *   - Edits are incremental steps appended to the board and animated in the chat (the old part is shown at once).
 * Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { BOARD_H, BOARD_W, boardIdsAfter, validateScript, type CueAction, type Ink, type Pt, type Shape, type Step } from '../lesson-schema'
import { buildBoard, compactPartition, estimateTextBox, shapeBox, type BoardEl, type BoardState, type Box } from '@/components/whiteboard/board-state'
import { markGeometry } from '@/components/whiteboard/marks'
import { texToPlain } from '../math-text'

export interface BoardDoc {
  steps: Step[]
  groups: Record<string, string[]>
  rev: number
}
export interface SceneElement {
  id: string
  type: 'text' | 'math' | 'axes' | 'function' | 'point' | 'line' | 'arrow' | 'shape' | 'figure' | 'mark' | 'highlight'
  label: string
  bbox: [number, number, number, number]
  layer: 'diagram' | 'note' | 'mark'
  /** 1-based step that drew it ("step 2"). */
  step: number
  color?: Ink
  on?: string
  groups?: string[]
}
export interface Scene { width: number; height: number; elements: SceneElement[]; groups: Record<string, string[]> }

export const MAX_BOARD_STEPS = 90
export const emptyDoc = (): BoardDoc => ({ steps: [], groups: {}, rev: 0 })

/* ───────────── Persistence ───────────── */

export async function loadBoard(admin: SupabaseClient, sessionId: string | null | undefined, studentId: string): Promise<BoardDoc> {
  if (!sessionId) return emptyDoc()
  const { data, error } = await admin.from('chat_sessions').select('board').eq('id', sessionId).eq('student_id', studentId).maybeSingle()
  if (error || !data?.board) return emptyDoc()
  const b = data.board as Partial<BoardDoc>
  return { steps: Array.isArray(b.steps) ? b.steps as Step[] : [], groups: b.groups && typeof b.groups === 'object' ? b.groups : {}, rev: Number(b.rev) || 0 }
}

export async function saveBoard(admin: SupabaseClient, sessionId: string | null | undefined, studentId: string, doc: BoardDoc) {
  if (!sessionId) return
  await admin.from('chat_sessions').update({ board: doc }).eq('id', sessionId).eq('student_id', studentId)
}

/* ───────────── Stable ids ───────────── */

const PREFIX: Record<string, string> = { write: 't', math: 'm', draw: 's', annotate: 'k' }

/** Give every element-creating step (and cue) an id, unique against what is already on the board. */
export function ensureIds(steps: Step[], taken: Iterable<string> = []): Step[] {
  const used = new Set(taken)
  for (const s of steps) {
    for (const x of [s, ...(((s as { cues?: CueAction[] }).cues) ?? [])] as { type: string; id?: string; shape?: Shape }[]) if (x.id) used.add(x.id)
  }
  const n: Record<string, number> = {}
  const fresh = (type: string, shape?: Shape) => {
    const p = type === 'draw' && shape ? ({ axes: 'ax', function: 'f', point: 'p', arrow: 'a', line: 'l', figure: 'fig' } as Record<string, string>)[shape.kind] ?? 's' : PREFIX[type]
    let id = ''
    do { n[p] = (n[p] ?? 0) + 1; id = `${p}${n[p]}` } while (used.has(id))
    used.add(id)
    return id
  }
  const fix = <T extends { type: string; id?: string; shape?: Shape }>(x: T): T => (PREFIX[x.type] && !x.id ? { ...x, id: fresh(x.type, x.shape) } : x)
  return steps.map(s => {
    const f = fix(s as Step & { shape?: Shape }) as Step
    const cues = (f as { cues?: CueAction[] }).cues
    return cues ? { ...f, cues: cues.map(c => fix(c as CueAction & { shape?: Shape })) } as Step : f
  })
}

/* ───────────── Scene graph ───────────── */

const r1 = (v: number) => Math.round(v)
const short = (t: string, n = 48) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)

function shapeLabel(sh: Shape): string {
  switch (sh.kind) {
    case 'axes': return `axes x ${sh.xRange[0]}..${sh.xRange[1]}, y ${sh.yRange[0]}..${sh.yRange[1]}${sh.xLabel ? ` (${sh.xLabel}, ${sh.yLabel ?? ''})` : ''}`
    case 'function': return `curve y = ${sh.expr}`
    case 'point': return `point${sh.label ? ` "${sh.label}"` : ''} at (${sh.at.join(', ')})`
    case 'line': case 'arrow': return `${sh.kind} (${sh.from.join(',')}) → (${sh.to.join(',')})`
    case 'circle': return `circle r ${sh.r}`
    case 'rect': return `rectangle ${sh.w}×${sh.h}`
    case 'figure': return `figure: ${short(sh.alt ?? 'diagram', 80)}`
    case 'secant': case 'tangent': return `${sh.kind} of y = ${sh.expr}`
    default: return sh.kind
  }
}

function elBox(el: BoardEl, state: BoardState, measured?: Map<string, Box>): Box | null {
  if (el.kind === 'text' || el.kind === 'math') {
    const b = estimateTextBox(el)
    return el.fx ? { ...b, x: b.x + el.fx.dx, y: b.y + el.fx.dy } : b
  }
  if (el.kind === 'shape') {
    const b = shapeBox(el, state.vars)
    if (!b) return null
    // Point labels sit beside the dot.
    if (el.step.shape.kind === 'point' && el.step.shape.label) { const w = el.step.shape.label.length * 10 + 12; b.w += w; b.y -= 22; b.h += 22 }
    return el.fx ? { ...b, x: b.x + el.fx.dx, y: b.y + el.fx.dy } : b
  }
  if (el.kind === 'mark') {
    const t = measured?.get(el.target)
    if (!t) return null
    const g = markGeometry(el.mark, t, el.key, el.note)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const p of g.strokes.flat()) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]) }
    if (g.note) { x0 = Math.min(x0, g.note.box.x); y0 = Math.min(y0, g.note.box.y); x1 = Math.max(x1, g.note.box.x + g.note.box.w); y1 = Math.max(y1, g.note.box.y + g.note.box.h) }
    return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
  }
  return null
}

export function boardState(steps: Step[]): BoardState { return buildBoard(steps, steps.length) }

export function sceneOf(doc: BoardDoc): Scene {
  const state = boardState(doc.steps)
  const layout = compactPartition(state)
  const notes = new Set(layout.notes.map(n => n.key))
  const boxes = new Map<string, Box>()
  for (const el of state.els) if (el.id && el.kind !== 'mark' && el.kind !== 'highlight') { const b = elBox(el, state); if (b) boxes.set(el.id, b) }
  const groupsOf = (id: string) => Object.entries(doc.groups).filter(([, ids]) => ids.includes(id)).map(([g]) => g)
  const elements: SceneElement[] = []
  for (const el of state.els) {
    if (el.kind === 'highlight') continue
    const b = elBox(el, state, boxes)
    if (!b || !el.id) continue
    const base = { id: el.id, bbox: [r1(b.x), r1(b.y), r1(b.w), r1(b.h)] as [number, number, number, number], step: el.born + 1 }
    let e: SceneElement
    if (el.kind === 'text' || el.kind === 'math') {
      e = { ...base, type: el.kind, label: short(el.kind === 'math' ? texToPlain(el.content) : el.content, 60), layer: notes.has(el.key) ? 'note' : 'diagram', color: el.color }
    } else if (el.kind === 'shape') {
      const k = el.step.shape.kind
      const type: SceneElement['type'] = k === 'axes' || k === 'function' || k === 'point' || k === 'line' || k === 'arrow' || k === 'figure' ? k : 'shape'
      e = { ...base, type, label: shapeLabel(el.step.shape), layer: 'diagram', color: el.step.color, on: el.step.on }
    } else if (el.kind === 'mark') {
      e = { ...base, type: 'mark', label: `${el.mark} on ${el.target}${el.note ? ` "${el.note}"` : ''}`, layer: 'mark', color: el.color }
    } else continue
    const g = groupsOf(el.id)
    if (g.length) e.groups = g
    elements.push(e)
  }
  return { width: BOARD_W, height: BOARD_H, elements, groups: doc.groups }
}

/** The scene as compact lines for a model (keeps tool results small on the free tier). */
export function sceneText(scene: Scene, max = 40): string {
  if (!scene.elements.length) return 'The board is empty.'
  const lines = scene.elements.slice(-max).map(e => `${e.id} [${e.type}${e.layer === 'note' ? ', note' : ''}] "${e.label}" box ${e.bbox.join(',')} step ${e.step}${e.groups ? ` groups ${e.groups.join('/')}` : ''}`)
  const groups = Object.entries(scene.groups).map(([g, ids]) => `${g}: ${ids.join(', ')}`)
  return [`Board ${scene.width}x${scene.height} (x right, y down).`, ...lines, ...(groups.length ? [`Groups: ${groups.join('; ')}`] : [])].join('\n')
}

/* ───────────── Edits ───────────── */

export type EditOp =
  | { op: 'add'; id?: string; text?: string; tex?: string; shape?: Shape; x?: number; y?: number; size?: string; color?: string; on?: string; fill?: boolean; rough?: boolean; dashed?: boolean; width?: number; say?: string }
  | { op: 'move'; id: string; to?: Pt; by?: Pt; path?: Pt[]; via?: string; say?: string }
  | { op: 'restyle'; id: string; color?: string; width?: number; dashed?: boolean; fill?: boolean; rough?: boolean; say?: string }
  | { op: 'erase'; ids: string[]; say?: string }
  | { op: 'highlight'; id: string; style?: 'box' | 'underline' | 'beat' | 'glow' | 'trace'; color?: string; say?: string }
  | { op: 'annotate'; id: string; mark?: string; note?: string; color?: string; say?: string }
  | { op: 'group'; name: string; ids: string[] }
  | { op: 'morph'; id: string; shape: Shape; say?: string }
  | { op: 'transform'; id: string; text?: string; tex?: string; say?: string }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const str = (v: unknown, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : undefined)
const numv = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined)
const pt = (v: unknown): Pt | undefined => (Array.isArray(v) && v.length === 2 && numv(v[0]) !== undefined && numv(v[1]) !== undefined ? [numv(v[0])!, numv(v[1])!] : undefined)

/** Expand group names to their element ids. */
function expand(ids: string[], groups: Record<string, string[]>): string[] {
  return [...new Set(ids.flatMap(i => groups[i] ?? [i]))]
}

/**
 * Turn edit ops into board steps. Returns the steps to append, the new groups, and errors for ops that could not be
 * understood (the rest still apply). Steps are validated against what is on the board.
 */
export function opsToSteps(rawOps: unknown[], doc: BoardDoc): { steps: Step[]; groups: Record<string, string[]>; errors: string[] } {
  const errors: string[] = []
  const groups = { ...doc.groups }
  const out: Step[] = []
  const state = boardState(doc.steps)
  const byId = new Map(state.els.filter(e => e.id).map(e => [e.id!, e]))
  rawOps.slice(0, 12).forEach((raw, i) => {
    const o = obj(raw)
    const say = str(o.say, 300)
    const at = `ops[${i}]`
    const id = str(o.id, 40)
    const withSay = <T extends object>(s: T) => (say ? { ...s, say } : s) as unknown as Step
    switch (o.op) {
      case 'add': {
        const common = { id: id || undefined, color: str(o.color, 12), size: str(o.size, 4) }
        if (str(o.text)) out.push(withSay({ type: 'write', text: str(o.text)!, x: numv(o.x) ?? 40, y: numv(o.y) ?? 40, ...common }))
        else if (str(o.tex)) out.push(withSay({ type: 'math', tex: str(o.tex, 400)!, x: numv(o.x) ?? 40, y: numv(o.y) ?? 40, ...common }))
        else if (o.shape) out.push(withSay({ type: 'draw', id: id || undefined, shape: o.shape as Shape, color: str(o.color, 12), on: str(o.on, 40), fill: o.fill === true || undefined, rough: o.rough === true || undefined, dashed: o.dashed === true || undefined, width: numv(o.width) }))
        else errors.push(`${at}: add needs text, tex or shape`)
        break
      }
      case 'move': {
        if (!id) { errors.push(`${at}: move needs id`); break }
        const path = Array.isArray(o.path) ? o.path.map(pt).filter((p): p is Pt => !!p) : []
        if (path.length >= 2 || str(o.via)) out.push(withSay({ type: 'along', target: id, ...(path.length >= 2 ? { path } : { via: str(o.via, 40) }) }))
        else if (pt(o.to) || pt(o.by)) out.push(withSay({ type: 'move', target: id, ...(pt(o.to) ? { to: pt(o.to) } : { by: pt(o.by) }) }))
        else errors.push(`${at}: move needs to, by, path or via`)
        break
      }
      case 'restyle': {
        if (!id) { errors.push(`${at}: restyle needs id`); break }
        const el = byId.get(id)
        const color = str(o.color, 12)
        if (el?.kind === 'shape' && (o.width !== undefined || o.dashed !== undefined || o.fill !== undefined || o.rough !== undefined)) {
          // Redraw the same element (same id) in its new style.
          out.push(withSay({ ...el.step, type: 'draw', id, color: (color as Ink) ?? el.step.color, width: numv(o.width) ?? el.step.width, dashed: typeof o.dashed === 'boolean' ? o.dashed : el.step.dashed, fill: typeof o.fill === 'boolean' ? o.fill : el.step.fill, rough: typeof o.rough === 'boolean' ? o.rough : el.step.rough }))
        } else if (color) out.push(withSay({ type: 'color', target: id, color, pulse: true }))
        else errors.push(`${at}: restyle needs color (or width/dashed/fill/rough for a shape)`)
        break
      }
      case 'erase': {
        const asked = expand((Array.isArray(o.ids) ? o.ids : id ? [id] : []).map(x => String(x)), groups)
        const ids = asked.filter(x => byId.has(x))
        if (asked.length > ids.length) errors.push(`${at}: not on the board: ${asked.filter(x => !byId.has(x)).join(', ')}`)
        if (!ids.length) { if (!asked.length) errors.push(`${at}: erase needs ids`); break }
        out.push(withSay({ type: 'clear', targets: ids }))
        for (const g of Object.keys(groups)) groups[g] = groups[g].filter(x => !ids.includes(x))
        break
      }
      case 'highlight': {
        if (!id) { errors.push(`${at}: highlight needs id`); break }
        const style = str(o.style, 10) ?? 'box'
        for (const t of expand([id], groups)) {
          if (style === 'box' || style === 'underline') out.push(withSay({ type: 'highlight', target: t, style, color: str(o.color, 12) }))
          else out.push(withSay({ type: 'pulse', target: t, style: ['beat', 'glow', 'trace'].includes(style) ? style : 'beat', color: str(o.color, 12) }))
        }
        break
      }
      case 'annotate': {
        if (!id) { errors.push(`${at}: annotate needs id`); break }
        const mark = str(o.mark, 10) ?? 'circle'
        out.push(withSay({ type: 'annotate', target: id, mark, note: str(o.note, 24), color: str(o.color, 12) ?? 'clay' }))
        break
      }
      case 'group': {
        const name = str(o.name, 40) ?? id
        const ids = (Array.isArray(o.ids) ? o.ids : []).map(x => String(x)).filter(x => byId.has(x))
        if (!name || !/^[A-Za-z][\w-]{0,39}$/.test(name) || !ids.length) { errors.push(`${at}: group needs a name (letters/digits) and ids on the board`); break }
        groups[name] = ids
        break
      }
      case 'morph': {
        if (!id || !o.shape) { errors.push(`${at}: morph needs id and shape`); break }
        out.push(withSay({ type: 'morph', target: id, shape: o.shape as Shape, color: str(o.color, 12) }))
        break
      }
      case 'transform': {
        if (!id) { errors.push(`${at}: transform needs id`); break }
        out.push(withSay({ type: 'transform', target: id, ...(str(o.tex) ? { tex: str(o.tex, 400) } : { text: str(o.text) }) }))
        break
      }
      default: errors.push(`${at}: unknown op "${String(o.op)}" (add, move, restyle, erase, highlight, annotate, group, morph, transform)`)
    }
  })
  const known = boardIdsAfter(doc.steps)
  const withIds = ensureIds(out, known.ids)
  const v = validateScript(withIds, { knownIds: known.ids, knownAxes: known.axes, knownVars: known.vars, maxSteps: 30 })
  return { steps: v.steps, groups, errors: [...errors, ...v.errors.slice(0, 8)] }
}

/** Ids of elements whose box lies inside (or, with touching, meets) a region. */
export function idsInRegion(scene: Scene, r: { x: number; y: number; w: number; h: number }, touching = false): string[] {
  return scene.elements.filter(e => {
    const [x, y, w, h] = e.bbox
    if (touching) return x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y
    const cx = x + w / 2, cy = y + h / 2
    return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h
  }).map(e => e.id)
}

export const REGIONS: Record<string, { x: number; y: number; w: number; h: number }> = {
  all: { x: -100, y: -100, w: BOARD_W + 200, h: BOARD_H + 200 },
  top: { x: -100, y: -100, w: BOARD_W + 200, h: BOARD_H / 2 + 100 },
  bottom: { x: -100, y: BOARD_H / 2, w: BOARD_W + 200, h: BOARD_H / 2 + 100 },
  left: { x: -100, y: -100, w: BOARD_W / 2 + 100, h: BOARD_H + 200 },
  right: { x: BOARD_W / 2, y: -100, w: BOARD_W / 2 + 100, h: BOARD_H + 200 },
}

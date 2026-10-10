/**
 * Tutor State: one compact plain-text block (~1.5K tokens at most) the tutor reads on EVERY turn, so it decides with
 * its eyes open instead of having to spend a step on board_inspect or a lookup. Plain text, not JSON (Khan's finding:
 * the same learner history as text helps, raw JSON does not). Built server-side from data that already exists:
 *   BOARD      the scene graph of what is on screen (board-scene.ts), element ids + coarse 6x6 grid cell, free cells
 *   NOW        the lesson, section and step playing (lesson_progress / the player's live position)
 *   EVENT      the last learner event (their message, a check answer right/wrong + what, a reteach)
 *   LEARNER    level line, skill mastery (learner_skill_state), known misconceptions (learner_memory)
 *   SHOWN      visuals already shown in this conversation (live figures with their sliders, so they can be changed)
 *   FEATURES   what kind of idea the question is about (visual-policy families), as a hint, never a gate
 * Used by Ask, the in-lesson tutor sheet and the lesson reteach. Server only; one learner's own data only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Block } from './types'
import type { CheckStep, Step } from '../lesson-schema'
import { ensureIds, sceneOf, type BoardDoc, type Scene } from './board-scene'
import { readVisual } from '../visual-policy'
import { texToPlain } from '../math-text'

/** Hard cap on the block (characters; ~3.6 chars a token → about 1.5K tokens). */
export const STATE_CAP = 5400

const oneLine = (s: unknown, n = 120) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/* ───────────── Board ───────────── */

const COLS = 'ABCDEF'
/** Grid cell of a point on the 800x500 board: columns A-F left→right, rows 1-6 top→bottom (Code2Video anchors). */
export function cellOf(x: number, y: number, w = 800, h = 500): string {
  const c = Math.max(0, Math.min(5, Math.floor((x / w) * 6)))
  const r = Math.max(0, Math.min(5, Math.floor((y / h) * 6)))
  return `${COLS[c]}${r + 1}`
}

/** Cells no element touches (where something new can go without clutter). */
export function freeCells(scene: Scene): string[] {
  const used = new Set<string>()
  for (const e of scene.elements) {
    if (e.layer === 'mark') continue
    const [x, y, w, h] = e.bbox
    for (let cx = x; cx <= x + w; cx += Math.max(20, scene.width / 12)) for (let cy = y; cy <= y + h; cy += Math.max(20, scene.height / 12)) used.add(cellOf(cx, cy, scene.width, scene.height))
    used.add(cellOf(x + w, y + h, scene.width, scene.height))
  }
  const out: string[] = []
  for (let r = 1; r <= 6; r++) for (const c of COLS) if (!used.has(`${c}${r}`)) out.push(`${c}${r}`)
  return out
}

/** Collapse free cells into short row ranges ("rows 5-6 all", "E1-F3"). */
function freeSummary(cells: string[]): string {
  if (!cells.length) return 'none'
  if (cells.length === 36) return 'all'
  const rows = new Map<number, string[]>()
  for (const c of cells) { const r = Number(c[1]); rows.set(r, [...(rows.get(r) ?? []), c[0]]) }
  return [...rows.entries()].map(([r, cs]) => (cs.length === 6 ? `row ${r}` : `${cs.join('')}${r}`)).join(', ')
}

/** The board in view, element by element: `id type "label" @cell (step n)`. Most recent last; capped. */
export function boardLines(scene: Scene, max = 22): string[] {
  if (!scene.elements.length) return []
  const els = scene.elements.filter(e => e.layer !== 'mark' || scene.elements.length < 30)
  const shown = els.slice(-max)
  const lines = shown.map(e => {
    const [x, y, w, h] = e.bbox
    return `${e.id} ${e.type} "${oneLine(e.label, 48)}" @${cellOf(x + w / 2, y + h / 2, scene.width, scene.height)} (step ${e.step})`
  })
  const older = els.length - shown.length
  if (older > 0) lines.unshift(`(${older} older element${older > 1 ? 's' : ''} not listed)`)
  lines.push(`free cells: ${freeSummary(freeCells(scene))}`)
  return lines
}

/* ───────────── Lesson position ───────────── */

/** Only steps that draw something on the board (no checks, clips, stages or pauses) and no narration. */
const BOARD_TYPES = new Set(['write', 'math', 'draw', 'highlight', 'transform', 'clear', 'annotate', 'move', 'morph', 'color', 'fade', 'scale', 'pulse', 'along', 'animate', 'set'])

/** The lesson board in view at script index `cursor`: from the last full clear up to and including it, ids filled in. */
export function lessonBoardAt(script: Step[], cursor: number): BoardDoc {
  const end = Math.max(0, Math.min(cursor, script.length - 1))
  let from = 0
  for (let k = end; k >= 0; k--) { const s = script[k]; if (s?.type === 'clear' && !(s as { targets?: unknown }).targets) { from = k + 1; break } }
  const steps = script.slice(from, end + 1).filter(s => BOARD_TYPES.has(s.type)).map(s => {
    const { say: _say, ...rest } = s as Step & { say?: string }
    void _say
    return rest as Step
  })
  return { steps: ensureIds(steps), groups: {}, rev: 0 }
}

export interface LessonPos {
  title: string
  cursor: number
  total: number
  section?: { index: number; count: number; title: string } | null
  /** What the step playing now says / is. */
  stepLine?: string | null
}

function stepLine(st: Step | undefined): string | null {
  if (!st) return null
  const say = (st as { say?: string }).say
  if (st.type === 'check') return `check: ${oneLine((st as CheckStep).prompt, 120)}`
  if (st.type === 'stage') return `live figure on stage${say ? `, saying "${oneLine(say, 100)}"` : ''}`
  if (st.type === 'manim_clip') return `animation clip${say ? `, saying "${oneLine(say, 100)}"` : ''}`
  const what = st.type === 'math' ? `math ${oneLine(texToPlain((st as { tex?: string }).tex ?? ''), 60)}` : st.type === 'write' ? `write "${oneLine((st as { text?: string }).text, 60)}"` : st.type
  return `${what}${say ? `, saying "${oneLine(say, 110)}"` : ''}`
}

export function lessonPos(title: string, script: Step[], chapters: { title: string; start: number; count: number }[], cursor: number): LessonPos {
  const i = Math.max(0, Math.min(cursor, Math.max(0, script.length - 1)))
  const k = chapters.findIndex(c => i >= c.start && i < c.start + c.count)
  return { title, cursor: i, total: script.length, section: k >= 0 ? { index: k, count: chapters.length, title: chapters[k].title } : null, stepLine: stepLine(script[i]) }
}

/* ───────────── Learner ───────────── */

export interface LearnerFacts {
  level?: string | null
  skills: { title: string; p: number; n: number }[]
  misconceptions: string[]
  mood?: number | null
}

/** Skill mastery (this lesson's first, then the most recently observed) and the latest misconceptions. */
export async function learnerFacts(db: SupabaseClient, studentId: string, opts: { lessonId?: string | null; level?: string | null } = {}): Promise<LearnerFacts> {
  const [sk, mem, ci] = await Promise.all([
    db.from('learner_skill_state').select('title, p_mastery, n_obs, lesson_id, last_obs_at').eq('student_id', studentId).order('last_obs_at', { ascending: false, nullsFirst: false }).limit(6),
    db.from('learner_memory').select('title, content, lesson_id, created_at').eq('student_id', studentId).eq('kind', 'misconception').order('created_at', { ascending: false }).limit(4),
    db.from('learner_checkins').select('mood, confidence, created_at').eq('student_id', studentId).order('created_at', { ascending: false }).limit(1),
  ]).catch(() => [{ data: null }, { data: null }, { data: null }] as const)
  const rows = ((sk as { data: unknown }).data ?? []) as { title: string; p_mastery: number; n_obs: number; lesson_id: string | null }[]
  rows.sort((a, b) => Number(b.lesson_id === opts.lessonId) - Number(a.lesson_id === opts.lessonId))
  const m = ((mem as { data: unknown }).data ?? []) as { title: string; content: string; lesson_id: string | null }[]
  m.sort((a, b) => Number(b.lesson_id === opts.lessonId) - Number(a.lesson_id === opts.lessonId))
  const c = (((ci as { data: unknown }).data ?? []) as { mood: number | null; confidence: number | null; created_at: string }[])[0]
  const recent = c && Date.now() - new Date(c.created_at).getTime() < 3 * 3600_000 ? Math.min(c.mood ?? 5, c.confidence ?? 5) : null
  return {
    level: opts.level ?? null,
    skills: rows.slice(0, 3).map(r => ({ title: r.title, p: Number(r.p_mastery) || 0, n: Number(r.n_obs) || 0 })),
    misconceptions: m.slice(0, 3).map(x => oneLine(`${x.title}: ${x.content}`, 170)),
    mood: recent,
  }
}

const band = (p: number) => (p >= 0.85 ? 'secure' : p >= 0.6 ? 'getting there' : p >= 0.35 ? 'shaky' : 'new')

/* ───────────── Event ───────────── */

export interface LastEvent {
  kind: 'message' | 'answer' | 'reteach' | 'report'
  /** Free-text description, e.g. the check prompt and what they said. */
  text: string
  correct?: boolean
  expected?: string | null
  at?: string | null
}

/** The last check answer in the lesson's progress events, with its prompt and the expected answer. */
export function lastCheckEvent(events: unknown[] | null | undefined, script: Step[]): LastEvent | null {
  const ev = [...(events ?? [])].reverse().find(e => !!e && typeof e === 'object' && (e as { type?: string }).type === 'check' && (e as { response?: string }).response === 'answer') as { step?: number; correct?: boolean; answer?: string; at?: string } | undefined
  if (!ev) return null
  const st = typeof ev.step === 'number' ? script[ev.step] as CheckStep | undefined : undefined
  const expected = st?.type === 'check' ? (st.kind === 'choice' && Array.isArray(st.options) && typeof st.answer === 'number' ? String(st.options[st.answer] ?? '') : st.accept?.[0] ?? null) : null
  return { kind: 'answer', text: `check "${oneLine(st?.prompt ?? 'a question', 110)}", they answered "${oneLine(ev.answer ?? '', 60)}"`, correct: ev.correct, expected, at: ev.at ?? null }
}

/* ───────────── Shown this session ───────────── */

/** Visuals already shown in this conversation, newest last; live figures carry their sliders so they can be changed. */
export function shownLines(blocks: Block[], max = 6): string[] {
  const out: string[] = []
  for (const b of blocks) {
    if (b.kind === 'interactive') {
      const s = b.spec
      const sl = s.sliders.slice(0, 3).map(x => `${x.name} ${x.min}..${x.max} =${x.value}`).join(', ')
      const fn = s.functions.slice(0, 2).map(f => `${f.name}=${oneLine(f.expr, 30)}`).join(', ')
      out.push(`live figure ${b.id} "${oneLine(s.title, 50)}"${fn ? ` [${fn}]` : ''}${sl ? ` sliders ${sl}` : ''}${s.field ? ' (vector field)' : ''}`)
    } else if (b.kind === 'sim') out.push(`simulation ${b.id} "${oneLine(b.spec.title, 50)}" params ${b.spec.params.slice(0, 3).map(p => `${p.name}=${p.value}`).join(', ')}`)
    else if (b.kind === 'svg') out.push(`picture ${b.id}: ${oneLine(b.alt, 70)}${b.credit ? ' (library illustration)' : ''}`)
    else if (b.kind === 'clip') out.push(`animation clip ${b.id} (${b.status})${b.caption ? `: ${oneLine(b.caption, 60)}` : ''}`)
    else if (b.kind === 'board') out.push(`${b.plot ? 'graph' : 'board scene'} "${oneLine(b.title, 50)}"`)
    else if (b.kind === 'image') out.push(`python figure${b.caption ? `: ${oneLine(b.caption, 50)}` : ''}`)
    else if (b.kind === 'practice') out.push(`practice set "${oneLine(b.title, 50)}"`)
  }
  // The same scene edited in several turns is one entry.
  return [...new Set(out)].slice(-max)
}

/* ───────────── The block ───────────── */

export interface TutorStateInput {
  surface: 'ask' | 'sheet' | 'reteach'
  event?: LastEvent | null
  /** The learner's current message (Ask / sheet). */
  message?: string | null
  lesson?: LessonPos | null
  /** What is on screen. `where` says whose board it is. */
  board?: { doc: BoardDoc; where: string } | null
  learner?: LearnerFacts | null
  shown?: string[]
  /** Text the visual features are read from (the message, plus the lesson topic for generic follow-ups). */
  featuresFrom?: string | null
  /** Turns in this conversation so far (0 = first). */
  turn?: number
}

/** The plain-text state block. Sections with nothing to say are left out; the whole is capped at STATE_CAP. */
export function tutorState(s: TutorStateInput): string {
  const L: string[] = ['TUTOR STATE (what you can see right now; read it before you decide)']
  // EVENT
  if (s.event) {
    const verdict = s.event.correct === true ? 'RIGHT' : s.event.correct === false ? 'WRONG' : ''
    L.push(`EVENT: ${s.event.kind}${verdict ? ` ${verdict}` : ''}: ${s.event.text}${s.event.correct === false && s.event.expected ? `; expected "${oneLine(s.event.expected, 60)}"` : ''}`)
  }
  if (s.message) L.push(`LEARNER SAYS NOW: "${oneLine(s.message, 300)}"${s.turn ? ` (turn ${s.turn + 1} of this conversation)` : ' (first message of this conversation)'}`)
  // NOW
  if (s.lesson) {
    const sec = s.lesson.section ? `, section ${s.lesson.section.index + 1}/${s.lesson.section.count} "${oneLine(s.lesson.section.title, 70)}"` : ''
    L.push(`NOW: lesson "${oneLine(s.lesson.title, 80)}"${sec}, step ${s.lesson.cursor + 1}/${s.lesson.total}${s.lesson.stepLine ? ` (${s.lesson.stepLine})` : ''}`)
  } else if (s.surface === 'ask') L.push('NOW: the Ask tab (no lesson open)')
  // BOARD
  if (s.board) {
    const scene = sceneOf(s.board.doc)
    const lines = boardLines(scene)
    if (lines.length) {
      L.push(`BOARD IN VIEW (${s.board.where}; ids you can point at or edit; cells A-F left→right, 1-6 top→bottom):`)
      for (const l of lines) L.push(`  ${l}`)
    } else L.push(`BOARD IN VIEW (${s.board.where}): empty`)
  } else L.push('BOARD IN VIEW: nothing drawn yet')
  // SHOWN
  if (s.shown?.length) {
    L.push('ALREADY SHOWN in this conversation (the learner can scroll up to them):')
    for (const l of s.shown) L.push(`  ${l}`)
  }
  // LEARNER
  if (s.learner) {
    const parts: string[] = []
    if (s.learner.level) parts.push(oneLine(s.learner.level, 160))
    if (s.learner.skills.length) parts.push(`skills: ${s.learner.skills.map(k => `${oneLine(k.title, 50)} p=${k.p.toFixed(2)} ${band(k.p)}${k.n ? `, ${k.n} answers` : ''}`).join('; ')}`)
    if (s.learner.mood !== null && s.learner.mood !== undefined && s.learner.mood <= 2) parts.push('low mood/confidence at the last check-in: go gently, one small step')
    if (parts.length) L.push(`LEARNER: ${parts.join(' | ')}`)
    if (s.learner.misconceptions.length) {
      L.push('KNOWN MISCONCEPTIONS:')
      for (const m of s.learner.misconceptions) L.push(`  - ${m}`)
    }
  }
  // FEATURES (hint only)
  if (s.featuresFrom) {
    const r = readVisual(s.featuresFrom)
    if (r.families.length) L.push(`FEATURES (a cheap reader's guess, not a rule): ${r.families.join(', ')}${r.structure ? `; a real object: ${r.structure}` : ''}`)
  }
  let out = L.join('\n')
  if (out.length > STATE_CAP) {
    // Trim the board list first (keep its newest lines), then hard-clip.
    const head = L.findIndex(l => l.startsWith('BOARD IN VIEW'))
    if (head >= 0) {
      let end = head + 1
      while (end < L.length && L[end].startsWith('  ')) end++
      const boardLinesKept = L.slice(head + 1, end).slice(-10)
      out = [...L.slice(0, head + 1), '  (older board elements omitted)', ...boardLinesKept, ...L.slice(end)].join('\n')
    }
    if (out.length > STATE_CAP) out = `${out.slice(0, STATE_CAP - 1)}…`
  }
  return out
}

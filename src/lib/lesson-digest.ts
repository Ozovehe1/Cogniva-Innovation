/**
 * Compact digest of what a learner's lesson(s) actually taught, for writing a mastery
 * check from the lesson instead of from the topic title alone.
 *
 * Per beat: its chapter, title and key points; the board's maths and text as it was
 * worked (transforms chained with →, so a worked example reads as its steps); the
 * narration of worked examples (numbers and units live there); and the in-lesson
 * check questions with their correct answers. Size-capped. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Step, CheckStep } from './lesson-schema'
import type { PathRow, TopicRow } from './learner'
import { toPlainText } from './math-text'

/** Version of the mastery items' basis; items stored without it were written from the topic title only. */
export const MASTERY_ITEMS_VERSION = 3

/** Max characters for the whole digest, the current topic's lesson, and each earlier topic's lesson. */
const TOTAL_CAP = 5200
const MAIN_CAP = 3800
const PRIOR_CAP = 700
const MAX_PRIOR = 2

interface SectionLite { position: number; title: string; goal: string; key_points: string[] | null; kind: string | null; chapter: string | null; status: string; steps: Step[] }

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(0, n - 1)).trimEnd() + '…' : s)
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The actions in a step: the step itself plus any cue actions fired during its narration. */
function actions(st: Step): Step[] {
  const cues = (st as { cues?: unknown[] }).cues
  return [st, ...(Array.isArray(cues) ? (cues as Step[]) : [])]
}

function checkLine(c: CheckStep): string | null {
  if (!c.prompt) return null
  if (c.kind === 'choice' && Array.isArray(c.options) && c.options.length) {
    const right = typeof c.answer === 'number' ? c.options[c.answer] : undefined
    return `Check: ${oneLine(c.prompt)} [${c.options.map(o => oneLine(String(o))).join(' | ')}]${right ? ` answer: ${oneLine(String(right))}` : ''}`
  }
  if (c.kind === 'short') return `Check: ${oneLine(c.prompt)}${c.accept?.length ? ` answer: ${c.accept.slice(0, 2).join(' / ')}` : ''}`
  return null // "do you understand?" taps carry no content
}

/** One beat's pieces, before sizing. */
interface Beat { head: string; checks: string[]; board: string; said: string; rank: number }

function beatOf(title: string, kind: string | null, keyPoints: string[], steps: Step[]): Beat {
  const board: string[] = []
  const said: string[] = []
  const checks: string[] = []
  for (const st of steps) {
    for (const a of actions(st)) {
      if (a.type === 'math' && a.tex) board.push(`$${a.tex}$`)
      else if (a.type === 'transform' && (a.tex || a.text)) board.push(`→ ${a.tex ? `$${a.tex}$` : a.text}`)
      else if (a.type === 'write' && a.text && a.size !== 'lg') board.push(oneLine(a.text))
      else if (a.type === 'check') { const l = checkLine(a); if (l) checks.push(l) }
    }
    if (st.say && (kind === 'example' || kind === 'your_turn' || /\d/.test(st.say))) said.push(oneLine(st.say))
  }
  const unesc = (x: string) => x.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  return {
    head: `- ${title}${kind ? ` (${kind})` : ''}${keyPoints.length ? `: ${keyPoints.map(oneLine).join('; ')}` : ''}`,
    checks,
    board: unesc(board.join('  ').replace(/ {2}→/g, ' →')),
    said: toPlainText(said.join(' ')),
    // Worked examples, the learner's turns and checks show what is tested; demos and the wrap are context.
    rank: kind === 'example' || kind === 'your_turn' || kind === 'check' || checks.length ? 0 : 1,
  }
}

/** A beat as lines within a budget (scaled by `k`): header, checks, board work, then narration. */
function render(b: Beat, k: number): string {
  const lines = [clip(b.head, Math.round(220 * k))]
  for (const c of b.checks) lines.push('  ' + clip(c, Math.round(260 * k)))
  if (b.board) lines.push('  Board: ' + clip(b.board, Math.round((b.rank ? 160 : 320) * k)))
  if (b.said && !b.rank && k >= 0.5) lines.push('  Said: ' + clip(b.said, Math.round(260 * k)))
  return lines.join('\n')
}

/** Digest of one lesson, capped at `cap` characters. Null when the lesson has no ready content. */
export async function lessonDigest(db: SupabaseClient, lessonId: string, cap: number): Promise<{ title: string; text: string } | null> {
  const [{ data: lesson }, { data: secs }] = await Promise.all([
    db.from('lessons').select('id, title, objectives, script').eq('id', lessonId).maybeSingle(),
    db.from('lesson_sections').select('position, title, goal, key_points, kind, chapter, status, steps').eq('lesson_id', lessonId).order('position', { ascending: true }),
  ])
  if (!lesson) return null
  const l = lesson as { title: string; objectives: string[] | null; script: Step[] | null }
  const ready = ((secs ?? []) as SectionLite[]).filter(s => s.status === 'ready' && Array.isArray(s.steps) && s.steps.length)
  // "Extra" practice beats often repeat an earlier beat's plan: keep one of each.
  const seen = new Set<string>()
  const beats: Beat[] = []
  if (ready.length) {
    for (const s of ready) {
      const key = (s.key_points ?? []).join('|').toLowerCase()
      if (key && seen.has(`${s.kind}:${key}`)) continue
      seen.add(`${s.kind}:${key}`)
      const title = s.title.replace(/^Extra:\s*(another example|your turn):\s*/i, 'Extra: ')
      beats.push(beatOf(title, s.kind, s.kind === 'demo' || s.kind === 'wrap' ? [] : (s.key_points ?? []), s.steps))
    }
  } else if (Array.isArray(l.script) && l.script.length) {
    beats.push(beatOf('Lesson', 'example', [], l.script))
  }
  if (!beats.length) return null
  const head = `Lesson "${toPlainText(l.title)}"${l.objectives?.length ? ` (aim: ${oneLine(l.objectives[0])})` : ''}`
  // Shrink every beat evenly until the lesson fits; at the smallest size drop context beats, then clip.
  for (const k of [1.4, 1, 0.75, 0.55, 0.4, 0.3]) {
    const text = [head, ...beats.map(b => render(b, k))].join('\n')
    if (text.length <= cap) return { title: l.title, text }
  }
  const text = [head, ...beats.filter(b => !b.rank).map(b => render(b, 0.3))].join('\n')
  return { title: l.title, text: clip(text, cap) }
}

export interface MasteryContext {
  /** The digest passed to the question writer, or '' when no lesson content exists. */
  digest: string
  /** Lessons the digest was built from. */
  lessonIds: string[]
}

/**
 * What this learner was taught for a topic: the topic's own lesson, plus the lessons of
 * the earlier topics on this path that it builds on (its prerequisites) which the learner
 * actually took (opened or mastered).
 */
export async function masteryContext(db: SupabaseClient, path: PathRow, topic: TopicRow): Promise<MasteryContext> {
  const parts: string[] = []
  const lessonIds: string[] = []
  if (topic.lesson_id) {
    const main = await lessonDigest(db, topic.lesson_id, MAIN_CAP).catch(() => null)
    if (main) { parts.push(`THIS TOPIC'S LESSON\n${main.text}`); lessonIds.push(topic.lesson_id) }
  }
  if (!parts.length) return { digest: '', lessonIds: [] }

  const prereqIds = path.graph.nodes.find(n => n.id === topic.node_id)?.prereqs ?? []
  if (prereqIds.length) {
    const { data: rows } = await db.from('path_topics').select('node_id, lesson_id, status, position').eq('path_id', path.id).in('node_id', prereqIds).not('lesson_id', 'is', null).order('position', { ascending: false })
    const earlier = ((rows ?? []) as { node_id: string; lesson_id: string; status: string }[]).filter(r => r.lesson_id !== topic.lesson_id)
    let taken = earlier
    if (earlier.length) {
      const { data: prog } = await db.from('lesson_progress').select('lesson_id').eq('student_id', topic.student_id).in('lesson_id', earlier.map(r => r.lesson_id))
      const opened = new Set(((prog ?? []) as { lesson_id: string }[]).map(p => p.lesson_id))
      taken = earlier.filter(r => r.status === 'mastered' || opened.has(r.lesson_id))
    }
    for (const r of taken.slice(0, MAX_PRIOR)) {
      const d = await lessonDigest(db, r.lesson_id, PRIOR_CAP).catch(() => null)
      if (d) { parts.push(`EARLIER LESSON IT BUILDS ON\n${d.text}`); lessonIds.push(r.lesson_id) }
    }
  }
  return { digest: clip(parts.join('\n\n'), TOTAL_CAP), lessonIds }
}

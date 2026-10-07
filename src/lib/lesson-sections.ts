/**
 * Long lessons are made of sections (chapters). Students play one flat script;
 * `chapters` says where each section starts in it. Every section after the first
 * opens with a full `clear`, so the board state never leaks between sections and
 * any section can be rebuilt from its own start.
 *
 * Pure helpers: safe on the server and in the browser.
 */
import { validateScript, type Step } from './lesson-schema'
import { measureMs, measureStepMs } from './lesson-timing'

export interface Chapter {
  title: string
  /** Index of the section's first step in the flat script. */
  start: number
  count: number
  /** Estimated playing time of the section in ms. */
  ms?: number
}

export interface SectionLite {
  id?: string
  title: string
  status?: string
  steps: Step[]
}

/** Per-section and whole-lesson step caps (a 2 hour lesson is roughly 600-900 steps). */
export const SECTION_MAX_STEPS = 120
export const LESSON_MAX_STEPS = 2000
export const TARGET_MINUTES = [10, 15, 20, 30, 45, 60, 90, 120] as const
export const MIN_TARGET = 5
export const MAX_TARGET = 180

/**
 * Play time of one step as the player runs it: its narration (calibrated to the
 * Kokoro voice) and every timed action, plus the gap to the next step; checks add
 * the learner's answer time. See lesson-timing.ts.
 */
export function estimateStepMs(step: Step, index = 0): number {
  return measureStepMs(step, index)
}

export function estimateMs(steps: Step[], from = 0, to = steps.length): number {
  return measureMs(steps, undefined, from, to)
}

/** "1 h 24 min", "12 min", "under a minute". */
export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'under a minute'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/** Make sure a section can start on its own: sections after the first open with a full clear. */
export function withSectionStart(steps: Step[], position: number): Step[] {
  if (position === 0 || steps.length === 0) return steps
  const first = steps[0]
  if (first.type === 'clear' && !first.targets) return steps
  return [{ type: 'clear' }, ...steps]
}

/** Flatten ready sections into one playable script plus its chapter index. */
export function flattenSections(sections: SectionLite[]): { steps: Step[]; chapters: Chapter[] } {
  const steps: Step[] = []
  const chapters: Chapter[] = []
  for (const s of sections) {
    if (!Array.isArray(s.steps) || s.steps.length === 0) continue
    const own = withSectionStart(s.steps, chapters.length)
    chapters.push({ title: s.title, start: steps.length, count: own.length, ms: estimateMs(own) })
    steps.push(...own)
  }
  return { steps, chapters }
}

/** Chapters for a script; falls back to a single chapter when none are stored or they don't fit the script. */
export function normalizeChapters(raw: unknown, total: number, fallbackTitle: string, steps?: Step[]): Chapter[] {
  const one = (): Chapter[] => total > 0 ? [{ title: fallbackTitle, start: 0, count: total, ms: steps ? estimateMs(steps) : undefined }] : []
  if (!Array.isArray(raw) || raw.length === 0) return one()
  const out: Chapter[] = []
  let expect = 0
  for (const c of raw) {
    if (!c || typeof c !== 'object') return one()
    const { title, start, count, ms } = c as Record<string, unknown>
    if (typeof start !== 'number' || typeof count !== 'number' || start !== expect || count <= 0) return one()
    out.push({ title: typeof title === 'string' && title.trim() ? title : `Section ${out.length + 1}`, start, count, ms: typeof ms === 'number' ? ms : steps ? estimateMs(steps, start, start + count) : undefined })
    expect = start + count
  }
  return expect === total ? out : one()
}

/** Index of the chapter containing flat step index `i` (cursor-1 style index; -1 maps to 0). */
export function chapterAt(chapters: Chapter[], i: number): number {
  if (chapters.length === 0) return 0
  let lo = 0, hi = chapters.length - 1
  const idx = Math.max(0, i)
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (chapters[mid].start <= idx) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Validate one section's steps on a fresh board. */
export function validateSection(steps: unknown, position: number) {
  const v = validateScript(steps, { maxSteps: SECTION_MAX_STEPS })
  return { ...v, steps: v.ok ? withSectionStart(v.steps, position) : v.steps }
}

/** Index of the last full clear at or before `i` (+1), i.e. where the board was last empty. */
export function boardStartBefore(steps: Step[], i: number): number {
  for (let k = Math.min(i, steps.length - 1); k >= 0; k--) {
    const s = steps[k]
    if (s.type === 'clear' && !s.targets) return k
  }
  return 0
}

/* ───────────── Show, don't tell ───────────── */

const VISUAL = new Set(['draw', 'animate', 'move', 'transform', 'scale', 'color', 'camera', 'highlight', 'manim_clip', 'fade'])
const TEXT = new Set(['write', 'math'])

export function visualCounts(steps: Step[]): string {
  const v = steps.filter(st => VISUAL.has(st.type)).length
  const t = steps.filter(st => TEXT.has(st.type)).length
  return `${v} visual steps and ${t} text steps (write/math)`
}

/**
 * Animation, illustration and demonstration are the core of teaching: a section whose
 * content steps are mostly text (write / math) is rejected. Returns null when the
 * section is visual enough, otherwise a reason the drafter can fix.
 */
export function visualProblem(steps: Step[]): string | null {
  const content = steps.filter(st => VISUAL.has(st.type) || TEXT.has(st.type))
  if (content.length < 4) return null
  const visual = content.filter(st => VISUAL.has(st.type)).length
  const draws = steps.filter(st => st.type === 'draw' || st.type === 'manim_clip').length
  const motion = steps.filter(st => ['animate', 'move', 'transform', 'scale', 'camera', 'manim_clip'].includes(st.type)).length
  const textShare = (content.length - visual) / content.length
  const problems: string[] = []
  if (textShare > 0.5) problems.push(`${Math.round(textShare * 100)}% of the teaching steps are text only (write/math); at most half may be`)
  if (draws < 2) problems.push('fewer than 2 diagrams are drawn (draw steps: axes, functions, points, lines, shapes)')
  if (motion < 1) problems.push('nothing moves: add at least one animate / move / transform / scale demonstration')
  return problems.length ? problems.join('; ') : null
}

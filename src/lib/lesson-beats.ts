/**
 * Lessons drafted as many small beats (free-tier friendly).
 *
 * The Gemini free tier answers long requests with short outputs (and often falls
 * back to a flash-lite model), so one call can never be trusted to write minutes of
 * teaching. A lesson is instead planned as a list of beats of about 45-90 s each
 * (a demonstration, a worked example, a check or a "your turn"), and every beat is
 * written by its own small call with the whole plan in context and the board as the
 * previous beat left it. Length is then controlled by the worker, not by the model:
 * optional beats are written only when the lesson is behind schedule, and extra
 * practice beats are added before the closing beat until the target is reached.
 */
import { generateStructuredJson } from './gemini'
import { LAYOUT_RULES, SHOW_DONT_TELL, TUTOR_VOICE, WORDS_PER_MINUTE, generateSteps, type GenMeta, type LessonLite } from './lesson-ai'
import { beatVisualLine } from './visual-policy'
import { SCRIPT_SCHEMA_PROMPT, boardIdsAfter, type Step } from './lesson-schema'
import { lengthReport } from './lesson-timing'

export type BeatKind = 'demo' | 'example' | 'check' | 'your_turn' | 'wrap'
export const BEAT_KINDS: BeatKind[] = ['demo', 'example', 'check', 'your_turn', 'wrap']

export interface BeatPlan {
  chapter: string
  title: string
  kind: BeatKind
  seconds: number
  points: string[]
  optional: boolean
}

export const BEAT_MIN_S = 45
export const BEAT_MAX_S = 90
/** Planned length of a core beat. */
export const BEAT_TARGET_S = 70
/** The opening beat, written in parallel with the plan so playback can start at once. */
export const HOOK_SECONDS = 60
export const HOOK_CHAPTER = 'Why this matters'
/** Most beats a lesson may have (core + optional + extra). */
export const MAX_BEATS = 60
/** Extra practice beats the worker may add before the closing beat to reach the target. */
export const MAX_EXTRA_BEATS = 10

const WORDS_PER_SECOND = WORDS_PER_MINUTE / 60

const clampS = (n: number) => Math.round(Math.min(BEAT_MAX_S, Math.max(BEAT_MIN_S, n)))

function cleanPlan(raw: unknown, targetMinutes: number): BeatPlan[] {
  const arr = raw && typeof raw === 'object' && Array.isArray((raw as { beats?: unknown }).beats) ? (raw as { beats: unknown[] }).beats : Array.isArray(raw) ? raw : []
  const out: BeatPlan[] = []
  for (const r of arr.slice(0, MAX_BEATS)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.trim().slice(0, 100) : ''
    if (!title) continue
    const kind = (BEAT_KINDS as string[]).includes(String(o.kind)) ? o.kind as BeatKind : 'demo'
    const pts = Array.isArray(o.points) ? o.points : Array.isArray(o.keyPoints) ? o.keyPoints : []
    out.push({
      chapter: typeof o.chapter === 'string' && o.chapter.trim() ? o.chapter.trim().slice(0, 70) : (out[out.length - 1]?.chapter ?? 'Lesson'),
      title,
      kind,
      seconds: clampS(typeof o.seconds === 'number' ? o.seconds : BEAT_TARGET_S),
      points: pts.filter((k): k is string => typeof k === 'string' && !!k.trim()).map(k => k.trim().slice(0, 200)).slice(0, 5),
      optional: o.optional === true && kind !== 'wrap',
    })
  }
  const core = out.filter(b => !b.optional)
  if (core.length === 0) throw new Error('AI returned an empty beat plan')
  // The closing beat is the last core beat and is a wrap-up.
  const lastCore = core[core.length - 1]
  if (lastCore.kind !== 'wrap') lastCore.kind = 'wrap'
  // Nothing comes after the wrap.
  const plan = [...out.filter(b => b !== lastCore), lastCore]
  // Scale core seconds so the core adds up to the target (minus the opening hook), within 45..90 s.
  const want = Math.max(0, targetMinutes * 60 - HOOK_SECONDS)
  const sum = core.reduce((a, b) => a + b.seconds, 0) || 1
  for (const b of core) b.seconds = clampS(b.seconds * want / sum)
  return plan
}

export function coreBeatCount(targetMinutes: number) {
  return Math.max(1, Math.round((targetMinutes * 60 - HOOK_SECONDS) / BEAT_TARGET_S))
}

/** Plans beats 2..N of a lesson (beat 1, the opening hook, is written in parallel). One small call. */
export async function planLessonBeats(lesson: LessonLite, targetMinutes: number, notes?: string, opts: { deadline?: number; onModel?: (m: string) => void; trace?: string[] } = {}): Promise<BeatPlan[]> {
  const core = coreBeatCount(targetMinutes)
  const chapters = Math.max(1, Math.min(8, Math.round(targetMinutes / 5)))
  const prompt = `Plan a whiteboard lesson of ${targetMinutes} minutes as a list of short BEATS. Each beat is about ${BEAT_MIN_S}-${BEAT_MAX_S} seconds of teaching and is written separately later, so plan precisely.
Title: ${lesson.title}
Subject: ${lesson.subject}
Objectives:
${lesson.objectives.map(o => `- ${o}`).join('\n')}
${notes ? `Teaching notes for this learner (follow them):\n${notes}\n` : ''}
The lesson opens with a ${HOOK_SECONDS}-second hook beat (already being written) that shows why the topic matters. Plan everything AFTER it.
Beat kinds:
- "demo": draw a picture and make it move to build intuition for ONE idea.
- "example": one worked example demonstrated on the board step by step.
- "check": a quick question on what was just shown (multiple choice or short answer), then the answer shown.
- "your_turn": the learner tries a problem; then the tutor demonstrates the solution.
- "wrap": the final beat; consolidates the whole lesson.
Rules:
- About ${core} core beats (between ${Math.max(1, core - 2)} and ${core + 2}), grouped into about ${chapters} chapters (one coherent idea each, in teaching order: intuition, then formal idea, then practice).
- Inside a chapter: start with a demo, then examples, then a check or your_turn. Never two checks in a row. About one beat in four is a check or your_turn.
- Also add 1 optional beat per chapter ("optional": true, kind "example" or "your_turn": an extra example or practice at the end of that chapter, used only if the lesson runs short).
- The last beat is the single "wrap" beat.
- Every objective is covered. Plan every point as something to SHOW (e.g. "animate the slope as the point slides"), never "define X".
- Each beat: "chapter" (chapter title, under 50 characters), "title" (under 60 characters), "kind", "seconds" (${BEAT_MIN_S} to ${BEAT_MAX_S}), "points" (1 to 3 short phrases: exactly what this beat shows), "optional" (true/false).
Return {"beats": [...]} only.`
  // The plan is on the path to the first beat (the learner is waiting): fast models first, short timeouts.
  const raw = await generateStructuredJson(prompt, { systemInstruction: TUTOR_VOICE, timeoutMs: 25_000, primaryTimeoutMs: 20_000, deadline: opts.deadline, onModel: opts.onModel, trace: opts.trace, preferFast: true })
  return cleanPlan(raw, targetMinutes)
}

/** Plan entry of the opening hook beat. */
export function hookPlan(lesson: LessonLite): BeatPlan {
  return { chapter: HOOK_CHAPTER, title: `Why ${lesson.title}`.slice(0, 60), kind: 'demo', seconds: HOOK_SECONDS, points: ['a concrete picture of where this idea shows up', 'what we will be able to do by the end'], optional: false }
}

/** An extra practice beat added before the wrap when the lesson is running short. */
export const EXTRA_PREFIX = 'Extra: '

export function extraBeat(plan: BeatPlan[], n: number, deficitS: number, chapter: string): BeatPlan {
  const teaching = plan.filter(b => b.kind === 'demo' || b.kind === 'example')
  const src = teaching[(teaching.length - 1 - (n % Math.max(1, teaching.length)) + teaching.length) % Math.max(1, teaching.length)]
  const kind: BeatKind = n % 2 === 0 ? 'example' : 'your_turn'
  return {
    // Same chapter as the closing beat: practice continues on its board, with no extra chapter break.
    chapter,
    title: `${EXTRA_PREFIX}${kind === 'example' ? 'another example' : 'your turn'}: ${src?.title ?? 'the main idea'}`.slice(0, 80),
    kind,
    seconds: clampS(Math.min(BEAT_TARGET_S, deficitS)),
    points: src?.points?.length ? src.points : ['apply the main idea to a new case'],
    optional: false,
  }
}

const KIND_RULES: Record<BeatKind, string> = {
  demo: 'A demonstration: draw the picture (draw), then make it move (animate a variable, move, scale, transform) while the narration says what to watch. Build intuition for this one idea; no long definitions.',
  example: 'One worked example demonstrated step by step: sketch the situation, then evolve the working with transform steps on ONE math element (not a new line per step) while narrating each move. Highlight the result.',
  check: 'A quick check on what was just shown: one short narrated setup (point at the board), then ONE check step (kind "choice" with 3-4 options, "answer", "explanation" and a "reteach" of 3-5 steps that shows the idea a different way, or kind "short" with "accept"). After the check, show the answer on the board with a highlight or a short demonstration.',
  your_turn: 'The learner tries one: pose a small problem on the board (draw its picture), ask it with ONE check step (kind "short" with "accept", or "choice"; include "explanation" and a "reteach"), then demonstrate the solution step by step with transform / highlight.',
  wrap: 'Close the lesson: bring back the key pictures in a quick visual recap (redraw or animate the main diagram), state the one big idea, write a one-line summary on the board, and say what comes next.',
}

export interface BeatContext {
  lesson: LessonLite
  /** The whole plan, in order (hook first). */
  plan: BeatPlan[]
  /** Index of this beat in `plan`. */
  index: number
  /** Steps of the earlier ready beats of the same chapter (the board this beat starts on); empty = fresh board. */
  board: Step[]
  /** Narration of the last beats (for continuity), most recent last. */
  recentSay: string
  notes?: string
  meta?: GenMeta
  deadline?: number
  /** Board starts a new chapter (fresh board): the beat must open with a clear (except the very first beat). */
  chapterStart: boolean
  /** First beat of the whole lesson (written in parallel with the plan; the plan is not known yet). */
  opening?: boolean
}

/** Short summary of the models that failed before one answered, e.g. "gemini-3.8-flash 429, gemini-2.5-flash timeout". */
export function traceSummary(trace: string[] | undefined): string {
  return (trace ?? []).map(t => {
    const model = t.split(':')[0]
    const why = /429|RESOURCE_EXHAUSTED|quota/i.test(t) ? '429' : /timed? ?out|aborted|deadline/i.test(t) ? 'timeout' : /503|UNAVAILABLE|overloaded/i.test(t) ? '503' : /404|not found/i.test(t) ? '404' : 'error'
    return `${model} ${why}`
  }).join(', ')
}

/** Steps a beat of `seconds` should have, and its spoken words. */
export function beatBudget(seconds: number, kind: BeatKind) {
  // Checks wait for the learner's answer (14-30 s), so they need fewer spoken words.
  const talkS = kind === 'check' || kind === 'your_turn' ? Math.max(25, seconds - 22) : seconds
  const words = Math.round(talkS * WORDS_PER_SECOND / 5) * 5
  const min = Math.max(4, Math.round(seconds / 10))
  const max = Math.max(min + 4, Math.round(seconds / 5))
  return { words, min, max }
}

const VISUAL = new Set(['draw', 'animate', 'move', 'transform', 'scale', 'color', 'camera', 'highlight', 'manim_clip', 'fade'])
const MOTION = new Set(['animate', 'move', 'transform', 'scale', 'camera', 'manim_clip'])
const TEXT = new Set(['write', 'math'])

/** All actions of a beat, its cues included (a sentence with 3 cues is 4 actions). */
function actionsOf(steps: Step[]): string[] {
  const out: string[] = []
  for (const s of steps) {
    out.push(s.type)
    if ('cues' in s && Array.isArray(s.cues)) for (const c of s.cues) out.push((c as { type: string }).type)
  }
  return out
}

/**
 * Show, don't tell, per beat: text never outweighs demonstration, and teaching beats
 * (demo / example / wrap) must draw or move something. Checks must contain a check.
 * Returns null when the beat passes, otherwise a reason the drafter can fix.
 */
export function beatProblem(steps: Step[], kind: BeatKind, boardHasDiagram: boolean): string | null {
  const acts = actionsOf(steps)
  const visual = acts.filter(t => VISUAL.has(t)).length
  const text = acts.filter(t => TEXT.has(t)).length
  const draws = acts.filter(t => t === 'draw' || t === 'manim_clip').length
  const motion = acts.filter(t => MOTION.has(t)).length
  const problems: string[] = []
  if (visual + text >= 4 && text > visual) problems.push(`${text} text actions (write/math) outnumber ${visual} visual ones; at most half may be text`)
  if (kind === 'demo' || kind === 'example' || kind === 'wrap') {
    if (draws === 0 && !boardHasDiagram) problems.push('nothing is drawn: draw the picture (axes, function, shape, arrow, point)')
    if (motion === 0) problems.push('nothing moves: add an animate / move / transform / scale demonstration')
  }
  if ((kind === 'check' || kind === 'your_turn') && !steps.some(s => s.type === 'check' && s.kind !== 'understand')) problems.push('there is no "choice" or "short" check step')
  return problems.length ? problems.join('; ') : null
}

function planList(plan: BeatPlan[], index: number) {
  let chapter = ''
  const lines: string[] = []
  plan.forEach((b, i) => {
    if (b.chapter !== chapter) { chapter = b.chapter; lines.push(`Chapter: ${chapter}`) }
    const mark = i === index ? '   <-- THIS BEAT' : ''
    lines.push(`  ${i + 1}. [${b.kind}${b.optional ? ', optional' : ''}] ${b.title} (${b.seconds}s): ${b.points.join('; ')}${mark}`)
  })
  return lines.join('\n')
}

/** Writes one beat with its own small call. Returns validated steps (may throw GeminiQuotaError). */
export async function draftBeat(ctx: BeatContext): Promise<Step[]> {
  const beat = ctx.plan[ctx.index]
  const { words, min, max } = beatBudget(beat.seconds, beat.kind)
  const { ids, axes, vars } = boardIdsAfter(ctx.board)
  const onBoard = ctx.board.length ? summarizeBoard(ctx.board, ids) : 'nothing (fresh board)'
  const first = ctx.index === 0
  const prompt = `Write ONE short beat (about ${beat.seconds} seconds) of a whiteboard lesson. The lesson is written beat by beat; write only this beat.
Lesson: ${ctx.lesson.title} (${ctx.lesson.subject})
Objectives: ${ctx.lesson.objectives.join('; ')}
${ctx.opening ? 'This is the OPENING beat of the lesson.' : `Lesson plan:\n${planList(ctx.plan, ctx.index)}`}

THIS BEAT: [${beat.kind}] "${beat.title}"${ctx.opening ? '' : ` in chapter "${beat.chapter}"`}
Show: ${beat.points.join('; ')}
${KIND_RULES[beat.kind]}
${beatVisualLine(`${ctx.lesson.title}. ${beat.title}. ${beat.points.join('; ')}`, beat.kind) ?? ''}
${first ? `Open the lesson: write the lesson title (write, id "title", size lg, x 40, y 30), then hook the learner with a concrete picture of where "${ctx.lesson.title}" shows up in real life (draw it, make it move). Do not teach the method yet; end by saying what they will be able to do by the end.` : ''}
${ctx.recentSay ? `What the tutor just said (continue naturally from here; do not repeat it, no recap): ${ctx.recentSay}` : ''}
${ctx.notes ? `Teaching notes for this learner (follow them: level, examples, pace):\n${ctx.notes}\n` : ''}
Board at the start of this beat: ${onBoard}
${ctx.chapterStart && !first ? `This beat starts the chapter "${beat.chapter}" on a fresh board: the first step must be {"type":"clear"}, then write the chapter title (write, id "title", size lg, x 40, y 30).` : ''}
${!ctx.chapterStart && ids.length ? `You may highlight / transform / move / clear these ids: ${ids.join(', ')}.${axes.length ? ` Axes you can draw on ("on"): ${axes.join(', ')}.` : ''}${vars.length ? ` Variables already set: ${vars.join(', ')}.` : ''} Clear what you no longer need (clear with targets) before drawing in its place. New ids must not clash with these.` : ''}

${SCRIPT_SCHEMA_PROMPT}

${LAYOUT_RULES}
${SHOW_DONT_TELL}
Length: this beat plays for about ${beat.seconds} seconds. Its "say" lines together are about ${words} spoken words (15 to 35 words per narrated step, while the board moves). Use ${min} to ${max} steps. Real teaching only: no filler, no recap of earlier beats, no empty praise.
Return {"steps": [...]} only.`
  const known = ctx.chapterStart ? {} : { knownIds: ids, knownAxes: axes, knownVars: vars }
  // The opening beat is what the learner waits for: fast models first, short timeouts.
  const gen = { ...known, maxSteps: 40, timeoutMs: ctx.opening ? 25_000 : 40_000, primaryTimeoutMs: ctx.opening ? 20_000 : 30_000, meta: ctx.meta, played: ctx.chapterStart ? undefined : ctx.board, layoutRepair: false, deadline: ctx.deadline, preferFast: !!ctx.opening }
  const boardHasDiagram = !ctx.chapterStart && ctx.board.some(s => s.type === 'draw')
  let steps = await generateSteps(prompt, gen)
  const problem = beatProblem(steps, beat.kind, boardHasDiagram)
  const short = lengthReport(steps, beat.seconds / 60).ratio < 0.45
  if (problem || short) {
    // One repair pass with the reasons, counted; then the beat is rejected (the worker retries it fresh).
    const why = [problem, short ? `it plays only about ${Math.round(lengthReport(steps, 1).ms / 1000)} s of the ${beat.seconds} s it needs: add narrated demonstration steps (not filler)` : null].filter(Boolean).join('; ')
    let fixed: Step[]
    try {
      fixed = await generateSteps(`${prompt}

Your previous answer was rejected: ${why}. It had ${actionsOf(steps).length} actions.
Previous answer:
${JSON.stringify(steps).slice(0, 8000)}

Rewrite the beat so it is demonstrated visually (draw, then animate / move / transform while the narration says what is happening) and has about ${words} spoken words. Return {"steps": [...]} only.`, gen)
    } catch (err) {
      // A beat that only runs short is kept when the repair can't be written; a text-heavy one is not.
      if (!problem) return steps
      throw err
    }
    const p2 = beatProblem(fixed, beat.kind, boardHasDiagram)
    if (!p2 && (problem || lengthReport(fixed, 1).ms > lengthReport(steps, 1).ms)) steps = fixed
    else if (problem) throw new Error(`Beat tells more than it shows (${p2 ?? problem})`)
  }
  return steps
}

/** A compact description of what is on the board (ids, kinds and where), for the next beat's prompt. */
function summarizeBoard(steps: Step[], ids: string[]): string {
  const last = new Map<string, string>()
  const note = (s: Step | Record<string, unknown>) => {
    const t = s as Record<string, unknown>
    const id = typeof t.id === 'string' ? t.id : null
    if (!id || !ids.includes(id)) return
    if (t.type === 'write') last.set(id, `${id}: text "${String(t.text).slice(0, 40)}" at (${t.x}, ${t.y})`)
    else if (t.type === 'math') last.set(id, `${id}: math "${String(t.tex).slice(0, 40)}" at (${t.x}, ${t.y})`)
    else if (t.type === 'draw') {
      const sh = t.shape as Record<string, unknown>
      const where = sh.kind === 'axes' ? ` frame ${JSON.stringify(sh.frame)} x ${JSON.stringify(sh.xRange)} y ${JSON.stringify(sh.yRange)}` : t.on ? ` on ${t.on}` : ''
      last.set(id, `${id}: ${sh.kind}${where}`)
    }
  }
  for (const s of steps) {
    note(s)
    if ('cues' in s && Array.isArray(s.cues)) s.cues.forEach(c => note(c as Record<string, unknown>))
  }
  return [...last.values()].join('; ').slice(0, 1800) || 'nothing (fresh board)'
}

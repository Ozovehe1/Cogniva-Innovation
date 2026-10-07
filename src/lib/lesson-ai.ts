import { GeminiQuotaError, generateStructuredJson, generateText, lastGeminiModel, type GenerateOptions } from './gemini'
import { SCRIPT_SCHEMA_PROMPT, boardIdsAfter, validateScript, type CheckStep, type Step } from './lesson-schema'
import { autoFixLayout, layoutIssues } from './lesson-layout'
import { MANIM_API_SHEET, describeProblems, guardManimCode, hintsFor, tracebackOf } from './manim-guard'
import { buildBoard } from '@/components/whiteboard/board-state'
import { SECTION_MAX_STEPS, withSectionStart } from './lesson-sections'
import { intelligenceLabel } from '@/components/intelligence'

export interface StudentProfileLite {
  dominant_intelligence?: string | null
  intelligence_scores?: Record<string, number> | null
  study_tips?: string[] | null
  personality_insight?: string | null
}

export interface LessonLite {
  title: string
  subject: string
  objectives: string[]
}

const TUTOR_VOICE = `You are a patient, precise tutor who teaches on a whiteboard in the style of 3Blue1Brown: build intuition visually first, then formalise. Short spoken narration ("say", read aloud by a voice) of one or two sentences, plain language, no hype, no emoji. Global audience: no exam-board references.`

const LAYOUT_RULES = `Layout rules:
- Everything stays on the board until a clear step removes it. Keep a mental list of what is on the board and where.
- Use regions: title band y 24..80 (one line, size lg, under ~34 characters); diagram region x 24..440, y 100..476; notes column x 460..776, y 100..476 (size sm or md, maxWidth 300, about 55 units per line of sm text).
- Never place an element where another one still is. Stack notes downward; when the notes column is full, clear it (clear with the ids) before writing more. Text may sit inside a graph only as a short label.
- Use "say" on most steps: it is spoken aloud while the step is drawn and kept in the transcript. Speak like a tutor at the board, not a caption of it.
- Use transform to evolve an equation step by step instead of writing many separate lines.
- Use clear (with targets, or with no targets for a fresh board) before the board gets crowded.
- Prefer graphs (axes + function + point + line) for anything numeric or geometric.`

function profileSummary(p: StudentProfileLite | null | undefined) {
  if (!p) return 'No learner profile available; use a balanced mix of visuals and words.'
  const scores = p.intelligence_scores ?? {}
  const top = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 3)
  const lines = [
    p.dominant_intelligence ? `Strongest intelligence: ${intelligenceLabel(p.dominant_intelligence)}.` : '',
    top.length ? `Top scores (0-10): ${top.map(([k, v]) => `${intelligenceLabel(k)} ${v}`).join(', ')}.` : '',
    p.personality_insight ? `How they think: ${p.personality_insight}` : '',
  ].filter(Boolean)
  return lines.join(' ')
}

/** How to change the representation for a re-teach, given the learner's profile. */
function representationHint(p: StudentProfileLite | null | undefined) {
  const k = p?.dominant_intelligence ?? ''
  const map: Record<string, string> = {
    spatial: 'Lead with a picture: a diagram, graph or geometric construction, with very few words.',
    logicalMathematical: 'Lead with a short chain of reasoning or a numeric pattern (a small table of values that converges).',
    linguistic: 'Lead with a clear verbal analogy and precise definitions written on the board.',
    musical: 'Use rhythm and pattern: repeating structure, sequences, rates like tempo.',
    bodilyKinesthetic: 'Use physical motion: something moving, speeding up, a walk or a ramp, then map it to the maths.',
    interpersonal: 'Frame it as explaining to a friend, with a concrete everyday scenario involving people.',
    intrapersonal: 'Invite reflection: pose a question, let them predict, then reveal.',
    naturalist: 'Use an example from nature: growth, populations, slopes of terrain, classification.',
  }
  return map[k] ?? 'Switch representation: if the first explanation was symbolic, go visual; if visual, use a concrete numeric example.'
}

export interface GenMeta { ms: number; repaired: boolean; model: string | null; dropped: number; trace?: string[] }

async function generateSteps(
  prompt: string,
  opts: {
    knownIds?: string[]; knownAxes?: string[]; maxSteps: number; timeoutMs?: number; primaryTimeoutMs?: number; thinking?: GenerateOptions['thinking']; meta?: GenMeta
    /** Steps already on the board (live continuation); used for layout checks. */
    played?: Step[]
    /** Allow one extra model call to fix overlapping layout (drafts only; costs latency). */
    layoutRepair?: boolean
  },
): Promise<Step[]> {
  const t0 = Date.now()
  const meta = opts.meta ?? { ms: 0, repaired: false, model: null, dropped: 0 }
  const start = opts.played ? buildBoard(opts.played, opts.played.length) : undefined
  const offset = opts.played?.length ?? 0
  const done = (steps: Step[]) => {
    meta.ms = Date.now() - t0
    meta.model = lastGeminiModel
    // Last resort: clear whatever a new element would be drawn on top of.
    return autoFixLayout(steps, start, offset)
  }
  meta.trace = []
  const gen = { systemInstruction: TUTOR_VOICE, timeoutMs: opts.timeoutMs, primaryTimeoutMs: opts.primaryTimeoutMs, thinking: opts.thinking, trace: meta.trace }
  let raw: unknown
  try {
    raw = await generateStructuredJson(prompt, gen)
  } catch (err) {
    if (err instanceof GeminiQuotaError) throw err
    // Malformed JSON: fall through to repair with the error message.
    raw = { __error: err instanceof Error ? err.message : String(err) }
  }
  let result = validateScript(raw, { knownIds: opts.knownIds, knownAxes: opts.knownAxes, maxSteps: opts.maxSteps })
  if (result.ok) {
    const issues = opts.layoutRepair ? layoutIssues(result.steps, start, offset) : []
    if (issues.length === 0) return done(result.steps)
    // One layout repair pass.
    meta.repaired = true
    try {
      const fixedRaw = await generateStructuredJson(`${prompt}

Your previous answer was valid but elements collide on the board:
${issues.map(i => `- ${i}`).join('\n')}

Previous answer:
${JSON.stringify(result.steps).slice(0, 14000)}

Return the full corrected JSON object {"steps": [...]} with the same teaching content and no collisions.`, gen)
      const fixed = validateScript(fixedRaw, { knownIds: opts.knownIds, knownAxes: opts.knownAxes, maxSteps: opts.maxSteps })
      if (fixed.ok && layoutIssues(fixed.steps, start, offset).length < issues.length) return done(fixed.steps)
    } catch (err) {
      if (err instanceof GeminiQuotaError) return done(result.steps)
      console.warn('Layout repair failed:', err instanceof Error ? err.message : err)
    }
    return done(result.steps)
  }
  meta.repaired = true

  // One repair attempt: show the model its output and the validator errors.
  const repairPrompt = `${prompt}

Your previous answer did not match the schema. Errors:
${result.errors.slice(0, 25).map(e => `- ${e}`).join('\n')}

Previous answer:
${JSON.stringify(raw).slice(0, 12000)}

Return the corrected JSON object {"steps": [...]} only.`
  try {
    raw = await generateStructuredJson(repairPrompt, gen)
    result = validateScript(raw, { knownIds: opts.knownIds, knownAxes: opts.knownAxes, maxSteps: opts.maxSteps })
  } catch (err) {
    if (err instanceof GeminiQuotaError) throw err
    console.warn('Lesson repair failed:', err instanceof Error ? err.message : err)
  }
  if (result.ok) return done(result.steps)
  // Keep the valid steps only if nearly all of the answer survived; otherwise fail rather than ship a broken lesson.
  if (result.steps.length >= 3 && result.total - result.steps.length <= Math.max(1, Math.floor(result.total * 0.15))) {
    console.warn('Using partially valid steps; dropped errors:', result.errors.slice(0, 5))
    meta.dropped = result.errors.length
    return done(result.steps)
  }
  throw new Error(`AI returned an invalid lesson script (${result.errors.slice(0, 3).join('; ')})`)
}

/** Drafts a complete lesson script for a tutor to review. */
export async function draftLessonScript(lesson: LessonLite, notes?: string): Promise<Step[]> {
  const prompt = `Write a complete whiteboard lesson.
Title: ${lesson.title}
Subject: ${lesson.subject}
Objectives:
${lesson.objectives.map(o => `- ${o}`).join('\n')}
${notes ? `Tutor notes: ${notes}\n` : ''}
${SCRIPT_SCHEMA_PROMPT}

${LAYOUT_RULES}
- 20 to 45 steps. Open with the title (write, size lg, x 40, y 30).
- After each main idea, add a check: kind "understand" with a short "reteach" array (3-6 steps showing the idea a different way, built on what is on the board), and at least one "choice" or "short" question with "explanation" and a "reteach".
- End with a one-line summary written on the board.
Return {"steps": [...]} only.`
  return generateSteps(prompt, { maxSteps: 60, timeoutMs: 55_000, layoutRepair: true })
}

/* ───────────── Long lessons: outline, then one section per call ───────────── */

export interface OutlineSection { title: string; goal: string; minutes: number; keyPoints: string[] }

/** Roughly how many steps fill a minute of lesson (narrated steps run ~8-12 s each). */
export const STEPS_PER_MINUTE = 5.5

export function sectionStepTarget(minutes: number) {
  const n = Math.round(minutes * STEPS_PER_MINUTE)
  return { min: Math.max(8, Math.round(n * 0.75)), max: Math.min(SECTION_MAX_STEPS - 4, Math.max(14, Math.round(n * 1.15))) }
}

/** How many sections a lesson of `minutes` should have (sections of about 6-10 minutes). */
export function sectionCountFor(minutes: number) {
  if (minutes <= 12) return Math.max(1, Math.round(minutes / 6))
  return Math.min(16, Math.max(2, Math.round(minutes / 7.5)))
}

const mockMode = () => process.env.LESSON_AI_MOCK === '1' && process.env.VERCEL_ENV !== 'production'
let mockQuotaThrown = false

function cleanOutline(raw: unknown, targetMinutes: number, count: number): OutlineSection[] {
  const arr = raw && typeof raw === 'object' && Array.isArray((raw as { sections?: unknown }).sections) ? (raw as { sections: unknown[] }).sections : Array.isArray(raw) ? raw : []
  const out: OutlineSection[] = []
  for (const r of arr.slice(0, 20)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.trim().slice(0, 120) : ''
    if (!title) continue
    const kp = Array.isArray(o.keyPoints) ? o.keyPoints : Array.isArray(o.key_points) ? o.key_points : []
    out.push({
      title,
      goal: typeof o.goal === 'string' ? o.goal.trim().slice(0, 400) : '',
      minutes: typeof o.minutes === 'number' && o.minutes > 0 ? o.minutes : targetMinutes / count,
      keyPoints: kp.filter((k): k is string => typeof k === 'string' && !!k.trim()).map(k => k.trim().slice(0, 200)).slice(0, 8),
    })
  }
  if (out.length === 0) throw new Error('AI returned an empty outline')
  // Scale minutes so the sections add up to the target, each 3..15 minutes.
  const sum = out.reduce((a, b) => a + b.minutes, 0) || 1
  for (const o of out) o.minutes = Math.round(Math.min(15, Math.max(3, (o.minutes / sum) * targetMinutes)) * 10) / 10
  return out
}

/** Plans the sections of a lesson sized to the tutor's target length. One small model call. */
export async function draftLessonOutline(lesson: LessonLite, targetMinutes: number, notes?: string): Promise<OutlineSection[]> {
  const count = sectionCountFor(targetMinutes)
  if (mockMode()) {
    return Array.from({ length: count }, (_, i) => ({
      title: i === 0 ? `Getting started: ${lesson.title}`.slice(0, 80) : `Part ${i + 1}: ${lesson.objectives[i % lesson.objectives.length] ?? 'Practice'}`.slice(0, 80),
      goal: `Section ${i + 1} goal`,
      minutes: Math.round((targetMinutes / count) * 10) / 10,
      keyPoints: ['First idea', 'Second idea', 'Worked example'],
    }))
  }
  const prompt = `Plan a whiteboard lesson of about ${targetMinutes} minutes as an ordered list of sections.
Title: ${lesson.title}
Subject: ${lesson.subject}
Objectives:
${lesson.objectives.map(o => `- ${o}`).join('\n')}
${notes ? `Tutor notes: ${notes}\n` : ''}
Rules:
- About ${count} sections (between ${Math.max(1, count - 2)} and ${count + 2}); each section is one coherent idea taught in about 5 to 10 minutes, and the minutes add up to about ${targetMinutes}.
- Build from intuition to formal understanding to practice; the last section consolidates and reviews.
- Every objective is covered by at least one section.
- Each section has: "title" (under 60 characters, no numbering), "goal" (one sentence: what the student can do after it), "minutes" (number), "keyPoints" (3 to 6 short phrases, in teaching order).
Return {"sections": [...]} only.`
  const raw = await generateStructuredJson(prompt, { systemInstruction: TUTOR_VOICE, timeoutMs: 60_000, primaryTimeoutMs: 45_000 })
  return cleanOutline(raw, targetMinutes, count)
}

function mockSectionSteps(section: OutlineSection, position: number, total: number): Step[] {
  const steps: Step[] = []
  if (position > 0) steps.push({ type: 'clear' })
  steps.push({ type: 'write', id: 'title', text: section.title.slice(0, 34), x: 40, y: 30, size: 'lg', say: `Section ${position + 1} of ${total}: ${section.title}.` })
  const n = Math.max(6, Math.round(section.minutes * STEPS_PER_MINUTE) - 4)
  let y = 110
  for (let i = 0; i < n; i++) {
    if (y > 430) { steps.push({ type: 'clear', targets: Array.from({ length: 6 }, (_, k) => `n${i - 6 + k}`).filter(id => steps.some(s => 'id' in s && s.id === id)) }); y = 110 }
    steps.push({ type: 'write', id: `n${i}`, text: `Point ${i + 1} of section ${position + 1}`, x: 470, y, size: 'sm', font: 'sans', maxWidth: 300, say: `This is point ${i + 1} of section ${position + 1}, about ${section.keyPoints[i % section.keyPoints.length] ?? 'the idea'}.` })
    y += 52
    if (i === Math.floor(n / 2)) steps.push({ type: 'check', id: `c${position}`, kind: 'choice', prompt: `Section ${position + 1} check: which number is ${position + 1}?`, options: [`${position + 1}`, `${position + 2}`], answer: 0, explanation: 'Right.' })
  }
  steps.push({ type: 'draw', id: 'circ', shape: { kind: 'circle', center: [220, 290], r: 60 + position * 5 }, color: 'accent', say: `A circle for section ${position + 1}.` })
  return steps
}

/**
 * Drafts one section of a long lesson on a fresh board. The section starts with a
 * clear (unless it is the first) and its own title, so it never depends on what an
 * earlier section left on the board.
 */
export async function draftLessonSection(input: {
  lesson: LessonLite
  outline: OutlineSection[]
  position: number
  notes?: string
  meta?: GenMeta
}): Promise<Step[]> {
  const { lesson, outline, position } = input
  const section = outline[position]
  if (mockMode()) {
    const at = Number(process.env.LESSON_AI_MOCK_QUOTA_AT ?? -1)
    if (at === position && !mockQuotaThrown) { mockQuotaThrown = true; throw new GeminiQuotaError('Mock quota reached', 60_000, true) }
    await new Promise(r => setTimeout(r, 1500))
    return mockSectionSteps(section, position, outline.length)
  }
  const { min, max } = sectionStepTarget(section.minutes)
  const prev = outline[position - 1]
  const next = outline[position + 1]
  const prompt = `Write ONE section of a longer whiteboard lesson.
Lesson: ${lesson.title} (${lesson.subject})
Lesson objectives: ${lesson.objectives.join('; ')}
Full plan (this is section ${position + 1} of ${outline.length}):
${outline.map((o, i) => `${i + 1}. ${o.title}${i === position ? '   <-- THIS SECTION' : ''}`).join('\n')}

This section: "${section.title}" (about ${section.minutes} minutes)
Goal: ${section.goal}
Key points, in order: ${section.keyPoints.join('; ')}
${prev ? `The previous section ("${prev.title}") covered: ${prev.keyPoints.join('; ')}. Do not re-teach it; a one-line recap is fine.` : 'This is the opening section: hook the student with why the topic matters.'}
${next ? `The next section will cover "${next.title}", so do not start it here.` : 'This is the final section: consolidate the whole lesson and end with a one-line summary on the board.'}
${input.notes ? `Tutor notes for this section: ${input.notes}\n` : ''}
${SCRIPT_SCHEMA_PROMPT}

${LAYOUT_RULES}
- The board is EMPTY when this section starts. ${position > 0 ? 'The first step must be {"type":"clear"}. ' : ''}Then write the section title (write, id "title", size lg, x 40, y 30) with a "say" that introduces the section.
- Only refer to ids created in this section.
- ${min} to ${max} steps.
- After each main idea, add a check: kind "understand" with a short "reteach" array (3-6 steps showing the idea a different way, built on what is on the board), and at least one "choice" or "short" question with "explanation" and a "reteach".
Return {"steps": [...]} only.`
  const steps = await generateSteps(prompt, { maxSteps: SECTION_MAX_STEPS, timeoutMs: 120_000, primaryTimeoutMs: 100_000, meta: input.meta })
  return withSectionStart(steps, position)
}

export type TutorReason = 'explain_differently' | 'wrong_answer' | 'continue'

/** Next steps for a live session: re-teach after "explain differently" or a wrong answer. */
export async function nextTutorSteps(input: {
  lesson: LessonLite
  played: Step[]
  reason: TutorReason
  check?: CheckStep
  answer?: string
  profile?: StudentProfileLite | null
  history?: { reason: string; answer?: string }[]
  meta?: GenMeta
}): Promise<Step[]> {
  const { ids, axes } = boardIdsAfter(input.played)
  // Keep the prompt small: the last ~25 steps carry the visible board.
  const recent = input.played.slice(-25)
  const attempts = (input.history ?? []).filter(h => h.reason !== 'continue').length
  const situation =
    input.reason === 'wrong_answer'
      ? `The student answered the question "${input.check?.prompt}" with "${input.answer ?? ''}", which is wrong${
          input.check?.kind === 'choice' && input.check.options && input.check.answer !== undefined
            ? ` (correct: "${input.check.options[input.check.answer]}")`
            : ''
        }. Diagnose the likely misconception in one "say" line, then re-teach the specific idea.`
      : input.reason === 'explain_differently'
        ? `The student asked for a different explanation at the check "${input.check?.prompt ?? ''}". Do not repeat the previous explanation.`
        : 'Continue the lesson with the next idea.'

  const prompt = `Live tutoring session.
Lesson: ${input.lesson.title} (${input.lesson.subject})
Objectives: ${input.lesson.objectives.join('; ')}
Learner: ${profileSummary(input.profile)}
Representation to use now: ${representationHint(input.profile)}${attempts >= 2 ? ' This is a repeated request: go simpler and more concrete than before.' : ''}

Recent board script (JSON):
${JSON.stringify(recent).slice(0, 9000)}

Elements currently on the board (ids you may highlight/transform/clear): ${ids.join(', ') || 'none'}
Axes on the board (ids usable in "on"): ${axes.join(', ') || 'none'}

Situation: ${situation}

${SCRIPT_SCHEMA_PROMPT}

${LAYOUT_RULES}
- Return 4 to 9 steps; keep it brisk. You may clear part of the board first. New ids must not clash with existing ones unless you clear them first.
- End with a check (kind "understand", or a short "choice" question) so the student can confirm. Do not add "reteach" to it.
Return {"steps": [...]} only.`
  return generateSteps(prompt, { knownIds: ids, knownAxes: axes, maxSteps: 14, timeoutMs: 20_000, primaryTimeoutMs: 12_000, thinking: 'minimal', meta: input.meta, played: input.played })
}

/* ───────────── Manim ───────────── */

export const MANIM_SCENE_NAME = 'GeneratedScene'

const MANIM_RULES = `Rules for the code:
- Manim Community Edition v0.19 only (NOT ManimGL, NOT old 0.x tutorials). First line \`from manim import *\`. Exactly one class named ${MANIM_SCENE_NAME}(Scene) (or MovingCameraScene / ThreeDScene subclass, still named ${MANIM_SCENE_NAME}).
- Total runtime 5 to 40 seconds. 16:9 frame. Light background: set self.camera.background_color = "#FDFCF9" and use dark colours: "#14141A" (ink), "#1F4D3A" (green accent), "#A4502A" (clay), "#23406A" (navy).
- Use MathTex/Tex for maths (LaTeX is installed), Text for plain words with font size >= 28.
- No file, network, subprocess or OS access; no imports other than manim, numpy and math. No external assets.
- Keep it clean and deliberate: few elements, smooth transforms (Transform, ReplacementTransform, TransformMatchingTex, Create, Write, FadeIn), short waits.

${MANIM_API_SHEET}

Return ONLY the Python source, no markdown fences, no explanation.`

function stripFences(code: string) {
  return code.trim().replace(/^```(?:python|py)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
}

const FORBIDDEN = /\b(import\s+(os|sys|subprocess|socket|shutil|requests|urllib|http|pathlib)|from\s+(os|sys|subprocess|socket|shutil|requests|urllib|http|pathlib)\b|__import__|open\s*\(|eval\s*\(|exec\s*\()/

/** Security and shape checks before sending code to the render sandbox. */
export function checkManimCode(code: string): string | null {
  if (!new RegExp(`class\\s+${MANIM_SCENE_NAME}\\s*\\(`).test(code)) return `The scene class must be named ${MANIM_SCENE_NAME}.`
  if (FORBIDDEN.test(code)) return 'The code uses a disallowed module or builtin (file, OS or network access).'
  if (code.length > 20_000) return 'The code is too long.'
  return null
}

/**
 * Full pre-render check: safe deprecated-API renames are applied, then security,
 * shape and Manim v0.19 API problems are reported. Returns the (possibly rewritten) code.
 */
export function vetManimCode(raw: string): { code: string; rewrites: string[]; error: string | null } {
  const g = guardManimCode(stripFences(raw))
  const basic = checkManimCode(g.code)
  const error = basic ?? (g.problems.length ? describeProblems(g.problems) : null)
  return { code: g.code, rewrites: g.rewrites, error }
}

export async function generateManimCode(description: string, context?: { lessonTitle?: string; subject?: string }): Promise<string> {
  const prompt = `Write a Manim animation for a lesson${context?.lessonTitle ? ` titled "${context.lessonTitle}"` : ''}${context?.subject ? ` (${context.subject})` : ''}.
The tutor describes it as:
"""${description.slice(0, 2000)}"""

${MANIM_RULES}`
  const first = vetManimCode(await generateText(prompt, { timeoutMs: 40_000 }))
  if (!first.error) return first.code
  const second = vetManimCode(await generateText(`${prompt}\n\nYour previous code was rejected before rendering:\n${first.error}\nPrevious code:\n${first.code.slice(0, 15000)}`, { timeoutMs: 40_000 }))
  if (second.error) throw new Error(second.error)
  return second.code
}

/**
 * Asks Gemini to fix code that failed to render (or failed the static check).
 * `error` is the render log or the static-check message. At most two Gemini passes.
 */
export async function fixManimCode(code: string, error: string, description: string): Promise<string> {
  const hints = hintsFor(error)
  const prompt = `This Manim Community v0.19 scene failed${/Static check/.test(error) ? ' the pre-render check' : ' to render'}.
Original request: """${description.slice(0, 1500)}"""

Traceback / error:
${tracebackOf(error)}
${hints.length ? `\nWhat it means:\n- ${hints.join('\n- ')}\n` : ''}
Code:
${code.slice(0, 15000)}

Fix the error, and also replace any other call in the code that is not valid Manim Community v0.19 (check every line against the API sheet below; the next render must not fail on a different old-API call). Keep the intent and the visual design.
${MANIM_RULES}`
  const first = vetManimCode(await generateText(prompt, { timeoutMs: 40_000 }))
  if (!first.error) return first.code
  const second = vetManimCode(await generateText(`${prompt}\n\nYour fixed code was rejected before rendering:\n${first.error}\nRejected code:\n${first.code.slice(0, 15000)}`, { timeoutMs: 40_000 }))
  if (second.error) throw new Error(second.error)
  return second.code
}

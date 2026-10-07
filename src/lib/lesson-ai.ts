import { generateStructuredJson, generateText, lastGeminiModel, type GenerateOptions } from './gemini'
import { SCRIPT_SCHEMA_PROMPT, boardIdsAfter, validateScript, type CheckStep, type Step } from './lesson-schema'
import { autoFixLayout, layoutIssues } from './lesson-layout'
import { buildBoard } from '@/components/whiteboard/board-state'
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

const TUTOR_VOICE = `You are a patient, precise tutor who teaches on a whiteboard in the style of 3Blue1Brown: build intuition visually first, then formalise. Short spoken lines ("say") of one or two sentences, plain language, no hype, no emoji. Global audience: no exam-board references.`

const LAYOUT_RULES = `Layout rules:
- Everything stays on the board until a clear step removes it. Keep a mental list of what is on the board and where.
- Use regions: title band y 24..80 (one line, size lg, under ~34 characters); diagram region x 24..440, y 100..476; notes column x 460..776, y 100..476 (size sm or md, maxWidth 300, about 55 units per line of sm text).
- Never place an element where another one still is. Stack notes downward; when the notes column is full, clear it (clear with the ids) before writing more. Text may sit inside a graph only as a short label.
- Use "say" on most steps; that is what the student reads while it is drawn.
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
    console.warn('Lesson repair failed:', err instanceof Error ? err.message : err)
  }
  if (result.ok) return done(result.steps)
  // Keep the valid steps if most of the answer survived; otherwise fail.
  if (result.steps.length >= 3) {
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
- Manim Community Edition v0.19 (from manim import *). One class named ${MANIM_SCENE_NAME}(Scene) (or MovingCameraScene / ThreeDScene subclass, still named ${MANIM_SCENE_NAME}).
- Total runtime 5 to 40 seconds. 16:9 frame. Light background: set self.camera.background_color = "#FDFCF9" and use dark colours: "#14141A" (ink), "#1F4D3A" (green accent), "#A4502A" (clay), "#23406A" (navy).
- Use MathTex/Tex for maths (LaTeX is installed), Text for plain words with font size >= 28.
- No file, network, subprocess or OS access; no imports other than manim, numpy and math. No external assets.
- Keep it clean and deliberate: few elements, smooth transforms (Transform, ReplacementTransform, TransformMatchingTex, Create, Write, FadeIn), short waits.
Return ONLY the Python source, no markdown fences, no explanation.`

function stripFences(code: string) {
  return code.trim().replace(/^```(?:python|py)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
}

const FORBIDDEN = /\b(import\s+(os|sys|subprocess|socket|shutil|requests|urllib|http|pathlib)|from\s+(os|sys|subprocess|socket|shutil|requests|urllib|http|pathlib)\b|__import__|open\s*\(|eval\s*\(|exec\s*\()/

/** Light static checks before sending code to the render sandbox. */
export function checkManimCode(code: string): string | null {
  if (!new RegExp(`class\\s+${MANIM_SCENE_NAME}\\s*\\(`).test(code)) return `The scene class must be named ${MANIM_SCENE_NAME}.`
  if (FORBIDDEN.test(code)) return 'The code uses a disallowed module or builtin (file, OS or network access).'
  if (code.length > 20_000) return 'The code is too long.'
  return null
}

export async function generateManimCode(description: string, context?: { lessonTitle?: string; subject?: string }): Promise<string> {
  const prompt = `Write a Manim animation for a lesson${context?.lessonTitle ? ` titled "${context.lessonTitle}"` : ''}${context?.subject ? ` (${context.subject})` : ''}.
The tutor describes it as:
"""${description.slice(0, 2000)}"""

${MANIM_RULES}`
  const code = stripFences(await generateText(prompt, { timeoutMs: 40_000 }))
  const problem = checkManimCode(code)
  if (!problem) return code
  const fixed = stripFences(await generateText(`${prompt}\n\nYour previous code was rejected: ${problem}\nPrevious code:\n${code.slice(0, 15000)}`, { timeoutMs: 40_000 }))
  const again = checkManimCode(fixed)
  if (again) throw new Error(again)
  return fixed
}

export async function fixManimCode(code: string, error: string, description: string): Promise<string> {
  const prompt = `This Manim Community v0.19 scene failed to render.
Original request: """${description.slice(0, 1500)}"""

Error (tail of the log):
${error.slice(-4000)}

Code:
${code.slice(0, 15000)}

Fix the error with the smallest change that keeps the intent. ${MANIM_RULES}`
  const fixed = stripFences(await generateText(prompt, { timeoutMs: 40_000 }))
  const problem = checkManimCode(fixed)
  if (problem) throw new Error(problem)
  return fixed
}

/**
 * Lesson beats from verified worked examples: an "example" or "your_turn" beat whose subject has a solver/renderer
 * (circuits, projectiles, slopes, graphs/calculus, reactions, Punnett squares) is built from a checked spec instead of
 * free model text: the exact diagram as a board figure that changes with each step, one line of maths per step (the
 * numbers come from the engine), and for your_turn a typed-answer check before the solution is shown.
 */
import type { Step } from '../lesson-schema'
import { validateScript } from '../lesson-schema'
import { buildWorkedExample, type Built } from './build'
import { statementText, texForms } from './engine'
import { pluginFor, likelyPlugins } from './registry'
import { fill, fmtNum } from './spec'

/** Is this beat a worked-example beat with a real solver behind it? */
export function exampleDomain(text: string) {
  return likelyPlugins(text).find(p => p.type !== 'board' && p.type !== 'illustration') ?? null
}

const tidy = (s: string, n = 220) => s.replace(/\s+/g, ' ').trim().slice(0, n)

export async function exampleBeatSteps(input: { lessonTitle: string; beatTitle: string; points: string[]; kind: 'example' | 'your_turn'; level?: string; deadline?: number; trace?: string[] }): Promise<Step[] | null> {
  const text = `${input.lessonTitle}. ${input.beatTitle}. ${input.points.join('; ')}`
  if (!exampleDomain(text)) return null
  const r = await buildWorkedExample({ request: `${input.kind === 'your_turn' ? 'A problem for the learner to try' : 'A worked example'} for the lesson "${input.lessonTitle}": ${input.beatTitle}. ${input.points.join('; ')}`, level: input.level, trace: input.trace, deadline: input.deadline })
  if (!r.ok) return null
  return stepsFromExample(r.built, input)
}

/** Board steps for a verified example (pure; exported for tests). */
export function stepsFromExample(built: Built, input: { beatTitle: string; kind: 'example' | 'your_turn'; trace?: string[] }): Step[] | null {
  const { spec, ev } = built
  const plugin = pluginFor(spec.diagram?.type)
  const tag = Math.random().toString(36).slice(2, 6)
  const steps: Record<string, unknown>[] = []
  const fig = (i: number) => {
    if (!plugin || !spec.diagram) return null
    try { return plugin.render(spec.diagram, ev.scope, { step: i, action: i >= 0 ? spec.steps[i]?.diagram : undefined, answers: true, static: true }, spec) || null } catch { return null }
  }
  steps.push({ type: 'clear' })
  steps.push({ type: 'write', id: `we${tag}_t`, text: tidy(input.kind === 'your_turn' ? `Your turn: ${input.beatTitle}` : input.beatTitle, 60), x: 40, y: 30, size: 'lg' })
  const problem = statementText(spec, ev.scope)
  let figId: string | null = null
  const svg0 = fig(-1)
  const hasFig = !!svg0 && svg0.length < 58_000
  const box = hasFig ? { x: 20, y: 70, w: 400, h: 300 } : null
  if (hasFig) { figId = `we${tag}_f0`; steps.push({ type: 'draw', id: figId, say: tidy(problem, 400), shape: { kind: 'figure', ...box, svg: svg0, alt: `Diagram for: ${tidy(problem, 200)}` } }) }
  else steps.push({ type: 'write', id: `we${tag}_p`, text: tidy(problem, 200), x: 40, y: 80, maxWidth: 720, say: tidy(problem, 400) })
  const unit = spec.answer.unit ?? ''
  const ansText = ev.answer !== null ? `${fmtNum(ev.answer)}${unit ? ` ${unit}` : ''}` : spec.answer.text ?? ''
  if (input.kind === 'your_turn' && ev.answer !== null) {
    const v = fmtNum(ev.answer)
    steps.push({ type: 'check', kind: 'short', prompt: `Your turn: ${tidy(problem, 300)} Type the ${spec.answer.label ?? 'answer'}${unit ? ` in ${unit}` : ''}.`, accept: [...new Set([v, `${v} ${unit}`.trim(), `${v}${unit}`, ev.answer.toFixed(2), ev.answer.toFixed(1)])].slice(0, 6), explanation: `The ${spec.answer.label ?? 'answer'} is ${ansText}. Here is how.`, say: 'Try it yourself first, then I will show you the working.' })
  }
  // up to 5 steps: the start, the steps that lead to the answer, and one check after it
  const ai = spec.steps.findIndex(s => s.calc?.name === spec.answer.name)
  const last = ai >= 0 ? ai : spec.steps.length - 1
  let pick = spec.steps.map((_, i) => i).filter(i => i <= last)
  if (pick.length > 4) pick = [pick[0], pick[1], ...pick.slice(-2)]
  const after = spec.steps.findIndex((s, i) => i > last && s.check)
  if (after >= 0) pick.push(after)
  const x = hasFig ? 440 : 60
  pick.forEach((i, k) => {
    const s = spec.steps[i]
    const svg = s.diagram && hasFig ? fig(i) : null
    if (svg && svg.length < 58_000 && figId) {
      const id = `we${tag}_f${k + 1}`
      steps.push({ type: 'clear', targets: [figId] })
      steps.push({ type: 'draw', id, shape: { kind: 'figure', ...box, svg, alt: `Diagram, step ${k + 1}` } })
      figId = id
    }
    let tex = s.claim
    if (s.calc) {
      const v = ev.values[i]
      const forms = (() => { try { return texForms(s.calc!.expr, ev.scope) } catch { return null } })()
      const subst = forms && forms.substituted.length < 40 ? ` = ${forms.substituted}` : ''
      if (v !== null) tex = `${s.claim}${subst} = ${fmtNum(v)}${s.calc.unit ? `\\,\\mathrm{${s.calc.unit.replace(/\s+/g, '\\,').replace(/Ω/g, '\\Omega').replace(/²/g, '^2').replace(/°/g, '^\\circ')}}` : ''}`
    }
    steps.push({ type: 'math', id: `we${tag}_m${k}`, tex, x, y: 90 + k * 72, size: 'md', color: s.check ? 'accent' : 'ink', say: tidy(`${s.title ? `${s.title}. ` : ''}${fill(s.reason, ev.scope)}`, 300) })
  })
  steps.push({ type: 'highlight', target: `we${tag}_m${pick.length - 1}`, say: tidy(`So the ${spec.answer.label ?? 'answer'} is ${ansText}.`, 200) })
  const v = validateScript(steps, { maxSteps: 40 })
  if (!v.ok) { input.trace?.push(`worked-example beat rejected: ${v.errors.slice(0, 3).join('; ')}`); return null }
  return v.steps
}

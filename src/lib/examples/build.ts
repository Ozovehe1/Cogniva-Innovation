/**
 * Server: the model writes a worked-example spec for any topic; code verifies it and sends the problems back for repair
 * (at most 2 rounds). Only a spec that passes every check is ever shown. Practice variants are built from it with
 * their answers kept on the server.
 */
import { chatJson } from '../agent/llm'
import { parseSpec, fill, fmtNum, type ExampleSpec } from './spec'
import { finalizeSpec, makeVariants, evaluateSpec, answerOptions, statementText, type Evaluated } from './engine'
import { PLUGINS, likelyPlugins, pluginFor } from './registry'

const SHAPE = `{
 "topic": string, "level": string,
 "statement": the problem as the learner reads it; EVERY given appears as {{name}} (never the bare number),
 "givens": [{"name": identifier, "value": number in SI (degrees for angles), "unit": "m/s", "label": "launch speed", "vary"?: {"min","max","step"} giving sensible practice values}],
 "unknowns": [{"name", "unit", "label"}],
 "steps": [ 2-8 steps in teaching order, each {"title": under 40 chars, "claim": LaTeX of the rule/equation in SYMBOLS (no numbers), "reason": one plain sentence why (write values as {{name}}), "calc"?: {"name": new identifier, "expr": mathjs expression over givens/earlier calc names/diagram facts, "unit", "value": what you expect it to be}, "check"?: {"kind":"derivative","f","var","df"} | {"kind":"identity","lhs","rhs"} | {"kind":"zero","expr"}, "diagram"?: action for this step} ],
 "answer": {"name": the calc (or fact) holding the final answer, "unit", "label"} (or {"text": ...} for a balancing answer),
 "diagram": one of the types below,
 "predict": {"question": a one-tap prediction BEFORE the working (qualitative is best: "Will the range go up or down if…"), "options": [2-4 short], "answer": index},
 "mistakes": [{"expr": mathjs expression a learner with a common misconception would compute, "why": "forgot to …"}] (2-3)
}`

const RULES = `Rules:
- Numbers come from code: claims use symbols, reasons use {{name}}; every number in the statement is a {{given}}.
- Every numeric step has a calc whose expr really computes it (mathjs: * for multiply, ^ power, sqrt, sind/cosd/tand for degrees, pi). Every symbolic step (differentiating, rearranging) has a check.
- The answer must follow from the givens through the calcs. Pick values that give tidy numbers at the learner's level.
- Names: plain identifiers (u, theta, x1, nH2O), never reuse a name, never a function name.
- Inside calc/check expressions use names, never the numbers they stand for (so the learner can change the givens).
- "identity" checks are for two forms of the SAME expression (expanding, rearranging). A defining equation (A = L*W) is not a check: put it in the claim.
- Calculus (gradients, stationary points, optimisation): diagram "graph" whose f is written in x and givens; a "derivative" check over x; the critical x is a calc from the givens, with a "zero" check of f'(x) there; points mark it ("max"/"min").
- Use the diagram type that shows the idea; "board" only when no picture helps.`

export function generatorPrompt(request: string, level: string) {
  const first = likelyPlugins(request)
  const ordered = [...first, ...PLUGINS.filter(p => !first.includes(p))]
  return `Write ONE worked example for a learner (${level || 'secondary school'}) for this request:
"${request.slice(0, 500)}"

Return JSON:
${SHAPE}

Diagram types (code draws them and solves them independently):
${ordered.map(p => `- ${p.prompt}`).join('\n')}

${RULES}`
}

export interface Built { spec: ExampleSpec; ev: Evaluated; rounds: number }

export async function buildWorkedExample(input: { request: string; level?: string; spec?: unknown; trace?: string[]; deadline?: number }): Promise<{ ok: true; built: Built } | { ok: false; issues: string[] }> {
  const prompt = generatorPrompt(input.request, input.level ?? '')
  let raw: unknown = input.spec ?? null
  let issues: string[] = []
  let lastText = ''
  for (let round = 0; round < 3; round++) {
    if (input.deadline && Date.now() > input.deadline) break
    if (!raw || round > 0) {
      const repair = round > 0 ? `\n\nYour previous spec:\n${lastText.slice(0, 5000)}\n\nCode checked it and found these problems. Fix every one and return the whole corrected JSON:\n${issues.map(i => `- ${i}`).join('\n')}` : ''
      try {
        raw = await chatJson(prompt + repair, { maxTokens: 3500, trace: input.trace, deadline: input.deadline })
      } catch (e) { issues = [e instanceof Error ? e.message : String(e)]; continue }
    }
    lastText = JSON.stringify(raw)
    const p = parseSpec(raw)
    if (!p.spec) { issues = p.errors; raw = null; continue }
    const f = finalizeSpec(p.spec)
    issues = [...p.errors, ...f.issues]
    input.trace?.push(`worked_example round ${round + 1}: ${issues.length ? issues.slice(0, 4).join(' | ') : 'verified'}`)
    if (!issues.length) return { ok: true, built: { spec: f.spec, ev: f.ev, rounds: round + 1 } }
    raw = null
  }
  return { ok: false, issues }
}

/** Your-turn variants: same problem, new numbers; answers stay on the server. */
export function practiceItems(spec: ExampleSpec, n = 2) {
  if (!spec.answer.name) return []
  const plugin = pluginFor(spec.diagram?.type)
  const unit = spec.answer.unit ?? ''
  return makeVariants(spec, n).map(v => {
    const ev = evaluateSpec(spec, v.overrides)
    const ask = spec.answer.label ? ` Find the ${spec.answer.label.replace(/^the\s+/i, '')}${unit ? ` (in ${unit})` : ''}.` : ''
    const q = statementText(spec, ev.scope).replace(/\s*$/, '') + (/[?]\s*$/.test(spec.statement) ? '' : ask)
    let svg: string | undefined
    try { svg = plugin && spec.diagram ? plugin.render(spec.diagram, ev.scope, { step: -1, answers: false, static: true }, spec) || undefined : undefined } catch { svg = undefined }
    const mistakes = answerOptions(spec, ev).filter(o => !o.correct && o.value !== null).map(o => ({ value: o.value as number, why: o.why ?? '' }))
    const exact = Math.abs(v.answer * 100 - Math.round(v.answer * 100)) < 1e-7
    return {
      q, svg, unit,
      numeric: { value: v.answer, unit, tol: exact ? 0.005 : 0.015, mistakes },
      answerText: `${fmtNum(v.answer)}${unit ? ` ${unit}` : ''}`,
      hint: spec.steps.find(s => s.calc)?.reason ? `Start like the example: ${fill(spec.steps.find(s => s.calc)!.reason, ev.scope)}` : 'Follow the same steps as the example with the new numbers.',
      explain: spec.steps.filter(s => s.calc).slice(-2).map(s => `${s.calc!.name} = ${fmtNum(ev.scope[s.calc!.name])}${s.calc!.unit ? ` ${s.calc!.unit}` : ''}`).join(', '),
    }
  })
}

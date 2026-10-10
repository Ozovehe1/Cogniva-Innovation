/**
 * The agent tool `worked_example`: the model asks for an example in words (or writes the spec itself); code writes or
 * repairs the spec, verifies every step, and shows the interactive worked example (predict → reveal steps → change the
 * numbers → your turn with typed answers). Your-turn answers stay on the server (agent_actions, practice.ts).
 */
import { randomUUID } from 'node:crypto'
import type { AgentCtx, ToolSpec } from '../agent/tools'
import { logAction } from '../agent/actions'
import { buildWorkedExample, practiceItems } from './build'
import { statementText } from './engine'
import { fmtNum } from './spec'

const s = (v: unknown, n = 400) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

export const workedExampleTool: ToolSpec = {
  def: {
    name: 'worked_example',
    description: 'Show a VERIFIED worked example with a real, exact diagram for ANY problem with an answer: circuits (series/parallel resistors), projectiles and kinematics, forces on a slope, derivatives and optimisation, graphs, stoichiometry and balancing equations, Punnett squares and genetics ratios, algebra and percentages. Code checks every step and draws the diagram from the numbers; the learner first predicts, then reveals the steps one at a time, can change the numbers and watch everything update, then tries a new-numbers "your turn" with typed answers. Use it whenever the learner asks for an example, a problem to practise, or how to solve/calculate something. Give the request in the learner\'s words with any numbers they gave.',
    parameters: { type: 'object', properties: { request: { type: 'string', description: 'what to work through, e.g. "a circuit with a 9 V battery and three resistors, find each current"' }, level: { type: 'string', description: 'the learner\'s level if known' } }, required: ['request'], additionalProperties: false },
  },
  tier: 'visual', modes: ['chat'], label: 'Working out a checked example',
  run: async (a, ctx: AgentCtx) => {
    const request = s(a.request, 500)
    if (!request) return { error: 'request is required' }
    const r = await buildWorkedExample({ request, level: s(a.level, 80) || undefined, trace: ctx.trace, deadline: Date.now() + 80_000 })
    if (!r.ok) return { error: `Could not build a verified example (${r.issues.slice(0, 3).join('; ')}). Teach it with draw_on_board instead, and use compute for every number.` }
    const { spec, ev } = r.built
    // a structure picture: resolve the credited library drawing now (the client only gets its URL)
    if (spec.diagram?.type === 'illustration') {
      try {
        const { findIllustration } = await import('../illustrations/find')
        const f = await findIllustration({ topic: String(spec.diagram.query ?? spec.topic) }, ctx.admin, ctx.trace)
        if (f?.url) { spec.diagram.src = f.url; spec.diagram.credit = f.creditText }
      } catch { /* drawn without the picture */ }
    }
    const items = practiceItems(spec, 2)
    let practice: { actionId: string; items: { q: string; svg?: string; unit?: string }[] } | undefined
    if (items.length) {
      const action = await logAction(ctx.admin, {
        studentId: ctx.studentId, runId: ctx.runId, source: ctx.mode === 'chat' ? 'agent' : 'director', tool: 'make_practice_set',
        args: { topic: spec.topic, source: 'worked_example', path_id: null, node_id: null },
        result: { items: items.map(i => ({ q: i.q, options: [], answer: -1, numeric: i.numeric, answerText: i.answerText, hint: i.hint, explain: i.explain })), answers: {} },
        summary: `Worked example practice: ${spec.topic}`,
      })
      practice = { actionId: action.id, items: items.map(i => ({ q: i.q, svg: i.svg, unit: i.unit })) }
    }
    ctx.emit({ kind: 'worked_example', id: randomUUID().slice(0, 8), spec, practice })
    const unit = spec.answer.unit ? ` ${spec.answer.unit}` : ''
    return {
      shown: true,
      problem: statementText(spec, ev.scope),
      answer: ev.answer !== null ? `${fmtNum(ev.answer)}${unit}` : spec.answer.text ?? null,
      steps: spec.steps.map(x => x.title ?? x.claim).slice(0, 12),
      your_turn: practice ? practice.items.length : 0,
      note: 'The learner now sees the problem, a prediction prompt, then each checked step with the diagram, a "change the numbers" control and a your-turn version. Do NOT repeat the working or the answer. Reply in 1-2 short sentences: invite them to predict first, then step through it. Never state a number that is not in this result.',
    }
  },
}

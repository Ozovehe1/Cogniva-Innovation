/**
 * The Live Tutor agent: one LLM agent for the lesson stage (and the same loop Ask and the sheet use, runAgent).
 * Woken by a learner SIGNAL (policy.ts only decides when to wake it), it reads its state (lesson beat and goal, what
 * is on the board and the stage, the last learner signals, mastery, misconceptions, what worked before), then:
 *   decide  — the `teaching_move` tool: act or deliberately wait, with a reason, a 1-3 step plan and anything to
 *             remember about this learner (planner role: the strongest tool-capable free model with room);
 *   act     — calls tools from a ≤5-tool loadout picked for this signal and topic (any tool of the one registry);
 *   observe — every new visual is self-checked (geometry + one vision pass) and the verdict returns to the model;
 *   revise  — the model fixes a failed visual or switches representation (once), then narrates.
 * Nothing here picks the response: the deterministic fallback runs only when every model is busy, and even then it
 * answers the signal it was woken for (busy.ts). Server only.
 */
import type { ToolDef } from '@/lib/agent/llm'
import { POINT_AT_TOOL, MOVES } from '@/lib/agent/moves'
import { runAgent, type RunResult } from '@/lib/agent/run'
import { toolsFor, type AgentCtx } from '@/lib/agent/tools'
import { compactDef, selectLoadout } from './registry'
import { signalLine, type LearnerSignal } from './signals'
import { benchGroupsFor } from './tools/bench'
import { warmToolbench } from '@/lib/toolbench/client'

export const LIVE_SYSTEM = `You are Ideanimo, a live tutor sitting beside one learner (often a Nigerian teenager) during a lesson. The lesson plays on its own; you watch through the LIVE STATE and are woken by a SIGNAL (a wrong answer, a long hesitation, idleness, play with a slider, "I'm lost", a question, or a report that a visual you showed failed its check).

Each wake:
1. Decide first with teaching_move {move, reason, plan, remember?}. You may decide to do nothing (move "wait") when the learner is doing fine: being quiet is often right. Otherwise act on what THIS signal tells you about their thinking.
2. Act with the tools offered (call them in the same response as teaching_move). Prefer acting on what is already on screen (point_at, board_edit, re-calling a live figure with changed values). After a wrong answer make the exact discrepancy visible. When they are lost, or a representation already failed, switch representation (a live scene, simulator, worked example, diagram, 3D model) and take a smaller step.
3. Observe: tool results carry self_check. If it says the visual is wrong, fix it (call again) before you talk about it.
4. Then speak to the learner: 1-3 short sentences about what is on screen, ending with one small question or task. Never more than 60 words.

Exact tools (symbolic_math, unit_check, logic_check, numeric_solve, circuit_spice, heat_diffusion, data_chart, molecule_props…) run real solvers and simulators on a server. Use them on your own when they would help, unasked: after a wrong numeric or algebra answer, check the expected value AND the learner's value with one, then show the gap with a visual tool. Chain when useful (verify → show: a chart, a clip, a figure). Read each result: if it has error or bench_issues, fix the arguments and call once more, or call the fallback it names. Skip them when words or what is on screen are enough.

Rules: numbers only from tools (compute, the exact tools, circuit_sim, worked_example). Never invent what a picture shows. Do not repeat a visual you already showed for this. A slider signal: say what their change did and ask them to predict the next one. Hesitation: one hint, never the answer. remember: one line worth keeping about this learner (a misconception and what fixed it), only when you learned something.`

/** The decide tool for live wakes: the move plus a short plan and an optional memory line. */
export const DECIDE_TOOL: ToolDef = {
  name: 'teaching_move',
  description: 'Decide FIRST: act or wait, why, and a 1-3 step plan. Call it in the same response as the tools that carry the plan out (alone for wait/explain/ask_learner).',
  parameters: {
    type: 'object',
    properties: {
      move: { type: 'string', enum: [...MOVES] },
      reason: { type: 'string', description: 'what this signal says about their thinking, in one line' },
      plan: { type: 'array', items: { type: 'string' }, maxItems: 3, description: 'short steps you will take' },
      target: { type: 'string', description: 'id of the board element / visual you act on' },
      remember: { type: 'string', description: 'optional: one line to keep about this learner (misconception + what helped)' },
    },
    required: ['move', 'reason', 'plan'],
    additionalProperties: false,
  },
}

export interface LiveInput {
  ctx: AgentCtx
  signal: LearnerSignal
  /** Recent signals, oldest first (includes `signal`). */
  recent: LearnerSignal[]
  /** The TUTOR STATE block (tutor-state.ts) for the lesson position, board and learner. */
  state: string
  /** What the adaptive stage holds now (block kinds/titles + live values), from the browser. */
  stage: string[]
  /** Lesson title + goal + what it teaches so far (short). */
  lesson: string
  /** Memory lines (what worked / misconceptions) for this learner and topic. */
  memory: string[]
  /** What the tutor did on its last wakes this session (so it varies and builds on itself). */
  lastActs: string[]
  deadline: number
  onText?: (d: string) => void
  onTool?: (name: string, label: string, state: 'start' | 'done' | 'error') => void
}

/**
 * Free models sometimes write their tool calls as text ("**teaching_move** {\"move\": …}", "<|channel|>") after a
 * failed tool-call parse. The live route holds the narration until the run ends and keeps only what is meant for the
 * learner: the part after a "Speak" heading if there is one, else the text with tool headers and JSON objects removed.
 */
export function cleanNarration(t: string): { text: string; leaked: boolean } {
  const leak = /\*\*\s*(teaching_move|board_edit|point_at|[a-z]+_[a-z_]+)\s*\*\*|"(move|plan|reason)"\s*:\s*["\[]|<\|[a-z_]+\|>|^\s*\**\s*(teaching move|move|plan|reason)\s*:/im
  if (!leak.test(t)) return { text: t, leaked: false }
  // "**Teaching move:** ask_learner – Hint: …" / "**Answer:** …": the label line or label goes, the words for the learner stay.
  t = t.replace(/^\s*\**\s*(teaching move|move|plan|reason)\s*:?\s*\**\s*:?\s*[a-z_]+\s*[–—-]\s*/gim, '')
    .replace(/^\s*\**\s*(teaching move|move|plan|reason)\s*:\**.*$/gim, '')
    .replace(/^\s*\**\s*(answer|reply|speak|say)\s*:\s*\**\s*/gim, '')
  const speak = /\*\*\s*(speak|say|to the learner)\s*\*\*\s*:?\s*([\s\S]+)$/i.exec(t)
  let out = speak ? speak[2] : t
  out = out.replace(/```[\s\S]*?```/g, '')
    .replace(/\{[\s\S]*?\}/g, m => (/"\w+"\s*:/.test(m) ? '' : m))
    .replace(/<\|[a-z_]+\|>\w*/gi, '')
    .replace(/^\s*\*\*[a-z_ ]+\*\*.*$/gim, '')
    .replace(/^\s*[-*]\s*(edit|add|erase|move|highlight)\b.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n').trim()
    .replace(/^[“"]+|[”"]+$/g, '').trim()
  return { text: out, leaked: true }
}

export function liveLoadout(inp: Pick<LiveInput, 'ctx' | 'signal' | 'lesson' | 'stage'>) {
  const all = toolsFor(inp.ctx)
  const text = `${inp.signal.detail ?? ''} ${inp.signal.answer ?? ''} ${inp.signal.expected ?? ''} ${inp.signal.where ?? ''} ${inp.stage.join(' ')}`
  const specs = selectLoadout(all, { text, topic: inp.lesson, signal: inp.signal.kind, hasBoard: inp.ctx.hasBoard, live: true, restricted: inp.ctx.restricted, shownTools: inp.stage.map(s => s.split(':')[0]) })
  const defs: ToolDef[] = [DECIDE_TOOL, ...(inp.ctx.hasBoard && specs.some(t => t.def.name === 'board_edit') ? [POINT_AT_TOOL] : []), ...specs.map(compactDef)]
  return { specs, defs: defs.slice(0, 6 + (inp.ctx.hasBoard ? 1 : 0)) }
}

export function liveContext(inp: Omit<LiveInput, 'ctx' | 'deadline' | 'onText' | 'onTool'>): string {
  const now = Date.now()
  return [
    `SIGNAL (why you were woken): ${signalLine(inp.signal, now)}`,
    inp.recent.length > 1 ? `RECENT LEARNER SIGNALS (oldest first):\n${inp.recent.slice(-6).map(s => `  ${signalLine(s, now)}`).join('\n')}` : '',
    `LESSON: ${inp.lesson}`,
    inp.stage.length ? `ON THE STAGE NOW (beside the lesson board):\n${inp.stage.slice(-4).map(s => `  ${s}`).join('\n')}` : 'ON THE STAGE NOW: nothing beside the lesson board',
    inp.lastActs.length ? `YOUR LAST ACTS THIS LESSON:\n${inp.lastActs.slice(-3).map(s => `  ${s}`).join('\n')}` : '',
    inp.memory.length ? `WHAT YOU REMEMBER ABOUT THIS LEARNER:\n${inp.memory.slice(0, 4).map(s => `  - ${s}`).join('\n')}` : '',
    inp.state,
  ].filter(Boolean).join('\n')
}

export async function runLive(inp: LiveInput): Promise<RunResult & { offered: string[] }> {
  const { defs } = liveLoadout(inp)
  // A bench tool is on offer: start its backend now, while the planner decides (skips the 3-6 s cold start).
  const groups = benchGroupsFor(defs.map(d => d.name))
  if (groups.length) void warmToolbench(groups)
  const context = liveContext(inp)
  const r = await runAgent({
    ctx: inp.ctx,
    system: LIVE_SYSTEM,
    messages: [{ role: 'user', content: `${context}\n\nDecide (teaching_move), act if you choose to, check, then speak.` }],
    onText: inp.onText,
    onTool: inp.onTool,
    deadline: inp.deadline,
    offer: defs,
    firstPurpose: 'planner',
    selfCheck: { vision: true, intent: `${inp.lesson.slice(0, 160)}; for: ${signalLine(inp.signal)}` },
  })
  return { ...r, offered: defs.map(d => d.name) }
}

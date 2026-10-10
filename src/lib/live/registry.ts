/**
 * ONE tool registry for every surface (Live Tutor in the lesson, the in-lesson sheet, Ask, the Director). Every tool is
 * an ordinary ToolSpec (definition + runner) plus metadata: a one-line summary (the compressed schema the free models
 * see), which renderer its output uses, cost and latency class, and the topics/phases it fits. The per-call LOADOUT
 * picks at most LOADOUT_MAX tools for a call (free-tier fit: Groq's 8K TPM per model), chosen from the learner's words,
 * the lesson topic, the signal that woke the agent and what is on screen. Choosing the loadout only decides what the
 * agent CAN use this call; the agent decides what it does.
 *
 * Remote tools (the Modal tool bench, lib/toolbench/client.ts) plug in through registerRemoteTool(): they become
 * ordinary tools with prepare → run → validate → fallback, and their async results stream to the stage as blocks.
 */
import type { ToolDef } from '@/lib/agent/llm'
import { allTools, type ToolSpec } from '@/lib/agent/tools'
import { remoteContract } from './remote'
export { registerRemoteTool, type RemoteToolContract } from './remote'
import type { SignalKind } from './signals'

import type { Renderer, Cost, Latency } from './remote'
export type { Renderer, Cost, Latency }

export interface ToolMeta {
  /** ≤ 160 chars: what the free models see as the description (the full one is the long schema). */
  short?: string
  renderer: Renderer
  cost: Cost
  latency: Latency
  /** What the tool is good for (matched against the learner's words + topic). */
  topics?: RegExp
  /** Signals it is often useful for (a soft boost, never a rule). */
  signals?: SignalKind[]
  /** Never offered in a live lesson call (writes that need a confirm, planning tools). */
  notLive?: boolean
  /** An exact checker: surfaced after a wrong answer that has numbers or algebra in it. */
  verifies?: boolean
}

/** At most this many registry tools per model call (+ the decide tool = 6). */
export const LOADOUT_MAX = 5

const META: Record<string, ToolMeta> = {
  show_scene: { short: 'Live animated scene that plays at once: motor, induction, wire/solenoid field, circuit current, projectile, heart blood flow, cell, tangent. Learner can slide/drag.', renderer: 'scene', cost: 'free-browser', latency: 'instant', topics: /motor|induc|magnet|solenoid|field|current|circuit|projectile|thrown|heart|blood|cell|tangent|derivative|slope/i, signals: ['lost', 'answer'] },
  worked_example: { short: 'A numeric problem solved step by step with every number checked (circuits, projectile, incline, stoichiometry, genetics, calculus); predict → steps → your turn.', renderer: 'figure', cost: 'llm', latency: 'fast', topics: /calculat|solve|how (much|many|far|fast)|resist|circuit|projectile|incline|mole|stoich|punnett|genotype|derivative|optimi|example|problem|equation/i, signals: ['answer', 'lost'] },
  interactive: { short: 'Live figure (JSXGraph): sliders, draggable points, a function with a gliding point, tangent, vector field. Re-call with a changed spec to modify it.', renderer: 'figure', cost: 'free-browser', latency: 'instant', topics: /\bfunctions?\b|graph|slope|gradient|tangent|derivative|parabola|linear|quadratic|vector field|coordinate|plot|axes|point/i, signals: ['slider', 'lost'] },
  find_illustration: { short: 'A real, credited textbook picture of an object or organism (heart, cell, flower, apparatus, motor…).', renderer: 'svg', cost: 'free-api', latency: 'fast', topics: /heart|cell|organ|anatomy|flower|leaf|plant|insect|apparatus|microscope|motor|generator|atom|planet|volcano|dna|neuron|structure|parts of/i },
  animate_concept: { short: 'A narrated animation clip of a process or motion (arrives in 1-3 min; max 3/day). Pair with something on screen now.', renderer: 'clip', cost: 'modal-cpu', latency: 'async', topics: /animat|clip|video|process|cycle|over time|motion|stages/i },
  draw_on_board: { short: 'A new hand-drawn board scene: working, derivations, quick sketches (replaces the chat board).', renderer: 'board', cost: 'llm', latency: 'fast', topics: /solve|derive|step by step|working|algebra|equation|simplify|expand|factor/i, signals: ['answer'] },
  board_edit: { short: 'Change the board in place by element id: add, rewrite, move, annotate, highlight, erase.', renderer: 'board', cost: 'free-browser', latency: 'instant', signals: ['answer', 'hesitation'] },
  board_inspect: { short: 'See every board element with id, label and box (when the state block is not enough).', renderer: 'data', cost: 'free-browser', latency: 'instant' },
  board_clear_region: { short: 'Erase part of the board to make room.', renderer: 'board', cost: 'free-browser', latency: 'instant' },
  plot: { short: 'A static graph of functions or points on axes.', renderer: 'board', cost: 'free-browser', latency: 'instant', topics: /graph|plot|chart|curve|y\s*=|f\(x\)/i },
  simulate: { short: 'A slider simulation of a formula with a moving object (pendulum, spring, planet) and live readouts.', renderer: 'figure', cost: 'free-browser', latency: 'instant', topics: /pendulum|spring|oscillat|orbit|decay|growth|interest|simulat/i, signals: ['slider'] },
  math_diagram: { short: 'Exact maths diagram: Venn/sets, geometry constructions, trees, vectors.', renderer: 'svg', cost: 'llm', latency: 'fast', topics: /venn|set|subset|triangle|angle|bisect|perpendicular|tree|vector|construction|congruen/i },
  illustrate: { short: 'A clean labelled SVG diagram of a structure, setup or process.', renderer: 'svg', cost: 'llm', latency: 'fast', topics: /diagram|label|setup|forces on|apparatus/i },
  compute: { short: 'Exact maths: evaluate, simplify, derivative, solve, check. Use before stating any number.', renderer: 'data', cost: 'free-browser', latency: 'instant', topics: /\d|calculat|solve|value|how much|equal|derivative|=\s*\?/i, signals: ['answer'], verifies: true },
  run_python: { short: 'Run Python (numpy, sympy, matplotlib) in a sandbox; figures shown as images.', renderer: 'image', cost: 'modal-cpu', latency: 'fast', topics: /python|code|matrix|data|statistic|regression|numerical|simulate numerically/i },
  web_search: { short: 'Search the web (Wikipedia first); cite sources.', renderer: 'text', cost: 'free-api', latency: 'fast', topics: /search|news|latest|who (is|was)|when (did|was)|source|research/i, notLive: true },
  fetch_page: { short: 'Read a page from the search results.', renderer: 'text', cost: 'free-api', latency: 'fast', topics: /http|wikipedia|arxiv/i, notLive: true },
  search_my_learning: { short: 'Search the learner\'s memory: past lessons, mistakes, chats.', renderer: 'data', cost: 'free-api', latency: 'fast', topics: /remember|last time|earlier|before|we did|covered/i },
  get_lesson_digest: { short: 'What a lesson actually taught (beats, worked steps, checks).', renderer: 'data', cost: 'free-api', latency: 'fast', topics: /lesson|covered|earlier|before/i },
  narrate: { short: 'Read a short explanation aloud.', renderer: 'text', cost: 'modal-gpu', latency: 'fast', topics: /listen|voice|read (it )?(out|aloud)|audio/i },
  make_practice_set: { short: 'Make 3-5 checked practice questions shown as an interactive set.', renderer: 'action', cost: 'llm', latency: 'fast', topics: /practi[cs]e|quiz|test me|questions|drill|exercise/i },
  circuit_sim: { renderer: 'embed', cost: 'free-browser', latency: 'instant', topics: /circuit|resist|ohm|current|voltage|kirchhoff|kvl|kcl|series|parallel|battery|potential difference|electric/i, signals: ['answer', 'lost'] },
  molecule_3d: { renderer: 'embed', cost: 'free-api', latency: 'fast', topics: /molecul|bond|compound|methane|water|glucose|caffeine|ethanol|benzene|protein|polar|isomer|vsepr|shape of|carbon dioxide|ammonia|atp/i },
  diagram: { renderer: 'embed', cost: 'free-browser', latency: 'instant', topics: /cycle|process|steps|stages|flow|krebs|pathway|sequence|timeline|concept map|classif|life cycle|algorithm|respiration|photosynth|food chain|food web/i, signals: ['lost'] },
  physics_sim: { renderer: 'embed', cost: 'free-browser', latency: 'instant', topics: /force|friction|collision|momentum|fall|drop|incline|ramp|gravity|newton|acceleration|projectile|mass|weight/i, signals: ['slider', 'lost'] },
  geogebra: { renderer: 'embed', cost: 'free-browser', latency: 'instant', topics: /geometr|triangle|circle|angle|construct|locus|transform|reflect|rotat|translat|vector|polygon|parabola|\bfunctions?\b|coordinate/i, signals: ['slider'] },
  phet: { renderer: 'embed', cost: 'free-browser', latency: 'instant', topics: /ohm|faraday|orbit|projectile|states of matter|molecule shape|wave|\bph\b|acid|natural selection|forces? and motion|pendulum|quadratic|circuit|energy|skate|atom|balancing/i },
  desmos: { renderer: 'embed', cost: 'free-browser', latency: 'instant', topics: /graph|\bfunctions?\b|parabola|slope|linear|quadratic|transform|y\s*=|f\(x\)|intercept|gradient/i, signals: ['slider'] },
}

/* ───────────── The registry ───────────── */

/** Every tool, every surface (mode only filters writes for background vs chat). */
export function registryTools(): ToolSpec[] { return allTools() }

export function metaOf(name: string): ToolMeta {
  const r = remoteContract(name)
  if (r) return { short: r.short, renderer: r.renderer, cost: r.cost, latency: r.latency, topics: r.topics, signals: r.signals, notLive: r.notLive, verifies: r.verifies }
  return META[name] ?? { renderer: 'action', cost: 'llm', latency: 'fast' }
}

/** A tool definition with its compressed (one-line) description: what free models are sent. */
export function compactDef(t: ToolSpec): ToolDef {
  const short = metaOf(t.def.name).short ?? firstSentence(t.def.description)
  return { name: t.def.name, description: short, parameters: t.def.parameters }
}
function firstSentence(s: string) { const m = /^(.{40,220}?[.!?])\s/.exec(s); return (m ? m[1] : s.slice(0, 220)).trim() }

export interface LoadoutInput {
  /** Learner's words + lesson topic + what is on screen (lower weight). */
  text: string
  topic?: string | null
  signal?: SignalKind | null
  hasBoard?: boolean
  live?: boolean
  restricted?: boolean
  /** Tool names already shown on stage (a figure to modify → keep its tool). */
  shownTools?: string[]
  max?: number
}

/**
 * Pick ≤ max tools for one call. Score = topic match (learner's words weigh most, then the lesson topic) + a soft
 * boost for the signal + on-screen continuity, with a diverse default (one live figure, one scene, one worked
 * example, one picture) so an un-hinted call can still choose a representation. Deterministic.
 */
export function selectLoadout(all: ToolSpec[], inp: LoadoutInput): ToolSpec[] {
  const max = inp.max ?? LOADOUT_MAX
  const avail = all.filter(t => t.modes.includes('chat') && !(inp.live && metaOf(t.def.name).notLive) && t.tier !== 'write' && t.tier !== 'confirm' && !(inp.restricted && /web_search|fetch_page/.test(t.def.name)))
  const words = inp.text.toLowerCase()
  const topic = (inp.topic ?? '').toLowerCase()
  // A wrong answer (or a learner claim) with numbers / algebra in it: the exact checkers come forward so the agent CAN
  // verify both values before it reteaches. It still decides whether to use one.
  const mathy = /\d|[=^+*/]|\bx\b|sqrt|frac/.test(words)
  const verifyBoost = mathy && (inp.signal === 'answer' || inp.signal === 'message') ? 1.5 : 0
  const scored = avail.map(t => {
    const m = metaOf(t.def.name)
    let s = 0
    if (m.topics?.test(words)) s += 3
    if (topic && m.topics?.test(topic)) s += 1.5
    if (inp.signal && m.signals?.includes(inp.signal)) s += 1
    if (verifyBoost && m.verifies && (m.topics?.test(words) || m.topics?.test(topic))) s += verifyBoost
    const fit = s
    if (inp.shownTools?.includes(t.def.name)) s += 1.2
    if (inp.hasBoard && (t.def.name === 'board_edit')) s += 2.5
    if (inp.hasBoard && t.def.name === 'board_inspect') s += 0.8
    // Diverse default representations (ties broken by this order).
    const base: Record<string, number> = { interactive: 0.6, show_scene: 0.55, worked_example: 0.5, find_illustration: 0.45, diagram: 0.3, compute: 0.35, draw_on_board: 0.25 }
    s += base[t.def.name] ?? 0
    if (m.latency === 'async') s -= 0.4
    return { t, s, fit }
  }).filter(x => x.s > 0.2)
  scored.sort((a, b) => b.s - a.s)
  // At most two board verbs, so the board never crowds out every other representation.
  const out: ToolSpec[] = []
  let boardVerbs = 0
  for (const x of scored) {
    if (out.length >= max) break
    if (/^board_/.test(x.t.def.name)) { if (boardVerbs >= 2) continue; boardVerbs++ }
    out.push(x.t)
  }
  // Remote (tool-bench) reserve: when an exact bench tool clearly fits this lesson/signal (topic + signal) but the
  // generic defaults crowded it out, it takes the weakest default slot, so the agent can see it. Still ≤ max.
  const inOut = new Set(out.map(t => t.def.name))
  const bench = scored.find(x => remoteContract(x.t.def.name) && !inOut.has(x.t.def.name) && x.fit >= 1.5)
  if (bench && out.length && !out.some(t => remoteContract(t.def.name))) {
    let k = -1
    for (let i = out.length - 1; i >= 0; i--) { const n = out[i].def.name; if (!inp.shownTools?.includes(n) && !/^board_/.test(n) && scored.find(x => x.t === out[i])!.fit < bench.fit) { k = i; break } }
    if (k >= 0) out[k] = bench.t
    else if (out.length < max) out.push(bench.t)
  }
  return out
}

/** A failed tool hands its slot in the offer to the fallback it names (the offer never grows unless the failed tool was not in it). */
export function offerFallback(defs: ToolDef[], failed: string, fb: ToolSpec): ToolDef[] {
  if (defs.some(d => d.name === fb.def.name)) return defs
  const next = defs.map(d => (d.name === failed ? compactDef(fb) : d))
  return next.some(d => d.name === fb.def.name) ? next : [...next, compactDef(fb)]
}

/** Server-side feature flag for the unified live agent (on by default; LIVE_AGENT=0 is the kill switch). */
export const liveAgentOn = () => !/^(0|off|false)$/i.test((process.env.LIVE_AGENT ?? '1').trim())

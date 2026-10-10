/**
 * Static evals for the Phase-1 Live Tutor pieces (no model calls): the wake policy (proactive, debounced, rate-limited),
 * the free model router (roles, OpenRouter tool gating, budget buckets, PII stripping), the per-call loadout, the
 * busy fallback that answers the message, circuits (solver + netlist + read-back check) and the geometry self-check.
 * Run in the 'static' eval group (and 'live').
 */
import { WAKE, newWakeState, noteSlider, shouldWake } from './policy'
import type { LearnerSignal } from './signals'
import { quality, inventory, budgetBucket, userKey, BUCKET_SHARE, type SlotDef } from '@/lib/agent/pool'
import { stripPII } from '@/lib/agent/llm'
import { selectLoadout, compactDef, LOADOUT_MAX, offerFallback } from './registry'
import { toolsFor } from '@/lib/agent/tools'
import { checkLearnerClaim, answerFromShown } from './busy'
import { readVisual } from '@/lib/visual-policy'
import { parseCircuit, solveCircuit, circuitNetlist, checkReadings } from './tools/circuit-net'
import { geometryCheck } from './selfcheck'
import type { Block } from '@/lib/agent/types'
import { DECIDE_TOOL, LIVE_SYSTEM, cleanNarration } from './agent'
import { remoteContracts, remoteTools } from './remote'
import { BENCH_DEFS, BENCH_NAMES, BENCH_MAX_PER_RUN, benchGroupsFor, benchInitiated, checkIssues, compactResult, emitArtifacts, fallbackName, takeBenchSlot, withViewBox } from './tools/bench'
import type { ToolbenchResult } from '@/lib/toolbench/client'
import { atomSpec, atomSvg, drawnElectrons, elementInText, shellConfig } from '@/lib/atom'

export interface LiveCase { id: string; group: string; pass: boolean; detail: string }

const sig = (kind: LearnerSignal['kind'], at: number, x: Partial<LearnerSignal> = {}): LearnerSignal => ({ kind, at, ...x })

export function policyCases(): LiveCase[] {
  const out: LiveCase[] = []
  const add = (id: string, pass: boolean, detail = '') => out.push({ id: `policy-${id}`, group: 'static', pass, detail })
  const T = 1_000_000
  let st = newWakeState()
  add('wrong-answer-wakes', shouldWake(st, sig('answer', T, { correct: false }), T).wake)
  st = newWakeState()
  add('right-answer-context-only', !shouldWake(st, sig('answer', T, { correct: true }), T).wake)
  st = newWakeState()
  add('hesitation-threshold', !shouldWake(st, sig('hesitation', T, { seconds: 24, where: 'c1' }), T).wake && shouldWake(st, sig('hesitation', T, { seconds: 25, where: 'c1' }), T).wake)
  add('hesitation-once-per-check', !shouldWake(st, sig('hesitation', T + 120_000, { seconds: 40, where: 'c1' }), T + 120_000).wake)
  st = newWakeState()
  add('idle-threshold', !shouldWake(st, sig('idle', T, { seconds: 44 }), T).wake && shouldWake(st, sig('idle', T, { seconds: 45 }), T).wake)
  add('idle-cooldown', !shouldWake(st, sig('idle', T + 60_000, { seconds: 50 }), T + 60_000).wake)
  // Slider play: one move is not enough; two meaningful moves, then let go → wake; tiny wiggles never.
  st = newWakeState()
  const s1 = sig('slider', T, { param: 'R', from: 2, value: 8, min: 0, max: 10 })
  noteSlider(st, s1)
  add('slider-one-move-no', !shouldWake(st, s1, T + 3000).wake)
  const s2 = sig('slider', T + 5000, { param: 'R', from: 8, value: 3, min: 0, max: 10 })
  noteSlider(st, s2)
  add('slider-still-moving-no', !shouldWake(st, s2, T + 5500).wake)
  add('slider-two-moves-settled-yes', shouldWake(st, s2, T + 8000).wake)
  st = newWakeState()
  for (let i = 0; i < 6; i++) noteSlider(st, sig('slider', T + i * 300, { param: 'R', from: 5, value: 5.2, min: 0, max: 10 }))
  add('slider-wiggles-no', !shouldWake(st, sig('slider', T + 1800, { param: 'R', from: 5, value: 5.2, min: 0, max: 10 }), T + 9000).wake)
  st = newWakeState()
  shouldWake(st, sig('idle', T, { seconds: 50 }), T)
  add('global-gap', !shouldWake(st, sig('hesitation', T + 10_000, { seconds: 30, where: 'c9' }), T + 10_000).wake)
  add('urgent-bypasses-gap', shouldWake(st, sig('lost', T + 11_000), T + 11_000).wake)
  add('stage-failed-wakes', shouldWake(st, sig('stage', T + 12_000, { correct: false }), T + 12_000).wake && !shouldWake(newWakeState(), sig('stage', T, { correct: true }), T).wake)
  // A 10-minute lesson with realistic signals: at least 3 proactive wakes, never two non-urgent ones within the gap,
  // never more than the caps.
  st = newWakeState()
  const timeline: [number, LearnerSignal][] = [
    [30, sig('slider', 0, { param: 'v', from: 1, value: 6, min: 0, max: 10 })], [36, sig('slider', 0, { param: 'v', from: 6, value: 2, min: 0, max: 10 })],
    [95, sig('hesitation', 0, { seconds: 26, where: 'c1' })], [120, sig('answer', 0, { correct: false })], [124, sig('answer', 0, { correct: false })],
    [200, sig('idle', 0, { seconds: 47 })], [215, sig('idle', 0, { seconds: 62 })], [330, sig('lost', 0)],
    [400, sig('slider', 0, { param: 'v', from: 2, value: 9, min: 0, max: 10 })], [404, sig('slider', 0, { param: 'v', from: 9, value: 4, min: 0, max: 10 })],
    [480, sig('hesitation', 0, { seconds: 30, where: 'c2' })], [560, sig('idle', 0, { seconds: 48 })],
  ]
  const woke: { t: number; kind: string; urgent: boolean }[] = []
  // Each slider pair is followed by the settle check 3 s after the second move (what the browser does).
  const events: [number, LearnerSignal, boolean][] = timeline.map(([t, s]) => [t, s, false] as [number, LearnerSignal, boolean])
  for (const t of [36, 404]) events.push([t + 3, sig('slider', 0, { param: 'v' }), true])
  events.sort((a, b) => a[0] - b[0])
  for (const [t, s, settle] of events) {
    const at = T + t * 1000
    const x = { ...s, at }
    if (x.kind === 'slider' && !settle) { noteSlider(st, x); continue }
    const d = shouldWake(st, x, at)
    if (d.wake) woke.push({ t, kind: x.kind, urgent: d.urgent })
  }
  woke.sort((a, b) => a.t - b.t)
  const proactive = woke.filter(w => !w.urgent)
  const gapOk = proactive.every((w, i) => i === 0 || (w.t - proactive[i - 1].t) * 1000 >= WAKE.gapMs || woke.some(u => u.urgent && u.t > proactive[i - 1].t && u.t <= w.t))
  add('ten-minute-session', woke.length >= 5 && proactive.length >= 3 && woke.length <= WAKE.maxPer10Min && proactive.length <= WAKE.maxProactivePer10Min && gapOk, woke.map(w => `${w.t}s ${w.kind}${w.urgent ? '!' : ''}`).join(', '))
  add('double-wrong-debounced', woke.filter(w => w.kind === 'answer').length === 1, `answer wakes ${woke.filter(w => w.kind === 'answer').length} (2 wrong answers 4 s apart)`)
  return out
}

export function routerCases(): LiveCase[] {
  const out: LiveCase[] = []
  const add = (id: string, pass: boolean, detail = '') => out.push({ id: `router-${id}`, group: 'static', pass, detail })
  const env = { GEMINI_API_KEY: 'g1', GROQ_API_KEY: 'q1', OPENROUTER_API_KEY: 'o1' }
  const inv = inventory(env)
  const or = inv.filter(s => s.provider === 'openrouter')
  add('openrouter-overflow-slots', or.length === 3 && or.every(s => s.limits.rpd <= 50), or.map(s => s.model).join(','))
  const q = (purpose: Parameters<typeof quality>[0], provider: SlotDef['provider'], model: string) => quality(purpose, { provider, model })
  add('or-tools-gated', q('chat', 'openrouter', 'nvidia/nemotron-3-super-120b-a12b:free') > 0 && q('chat', 'openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free') === 0 && q('chat', 'openrouter', 'google/gemma-4-31b-it:free') === 0, 'super=tools, ultra/gemma=text only until verified')
  add('or-overflow-only', q('chat', 'openrouter', 'nvidia/nemotron-3-super-120b-a12b:free') < 0.8 && q('json', 'openrouter', 'google/gemma-4-31b-it:free') > 0, 'below the preferred floor: used only on the lighter rung')
  add('or-never-lesson-vision', q('lesson', 'openrouter', 'x') === 0 && q('vision', 'openrouter', 'x') === 0)
  const plannerOrder = inv.filter(s => s.provider !== 'openrouter').map(s => ({ m: s.model, q: quality('planner', s) })).sort((a, b) => b.q - a.q)
  add('planner-strongest-first', plannerOrder[0].m === 'gemini-3.8-flash' && plannerOrder.find(x => /gpt-oss-120b/.test(x.m))!.q > plannerOrder.find(x => /lite/.test(x.m))!.q, plannerOrder.slice(0, 4).map(x => `${x.m} ${x.q}`).join(' > '))
  add('budget-buckets', budgetBucket('live', 'live', 'planner') === 'live' && budgetBucket('ask', 'ask', 'chat') === 'ask' && budgetBucket('live', 'lesson-beat', 'lesson') === 'draft' && budgetBucket('background', 'director', 'director') === 'bg')
  const g = { provider: 'groq' as const }
  add('buckets-separate-keys', userKey(g, 'L', 'live') !== userKey(g, 'L', 'draft') && userKey(g, 'L', 'ask') === 'g:L' && BUCKET_SHARE.live >= BUCKET_SHARE.ask, `${userKey(g, 'L', 'live')} / ${userKey(g, 'L', 'draft')}`)
  const p = stripPII([{ role: 'user', content: 'Learner: SS2, age band 13to17; interests: football, music. My name is Ada Obi, mail ada@x.com, call +234 803 123 4567. Why is the sky blue?' }])[0].content
  add('pii-stripped', !/13to17|football|Ada|ada@x|803/.test(p) && /sky blue/.test(p), p)
  return out
}

export function loadoutCases(): LiveCase[] {
  const out: LiveCase[] = []
  const add = (id: string, pass: boolean, detail = '') => out.push({ id: `loadout-${id}`, group: 'static', pass, detail })
  const all = toolsFor({ mode: 'chat', restricted: false })
  const pick = (text: string, x: Partial<Parameters<typeof selectLoadout>[1]> = {}) => selectLoadout(all, { text, ...x }).map(t => t.def.name)
  const c = pick('two resistors in parallel, what current flows?')
  add('circuit', c.includes('circuit_sim') && c.length <= LOADOUT_MAX, c.join(','))
  const m = pick('why is water a polar molecule')
  add('molecule', m.includes('molecule_3d'), m.join(','))
  const k = pick('explain the krebs cycle')
  add('cycle-diagram', k.includes('diagram'), k.join(','))
  const f = pick('a ball rolling down a ramp with friction')
  add('physics', f.includes('physics_sim'), f.join(','))
  const b = pick('why is that sign negative', { hasBoard: true, signal: 'answer' })
  add('board-verbs', b.includes('board_edit') && b.length <= LOADOUT_MAX, b.join(','))
  const live = pick('search the latest news', { live: true })
  add('live-no-web', !live.includes('web_search'), live.join(','))
  const defs = all.map(compactDef)
  const longest = defs.reduce((a, d) => Math.max(a, d.description.length), 0)
  add('compact-descriptions', longest <= 230, `longest ${longest} chars`)
  // Token budget of one live call: system + decide tool + 5 compact tools (+ ~2.5K chars of state) under Groq's 8K TPM.
  const offer = [DECIDE_TOOL, ...selectLoadout(all, { text: 'resistors in series', live: true }).map(compactDef)]
  const chars = LIVE_SYSTEM.length + JSON.stringify(offer).length + 5400 + 1200
  add('live-call-fits-groq', chars / 3.6 + 700 < 8000, `≈${Math.round(chars / 3.6)} input tokens + 700 out`)
  return out
}

export function busyCases(): LiveCase[] {
  const out: LiveCase[] = []
  const add = (id: string, pass: boolean, detail = '') => out.push({ id: `busy-${id}`, group: 'static', pass, detail })
  const c = checkLearnerClaim('derivative of x² at 3 is 9, right?')
  add('corrects-9-vs-6', !!c && !c.correct && c.value === '6', JSON.stringify(c))
  const ok = checkLearnerClaim('so 4 + 5 * 2 = 14?')
  add('confirms-arithmetic', !!ok && ok.correct, JSON.stringify(ok))
  add('coil-is-motor', readVisual('why does the coil keep spinning').structure === 'electric motor', String(readVisual('why does the coil keep spinning').structure))
  const motor = { kind: 'scene', id: 's1', alt: 'motor', spec: { title: 'How a DC motor turns', beats: [{ caption: 'Current flows round the coil' }, { caption: 'Forces push the sides opposite ways', say: 'The forces on the two sides of the coil push opposite ways, so it turns.' }, { caption: 'Commutator flips the current', say: 'Every half turn the commutator reverses the current in the coil, so it keeps spinning the same way.' }] } } as unknown as Block
  const a = answerFromShown('why does the coil keep spinning?', [motor])
  add('answers-from-shown-scene', !!a && /commutator/i.test(a) && !/solenoid/i.test(a), a ?? 'null')
  return out
}

export function circuitCases(): LiveCase[] {
  const out: LiveCase[] = []
  const add = (id: string, pass: boolean, detail = '') => out.push({ id: `circuit-${id}`, group: 'static', pass, detail })
  const ser = parseCircuit({ volts: 9, parts: [{ r: { label: 'R1', ohms: 3 } }, { r: { label: 'R2', ohms: 6 } }] })
  const ss = solveCircuit(ser.spec!)
  add('series', ss.topology === 'series' && ss.req === 9 && ss.current === 1 && ss.resistors[1].volts === 6, JSON.stringify(ss))
  const par = parseCircuit({ volts: 12, parts: [{ r: { label: 'R1', ohms: 4 } }, { parallel: [[{ label: 'R2', ohms: 6 }], [{ label: 'R3', ohms: 3 }]] }] })
  const ps = solveCircuit(par.spec!)
  add('series-parallel', ps.topology === 'mixed' && ps.req === 6 && ps.current === 2 && ps.resistors.find(r => r.label === 'R3')!.amps === 1.333, JSON.stringify(ps.resistors))
  const pure = solveCircuit(parseCircuit({ volts: 6, parts: [{ parallel: [[{ ohms: 2 }], [{ ohms: 3 }], [{ ohms: 6 }]] }] }).spec!)
  add('parallel', pure.topology === 'parallel' && pure.req === 1 && pure.current === 6, JSON.stringify(pure))
  const net = circuitNetlist(par.spec!)
  add('netlist', (net.match(/^r /gm) ?? []).length === 3 && (net.match(/^v /gm) ?? []).length === 1 && /^\$ /.test(net), net.split('\n').length + ' lines')
  const good = checkReadings(ps, ps.resistors.map(r => ({ type: 'ResistorElm', v: r.volts, a: -r.amps })))
  const bad = checkReadings(ps, ps.resistors.map(r => ({ type: 'ResistorElm', v: r.volts, a: r.amps * 2 })))
  add('readback-check', good.ok && !bad.ok, bad.issues.join('; '))
  add('rejects-bad-spec', !!parseCircuit({ volts: 9, parts: [{ parallel: [[{ ohms: 2 }]] }] }).error)
  return out
}

export function selfCheckCases(): LiveCase[] {
  const out: LiveCase[] = []
  const add = (id: string, pass: boolean, detail = '') => out.push({ id: `selfcheck-${id}`, group: 'static', pass, detail })
  const axes = { id: 'grid', type: 'draw', shape: { kind: 'axes', frame: { x: 40, y: 100, w: 400, h: 350 }, xRange: [0, 10], yRange: [0, 10], xStep: 2, yStep: 2 } }
  // The production bug: Lagos/Ibadan drawn in data units without "on" landed in the top-left corner.
  const orphan = { kind: 'board', id: 'b1', title: 't', steps: [axes, { id: 'ibadan', type: 'draw', shape: { kind: 'point', at: [8, 7], label: 'Ibadan' } }] } as unknown as Block
  const g1 = geometryCheck(orphan)
  add('orphan-point-bound-to-axes', g1.length === 0, g1.join('; ') || 'bound to grid')
  const off = { kind: 'board', id: 'b2', title: 't', steps: [axes, { id: 'p', on: 'grid', type: 'draw', shape: { kind: 'point', at: [30, 7] } }] } as unknown as Block
  add('outside-axes-flagged', geometryCheck(off).some(i => /outside|off the board/.test(i)), geometryCheck(off).join('; '))
  return out
}

/** Runs fn with the tool bench switched on (dummy URL/token when unset; no network is touched by these cases). */
function withBench<T>(fn: () => T, live = '1'): T {
  const keep = { u: process.env.TOOLBENCH_URL, t: process.env.TOOLBENCH_TOKEN, l: process.env.TOOLBENCH_LIVE }
  process.env.TOOLBENCH_URL = keep.u || 'https://bench.invalid'
  process.env.TOOLBENCH_TOKEN = keep.t || 'eval-token'
  process.env.TOOLBENCH_LIVE = live
  try { return fn() } finally {
    for (const [k, v] of [['TOOLBENCH_URL', keep.u], ['TOOLBENCH_TOKEN', keep.t], ['TOOLBENCH_LIVE', keep.l]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
}

/** The Modal tool bench wired into the one registry (lib/live/tools/bench.ts): registration, loadout fit, shaping, outputs. */
export function benchCases(): LiveCase[] {
  const out: LiveCase[] = []
  const add = (id: string, pass: boolean, detail = '') => out.push({ id: `bench-${id}`, group: 'static', pass, detail })
  const names = Object.values(BENCH_NAMES) as string[]
  const reg = remoteContracts().map(c => c.name)
  add('registered', names.length === 14 && names.every(n => reg.includes(n)), `${names.filter(n => reg.includes(n)).length}/${names.length}: ${names.join(',')}`)
  add('contract-complete', remoteContracts().filter(c => names.includes(c.name)).every(c => c.cost === 'modal-cpu' && !!c.prepare && !!c.validate && !!c.run && c.short.length <= 160), 'prepare/run/validate, modal-cpu, short ≤160')
  add('kill-switch', withBench(() => !remoteTools().some(t => names.includes(t.def.name)), '0') && withBench(() => remoteTools().filter(t => names.includes(t.def.name)).length === 14), 'TOOLBENCH_LIVE=0 hides all 14')
  const loadout = (text: string, x: Partial<Parameters<typeof selectLoadout>[1]> = {}) => withBench(() => selectLoadout(toolsFor({ mode: 'chat', restricted: false }), { text, live: true, ...x }).map(t => t.def.name))
  const want: [string, string, string][] = [
    ['rc-charging', 'how fast does the capacitor charge through the resistor', 'circuit_spice'],
    ['integrate', 'integrate x^2 from 0 to 3', 'symbolic_math'],
    ['decay', 'radioactive decay and half-life of a sample', 'numeric_solve'],
    ['heat', 'heat conduction along a metal rod', 'heat_diffusion'],
    ['units', 'convert 72 km/h to m/s', 'unit_check'],
    ['ray-diagram', 'ray diagram for a convex lens', 'tikz_figure'],
    ['solids', 'volume of a cylinder and a cone', 'render_3d'],
    ['molar-mass', 'molar mass of ethanol and its functional group', 'molecule_props'],
  ]
  for (const [id, text, tool] of want) { const l = loadout(text); add(`loadout-${id}`, l.includes(tool) && l.length <= LOADOUT_MAX, l.join(',')) }
  // Embeds stay first for what they already do: a resistor circuit still gets the live simulator.
  const res = loadout('two resistors in parallel, what current flows?')
  add('embed-first-resistors', res.includes('circuit_sim') && res.indexOf('circuit_sim') < (res.indexOf('circuit_spice') < 0 ? 99 : res.indexOf('circuit_spice')), res.join(','))
  const mat = loadout('can you run this in matlab or octave')
  add('notlive-hidden', !mat.includes('octave_run') && !mat.includes('uml_diagram'), mat.join(','))
  // Every live call stays within the loadout cap, bench or not (a broad corpus incl. signals and a board).
  const corpus = ['capacitor charging graph', 'solve x^2-5x+6=0 and plot it', 'heat flow in a plate, and the units of thermal conductivity', 'probability tree for two coins', 'molar mass of glucose, 3d shape of water', 'diode rectifier with a capacitor filter on an oscilloscope', 'convert joules to kWh for a 2 kW kettle', 'prove n^2 >= n for every integer', 'the krebs cycle', 'a ball rolling down a ramp', 'bar chart of rainfall by month', 'logistic population growth model and best fit line']
  const sizes = corpus.flatMap(t => [loadout(t), loadout(t, { signal: 'answer', hasBoard: true }), loadout(t, { signal: 'slider' })].map(l => l.length))
  add('cap-holds', sizes.every(n => n <= LOADOUT_MAX), `max ${Math.max(...sizes)} over ${sizes.length} calls`)
  const heavy = withBench(() => [DECIDE_TOOL, ...selectLoadout(toolsFor({ mode: 'chat', restricted: false }), { text: 'diode rectifier with a capacitor filter, charging curve, integrate the current', live: true }).map(compactDef)])
  const chars = LIVE_SYSTEM.length + JSON.stringify(heavy).length + 5400 + 1200
  add('bench-call-fits-groq', chars / 3.6 + 700 < 8000, `≈${Math.round(chars / 3.6)} input tokens: ${heavy.map(d => d.name).join(',')}`)
  // prepare: bad args come back to the model as an error before any network call.
  const prep = (tool: string, a: Record<string, unknown>) => remoteContracts().find(c => c.name === tool)!.prepare!(a)
  add('prepare-spice-ground', !!prep('circuit_spice', { netlist: 'V1 a b 5\nR1 a b 1k' }).error && !prep('circuit_spice', { netlist: 'V1 in 0 5\nR1 in 0 1k' }).error)
  add('prepare-sympy', !!prep('symbolic_math', { op: 'solve' }).error && prep('symbolic_math', { op: 'bogus', expr: 'x+1' }).args?.op === 'simplify')
  add('prepare-ode', !!prep('numeric_solve', { op: 'ode', rhs: ['-y', 'x'], y0: [1] }).error && !prep('numeric_solve', { op: 'ode', rhs: ['-0.3*y'], y0: [100] }).error)
  add('prepare-manim-dot', !!prep('manim_clip', { code: 'print(1)' }).error && !!prep('graph_draw', { dot: 'A->B' }).error && prep('tikz_figure', { tex: '\\draw (0,0)--(1,1);' }).args?.tex?.toString().includes('tikzpicture') === true)
  add('prepare-blender-caps', (prep('render_3d', { objects: [{ type: 'cube' }], spin: true }).args as { frames: number; width: number }).frames <= 24 && !!prep('render_3d', { objects: [{ type: 'teapot' }] }).error)
  add('fallback-map', fallbackName({ tool: 'client:circuitjs', reason: '' }) === 'circuit_sim' && fallbackName({ tool: 'client:3dmol', reason: '' }) === 'molecule_3d' && fallbackName({ tool: 'sympy', reason: '' }) === 'symbolic_math' && fallbackName(null) === null)
  const big = compactResult({ x: Array.from({ length: 500 }, (_, i) => i / 10), vega_lite: { huge: true }, summary: { 'v(out)': { max: 4.99 } } }) as Record<string, unknown>
  add('compact-result', !('vega_lite' in big) && (big.x as { n: number }).n === 500 && JSON.stringify(big).length < 300, JSON.stringify(big))
  const env = (o: Partial<ToolbenchResult>): ToolbenchResult => ({ ok: true, tool: 'x', result: {}, artifacts: [], state: {}, logs: '', ms: 1, ...o })
  add('validate-checks', checkIssues(env({ result: { checks: { residuals_zero: false } } })).length === 1 && checkIssues(env({ result: { checks: { residuals_zero: true } } })).length === 0 && checkIssues(env({ result: { consistent: false } })).length === 1)
  const got: Block[] = []
  const sink = { emit: (b: Block) => { got.push(b) } }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100pt" height="50pt"><g/></svg>'
  const a1 = emitArtifacts(sink, 'graphviz', env({ artifacts: [{ name: 'graph.svg', mime: 'image/svg+xml', text: svg, bytes: 90 }, { name: 'graph.png', mime: 'image/png', b64: 'iVBOR', bytes: 5 }] }), 'Tree')
  add('artifacts-one-picture', a1.shown.join() === 'svg' && got.length === 1 && got[0].kind === 'svg' && /viewBox="0 0 100 50"/.test((got[0] as { svg: string }).svg), JSON.stringify(a1))
  got.length = 0
  const a2 = emitArtifacts(sink, 'pde', env({ artifacts: [{ name: 'field.png', mime: 'image/png', b64: 'iVBOR', bytes: 5 }, { name: 'field.mp4', mime: 'video/mp4', b64: 'AAAA', bytes: 3 }] }), 'Heat')
  add('artifacts-clip', a2.shown.join() === 'clip' && got[0]?.kind === 'clip' && String((got[0] as { url?: string }).url).startsWith('data:video/mp4;base64,') && String((got[0] as { jobId: string }).jobId).startsWith('bench-'), JSON.stringify(a2))
  got.length = 0
  const a3 = emitArtifacts(sink, 'latex', env({ artifacts: [{ name: 'figure.svg', mime: 'image/svg+xml', text: '<svg onload="alert(1)"></svg>', bytes: 30 }, { name: 'figure.png', mime: 'image/png', b64: 'iVBOR', bytes: 5 }] }), 'Fig')
  add('artifacts-unsafe-svg', a3.shown.join() === 'image' && a3.dropped.length === 1 && got[0]?.kind === 'image', JSON.stringify(a3))
  add('viewbox-kept', withViewBox('<svg viewBox="0 0 1 1"></svg>') === '<svg viewBox="0 0 1 1"></svg>')
  const ctxKey = {}
  const slots = Array.from({ length: BENCH_MAX_PER_RUN + 1 }, () => takeBenchSlot(ctxKey))
  add('per-run-cap', slots.filter(Boolean).length === BENCH_MAX_PER_RUN && !slots[BENCH_MAX_PER_RUN], `cap ${BENCH_MAX_PER_RUN}`)
  add('warm-groups', benchGroupsFor(['circuit_spice', 'symbolic_math', 'circuit_sim']).sort().join() === 'compute,sci' && benchGroupsFor(['interactive']).length === 0)
  // Agency: per-signal surfacing (the agent still decides), the bench reserve slot, fallback hand-over, initiation log.
  const wrong = loadout('check "Solve 2x + 6 = 14", they answered "x = 10", expected "x = 4"', { signal: 'answer', topic: 'Solving linear equations' })
  add('wrong-answer-verifier', wrong.includes('symbolic_math') && wrong.includes('compute') && wrong.length <= LOADOUT_MAX, wrong.join(','))
  const idle = loadout('', { signal: 'idle', topic: '"Charging a capacitor", section "Time constant"' })
  add('reserve-slot-idle', idle.includes('circuit_spice') && idle.length <= LOADOUT_MAX, idle.join(','))
  const plain = loadout('', { signal: 'idle', topic: '"Parts of a flower"' })
  add('no-bench-when-unfit', !plain.some(n => names.includes(n)), plain.join(','))
  const all = withBench(() => toolsFor({ mode: 'chat', restricted: false }))
  const defs0 = [DECIDE_TOOL, ...all.filter(t => ['circuit_spice', 'interactive', 'show_scene'].includes(t.def.name)).map(compactDef)]
  const defs1 = offerFallback(defs0, 'circuit_spice', all.find(t => t.def.name === 'circuit_sim')!)
  add('fallback-handover', defs1.length === defs0.length && defs1.some(d => d.name === 'circuit_sim') && !defs1.some(d => d.name === 'circuit_spice'), defs1.map(d => d.name).join(','))
  add('initiated', benchInitiated({ kind: 'answer' }) === 'agent' && benchInitiated({ kind: 'lost' }) === 'agent' && benchInitiated({ kind: 'message', detail: 'why is it negative?' }) === 'agent' && benchInitiated({ kind: 'message', detail: 'can you simulate the capacitor?' }) === 'prompted')
  add('prompt-agency', /unasked/.test(LIVE_SYSTEM) && /fallback/.test(LIVE_SYSTEM) && /Chain/.test(LIVE_SYSTEM), 'exact tools unprompted, chain, retry/fallback')
  // Production smoke 2026-10-10 (live_3741548f): fixes for what it showed.
  const leak = '**teaching_move**  \n{\n  "move": "board_edit",\n  "reason": "x",\n  "plan": [\n    "a"\n  ]\n}\n\n**board_edit**  \n- Edit cell **EF1**: "RC"\n\n**Speak**  \n“Here is the time constant: 1 ms. What is 0.2 × 0.05?”'
  const cl = cleanNarration(leak)
  add('narration-leak-cleaned', cl.leaked && cl.text === 'Here is the time constant: 1 ms. What is 0.2 × 0.05?' && !cleanNarration('The curve rises fast, then slows. What is τ here?').leaked, JSON.stringify(cl.text))
  const lab = cleanNarration('**Teaching move:** ask_learner – Hint: what is 3 × 3?\n\n**Answer:** Look at 0.3 × 0.3 again.')
  add('narration-label-cleaned', lab.leaked && !/teaching move|answer:|ask_learner/i.test(lab.text) && /Hint: what is 3/.test(lab.text) && /Look at 0.3/.test(lab.text), JSON.stringify(lab.text))
  const sp = prep('circuit_spice', { netlist: 'V1 in 0 5\nR1 in out 1k\nC1 out 0 1u', analysis: 'tran 10u 5m' }).args as { analysis: string }
  add('spice-uic', sp.analysis === 'tran 10u 5m uic' && (prep('circuit_spice', { netlist: 'V1 in 0 5\nR1 in 0 1k', analysis: 'tran 1u 1m' }).args as { analysis: string }).analysis === 'tran 1u 1m', sp.analysis)
  add('spice-flat-flagged', checkIssues(env({ tool: 'spice', result: { x: [0, 1], summary: { 'v(out)': { min: 5, max: 5 } } } })).some(i => /flat/.test(i)) && checkIssues(env({ tool: 'spice', result: { x: [0, 1], summary: { 'v(out)': { min: 0, max: 4.97 } } } })).length === 0)
  got.length = 0
  const pngEnv = env({ artifacts: [{ name: 'waveform.png', mime: 'image/png', b64: 'iVBOR', bytes: 5 }] })
  const e1 = emitArtifacts(sink, 'spice', pngEnv, 'v1')
  const e2 = emitArtifacts(sink, 'spice', pngEnv, 'v2', { id: e1.id!, kind: e1.kind! })
  const e3 = emitArtifacts(sink, 'pde', env({ artifacts: [{ name: 'f.mp4', mime: 'video/mp4', b64: 'AA', bytes: 2 }] }), 'c', { id: e1.id!, kind: e1.kind! })
  add('recall-replaces-picture', e2.id === e1.id && got[1].id === e1.id && e3.id !== e1.id, `${e1.id} ${e2.id} ${e3.id}`)
  const cs = compactDef(all.find(t => t.def.name === 'circuit_sim')!).description
  add('circuit-sim-says-resistors-only', /resistors only|RESISTORS only/i.test(cs) && /circuit_spice/.test(cs), cs)
  add('python-ffmpeg-not-offered', !BENCH_DEFS.some(d => d.tool === 'python' || d.tool === 'ffmpeg'), 'run_python covers python; ffmpeg takes base64 media')
  return out
}

/** Async bench case: the remote wrapper turns a prepare error into a tool error without touching the network. */
export async function benchAsyncCases(): Promise<LiveCase[]> {
  const out: LiveCase[] = []
  const spec = withBench(() => remoteTools().find(t => t.def.name === 'symbolic_math'))
  const r = spec ? await spec.run({ op: 'solve' }, {} as never) as { error?: string } : null
  out.push({ id: 'bench-wrapper-prepare-error', group: 'static', pass: !!r?.error && /expr/.test(r.error), detail: JSON.stringify(r) })
  return out
}

/** Atomic structure (owner report 2026-10-10: "can't teach atomic structure"): exact atoms, isotopes, ions, routing. */
export function atomCases(): LiveCase[] {
  const out: LiveCase[] = []
  const add = (id: string, pass: boolean, detail = '') => out.push({ id: `atom-${id}`, group: 'static', pass, detail })
  const cfg = (e: string) => atomSpec({ element: e }).spec!.shells.join(',')
  add('shells', cfg('beryllium') === '2,2' && cfg('Na') === '2,8,1' && cfg('17') === '2,8,7' && cfg('oxygen') === '2,6' && cfg('calcium') === '2,8,8,2' && cfg('iron') === '2,8,14,2', ['beryllium', 'Na', '17', 'oxygen', 'calcium', 'iron'].map(cfg).join(' | '))
  const c14 = atomSpec({ element: 'carbon', mass: 14 }).spec!
  add('isotope', c14.protons === 6 && c14.neutrons === 8 && c14.electrons === 6 && !!atomSpec({ element: 'carbon', mass: 3 }).error, JSON.stringify({ p: c14.protons, n: c14.neutrons }))
  const cl = atomSpec({ element: 'Cl', charge: -1 }).spec!, na = atomSpec({ element: 'sodium', charge: 1 }).spec!
  add('ions', cl.electrons === 18 && cl.shells.join() === '2,8,8' && na.shells.join() === '2,8', `${cl.shells} / ${na.shells}`)
  const all = Array.from({ length: 36 }, (_, i) => atomSpec({ element: i + 1 }).spec!)
  add('drawn-matches-computed', all.every(s => drawnElectrons(atomSvg(s)) === s.electrons && s.shells.reduce((a, b) => a + b, 0) === s.electrons && /viewBox=/.test(atomSvg(s))), 'Z 1-36')
  add('school-rule', shellConfig(19).join() === '2,8,8,1' && shellConfig(20).join() === '2,8,8,2')
  add('element-in-text', elementInText('Let us place three electrons for lithium')?.element === 'lithium' && elementInText('carbon-14 is an isotope')?.mass === 14 && elementInText('chlorine, which has an atomic number of 17')?.element === '17' && elementInText('the heart pumps blood') === null)
  const pick = (text: string, x: Partial<Parameters<typeof selectLoadout>[1]> = {}) => withBench(() => selectLoadout(toolsFor({ mode: 'chat', restricted: false }), { text, live: true, ...x }).map(t => t.def.name))
  const a1 = pick('how many electrons go in the outer shell of sodium?', { signal: 'message' })
  const a2 = pick('', { signal: 'answer', topic: '"Atomic Structure and Valence Electrons"' })
  const a3 = pick('isotopes of carbon, protons and neutrons')
  add('loadout', a1.includes('atom_diagram') && a2.includes('atom_diagram') && a3.includes('atom_diagram') && [a1, a2, a3].every(l => l.length <= LOADOUT_MAX), `${a1} | ${a2} | ${a3}`)
  add('phet-build-an-atom-offered', pick('build an atom with protons neutrons and electrons').some(n => n === 'phet' || n === 'atom_diagram'), pick('build an atom with protons neutrons and electrons').join(','))
  return out
}

export function liveStaticCases(): LiveCase[] {
  return [...policyCases(), ...routerCases(), ...loadoutCases(), ...busyCases(), ...circuitCases(), ...selfCheckCases(), ...benchCases(), ...atomCases()]
}

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
import { selectLoadout, compactDef, LOADOUT_MAX } from './registry'
import { toolsFor } from '@/lib/agent/tools'
import { checkLearnerClaim, answerFromShown } from './busy'
import { readVisual } from '@/lib/visual-policy'
import { parseCircuit, solveCircuit, circuitNetlist, checkReadings } from './tools/circuit-net'
import { geometryCheck } from './selfcheck'
import type { Block } from '@/lib/agent/types'
import { DECIDE_TOOL, LIVE_SYSTEM } from './agent'

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

export function liveStaticCases(): LiveCase[] {
  return [...policyCases(), ...routerCases(), ...loadoutCases(), ...busyCases(), ...circuitCases(), ...selfCheckCases()]
}

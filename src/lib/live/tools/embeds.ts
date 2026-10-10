/**
 * External stage tools: free / non-commercial embeds the tutor can mount on any stage (lesson, sheet, Ask) and read
 * back. Each is an ordinary registry tool (ToolSpec): the server validates the spec (and solves what it can, so the
 * tutor talks from checked numbers), emits an `embed` block, and returns what the learner now sees. The browser
 * adapter (components/live/embeds/*) mounts it, streams learner changes back as signals, and reports its own
 * render check (a 'stage' signal) so the agent can observe and revise.
 *
 * Licences (checked 2026-10-10; Ideanimo is free and non-commercial):
 *   circuit_sim   Falstad CircuitJS1, GPL-2+, self-hosted unmodified in /public/circuitjs (separate iframe app)
 *   molecule_3d   3Dmol.js, BSD-3; structures from PubChem (public)
 *   diagram       Mermaid, MIT
 *   physics_sim   Matter.js, MIT
 *   geogebra      GeoGebra Apps API: free for non-commercial use with attribution; switch GEOGEBRA_ENABLED=0 turns it off
 *   phet          PhET sims: embed only (no PhET-iO); attribution shown; CC BY 4.0 (pre-2026-03-29 versions) / CC BY-NC 4.0
 *   desmos        Desmos API, trial key (non-commercial); offered only while NEXT_PUBLIC_DESMOS_API_KEY is set
 */
import { randomUUID } from 'node:crypto'
import type { AgentCtx, ToolSpec } from '@/lib/agent/tools'
import type { Block } from '@/lib/agent/types'
import { circuitNetlist, parseCircuit, solveCircuit } from './circuit-net'
import { PHET_SIMS, PHYSICS_KINDS, phetSim, type EmbedKind } from './embed-meta'

const bid = () => randomUUID().slice(0, 8)
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
const str = (v: unknown, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

function emitEmbed(ctx: AgentCtx, tool: EmbedKind, spec: Record<string, unknown>, title: string, alt: string): Block {
  const b = { kind: 'embed', id: `e${bid()}`, tool, spec, title, alt } as Block
  ctx.emit(b)
  return b
}

export const geogebraEnabled = () => (process.env.GEOGEBRA_ENABLED ?? '1') !== '0'
export const desmosEnabled = () => !!(process.env.NEXT_PUBLIC_DESMOS_API_KEY ?? '').trim()

const circuitSim: ToolSpec = {
  def: {
    name: 'circuit_sim',
    description: 'A LIVE circuit simulator (Falstad) with moving current dots: a battery and resistors in series, in parallel or mixed. Returns every resistor\'s exact V and I (talk from these numbers). Use for any circuit question, KVL/KCL, series vs parallel.',
    parameters: obj({
      volts: { type: 'number' },
      parts: { type: 'array', description: 'the loop in order; each part {"r":{"label":"R1","ohms":4}} or {"parallel":[[{"label":"R2","ohms":6}],[{"label":"R3","ohms":3}]]} (arms in parallel, each a series list)', items: { type: 'object' } },
      title: { type: 'string' },
    }, ['volts', 'parts']),
  },
  tier: 'visual', modes: ['chat'], label: 'Building a live circuit',
  run: async (a, ctx) => {
    const p = parseCircuit(a)
    if (!p.spec) return { error: p.error }
    const sol = solveCircuit(p.spec)
    const title = p.spec.title || `${sol.topology === 'series' ? 'Series' : sol.topology === 'parallel' ? 'Parallel' : 'Series–parallel'} circuit, ${p.spec.volts} V`
    const b = emitEmbed(ctx, 'circuit', { netlist: circuitNetlist(p.spec), solution: sol, circuit: p.spec }, title, `${title}: ${sol.resistors.map(r => `${r.label} ${r.ohms} Ω`).join(', ')}`)
    return { shown: true, id: b.id, topology: sol.topology, equivalent_ohms: sol.req, battery_current_amps: sol.current, resistors: sol.resistors, note: 'Numbers are exact. The simulator\'s own readings are compared with them in the browser; a mismatch comes back as a stage signal.' }
  },
}

const molecule3d: ToolSpec = {
  def: {
    name: 'molecule_3d',
    description: 'A rotatable 3D molecule (3Dmol.js, structure from PubChem): water, methane, glucose, caffeine, ATP, DNA bases… Use for shape, bonds, polarity, isomers.',
    parameters: obj({ name: { type: 'string', description: 'compound name PubChem knows' }, style: { type: 'string', enum: ['stick', 'sphere', 'ballstick'] }, labels: { type: 'boolean', description: 'label atoms by element' }, title: { type: 'string' } }, ['name']),
  },
  tier: 'visual', modes: ['chat'], label: 'Fetching a 3D molecule',
  run: async (a, ctx) => {
    const name = str(a.name, 80)
    if (!name) return { error: 'name is required' }
    let cid: number | null = null, formula = ''
    try {
      const r = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/property/MolecularFormula,IUPACName/JSON`, { signal: AbortSignal.timeout(8000) })
      if (r.ok) { const j = await r.json() as { PropertyTable?: { Properties?: { CID: number; MolecularFormula?: string }[] } }; const p = j.PropertyTable?.Properties?.[0]; cid = p?.CID ?? null; formula = p?.MolecularFormula ?? '' }
    } catch { /* below */ }
    if (!cid) return { error: `PubChem does not know "${name}". Use a common or IUPAC name.` }
    const title = str(a.title, 80) || `${name[0].toUpperCase()}${name.slice(1)}${formula ? ` (${formula})` : ''}`
    const b = emitEmbed(ctx, 'molecule', { cid, name, style: ['stick', 'sphere', 'ballstick'].includes(String(a.style)) ? a.style : 'ballstick', labels: !!a.labels }, title, `3D model of ${name}${formula ? `, ${formula}` : ''}`)
    return { shown: true, id: b.id, cid, formula, note: 'The learner can rotate and zoom it. Some compounds have no 3D record; then a 2D layout shows (reported back).' }
  },
}

const DIAGRAM_START = /^(flowchart|graph|sequenceDiagram|stateDiagram(-v2)?|classDiagram|mindmap|timeline|erDiagram|pie|journey|gantt|block-beta|quadrantChart)\b/

const diagram: ToolSpec = {
  def: {
    name: 'diagram',
    description: 'A clean diagram from Mermaid code: cycles and processes (Krebs cycle, water cycle, cell cycle as flowchart LR with a loop), steps, concept maps (mindmap), timelines, state machines. Short node labels; ≤ 20 nodes.',
    parameters: obj({ code: { type: 'string', description: 'Mermaid source, starting with flowchart/graph/mindmap/timeline/sequenceDiagram/stateDiagram-v2' }, title: { type: 'string' } }, ['code', 'title']),
  },
  tier: 'visual', modes: ['chat'], label: 'Drawing a diagram',
  run: async (a, ctx) => {
    const code = str(a.code, 4000).replace(/^```(?:mermaid)?\s*/i, '').replace(/```\s*$/, '').trim()
    if (!DIAGRAM_START.test(code)) return { error: 'code must start with flowchart, graph, mindmap, timeline, sequenceDiagram or stateDiagram-v2' }
    const lines = code.split('\n').length
    if (lines > 60) return { error: 'too long: keep it under 60 lines and 20 nodes' }
    if (/click\s|href|javascript:|<script/i.test(code)) return { error: 'no links, clicks or scripts in diagrams' }
    const title = str(a.title, 80) || 'Diagram'
    const b = emitEmbed(ctx, 'mermaid', { code }, title, title)
    return { shown: true, id: b.id, note: 'If Mermaid cannot parse it, a stage signal comes back with the parse error: fix and call again.' }
  },
}

const physicsSim: ToolSpec = {
  def: {
    name: 'physics_sim',
    description: `A 2D rigid-body physics sandbox (Matter.js) with real gravity, friction and collisions; the learner can drag bodies and change sliders, readouts update live. Kinds: ${Object.entries(PHYSICS_KINDS).map(([k, v]) => `${k} (${v.params.join(', ')})`).join('; ')}.`,
    parameters: obj({ kind: { type: 'string', enum: Object.keys(PHYSICS_KINDS) }, params: { type: 'object', description: 'numbers for the kind\'s parameters' }, title: { type: 'string' } }, ['kind']),
  },
  tier: 'visual', modes: ['chat'], label: 'Setting up a physics sandbox',
  run: async (a, ctx) => {
    const kind = String(a.kind ?? '') as keyof typeof PHYSICS_KINDS
    const k = PHYSICS_KINDS[kind] as { title: string; params: readonly string[]; defaults: Record<string, number>; range: Record<string, readonly [number, number]> } | undefined
    if (!k) return { error: `kind must be one of ${Object.keys(PHYSICS_KINDS).join(', ')}` }
    const params: Record<string, number> = { ...k.defaults }
    const given = (a.params && typeof a.params === 'object' ? a.params : {}) as Record<string, unknown>
    for (const p of k.params) { const v = Number(given[p]); if (Number.isFinite(v)) params[p] = Math.min(k.range[p][1], Math.max(k.range[p][0], v)) }
    const title = str(a.title, 80) || k.title
    const b = emitEmbed(ctx, 'physics', { kind, params }, title, `${title} (live physics)`)
    return { shown: true, id: b.id, params, sliders: k.params, note: 'Slider changes and drags come back as learner signals with the new values.' }
  },
}

const geogebra: ToolSpec = {
  def: {
    name: 'geogebra',
    description: 'A live GeoGebra construction (graphing, geometry or 3D) built with GeoGebra commands, e.g. ["A=(1,2)","B=(4,0)","s=Segment(A,B)","a=Slider(0,5,0.1)","f(x)=a*x^2"]. The learner can drag points and sliders; values come back. Use for exact geometry, loci, transformations, function families.',
    parameters: obj({ app: { type: 'string', enum: ['graphing', 'geometry', '3d'] }, commands: { type: 'array', items: { type: 'string' }, maxItems: 25 }, watch: { type: 'array', items: { type: 'string' }, maxItems: 6, description: 'object names whose values to read back (points, numbers, sliders)' }, title: { type: 'string' } }, ['commands']),
  },
  tier: 'visual', modes: ['chat'], label: 'Building a GeoGebra figure',
  run: async (a, ctx) => {
    if (!geogebraEnabled()) return { error: 'GeoGebra is switched off here. Use interactive or desmos instead.' }
    const commands = (Array.isArray(a.commands) ? a.commands : []).map(c => str(c, 200)).filter(Boolean).slice(0, 25)
    if (!commands.length) return { error: 'commands: at least one GeoGebra command' }
    if (commands.some(c => /javascript|Execute\s*\[|SetValue\s*\(\s*\w+\s*,\s*"|<|>\s*</i.test(c))) return { error: 'no Execute or script commands' }
    const app = ['graphing', 'geometry', '3d'].includes(String(a.app)) ? String(a.app) : 'graphing'
    const title = str(a.title, 80) || 'GeoGebra figure'
    const b = emitEmbed(ctx, 'geogebra', { app, commands, watch: (Array.isArray(a.watch) ? a.watch : []).map(w => str(w, 30)).filter(Boolean).slice(0, 6) }, title, title)
    return { shown: true, id: b.id, note: 'Commands that GeoGebra rejects come back as a stage signal; learner drags come back as slider signals.' }
  },
}

const phet: ToolSpec = {
  def: {
    name: 'phet',
    description: `Embed a PhET simulation (University of Colorado Boulder) for the learner to explore. Embed only: you cannot drive it or read it, so give the learner one concrete thing to try and ask what they see. Sims: ${PHET_SIMS.map(s => s.slug).join(', ')}.`,
    parameters: obj({ sim: { type: 'string', enum: PHET_SIMS.map(s => s.slug) }, task: { type: 'string', description: 'what the learner should try in it (one sentence)' } }, ['sim', 'task']),
  },
  tier: 'visual', modes: ['chat'], label: 'Opening a PhET simulation',
  run: async (a, ctx) => {
    const s = phetSim(String(a.sim ?? ''))
    if (!s) return { error: `sim must be one of ${PHET_SIMS.map(x => x.slug).join(', ')}` }
    const b = emitEmbed(ctx, 'phet', { slug: s.slug, url: s.url, task: str(a.task, 200), licence: s.licence }, s.title, `PhET simulation: ${s.title}`)
    return { shown: true, id: b.id, title: s.title, note: 'Embed only (no read-back). Ask the learner what they observe.' }
  },
}

const desmos: ToolSpec = {
  def: {
    name: 'desmos',
    description: 'A live Desmos graph: expressions in LaTeX (y=a x^2, sliders like a=2), optional bounds. The learner can edit and drag; their edits come back as signals. Best for function families and transformations.',
    parameters: obj({ expressions: { type: 'array', maxItems: 12, items: { type: 'object', properties: { id: { type: 'string' }, latex: { type: 'string' }, min: { type: 'number' }, max: { type: 'number' } }, required: ['latex'] } }, bounds: { type: 'object', properties: { left: { type: 'number' }, right: { type: 'number' }, bottom: { type: 'number' }, top: { type: 'number' } } }, watch: { type: 'array', items: { type: 'string' }, maxItems: 4, description: 'expressions to read back (helper expressions), e.g. "a"' }, title: { type: 'string' } }, ['expressions']),
  },
  tier: 'visual', modes: ['chat'], label: 'Building a Desmos graph',
  run: async (a, ctx) => {
    if (!desmosEnabled()) return { error: 'Desmos is not available here. Use interactive or geogebra.' }
    const exprs = (Array.isArray(a.expressions) ? a.expressions : []).slice(0, 12).map((e, i) => {
      const o = (e ?? {}) as Record<string, unknown>
      return { id: str(o.id, 20) || `e${i + 1}`, latex: str(o.latex, 300), ...(Number.isFinite(Number(o.min)) && Number.isFinite(Number(o.max)) ? { min: Number(o.min), max: Number(o.max) } : {}) }
    }).filter(e => e.latex)
    if (!exprs.length) return { error: 'expressions: at least one {latex}' }
    const bounds = a.bounds && typeof a.bounds === 'object' ? a.bounds : undefined
    const title = str(a.title, 80) || 'Graph'
    const b = emitEmbed(ctx, 'desmos', { expressions: exprs, bounds, watch: (Array.isArray(a.watch) ? a.watch : []).map(w => str(w, 20)).filter(Boolean) }, title, title)
    return { shown: true, id: b.id, note: 'Learner edits come back as signals; the graph is screenshotted for the visual check.' }
  },
}

/** The external stage tools that are switched on in this deployment. */
export function embedTools(): ToolSpec[] {
  return [circuitSim, molecule3d, diagram, physicsSim, ...(geogebraEnabled() ? [geogebra] : []), phet, ...(desmosEnabled() ? [desmos] : [])]
}

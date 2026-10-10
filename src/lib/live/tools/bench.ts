/**
 * The Modal tool bench (app "geniusmap-toolbench", lib/toolbench/client.ts, contract in lib/toolbench/TOOLBENCH.md)
 * wired into the ONE tool registry as remote tools (registerRemoteTool): prepare → run → validate → fallback.
 *
 * Each bench tool becomes an ordinary agent tool with a one-line description and a small schema (free-tier fit). The
 * per-call loadout (registry.ts selectLoadout, ≤ LOADOUT_MAX) decides whether the agent can see one in a given call:
 * topics are narrow on purpose so the browser embeds (circuit_sim, molecule_3d, diagram…) stay first for what they
 * already do well, and a bench tool appears when the lesson or the learner needs what only it can do (transients,
 * exact symbolic work, ODEs, heat flow, unit checks…).
 *
 * Output: artifacts become stage blocks (png → image, svg → svg, mp4 → clip); the model only ever sees a compact,
 * learner-safe summary (no base64), the bench's own validation (checks) and, on failure, the registry tool to try next.
 *
 * Not offered to the agent: `python` (run_python already covers it), `ffmpeg` (media plumbing: its inputs are base64
 * videos a model cannot write). Both stay callable from server code through lib/toolbench/client.ts.
 *
 * Switches: the tools exist only while TOOLBENCH_URL + TOOLBENCH_TOKEN are set; TOOLBENCH_LIVE=0 hides them all.
 * Per agent run at most BENCH_MAX_PER_RUN calls (cost + latency guard; each call is ~$0.00001-0.0003 of Modal CPU).
 */
import { randomUUID } from 'node:crypto'
import type { AgentCtx } from '@/lib/agent/tools'
import type { Block } from '@/lib/agent/types'
import { runTool, toolbenchConfigured, TOOLBENCH_GROUP, TOOLBENCH_LATENCY, type ToolbenchResult, type ToolbenchTool } from '@/lib/toolbench/client'
import { registerRemoteTool, type RemoteToolContract } from '../remote'

const bid = () => randomUUID().slice(0, 8)
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
const str = (v: unknown, n = 400) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)
const clamp = (v: number | undefined, lo: number, hi: number) => (v === undefined ? undefined : Math.min(hi, Math.max(lo, v)))

export const BENCH_MAX_PER_RUN = 3
/** Largest mp4 placed inline as a clip (data URL); bigger clips are dropped with a note. */
const MAX_INLINE_MP4 = 2_500_000

export const benchEnabled = () => toolbenchConfigured() && !/^(0|off|false)$/i.test((process.env.TOOLBENCH_LIVE ?? '1').trim())

/** Bench fallbacks name another bench tool or a browser embed ('client:<embed>'): map them to registry tool names. */
const CLIENT_FALLBACK: Record<string, string> = { 'client:circuitjs': 'circuit_sim', 'client:3dmol': 'molecule_3d', 'client:mermaid': 'diagram', 'client:katex': 'compute', 'client:three': 'show_scene' }

/** Registry name for each bench tool the agent may call. */
export const BENCH_NAMES: Partial<Record<ToolbenchTool, string>> = {
  sympy: 'symbolic_math', numeric: 'numeric_solve', chart: 'data_chart', units: 'unit_check', z3: 'logic_check',
  octave: 'octave_run', spice: 'circuit_spice', molecule: 'molecule_props', pde: 'heat_diffusion', graphviz: 'graph_draw',
  plantuml: 'uml_diagram', latex: 'tikz_figure', manim: 'manim_clip', blender: 'render_3d',
}
const BY_NAME = new Map(Object.entries(BENCH_NAMES).map(([t, n]) => [n as string, t as ToolbenchTool]))
export const benchToolOf = (registryName: string): ToolbenchTool | null => BY_NAME.get(registryName) ?? null
export function fallbackName(f: ToolbenchResult['fallback']): string | null {
  if (!f?.tool) return null
  if (CLIENT_FALLBACK[f.tool]) return CLIENT_FALLBACK[f.tool]
  return BENCH_NAMES[f.tool as ToolbenchTool] ?? null
}

/* ───────────── compact results (what the model sees) ───────────── */

/** Shrinks a bench result for the model: long numeric arrays → {n, first, last, min, max}; long strings cut. */
export function compactResult(v: unknown, depth = 0): unknown {
  if (v === null || typeof v !== 'object') return typeof v === 'string' ? v.slice(0, 600) : typeof v === 'number' ? Number(v.toPrecision(6)) : v
  if (depth > 4) return '…'
  if (Array.isArray(v)) {
    if (v.length > 12 && v.every(x => typeof x === 'number')) {
      const a = v as number[]
      const r = (x: number) => Number(x.toPrecision(5))
      return { n: a.length, first: r(a[0]), last: r(a[a.length - 1]), min: r(Math.min(...a)), max: r(Math.max(...a)) }
    }
    return v.slice(0, 12).map(x => compactResult(x, depth + 1))
  }
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (/^(vega_lite|svg|b64|png|mp4|molblock|frames)$/i.test(k)) continue
    out[k] = compactResult(x, depth + 1)
  }
  return out
}

/** The bench's own validation flags (e.g. sympy checks.residuals_zero): any false one is an issue for the model. */
export function checkIssues(r: ToolbenchResult): string[] {
  const issues: string[] = []
  const checks = (r.result as { checks?: Record<string, unknown> } | null)?.checks
  if (checks) for (const [k, v] of Object.entries(checks)) if (v === false) issues.push(`bench check failed: ${k.replace(/_/g, ' ')}`)
  const res = r.result as Record<string, unknown> | null
  if (res && res.consistent === false) issues.push('units do not match: the two sides have different dimensions')
  if (res && res.proved === false) issues.push('the claim is false (see counterexample)')
  if (/maximum.principle|non-physical/i.test(r.logs ?? '')) issues.push(r.logs.slice(0, 160))
  return issues
}

/* ───────────── artifacts → stage blocks ───────────── */

/** Puts the bench artifacts on the stage as ordinary blocks; returns what was shown. */
export function emitArtifacts(ctx: Pick<AgentCtx, 'emit'>, tool: ToolbenchTool, r: ToolbenchResult, caption: string): { shown: string[]; dropped: string[] } {
  const shown: string[] = []
  const dropped: string[] = []
  const pngs = r.artifacts.filter(a => a.mime === 'image/png' && a.b64)
  const svgs = r.artifacts.filter(a => a.mime === 'image/svg+xml' && a.text)
  const mp4 = r.artifacts.find(a => a.mime === 'video/mp4' && a.b64)
  // One picture per call: an animation if there is one, else the SVG (crisp on phones), else the first PNG.
  if (mp4) {
    if (mp4.b64!.length <= MAX_INLINE_MP4) {
      const b: Block = { kind: 'clip', id: `k${bid()}`, jobId: `bench-${bid()}`, status: 'done', url: `data:video/mp4;base64,${mp4.b64}`, caption }
      ctx.emit(b); shown.push('clip')
    } else dropped.push(`${mp4.name} too large to show inline`)
    const still = pngs.find(a => /last_frame|first_frame/.test(a.name))
    if (still && !shown.length) { ctx.emit({ kind: 'image', id: `i${bid()}`, png: still.b64!, caption }); shown.push('image') }
  } else if (svgs.length) {
    const svg = svgs[0].text!
    if (/<svg[\s>]/i.test(svg) && !/<script|\son\w+\s*=|javascript:/i.test(svg)) {
      ctx.emit({ kind: 'svg', id: `v${bid()}`, svg: withViewBox(svg), alt: caption })
      shown.push('svg')
    } else dropped.push('svg failed the safety check')
  }
  if (!shown.length && pngs.length) {
    const p = pngs.find(a => !/first_frame/.test(a.name)) ?? pngs[0]
    ctx.emit({ kind: 'image', id: `i${bid()}`, png: p.b64!, caption })
    shown.push('image')
  }
  return { shown, dropped }
}

/** Graphviz / dvisvgm SVGs carry width/height in pt; make sure a viewBox exists so phones can scale them. */
export function withViewBox(svg: string): string {
  if (/viewBox=/.test(svg)) return svg
  const w = /<svg[^>]*\swidth="([\d.]+)(?:pt|px)?"/.exec(svg)?.[1]
  const h = /<svg[^>]*\sheight="([\d.]+)(?:pt|px)?"/.exec(svg)?.[1]
  return w && h ? svg.replace(/<svg/, `<svg viewBox="0 0 ${w} ${h}"`) : svg
}

/** Who started a bench call: the learner (typed a request for that kind of work) or the agent on its own. */
export function benchInitiated(signal: { kind: string; detail?: string | null }): 'prompted' | 'agent' {
  return signal.kind === 'message' && /\b(calculat|comput|check|verify|simulat|plot|graph|chart|solve|convert|draw|animat|render|prove)\w*/i.test(signal.detail ?? '') ? 'prompted' : 'agent'
}

/* ───────────── the generic contract ───────────── */

const used = new WeakMap<object, number>()
/** One bench call for this agent run, or false when the run already used BENCH_MAX_PER_RUN. */
export function takeBenchSlot(ctx: object): boolean {
  const n = used.get(ctx) ?? 0
  if (n >= BENCH_MAX_PER_RUN) return false
  used.set(ctx, n + 1)
  return true
}

interface BenchDef {
  tool: ToolbenchTool
  short: string
  parameters: Record<string, unknown>
  renderer: RemoteToolContract['renderer']
  topics: RegExp
  fallback?: string
  notLive?: boolean
  signals?: RemoteToolContract['signals']
  verifies?: boolean
  /** Shape the model's args into the bench's args (or say what is wrong). */
  shape: (a: Record<string, unknown>) => { args?: Record<string, unknown>; error?: string }
  caption: (a: Record<string, unknown>) => string
}

export function benchContract(d: BenchDef): RemoteToolContract {
  const name = BENCH_NAMES[d.tool]!
  const slow = TOOLBENCH_LATENCY[d.tool].warm > 2500
  return {
    name, short: d.short, parameters: d.parameters, renderer: d.renderer, cost: 'modal-cpu', latency: slow ? 'slow' : 'fast',
    topics: d.topics, fallback: d.fallback, notLive: d.notLive, signals: d.signals, verifies: d.verifies, enabled: benchEnabled,
    prepare: a => d.shape(a),
    run: async (args, ctx) => {
      if (!takeBenchSlot(ctx)) return { error: `Tool bench limit for this turn (${BENCH_MAX_PER_RUN}) reached.${d.fallback ? ` Use ${d.fallback}` : ' Explain in words'} instead.` }
      const r = await runTool(d.tool, args as never, { lessonId: ctx.lessonId ?? null, surface: ctx.lessonId ? 'lesson' : 'ask' }, { timeoutMs: Math.min(38_000, TOOLBENCH_LATENCY[d.tool].cold + 25_000) })
      ctx.trace.push(`bench ${d.tool}: ${r.ok ? 'ok' : `fail ${String(r.error).slice(0, 80)}`} ${r.ms} ms${r.warm === false ? ' (cold)' : ''}`)
      const rec = { tool: name, ok: r.ok, ms: r.ms, cold: r.warm === false, shown: [] as string[], issues: 0, ...(r.ok ? {} : { error: String(r.error ?? '').slice(0, 120) }) }
      ;(ctx.benchCalls ??= []).push(rec)
      if (!r.ok) {
        const fb = fallbackName(r.fallback) ?? d.fallback ?? null
        return { error: `${name}: ${String(r.error ?? 'failed').slice(0, 220)}${fb ? `. Try ${fb} instead${r.fallback?.reason ? ` (${r.fallback.reason.slice(0, 100)})` : ''}.` : ''}`, fallback: fb }
      }
      const { shown, dropped } = emitArtifacts(ctx, d.tool, r, d.caption(args).slice(0, 120))
      rec.shown = shown
      rec.issues = checkIssues(r).length
      return {
        ok: true, tool: name, shown_to_learner: shown, result: compactResult(r.result), checks: (r.result as { checks?: unknown } | null)?.checks ?? undefined,
        bench_issues: checkIssues(r), notes: [r.logs?.slice(0, 160), ...dropped].filter(Boolean), ms: r.ms,
        say: checkIssues(r).length ? 'The bench flagged issues (bench_issues): fix the arguments and call again, or use another tool.' : shown.length ? 'Talk from these numbers and the picture now on the stage.' : 'Checked, nothing shown yet: use these numbers, or show them with a visual tool.',
      }
    },
    validate: (res: unknown) => {
      const r = res as { bench_issues?: string[]; error?: string } | null
      return r && !r.error && Array.isArray(r.bench_issues) ? r.bench_issues : []
    },
  }
}

/* ───────────── the bench tools ───────────── */

const SYMPY_OPS = ['simplify', 'expand', 'factor', 'solve', 'diff', 'integrate', 'limit', 'series', 'evaluate', 'plot']

export const BENCH_DEFS: BenchDef[] = [
  {
    tool: 'sympy', renderer: 'data', fallback: 'compute', signals: ['answer', 'message'], verifies: true,
    short: 'Exact symbolic maths (SymPy): solve (roots checked by substitution), factor, expand, diff, integrate, limit, series, plot.',
    parameters: obj({ op: { type: 'string', enum: SYMPY_OPS }, expr: { type: 'string', description: 'e.g. "x^2-5x+6=0", "sin(x)*x"' }, var: { type: 'string' }, lower: { type: 'string' }, upper: { type: 'string' }, to: { type: 'string', description: 'limit point' } }, ['op', 'expr']),
    topics: /integrat|antideriv|\blimit|series|taylor|factori[sz]|expand|simplif|quadratic|polynomial|roots? of|solv(e|ing)|equations?|simultaneous|algebra|expression|differentiat|derivative|d\/dx|indices|surds?|logarithm/i,
    shape: a => {
      const expr = str(a.expr, 1000)
      if (!expr) return { error: 'expr is required, e.g. "x^2-5x+6=0"' }
      const op = SYMPY_OPS.includes(String(a.op)) ? String(a.op) : 'simplify'
      const args: Record<string, unknown> = { op, expr }
      if (str(a.var, 8)) args.var = str(a.var, 8)
      if (str(String(a.lower ?? ''), 40) && str(String(a.upper ?? ''), 40)) { args.lower = String(a.lower).slice(0, 40); args.upper = String(a.upper).slice(0, 40) }
      if (a.to !== undefined) args.to = String(a.to).slice(0, 40)
      return { args }
    },
    caption: a => `${a.op}: ${a.expr}`,
  },
  {
    tool: 'numeric', renderer: 'image',
    short: 'Numerical maths (SciPy) with a graph: op ode (dy/dt systems, e.g. decay, cooling, populations), fit (best-fit line/curve), stats, roots.',
    parameters: obj({ op: { type: 'string', enum: ['ode', 'fit', 'stats', 'roots'] }, rhs: { type: 'array', items: { type: 'string' }, description: 'ode: right-hand sides in t and vars, e.g. ["-0.3*y"]' }, vars: { type: 'array', items: { type: 'string' } }, y0: { type: 'array', items: { type: 'number' } }, t1: { type: 'number' }, x: { type: 'array', items: { type: 'number' } }, y: { type: 'array', items: { type: 'number' } }, data: { type: 'array', items: { type: 'number' } }, coeffs: { type: 'array', items: { type: 'number' } } }, ['op']),
    topics: /differential equation|dy\/dt|d[xyn]\/dt|rate of change|radioactive|decay|half.?life|newton'?s law of cooling|cooling curve|logistic|population (growth|model)|best.?fit|regression|line of best fit|standard deviation|variance|\bmean\b|median/i,
    shape: a => {
      const op = String(a.op)
      const nums = (v: unknown, n = 400) => (Array.isArray(v) ? v.map(Number).filter(Number.isFinite).slice(0, n) : [])
      if (op === 'ode') {
        const rhs = (Array.isArray(a.rhs) ? a.rhs : [a.rhs]).map(x => str(x, 300)).filter(Boolean).slice(0, 4)
        const y0 = nums(a.y0, 4)
        if (!rhs.length || y0.length !== rhs.length) return { error: 'ode needs rhs (one per variable) and y0 of the same length' }
        const vars = (Array.isArray(a.vars) ? a.vars.map(x => str(x, 8)) : []).filter(Boolean)
        return { args: { op, rhs, y0, ...(vars.length === rhs.length ? { vars } : {}), t1: clamp(num(a.t1), 0.01, 1e6) ?? 10 } }
      }
      if (op === 'fit') { const x = nums(a.x), y = nums(a.y); return x.length >= 2 && x.length === y.length ? { args: { op, x, y, deg: 1 } } : { error: 'fit needs x and y arrays of equal length (≥2)' } }
      if (op === 'stats') { const data = nums(a.data, 2000); return data.length ? { args: { op, data } } : { error: 'stats needs data' } }
      if (op === 'roots') { const coeffs = nums(a.coeffs, 12); return coeffs.length >= 2 ? { args: { op, coeffs } } : { error: 'roots needs polynomial coeffs, highest power first' } }
      return { error: 'op must be ode, fit, stats or roots' }
    },
    caption: a => (a.op === 'ode' ? `Solution of ${(a.rhs as string[]).join(', ')}` : a.op === 'fit' ? 'Line of best fit' : `Numerical ${a.op}`),
  },
  {
    tool: 'chart', renderer: 'image',
    short: 'A clean chart of real data (line, bar, scatter, area) from rows of numbers, e.g. rainfall by month or a survey.',
    parameters: obj({ rows: { type: 'array', items: { type: 'object' }, description: '[{"month":"Jan","mm":12}, …]' }, x: { type: 'string' }, y: { type: 'string' }, kind: { type: 'string', enum: ['line', 'bar', 'scatter', 'area'] }, title: { type: 'string' } }, ['rows']),
    topics: /bar chart|bar graph|pie chart|histogram|pictogram|table of (data|results)|survey|data set|frequency table|rainfall|temperature (data|readings)|results table|plot (the|these) (data|results|readings)/i,
    shape: a => {
      const rows = Array.isArray(a.rows) ? a.rows.filter(r => r && typeof r === 'object').slice(0, 200) : []
      if (rows.length < 2) return { error: 'rows needs at least 2 objects' }
      return { args: { rows, x: str(a.x, 40) || undefined, y: str(a.y, 40) || undefined, kind: ['line', 'bar', 'scatter', 'area'].includes(String(a.kind)) ? a.kind : 'bar', title: str(a.title, 80) || undefined } }
    },
    caption: a => str(a.title, 100) || 'Chart of the data',
  },
  {
    tool: 'units', renderer: 'data', fallback: 'compute', signals: ['answer', 'message'], verifies: true,
    short: 'Units (Pint): convert a quantity, check both sides of a formula have the same units, or compute with units.',
    parameters: obj({ op: { type: 'string', enum: ['convert', 'check', 'compute'] }, quantity: { type: 'string', description: 'convert: "72 km/h"' }, to: { type: 'string', description: '"m/s"' }, lhs: { type: 'string', description: 'check: "N*m"' }, rhs: { type: 'string', description: '"J"' }, expr: { type: 'string', description: 'compute: "2 kg * 9.8 m/s^2 * 3 m"' } }, ['op']),
    topics: /convert|units?\b|dimension(al)?|km\/h|m\/s|joules?|newtons?|watts?|kelvin|celsius|kwh|kilowatt|si unit|pascal|coulomb|ohms? to|grams? to|litres?|cm3|dm3/i,
    shape: a => {
      const op = String(a.op)
      if (op === 'convert') return str(a.quantity, 80) && str(a.to, 40) ? { args: { op, quantity: str(a.quantity, 80), to: str(a.to, 40) } } : { error: 'convert needs quantity and to' }
      if (op === 'check') return str(a.lhs, 120) && str(a.rhs, 120) ? { args: { op, lhs: str(a.lhs, 120), rhs: str(a.rhs, 120) } } : { error: 'check needs lhs and rhs' }
      if (op === 'compute') return str(a.expr, 200) ? { args: { op, expr: str(a.expr, 200), ...(str(a.to, 40) ? { to: str(a.to, 40) } : {}) } } : { error: 'compute needs expr' }
      return { error: 'op must be convert, check or compute' }
    },
    caption: a => `Units: ${a.quantity ?? a.expr ?? `${a.lhs} vs ${a.rhs}`}`,
  },
  {
    tool: 'z3', renderer: 'data', verifies: true,
    short: 'Logic/proof check (Z3): is a claim always true? Gives a counterexample when it is not; or finds integer/real solutions.',
    parameters: obj({ vars: { type: 'object', description: '{"n":"Int","x":"Real"}' }, constraints: { type: 'array', items: { type: 'string' }, description: 'python-like, e.g. "n > 0"' }, prove: { type: 'string', description: 'claim to prove, e.g. "n*n >= n"' } }, ['vars']),
    topics: /\bprove\b|proof|always true|for all|every (integer|number)|counter.?example|inequalit|truth table|logic gate|boolean/i,
    shape: a => {
      const vars = a.vars && typeof a.vars === 'object' ? Object.fromEntries(Object.entries(a.vars as Record<string, unknown>).filter(([k, v]) => /^[a-zA-Z_]\w{0,10}$/.test(k) && ['Int', 'Real', 'Bool'].includes(String(v))).slice(0, 8)) : {}
      if (!Object.keys(vars).length) return { error: 'vars like {"n":"Int"} are required' }
      const constraints = (Array.isArray(a.constraints) ? a.constraints : []).map(x => str(x, 200)).filter(Boolean).slice(0, 12)
      const prove = str(a.prove, 200)
      if (!constraints.length && !prove) return { error: 'give constraints or a claim to prove' }
      return { args: { vars, constraints, ...(prove ? { prove } : {}) } }
    },
    caption: a => (a.prove ? `Is it always true: ${a.prove}?` : 'Solving the constraints'),
  },
  {
    tool: 'octave', renderer: 'image', notLive: true,
    short: 'Run MATLAB-style Octave code; figures are shown as images.',
    parameters: obj({ code: { type: 'string' } }, ['code']),
    topics: /matlab|octave/i,
    shape: a => (str(a.code, 8000) ? { args: { code: str(a.code, 8000), timeout: 30 } } : { error: 'code is required' }),
    caption: () => 'Octave figure',
  },
  {
    tool: 'spice', renderer: 'image', fallback: 'circuit_sim', signals: ['answer', 'slider'], verifies: true,
    short: 'Real circuit simulation (ngspice): capacitors, inductors, diodes, RC charging, AC/filters. Netlist + analysis; graph of v(t) or gain.',
    parameters: obj({ netlist: { type: 'string', description: 'SPICE lines, ground is node 0, e.g. "V1 in 0 PULSE(0 5 0 1u 1u 10m 20m)\\nR1 in out 1k\\nC1 out 0 1u"' }, analysis: { type: 'string', description: '"op" | "tran 10u 5m" | "ac dec 20 10 100k"' }, probes: { type: 'array', items: { type: 'string' }, description: '["v(out)"]' } }, ['netlist']),
    topics: /capacitor|capacitance|inductor|inductance|\brc\b|\brl\b|\brlc\b|charging|discharg|transient|time constant|alternating current|\bac (circuit|voltage|supply)|frequency response|filter|diode|rectif|transistor|resonan|oscillosc|ngspice|spice/i,
    shape: a => {
      const netlist = str(a.netlist, 6000)
      if (!netlist) return { error: 'netlist is required' }
      if (!/^\s*[VI]\w*\s/im.test(netlist)) return { error: 'netlist needs a source (a line starting V… or I…)' }
      if (!/\s0(\s|$)/m.test(netlist)) return { error: 'netlist needs a ground: connect something to node 0' }
      const analysis = str(a.analysis, 60) || 'op'
      const probes = (Array.isArray(a.probes) ? a.probes : []).map(x => str(x, 24)).filter(Boolean).slice(0, 4)
      return { args: { netlist, analysis, ...(probes.length ? { probes } : {}) } }
    },
    caption: a => `Circuit simulation (${String(a.analysis ?? 'op').split(' ')[0]})${Array.isArray(a.probes) && a.probes.length ? `: ${(a.probes as string[]).join(', ')}` : ''}`,
  },
  {
    tool: 'molecule', renderer: 'svg', fallback: 'molecule_3d',
    short: 'A molecule\'s exact structure drawing and facts (RDKit): formula, molar mass, rings, H-bond donors/acceptors. Name or SMILES.',
    parameters: obj({ name: { type: 'string', description: 'e.g. "ethanol"' }, smiles: { type: 'string' } }),
    topics: /molar mass|molecular (mass|weight|formula)|relative formula mass|structural formula|displayed formula|skeletal|functional group|organic|alkanes?|alkenes?|alcohols?|carboxylic|esters?|isomers?|hydrogen bond|polymer/i,
    shape: a => {
      const name = str(a.name, 80), smiles = str(a.smiles, 300)
      return name || smiles ? { args: smiles ? { smiles } : { name } } : { error: 'give a name or SMILES' }
    },
    caption: a => `Structure of ${str(a.name, 60) || str(a.smiles, 60)}`,
  },
  {
    tool: 'pde', renderer: 'clip', signals: ['lost'],
    short: 'Heat flow / diffusion simulation (FiPy) in a rod (1D) or plate (2D) with a picture or short animation of temperature over time.',
    parameters: obj({ dims: { type: 'number', enum: [1, 2] }, ic: { type: 'string', enum: ['hot_center', 'hot_left', 'step'] }, D: { type: 'number', description: 'diffusivity, 0.1-5' }, bc: { type: 'string', enum: ['fixed0', 'insulated'] }, animate: { type: 'boolean' } }),
    topics: /heat (flow|transfer|conduct|spread)|conduction|conductor of heat|diffus|temperature (spread|distribution|gradient)|thermal|insulat|cooling of a rod/i,
    shape: a => ({ args: { dims: num(a.dims) === 1 ? 1 : 2, ic: ['hot_center', 'hot_left', 'step'].includes(String(a.ic)) ? a.ic : 'hot_center', D: clamp(num(a.D), 0.05, 5) ?? 1, bc: a.bc === 'insulated' ? 'insulated' : 'fixed0', steps: 120, n: 40, animate: a.animate !== false } }),
    caption: a => `Heat spreading through a ${num(a.dims) === 1 ? 'rod' : 'plate'}`,
  },
  {
    tool: 'graphviz', renderer: 'svg', fallback: 'diagram',
    short: 'A neat node-and-edge diagram from Graphviz DOT: trees, networks, state machines, family trees, hierarchies.',
    parameters: obj({ dot: { type: 'string', description: 'e.g. "digraph{A->B; A->C}"' }, engine: { type: 'string', enum: ['dot', 'neato', 'circo'] } }, ['dot']),
    topics: /graph theory|network|nodes?\b|vertices|edges\b|tree diagram|probability tree|family tree|hierarch|state (machine|diagram)|automat|shortest path|flowchart/i,
    shape: a => {
      const dot = str(a.dot, 6000)
      if (!/^\s*(strict\s+)?(di)?graph\b/i.test(dot)) return { error: 'dot must start with graph{…} or digraph{…}' }
      return { args: { dot, engine: ['dot', 'neato', 'circo'].includes(String(a.engine)) ? a.engine : 'dot' } }
    },
    caption: () => 'Diagram',
  },
  {
    tool: 'plantuml', renderer: 'svg', notLive: true, fallback: 'diagram',
    short: 'A UML diagram (PlantUML): sequence, class, activity or state diagram.',
    parameters: obj({ uml: { type: 'string', description: '"@startuml\\nA -> B: hello\\n@enduml"' } }, ['uml']),
    topics: /\buml\b|sequence diagram|class diagram|activity diagram/i,
    shape: a => (str(a.uml, 6000) ? { args: { uml: str(a.uml, 6000) } } : { error: 'uml is required' }),
    caption: () => 'UML diagram',
  },
  {
    tool: 'latex', renderer: 'svg', fallback: 'illustrate',
    short: 'A precise TikZ figure (LaTeX): ray diagrams, lenses, free-body diagrams, exact geometry. Pass the tikzpicture body.',
    parameters: obj({ tex: { type: 'string', description: 'TikZ commands, e.g. "\\\\draw[->] (0,0) -- (2,1);"' } }, ['tex']),
    topics: /ray diagram|convex|concave|lens|mirror|refraction|reflection of light|free.?body|resolving forces|tikz|latex/i,
    shape: a => {
      const tex = str(a.tex, 8000)
      if (!tex) return { error: 'tex is required' }
      return { args: { tex: /\\begin\{(tikzpicture|document)\}/.test(tex) ? tex : `\\begin{tikzpicture}\n${tex}\n\\end{tikzpicture}`, png: false } }
    },
    caption: () => 'Figure',
  },
  {
    tool: 'manim', renderer: 'clip', fallback: 'animate_concept',
    short: 'A short exact maths animation in seconds (Manim CE code, one Scene subclass): a graph transforming, a geometric proof.',
    parameters: obj({ code: { type: 'string', description: 'from manim import *\\nclass S(Scene):\\n  def construct(self): …' } }, ['code']),
    topics: /manim|visual proof|transform(ation)? of (the )?graph|pythagoras proof|unit circle|animate (the|this) (graph|curve|proof)/i,
    shape: a => {
      const code = str(a.code, 8000)
      if (!/class\s+\w+\s*\(\s*\w*Scene\s*\)/.test(code)) return { error: 'code needs a Scene subclass' }
      return { args: { code: /from manim import/.test(code) ? code : `from manim import *\n${code}`, quality: 'l', timeout: 30 } }
    },
    caption: () => 'Animation',
  },
  {
    tool: 'blender', renderer: 'image', fallback: 'show_scene',
    short: 'A rendered 3D picture or turntable of solid shapes (Blender): cube, sphere, cylinder, cone, torus, prisms for volume/surface area.',
    parameters: obj({ objects: { type: 'array', items: { type: 'object' }, description: '[{"type":"cylinder","location":[0,0,0],"scale":[1,1,2],"color":[0.2,0.4,1]}]' }, spin: { type: 'boolean', description: 'short turntable clip' } }, ['objects']),
    topics: /3d (shape|solid|model)|three.?dimensional|solid shapes?|cuboid|cylinder|cone\b|sphere|prism|pyramid|volume of|surface area|net of a/i,
    shape: a => {
      const types = ['cube', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'ico', 'monkey']
      const objects = (Array.isArray(a.objects) ? a.objects : []).filter(o => o && typeof o === 'object' && types.includes(String((o as { type?: unknown }).type))).slice(0, 8).map(o => ({ ...(o as object), spin: !!a.spin }))
      if (!objects.length) return { error: `objects needs at least one {type} of ${types.join('|')}` }
      return { args: { objects, frames: a.spin ? 24 : 1, width: 480, height: 270, samples: 12 } }
    },
    caption: a => `3D: ${(a.objects as { type: string }[]).map(o => o.type).join(', ')}`,
  },
]

let done = false
/** Registers every bench tool once (idempotent). Imported for its side effect by lib/agent/tools.ts. */
export function registerBenchTools() {
  if (done) return
  done = true
  for (const d of BENCH_DEFS) registerRemoteTool(benchContract(d))
}
registerBenchTools()

/** Warm the backend groups of the bench tools in a loadout (fire-and-forget; skips the 3-6 s cold start). */
export function benchGroupsFor(names: string[]): ('compute' | 'sci' | 'render')[] {
  const g = new Set<'compute' | 'sci' | 'render'>()
  for (const n of names) { const t = benchToolOf(n); if (t) g.add(TOOLBENCH_GROUP[t]) }
  return [...g]
}

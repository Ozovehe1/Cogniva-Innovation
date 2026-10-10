/**
 * Thin typed client for the Modal tool bench (app "geniusmap-toolbench", modal_app/tool_bench.py).
 * Contract and per-tool args: src/lib/toolbench/TOOLBENCH.md.
 *
 * Server-side only (reads TOOLBENCH_URL / TOOLBENCH_TOKEN). Never throws for tool failures: a failed call comes back
 * as { ok: false, error, fallback } so the agent can say what happened and try the cheaper alternative.
 */

export type ToolbenchGroup = 'compute' | 'sci' | 'render'

export type ToolbenchTool =
  | 'sympy' | 'numeric' | 'chart' | 'units' | 'z3' | 'python' | 'octave'
  | 'spice' | 'molecule' | 'pde' | 'graphviz' | 'plantuml'
  | 'latex' | 'manim' | 'ffmpeg' | 'blender'

export const TOOLBENCH_GROUP: Record<ToolbenchTool, ToolbenchGroup> = {
  sympy: 'compute', numeric: 'compute', chart: 'compute', units: 'compute', z3: 'compute', python: 'compute', octave: 'compute',
  spice: 'sci', molecule: 'sci', pde: 'sci', graphviz: 'sci', plantuml: 'sci',
  latex: 'render', manim: 'render', ffmpeg: 'render', blender: 'render',
}

/** Per-tool args (see TOOLBENCH.md for every op). Loose on purpose: the bench validates and explains. */
export interface ToolbenchArgs {
  sympy: { op?: 'simplify' | 'expand' | 'factor' | 'solve' | 'diff' | 'integrate' | 'limit' | 'series' | 'evaluate' | 'latex' | 'plot'; expr: string; var?: string; order?: number; lower?: string | number; upper?: string | number; to?: string | number; at?: string | number; n?: number; subs?: Record<string, string | number>; digits?: number; xmin?: number; xmax?: number }
  numeric:
    | { op: 'ode'; rhs: string | string[]; vars?: string[]; y0: number | number[]; t0?: number; t1?: number }
    | { op: 'roots'; coeffs: number[] }
    | { op: 'fsolve'; eqs: string[]; vars: string[]; guess?: number[] }
    | { op: 'fit'; x: number[]; y: number[]; deg?: number }
    | { op: 'linsolve'; A: number[][]; b: number[] }
    | { op: 'stats'; data: number[] }
  chart: { csv?: string; rows?: Record<string, unknown>[]; x?: string; y?: string | string[]; kind?: 'line' | 'bar' | 'scatter' | 'area'; title?: string }
  units:
    | { op: 'convert'; quantity: string; to: string }
    | { op: 'check'; lhs: string; rhs: string }
    | { op: 'compute'; expr: string; to?: string }
  z3: { vars: Record<string, 'Int' | 'Real' | 'Bool'>; constraints?: string[]; prove?: string; timeout_ms?: number }
  python: { code: string; timeout?: number }
  octave: { code: string; timeout?: number }
  spice: { netlist: string; analysis?: string; probes?: string[] }
  molecule: { smiles?: string; name?: string; '3d'?: boolean; width?: number; height?: number; atom_indices?: boolean }
  pde: { dims?: 1 | 2; n?: number; D?: number; L?: number; dt?: number; steps?: number; ic?: 'hot_center' | 'hot_left' | 'step'; bc_left?: number; bc_right?: number; bc?: 'fixed0' | 'insulated'; animate?: boolean }
  graphviz: { dot: string; engine?: 'dot' | 'neato' | 'fdp' | 'circo' | 'twopi' | 'sfdp'; png?: boolean }
  plantuml: { uml: string }
  latex: { tex: string; packages?: string[]; png?: boolean }
  manim: { code: string; scene?: string; quality?: 'l' | 'm'; timeout?: number }
  ffmpeg:
    | { op: 'frames_to_mp4'; frames: string[]; fps?: number }
    | { op: 'mp4_to_gif'; video: string; fps?: number; width?: number }
    | { op: 'concat'; videos: string[] }
    | { op: 'probe'; video: string }
  blender: { objects: { type: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane' | 'ico' | 'monkey'; location?: number[]; scale?: number[]; rotation?: number[]; color?: number[]; smooth?: boolean; spin?: boolean; metallic?: number; roughness?: number }[]; camera?: { location: number[]; look_at?: number[] }; frames?: number; width?: number; height?: number; samples?: number; background?: number[]; sun?: number }
}

export interface ToolbenchArtifact {
  name: string
  /** image/png | image/svg+xml | video/mp4 | image/gif | chemical/x-mdl-molfile | application/json */
  mime: string
  /** binary artifacts (png, mp4, gif) */
  b64?: string
  /** text artifacts (svg, molblock, json) */
  text?: string
  bytes: number
}

export interface ToolbenchFallback {
  /** another bench tool, or 'client:<embed>' (circuitjs, 3dmol, mermaid, katex, three) */
  tool: string
  reason: string
  args?: Record<string, unknown>
}

export interface ToolbenchResult<R = Record<string, unknown>> {
  ok: boolean
  tool: string
  group?: ToolbenchGroup
  result: R | null
  artifacts: ToolbenchArtifact[]
  /** small JSON the agent can read back or pass in a later call's context */
  state: Record<string, unknown>
  logs: string
  error?: string | null
  fallback?: ToolbenchFallback | null
  /** wall time seen by the web endpoint (queue + cold start + run) */
  ms: number
  tool_ms?: number
  run_ms?: number
  /** false on the first call into a fresh backend container (cold start) */
  warm?: boolean
}

export function toolbenchConfigured(): boolean {
  return Boolean(process.env.TOOLBENCH_URL && process.env.TOOLBENCH_TOKEN)
}

/** Typical latency (ms) measured on the deployed bench: warm / cold. Use to pick sync vs async UI. */
export const TOOLBENCH_LATENCY: Record<ToolbenchTool, { warm: number; cold: number }> = {
  // measured 2026-10-10 against the deployed bench (endpoint ms; cold = first call into a fresh container)
  sympy: { warm: 750, cold: 3600 }, numeric: { warm: 3000, cold: 3800 }, chart: { warm: 2200, cold: 2500 },
  units: { warm: 600, cold: 800 }, z3: { warm: 300, cold: 400 }, python: { warm: 1900, cold: 1900 },
  octave: { warm: 1400, cold: 5900 },
  spice: { warm: 1600, cold: 9200 }, molecule: { warm: 800, cold: 1500 }, pde: { warm: 5800, cold: 6600 },
  graphviz: { warm: 400, cold: 600 }, plantuml: { warm: 1150, cold: 6200 },
  latex: { warm: 1200, cold: 7000 }, manim: { warm: 3400, cold: 4800 }, ffmpeg: { warm: 1300, cold: 1400 },
  blender: { warm: 2800, cold: 4000 },
}

function failure(tool: string, error: string, ms: number): ToolbenchResult {
  return { ok: false, tool, result: null, artifacts: [], state: {}, logs: '', error, fallback: null, ms }
}

/** Run one tool. `timeoutMs` defaults to the tool's cold latency + 60 s. */
export async function runTool<T extends ToolbenchTool>(
  tool: T,
  args: ToolbenchArgs[T],
  context: Record<string, unknown> = {},
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ToolbenchResult> {
  const url = process.env.TOOLBENCH_URL
  const token = process.env.TOOLBENCH_TOKEN
  const t0 = Date.now()
  if (!url || !token) return failure(tool, 'tool bench not configured (TOOLBENCH_URL / TOOLBENCH_TOKEN)', 0)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? TOOLBENCH_LATENCY[tool].cold + 60_000)
  opts.signal?.addEventListener('abort', () => ctl.abort())
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ tool, args, context }),
      signal: ctl.signal,
      cache: 'no-store',
    })
    if (!res.ok) return failure(tool, `tool bench HTTP ${res.status}`, Date.now() - t0)
    return (await res.json()) as ToolbenchResult
  } catch (e) {
    return failure(tool, ctl.signal.aborted ? 'tool bench timed out' : `tool bench unreachable: ${(e as Error).message}`, Date.now() - t0)
  } finally {
    clearTimeout(timer)
  }
}

/** Fire-and-forget warm-up of backend groups (e.g. when a lesson that will need Manim opens). */
export async function warmToolbench(groups: ToolbenchGroup[] = ['compute', 'sci', 'render']): Promise<void> {
  const url = process.env.TOOLBENCH_URL
  const token = process.env.TOOLBENCH_TOKEN
  if (!url || !token) return
  try {
    await fetch(`${url.replace(/\/$/, '')}/warm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ groups }),
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    /* warm-up is best effort */
  }
}

/** data: URL for an artifact, for <img>/<video> src or storage upload. */
export function artifactDataUrl(a: ToolbenchArtifact): string {
  if (a.b64) return `data:${a.mime};base64,${a.b64}`
  return `data:${a.mime};charset=utf-8,${encodeURIComponent(a.text ?? '')}`
}

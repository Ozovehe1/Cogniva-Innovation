# Tool bench contract (Modal app `geniusmap-toolbench`)

Heavy Linux tools the tutor agent can call. Code: `modal_app/tool_bench.py` (Modal app, web endpoint, 3 images) and
`modal_app/toolbench_tools.py` (the tools). Typed client: `src/lib/toolbench/client.ts` (`runTool`, `warmToolbench`).
Deployed by `scripts/deploy-modal.mjs` in the Vercel production build when either file changes.

- URL: `TOOLBENCH_URL` = `https://abdulcosman01--geniusmap-toolbench.modal.run`
- Auth: `Authorization: Bearer $TOOLBENCH_TOKEN` (or `X-Toolbench-Token`). Vercel env `TOOLBENCH_TOKEN`; Modal secret
  `geniusmap-toolbench` is recreated from it on each toolbench deploy. Without it: 401.

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/run` | `{tool, args, context}` | result envelope (below) |
| POST | `/warm` | `{groups?: ["compute","sci","render"]}` | starts the backends (ping) so the next call skips the cold start |
| GET | `/tools` | – | tool names, group, timeout, args summary |
| GET | `/health` | – | `{ok, app, build}` (no auth) |

### Result envelope (always HTTP 200 for tool outcomes)

```ts
{
  ok: boolean,                 // tool ran AND passed its validate step
  tool: string, group: 'compute'|'sci'|'render',
  result: object | null,       // tool-specific (tables below)
  artifacts: [{ name, mime, b64?: string, text?: string, bytes }],  // png/mp4/gif as b64; svg/molblock/json as text
  state: object,               // small JSON to read back or pass in a later call's `context`
  logs: string,                // warnings (e.g. "png skipped", PubChem resolution)
  error: string | null,        // learner-safe message on failure
  fallback: { tool, reason, args? } | null,  // cheaper alternative: another bench tool or 'client:<embed>'
  ms: number,                  // endpoint wall time (queue + cold start + run)
  run_ms: number, tool_ms: number,
  warm: boolean                // false = first call into a fresh container
}
```

Every tool runs prepare → run → validate → fallback. Validation examples: SymPy `solve` substitutes the roots back
(`checks.residuals_zero`), units `check` compares dimensions, SPICE detects non-convergence / singular matrices and
non-physical values, plots/renders are checked non-blank (greyscale std > 2), Manim's last frame must be non-blank,
FiPy reports `energy_ratio` and flags maximum-principle violations, Z3 returns a counterexample when a claim is false.

`client:*` fallbacks name the browser embeds of the live agent: `client:circuitjs`, `client:3dmol`, `client:mermaid`,
`client:katex`, `client:three`.

## Tools

Latency = endpoint `ms` measured from the sandbox on 2026-10-10 (smoke tests, `warm` = container already up; `cold` =
first call into a fresh container of that group). Cost = Modal CPU+memory for the run only (compute/sci: 1 core +
2 GiB = $0.0000175/s; render: 2 cores + 4 GiB = $0.000035/s). A burst that starts a container also pays ~3-6 s start-up
plus the idle tail before scale-down (45 s compute/sci ≈ $0.0008, 30 s render ≈ $0.001).

| Tool | Group | Args | Result / artifacts | Warm | Cold | Cost/call (warm) |
|---|---|---|---|---|---|---|
| `sympy` | compute | `op` simplify\|expand\|factor\|solve\|diff\|integrate\|limit\|series\|evaluate\|latex\|plot, `expr` ("x^2-5x+6=0" ok), `var?`, `order?`, `lower?/upper?`, `to?`, `at?/n?`, `subs?`, `xmin/xmax` (plot) | `{text, latex, var, checks}`; plot → `plot.png` | 0.7 s | 3.6 s | $0.00001 |
| `numeric` | compute | `op` ode{`rhs`[], `vars`[], `y0`, `t0?`, `t1?`} \| roots{`coeffs`} \| fsolve{`eqs`,`vars`,`guess?`} \| fit{`x`,`y`,`deg?`} \| linsolve{`A`,`b`} \| stats{`data`} | ode → `{t, y, final}` + `ode.png`; fit → `{coeffs, r2}` + `fit.png` | 3.0 s (ode) | 3.8 s | $0.00005 |
| `chart` | compute | `csv` or `rows`, `x?`, `y?` (≤3 numeric cols), `kind` line\|bar\|scatter\|area, `title?` | `{summary, rows, vega_lite}` + `chart.png`, `chart.vl.json` | 2.2 s | 2.5 s | $0.00004 |
| `units` | compute | `op` convert{`quantity`,`to`} \| check{`lhs`,`rhs`} \| compute{`expr`,`to?`} (Pint) | `{value, unit, text}` / `{consistent, lhs_dim, rhs_dim, ratio?}` | 0.6 s | 0.8 s | $0.00001 |
| `z3` | compute | `vars` {name: Int\|Real\|Bool}, `constraints` [python-like exprs], `prove?` | `{sat, model}` / `{proved, counterexample?}` | 0.3 s | 0.4 s | <$0.00001 |
| `python` | compute | `code` (numpy, scipy, sympy, pandas, matplotlib as `plt`, pint, z3, networkx), `timeout` ≤30 | `{stdout, error?}` + `figure1..4.png`; no network, 1 GiB, 512 procs | 1.9 s | 1.8 s | $0.00003 |
| `octave` | compute | `code` (MATLAB-style; `system/unix/webread` rejected), `timeout` ≤40 | `{stdout, stderr, figures}` + `oct_fig*.png` | 1.4 s | 1.7-5.9 s | $0.00003 |
| `spice` | sci | `netlist` (title line optional; `.control` blocks stripped), `analysis` op\|tran\|ac\|dc …, `probes` ["v(out)","i(V1)"] | op → `{op: {node: V}}`; tran/ac/dc → `{x, series, summary}` + `waveform.png` | 1.6 s | 3.7-9 s | $0.00003 |
| `molecule` | sci | `smiles` or `name` (PubChem lookup in the web layer), `3d?`, `width/height`, `atom_indices?` | `{formula, mol_weight, rings, h_donors, h_acceptors, logp, canonical_smiles}` + `molecule.svg`, `molecule.mol` (3Dmol.js) | 0.8 s | 1.0 s | $0.00001 |
| `pde` | sci | `dims` 1\|2, `n`, `D`, `L`, `steps` ≤400, `dt?`, `ic` hot_center\|hot_left\|step, `bc_left/bc_right` (1D), `bc` fixed0\|insulated (2D), `animate?` | `{max, min, mean, energy_ratio, profile?}` + `field.png` (+ `field.mp4`) | 5.8 s (2D + mp4) | 5.8 s | $0.0001 |
| `graphviz` | sci | `dot`, `engine` dot\|neato\|fdp\|circo\|twopi\|sfdp, `png?` | `{nodes}` + `graph.svg` (+ `graph.png`) | 0.4 s | 0.4 s | <$0.00001 |
| `plantuml` | sci | `uml` (`!include` rejected) | `diagram.svg` | 1.1 s | 2.0-6.2 s (JVM) | $0.00002 |
| `latex` | render | `tex` (TikZ body or full document; `\input`/`\write18` rejected), `packages?`, `png?` | `figure.svg` + `figure.png` | 1.2 s | 5.5-7 s | $0.00004 |
| `manim` | render | `code` (Manim CE 0.19 Scene subclass; subprocess/network modules rejected), `scene?`, `quality` l\|m | `{duration_s, scene}` + `clip.mp4`, `last_frame.png` | 3.4 s (2 s clip, 480p) | 4.8 s | $0.0001+ (scales with clip length) |
| `ffmpeg` | render | `op` frames_to_mp4{`frames` b64[], `fps`} \| mp4_to_gif{`video`} \| concat{`videos`} \| probe{`video`} | `out.mp4` / `out.gif` / probe JSON | 1.3 s | 1.4 s | $0.00005 |
| `blender` | render | `objects` [{type cube\|sphere\|cylinder\|cone\|torus\|plane\|ico\|monkey, location, scale, rotation, color, smooth, spin, metallic, roughness}], `camera?`, `frames` ≤48, `width` ≤960, `height` ≤540, `samples` ≤64 | still → `render.png`; frames>1 → `render.mp4` + `first_frame.png` | 2.8 s (480×270 still) / 8.2 s (24 frames) | 4.0 s | $0.0001 / $0.0003 |

Suggested registry mapping (for `registerRemoteTool`): cost `modal-cpu` for all; latency `fast` for z3, units, graphviz,
sympy, molecule, spice, octave, python, plantuml, chart, ffmpeg, latex; `slow` for numeric ode, pde, manim, blender
(stream a placeholder). Renderers: png/svg → `image`/`svg`, mp4 → `clip`, molblock → `embed` (3Dmol), Vega-Lite →
`data`, numeric results → `data`/`text`.

## Limits and isolation

- Backends (`compute`, `sci`, `render`) run with `block_network=True` and no secrets. Each call is a fresh child
  process as one of 8 unprivileged users with RLIMIT_AS (1-2 GiB, none for JVM/Octave/Manim/Blender), RLIMIT_NPROC 512,
  RLIMIT_FSIZE 300 MB and a per-tool wall clock (20-100 s); the user's processes are killed and the work dir removed
  after every call. Verified: network blocked (URLError), 3 GiB allocation → MemoryError, `while True` → timeout,
  fork bomb contained (timeout, container healthy afterwards).
- Artifacts ≤ 6 MB per call (base64 counted); larger ones are dropped with a log line.
- Capacity: max 2 containers per function (web 2, compute 2×4 inputs, sci 2×3, render 2×2) → at most 8 containers;
  `min_containers=0`; web semaphore of 8 in-flight tool calls per web container.
- No Supabase upload yet: artifacts come back inline (base64/text). Upload in the Next.js layer if they must persist.

## Wiring into the live agent (src/lib/live/tools/bench.ts)

14 bench tools are registered with `registerRemoteTool` as ordinary registry tools (prepare → run → validate → fallback):
`symbolic_math` (sympy), `numeric_solve` (numeric), `data_chart` (chart), `unit_check` (units), `logic_check` (z3),
`circuit_spice` (spice), `molecule_props` (molecule), `heat_diffusion` (pde), `graph_draw` (graphviz), `tikz_figure`
(latex), `manim_clip` (manim), `render_3d` (blender), plus `octave_run` and `uml_diagram` (Ask only, `notLive`).
`python` (run_python covers it) and `ffmpeg` (base64 media inputs) are not offered to the model.

- Loadout: narrow topics + signal boosts; exact checkers (`verifies`) come forward after a wrong answer with numbers or
  algebra; a bench tool that clearly fits the lesson takes the weakest generic default slot (reserve). Always ≤ 5 + decide.
- Output: artifacts → stage blocks (mp4 → clip, svg → svg, png → image); the model sees only a compact summary,
  the bench checks and `bench_issues` (validate → self_check). Bench images also get the vision self-check.
- Failure: the error names a fallback (bench `fallback` mapped to registry names, e.g. `client:circuitjs` →
  `circuit_sim`); runAgent swaps the failed tool's slot for the fallback so the next step can call it.
- Guards: ≤ 3 bench calls per agent run; `TOOLBENCH_LIVE=0` hides them all; absent without TOOLBENCH_URL/TOKEN.
  Backend groups for bench tools in the loadout are warmed while the planner decides.
- Log: each live_decision row carries `bench: [{tool, ok, ms, cold, shown, issues, error?, initiated: agent|prompted}]`.

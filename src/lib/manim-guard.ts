/**
 * Static guard for Gemini-written Manim code.
 *
 * The render service runs Manim Community v0.19. Gemini often writes old
 * ManimGL / pre-0.6 Community calls (axes.get_graph, ShowCreation, GraphScene…).
 * These fail only after a container has spun up, so we catch them here first:
 * safe one-to-one renames are rewritten, everything else is reported as a
 * problem so the caller can ask Gemini for a fix before any render is spent.
 *
 * modal_app/manim_render.py mirrors the explicit lists below (without the getter list).
 */
import KNOWN_GETTERS from './manim-getters.json'

/** Concise v0.19 API sheet for the code-writing and auto-fix prompts. */
export const MANIM_API_SHEET = `Manim Community v0.19 API sheet (use exactly these forms):
- Header: \`from manim import *\` (numpy as np and math are allowed). Exactly one Scene subclass. Use MovingCameraScene if you touch self.camera.frame.
- Axes: \`ax = Axes(x_range=[-3, 3, 1], y_range=[-1, 9, 1], x_length=7, y_length=5, axis_config={"color": INK, "include_numbers": True})\`. Do not also call add_coordinates() when include_numbers is set.
- Curves: \`graph = ax.plot(lambda x: x**2, x_range=[-3, 3], color=NAVY)\`. A straight line through the plane: \`ax.plot(lambda x: m*x + b, x_range=[a, b], color=CLAY)\` or \`Line(ax.c2p(x1, y1), ax.c2p(x2, y2), color=CLAY)\`; extend a Line with \`.scale(k)\`.
- Points: \`ax.c2p(x, y)\` (coords_to_point), \`ax.i2gp(x, graph)\` (input_to_graph_point), \`ax.p2c(point)\`.
- Labels: \`ax.get_graph_label(graph, MathTex("y=x^2"), x_val=2, direction=UR, color=NAVY)\`, \`ax.get_axis_labels(x_label="x", y_label="y")\`.
- Data: \`ax.plot_line_graph(x_values=[...], y_values=[...], line_color=NAVY, add_vertex_dots=True)\`.
- Helpers on Axes: get_vertical_line(point), get_horizontal_line(point), get_secant_slope_group(x, graph, dx=..., secant_line_color=...), get_riemann_rectangles(graph, x_range=[a, b], dx=...), get_area(graph, x_range=(a, b)), slope_of_tangent(x, graph), plot_derivative_graph(graph).
- Lines: Line(start, end), DashedLine(start, end), Arrow(start, end, buff=0), TangentLine(graph, alpha=0.5, length=4) (alpha is the 0..1 proportion along the curve, not x), Dot(point, color=...).
- Motion: \`t = ValueTracker(2.5)\`; \`q = always_redraw(lambda: Dot(ax.i2gp(t.get_value(), graph), color=CLAY))\`; \`self.play(t.animate.set_value(1.001), run_time=4)\`. For changing numbers use \`DecimalNumber(0, num_decimal_places=2)\` with \`.add_updater(lambda m: m.set_value(...))\`, not a new MathTex every frame (each MathTex compiles LaTeX).
- Text: MathTex(r"m = \\frac{\\Delta y}{\\Delta x}") for maths, Tex(r"...") for LaTeX text, Text("words", font_size=32) for plain words.
- Animations: Create, Write, FadeIn(m, shift=UP), FadeOut, Transform, ReplacementTransform, TransformMatchingTex, Indicate, Circumscribe; \`mob.animate.shift(RIGHT)\`. Scene calls: self.add, self.play(..., run_time=2), self.wait(1), self.remove.
DO NOT use (they do not exist in v0.19 and crash the render): axes.get_graph (use plot), get_line_from_equation, get_derivative_graph, get_v_line_to_graph / get_vertical_line_to_graph, setup_axes, GraphScene, ShowCreation (use Create), ShowCreationThenDestruction, TextMobject (use Text/Tex), TexMobject (use MathTex), TexText, FadeInFrom / FadeInFromDown / FadeOutAndShift (use FadeIn(m, shift=...)), CircleIndicate, x_min= / x_max= / y_min= / y_max= keyword args (use x_range / y_range), \`from manimlib import *\` (ManimGL), CONFIG = {...} class dicts, self.embed() or any interactive embed, self.frame (use self.camera.frame in a MovingCameraScene).
Note: calling a get_* method that does not exist on a Mobject fails with "Mobject.__getattr__.<locals>.getter() got an unexpected keyword argument" or "takes 1 positional argument"; that means the method name is wrong for v0.19.`

/** Safe 1:1 renames. */
const REWRITES: { re: RegExp; to: string; note: string }[] = [
  { re: /\.get_graph\s*\(/g, to: '.plot(', note: 'axes.get_graph( → axes.plot(' },
  { re: /\bShowCreation\s*\(/g, to: 'Create(', note: 'ShowCreation → Create' },
  { re: /\bTextMobject\s*\(/g, to: 'Text(', note: 'TextMobject → Text' },
  { re: /\bTexMobject\s*\(/g, to: 'MathTex(', note: 'TexMobject → MathTex' },
  { re: /\bTexText\s*\(/g, to: 'Tex(', note: 'TexText → Tex' },
]

/** Calls that have no safe rename. */
const DEPRECATED: { re: RegExp; msg: string }[] = [
  { re: /\bget_line_from_equation\b/, msg: 'get_line_from_equation does not exist in v0.19; use ax.plot(lambda x: m*x + b, x_range=[a, b]) or Line(ax.c2p(x1, y1), ax.c2p(x2, y2)).' },
  { re: /\bget_derivative_graph\b/, msg: 'get_derivative_graph does not exist; use ax.plot_derivative_graph(graph).' },
  { re: /\bget_v(?:ertical)?_line_to_graph\b/, msg: 'get_v_line_to_graph does not exist; use ax.get_vertical_line(ax.i2gp(x, graph)).' },
  { re: /\bsetup_axes\s*\(/, msg: 'setup_axes() is GraphScene API; build Axes(...) directly.' },
  { re: /\bGraphScene\b/, msg: 'GraphScene was removed; subclass Scene and create Axes(...).' },
  { re: /\bShowCreationThenDestruction\b/, msg: 'ShowCreationThenDestruction was removed; use ShowPassingFlash or Create then FadeOut.' },
  { re: /\bFadeInFrom(?:Down|Large|Point)?\b/, msg: 'FadeInFrom* was removed; use FadeIn(mob, shift=DOWN) or FadeIn(mob, scale=...).' },
  { re: /\bFadeOutAndShift(?:Down)?\b/, msg: 'FadeOutAndShift was removed; use FadeOut(mob, shift=...).' },
  { re: /\bCircleIndicate\b/, msg: 'CircleIndicate was removed; use Circumscribe(mob, Circle).' },
  { re: /[(,]\s*[xy]_(?:min|max)\s*=(?!=)/, msg: 'x_min/x_max/y_min/y_max keyword args are old API; use x_range=[a, b] / y_range=[a, b].' },
  { re: /\b(?:from\s+manimlib\b|import\s+manimlib\b|from\s+manimgl\b|import\s+manimgl\b)/, msg: 'ManimGL (manimlib) is not installed; use `from manim import *`.' },
  { re: /^\s*CONFIG\s*=\s*\{/m, msg: 'CONFIG = {...} class dicts are ignored in v0.19; pass arguments to constructors directly.' },
  { re: /\bembed\s*\(/, msg: 'Interactive embed() is not allowed in a headless render.' },
  { re: /\bself\.frame\b/, msg: 'self.frame is ManimGL; subclass MovingCameraScene and use self.camera.frame.' },
]

const KNOWN = new Set<string>(KNOWN_GETTERS as string[])

export interface GuardResult {
  code: string
  rewrites: string[]
  problems: string[]
}

/** Rewrites safe deprecated calls and lists the ones that need a real fix. */
export function guardManimCode(input: string): GuardResult {
  let code = input
  const rewrites: string[] = []
  for (const r of REWRITES) {
    if (r.re.test(code)) {
      code = code.replace(r.re, r.to)
      rewrites.push(r.note)
    }
    r.re.lastIndex = 0
  }
  if (!/^\s*from\s+manim\s+import\b/m.test(code) && !/^\s*import\s+manim\b/m.test(code) && !/\bmanimlib\b/.test(code)) {
    code = `from manim import *\n${code}`
    rewrites.push('added `from manim import *`')
  }
  // self.camera.frame needs a MovingCameraScene.
  if (/\bself\.camera\.frame\b/.test(code) && /class\s+\w+\s*\(\s*Scene\s*\)/.test(code)) {
    code = code.replace(/(class\s+\w+\s*\(\s*)Scene(\s*\))/, '$1MovingCameraScene$2')
    rewrites.push('Scene → MovingCameraScene (uses self.camera.frame)')
  }

  const problems: string[] = []
  for (const d of DEPRECATED) if (d.re.test(code)) problems.push(d.msg)

  // Any .get_xxx( that Manim v0.19 does not define (and the code does not define itself).
  const ownDefs = new Set([...code.matchAll(/\bdef\s+(get_\w+)\s*\(/g)].map(m => m[1]))
  const unknown = new Set<string>()
  for (const m of code.matchAll(/\.(get_\w+)\s*\(/g)) {
    const name = m[1]
    if (!KNOWN.has(name) && !ownDefs.has(name) && !/get_(?:line_from_equation|derivative_graph|v_line_to_graph|vertical_line_to_graph)$/.test(name)) unknown.add(name)
  }
  if (unknown.size) problems.push(`${[...unknown].join(', ')} ${unknown.size === 1 ? 'is' : 'are'} not a Manim v0.19 method; use the API sheet.`)

  return { code, rewrites, problems }
}

/** One readable message for a list of problems. */
export function describeProblems(problems: string[]) {
  return `Static check (Manim Community v0.19) rejected the code before rendering:\n- ${problems.join('\n- ')}`
}

/** Pulls the useful part of a Manim log: the traceback and the final exception. */
export function tracebackOf(log: string) {
  const i = log.search(/Traceback \(most recent call last\)/)
  const tb = i >= 0 ? log.slice(i) : log
  return tb.slice(-5000)
}

/** Targeted hints for common v0.19 failures, from the traceback. */
export function hintsFor(log: string): string[] {
  const hints: string[] = []
  if (/__getattr__\.<locals>\.getter\(\)/.test(log)) hints.push('The traceback shows Mobject.__getattr__ getter(): the get_* method on the highlighted line does not exist in v0.19 (Mobject turns unknown get_x calls into attribute getters). Replace it using the API sheet, e.g. axes.get_graph(f, color=c) → axes.plot(f, color=c).')
  for (const m of log.matchAll(/has no attribute '(\w+)'/g)) hints.push(`"${m[1]}" does not exist on that object in v0.19; use the API sheet equivalent.`)
  for (const m of log.matchAll(/unexpected keyword argument '(\w+)'/g)) if (!/getter\(\)/.test(log)) hints.push(`The keyword "${m[1]}" is not accepted there in v0.19 (e.g. plot_line_graph takes line_color, not color).`)
  for (const m of log.matchAll(/NameError: name '(\w+)' is not defined/g)) hints.push(`${m[1]} is not part of Manim Community v0.19; replace it using the API sheet.`)
  if (/LaTeX compilation error|latex error/i.test(log)) hints.push('LaTeX failed: use raw strings r"..." and valid LaTeX; put plain words in Text(...).')
  return [...new Set(hints)].slice(0, 6)
}

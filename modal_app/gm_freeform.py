"""gm_freeform: free-form Manim generation with a render-and-fix loop (the agent's animate_concept clips).

Pipeline (ideas from planner-coder-critic animation agents, e.g. Code2Video; render-in-the-loop repair, e.g. ManimAgent;
static layout checks, e.g. SGA):

  1. Planner  learning objective -> storyboard JSON: beats (time span, narration line, what appears / moves / leaves),
              on-screen objects with a layout zone each, the Manim APIs it expects to need. Frame 16:9 or 9:16, sized
              for a phone.
  2. Coder    storyboard + an API sheet + the gm_ffkit helper API + retrieved Manim docs (real signatures, docstrings
              and official examples from gm_manim_docs.json, for the APIs the plan / code / traceback names) -> a full
              Manim CE v0.19 Scene.
  3. Guard    AST allow-list (imports: manim, gm_ffkit, numpy, math, random, itertools, functools, typing, colorsys; no
              open/exec/eval/getattr/dunder access/file or network names) + the v0.19 renames. Rejected code goes back to
              the coder like a render error.
  4. Render   in a sandbox (Modal function with no network, CPU / memory / time caps, rlimits) at 480p15 first.
  5. Critic   on an error: traceback + docs for the names in it -> repair (max 3). On success: layout probe (bounding
              boxes after every play: text overlaps, off-frame, text below the phone-legible size, crowding) + 4 frames
              to a vision model; one visual repair pass when there is a real problem; the repair is kept only if it
              renders and is not worse. The final 720p30 render of the current best version starts while the critic
              runs, so a clean first draft costs no extra time.

The renderer is injected (`render(code, quality, aspect, want_frames, pen)`), so the same loop runs on Modal
(manim_render.ff_render) and locally (render_local) for evaluation.
"""
from __future__ import annotations

import ast
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor

from gm_llm import chat, gemini, parse_json

SCENE = "GeneratedScene"
MAX_ERROR_REPAIRS = 3
CRITIC_TIMEOUT_S = float(os.environ.get("FF_CRITIC_TIMEOUT", "40"))
CRITIC_MODELS = ["gemini-3.7-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash"]
_HERE = os.path.dirname(os.path.abspath(__file__))

# ───────────────────────── docs retrieval ─────────────────────────
_DOCS: dict | None = None


def docs_index() -> dict:
    global _DOCS
    if _DOCS is None:
        for p in (os.path.join(_HERE, "gm_manim_docs.json"), "/root/gm_manim_docs.json"):
            if os.path.exists(p):
                with open(p) as f:
                    _DOCS = json.load(f)["entries"]
                break
        else:
            _DOCS = {}
    return _DOCS


_KIT: dict | None = None


def kit_index() -> dict:
    """Signatures + docstrings of the gm_ffkit helpers (so a repair sees the real signature of a helper it misused)."""
    global _KIT
    if _KIT is None:
        _KIT = {}
        for p in (os.path.join(_HERE, "gm_ffkit.py"), "/root/gm_ffkit.py"):
            if os.path.exists(p):
                with open(p) as f:
                    tree = ast.parse(f.read())
                for n in tree.body:
                    if isinstance(n, ast.FunctionDef) and not n.name.startswith("_"):
                        _KIT[n.name] = {"sig": f"{n.name}({ast.unparse(n.args)})  [gm_ffkit]", "doc": (ast.get_docstring(n) or "")[:220]}
                break
    return _KIT


# basics the API sheet already covers well: never spend retrieval budget on them unless a traceback names them
_BASIC = {"Scene", "VGroup", "Text", "MathTex", "Create", "Write", "FadeIn", "FadeOut", "Dot", "Line", "Circle", "Square", "Rectangle",
          "Transform", "ReplacementTransform", "Group", "Mobject", "VMobject", "Wait", "AnimationGroup", "Succession", "Indicate", "ORIGIN",
          "UP", "DOWN", "LEFT", "RIGHT", "Tex", "Arrow", "LaggedStart", "ValueTracker", "always_redraw", "DecimalNumber", "Axes",
          "RoundedRectangle", "DashedLine", "Polygon", "Brace", "GrowArrow", "Circumscribe", "Rotate", "MoveAlongPath", "TracedPath"}
_METHOD_PREF = ["Axes", "CoordinateSystem", "NumberPlane", "NumberLine", "Mobject", "VMobject", "Scene", "MovingCameraScene", "ThreeDScene",
                "Line", "Arrow", "Text", "MathTex", "ValueTracker", "VGroup", "BarChart", "Angle", "Brace", "ParametricFunction", "Circle"]


def _method_entries(name: str, idx: dict, prefer: set[str]) -> list[str]:
    keys = [k for k in idx if k.endswith("." + name)]
    keys.sort(key=lambda k: (k.split(".")[0] not in prefer, _METHOD_PREF.index(k.split(".")[0]) if k.split(".")[0] in _METHOD_PREF else 99))
    return keys[:1]


def retrieve(*texts: str, priority: str = "", limit_chars: int = 3200, examples: int = 1) -> str:
    """Doc snippets for the Manim names used in the texts. `priority` (a traceback) is searched first and may name basics."""
    idx = dict(docs_index())
    kit = kit_index()
    for k, v in kit.items():
        idx.setdefault(k, v)
    if not idx:
        return ""
    picked: list[str] = []

    def scan(t: str, allow_basic: bool):
        ids = re.findall(r"\b[A-Za-z_][A-Za-z0-9_]*\b", t or "")
        classes = {i for i in ids if i in idx and i[:1].isupper()}
        for i in ids:
            if i in idx and i not in picked and (allow_basic or i not in _BASIC):
                picked.append(i)
        for m in re.findall(r"\.([a-z_][a-z0-9_]*)\s*\(", t or ""):
            for k in _method_entries(m, idx, classes):
                if k not in picked:
                    picked.append(k)

    scan(priority, True)
    for t in texts:
        scan(t, False)
    picked = [k for k in picked if k not in kit or k in (priority or "")]  # helpers only when an error names them
    out, used, ex_left = [], 0, examples
    for k in picked:
        e = idx[k]
        s = f"- {e['sig']}"
        if e.get("doc"):
            s += f"\n  {e['doc'][:220]}"
        if e.get("params"):
            s += f"\n  params: {e['params'][:380]}"
        if ex_left > 0 and e.get("example") and k not in _BASIC:
            s += "\n  example:\n" + "\n".join("    " + ln for ln in e["example"][:650].splitlines())
            ex_left -= 1
        if used + len(s) > limit_chars:
            continue
        out.append(s)
        used += len(s)
    return "\n".join(out)


# ───────────────────────── prompts ─────────────────────────
API_SHEET = """Manim Community v0.19 essentials (use exactly these forms):
- Axes(x_range=[a, b, step], y_range=[c, d, step], x_length=7, y_length=4.5, axis_config={"color": MUTED, "include_numbers": True, "font_size": 28, "decimal_number_config": {"color": INK, "num_decimal_places": 0}}); curves ax.plot(lambda x: ..., x_range=[a, b], color=NAVY); points ax.c2p(x, y), ax.i2gp(x, graph); labels ax.get_axis_labels(MathTex("x", color=INK), MathTex("y", color=INK)); ax.get_area(graph, x_range=(a, b), color=GREEN, opacity=0.2); ax.get_vertical_line(point); ax.slope_of_tangent(x, graph) -> float.
- Motion: t = ValueTracker(0); dot = always_redraw(lambda: Dot(ax.c2p(t.get_value(), f(t.get_value())), color=CLAY)) (the lambda must return a Mobject); self.play(t.animate.set_value(3), run_time=3, rate_func=linear). Live numbers: DecimalNumber(0, num_decimal_places=2, font_size=32, color=INK).add_updater(lambda d: d.set_value(...)). Rotation: Rotate(mob, angle=PI/2, about_point=p) or mob.animate.rotate(PI/2, about_point=p). MoveAlongPath(dot, path, rate_func=linear). TracedPath(dot.get_center, stroke_color=MUTED, stroke_width=2).
- Build: Create, Write, FadeIn(m, shift=0.2*UP), GrowArrow, DrawBorderThenFill, LaggedStart(*anims, lag_ratio=0.3), TransformMatchingTex(a, b), ReplacementTransform(a, b), Indicate(m, color=AMBER, scale_factor=1.08), Circumscribe(m, color=AMBER), FadeOut(m).
- Geometry: Polygon(*pts), Line(a, b), DashedLine, Arrow(a, b, buff=0), Angle(l1, l2, radius=0.5), RightAngle(l1, l2, length=0.25), Brace(mob, direction=DOWN) + brace.get_tex("a"), Sector, Arc(radius, start_angle, angle), Ellipse.
- Maths text: MathTex(r"3(y-5)=12", font_size=44, color=INK); split a formula into parts with MathTex("a^2", "+", "b^2") to colour or transform parts; mob[0].set_color(CLAY).
- DO NOT use: axes.get_graph, ShowCreation, TextMobject, TexMobject, GraphScene, FadeInFrom*, x_min=/x_max=, CONFIG dicts, self.frame, ManimGL imports, SVGMobject/ImageMobject (no files), self.camera.frame unless the class is MovingCameraScene."""

KIT_SHEET = """Helper API (`from gm_ffkit import *`, already safe and phone-readable; prefer it):
- Palette: BG (background), INK (text), MUTED (axes/secondary), RULE (light lines), GREEN (key object), CLAY (contrast/answer), NAVY (second series), AMBER (brief highlight), PLUM, TEAL.
- Frame: FW x FH units (16:9: 14.2 x 8; 9:16: 4.5 x 8). MIN_FONT, BODY_FONT, TITLE_FONT are the legible sizes for this frame.
- zone(name) -> {'center','width','height'} for 'title', 'main', 'side', 'caption', 'full'. fit(mob, 'main') shrinks a group into a zone and centres it there. keep_in_frame(mob).
- title(text), caption(text) (placed in their zones), label(text, size=None, color=INK) -> Text (never below MIN_FONT), math_tex(*tex, size=None, color=INK) -> MathTex, place_label(lab, target, direction=UP, buff=0.2), stack(*mobs, direction=DOWN, buff=0.3), arrow(a, b, color=INK).
- Drawn parts: resistor(a, b), battery(center, vertical=False), bulb(center, glow=None), wire(*points), spring(a, b, coils=8), gear(center, teeth=12, radius=1.0, color=NAVY)."""

PATTERN_HEAD = """Composition patterns (pick the one that fits; compute every coordinate with numpy first, then build):"""
PATTERNS = {
    "equation": """- Solving an equation: ONE equation line at a time in the main zone, centred. Each step: write the operation on both sides
  as a small coloured note (e.g. MathTex(r"\\div 3", color=CLAY)) beside BOTH sides, then TransformMatchingTex(old_line, new_line)
  in place; earlier lines move up and fade to MUTED (or a stack built with .arrange(DOWN, buff=0.5)). Never place a new piece of
  an equation on top of an old one: FadeOut / transform it. Highlight the answer with SurroundingRectangle(color=GREEN).""",
    "geometry": """- Geometry / proofs: compute vertices as numpy arrays (e.g. square side s = a + b, corners, the four triangles' exact vertices),
  build Polygon(*pts); rearrange with .animate.move_to / rotate(about_point=...) to exact computed targets so pieces tile with no
  gaps or overlaps; label sides with MathTex placed at edge midpoints + an outward normal * 0.3.""",
    "circle_graph": """- Circle-to-graph (sine, rotation): unit circle on the left (radius ~1.5, centre (-4.5, 0)), Axes on the right sharing the
  same vertical scale (y_length = 2 * radius * (y range / 2)), one ValueTracker angle drives the dot, the radius, a horizontal
  DashedLine to the graph and the traced curve (always_redraw / TracedPath).""",
    "circuit": """- Circuits: a rectangular loop of wire() with battery() on the left side and resistor() on the top; current as Dots moving with
  MoveAlongPath along the loop path (wire through the corners); readouts (V, I, R) as DecimalNumber/MathTex in the side zone.""",
    "process": """- Processes (biology, chemistry): 3-5 labelled boxes or icons left-to-right (or around a circle) with arrow()s; inputs flow in
  as moving Dots/labels, outputs flow out; the formula appears last in the caption or side zone.""",
    "graph_motion": """- Graph + tangent / motion on axes: Axes in the main zone; ValueTracker drives a point, secant or tangent via always_redraw;
  live slope or values as DecimalNumber in the side zone.""",
    "vectors": """- Vectors: NumberPlane (faint: background_line_style={"stroke_color": RULE, "stroke_opacity": 0.6}) or Axes with equal
  units (x_length/x span == y_length/y span); Arrow(plane.c2p(0, 0), plane.c2p(x, y), buff=0); head-to-tail by moving the
  second arrow's start to the first one's tip; components as DashedLine.""",
}


def patterns_for(plan: dict) -> str:
    """Only the composition pattern(s) the planner chose (keeps the coder prompt inside the free-tier token window)."""
    want = [k for k in (plan.get("pattern") or "").replace(",", " ").split() if k in PATTERNS]
    picked = [PATTERNS[k] for k in want[:2]] or list(PATTERNS.values())
    return PATTERN_HEAD + "\n" + "\n".join(picked)


RULES = """Rules:
- Never reuse a helper name (title, label, caption, arrow, zone, fit, stack, wire ...) as a variable name.
- First lines: `from manim import *` then `from gm_ffkit import *` (numpy as np and math are also allowed; nothing else is importable). Exactly one class GeneratedScene(Scene) (MovingCameraScene / ThreeDScene subclass allowed, same name). self.camera.background_color = BG.
- No files, network, os, sys, subprocess, open/eval/exec/getattr, or dunder attributes: the sandbox rejects them.
- Follow the storyboard beats in order; the run_time and wait values add up to the storyboard duration (+-2 s). No single wait over 1.5 s: something should be moving.
- Text/label/title/caption print characters literally: never put $...$ or LaTeX commands in them. Maths goes in MathTex /
  math_tex (MathTex(r"y = 9")); a title that needs maths is a MathTex or a VGroup(Text, MathTex).arrange(RIGHT).
- Phone-readable: every Text / MathTex font_size >= MIN_FONT (use label()/math_tex()); at most ~12 words on screen at once; one short title at most. Place each object in its zone (fit(..., zone)) and labels with place_label/next_to; text must never overlap other text or leave the frame. FadeOut what a beat no longer needs before adding the next block of text.
- Colours only from the palette, on the light background (never WHITE/YELLOW/default colours). Thin strokes (3-4), light fills (fill_opacity 0.1-0.25).
- Get the subject right: numbers, formulas and directions must be correct. Compute geometry and values in Python first and add
  2-4 plain `assert` checks on what must be true (pieces tile the square: areas add up and vertices coincide; a point lies on its
  curve; the final value equals the answer; key objects lie inside the frame). A failed assert is reported back to you to fix."""


def _frame_desc(aspect: str) -> str:
    return "9:16 portrait (4.5 x 8 units)" if aspect == "9:16" else "16:9 landscape (14.2 x 8 units)"


def plan_prompt(description: str, narration: dict | None, context: str, aspect: str) -> str:
    dur = None
    if narration and narration.get("ms"):
        dur = round(narration["ms"] / 1000, 1)
    return f"""You are storyboarding one short 3Blue1Brown-style teaching animation for a student watching on a phone.
Request: {description.strip()[:1500]}
{('Context: ' + context.strip()[:600]) if context else ''}
{('Narration (the clip must last ' + str(dur) + ' s and follow it): ' + narration['text'][:800]) if narration and narration.get('text') else 'No narration: the clip is silent, so short on-screen captions carry the words.'}
Frame: {_frame_desc(aspect)}. Layout zones: title (top strip), main (the big stage), side (a column {'below the stage' if aspect == '9:16' else 'on the right'} for equations/readouts), caption (bottom strip).

Plan ONE clear idea that SHOWS the concept (motion and transformation, not paragraphs). Objects that show at the same
time must not share space: give each its own zone/position ("at" = centre in frame units, origin at the frame centre).
Equations change in place (transform), they do not pile up. Use the standard picture a good teacher would draw: solving an
equation = the equation itself transforming step by step with the operation shown on both sides (no balance-scale props unless
asked); a proof = the actual figure with exact pieces; a function = axes and a moving point; a process = labelled stages
with flowing arrows; a circuit = a closed rectangular loop with standard symbols. {('Duration ' + str(dur) + ' s.') if dur else 'Duration 12 to 25 s.'} 3 to 6 beats.
Return JSON only:
{{"objective": "what the student should understand after watching",
  "duration_s": number,
  "pattern": "one of: equation, geometry, circle_graph, circuit, process, graph_motion, vectors, other",
  "layout": "one sentence: where the main picture, the equations/readouts and the caption sit, so nothing ever overlaps",
  "objects": [{{"id": "short_id", "what": "concrete visual with its exact geometry (e.g. 'right triangle legs a=1.2, b=2.0 units', 'axes x 0..6, y 0..4', 'equation 3(y-5)=12')", "zone": "title|main|side|caption", "at": [x, y]}}],
  "beats": [{{"t0": s, "t1": s, "action": "what appears, moves or transforms, precisely (values, directions)", "caption": "on-screen words, <= 8 words, or empty"}}],
  "facts": ["every number / formula / result shown, worked out and checked"],
  "apis": ["Manim classes or methods you expect, e.g. ValueTracker, always_redraw, TransformMatchingTex, Axes.plot"]}}"""


def code_prompt(plan: dict, aspect: str, docs: str) -> str:
    return f"""Write the complete Manim Community v0.19 Python file for this storyboard. Frame {_frame_desc(aspect)}.

Storyboard:
{json.dumps(plan, ensure_ascii=False)[:3500]}

{RULES}

{KIT_SHEET}

{patterns_for(plan)}

{API_SHEET}

Manim docs for APIs you may need (real v0.19 signatures):
{docs or '(none)'}

Return ONLY the Python source in one ```python block."""


def fix_prompt(code: str, error: str, plan: dict, aspect: str, docs: str, hints: list[str]) -> str:
    return f"""This Manim Community v0.19 scene (frame {_frame_desc(aspect)}) failed. Fix the cause and return the COMPLETE corrected file.
Keep the storyboard and the timing; change only what is needed.

Error:
{error[-2200:]}
{('Likely causes: ' + ' '.join(hints)) if hints else ''}

Docs for the names involved:
{docs or '(none)'}

{RULES}

{KIT_SHEET}

Storyboard objective: {plan.get('objective', '')}

Code:
```python
{code}
```
Return ONLY the corrected Python source in one ```python block."""


def visual_fix_prompt(code: str, issues: list[str], plan: dict, aspect: str) -> str:
    return f"""This Manim Community v0.19 scene (frame {_frame_desc(aspect)}) renders, but a layout check and a reviewer of its frames found
problems a student on a phone would notice. Fix them and return the COMPLETE corrected file. Keep the storyboard, the
timing and everything that already works; change positions, sizes, what is on screen at once, and FadeOuts.

Problems:
{chr(10).join('- ' + i for i in issues[:14])}

How to fix layout: put each block in its zone with fit(mob, zone); labels with place_label(lab, target, direction); FadeOut
text a beat no longer needs before showing new text; font sizes >= MIN_FONT; never stack two texts in the same spot.

{KIT_SHEET}

Storyboard objective: {plan.get('objective', '')}

Code:
```python
{code}
```
Return ONLY the corrected Python source in one ```python block."""


CRITIC_PROMPT = """You review frames from a short teaching animation that students watch on a phone. The frames are in time order.
Learning objective: {objective}
Automatic layout check found: {layout}
Look hard for: shapes that should fit together (tiles, a proof's pieces, a closed circuit) but leave gaps or pile on each other,
overlapping or colliding text, labels covering lines or shapes so they are hard to read, text cut off at the frame edge,
text too small to read on a phone, cluttered frames, empty or near-empty frames, wrong maths or wrong labels, a picture that does not
match the objective.
Return JSON only: {{"score": 1-10 (10 = clean, correct, readable), "issues": [{{"severity": "high|medium|low", "frame": n, "problem": "...", "fix": "concrete change"}}]}}
"high" = a student would be confused or could not read something. Do not invent problems; an empty list is fine."""


# ───────────────────────── guard ─────────────────────────
ALLOWED_IMPORTS = {"manim", "gm_ffkit", "gm_stage", "numpy", "math", "random", "itertools", "functools", "typing", "colorsys", "__future__"}
BANNED_CALLS = {"open", "exec", "eval", "compile", "__import__", "globals", "locals", "vars", "getattr", "setattr", "delattr", "input",
                "breakpoint", "exit", "quit", "help", "memoryview", "SVGMobject", "ImageMobject", "ImageMobjectFromCamera", "Code"}
BANNED_NAMES = {"os", "sys", "subprocess", "socket", "shutil", "pathlib", "importlib", "builtins", "ctypes", "pickle", "urllib", "requests",
                "httpx", "__builtins__", "signal", "threading", "multiprocessing", "asyncio", "inspect", "gc", "io", "tempfile", "glob",
                # modules / file helpers that `from manim import *` exposes
                "utils", "renderer", "gui", "plugins", "core", "opengl", "open_file", "SceneFileWriter", "seek_full_path_from_defaults",
                "get_full_raster_image_path", "get_full_sound_file_path", "tempconfig", "scene", "mobject", "animation"}
BANNED_ATTRS = {"system", "popen", "fromfile", "tofile", "loadtxt", "savetxt", "genfromtxt", "memmap", "save", "savez", "load",
                "file_writer", "renderer", "f_globals", "f_locals", "gi_frame", "co_code", "func_globals", "os", "sys", "subprocess", "shutil",
                "socket", "pathlib", "importlib", "builtins", "Path", "run", "ctypeslib", "f2py", "npyio", "DataSource", "fromregex", "add_sound",
                "open_file", "file_ops", "write_to_movie"}
_REWRITES = [
    (r"\.get_graph\s*\(", ".plot("), (r"\bShowCreation\s*\(", "Create("), (r"\bTextMobject\s*\(", "Text("),
    (r"\bTexMobject\s*\(", "MathTex("), (r"\bTexText\s*\(", "Tex("),
]
_OLD_API = [
    (r"\bGraphScene\b", "GraphScene was removed; subclass Scene and build Axes(...)."),
    (r"\bFadeInFrom(?:Down|Large|Point)?\b", "FadeInFrom* was removed; use FadeIn(mob, shift=...)."),
    (r"\bFadeOutAndShift(?:Down)?\b", "FadeOutAndShift was removed; use FadeOut(mob, shift=...)."),
    (r"[(,]\s*[xy]_(?:min|max)\s*=(?!=)", "x_min/x_max keyword args are old API; use x_range=[a, b]."),
    (r"(?m)^\s*CONFIG\s*=\s*\{", "CONFIG dicts are ignored in v0.19."),
    (r"\bself\.frame\b", "self.frame is ManimGL; use self.camera.frame in a MovingCameraScene."),
    (r"\bget_line_from_equation\b|\bget_derivative_graph\b|\bget_v_line_to_graph\b", "that Axes method does not exist in v0.19."),
]


def extract_code(text: str) -> str:
    m = re.findall(r"```(?:python|py)?[ \t]*\n(.*?)```", text, re.S)
    if m:
        code = max(m, key=len)
    else:  # an unclosed fence (long answer cut off) or bare code
        code = re.sub(r"^.*?```(?:python|py)?[ \t]*\n", "", text, count=1, flags=re.S) if "```" in text else text
        code = re.sub(r"```\s*$", "", code)
    return code.strip() + "\n"


def guard(code: str) -> tuple[str, list[str]]:
    """(rewritten code, problems). Problems empty = safe to render."""
    for pat, to in _REWRITES:
        code = re.sub(pat, to, code)
    if re.search(r"\bself\.camera\.frame\b", code):
        code = re.sub(r"(class\s+" + SCENE + r"\s*\(\s*)Scene(\s*\))", r"\1MovingCameraScene\2", code, count=1)
    problems = [msg for pat, msg in _OLD_API if re.search(pat, code)]
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return code, problems + [f"SyntaxError: {exc.msg} at line {exc.lineno}: {(exc.text or '').strip()[:120]}"]
    scenes = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name.split(".")[0] not in ALLOWED_IMPORTS:
                    problems.append(f"import {a.name} is not allowed (line {node.lineno}); only manim, gm_ffkit, numpy, math, random, itertools, functools.")
        elif isinstance(node, ast.ImportFrom):
            if (node.module or "").split(".")[0] not in ALLOWED_IMPORTS or node.level:
                problems.append(f"from {node.module} import ... is not allowed (line {node.lineno}).")
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in BANNED_CALLS:
            problems.append(f"{node.func.id}(...) is not allowed (line {node.lineno}).")
        elif isinstance(node, ast.Name) and node.id in BANNED_NAMES:
            problems.append(f"name '{node.id}' is not allowed (line {node.lineno}).")
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("__") and node.attr not in ("__init__",):
                problems.append(f"dunder attribute .{node.attr} is not allowed (line {node.lineno}).")
            elif node.attr in BANNED_ATTRS:
                problems.append(f".{node.attr} is not allowed (line {node.lineno}).")
            if isinstance(node.ctx, ast.Store) and isinstance(node.value, ast.Name) and node.value.id == "config":
                problems.append(f"setting config.{node.attr} is not allowed (line {node.lineno}); the frame is set for you.")
        elif isinstance(node, ast.ClassDef) and node.name == SCENE:
            scenes += 1
        elif isinstance(node, (ast.Global, ast.Nonlocal)) and isinstance(node, ast.Global):
            problems.append(f"global statements are not allowed (line {node.lineno}).")
    if scenes != 1:
        problems.append(f"exactly one class named {SCENE} is required (found {scenes}).")
    if "from manim import *" not in code:
        problems.append("the file must start with `from manim import *`.")
    return code, list(dict.fromkeys(problems))


# ───────────────────────── errors → hints ─────────────────────────
def short_traceback(err: str, code: str | None = None) -> str:
    """Where in the scene it failed (line + source) and the final exception, then the squeezed rich traceback tail."""
    head = ""
    lines_at = [int(n) for n in re.findall(r"scene\.py:(\d+)", err)]
    excs = [ln.strip() for ln in err.splitlines() if re.match(r"^\s*[A-Za-z_.]*(Error|Exception|Interrupt)\b.*", ln)]
    if code and lines_at:
        src = code.splitlines()
        n = lines_at[-1]
        if 0 < n <= len(src):
            head = f"Failed at scene line {n}: {src[n - 1].strip()}\n"
    if excs:
        head += "Exception: " + excs[-1][:400] + "\n"
    err = re.sub(r"[│╭╮╰╯─]+", " ", err)
    err = re.sub(r"[ \t]+", " ", err)
    lines = [ln.strip() for ln in err.splitlines() if ln.strip()]
    keep = []
    for i, ln in enumerate(lines):
        if "scene.py" in ln or re.match(r"^[A-Za-z_.]*(Error|Exception)\b", ln) or ln.startswith("❱") or re.match(r"^\d+ ", ln):
            keep.append(ln)
    tail = lines[-6:]
    out = keep[-24:] + [ln for ln in tail if ln not in keep[-24:]]
    return (head + "\n".join(out))[-2400:]


def error_hints(err: str) -> list[str]:
    h = []
    if "unexpected keyword argument" in err:
        h.append("A keyword argument does not exist in v0.19 for that call: check its signature in the docs below.")
    if "has no attribute" in err or "getter()" in err:
        h.append("That attribute/method does not exist in v0.19 (Mobject.__getattr__ only fakes get_*/set_* names): use one from the docs.")
    if "LaTeX" in err or "latex" in err or "dvi" in err.lower():
        h.append("LaTeX failed to compile: check braces, use raw strings r\"...\", no unicode inside MathTex, text in MathTex goes in \\text{...}.")
    if "always_redraw" in err or "become" in err:
        h.append("always_redraw(lambda: ...) must return a new Mobject each call.")
    if "index" in err and "out of range" in err:
        h.append("Indexing a MathTex/VGroup: MathTex('a','+','b') has one part per string; do not index glyphs.")
    m = re.search(r"(\w+) object has no attribute '(\w+)'", err)
    if m:
        h.append(_attr_hint(m.group(1), m.group(2)))
    m = re.search(r"(\w+)\.__init__\(\) got an unexpected keyword argument '(\w+)'", err) or re.search(r"(\w+)\(\) got an unexpected keyword argument '(\w+)'", err)
    if m:
        h.append(_kw_hint(m.group(1), m.group(2)))
    if "tex_string" in err:
        h.append("TransformMatchingTex only works between MathTex/Tex objects; between Text objects use TransformMatchingShapes or ReplacementTransform.")
    if "unexpected keyword argument" in err and "Mobject.__init__" in err:
        h.append("A keyword was passed down to Mobject.__init__ that the class does not take (e.g. close=, start= on a VMobject/Polygon): remove it.")
    if "AssertionError" in err:
        h.append("One of your own assert checks failed: the construction (coordinates, values) is wrong; recompute it, do not delete the assert.")
    if "NoneType" in err:
        h.append("A method that returns None (e.g. add_updater on some objects, or a function without return) is being used as a Mobject.")
    if "Timeout" in err or "timed out" in err:
        h.append("The render took too long: fewer always_redraw objects, no MathTex rebuilt every frame (use DecimalNumber), shorter run_times.")
    return h


def _manim_attr(cls_name: str):
    try:
        import manim  # the orchestrator runs in the render image, so the real class is at hand
        return getattr(manim, cls_name, None)
    except Exception:  # noqa: BLE001
        return None


def _attr_hint(cls_name: str, attr: str) -> str:
    import difflib

    cls = _manim_attr(cls_name)
    if cls is None:
        return f"{cls_name} has no attribute '{attr}' in v0.19."
    names = [n for n in dir(cls) if not n.startswith("_")]
    close = difflib.get_close_matches(attr, names, n=6, cutoff=0.5)
    extra = {"tex": "tex_string (whole string) / tex_strings (the parts)", "text": "text", "value": "get_value() / set_value()"}.get(attr, "")
    return f"{cls_name} has no attribute '{attr}'. Real ones that are close: {', '.join(close) or 'none'}{('; ' + extra) if extra else ''}."


def _kw_hint(fn_name: str, kw: str) -> str:
    import inspect

    obj = _manim_attr(fn_name)
    if obj is None:
        k = kit_index().get(fn_name)
        return f"{k['sig']} takes no '{kw}' argument." if k else f"{fn_name}() takes no '{kw}' argument."
    try:
        sig = inspect.signature(obj.__init__ if inspect.isclass(obj) else obj)
        return f"{fn_name}{str(sig).replace('(self, ', '(')} takes no '{kw}' argument."
    except (TypeError, ValueError):
        return f"{fn_name}() takes no '{kw}' argument."


# ───────────────────────── layout check ─────────────────────────
def min_font_size(aspect: str) -> float:
    # A 16:9 clip on a ~390 pt wide phone: 1 unit ~ 27 pt, so font_size 28 gives ~10 pt glyphs (the floor we accept). A
    # 9:16 clip fills the phone: 1 unit ~ 87 pt, so font_size 16 is already ~18 pt.
    return 16.0 if aspect == "9:16" else 28.0


def _area(b):
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def _inter(a, b):
    return [max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])]


def _fmt(b) -> str:
    return f"x {b[0]:.1f}..{b[2]:.1f}, y {b[1]:.1f}..{b[3]:.1f}"


def layout_issues(probe: dict, aspect: str) -> list[dict]:
    """Issues from the probe's bounding boxes. severity high = must fix (text overlap, text off frame, illegible)."""
    if not probe or not probe.get("snaps"):
        return []
    fw, fh = probe.get("frame", [14.22, 8.0])
    fx, fy = fw / 2, fh / 2
    minfs = min_font_size(aspect)
    seen: dict = {}

    def add(key, sev, msg, t):
        if key not in seen:
            seen[key] = {"severity": sev, "problem": msg, "t": t}

    for s in probe["snaps"]:
        t = s["t"]
        texts = s["texts"]
        for x in texts:
            b = x["bbox"]
            out = max(-fx - b[0], b[2] - fx, -fy - b[1], b[3] - fy)
            if out > 0.05:
                add(("off", x["label"]), "high", f'text "{x["label"]}" sticks out of the frame by {out:.2f} units at t={t}s', t)
            if x["kind"] in ("Text", "MarkupText", "Paragraph") and re.search(r"\$|\\[a-zA-Z]+|\^\{|_\{", x["label"]):
                add(("rawtex", x["label"]), "high", f'Text "{x["label"]}" shows raw LaTeX ($, \\cmd): Text does not render maths; use MathTex / math_tex for it', t)
            if x.get("font_size") and x["font_size"] < minfs - 0.5 and _area(b) > 0:
                add(("small", x["label"]), "high" if x["font_size"] < minfs * 0.8 else "medium",
                    f'text "{x["label"]}" is font_size {x["font_size"]:.0f}, below the phone-legible {minfs:.0f} (t={t}s)', t)
        for i in range(len(texts)):
            for j in range(i + 1, len(texts)):
                a, b = texts[i]["bbox"], texts[j]["bbox"]
                inter = _inter(a, b)
                iw, ih = inter[2] - inter[0], inter[3] - inter[1]
                min_h = min(a[3] - a[1], b[3] - b[1])
                # glyphs touching is already a collision: any real horizontal overlap with a third of a line height
                if iw > 0.04 and min_h > 1e-3 and ih > 0.3 * min_h:
                    add(("ovl", texts[i]["label"], texts[j]["label"]), "high",
                        f'text "{texts[i]["label"]}" (box {_fmt(a)}) collides with text "{texts[j]["label"]}" (box {_fmt(b)}) at t={t}s', t)
        for o in s["objects"]:
            b = o["bbox"]
            if b[2] - b[0] > 0.9 * fw and b[3] - b[1] > 0.9 * fh:
                continue  # backgrounds / planes
            a = _area(b)
            if a <= 1e-4:
                continue
            ib = _inter(b, [-fx, -fy, fx, fy])
            inside = _area(ib) if ib[2] > ib[0] and ib[3] > ib[1] else 0.0
            if inside / a < 0.8:
                add(("objoff", o["kind"], round(b[0], 1), round(b[1], 1)), "medium",
                    f"a {o['kind']} is {100 * (1 - inside / a):.0f}% outside the frame at t={t}s", t)
        for c in s.get("crossings") or []:
            box = next((x["bbox"] for x in texts if x["label"] == c["text"]), None)
            add(("cross", c["text"], c["by"]), "high", f'a {c["by"]} line (part of {c["by_parent"]}) runs through the text "{c["text"]}"{" (box " + _fmt(box) + ")" if box else ""} at t={t}s: move the text off the line', t)
        chars = sum(len(x["label"]) for x in texts if x["kind"] in ("Text", "MarkupText", "Paragraph"))
        if chars > 140:
            add(("crowd", round(t)), "medium", f"{chars} characters of words on screen at t={t}s (crowded on a phone)", t)
    return list(seen.values())[:20]


def frame_times(probe: dict, duration: float, n: int = 4) -> list[float]:
    """End-of-play moments spread over the clip (what a viewer sees settle)."""
    snaps = [s for s in (probe or {}).get("snaps", []) if s["t"] > 0.3]
    rich = [s for s in snaps if len(s["objects"]) >= 2] or snaps  # skip end-of-clip fade-outs and empty moments
    ts = sorted({round(s["t"], 2) for s in rich})
    if not ts:
        return [round(duration * f, 2) for f in (0.25, 0.5, 0.75, 0.97)][:n]
    picks = []
    for f in [(k + 1) / n for k in range(n)]:
        t = ts[min(len(ts) - 1, max(0, round(f * len(ts)) - 1))]
        if t not in picks:
            picks.append(t)
    return [max(0.0, min(duration - 0.05, t - 0.08)) for t in picks]


# ───────────────────────── the loop ─────────────────────────
def _plan(description, narration, context, aspect, log):
    raw = chat(plan_prompt(description, narration, context, aspect), purpose="plan", json_out=True, max_tokens=1600, temperature=0.4, log=log)
    plan = parse_json(raw)
    if not isinstance(plan, dict) or not plan.get("beats"):
        raise ValueError("planner returned no beats")
    return plan


def _code(prompt, log, purpose="code"):
    # first drafts reason more (geometry, layout); repairs are local edits
    return extract_code(chat(prompt, purpose=purpose, max_tokens=5000, temperature=0.25, log=log, timeout=90,
                             reasoning="medium" if purpose == "code" else "low"))


FACT_PROMPT = """A teaching animation for: {objective}
These are all the strings it shows on screen (LaTeX or plain text), in order:
{shown}
Check each one that states maths or science (an equation, a value, a label claiming a fact). List ONLY the ones that are false,
or inconsistent with the objective (e.g. "c^2 = 2ab" in a Pythagoras proof). Return JSON only:
{{"wrong": [{{"shown": "...", "why": "...", "correct": "what it should say"}}]}}  (empty list if all are right)"""


def shown_strings(code: str) -> list[str]:
    """String literals passed to Text/MathTex/Tex/label/math_tex/title/caption in the scene."""
    out = []
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return out
    for n in ast.walk(tree):
        if isinstance(n, ast.Call):
            fn = n.func.id if isinstance(n.func, ast.Name) else (n.func.attr if isinstance(n.func, ast.Attribute) else "")
            if fn in ("Text", "MathTex", "Tex", "label", "math_tex", "title", "caption", "MarkupText"):
                parts = [a.value for a in n.args if isinstance(a, ast.Constant) and isinstance(a.value, str)]
                if parts:
                    out.append(" ".join(parts))
    return list(dict.fromkeys(out))[:40]


def fact_check(code: str, plan: dict, log: list) -> list[dict]:
    """A cheap text-only check of the maths shown on screen (runs alongside the first render)."""
    shown = shown_strings(code)
    if not shown:
        return []
    try:
        raw = chat(FACT_PROMPT.format(objective=plan.get("objective", "")[:300], shown="\n".join(f"- {x}" for x in shown)),
                   purpose="plan", json_out=True, max_tokens=900, temperature=0.1, log=log, timeout=30, gemini_fallback=False)
        w = parse_json(raw).get("wrong", [])
        return [x for x in w if isinstance(x, dict) and x.get("shown")][:6]
    except Exception as exc:  # noqa: BLE001
        log.append(f"fact check skipped: {str(exc)[:120]}")
        return []


def critique(frames: list[bytes], plan: dict, layout: list[dict], log: list) -> dict:
    if not frames:
        return {"score": None, "issues": [], "skipped": "no frames"}
    lay = "; ".join(i["problem"] for i in layout[:8]) or "nothing"
    prompt = CRITIC_PROMPT.format(objective=plan.get("objective", "")[:300], layout=lay)
    ex = ThreadPoolExecutor(max_workers=1)
    try:
        # bounded: a busy free-tier vision model must never hold the clip back (the layout check still applies)
        fut = ex.submit(gemini, prompt, images=frames, json_out=True, temperature=0.2, log=log, timeout=25, models=CRITIC_MODELS)
        raw = fut.result(timeout=CRITIC_TIMEOUT_S)
        c = parse_json(raw)
        if not isinstance(c, dict):
            raise ValueError("critic answer is not an object")
        c["issues"] = [i for i in c.get("issues", []) if isinstance(i, dict)][:10]
        return c
    except Exception as exc:  # noqa: BLE001
        log.append(f"critic unavailable: {type(exc).__name__} {str(exc)[:160]}")
        return {"score": None, "issues": [], "skipped": f"{type(exc).__name__} {str(exc)[:200]}"}
    finally:
        ex.shutdown(wait=False)


def run(description: str, render, *, narration: dict | None = None, context: str = "", aspect: str = "16:9", log: list | None = None,
        budget_s: float = 170.0, vision: bool = True) -> dict:
    """Plan -> code -> guard -> render (repair errors <= 3) -> layout + vision critic -> one visual repair -> final render.

    render(code, quality, aspect, want_frames, pen) -> {"ok", "error", "probe", "duration", "frames": [jpg bytes],
    "video": bytes (final quality only), "pen": bytes|None, "wall_s"}.
    Returns {"ok", "code", "video", "pen", "report"}; report holds the plan, attempts, repairs, layout issues, critique, timings.
    """
    log = log if log is not None else []
    t0 = time.time()
    T = {}
    rep: dict = {"engine": "freeform", "attempts": [], "repairs_error": 0, "repairs_visual": 0, "aspect": aspect}
    pool = ThreadPoolExecutor(max_workers=3)
    try:
        plan = _plan(description, narration, context, aspect, log)
        T["plan_s"] = round(time.time() - t0, 1)
        rep["plan"] = plan
        apis = " ".join(plan.get("apis", [])) + " " + " ".join(b.get("action", "") for b in plan.get("beats", []))
        docs = retrieve(apis, limit_chars=2600, examples=1)
        code = _code(code_prompt(plan, aspect, docs), log)
        T["code_s"] = round(time.time() - t0, 1)

        good = None  # (code, result)
        for attempt in range(MAX_ERROR_REPAIRS + 1):
            code, problems = guard(code)
            if problems:
                res = {"ok": False, "error": "Sandbox static check rejected the code:\n" + "\n".join(problems), "static": True}
            else:
                res = render(code, "l", aspect, True, False)
            rep["attempts"].append({"ok": res.get("ok"), "static": bool(res.get("static")), "error": (res.get("error") or "")[-600:] or None,
                                    "render_s": res.get("wall_s"), "at_s": round(time.time() - t0, 1)})
            if res.get("ok"):
                dur = float(res.get("duration") or 0)
                if dur < 3:
                    res = {"ok": False, "error": f"The clip is only {dur:.1f} s long; it must follow the storyboard ({plan.get('duration_s')} s) with self.play/self.wait."}
                    rep["attempts"][-1].update(ok=False, error=res["error"])
                else:
                    good = (code, res)
                    break
            if attempt == MAX_ERROR_REPAIRS or time.time() - t0 > budget_s:
                break
            err = short_traceback(res.get("error") or "", code) if not res.get("static") else res["error"]
            fdocs = retrieve(code, priority=err, limit_chars=2000, examples=0)
            code = _code(fix_prompt(code, err, plan, aspect, fdocs, error_hints(err)), log, purpose="fix")
            rep["repairs_error"] += 1
        T["first_ok_s"] = round(time.time() - t0, 1)
        if not good:
            rep["error"] = "free-form scene did not render after %d repairs" % rep["repairs_error"]
            rep["timings"] = T
            return {"ok": False, "error": rep["error"] + ": " + (rep["attempts"][-1].get("error") or "")[-400:], "report": rep}

        code, res = good
        lay = layout_issues(res.get("probe"), aspect)
        rep["layout_v1"] = lay
        # final render of v1 starts now; it is thrown away only if a visual repair is accepted
        final_v1 = pool.submit(render, code, "m", aspect, False, True)
        facts_f = pool.submit(fact_check, code, plan, log)
        crit = critique(res.get("frames") or [], plan, lay, log) if vision else {"score": None, "issues": [], "skipped": "off"}
        rep["critique_v1"] = crit
        try:
            wrong = facts_f.result(timeout=20)
        except Exception:  # noqa: BLE001
            wrong = []
        rep["facts_wrong_v1"] = wrong
        T["critic_s"] = round(time.time() - t0, 1)
        high_lay = [i for i in lay if i["severity"] == "high"]
        high_vis = [i for i in crit.get("issues", []) if i.get("severity") == "high"]
        needs = bool(high_lay or high_vis or wrong or (isinstance(crit.get("score"), (int, float)) and crit["score"] < 6))
        chosen = (code, final_v1)
        if needs and time.time() - t0 < budget_s - 45:
            issues = [i["problem"] for i in high_lay + [x for x in lay if x["severity"] == "medium"][:3]]
            issues += [f"(frame {i.get('frame', '?')}) {i.get('problem', '')} -> {i.get('fix', '')}" for i in crit.get("issues", []) if i.get("severity") in ("high", "medium")]
            issues = [f'WRONG ON SCREEN: "{w["shown"]}" ({w.get("why", "")}); it must say: {w.get("correct", "")}' for w in wrong] + issues
            try:
                code2, probs = guard(_code(visual_fix_prompt(code, issues, plan, aspect), log, purpose="fix"))
                rep["repairs_visual"] = 1
                res2 = {"ok": False, "error": "; ".join(probs)} if probs else render(code2, "l", aspect, True, False)
                lay2 = layout_issues(res2.get("probe"), aspect) if res2.get("ok") else None
                rep["visual_repair"] = {"ok": res2.get("ok"), "error": (res2.get("error") or "")[-400:] or None, "layout_v2": lay2}
                high2 = len([i for i in lay2 if i["severity"] == "high"]) if lay2 is not None else 99
                better = high2 < len(high_lay) or (not high_lay and high2 == 0 and len(lay2) <= len(lay) + 1)
                if wrong and high2 <= len(high_lay):
                    better = better or not fact_check(code2, plan, log)  # the maths was fixed and the layout is no worse
                if res2.get("ok") and float(res2.get("duration") or 0) >= 3 and better:
                    chosen = (code2, pool.submit(render, code2, "m", aspect, False, True))
                    rep["visual_repair"]["accepted"] = True
                    rep["frames_v2"] = len(res2.get("frames") or [])
                    rep["_frames_v2"] = res2.get("frames") or []
                else:
                    rep["visual_repair"]["accepted"] = False
            except Exception as exc:  # noqa: BLE001
                rep["visual_repair"] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"[:300], "accepted": False}
        T["repair_s"] = round(time.time() - t0, 1)
        code, fut = chosen
        fin = fut.result(timeout=max(60.0, budget_s + 120 - (time.time() - t0)))
        if not fin.get("ok") and chosen[1] is not final_v1:
            log.append("final render of the repaired scene failed; using the first version")
            code, fin = good[0], final_v1.result(timeout=240)
        T["final_s"] = round(time.time() - t0, 1)
        rep["timings"] = T
        rep["_frames_v1"] = res.get("frames") or []
        if not fin.get("ok"):
            rep["error"] = "final render failed: " + (fin.get("error") or "")[-400:]
            return {"ok": False, "error": rep["error"], "report": rep}
        rep["duration_s"] = fin.get("duration")
        rep["layout_final"] = layout_issues(fin.get("probe"), aspect) if fin.get("probe") else None
        return {"ok": True, "code": code, "video": fin["video"], "pen": fin.get("pen"), "report": rep}
    except Exception as exc:  # noqa: BLE001
        rep["error"] = f"{type(exc).__name__}: {exc}"[:600]
        rep["timings"] = T
        return {"ok": False, "error": rep["error"], "report": rep}
    finally:
        pool.shutdown(wait=False)


# ───────────────────────── rendering (shared by Modal and local) ─────────────────────────
def render_local(code: str, quality: str = "l", aspect: str = "16:9", want_frames: bool = True, pen: bool = False, *,
                 manim_bin: str = "manim", kit_dir: str | None = None, timeout_s: int | None = None, cpu_s: int = 300, mem_mb: int = 3500) -> dict:
    """Render a vetted scene in a subprocess with rlimits (CPU seconds, address space, file size). quality l = 480p15 (checks
    and critic frames), m = 720p30 (the clip). The network is blocked by the caller's container (Modal block_network)."""
    import glob
    import resource
    import shutil
    import subprocess
    import tempfile

    t = time.time()
    # a 480p15 check of a <= 30 s clip takes ~5-15 s; anything near a minute is a runaway updater, so stop it early
    timeout_s = timeout_s or (60 if quality == "l" else 240)
    wd = tempfile.mkdtemp(prefix="ff-")
    src = os.path.join(wd, "scene.py")
    probe_path = os.path.join(wd, "probe.json")
    pen_path = os.path.join(wd, "pen.json")
    with open(src, "w") as f:
        f.write(code)
        f.write("\n\nimport gm_ffprobe  # noqa: E402,F401  (layout probe, appended by the renderer)\n")
        if pen:
            f.write("try:\n    import pen_export  # noqa: F401,E402\nexcept Exception as _pen_err:  # noqa: BLE001\n    print('pen_export unavailable:', _pen_err)\n")
    res_flag = ["-r", "720,1280"] if aspect == "9:16" and quality == "m" else (["-r", "480,854"] if aspect == "9:16" else [])
    cmd = [manim_bin, "-q" + quality, *res_flag, "--format", "mp4", "--media_dir", os.path.join(wd, "media"), "--disable_caching",
           "--progress_bar", "none", src, SCENE]

    def limits():
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s + 5))
        resource.setrlimit(resource.RLIMIT_AS, (mem_mb * 1024 * 1024, mem_mb * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_FSIZE, (512 * 1024 * 1024, 512 * 1024 * 1024))
        os.setsid()

    env = {k: v for k, v in os.environ.items() if not re.search(r"KEY|TOKEN|SECRET|PASSWORD", k)}
    env.update(FF_PROBE_PATH=probe_path, PEN_EXPORT_PATH=pen_path, PYTHONPATH=kit_dir or _HERE, MPLBACKEND="Agg")
    out: dict = {"ok": False}
    try:
        proc = subprocess.run(cmd, cwd=wd, capture_output=True, text=True, timeout=timeout_s, env=env, preexec_fn=limits)
    except subprocess.TimeoutExpired:
        shutil.rmtree(wd, ignore_errors=True)
        return {"ok": False, "error": f"Render timed out after {timeout_s} s (too many always_redraw objects or MathTex rebuilt every frame?).", "wall_s": round(time.time() - t, 1)}
    logtxt = (proc.stdout or "")[-2500:] + "\n" + (proc.stderr or "")[-6000:]
    probe = None
    if os.path.exists(probe_path):
        try:
            with open(probe_path) as f:
                probe = json.load(f)
        except Exception:  # noqa: BLE001
            probe = None
    files = [p for p in sorted(glob.glob(os.path.join(wd, "media", "videos", "**", "*.mp4"), recursive=True)) if "partial_movie_files" not in p]
    if proc.returncode != 0 or not files:
        shutil.rmtree(wd, ignore_errors=True)
        return {"ok": False, "error": logtxt.strip()[-6000:] or f"manim exited {proc.returncode}", "probe": probe, "wall_s": round(time.time() - t, 1)}
    video = files[-1]
    dur = 0.0
    try:
        p = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", video], capture_output=True, text=True, timeout=20)
        dur = float(p.stdout.strip() or 0)
    except Exception:  # noqa: BLE001
        pass
    out = {"ok": True, "probe": probe, "duration": round(dur, 2)}
    if want_frames:
        frames = []
        for i, ft in enumerate(frame_times(probe, dur)):
            jp = os.path.join(wd, f"f{i}.jpg")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{ft:.2f}", "-i", video, "-frames:v", "1", "-q:v", "4", jp], timeout=30)
            if os.path.exists(jp):
                with open(jp, "rb") as f:
                    frames.append(f.read())
        out["frames"] = frames
        out["frame_times"] = frame_times(probe, dur)
    if quality != "l":
        with open(video, "rb") as f:
            out["video"] = f.read()
        if pen and os.path.exists(pen_path):
            with open(pen_path, "rb") as f:
                out["pen"] = f.read()
    out["wall_s"] = round(time.time() - t, 1)
    shutil.rmtree(wd, ignore_errors=True)
    return out

"""GeniusMap scene grammar: a general visual language the AI composes, rendered with Manim CE v0.19.

The AI never writes a topic preset. It writes a typed JSON scene (see SCENE_GRAMMAR in
src/lib/scene/grammar.ts) from low-level primitives: points, lines, arcs, bezier paths,
polygons, arrows, text and LaTeX with term ids, axes / planes / 3D axes, parametric curves
and surfaces, vector fields, particle arrays, groups and trackers. Motion is a timeline of
transforms (show, morph, match-tex, follow-path, rotate, scale, matrix / pointwise warps,
tracker drives, camera moves) placed on the narration's real word timings.

Craft rules are structural here, not hoped for:
  - every quantity has exactly one colour; objects and equation terms bound to it take it;
  - anything that refers to a tracker is redrawn live (ValueTracker + always_redraw);
  - morphs replace objects in place, so objects stay on screen and evolve;
  - timing comes from the narration, so the clip lasts exactly as long as the voice.

Usage from a scene file (this is what the render service receives as "code"):

    from manim import *
    from gm_scene import build
    SPEC = r'''{...json...}'''
    class GeneratedScene(build(SPEC)):
        pass

A quality report (layout per keyframe: off-frame, overlaps, text density, palette) is written
to $GM_GATE_PATH when set.
"""
from __future__ import annotations

import ast
import json
import math
import os
import random
import re

import numpy as np
from manim import (
    DL, DOWN, DR, LEFT, ORIGIN, OUT, RIGHT, UL, UP, UR, DEGREES, PI,
    Angle, AnimationGroup, ApplyMatrix, ApplyPointwiseFunction, Arc, Arrow, Arrow3D, ArrowVectorField, Axes,
    Brace, Circle, Circumscribe, Create, CubicBezier, DashedLine, DashedVMobject, DecimalNumber, Dot, Dot3D,
    Ellipse, FadeIn, FadeOut, GrowArrow, Indicate, Line, MathTex, MoveAlongPath, MovingCameraScene, NumberPlane,
    ParametricFunction, Polygon, Rectangle, ReplacementTransform, Rotate, RoundedRectangle, Scene, StreamLines,
    Surface, Text, ThreeDAxes, ThreeDScene, TracedPath, TransformMatchingTex, Transform, VGroup, VMobject,
    ValueTracker, Write, always_redraw, config, linear, smooth, there_and_back, rate_functions,
)

# ───────────── Palette (light editorial board) ─────────────
BG = "#FDFCF9"
NEUTRAL = {"ink": "#14141A", "muted": "#6B6B73", "rule": "#D9D6CE"}
# Quantity colours: dark enough for contrast on BG, distinct from each other.
QCOLORS = {
    "green": "#1F6B4A", "clay": "#B4532A", "navy": "#24508F", "amber": "#B7862C",
    "plum": "#7A3B78", "teal": "#17808A", "rose": "#B23A55", "olive": "#6E7A1E",
}
PALETTE = {**NEUTRAL, **QCOLORS}
FRAME_W, FRAME_H = 14.222, 8.0
HALF_W, HALF_H = FRAME_W / 2, FRAME_H / 2

DIRS = {"up": UP, "down": DOWN, "left": LEFT, "right": RIGHT, "ul": UL, "ur": UR, "dl": DL, "dr": DR}
EDGES = {"UL": UL, "UR": UR, "DL": DL, "DR": DR, "UP": UP, "DOWN": DOWN, "LEFT": LEFT, "RIGHT": RIGHT}


class SpecError(ValueError):
    pass


# ───────────── Safe expressions ─────────────
_FUNCS = {
    "sin": np.sin, "cos": np.cos, "tan": np.tan, "asin": np.arcsin, "acos": np.arccos, "atan": np.arctan, "atan2": np.arctan2,
    "sinh": np.sinh, "cosh": np.cosh, "tanh": np.tanh, "exp": np.exp, "log": np.log, "ln": np.log, "log10": np.log10,
    "sqrt": np.sqrt, "abs": np.abs, "floor": np.floor, "ceil": np.ceil, "sign": np.sign, "min": min, "max": max,
    "clip": lambda v, a, b: min(max(v, a), b), "step": lambda v: 1.0 if v >= 0 else 0.0, "mod": lambda a, b: a % b,
    "deg": lambda r: r * 180 / math.pi, "rad": lambda d: d * math.pi / 180, "erf": math.erf, "gauss": lambda x, m, s: math.exp(-((x - m) ** 2) / (2 * s * s)) / (s * math.sqrt(2 * math.pi)),
    "smoothstep": lambda a: 0.0 if a <= 0 else 1.0 if a >= 1 else a * a * (3 - 2 * a), "lerp": lambda a, b, s: a + (b - a) * s,
    "saw": lambda v: v - math.floor(v), "tri": lambda v: 1 - abs(2 * (v - math.floor(v)) - 1),
}
_CONSTS = {"pi": math.pi, "e": math.e, "tau": 2 * math.pi}
_ALLOWED = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Name, ast.Load, ast.Call, ast.List, ast.Tuple,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod, ast.FloorDiv, ast.USub, ast.UAdd,
    ast.IfExp, ast.Compare, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.Eq, ast.NotEq, ast.BoolOp, ast.And, ast.Or,
)
_compiled: dict[str, object] = {}


def _compile(expr: str):
    if expr in _compiled:
        return _compiled[expr]
    src = expr.replace("^", "**")
    tree = ast.parse(src, mode="eval")
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED):
            raise SpecError(f"expression not allowed: {expr!r} ({type(node).__name__})")
        if isinstance(node, ast.Call) and not (isinstance(node.func, ast.Name) and node.func.id in _FUNCS):
            raise SpecError(f"unknown function in {expr!r}")
    code = compile(tree, "<expr>", "eval")
    _compiled[expr] = code
    return code


def names_in(expr) -> set[str]:
    if not isinstance(expr, str):
        if isinstance(expr, (list, tuple)):
            out: set[str] = set()
            for e in expr:
                out |= names_in(e)
            return out
        return set()
    try:
        tree = ast.parse(expr.replace("^", "**"), mode="eval")
    except SyntaxError:
        return set()
    return {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}


# ───────────── The scene ─────────────
class _Ctx:
    """Spec state shared by builders: trackers, params, objects, quantities."""

    def __init__(self, spec: dict, scene):
        self.spec = spec
        self.scene = scene
        self.three_d = spec.get("mode") == "3d"
        self.params = {k: float(v) for k, v in (spec.get("params") or {}).items()}
        self.trackers: dict[str, ValueTracker] = {}
        for t in spec.get("trackers") or []:
            tid, val = (t["id"], t.get("value", 0)) if isinstance(t, dict) else (t, 0)
            self.trackers[tid] = ValueTracker(float(self.ev(val)) if not isinstance(val, (int, float)) else float(val))
        self.quantities = {}
        used = {}
        for q in spec.get("quantities") or []:
            col = q.get("color", "")
            if col not in QCOLORS:
                raise SpecError(f"quantity {q.get('id')} colour {col!r} is not one of {sorted(QCOLORS)}")
            if col in used:
                raise SpecError(f"quantities {used[col]} and {q['id']} share the colour {col}; one colour per quantity")
            used[col] = q["id"]
            self.quantities[q["id"]] = q
        self.defs = {o["id"]: o for o in spec.get("objects") or []}
        self.mobs: dict[str, object] = {}
        self.dynamic: set[str] = set()
        self.issues: list[str] = []
        self.ghosts: dict[str, object] = {}

    # values ------------------------------------------------------------
    def env(self, extra=None):
        d = dict(_CONSTS)
        d.update(_FUNCS)
        d.update(self.params)
        for k, t in self.trackers.items():
            d[k] = t.get_value()
        if extra:
            d.update(extra)
        return d

    def ev(self, v, extra=None):
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            return eval(_compile(v), {"__builtins__": {}}, self.env(extra))  # noqa: S307 - AST-whitelisted
        if isinstance(v, (list, tuple)):
            return [self.ev(x, extra) for x in v]
        raise SpecError(f"bad value {v!r}")

    def fn(self, expr, args):
        code = _compile(expr)
        base = self.env()

        def f(*vals):
            env = dict(base)
            for k, t in self.trackers.items():
                env[k] = t.get_value()
            env.update(dict(zip(args, vals)))
            return eval(code, {"__builtins__": {}}, env)  # noqa: S307
        return f

    def is_dynamic(self, o: dict) -> bool:
        keys = set(self.trackers)
        for k, v in o.items():
            if k in ("id", "kind", "q", "color", "text", "tex", "terms", "label", "of"):
                continue
            if names_in(v) & keys:
                return True
        for ref in (o.get("on"), o.get("graph"), (o.get("next_to") or [None])[0] if isinstance(o.get("next_to"), list) else None, o.get("target")):
            if isinstance(ref, str) and ref in self.dynamic:
                return True
        return False

    def color(self, o: dict, default="ink"):
        q = o.get("q")
        if q:
            if q not in self.quantities:
                raise SpecError(f"object {o.get('id')} refers to unknown quantity {q!r}")
            return QCOLORS[self.quantities[q]["color"]]
        c = o.get("color", default)
        if c in QCOLORS:
            raise SpecError(f"object {o.get('id')} uses quantity colour {c!r} without a quantity; bind it with q or use ink/muted/rule")
        if c not in NEUTRAL:
            raise SpecError(f"object {o.get('id')} colour {c!r} is not in the palette")
        return NEUTRAL[c]

    # coordinates -------------------------------------------------------
    def pt(self, p, on=None, extra=None):
        v = self.ev(p, extra)
        v = [float(x) for x in v] + [0.0] * (3 - len(v))
        if on:
            ax = self.mobs.get(on)
            if ax is None:
                raise SpecError(f"'on' refers to {on!r}, which is not built yet")
            if hasattr(ax, "c2p"):
                return np.array(ax.c2p(*v[: 3 if self.defs[on]["kind"] == "axes3d" else 2]))
        return np.array(v)


def _place(ctx: _Ctx, o: dict, m):
    if "edge" in o:
        m.to_edge(EDGES.get(str(o["edge"]).upper(), UL), buff=float(o.get("buff", 0.45)))
        if str(o["edge"]).upper() in ("UL", "UR", "DL", "DR"):
            m.to_corner(EDGES[str(o["edge"]).upper()], buff=float(o.get("buff", 0.45)))
    elif "next_to" in o:
        ref, d = (o["next_to"] + ["up"])[:2]
        target = ctx.mobs.get(ref)
        if target is None:
            raise SpecError(f"{o['id']} next_to unknown {ref!r}")
        m.next_to(_anchor(ctx, ref, target, o["next_to"]), DIRS.get(d, UP), buff=float(o.get("buff", 0.2)))
    elif "at" in o and o["kind"] not in ("dot", "point"):
        m.move_to(ctx.pt(o["at"], o.get("on")))
    if "shift" in o:
        m.shift(np.array(ctx.ev(o["shift"]) + [0.0] * (3 - len(o["shift"]))))
    if o.get("backdrop"):
        from manim import BackgroundRectangle
        m = VGroup(BackgroundRectangle(m, color=BG, fill_opacity=0.92, buff=0.15, stroke_width=0), m)
    return m


def _anchor(ctx, ref, target, nt):
    """What a label sits next to: a term of an equation (3rd item), or the tip of an arrow / end of a line."""
    from manim import Point
    if len(nt) > 2 and isinstance(nt[2], str):
        if nt[2] in ("start", "end", "mid"):
            try:
                p = target.get_start() if nt[2] == "start" else target.get_end() if nt[2] == "end" else target.point_from_proportion(0.5)
                return Point(p)
            except Exception:  # noqa: BLE001
                return target
        return _term(target, nt[2]) or target
    if ctx.defs.get(ref, {}).get("kind") in ("arrow", "vector"):
        try:
            return Point(target.get_end()) if target.has_points() or target.submobjects else target
        except Exception:  # noqa: BLE001
            return target
    return target


def _term(tex, term: str):
    for sm in tex.get_family():
        if getattr(sm, "gm_terms", None) and term in sm.gm_terms:
            return sm.gm_terms[term]
    for sm in tex.get_family():
        if sm is not tex and getattr(sm, "tex_string", None) == term:
            return sm
    return None


def _style(m, col, o, fill_default=0.0, width_default=3.5):
    width = float(o.get("width", width_default))
    m.set_stroke(color=col, width=width)
    fill = float(o.get("fill", fill_default))
    if fill > 0:
        m.set_fill(color=col, opacity=min(fill, 1.0))
    if o.get("dashed") and isinstance(m, VMobject) and not isinstance(m, DashedLine):
        m = DashedVMobject(m, num_dashes=int(o.get("dashes", 24)))
    return m


def split_terms(raw: str) -> list[str]:
    """Split "a {{\\hat{x}}} b" into ["a ", "\\hat{x}", " b"]: {{...}} groups may contain nested braces."""
    out, buf, i, n = [], "", 0, len(raw)
    while i < n:
        if raw.startswith("{{{", i) and not raw.startswith("{{{{", i):
            # \frac{{{a}} + b}{2}: the first brace is the argument's own, the group starts after it
            buf += "{"
            i += 1
            continue
        if raw.startswith("{{", i):
            depth, j = 0, i + 2
            while j < n:
                c = raw[j]
                if c == "{":
                    depth += 1
                elif c == "}":
                    if depth == 0 and raw.startswith("}}", j):
                        break
                    depth -= 1
                j += 1
            if j >= n:
                raise SpecError(f"unclosed {{{{ in tex {raw!r}")
            if buf:
                out.append(buf)
                buf = ""
            out.append(raw[i + 2 : j])
            i = j + 2
        else:
            buf += raw[i]
            i += 1
    if buf:
        out.append(buf)
    return out


def _glyphs(m):
    return [g for g in m.family_members_with_points()]


def _sig(g):
    pts = g.points[:, :2]
    if len(pts) == 0:
        return None
    c = (pts.max(0) + pts.min(0)) / 2
    size = max(float(np.ptp(pts[:, 0])), float(np.ptp(pts[:, 1])), 1e-6)
    return len(pts), (pts - c) / size, float(np.ptp(pts[:, 0])) / size, float(np.ptp(pts[:, 1])) / size


def _same(a, b):
    if a is None or b is None or a[0] != b[0]:
        return False
    if abs(a[2] - b[2]) > 0.12 or abs(a[3] - b[3]) > 0.12:
        return False
    return float(np.mean(np.abs(a[1] - b[1]))) < 0.05


def find_term_glyphs(full, term: str, used: set, style: str = ""):
    """Glyphs of `term` inside a formula compiled as one string (3Blue1Brown's select-part, by shape)."""
    try:
        t = MathTex(style + term)
    except Exception:  # noqa: BLE001
        return None
    tg = [_sig(g) for g in _glyphs(t)]
    fg = _glyphs(full)
    fs = [_sig(g) for g in fg]
    n = len(tg)
    if not n:
        return None
    for i in range(len(fs) - n + 1):
        if any((i + j) in used for j in range(n)):
            continue
        if all(_same(fs[i + j], tg[j]) for j in range(n)):
            for j in range(n):
                used.add(i + j)
            grp = VGroup(*fg[i : i + n])
            grp.tex_string = term
            return grp
    return None


def _tex(ctx: _Ctx, o: dict):
    raw = o["tex"]
    pieces = [p for p in split_terms(raw) if p.strip()]
    terms = o.get("terms") or {}
    for term, q in terms.items():
        if q not in ctx.quantities:
            raise SpecError(f"tex {o['id']} term {term!r} bound to unknown quantity {q!r}")
    split_ok = all(p.count("{") == p.count("}") and not (len(pieces) > 1 and re.search(r"\\(begin|end)\b|\\left|\\right", p)) for p in pieces)
    m = None
    if split_ok and len(pieces) > 1:
        try:
            m = MathTex(*pieces, font_size=float(o.get("size", 40)), color=NEUTRAL["ink"])
        except Exception:  # noqa: BLE001 - a group that only compiles inside its formula (\\frac{..}{{x}}, x^{{2}}): whole mode
            m = None
    elif len(pieces) <= 1:
        m = MathTex(*pieces, font_size=float(o.get("size", 40)), color=NEUTRAL["ink"])
    if m is not None:
        for term, q in terms.items():
            sm = _term(m, term)
            if sm is None:
                raise SpecError(f"tex {o['id']}: term {term!r} must appear as its own {{{{...}}}} group")
            sm.set_color(QCOLORS[ctx.quantities[q]["color"]])
        return m
    # Terms nested inside \frac{...}, \sqrt{...}, environments: compile the formula whole and find each term's glyphs by shape.
    m = MathTex("".join(pieces), font_size=float(o.get("size", 40)), color=NEUTRAL["ink"])
    m.gm_whole = True
    m.gm_terms = {}
    used: set = set()
    for term in sorted(set(p for p in pieces if p in terms or "{{" + p + "}}" in raw), key=len, reverse=True):
        found = []
        for style in ("", "\\scriptstyle ", "\\scriptscriptstyle "):  # sub/superscript glyphs are drawn differently
            while True:
                g = find_term_glyphs(m, term, used, style)
                if g is None:
                    break
                found.append(g)
        if not found:
            raise SpecError(f"tex {o['id']}: term {term!r} not found in the compiled formula")
        grp = VGroup(*found)
        grp.tex_string = term
        m.gm_terms[term] = grp
        if term in terms:
            grp.set_color(QCOLORS[ctx.quantities[terms[term]]["color"]])
    return m


def _places(r) -> int:
    """Decimals for axis numbers: none for whole-number ticks (1, 2, 3 rather than 1.0, 2.0)."""
    vals = [r[0] + k * r[2] for k in range(1 + int(max(0, (r[1] - r[0]) / (r[2] or 1))))] if len(r) > 2 and r[2] else r[:2]
    for p in range(0, 3):
        if all(abs(v * 10 ** p - round(v * 10 ** p)) < 1e-6 for v in vals):
            return p
    return 2


def _build(ctx: _Ctx, o: dict):
    k = o["kind"]
    on = o.get("on")
    col = ctx.color(o, "muted" if k in ("axes", "plane", "axes3d") else "ink")
    P = lambda key, extra=None: ctx.pt(o[key], on, extra)  # noqa: E731

    if k in ("dot", "point"):
        if ctx.three_d and len(o.get("at", [])) == 3:
            m = Dot3D(P("at"), radius=float(o.get("r", 0.08)), color=col)
        else:
            m = Dot(P("at"), radius=float(o.get("r", 0.08)), color=col)
        return m
    if k == "line":
        a, b = P("from"), P("to")
        if o.get("extend"):
            d = b - a
            n = np.linalg.norm(d) or 1
            a, b = a - d / n * float(o["extend"]), b + d / n * float(o["extend"])
        m = DashedLine(a, b, dash_length=0.12) if o.get("dashed") else Line(a, b)
        return _style(m, col, {**o, "dashed": False}, width_default=3)
    if k in ("arrow", "vector"):
        a = P("from") if "from" in o else ctx.pt([0, 0], on)
        b = P("to")
        if np.linalg.norm(b - a) < 1e-3:
            return VGroup()
        if ctx.three_d and k == "vector" and on and ctx.defs[on]["kind"] == "axes3d":
            return Arrow3D(a, b, color=col)
        m = Arrow(a, b, buff=0, stroke_width=float(o.get("width", 4)), max_tip_length_to_length_ratio=float(o.get("tip", 0.2)), max_stroke_width_to_length_ratio=8)
        m.set_color(col)
        return m
    if k == "arc":
        c = P("center") if "center" in o else ORIGIN
        r = float(ctx.ev(o.get("r", 1)))
        if on:
            r = r * ctx.mobs[on].x_axis.unit_size
        m = Arc(radius=r, start_angle=float(ctx.ev(o.get("start", 0))) * DEGREES, angle=float(ctx.ev(o.get("angle", 90))) * DEGREES, arc_center=c)
        return _style(m, col, o)
    if k == "circle":
        r = float(ctx.ev(o.get("r", 1)))
        if on:
            r = r * ctx.mobs[on].x_axis.unit_size
        m = Circle(radius=r).move_to(P("center") if "center" in o else ORIGIN)
        return _style(m, col, o)
    if k == "ellipse":
        m = Ellipse(width=float(ctx.ev(o.get("w", 2))), height=float(ctx.ev(o.get("h", 1)))).move_to(P("center") if "center" in o else ORIGIN)
        if "angle" in o:
            m.rotate(float(ctx.ev(o["angle"])) * DEGREES)
        return _style(m, col, o)
    if k == "rect":
        w, h = float(ctx.ev(o.get("w", 2))), float(ctx.ev(o.get("h", 1)))
        m = RoundedRectangle(corner_radius=float(o.get("corner", 0.0)) or 0.001, width=w, height=h)
        m.move_to(P("center") if "center" in o else ORIGIN)
        if "angle" in o:
            m.rotate(float(ctx.ev(o["angle"])) * DEGREES)
        return _style(m, col, o)
    if k == "polygon":
        pts = [ctx.pt(p, on) for p in o["points"]]
        return _style(Polygon(*pts), col, o)
    if k == "path":
        pts = [ctx.pt(p, on) for p in o["points"]]
        if o.get("closed"):
            pts = pts + [pts[0]]
        m = VMobject()
        if o.get("smooth"):
            m.set_points_smoothly(pts)
        else:
            m.set_points_as_corners(pts)
        return _style(m, col, o)
    if k == "bezier":
        pts = [ctx.pt(p, on) for p in o["points"]]
        if len(pts) < 4 or (len(pts) - 1) % 3:
            raise SpecError(f"bezier {o['id']} needs 4, 7, 10, ... points (cubic segments sharing ends)")
        m = VMobject()
        m.start_new_path(pts[0])
        for i in range(1, len(pts), 3):
            m.add_cubic_bezier_curve_to(pts[i], pts[i + 1], pts[i + 2])
        return _style(m, col, o)
    if k == "curve":
        # the parameter may be written s, u, x or t (t only when no tracker is called t)
        pnames = ["s", "u", "x"] + ([] if "t" in ctx.trackers else ["t"])
        f0 = ctx.fn(o["fn"], pnames)
        f = lambda v: f0(*([v] * len(pnames)))  # noqa: E731
        s0, s1 = (float(ctx.ev(x)) for x in o.get("range", [0, 1]))
        if on:
            axm = ctx.mobs[on]
            n3 = ctx.defs[on]["kind"] == "axes3d"
            m = ParametricFunction(lambda s: axm.c2p(*(list(f(s)) + [0])[: 3 if n3 else 2]), t_range=[s0, s1, (s1 - s0) / 200])
        else:
            m = ParametricFunction(lambda s: np.array((list(map(float, f(s))) + [0.0, 0.0])[:3]), t_range=[s0, s1, (s1 - s0) / 200])
        return _style(m, col, o)
    if k == "graph":
        axm = ctx.mobs[on]
        f = ctx.fn(o["fn"], ["x"])
        xr = o.get("x", axm.x_range[:2])
        x0, x1 = (float(ctx.ev(x)) for x in xr[:2])
        m = axm.plot(lambda x: float(f(x)), x_range=[x0, x1, (x1 - x0) / 200], use_smoothing=False)
        if o.get("discontinuities"):
            m = axm.plot(lambda x: float(f(x)), x_range=[x0, x1, (x1 - x0) / 400], discontinuities=[float(ctx.ev(d)) for d in o["discontinuities"]], use_smoothing=False)
        return _style(m, col, o)
    if k == "area":
        axm = ctx.mobs[on]
        g = ctx.mobs[o["graph"]]
        a, b = (float(ctx.ev(x)) for x in o["x"])
        if b - a < 1e-3:
            return VGroup()
        kw = {"bounded_graph": ctx.mobs[o["bounded"]]} if o.get("bounded") else {}
        m = axm.get_area(g, x_range=(a, b), color=col, opacity=max(0.25, float(o.get("fill", 0.3))), **kw)
        return m
    if k == "riemann":
        axm = ctx.mobs[on]
        g = ctx.mobs[o["graph"]]
        a, b = (float(ctx.ev(x)) for x in o["x"])
        dx = max(float(ctx.ev(o.get("dx", 0.5))), (b - a) / 400)
        # strokes thin out with the rectangles so a fine sum reads as a solid area, not hatching
        px = dx * axm.x_axis.unit_size
        sw = 1.2 if px > 0.25 else max(0.0, px * 4)
        m = axm.get_riemann_rectangles(g, x_range=[a, b], dx=dx, input_sample_type=o.get("sample", "left"), stroke_width=sw, stroke_color=col, fill_opacity=max(0.35, float(o.get("fill", 0.45))))
        m.set_fill(col, opacity=max(0.35, float(o.get("fill", 0.45))))
        m.set_stroke(col, width=sw, opacity=0.9)
        return m
    if k == "tangent":
        axm = ctx.mobs[on]
        g = ctx.mobs[o["graph"]]
        f = ctx.fn(ctx.defs[o["graph"]]["fn"], ["x"])
        x = float(ctx.ev(o["x"]))
        h = 1e-4
        slope = (f(x + h) - f(x - h)) / (2 * h)
        L = float(o.get("length", 3)) / 2
        a = axm.c2p(x, f(x))
        # unit direction in screen space
        d = np.array(axm.c2p(x + 1, f(x) + slope)) - np.array(a)
        d = d / (np.linalg.norm(d) or 1)
        m = Line(np.array(a) - d * L, np.array(a) + d * L)
        return _style(m, col, o, width_default=3)
    if k == "secant":
        axm = ctx.mobs[on]
        f = ctx.fn(ctx.defs[o["graph"]]["fn"], ["x"])
        x, h = float(ctx.ev(o["x"])), float(ctx.ev(o["h"]))
        if abs(h) < 1e-4:
            h = 1e-4
        a, b = np.array(axm.c2p(x, f(x))), np.array(axm.c2p(x + h, f(x + h)))
        d = (b - a) / (np.linalg.norm(b - a) or 1)
        ext = float(o.get("extend", 1.2))
        return _style(Line(a - d * ext, b + d * ext), col, o, width_default=3)
    if k == "axes":
        xr = [float(ctx.ev(v)) for v in o.get("x", [-5, 5, 1])]
        yr = [float(ctx.ev(v)) for v in o.get("y", [-3, 3, 1])]
        size = o.get("size", [10, 6])
        m = Axes(x_range=xr, y_range=yr, x_length=float(size[0]), y_length=float(size[1]),
                 axis_config={"color": col, "stroke_width": 2, "include_tip": bool(o.get("tips", True)), "tip_length": 0.13, "tip_width": 0.11, "font_size": 22},
                 x_axis_config={"include_numbers": bool(o.get("numbers", False)), "decimal_number_config": {"num_decimal_places": _places(xr)}},
                 y_axis_config={"include_numbers": bool(o.get("numbers", False)), "decimal_number_config": {"num_decimal_places": _places(yr)}})
        if o.get("numbers"):
            for ax in (m.x_axis, m.y_axis):
                if getattr(ax, "numbers", None) is not None:
                    ax.numbers.set_color(NEUTRAL["muted"])
        m.move_to(np.array((ctx.ev(o.get("center", [0, 0])) + [0])[:3]))
        labels = o.get("labels")
        if labels:
            lab = m.get_axis_labels(x_label=MathTex(labels[0], font_size=30, color=NEUTRAL["muted"]), y_label=MathTex(labels[1], font_size=30, color=NEUTRAL["muted"]))
            m.add(lab)
        return m
    if k == "plane":
        xr = [float(v) for v in o.get("x", [-7, 7, 1])]
        yr = [float(v) for v in o.get("y", [-4, 4, 1])]
        size = o.get("size")
        kw = {"x_length": float(size[0]), "y_length": float(size[1])} if size else {}
        m = NumberPlane(x_range=xr, y_range=yr, **kw,
                        background_line_style={"stroke_color": "#8E8C93", "stroke_width": 1.2, "stroke_opacity": 0.5},
                        axis_config={"stroke_color": NEUTRAL["muted"], "stroke_width": 2}, faded_line_ratio=1)
        if o.get("grid_q"):
            m.background_lines.set_stroke(QCOLORS[ctx.quantities[o["grid_q"]]["color"]], 1.5, opacity=0.55)
        m.move_to(np.array((ctx.ev(o.get("center", [0, 0])) + [0])[:3]))
        m.prepare_for_nonlinear_transform()
        if o.get("ghost", True):
            # 3Blue1Brown keeps a faint copy of the original grid under a transformed one
            ghost = NumberPlane(x_range=xr, y_range=yr, **kw, background_line_style={"stroke_color": NEUTRAL["rule"], "stroke_width": 1, "stroke_opacity": 0.6},
                                axis_config={"stroke_color": NEUTRAL["rule"], "stroke_width": 1.5}, faded_line_ratio=1).move_to(m)
            ghost.set_z_index(-2)
            m.set_z_index(-1)
            ctx.ghosts[o["id"]] = ghost
        return m
    if k == "axes3d":
        r = lambda key, d: [float(ctx.ev(v)) for v in o.get(key, d)]  # noqa: E731
        size = o.get("size", [6, 6, 4])
        m = ThreeDAxes(x_range=r("x", [-3, 3, 1]), y_range=r("y", [-3, 3, 1]), z_range=r("z", [-2, 2, 1]),
                       x_length=float(size[0]), y_length=float(size[1]), z_length=float(size[2]),
                       axis_config={"color": col, "stroke_width": 2, "include_tip": False})
        return m
    if k == "surface":
        axm = ctx.mobs[on] if on else None
        f1 = ctx.fn(o["fn"], ["u", "v", "x", "y"])
        f = lambda u, v: f1(u, v, u, v)  # noqa: E731
        ur = [float(ctx.ev(x)) for x in o.get("u", [-2, 2])]
        vr = [float(ctx.ev(x)) for x in o.get("v", [-2, 2])]

        def S(u, v):
            r = f(u, v)
            xyz = [u, v, float(r)] if not isinstance(r, (list, tuple)) else [float(x) for x in r]
            return axm.c2p(*xyz) if axm else np.array(xyz)
        res = int(o.get("res", 24))
        m = Surface(S, u_range=ur, v_range=vr, resolution=(res, res), fill_opacity=float(o.get("fill", 0.55)),
                    checkerboard_colors=[col, col], stroke_color=col, stroke_width=0.4)
        m.set_fill_by_checkerboard(col, col, opacity=float(o.get("fill", 0.55)))
        return m
    if k == "field":
        f = ctx.fn(o["fn"], ["x", "y"])
        xr = [float(v) for v in o.get("x", [-6, 6, 1])]
        yr = [float(v) for v in o.get("y", [-3.5, 3.5, 1])]
        func = lambda p: np.array([float(c) for c in f(p[0], p[1])] + [0.0])  # noqa: E731
        if o.get("stream"):
            m = StreamLines(func, x_range=xr, y_range=yr, stroke_width=1.5, colors=[col], max_anchors_per_line=30, padding=1)
        else:
            m = ArrowVectorField(func, x_range=xr, y_range=yr, colors=[col], length_func=lambda n: 0.85 * np.tanh(n) if not o.get("scale") else min(0.9, n * float(o["scale"])))
            m.set_opacity(float(o.get("opacity", 0.8)))
        return m
    if k == "text":
        m = Text(str(o["text"]), font_size=float(o.get("size", 30)), color=col, font=o.get("font", "") or None) if o.get("font") else Text(str(o["text"]), font_size=float(o.get("size", 30)), color=col)
        return _place(ctx, o, m)
    if k == "tex":
        m = _tex(ctx, o)
        if o.get("q"):
            m.set_color(col)
            for term, q in (o.get("terms") or {}).items():
                _term(m, term).set_color(QCOLORS[ctx.quantities[q]["color"]])
        return _place(ctx, o, m)
    if k == "number":
        m = DecimalNumber(float(ctx.ev(o["value"])), num_decimal_places=int(o.get("decimals", 1)), font_size=float(o.get("size", 36)), color=col)
        grp = [m]
        if o.get("prefix"):
            grp.insert(0, MathTex(o["prefix"], font_size=float(o.get("size", 36)), color=col))
        if o.get("suffix"):
            grp.append(MathTex(o["suffix"], font_size=float(o.get("size", 36)), color=col))
        g = VGroup(*grp).arrange(RIGHT, buff=0.12)
        return _place(ctx, o, g)
    if k == "matrix":
        from manim import Matrix
        def cell(c):
            # an entry naming params / trackers ("a", "2*k") shows its value; anything else is LaTeX
            if isinstance(c, (int, float)):
                v = float(c)
            elif isinstance(c, str) and names_in(c) and names_in(c) <= (set(ctx.params) | set(ctx.trackers) | set(_CONSTS)):
                try:
                    v = float(ctx.ev(c))
                except Exception:  # noqa: BLE001
                    return c
            else:
                return str(c)
            return str(int(round(v))) if abs(v - round(v)) < 1e-6 else f"{v:.2f}".rstrip("0")
        rows = [[cell(c) for c in r] for r in o["rows"]]
        m = Matrix(rows, element_to_mobject_config={"font_size": float(o.get("size", 40)), "color": NEUTRAL["ink"]}, h_buff=float(o.get("hbuff", 1.0)), v_buff=float(o.get("vbuff", 0.7)))
        m.get_brackets().set_color(col)
        for j, q in enumerate(o.get("col_q") or []):
            if q:
                if q not in ctx.quantities:
                    raise SpecError(f"matrix {o['id']} column {j} bound to unknown quantity {q!r}")
                m.get_columns()[j].set_color(QCOLORS[ctx.quantities[q]["color"]])
        for i, q in enumerate(o.get("row_q") or []):
            if q:
                m.get_rows()[i].set_color(QCOLORS[ctx.quantities[q]["color"]])
        return _place(ctx, o, m)
    if k == "brace":
        tgt = ctx.mobs[o["target"]]
        if isinstance(tgt, MathTex) and o.get("term"):
            tgt = _term(tgt, o["term"]) or tgt
        b = Brace(tgt, direction=DIRS.get(o.get("dir", "down"), DOWN), color=col, buff=0.1)
        if o.get("label"):
            lab = MathTex(o["label"], font_size=float(o.get("size", 32)), color=col)
            b.put_at_tip(lab)
            return VGroup(b, lab)
        return b
    if k == "angle":
        l1, l2 = ctx.mobs[o["lines"][0]], ctx.mobs[o["lines"][1]]
        m = Angle(l1, l2, radius=float(o.get("r", 0.5)), other_angle=bool(o.get("other", False)), color=col)
        if o.get("label"):
            lab = MathTex(o["label"], font_size=30, color=col).move_to(Angle(l1, l2, radius=float(o.get("r", 0.5)) + 0.35, other_angle=bool(o.get("other", False))).point_from_proportion(0.5))
            return VGroup(m, lab)
        return m
    if k == "array":
        tmpl = dict(o["of"])
        n = int(o.get("n", 10))
        pts = []
        if o.get("points"):
            pts = [ctx.pt(p, on) for p in o["points"]]
        else:
            box = [float(ctx.ev(v)) for v in o.get("box", [-3, -2, 3, 2])]
            lay = o.get("layout", "random")
            rng = random.Random(int(o.get("seed", 7)))
            if lay == "grid":
                cols = int(o.get("cols", max(1, round(math.sqrt(n)))))
                rows = math.ceil(n / cols)
                for i in range(n):
                    cx, cy = i % cols, i // cols
                    pts.append(np.array([box[0] + (box[2] - box[0]) * (cx + 0.5) / cols, box[1] + (box[3] - box[1]) * (cy + 0.5) / rows, 0]))
            elif lay == "circle":
                cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
                rx, ry = (box[2] - box[0]) / 2, (box[3] - box[1]) / 2
                pts = [np.array([cx + rx * math.cos(2 * PI * i / n), cy + ry * math.sin(2 * PI * i / n), 0]) for i in range(n)]
            elif lay == "line":
                pts = [np.array([box[0] + (box[2] - box[0]) * i / max(1, n - 1), box[1] + (box[3] - box[1]) * i / max(1, n - 1), 0]) for i in range(n)]
            else:
                pts = [np.array([rng.uniform(box[0], box[2]), rng.uniform(box[1], box[3]), 0]) for _ in range(n)]
        items = []
        for i, p in enumerate(pts):
            d = {**tmpl, "id": f"{o['id']}#{i}", "q": tmpl.get("q", o.get("q"))}
            if "q" in d and d["q"] is None:
                d.pop("q")
            d.setdefault("at", [0, 0])
            item = _build(ctx, {**d, "on": None, "at": [0, 0]} if d["kind"] in ("dot", "point") else d)
            item.move_to(p)
            items.append(item)
        return VGroup(*items)
    if k == "group":
        return VGroup(*[ctx.mobs[c] for c in o["children"]])
    if k == "trace":
        tgt = ctx.mobs[o["target"]]
        return TracedPath(tgt.get_center, stroke_color=col, stroke_width=float(o.get("width", 3)), dissipating_time=o.get("fade"))
    raise SpecError(f"unknown object kind {k!r} (id {o.get('id')})")


def build_object(ctx: _Ctx, o: dict):
    try:
        return _build_object(ctx, o)
    except SpecError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise SpecError(f"object {o.get('id')} ({o.get('kind')}): {type(exc).__name__}: {exc}") from exc


def _build_object(ctx: _Ctx, o: dict):
    if ctx.is_dynamic(o):
        ctx.dynamic.add(o["id"])
        holder = {"last": None}

        def make():
            try:
                m = _build(ctx, o)
                holder["last"] = m
                return m
            except (ValueError, ZeroDivisionError, OverflowError, FloatingPointError):
                return holder["last"].copy() if holder["last"] is not None else VGroup()
        m = always_redraw(make)
    else:
        m = _build(ctx, o)
        # a label riding on a dynamic object follows it
        nt = o.get("next_to")
        if isinstance(nt, list) and nt and nt[0] in ctx.dynamic:
            d = DIRS.get((nt + ["up"])[1], UP)
            ref = ctx.mobs[nt[0]]
            buff = float(o.get("buff", 0.2))
            m.add_updater(lambda mm, ref=ref, d=d, buff=buff: mm.next_to(_anchor(ctx, nt[0], ref, nt), d, buff=buff))
    if o.get("z") is not None:
        m.set_z_index(float(o["z"]))
    if o.get("rotate"):
        m.rotate(float(ctx.ev(o["rotate"])) * DEGREES)
    return m


# ───────────── Timeline ─────────────
def _norm_word(w: str) -> str:
    return re.sub(r"[^a-z0-9']", "", w.lower())


def cue_time(narr: dict | None, cue: str, after: float = 0.0) -> float | None:
    if not narr or not cue:
        return None
    words = narr.get("words") or []
    toks = [_norm_word(x) for x in cue.split() if _norm_word(x)]
    if not toks:
        return None
    norm = [_norm_word(w["w"]) for w in words]
    best = None
    for i in range(len(norm) - len(toks) + 1):
        if all(norm[i + j] == toks[j] or (len(toks[j]) > 3 and norm[i + j].startswith(toks[j][:4])) for j in range(len(toks))):
            t = words[i]["s"] / 1000.0
            if t + 0.05 >= after:
                return t
            best = t if best is None else best
    return best


def schedule(spec: dict) -> list[dict]:
    """Resolve each action's start time from its cue / t, sorted. Returns new dicts with _t0 and _dur."""
    narr = spec.get("narration")
    out = []
    prev = 0.0
    for i, a in enumerate(spec.get("timeline") or []):
        t = None
        if "cue" in a:
            t = cue_time(narr, a["cue"], prev - 0.3)
        if t is None and "t" in a:
            t = float(a["t"])
        if t is None:
            t = prev
        dur = float(a.get("dur", 1.0))
        out.append({**a, "_t0": max(0.0, t), "_dur": max(0.1, dur), "_i": i})
        prev = max(prev, t)
    out.sort(key=lambda a: (a["_t0"], a["_i"]))
    return out


def total_duration(spec: dict) -> float:
    narr = spec.get("narration") or {}
    if narr.get("ms"):
        return float(narr["ms"]) / 1000.0 + float(spec.get("tail", 0.4))
    return float(spec.get("duration", 0)) or 0.0


def build(spec_json: str | dict):
    spec = json.loads(spec_json) if isinstance(spec_json, str) else spec_json
    three = spec.get("mode") == "3d"
    Base = ThreeDScene if three else MovingCameraScene
    if three:
        os.environ["PEN_EXPORT_PATH"] = ""  # the hand traces 2D frame strokes only

    class _GM(Base):
        def construct(self):
            run_spec(self, spec)

    _GM.__name__ = "GMScene"
    return _GM


def _anim_show(ctx, mid, m, dur):
    o = ctx.defs.get(mid, {})
    k = o.get("kind")
    style = o.get("show")
    if style == "fade" or k in ("dot", "point", "area", "riemann", "surface", "field", "number", "trace", "array") and style != "create":
        return FadeIn(m, run_time=dur)
    if k in ("text", "tex"):
        return Write(m, run_time=dur)
    if k in ("arrow", "vector") and mid not in ctx.dynamic:
        return GrowArrow(m, run_time=dur)
    if mid in ctx.dynamic:
        return FadeIn(m, run_time=dur)
    return Create(m, run_time=dur)


CONTINUOUS = {"set", "follow", "drift", "rotate", "matrix", "warp"}


def run_spec(scene, spec: dict):
    ctx = _Ctx(spec, scene)
    scene.camera.background_color = BG
    if ctx.three_d:
        cam = spec.get("camera") or {}
        scene.set_camera_orientation(phi=float(cam.get("phi", 65)) * DEGREES, theta=float(cam.get("theta", -50)) * DEGREES, zoom=float(cam.get("zoom", 1)))
    # Build every object up front (hidden until shown) in order, so references resolve.
    for o in spec.get("objects") or []:
        if "id" not in o or "kind" not in o:
            raise SpecError(f"object without id/kind: {o}")
        ctx.mobs[o["id"]] = build_object(ctx, o)
    for tid, t in ctx.trackers.items():
        scene.add(t)

    gate = {"frames": [], "issues": list(ctx.issues), "duration": 0.0}
    acts = [a for a in schedule(spec) if a.get("do") != "wait"]  # time fills itself; a wait would only cut motion short
    end = total_duration(spec)
    groups: list[list[dict]] = []
    for a in acts:
        if groups and abs(a["_t0"] - groups[-1][0]["_t0"]) < 0.12:
            groups[-1].append(a)
        else:
            groups.append([a])
    now = 0.0
    visible: set[str] = set()
    fixed: set[str] = set()
    for gi, g in enumerate(groups):
        t0 = g[0]["_t0"]
        if t0 > now + 0.02:
            scene.wait(t0 - now)
            now = t0
        nxt = groups[gi + 1][0]["_t0"] if gi + 1 < len(groups) else max(end, now + max(a["_dur"] for a in g))
        window = max(0.15, nxt - now) if gi + 1 < len(groups) else max(a["_dur"] for a in g)
        anims, after, played = [], [], []
        for a in g:
            dur = min(a["_dur"], window)
            if a.get("do") in CONTINUOUS and not a.get("exact") and window > dur and gi + 1 < len(groups):
                # 3Blue1Brown keeps motion going while the voice talks: drives stretch into the gap (up to 3x)
                dur = min(window, a["_dur"] * 3)
            try:
                got = [x for x in _action(ctx, scene, a, dur, visible, fixed, after) if x is not None]
                anims += got
                if got:
                    played.append(dur)
            except SpecError:
                raise
            except Exception as exc:  # noqa: BLE001
                raise SpecError(f"action {a.get('do')} #{a['_i']} failed: {exc}") from exc
        anims = [x for x in anims if x is not None]
        if anims:
            scene.play(*anims)
            # `.animate` builders carry no run_time attribute, so the clock follows the durations that were asked for
            now += max(played) if played else max(getattr(x, "run_time", 1.0) for x in anims)
        for f in after:
            f()
        gate["frames"].append(_snapshot(ctx, scene, now, visible))
    if end > now + 0.02:
        scene.wait(end - now)
        now = end
    gate["duration"] = now
    path = os.environ.get("GM_GATE_PATH")
    if path:
        gate["checks"] = _checks(ctx, gate)
        with open(path, "w") as f:
            json.dump(gate, f)


def _ids(a, key="targets"):
    v = a.get(key) if key in a else a.get("target")
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def _pulse(ctx, mid, m, color, scale, dur):
    """Indicate, except for arrows: scaling an Arrow (live or not) can fail inside Manim (a tip without points) and hang
    the render, so arrows get a Circumscribe in their own colour instead."""
    if ctx.defs.get(mid, {}).get("kind") in ("arrow", "vector") or mid in ctx.dynamic:
        return Circumscribe(m, color=color or PALETTE["amber"], run_time=dur, buff=0.08)
    return Indicate(m, color=color, scale_factor=scale, run_time=dur)


def _action(ctx: _Ctx, scene, a: dict, dur: float, visible: set, fixed: set, after: list):
    do = a.get("do")
    M = ctx.mobs

    def need(i):
        if i not in M:
            raise SpecError(f"action {do} refers to unknown object {i!r}")
        return M[i]

    rate = linear if a.get("rate") == "linear" else rate_functions.ease_in_out_sine if a.get("rate") == "sine" else smooth
    if do == "show":
        out = []
        for i in _ids(a):
            m = need(i)
            if ctx.three_d and ctx.defs[i].get("kind") in ("text", "tex", "number") and not ctx.defs[i].get("on"):
                scene.add_fixed_in_frame_mobjects(m)
                fixed.add(i)
                scene.remove(m)
            visible.add(i)
            if i in ctx.ghosts:
                scene.add(ctx.ghosts[i])
            an = _anim_show(ctx, i, m, dur)
            an.rate_func = rate if a.get("rate") else an.rate_func
            out.append(an)
        return out
    if do == "hide":
        out = []
        for i in _ids(a):
            visible.discard(i)
            out.append(FadeOut(need(i), run_time=dur))
        return out
    if do == "set":
        out = []
        for tid, val in (a.get("values") or {}).items():
            if tid not in ctx.trackers:
                raise SpecError(f"set: unknown tracker {tid!r}")
            out.append(ctx.trackers[tid].animate(run_time=dur, rate_func=rate).set_value(float(ctx.ev(val))))
        return out
    if do == "morph":
        src, dst = a["from"], a["to"]
        ms, md = need(src), need(dst)
        ms.clear_updaters()
        visible.discard(src)
        visible.add(dst)
        an = ReplacementTransform(ms, md, run_time=dur, rate_func=rate)
        return [an]
    if do == "match_tex":
        src, dst = a["from"], a["to"]
        visible.discard(src)
        visible.add(dst)
        ms_, md_ = need(src), need(dst)
        whole = any(getattr(x, "gm_whole", False) for f in (ms_, md_) for x in f.get_family())
        if whole or not all(isinstance(x, MathTex) for x in (ms_, md_)):
            from manim import TransformMatchingShapes
            return [TransformMatchingShapes(ms_, md_, run_time=dur, path_arc=float(a.get("arc", 0)) * DEGREES)]
        return [TransformMatchingTex(ms_, md_, run_time=dur, key_map=a.get("key_map") or {}, path_arc=float(a.get("arc", 0)) * DEGREES)]
    if do == "move":
        out = []
        for i in _ids(a):
            m = need(i)
            if "to" in a:
                p = ctx.pt(a["to"], a.get("on"))
                out.append(m.animate(run_time=dur, rate_func=rate).move_to(p))
            elif "by" in a:
                d = np.array([float(x) for x in ctx.ev(a["by"])] + [0.0] * (3 - len(a["by"])))
                out.append(m.animate(run_time=dur, rate_func=rate).shift(d))
            elif "next_to" in a:
                ref, d = (a["next_to"] + ["up"])[:2]
                out.append(m.animate(run_time=dur, rate_func=rate).next_to(need(ref), DIRS.get(d, UP), buff=float(a.get("buff", 0.2))))
        return out
    if do == "rotate":
        out = []
        for i in _ids(a):
            m = need(i)
            about = ctx.pt(a["about"], a.get("on")) if "about" in a else None
            axis = OUT if not a.get("axis") else np.array(a["axis"], dtype=float)
            ang = ctx.ev(a.get("angle", 90))
            ang = ang[0] if isinstance(ang, list) else ang
            out.append(Rotate(m, angle=float(ang) * DEGREES, about_point=about, axis=axis, run_time=dur, rate_func=rate))
        return out
    if do == "scale":
        fac = ctx.ev(a.get("factor", a.get("by", 1.2)))
        if isinstance(fac, list):
            sx, sy = (float(fac[0]), float(fac[1] if len(fac) > 1 else fac[0]))
            return [need(i).animate(run_time=dur, rate_func=rate).stretch(sx, 0).stretch(sy, 1) for i in _ids(a)]
        return [need(i).animate(run_time=dur, rate_func=rate).scale(float(fac)) for i in _ids(a)]
    if do == "follow":
        path = need(a["path"])
        return [MoveAlongPath(need(i), path, run_time=dur, rate_func=rate if a.get("rate") else linear) for i in _ids(a)]
    if do == "matrix":
        mat = np.array([[float(ctx.ev(x)) for x in row] for row in a["m"]])
        about = ctx.pt(a["about"], None) if "about" in a else ORIGIN
        return [ApplyMatrix(mat, need(i), about_point=about, run_time=dur, rate_func=rate) for i in _ids(a)]
    if do == "warp":
        f = ctx.fn(a["fn"], ["x", "y"])
        def pf(p):
            r = f(p[0], p[1])
            return np.array([float(r[0]), float(r[1]), p[2]])
        return [ApplyPointwiseFunction(pf, need(i), run_time=dur, rate_func=rate) for i in _ids(a)]
    if do == "camera":
        if ctx.three_d:
            if a.get("spin") is not None:
                if float(a["spin"]) == 0:
                    scene.stop_ambient_camera_rotation()
                else:
                    scene.begin_ambient_camera_rotation(rate=float(a["spin"]) * DEGREES)
                return []
            kw = {}
            for key in ("phi", "theta"):
                if key in a:
                    kw[key] = float(a[key]) * DEGREES
            if "zoom" in a:
                kw["zoom"] = float(a["zoom"])
            # move_camera plays its own animation; emulate inside this group by deferring
            anims = []
            cam = scene.renderer.camera
            if "phi" in kw:
                anims.append(cam.phi_tracker.animate(run_time=dur, rate_func=rate).set_value(kw["phi"]))
            if "theta" in kw:
                anims.append(cam.theta_tracker.animate(run_time=dur, rate_func=rate).set_value(kw["theta"]))
            if "zoom" in kw:
                anims.append(cam.zoom_tracker.animate(run_time=dur, rate_func=rate).set_value(kw["zoom"]))
            return anims
        frame = scene.camera.frame
        an = frame.animate(run_time=dur, rate_func=rate)
        if "zoom" in a:
            an = an.set(width=FRAME_W / float(a["zoom"]))
        if "center" in a:
            an = an.move_to(ctx.pt(a["center"], a.get("on")))
        elif "follow" in a:
            an = an.move_to(need(a["follow"]).get_center())
        return [an]
    if do == "indicate":
        return [_pulse(ctx, i, need(i), PALETTE["amber"] if not ctx.defs.get(i, {}).get("q") else None, 1.08, dur) for i in _ids(a)]
    if do == "circle":
        return [Circumscribe(need(i), color=PALETTE["amber"], run_time=dur, buff=0.08) for i in _ids(a)]
    if do == "link":
        eq = need(a["eq"])
        term = _term(eq, a["term"])
        if term is None:
            raise SpecError(f"link: term {a.get('term')!r} not found in {a.get('eq')}")
        tgt = need(a["target"])
        c = term.get_color()
        conn = DashedLine(term.get_critical_point(DOWN if tgt.get_center()[1] < term.get_center()[1] else UP), tgt.get_center(), color=c, stroke_width=2, dash_length=0.1)
        scene.add(conn)
        after.append(lambda: scene.remove(conn))
        return [Indicate(term, color=c, scale_factor=1.25, run_time=dur), _pulse(ctx, a["target"], tgt, c, 1.1, dur), Create(conn, run_time=dur * 0.5, rate_func=there_and_back)]
    if do == "color":
        q = a["q"]
        if q not in ctx.quantities:
            raise SpecError(f"color: unknown quantity {q!r}")
        return [need(i).animate(run_time=dur).set_color(QCOLORS[ctx.quantities[q]["color"]]) for i in _ids(a)]
    if do == "drift":
        out = []
        box = [float(ctx.ev(v)) for v in a.get("box", [-3, -2, 3, 2])]
        rng = random.Random(int(a.get("seed", 3)))
        frac = float(a.get("fraction", 1.0))
        for i in _ids(a):
            grp = need(i)
            for sm in grp.submobjects:
                if rng.random() > frac:
                    continue
                p0 = sm.get_center()
                p1 = np.array([rng.uniform(box[0], box[2]), rng.uniform(box[1], box[3]), 0])
                mid = (p0 + p1) / 2 + np.array([rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), 0])
                path = VMobject().set_points_smoothly([p0, mid, p1])
                out.append(MoveAlongPath(sm, path, run_time=dur * rng.uniform(0.75, 1.0), rate_func=smooth))
        return out
    if do == "wait":
        return []
    raise SpecError(f"unknown action {do!r}")


# ───────────── Quality report ─────────────
def _bbox(m):
    try:
        if not m.has_points() and not m.submobjects:
            return None
        lo, hi = m.get_critical_point(DL), m.get_critical_point(UR)
        return [float(lo[0]), float(lo[1]), float(hi[0]), float(hi[1])]
    except Exception:  # noqa: BLE001
        return None


def _words(ctx, i):
    o = ctx.defs.get(i, {})
    if o.get("kind") == "text":
        return len(str(o.get("text", "")).split())
    if o.get("kind") == "tex":
        return max(1, len(re.sub(r"\\[a-zA-Z]+|[{}^_ ]", "", o.get("tex", ""))) // 6)
    return 0


def _snapshot(ctx: _Ctx, scene, t: float, visible: set):
    items = []
    for i in sorted(visible):
        o = ctx.defs.get(i, {})
        m = ctx.mobs.get(i)
        if m is None or o.get("kind") in ("trace",):
            continue
        b = _bbox(m)
        if b:
            items.append({"id": i, "kind": o.get("kind"), "b": [round(x, 3) for x in b]})
    cam = None
    if not ctx.three_d:
        f = scene.camera.frame
        c = f.get_center()
        cam = [float(c[0] - f.width / 2), float(c[1] - f.height / 2), float(c[0] + f.width / 2), float(c[1] + f.height / 2)]
    return {"t": round(t, 3), "items": items, "cam": cam, "words": sum(_words(ctx, x["id"]) for x in items)}


def _overlap(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    small = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])) or 1e-6
    return w * h / small


def _checks(ctx: _Ctx, gate: dict):
    issues = []
    seen = set()
    for fr in gate["frames"]:
        cam = fr["cam"] or [-HALF_W, -HALF_H, HALF_W, HALF_H]
        for it in fr["items"]:
            b = it["b"]
            if (ctx.three_d and it["kind"] not in ("text", "tex", "number")) or it["kind"] in ("plane", "field"):
                continue
            out = max(cam[0] - b[0], b[2] - cam[2], cam[1] - b[1], b[3] - cam[3])
            if out > 0.08:
                key = ("off", it["id"])
                if key not in seen:
                    seen.add(key)
                    issues.append({"type": "off_frame", "id": it["id"], "t": fr["t"], "by": round(out, 2)})
        texts = [it for it in fr["items"] if it["kind"] in ("text", "tex", "number")]
        for x in range(len(texts)):
            for y in range(x + 1, len(texts)):
                ov = _overlap(texts[x]["b"], texts[y]["b"])
                if ov > 0.12:
                    key = ("ov", texts[x]["id"], texts[y]["id"])
                    if key not in seen:
                        seen.add(key)
                        issues.append({"type": "text_overlap", "ids": [texts[x]["id"], texts[y]["id"]], "t": fr["t"], "frac": round(ov, 2)})
        # text sitting on a filled shape or a dot (not its own label target) is hard to read
        solids = [it for it in fr["items"] if it["kind"] in ("dot", "rect", "circle", "polygon", "ellipse") and ctx.defs.get(it["id"], {}).get("fill", 0) > 0.4]
        for tx in texts:
            for s in solids:
                if _overlap(tx["b"], s["b"]) > 0.5 and (s["b"][2] - s["b"][0]) < (tx["b"][2] - tx["b"][0]) * 3:
                    key = ("ovs", tx["id"], s["id"])
                    if key not in seen:
                        seen.add(key)
                        issues.append({"type": "text_on_shape", "ids": [tx["id"], s["id"]], "t": fr["t"]})
        if fr["words"] > 18:
            key = ("dense", fr["t"] // 5)
            if key not in seen:
                seen.add(key)
                issues.append({"type": "text_density", "t": fr["t"], "words": fr["words"]})
    # colour: a quantity declared but never drawn, or drawn with no quantity
    used = {o.get("q") for o in ctx.spec.get("objects") or []} | {q for o in ctx.spec.get("objects") or [] for q in (o.get("terms") or {}).values()}
    for q in ctx.quantities:
        if q not in used:
            issues.append({"type": "unused_quantity", "id": q})
    return issues

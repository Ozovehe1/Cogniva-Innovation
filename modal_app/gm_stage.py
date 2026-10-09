"""gm_stage: draws and animates a solved gm_world scene in Manim (imported by generated scenes inside the render sandbox).

A generated scene file is:

    from manim import *
    from gm_stage import Stage
    IR = {...}                      # the scene language (gm_world.py)
    def glue_name(st, scene): ...   # optional raw-Manim glue for what the language cannot say (st.pos/st.mob/st.val give
                                    # solved positions, mobjects and var values, so glue never computes a coordinate)
    class GeneratedScene(Scene):
        def construct(self):
            Stage(self, IR, glue=globals()).run()

Layout is deterministic: title strip, main stage (geometry fitted by gm_world), a side panel (or bottom band when an
equation is too wide) for the one live equation and readouts, and a caption strip for notes. Labels are placed by a
small search over candidate positions that scores overlap with other labels, drawn geometry and the frame edges.
Every text is at least the phone-legible size.
"""
from __future__ import annotations

import math
import re

import numpy as np
from manim import (
    DOWN, LEFT, ORIGIN, RIGHT, UP, Arc, Arrow, Axes, Brace, Circle, Create, CurvedArrow, DashedLine, Dot, Ellipse, FadeIn, FadeOut,
    FadeTransform, GrowArrow, Indicate, Line, MathTex, Polygon, Rectangle, RightAngle, RoundedRectangle, Square, Text, TracedPath,
    Transform, TransformMatchingTex, Triangle, UpdateFromAlphaFunc, ValueTracker, VGroup, VMobject, Write, config, rate_functions,
)

import gm_world as GW

BG = "#FDFCF9"
COLORS = {"ink": "#14141A", "muted": "#8A8A93", "a": "#23406A", "b": "#A4502A", "c": "#1F4D3A", "d": "#7A3B78", "accent": "#C98A1B",
          "highlight": "#D1495B", "good": "#2E7D4F", "bad": "#C0392B", "water": "#2B7BB9", "light": "#E8E4DA", "warm": "#D1495B",
          "cool": "#3C8DBC", "teal": "#17808A", "navy": "#23406A", "clay": "#A4502A", "green": "#1F4D3A", "plum": "#7A3B78",
          "amber": "#B7862C", "red": "#C0392B", "blue": "#2B7BB9", "orange": "#E07A2E", "yellow": "#E8B923", "gray": "#8A8A93",
          "grey": "#8A8A93", "black": "#14141A", "white": "#FFFFFF", "brown": "#7B5232", "purple": "#7A3B78", "pink": "#D1495B"}
DEFAULT_CYCLE = ["a", "b", "c", "d", "teal", "accent"]


def col(c, default="ink"):
    if c is None:
        c = default
    c = str(c)
    if c.startswith("#") and len(c) in (4, 7):
        return c
    return COLORS.get(c.lower(), COLORS.get(default, "#14141A"))


PORTRAIT = config.frame_height > config.frame_width
FW, FH = float(config.frame_width), float(config.frame_height)

# ── layout weights ──
# The label solver's penalties and the legibility floor. These are defaults: a scene may carry "layout_weights" (learned per
# recurring failure pattern and stored in the database by the web app), always clamped to LAYOUT_BOUNDS here.
#   clear      clearance band around a label, in label heights (strokes/glyphs inside it are penalised)
#   clear_w    penalty per stroke sample inside the clearance band (scaled by how deep it is)
#   stroke_in  penalty per stroke sample under the label itself
#   anchor     penalty per label height of distance from the label to its target's ink (plus a gentle pull to its natural spot)
#   reach      beyond this many label heights from its target a label reads as detached (steep penalty)
#   own        penalty (per label height) when the label sits nearer another line/arrow/point than its own target
#   tick_clear clearance (in tick heights) an axis number keeps from drawn marks before it fades out
#   min_xh_px  the phone-legible floor: smallest lowercase x-height in CSS px on a ~390 px wide phone
LAYOUT_DEFAULTS = {"clear": 0.5, "clear_w": 3.0, "stroke_in": 4.0, "anchor": 0.6, "reach": 2.0, "own": 6.0, "tick_clear": 0.25, "min_xh_px": 6.0}
LAYOUT_BOUNDS = {"clear": (0.25, 1.0), "clear_w": (1.0, 12.0), "stroke_in": (2.0, 12.0), "anchor": (0.2, 3.0), "reach": (1.0, 4.0),
                 "own": (2.0, 20.0), "tick_clear": (0.1, 0.8), "min_xh_px": (5.5, 8.0)}


def layout_weights(over=None) -> dict:
    w = dict(LAYOUT_DEFAULTS)
    for k, v in (over or {}).items():
        if k in LAYOUT_BOUNDS:
            try:
                lo, hi = LAYOUT_BOUNDS[k]
                w[k] = min(hi, max(lo, float(v)))
            except (TypeError, ValueError):
                pass
    return w


# ── text sizes: computed from the frame and the output, never fixed ──
# A role's design size scales with the frame's short side (DESIGN_EM font units per frame unit), and every text is at least
# the phone-legible floor: the font size whose lowercase x-height reaches min_xh_px on a phone. The player fills a ~390 CSS px
# wide viewport (portrait and landscape); a lower-resolution render is limited by its own pixels. Glyph metrics are measured
# from the fonts (TeX glyphs are ~2/3 the height of Text glyphs at one font_size, so maths gets its own floor).
PHONE_CSS_PX = 390.0
DESIGN_EM = {"title": 4.75, "label": 4.0, "body": 3.75, "math": 5.75, "note": 3.75, "cell": 4.0, "box": 3.75}
_XH_FALLBACK = {"text": 0.3461 / 48, "tex": 0.2257 / 48}
_METRIC: dict = {}


def _xh(kind="text") -> float:
    """Lowercase x-height per font_size unit (frame units), measured once from the font."""
    if kind not in _METRIC:
        try:
            m = Text("x", font_size=48) if kind == "text" else MathTex("x", font_size=48)
            _METRIC[kind] = float(m.height) / 48.0 or _XH_FALLBACK[kind]
        except Exception:  # noqa: BLE001
            _METRIC[kind] = _XH_FALLBACK[kind]
    return _METRIC[kind]


def px_per_unit(frame_w=None, pixel_w=None) -> float:
    fw = float(frame_w or FW)
    return min(PHONE_CSS_PX, float(pixel_w or config.pixel_width)) / fw


def legible_fs(kind="text", min_xh_px=None, frame_w=None, pixel_w=None) -> float:
    return float(min_xh_px or LAYOUT_DEFAULTS["min_xh_px"]) / px_per_unit(frame_w, pixel_w) / _xh(kind)


def text_kind(m) -> str:
    return "tex" if isinstance(m, MathTex) or m.__class__.__name__ in ("SingleStringMathTex", "Tex") else "text"


def text_px(m) -> float:
    """x-height of a text mobject in phone CSS px (font_size follows any scaling)."""
    try:
        return float(m.font_size) * _xh(text_kind(m)) * px_per_unit()
    except Exception:  # noqa: BLE001
        return float("inf")


FS: dict = {}
_DBG = __import__("os").environ.get("GM_LAYOUT_DEBUG") or ""  # "1" = placements; a label id = also its best candidates


def set_sizes(min_xh_px=None):
    floor = legible_fs("text", min_xh_px)
    short = min(FW, FH)
    FS.clear()
    FS.update({k: max(floor, round(v * short, 1)) for k, v in DESIGN_EM.items()})
    FS["min"] = floor
    FS["tex_min"] = legible_fs("tex", min_xh_px)
    GW.BOX_FS = FS["box"]
    GW.BOX_TEX_FS = max(FS["tex_min"], FS["box"] + 8)


set_sizes()


def _t(text, fs=None, color="ink", weight="NORMAL"):
    return Text(str(text), font_size=max(FS["min"], fs or FS["body"]), color=col(color), weight=weight)


def _tex_pow(s: str) -> str:
    """Exponents grouped for TeX: x**(n-1) -> x^{n-1}, x**10 -> x^{10}, x^10 -> x^{10}, e^(-k t) -> e^{-k t}."""
    out, i = [], 0
    while i < len(s):
        if s.startswith("**", i) or (s[i] == "^" and not s.startswith("^{", i)):
            star = s.startswith("**", i)
            i += 2 if star else 1
            while i < len(s) and s[i] == " ":
                i += 1
            if i < len(s) and s[i] == "(":
                depth, j = 0, i
                while j < len(s):
                    depth += s[j] == "("
                    depth -= s[j] == ")"
                    if depth == 0:
                        break
                    j += 1
                out.append("^{" + s[i + 1:j] + "}")
                i = j + 1
                continue
            m = re.match(r"-?[\w.]+" if star else r"-?\d+(?:\.\d+)?|[A-Za-z]", s[i:])
            tok = m.group(0) if m else ""
            out.append("^{" + tok + "}" if tok else "^")
            i += len(tok)
            continue
        out.append(s[i])
        i += 1
    return "".join(out)


def _tex_clean(s: str) -> str:
    """Sympy-style products in a TeX string read as maths: 3*(y-5) -> 3(y-5), 2*x -> 2x, a*b -> a \\cdot b."""
    s = _tex_pow(str(s))
    if "*" not in s or "\\" in s:
        return s
    s = re.sub(r"(\d)\s*\*\s*(?=[(A-Za-z])", r"\1", s)
    return s.replace("*", r" \cdot ")


def _m(tex, fs=None, color="ink"):
    return MathTex(_tex_clean(tex), font_size=max(FS["tex_min"], fs or FS["math"]), color=col(color))


class _C:
    """A candidate label position: centre + the label's size (no Mobject copy; label search runs hundreds of these)."""
    __slots__ = ("c", "width", "height")

    def __init__(self, c, w, h):
        self.c = np.array([float(c[0]), float(c[1]), 0.0])
        self.width, self.height = w, h

    @staticmethod
    def at(m, c):
        return _C(c, m.width, m.height)

    @staticmethod
    def _nt(box, d, buff, m):
        d = np.array(d, dtype=float)
        sx, sy = np.sign(d[0]), np.sign(d[1])
        cx = (box[0] + box[2]) / 2 if sx == 0 else (box[2] if sx > 0 else box[0])
        cy = (box[1] + box[3]) / 2 if sy == 0 else (box[3] if sy > 0 else box[1])
        return _C([cx + sx * (buff + m.width / 2), cy + sy * (buff + m.height / 2)], m.width, m.height)

    @staticmethod
    def near_point(p, r, d, buff, m):
        return _C._nt([p[0] - r, p[1] - r, p[0] + r, p[1] + r], d, buff, m)

    @staticmethod
    def next_to(mob, d, buff, m):
        return _C._nt(_box(mob), d, buff, m)

    def get_center(self):
        return self.c

    def get_left(self):
        return self.c - np.array([self.width / 2, 0, 0])

    def get_right(self):
        return self.c + np.array([self.width / 2, 0, 0])

    def get_top(self):
        return self.c + np.array([0, self.height / 2, 0])

    def get_bottom(self):
        return self.c - np.array([0, self.height / 2, 0])


def _box(m):
    return np.array([m.get_left()[0], m.get_bottom()[1], m.get_right()[0], m.get_top()[1]])


def _ovl(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    return max(0.0, w) * max(0.0, h)


def _box_dist(b, pts) -> float:
    """Shortest distance from a box to a set of points (0 when one is inside). Points may carry the half-width of the stroke
    they sit on as a third column: the distance is then to the edge of the ink, not its centre line."""
    return float(_ink_dist(b, pts).min())


def _in_poly(pts, poly) -> np.ndarray:
    """Even-odd point-in-polygon for many points."""
    x, y = pts[:, 0], pts[:, 1]
    inside = np.zeros(len(pts), dtype=bool)
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        cross = ((y1 > y) != (y2 > y)) & (x < (x2 - x1) * (y - y1) / ((y2 - y1) if y2 != y1 else 1e-12) + x1)
        inside ^= cross
    return inside


def _ink_dist(b, pts):
    dx = np.maximum(np.maximum(b[0] - pts[:, 0], 0.0), pts[:, 0] - b[2])
    dy = np.maximum(np.maximum(b[1] - pts[:, 1], 0.0), pts[:, 1] - b[3])
    d = np.hypot(dx, dy)
    if pts.shape[1] > 2:
        d = np.where(d > 0, np.maximum(d - pts[:, 2], 1e-6), 0.0)
    return d


class Stage:
    def __init__(self, scene, ir: dict, glue: dict | None = None):
        self.scene = scene
        self.ir = ir
        self.glue = glue or {}
        scene.camera.background_color = BG
        self.LW = layout_weights(ir.get("layout_weights"))
        set_sizes(self.LW["min_xh_px"])
        self.W = GW.World(ir, "9:16" if PORTRAIT else "16:9")
        self._layout_zones()
        res = self.W.build(self.main_box)
        if not res["ok"]:
            raise RuntimeError("scene does not verify: " + " | ".join(res["problems"][:6]))
        self.mobs: dict = {}
        self.shown: list[str] = []
        # labels that no beat mentions: shown together with what they label
        mentioned = set()
        for b in ir.get("beats") or []:
            for a in b.get("do") or []:
                for x in _as(a)[1:]:
                    for y in (x if isinstance(x, list) else [x]):
                        if isinstance(y, str):
                            mentioned.add(y)
        self._orphans: dict = {}
        for oid, o in self.W.objs.items():
            if o["type"] == "label" and o.get("for") and oid not in mentioned and not o.get("_auto"):
                self._orphans.setdefault(str(o["for"]), []).append(oid)
        # a function named with a word (supply, demand, velocity) is labelled with it unless it has a label
        for oid, o in list(self.W.objs.items()):
            if o["type"] == "function" and not o.get("label") and not o.get("tex_label") and f"{oid}.lbl" not in self.W.objs \
                    and re.fullmatch(r"[A-Za-z]{3,14}", oid) and not any(x.get("for") == oid for x in self.W.objs.values() if x["type"] == "label"):
                self.W.objs[f"{oid}.lbl"] = {"type": "label", "id": f"{oid}.lbl", "for": oid, "text": oid.capitalize(), "color": o.get("color"), "_auto": True}
        # an icon named with a word or a formula (sun, water, co2) is labelled with it unless something labels it already
        for oid, o in list(self.W.objs.items()):
            if o["type"] == "icon" and not o.get("label") and not o.get("tex_label") and f"{oid}.lbl" not in self.W.objs \
                    and not o.get("nolabel") and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{1,15}", oid) \
                    and not any(x.get("for") == oid for x in self.W.objs.values() if x["type"] == "label"):
                if re.fullmatch(r"(?:[A-Z]?[a-z]?\d*){1,4}", oid) and re.search(r"\d", oid):
                    txt = re.sub(r"([a-z])", lambda m: m.group(1).upper(), oid)  # co2 -> CO2, h2o -> H2O
                elif re.fullmatch(r"[a-z]+\d+", oid):
                    txt = oid.upper()
                else:
                    txt = oid.replace("_", " ").strip().capitalize()
                self.W.objs[f"{oid}.lbl"] = {"type": "label", "id": f"{oid}.lbl", "for": oid, "text": txt, "color": "ink", "_auto": True, "side": "below"}
        self.labels: dict = {}  # label id -> (mobject, anchor ref, offset)
        self.vals = self.W.state_vals
        self.X = self.W.X
        self.eq_mob = None
        self.eq_note = None
        self.note_mob = None
        self.readouts: dict = {}
        self.traces: dict = {}
        self.dimmed: list = []
        self.cycle = 0
        self.title_mob = None
        self.audit: dict = {"labels": {}, "min_text_px": None, "ticks_faded": 0, "ticks_restored": 0}

    # ── zones ──
    def _layout_zones(self):
        objs = self.ir.get("objects") or []
        has_eq = any(o.get("type") == "equation" for o in objs if isinstance(o, dict))
        has_ro = any(o.get("type") == "readout" for o in objs if isinstance(o, dict))
        self.n_ro = sum(1 for o in objs if isinstance(o, dict) and o.get("type") == "readout")
        has_notes = any(_as(a)[0] == "note" for b in self.ir.get("beats") or [] for a in b.get("do") or [] if _as(a))
        m = 0.3
        top = FH / 2 - (1.0 if self.ir.get("title") else 0.4)
        bot = -FH / 2 + (0.95 if has_notes else 0.4)
        self.panel = None
        self.band = None
        self.ro_strip = None
        if PORTRAIT:
            if has_eq or has_ro:
                self.panel = [-FW / 2 + m, bot, FW / 2 - m, bot + 1.9]
                bot += 2.0
            self.main_box = [-FW / 2 + m + 0.15, bot + 0.15, FW / 2 - m - 0.15, top - 0.15]
        else:
            widest = 0.0
            try:
                self.W.equation_report()  # generates each equation's LaTeX; measure the real widths
            except Exception:  # noqa: BLE001
                pass
            for oid, o in self.W.objs.items():
                if o.get("type") == "equation":
                    for ln in o.get("_lines") or []:
                        try:
                            widest = max(widest, self._eq_mob(ln, probe=True).width)
                        except Exception:  # noqa: BLE001
                            widest = max(widest, 6.0)
            self.ro_strip = None
            if has_eq and widest * FS["tex_min"] / FS["math"] > 4.6:
                self.band = [-FW / 2 + m, bot, FW / 2 - m, bot + 1.15]
                bot += 1.25
            elif has_eq:
                pw = max(3.4, min(4.6, widest + 0.3))
                self.panel = [FW / 2 - m - pw, bot, FW / 2 - m, top]
            if has_ro and not self.panel:
                # readouts: a strip along the bottom of the stage (one line per readout, up to 2 side by side)
                rows = (self.n_ro + 1) // 2
                self.ro_strip = [-FW / 2 + m, bot, FW / 2 - m, bot + 0.55 * rows]
                bot += 0.55 * rows + 0.1
            right = (self.panel[0] - 0.25) if self.panel else FW / 2 - m
            self.main_box = [-FW / 2 + m + 0.3, bot + 0.3, right - 0.3, top - 0.3]
        if any(isinstance(o, dict) and o.get("type") == "axes" for o in objs) and (self.ro_strip or self.band or has_notes):
            # tick numbers hang ~0.4 below the x-axis: keep them clear of the readout strip / equation band / caption below
            self.main_box[1] += 0.35 + (0.4 if any(isinstance(o, dict) and o.get("type") == "axes" and o.get("x_label") for o in objs) else 0)
        self.label_box = [self.main_box[0] - 0.25, self.main_box[1] - 0.25, self.main_box[2] + 0.25, self.main_box[3] + 0.25]
        self.top, self.bot = top, bot

    # ── helpers for glue ──
    def pos(self, ref):
        return np.array([*self.W.to_frame(self.W.pos(ref, self.X, self.vals)), 0.0])

    def val(self, name):
        return self.vals[name]

    def mob(self, oid):
        return self.mobs.get(oid) or self._build(oid)

    def length(self, world_len):
        return world_len * self.W.transform[1]

    # ── builders ──
    def P(self, ref):
        return self.pos(ref)

    def _ends_on_surface(self, o) -> bool:
        to = o.get("to")
        if not isinstance(to, str):
            return False
        try:
            P = self.P(to)
        except Exception:  # noqa: BLE001
            return False
        for oid, b in self.W.objs.items():
            if oid == o.get("id") or b.get("type") not in ("segment", "line") or not isinstance(b.get("to"), str):
                continue
            if b.get("dashed") or "normal" in oid.lower() or to in (b.get("from"), b.get("to")):
                continue
            try:
                A, B = self.P(b["from"]), self.P(b["to"])
            except Exception:  # noqa: BLE001
                continue
            d = B - A
            L = np.linalg.norm(d)
            if L > 1e-6 and abs(d[0] * (P - A)[1] - d[1] * (P - A)[0]) / L < 1e-3:
                return True
        return False

    def _color_of(self, o, default=None):
        if o.get("color"):
            if str(o["color"]).lower() == "light" and o.get("type") not in ("box", "polygon", "area", "cells", "circle"):
                return col("muted")  # 'light' is a fill colour; as a stroke or icon it vanishes on the paper background
            return col(o["color"])
        if default:
            return col(default)
        c = DEFAULT_CYCLE[self.cycle % len(DEFAULT_CYCLE)]
        self.cycle += 1
        o["color"] = c
        return col(c)

    def _build(self, oid):
        o = self.W.objs[oid]
        m = self._make(o)
        if m is not None:
            self.mobs[oid] = m
        return m

    def _make(self, o):
        t = o["type"]
        W = self.W
        k = W.transform[1]
        sw = float(o.get("width", 4))
        if t == "point":
            c = self._color_of(o, "ink")
            return Dot(self.P(o["id"]), radius=float(o.get("size", 0.08)), color=c)
        if t in ("segment", "line", "ray"):
            a, b = self.P(o["from"]), self.P(o["to"])
            if t == "ray" and self._ends_on_surface(o):
                t = "segment"  # a ray that reaches a drawn surface at its 'to' point stops there (light hitting glass or a mirror)
            if t != "segment":
                d = b - a
                n = np.linalg.norm(d) + 1e-9
                d = d / n
                big = 30.0
                a2 = a - d * big if t == "line" else a
                b2 = b + d * big
                a, b = _clip(a2, b2, self.main_box)
            c = self._color_of(o, "ink")
            if o.get("dashed"):
                return DashedLine(a, b, color=c, stroke_width=sw, dash_length=0.12)
            return Line(a, b, color=c, stroke_width=sw)
        if t in ("polyline", "wire"):
            pts = [self.P(p) for p in o["points"]]
            if o.get("closed") or t == "wire" and o.get("loop", False):
                pts.append(pts[0])
            return VMobject(color=self._color_of(o, "ink"), stroke_width=sw).set_points_as_corners(pts)
        if t == "polygon":
            c = self._color_of(o)
            fill = float(o.get("fill", 0.25))
            return Polygon(*[self.P(p) for p in o["points"]], color=c, stroke_width=sw, fill_color=col(o.get("fill_color"), o["color"]) if o.get("fill_color") else c, fill_opacity=fill)
        if t == "circle":
            c = self._color_of(o, "a")
            r = W.radius(o["id"], self.X, self.vals) * k
            return Circle(radius=max(r, 0.01), color=c, stroke_width=sw, fill_opacity=float(o.get("fill", 0)), fill_color=c).move_to(self.P(o["center"]))
        if t == "arc":
            c = self._color_of(o, "a")
            r = W.radius(o["id"], self.X, self.vals) * k
            a0 = W.vars.eval(o.get("start", 0), self.vals)
            a1 = W.vars.eval(o.get("end", "pi"), self.vals)
            return Arc(radius=r, start_angle=a0, angle=a1 - a0, color=c, stroke_width=sw, arc_center=self.P(o["center"]))
        if t == "angle":
            A, B, C = (self.P(p) for p in o["points"])
            c = self._color_of(o, "accent")
            u, v = A - B, C - B
            ang = math.acos(max(-1, min(1, float(u @ v) / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-12))))
            r = float(o.get("radius", 0.45))
            if abs(ang - math.pi / 2) < 0.01 and not o.get("arc"):
                l1, l2 = Line(B, A), Line(B, C)
                return RightAngle(l1, l2, length=0.28, color=c, stroke_width=3)
            a0 = math.atan2(u[1], u[0])
            a1 = math.atan2(v[1], v[0])
            d = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
            return Arc(radius=r, start_angle=a0, angle=d, arc_center=B, color=c, stroke_width=3)
        if t == "brace":
            a, b = self.P(o["from"]), self.P(o["to"])
            d = b - a
            n = np.array([d[1], -d[0], 0.0]) / (np.linalg.norm(d) + 1e-9)
            if o.get("flip"):
                n = -n
            # face away from the stage centre of mass of drawn shapes when not specified
            from manim import BraceBetweenPoints
            return BraceBetweenPoints(a, b, direction=n, color=col(o.get("color", "muted")))
        if t == "vector":
            a = self.P(o["from"])
            b = np.array([*W.to_frame(W.end(o["id"], self.X, self.vals)), 0.0])
            c = self._color_of(o)
            L = np.linalg.norm(b - a)
            if L < 1e-3:
                return Dot(a, radius=0.001, color=c)
            if o.get("dashed"):  # a dashed vector (a parallelogram side, a translated copy) reads as a copy, not a third vector
                tl = min(0.25, 0.4 * L)
                d = (b - a) / L
                return VGroup(DashedLine(a, b - d * tl * 0.9, color=c, stroke_width=sw, dash_length=0.12),
                              Arrow(b - d * tl, b, buff=0, color=c, stroke_width=sw, tip_length=tl, max_tip_length_to_length_ratio=1.0))
            return Arrow(a, b, buff=0, color=c, stroke_width=sw + 1, tip_length=min(0.25, 0.4 * L), max_tip_length_to_length_ratio=0.4, max_stroke_width_to_length_ratio=30)
        if t == "axes":
            return self._axes(o)
        if t in ("function", "curve", "area"):
            return self._plot(o)
        if t == "box":
            return self._boxmob(o)
        if t == "text":
            return _t(GW.wrap(GW.fmt_template(o.get("text", ""), self.vals), int(o.get("wrap", 28)), 4), o.get("font"), o.get("color", "ink")).move_to(self.P(o["id"]))
        if t == "icon":
            return icon(o.get("icon", o.get("kind")), float(o.get("size", 1.2)) * min(1.0, max(k, 0.5)) if False else float(o.get("size", 1.2)), o.get("color")).move_to(self.P(o["id"]))
        if t == "cells":
            return self._cells(o)
        if t == "pointer":
            return self._pointer(o)
        if t == "flow":
            return self._flow(o)
        if t in GW.TWO_TERMINAL:
            return self._component(o)
        if t == "label":
            return self._label(o)
        if t == "group":
            return VGroup(*[self.mob(x) for x in o.get("members") or [] if self.mob(x) is not None])
        if t in ("equation", "readout"):
            return None
        return None

    def _axes(self, o):
        (x0, x1), (y0, y1) = GW._rng(o.get("x")), GW._rng(o.get("y"))
        ux, uy = GW._axes_units(o)
        k = self.W.transform[1]
        xs = _step(x0, x1, o.get("x_step"))
        ys = _step(y0, y1, o.get("y_step"))
        ax = Axes(x_range=[x0, x1, xs], y_range=[y0, y1, ys], x_length=(x1 - x0) * ux * k, y_length=(y1 - y0) * uy * k, tips=False,
                  axis_config={"color": col("muted"), "stroke_width": 2.5, "include_ticks": True, "tick_size": 0.06})
        f = self.W._axes_map(o["id"], self.X, self.vals)
        target = np.array([*self.W.to_frame(f((x0 + x1) / 2, (y0 + y1) / 2)), 0.0])
        ax.shift(target - ax.c2p((x0 + x1) / 2, (y0 + y1) / 2))
        g = VGroup(ax)
        if o.get("numbers", True):
            fs = FS["min"]  # axis numbers sit at the legible floor
            gone = o.get("_ticks_gone") or set()
            for v in _ticks(x0, x1, xs):
                if abs(v) < 1e-9 and y0 < 0 < y1 or ("x", round(v, 6)) in gone:
                    continue
                g.add(_tick(_t(_num(v, o.get("x_pi")), fs, "muted").scale(1).next_to(ax.c2p(v, max(y0, min(0, y1))), DOWN, buff=0.12), ("x", round(v, 6))))
            for v in _ticks(y0, y1, ys):
                if abs(v) < 1e-9 or ("y", round(v, 6)) in gone:
                    continue
                g.add(_tick(_t(_num(v), fs, "muted").next_to(ax.c2p(max(x0, min(0, x1)), v), LEFT, buff=0.12), ("y", round(v, 6))))
        lx, ly = o.get("x_label"), o.get("y_label")
        if lx:
            yb = max(y0, min(0, y1))
            if yb <= y0 + 1e-9 and o.get("numbers", True):
                # x-axis along the bottom: the axis title sits centred under the tick numbers, clear of every curve
                g.add(_lab(lx, FS["label"], "ink").next_to(ax.c2p((x0 + x1) / 2, yb), DOWN, buff=0.5))
            else:
                g.add(_lab(lx, FS["label"], "ink").next_to(ax.c2p(x1, yb), UP + LEFT * 0.2, buff=0.15))
        if ly:
            g.add(_lab(ly, FS["label"], "ink").next_to(ax.c2p(max(x0, min(0, x1)), y1), RIGHT, buff=0.15))
        g.ax = ax
        return g

    def _ax(self, ax_id):
        return self.mob(ax_id).ax

    def _plot(self, o):
        W = self.W
        t = o["type"]
        c = self._color_of(o)
        if t == "curve":
            u0, u1 = (W.vars.eval(v, self.vals) for v in (o.get("range") or o.get("t") or [0, 1]))
            pv = o.get("param", "u")
            pts = []
            for u in np.linspace(u0, u1, 160):
                vv = {**self.vals, pv: u}
                x, y = W.vars.eval(o["x"], vv), W.vars.eval(o["y"], vv)
                if o.get("on"):
                    p = W._axes_map(o["on"], self.X, self.vals)(x, y)
                else:
                    p = np.array([x, y])
                pts.append([*W.to_frame(p), 0.0])
            return VMobject(color=c, stroke_width=float(o.get("width", 4))).set_points_smoothly(pts) if len(pts) > 2 else VMobject()
        ax_o = W.objs[o["on"]]
        (x0, x1), (y0, y1) = GW._rng(ax_o.get("x")), GW._rng(ax_o.get("y"))
        fid = o["id"] if t == "function" else o.get("of")
        dom = o.get("domain") or [x0, x1]
        a, b = (max(x0, W.vars.eval(dom[0], self.vals)), min(x1, W.vars.eval(dom[1], self.vals)))
        f = W._axes_map(o["on"], self.X, self.vals)
        fr = lambda p: np.array([*W.to_frame(p), 0.0])  # noqa: E731
        if t == "function":
            segs, cur = [], []
            ylo, yhi = y0 - 0.02 * (y1 - y0), y1 + 0.02 * (y1 - y0)
            for x in np.linspace(a, b, 240):
                try:
                    y = W.fn_eval(fid, x, self.vals)
                except Exception:  # noqa: BLE001
                    y = float("nan")
                if np.isfinite(y) and ylo <= y <= yhi:
                    cur.append(fr(f(x, y)))
                elif len(cur) > 1:
                    segs.append(cur)
                    cur = []
                else:
                    cur = []
            if len(cur) > 1:
                segs.append(cur)
            g = VGroup(*[VMobject(color=c, stroke_width=float(o.get("width", 4.5))).set_points_smoothly(s) for s in segs])
            g._path_pts = [p for s in segs for p in s]
            return g
        # area under a function: shaded region, or Riemann rectangles
        n = o.get("rects")
        g = VGroup()
        fill = float(o.get("fill", 0.35))
        if n:
            n = int(W.vars.eval(n, self.vals))
            rule = o.get("rule", "left")
            dx = (b - a) / max(n, 1)
            for i in range(n):
                xl = a + i * dx
                xs = xl if rule == "left" else xl + dx if rule == "right" else xl + dx / 2
                h = W.fn_eval(fid, xs, self.vals)
                pts = [fr(f(xl, 0)), fr(f(xl + dx, 0)), fr(f(xl + dx, h)), fr(f(xl, h))]
                g.add(Polygon(*pts, color=c, stroke_width=1.5, fill_color=c, fill_opacity=fill))
            return g
        xs = np.linspace(a, b, 120)
        pts = [fr(f(a, 0))] + [fr(f(x, W.fn_eval(fid, x, self.vals))) for x in xs] + [fr(f(b, 0))]
        return Polygon(*pts, stroke_width=0, fill_color=c, fill_opacity=fill)

    def _boxmob(self, o):
        c = self._color_of(o, "a")
        if o.get("tex"):
            inner = _m(GW.fmt_template(GW.pick_text(o["tex"], self.vals, o.get("index")), self.vals), FS["box"] + 8, o.get("text_color", "ink"))
        else:
            inner = _t(GW.wrap(GW.fmt_template(GW.pick_text(o.get("text", ""), self.vals, o.get("index")), self.vals), int(o.get("wrap", 16))), FS["box"], o.get("text_color", "ink"))
        w, h = GW.block_size(o)
        w, h = max(w, inner.width + 0.4), max(h, inner.height + 0.3)
        r = RoundedRectangle(width=w, height=h, corner_radius=0.14, color=c, stroke_width=3, fill_color=c, fill_opacity=float(o.get("fill", 0.12)))
        g = VGroup(r, inner).move_to(self.P(o["id"]))
        inner.move_to(r.get_center())
        return g

    def _cells(self, o):
        vals = o.get("values") or [""] * int(o.get("n", 6))
        cw = float(o.get("cell", 0.8))
        c = self._color_of(o, "a")
        g = VGroup()
        row = VGroup()
        for i, v in enumerate(vals):
            sq = Square(side_length=cw, color=c, stroke_width=3, fill_color=col("light"), fill_opacity=0.0)
            txt = _t(GW.fmt_template(str(v), self.vals), max(FS["cell"], FS["cell"] * cw / 0.9), "ink")
            if txt.width > cw * 0.85:
                txt.scale_to_fit_width(cw * 0.85)
            row.add(VGroup(sq, txt))
        row.arrange(RIGHT, buff=0)
        for cell in row:
            cell[1].move_to(cell[0].get_center())
        g.add(row)
        if o.get("indices", True):
            idx = VGroup(*[_t(str(i + int(o.get("start_index", 0))), FS["min"], "muted").next_to(row[i], DOWN, buff=0.08) for i in range(len(vals))])
            g.add(idx)
        g.move_to(self.P(o["id"]))
        g.row = row
        return g

    def cell(self, ref):
        m = re.match(r"^(\w[\w.]*)\[(.+)\]$", str(ref))
        if not m:
            return None
        cid, inner = m.group(1), GW.fmt_template(m.group(2), self.vals)
        cm = self.mob(cid)
        n = len(cm.row)
        if ":" in inner:
            lo, hi = inner.split(":", 1)
            lo = int(round(self.W.vars.eval(lo or 0, self.vals)))
            hi = int(round(self.W.vars.eval(hi or n, self.vals)))
            return VGroup(*[cm.row[i] for i in range(max(0, lo), min(n, hi))])
        i = int(round(self.W.vars.eval(inner, self.vals)))
        return cm.row[i] if 0 <= i < n else None

    def _pointer(self, o):
        target = GW.fmt_template(o["at"], self.vals)
        cm = self.cell(target) if "[" in target else None
        tgt = cm.get_center() if cm is not None else self.P(target)
        side = o.get("side", "below")
        c = self._color_of(o, "highlight")
        d = DOWN if side == "below" else UP
        base = (cm.get_bottom() if side == "below" else cm.get_top()) if cm is not None else tgt
        if cm is not None and side == "below":
            base = base + DOWN * 0.42  # under the index row
        tip = base
        tail = base + d * 0.7
        arr = Arrow(tail, tip, buff=0, color=c, stroke_width=5, tip_length=0.2, max_tip_length_to_length_ratio=0.4)
        lab = _t(GW.fmt_template(o.get("text", ""), self.vals), FS["label"], o.get("color", "highlight")).next_to(arr, d, buff=0.08)
        # pointers on the same cell (lo = mid) stack their labels instead of printing them on top of each other
        k = 0
        for pid, po in self.W.objs.items():
            if pid == o.get("id"):
                break
            if po.get("type") == "pointer" and po.get("side", "below") == side and (pid in self.shown or pid in getattr(self, "_making", ())):
                try:
                    if GW.fmt_template(po["at"], self.vals) == target:
                        k += 1
                except Exception:  # noqa: BLE001
                    continue
        if k:
            lab.shift(d * k * (lab.height + 0.1))
        return VGroup(arr, lab)

    def _anchor_box(self, ref):
        m = self.cell(ref) if "[" in str(ref) else self.mob(ref)
        return m

    def _flow(self, o):
        a, b = self._anchor_box(o["from"]), self._anchor_box(o["to"])
        ca, cb = a.get_center(), b.get_center()
        pa, pb = _edge_point(a, cb - ca), _edge_point(b, ca - cb)
        d = pb - pa
        L = np.linalg.norm(d)
        gap = min(0.15, 0.2 * L)
        pa, pb = pa + d / (L + 1e-9) * gap, pb - d / (L + 1e-9) * gap
        c = self._color_of(o, "muted")
        bend = float(o.get("bend", 0))
        if abs(bend) > 1e-3:
            arr = CurvedArrow(pa, pb, angle=bend, color=c, stroke_width=float(o.get("width", 5)), tip_length=0.22)
        else:
            arr = Arrow(pa, pb, buff=0, color=c, stroke_width=float(o.get("width", 5)), tip_length=0.22, max_tip_length_to_length_ratio=0.3)
        return arr

    def _component(self, o):
        a, b = self.P(o["from"]), self.P(o["to"])
        d = b - a
        L = np.linalg.norm(d)
        u = d / (L + 1e-9)
        n = np.array([-u[1], u[0], 0.0])
        c = self._color_of(o, "ink")
        mid = (a + b) / 2
        s = min(0.45, L * 0.3)
        t = o["type"]
        g = VGroup()
        lead = lambda p, q: Line(p, q, color=col("ink"), stroke_width=4)  # noqa: E731
        if t == "resistor":
            h = s * 1.1
            p0, p1 = mid - u * h, mid + u * h
            zz = [p0]
            for i in range(6):
                zz.append(p0 + u * (2 * h) * (i + 0.5) / 6 + n * (0.16 if i % 2 == 0 else -0.16))
            zz.append(p1)
            g.add(lead(a, p0), VMobject(color=c, stroke_width=4).set_points_as_corners(zz), lead(p1, b))
        elif t == "battery":
            gap = 0.12
            p0, p1 = mid - u * gap, mid + u * gap
            g.add(lead(a, p0), lead(p1, b), Line(p0 + n * 0.42, p0 - n * 0.42, color=c, stroke_width=4),
                  Line(p1 + n * 0.22, p1 - n * 0.22, color=c, stroke_width=8))
            plus = _t("+", FS["min"], "muted").move_to(p0 + n * 0.62 - u * 0.15)
            g.add(plus)
        elif t == "capacitor":
            gap = 0.1
            p0, p1 = mid - u * gap, mid + u * gap
            g.add(lead(a, p0), lead(p1, b), Line(p0 + n * 0.35, p0 - n * 0.35, color=c, stroke_width=5), Line(p1 + n * 0.35, p1 - n * 0.35, color=c, stroke_width=5))
        elif t in ("bulb", "meter"):
            r = 0.32
            g.add(lead(a, mid - u * r), lead(mid + u * r, b))
            circ = Circle(radius=r, color=c, stroke_width=4).move_to(mid)
            if o.get("glow"):
                circ.set_fill(col(o.get("glow"), "yellow"), opacity=0.6)
            g.add(circ)
            if t == "bulb":
                kx = r * 0.7
                g.add(Line(mid + (u + n) * kx * 0.7, mid - (u + n) * kx * 0.7, color=c, stroke_width=3), Line(mid + (u - n) * kx * 0.7, mid - (u - n) * kx * 0.7, color=c, stroke_width=3))
            else:
                g.add(_t(o.get("letter", "A"), FS["min"], c).move_to(mid))
        elif t == "switch":
            p0, p1 = mid - u * 0.3, mid + u * 0.3
            closed = o.get("closed", True)
            end = p1 if closed else p0 + (u * math.cos(0.5) + n * math.sin(0.5)) * 0.6
            g.add(lead(a, p0), lead(p1, b), Line(p0, end, color=c, stroke_width=4), Dot(p0, radius=0.05, color=c), Dot(p1, radius=0.05, color=c))
        elif t == "spring":
            pts = [a, a + 0.1 * d]
            for i in range(16):
                pts.append(a + (0.1 + 0.8 * (i + 0.5) / 16) * d + (0.18 if i % 2 == 0 else -0.18) * n)
            pts += [a + 0.9 * d, b]
            g.add(VMobject(color=c, stroke_width=3.5).set_points_as_corners(pts))
        return g

    # ── labels ──
    def _label(self, o):
        vals = self.vals
        if o.get("tex"):
            m = _m(GW.fmt_template(GW.pick_text(o["tex"], vals, o.get("index")), vals), FS["label"] + 10, o.get("color", "ink"))
        else:
            txt = GW.fmt_template(GW.pick_text(o.get("text", ""), vals, o.get("index")), vals)
            if re.search(r"[\w)]\s*(\^|\*\*)\s*[\w(]", txt) and not re.search(r"[A-Za-z]{4,}", txt):
                m = _m(txt, FS["label"] + 10, o.get("color", "ink"))  # y = x^2 written as text: typeset it (x² not x^2)
            else:
                m = _t(txt, FS["label"], o.get("color", "ink"))
        if o.get("for"):
            self._place(m, o)
        elif o.get("at"):
            m.move_to(self.P(o["at"]) if isinstance(o["at"], str) else np.array([*self.W.to_frame(self.W.pos(o["at"], self.X, vals)), 0.0]))
        else:
            m.move_to(self._free_spot(m))
        return m

    def _stroke_samples(self, mob, step=0.07):
        """Points every ~step along every visible stroke of a mobject, plus the outline of small filled marks (dots, arrow tips).
        Rows are (x, y, half stroke width): a thick battery plate is wider ink than a hairline."""
        pts = []
        stack = [mob]
        while stack:
            sub = stack.pop()
            if isinstance(sub, (Text, MathTex)) or sub.__class__.__name__ in ("SingleStringMathTex", "MarkupText", "DecimalNumber"):
                continue
            stack.extend(sub.submobjects)
            p = sub.points
            if len(p) == 0:
                continue
            stroked = sub.get_stroke_width() > 0 and sub.get_stroke_opacity() > 0.02
            mark = sub.get_fill_opacity() > 0.5 and max(sub.width, sub.height) < 0.45  # a dot or an arrow tip is ink too
            if not stroked and not mark:
                continue
            anchors = p[::4, :2] if len(p) >= 4 else p[:, :2]
            ends = p[3::4, :2] if len(p) >= 4 else p[:, :2]
            hw = 0.005 * sub.get_stroke_width() if stroked else 0.0  # Cairo draws stroke_width x 0.01 frame units
            for a0, a1 in zip(anchors, ends):
                L = float(np.linalg.norm(a1 - a0))
                k = max(2, min(60, int(L / step) + 1))
                t = np.linspace(0, 1, k)[:, None]
                seg = a0 + t * (a1 - a0)
                pts.append(np.hstack([seg, np.full((k, 1), hw)]))
            if mark:
                pts.append(np.array([[*sub.get_center()[:2], 0.0]]))
        return np.concatenate(pts) if pts else np.zeros((0, 3))

    def _obstacles(self, exclude=(), target=None):
        """Text boxes (labels, glyph groups, tick numbers), filled-shape interiors, and points sampled every ~0.07 units along
        every drawn stroke and small filled mark (a label must not sit on a line, not just avoid its corners). Each stroke
        sample remembers which object drew it (self._own), so a label can be checked against its own target."""
        boxes, pts, soft, own, ticks = [], [], [], [], []
        for oid in self.shown:
            if oid in exclude:
                continue
            m = self.mobs.get(oid)
            if m is None:
                continue
            o = self.W.objs.get(oid, {})
            if o.get("type") == "label":
                if getattr(m, "_tiny", False) or m.get_fill_opacity() < 0.05:
                    continue
                boxes.append(_box(m))
                continue
            stack = [m]
            while stack:
                sub = stack.pop()
                if isinstance(sub, (Text, MathTex)) or sub.__class__.__name__ in ("SingleStringMathTex", "MarkupText", "DecimalNumber"):
                    if sub.get_fill_opacity() > 0.05:
                        (ticks if getattr(sub, "_tick", False) else boxes).append(_box(sub))
                    continue
                stack.extend(sub.submobjects)
                if len(sub.points) == 0:
                    continue
                if oid != target and sub.get_fill_opacity() > 0.05 and isinstance(sub, RoundedRectangle):
                    boxes.append(_box(sub))  # a box node: never write over it
                elif oid != target and sub.get_fill_opacity() > 0.05 and isinstance(sub, (Polygon, Circle, Square, Rectangle)) and max(sub.width, sub.height) >= 0.45:
                    soft.append(_box(sub) + np.array([0.12, 0.12, -0.12, -0.12]))  # a filled region: fine to label inside, mildly avoided
            sp = self._stroke_samples(m)
            if len(sp):
                # axes are background ink: crossing an axis line costs less than crossing a drawn shape
                wgt = 0.35 if o.get("type") == "axes" else 1.0
                pts.append(np.hstack([sp, np.full((len(sp), 1), wgt)]))
                own += [oid] * len(sp)
        self._soft = soft
        self._ticks = ticks  # axis numbers: avoided like any text; one a label still has to crowd fades (see _tick_cover)
        self._own = np.array(own, dtype=object)
        return boxes, (np.concatenate(pts) if pts else np.zeros((0, 4)))

    def _target_geom(self, ref):
        """What a label is about, as points: the stroke samples of its target (or the target's position / cell centre)."""
        if "[" in ref:
            c = self.cell(ref)
            return np.array([c.get_center()[:2]]) if c is not None else None
        m = self.mobs.get(ref)
        t = self.W.objs.get(ref, {}).get("type")
        if m is not None and t in ("polygon", "circle") and len(m.points):
            # a region: a label anywhere inside it is on it (a² written in its square)
            sp = self._stroke_samples(m)
            poly = m.points[::4, :2] if len(m.points) >= 4 else m.points[:, :2]
            b = _box(m)
            gx, gy = np.meshgrid(np.linspace(b[0], b[2], 12), np.linspace(b[1], b[3], 12))
            g = np.c_[gx.ravel(), gy.ravel()]
            inside = _in_poly(g, poly)
            return np.concatenate([sp, np.c_[g[inside], np.zeros(int(inside.sum()))]]) if inside.any() else sp
        if m is not None and t not in BLOCKY:
            sp = self._stroke_samples(m)
            if len(sp):
                return sp
        if m is not None:  # a block: its outline
            b = _box(m)
            t = np.linspace(0, 1, 8, endpoint=False)
            return np.concatenate([np.c_[b[0] + t * (b[2] - b[0]), np.full(8, b[1])], np.c_[np.full(8, b[2]), b[1] + t * (b[3] - b[1])],
                                   np.c_[b[2] - t * (b[2] - b[0]), np.full(8, b[3])], np.c_[np.full(8, b[0]), b[3] - t * (b[3] - b[1])]])
        try:
            return np.array([self.pos(ref)[:2]])
        except Exception:  # noqa: BLE001
            return None

    def _related(self, ref):
        """Objects a label of ref may sit next to without being mistaken for theirs: ref itself, its end points, its group."""
        o = self.W.objs.get(ref, {})
        rel = {ref}
        mine = set()
        for key in ("from", "to", "center", "points", "of", "on"):
            for x in GW._as_list(o.get(key)):
                if isinstance(x, str):
                    rel.add(x)
                    mine.add(x)
        for gid, g in self.W.objs.items():
            if g.get("type") == "group" and ref in (g.get("members") or []):
                rel.add(gid)
            # drawn on the same points (an angle's sides are its polygon's edges): not a rival for the label
            theirs = {x for key in ("from", "to", "points") for x in GW._as_list(g.get(key)) if isinstance(x, str)}
            if len(mine & theirs) >= 2:
                rel.add(gid)
        return rel

    def _label_ctx(self, o, exclude=None):
        """Everything a label's placement is scored against, gathered once per placement."""
        ref = str(o.get("for"))
        boxes, pts = self._obstacles(exclude=exclude or (o["id"],), target=ref)
        own = self._own
        rel = self._related(ref)
        axes_ids = {k for k, v in self.W.objs.items() if v.get("type") == "axes"}
        other = np.array([x not in rel and x not in axes_ids and self.W.objs.get(x, {}).get("type") not in BLOCKY for x in own], dtype=bool) if len(own) else np.zeros(0, bool)
        mine = np.array([x == ref for x in own], dtype=bool) if len(own) == len(pts) else None
        return {"boxes": boxes, "pts": pts, "other": pts[other] if len(pts) else pts, "tgt": self._target_geom(ref) if o.get("for") else None,
                "mine": mine}

    def _score(self, m, boxes, pts, pref=None, home=None, ctx=None):
        """Lower is better. All distances are measured against the label's own size, so the rules hold at any frame/aspect."""
        LW = self.LW
        b = _box(m)
        h = max(min(m.height, m.width), 0.18)
        c = LW["clear"] * h
        s = 0.0
        for o in list(boxes) + list(getattr(self, "_ticks", [])):
            # other text: overlapping is a collision; closer than the clearance band crowds it
            gx = max(o[0] - b[2], b[0] - o[2], 0.0)
            gy = max(o[1] - b[3], b[1] - o[3], 0.0)
            gap = math.hypot(gx, gy)
            if gap <= 0.0:
                s += 60 * _ovl(b, o) + 2 * LW["clear_w"]
            elif gap < c:
                s += 2 * LW["clear_w"] * (1.0 - gap / c)
        for o in getattr(self, "_soft", []):
            s += 1.0 * _ovl(b, o)
        if len(pts):
            d = _ink_dist(b, pts)
            wt = pts[:, 3] if pts.shape[1] > 3 else np.ones(len(pts))
            s += LW["stroke_in"] * float(wt[d <= 1e-9].sum())
            band = (d > 1e-9) & (d < c)
            mine = ctx.get("mine") if ctx is not None else None
            if mine is not None and len(mine) == len(d) and mine.any():
                # the label's own target: keep the clearance from its nearest stroke, but do not count how many of its samples
                # fall in the band (that density made a box's corner beat the middle of its side, so labels drifted diagonally
                # off their own node toward the next one)
                tb = band & mine
                if tb.any():
                    s += 3.0 * LW["clear_w"] * (1.0 - float(d[tb].min()) / c)
                band = band & ~mine
            if band.any():
                s += LW["clear_w"] * float((wt[band] * (1.0 - d[band] / c)).sum())
        lb = self.label_box
        out = max(0, lb[0] - b[0]) + max(0, b[2] - lb[2]) + max(0, lb[1] - b[1]) + max(0, b[3] - lb[3])
        s += 200 * out
        fb = [-FW / 2 + 0.1, -FH / 2 + 0.1, FW / 2 - 0.1, FH / 2 - 0.1]
        s += 400 * (max(0, fb[0] - b[0]) + max(0, b[2] - fb[2]) + max(0, fb[1] - b[1]) + max(0, b[3] - fb[3]))
        for z in (self.panel, self.band):
            if z:
                s += 80 * _ovl(b, z)
        tg = ctx.get("tgt") if ctx is not None else None
        if tg is not None and len(tg):
            # attachment: distance from the label to its target's ink (in label heights); beyond reach it reads as detached
            att = _box_dist(b, tg) / h
            s += LW["anchor"] * att + 25.0 * max(0.0, att - LW["reach"])
            if home is not None:  # a gentle pull toward the natural spot (a line's midpoint, an angle's bisector)
                s += 0.15 * LW["anchor"] * float(np.linalg.norm(m.get_center()[:2] - np.asarray(home)[:2])) / h
        elif home is not None:
            dist = float(np.linalg.norm(m.get_center()[:2] - np.asarray(home)[:2])) / h
            s += LW["anchor"] * dist + 10.0 * max(0.0, dist - LW["reach"])
        if ctx is not None and ctx.get("tgt") is not None and len(ctx["tgt"]) and len(ctx["other"]):
            # ownership: the label must read as its target's, i.e. sit nearer its target than any other line, arrow or point
            dt = _box_dist(b, ctx["tgt"])
            do = _box_dist(b, ctx["other"])
            if do < dt:
                s += LW["own"] * (dt - do) / h
        return s

    def _candidates(self, m, o):
        """Candidate centres for a label, built from the target's real geometry: offsets are the measured half-width of the
        glyph across its line (battery plates, arrow tips, a resistor's zigzag) plus clearance bands in label heights."""
        ref = str(o["for"])
        W = self.W
        tgt = W.objs.get(ref, {})
        t = tgt.get("type")
        cands = []
        side = o.get("side")
        h = max(min(m.height, m.width), 0.18)
        c = self.LW["clear"] * h
        offs = (c, 2 * c, 3.5 * c)
        dirs = [UP, UP + RIGHT, RIGHT, DOWN + RIGHT, DOWN, DOWN + LEFT, LEFT, UP + LEFT]
        named = {"above": UP, "below": DOWN, "left": LEFT, "right": RIGHT, "up": UP, "down": DOWN}
        if side in named:
            dirs = [named[side]] + [d for d in dirs if not np.allclose(d, named[side])]

        def across(a, b, fr):
            """Candidates both sides of the line a->b at fractions fr, clear of the glyph drawn on it."""
            d = b - a
            L = float(np.linalg.norm(d)) + 1e-9
            u = d / L
            n = np.array([-u[1], u[0], 0.0])
            mob = self.mobs.get(ref)
            sp = self._stroke_samples(mob) if mob is not None else np.zeros((0, 3))
            out = []
            for f in fr:
                p = a + f * d
                half_u = 0.5 * (abs(u[0]) * m.width + abs(u[1]) * m.height)
                half_n = 0.5 * (abs(n[0]) * m.width + abs(n[1]) * m.height)
                for sgn in (1, -1):
                    ext = 0.0
                    if len(sp):
                        rel = sp[:, :2] - p[:2]
                        along = rel @ u[:2]
                        acr = rel @ (sgn * n[:2]) + sp[:, 2]
                        near = np.abs(along) < half_u + c
                        if near.any():
                            ext = max(0.0, float(acr[near].max()))
                    for off in offs:
                        out.append(_C.at(m, p + sgn * n * (ext + off + half_n)))
            return out

        if "[" in ref:
            cm = self.cell(ref)
            if cm is not None:
                for d in (UP, DOWN):
                    for off in offs[:2]:
                        cands.append(_C.next_to(cm, d, off if d is UP else off + 0.4, m))
            return cands, (cm.get_center() if cm is not None else None)
        if t == "point" or t is None and ref in W.objs:
            p = self.P(ref)
            r = float(tgt.get("size", 0.08))
            for d in dirs:
                for off in offs:
                    cands.append(_C.near_point(p, r, d, off, m))
            return cands, p
        if t in ("segment", "vector", "line", "ray") or "-" in ref and t is None or t in GW.TWO_TERMINAL:
            pts = W.ref_points(ref) if t is None else [tgt["from"], tgt.get("to")]
            a = self.P(pts[0])
            b = self.P(pts[1]) if isinstance(pts[1], str) else np.array([*W.to_frame(W.end(ref, self.X, self.vals)), 0.0])
            lm = self.mobs.get(ref)
            if t in ("line", "ray") and isinstance(lm, Line):
                a, b = lm.get_start(), lm.get_end()  # a line/ray is drawn across the stage: label anywhere along what is drawn
            fr = (0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8)
            cands = across(a, b, fr)
            if t == "vector":
                # past the head, along the arrow (and either side of that): where an arrow's name is often read
                d = b - a
                u = d / (np.linalg.norm(d) + 1e-9)
                n = np.array([-u[1], u[0], 0.0])
                for dd in (u, (u + n) / math.sqrt(2), (u - n) / math.sqrt(2)):
                    ext = 0.5 * (abs(dd[0]) * m.width + abs(dd[1]) * m.height)
                    for off in offs:
                        cands.append(_C.at(m, b + dd * (off + ext + 0.1)))
            return cands, a + 0.5 * (b - a)
        if t == "flow" and self.mobs.get(ref) is not None:
            mob = self.mobs[ref]
            path = mob[0] if isinstance(mob, VGroup) and len(mob) and not isinstance(mob, Arrow) else mob
            for f in (0.5, 0.4, 0.6, 0.3, 0.7):
                try:
                    p0, p1 = path.point_from_proportion(max(0, f - 0.03)), path.point_from_proportion(min(1, f + 0.03))
                except Exception:  # noqa: BLE001
                    continue
                mid = path.point_from_proportion(f)
                du = p1 - p0
                du = du / (np.linalg.norm(du) + 1e-9)
                cands += across(mid - du * 0.5, mid + du * 0.5, (0.5,))
            try:
                home = path.point_from_proportion(0.5)
            except Exception:  # noqa: BLE001
                home = mob.get_center()
            return cands, home
        if t == "angle":
            A, B, C = (self.P(x) for x in tgt["points"])
            u, v = (A - B) / (np.linalg.norm(A - B) + 1e-9), (C - B) / (np.linalg.norm(C - B) + 1e-9)
            bis = u + v
            bis = bis / (np.linalg.norm(bis) + 1e-9) if np.linalg.norm(bis) > 1e-6 else np.array([-u[1], u[0], 0.0])
            r = float(tgt.get("radius", 0.45))
            a0 = math.atan2(bis[1], bis[0])
            for k in range(24):
                ang = a0 + 2 * math.pi * k / 24
                d = np.array([math.cos(ang), math.sin(ang), 0.0])
                ext = 0.5 * (abs(d[0]) * m.width + abs(d[1]) * m.height)
                for rad in (0.6 * r, r, r + c, r + 2 * c, r + 3.5 * c):
                    cands.append(_C.at(m, B + d * (rad + ext)))
            return cands, B + bis * (r + c + 0.5 * max(m.width, m.height))
        if t == "polygon":
            P = [self.P(x) for x in tgt["points"]]
            cen = np.mean(P, axis=0)
            cands.append(_C.at(m, cen))
            poly = VMobject().set_points_as_corners(P)
            for d in dirs:
                for off in offs:
                    cands.append(_C.next_to(poly, d, off, m))
            return cands, cen
        mob = self.mobs.get(ref) or self.mob(ref)
        if t == "function":
            pp = getattr(mob, "_path_pts", None)
            if pp:
                for f in (0.95, 0.8, 0.6, 0.3, 0.1):
                    p = pp[min(len(pp) - 1, int(f * len(pp)))]
                    for d in (UP + RIGHT, UP + LEFT, DOWN + RIGHT, RIGHT, UP):
                        for off in offs[:2]:
                            cands.append(_C.near_point(p, 0.05, d, off, m))
                return cands, pp[int(0.9 * (len(pp) - 1))]
        if mob is not None:
            for d in dirs:
                for off in offs:
                    cands.append(_C.next_to(mob, d, off, m))
            if t == "circle":
                cc = mob.get_center()
                r = mob.width / 2
                for a in np.linspace(0, 2 * math.pi, 12, endpoint=False):
                    cands.append(_C.at(m, cc + (r + c + max(m.width, m.height) / 2) * np.array([math.cos(a), math.sin(a), 0])))
            return cands, mob.get_center()
        return [_C.at(m, ORIGIN)], None

    def _side_pen(self, c, o, home):
        tgt = self.W.objs.get(str(o.get("for")), {})
        if tgt.get("type") == "angle" and not o.get("side"):
            # an angle's label reads as that angle inside its opening; outside it is a fallback
            try:
                A, B, C = (self.P(x)[:2] for x in tgt["points"])
                p = c.get_center()[:2] - B
                u, v = A - B, C - B
                cr = lambda a, b: a[0] * b[1] - a[1] * b[0]  # noqa: E731
                inside = cr(u, p) * cr(u, v) >= 0 and cr(v, p) * cr(v, u) >= 0
                return 0.0 if inside else 1.5
            except Exception:  # noqa: BLE001
                return 0.0
        side = {"above": (0, 1), "below": (0, -1), "left": (-1, 0), "right": (1, 0), "up": (0, 1), "down": (0, -1)}.get(str(o.get("side") or ""))
        if not side or home is None:
            return 0.0
        d = c.get_center()[:2] - np.asarray(home)[:2]
        along, perp = d[0] * side[0] + d[1] * side[1], abs(d[0] * side[1] - d[1] * side[0])
        # 'below' means mostly below: far off to one side and a little down reads as belonging to the neighbour
        return 0.0 if along > 0.05 and along >= 0.5 * perp else 3.0  # a stated side is a preference; legibility and ownership outrank it

    def _best_spot(self, m, o, ctx=None):
        cands, home = self._candidates(m, o)
        ctx = ctx or self._label_ctx(o)
        scored = [(self._score(c, ctx["boxes"], ctx["pts"], home=home, ctx=ctx) + self._side_pen(c, o, home), i) for i, c in enumerate(cands)]
        # local search: nudge the best few around by fractions of the clearance band (a tight gap is often just off-grid)
        h = max(min(m.height, m.width), 0.18)
        c = self.LW["clear"] * h
        for s0, i in sorted(scored)[:6]:
            base = cands[i].get_center()
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                for step in (0.5 * c, c, 2 * c):
                    cc = _C.at(m, base + np.array([dx, dy, 0.0]) * step)
                    cands.append(cc)
                    scored.append((self._score(cc, ctx["boxes"], ctx["pts"], home=home, ctx=ctx) + self._side_pen(cc, o, home), len(cands) - 1))
        s, i = min(scored)
        if _DBG == o.get("id"):
            for s1, j in sorted(scored)[:6]:
                print("  cand", round(s1, 2), np.round(cands[j].get_center()[:2], 2))
        return cands[i], s, home, ctx

    def _place(self, m, o):
        best, bs, home, ctx = self._best_spot(m, o)
        if _DBG:
            print("PLACE", o["id"], round(bs, 2), np.round(best.get_center()[:2], 2), "home", None if home is None else np.round(np.asarray(home)[:2], 2))
        m.move_to(best.get_center())
        return m

    def _free_spot(self, m):
        boxes, pts = self._obstacles()
        mb = self.main_box
        best, bs = None, None
        for x in np.linspace(mb[0] + m.width / 2, mb[2] - m.width / 2, 9):
            for y in np.linspace(mb[3] - m.height / 2, mb[1] + m.height / 2, 7):
                c = _C.at(m, [x, y, 0])
                s = self._score(c, boxes, pts)
                if bs is None or s < bs:
                    best, bs = c, s
        return best.get_center()

    # ── panel ──
    def _panel_slot(self, h, which="eq"):
        z = self.band if (self.band and which == "eq") else self.panel
        if z is None:
            z = [self.main_box[0], self.main_box[1], self.main_box[2], self.main_box[1] + 1]
        if which == "eq":
            return np.array([(z[0] + z[2]) / 2, z[3] - 0.15 - h / 2 if not self.band else (z[1] + z[3]) / 2 + 0.15, 0])
        return z

    def _eq_mob(self, line, probe=False):
        if line.get("tex"):
            m = _m(line["tex"], FS["math"])
        else:
            m = _t(line.get("text", ""), FS["body"])
        if probe:
            return m
        z = self.band or self.panel or self.main_box
        maxw = (z[2] - z[0]) - 0.2
        if m.width > maxw:
            k = maxw / m.width
            floor = FS["tex_min"] if isinstance(m, MathTex) else FS["min"]
            if k * m.font_size < floor:
                k = floor / m.font_size
            m.scale(k)
        return m

    # ── actions ──
    def show_anim(self, oid):
        if "[" in str(oid):
            return None
        o = self.W.objs.get(oid)
        if o is None or oid in self.shown:
            return None
        if o["type"] in ("equation", "readout"):
            if o["type"] == "readout":
                return self._readout_show(o)
            return None
        if o["type"] == "group":
            anims = [self.show_anim(x) for x in o.get("members") or []]
            self.shown.append(oid)
            return [a for a in anims if a]
        m = self._build(oid)
        if m is None:
            return None
        self.shown.append(oid)
        t = o["type"]
        # labels attached to this object appear with it unless the beat shows them separately
        if t in ("vector", "flow"):
            return GrowArrow(m) if isinstance(m, Arrow) else Create(m)
        if t in ("label", "text"):
            return Write(m)
        if t in ({"box", "icon", "cells", "pointer", "point"} | GW.TWO_TERMINAL):
            return FadeIn(m, scale=0.9 if t != "point" else 1.0)
        if t == "axes":
            return Create(m, lag_ratio=0.02)
        return Create(m)

    def _readout_show(self, o):
        m = self._readout_mob(o)
        self.readouts[o["id"]] = m
        self.mobs[o["id"]] = m
        self.shown.append(o["id"])
        return FadeIn(m)

    def _fit_text(self, m, txt, w, o):
        """Never let a readout run off the frame: shrink to the phone minimum, then wrap onto two lines, then shrink."""
        if m.width > w:
            m.scale(max(w / m.width, FS["min"] / FS["body"]))
        if m.width > w and isinstance(m, Text):
            chars = max(10, int(len(txt) * w / m.width * 0.95), len(txt) // 2 + 2)
            m = _t(GW.wrap(txt, chars, 3), FS["body"], o.get("color", "ink"))
            if m.width > w:
                m.scale(max(w / m.width, FS["min"] / FS["body"]))
        if m.width > w:
            m.scale(w / m.width)
        return m

    def _readout_mob(self, o):
        i = list(self.readouts).index(o["id"]) if o["id"] in self.readouts else len(self.readouts)
        txt = GW.fmt_template(o.get("text", ""), self.vals)
        txt = re.sub(r"(?<!\*)\s*\*(?!\*)\s*", "·", txt)  # n1*sin(θ1) -> n1·sin(θ1)
        m = _t(txt, FS["body"], o.get("color", "ink"))
        if self.panel:
            z = self.panel
            w = (z[2] - z[0]) - 0.2
            if m.width > w:
                parts = [p.strip() for p in re.split(r"\s*\|\s*|\s{3,}|;\s*", txt) if p.strip()]
                if len(parts) > 1:
                    m = VGroup(*[_t(p, FS["body"], o.get("color", "ink")) for p in parts]).arrange(DOWN, buff=0.12, aligned_edge=LEFT)
                m = self._fit_text(m, txt, w, o)
            # stack readouts from the bottom of the panel up
            y = z[1] + 0.3 + m.height / 2 + sum(getattr(self.readouts.get(k), "height", 0.5) + 0.2 for k in list(self.readouts)[:i])
            m.move_to([(z[0] + z[2]) / 2, y, 0])
            return m
        z = self.ro_strip or [self.main_box[0], self.main_box[1], self.main_box[2], self.main_box[1] + 0.5]
        cols = 1 if self.n_ro == 1 else 2
        w = min((z[2] - z[0]) / cols - 0.3, FW - 0.6)
        m = self._fit_text(m, txt, w, o)
        r, c = divmod(i, cols)
        cx = (z[0] + z[2]) / 2 if cols == 1 else z[0] + (c + 0.5) * (z[2] - z[0]) / 2
        m.move_to([cx, z[3] - 0.28 - 0.55 * r, 0])
        return m

    def _refresh(self, ids=None):
        """Rebuild every shown geometry/label from the current vars + positions (used per frame while a var animates)."""
        for oid in list(self.shown):
            o = self.W.objs.get(oid)
            if o is None:
                continue
            t = o["type"]
            if t in ("readout",):
                new = self._readout_mob(o)
                self.mobs[oid].become(new)
                continue
            if t in ("equation", "group", "text"):
                continue
            if t == "label":
                continue
            old = self.mobs.get(oid)
            if old is None:
                continue
            sig = self._sig(o)
            if sig is not None and getattr(old, "_sig", None) == sig:
                continue
            try:
                new = self._make(o)
            except Exception:  # noqa: BLE001
                continue
            if new is None:
                continue
            if t in ("cells",):
                # keep per-cell colouring: only move the whole thing
                old.move_to(new.get_center())
                continue
            old.become(new)
            old._sig = sig
            if t == "axes":
                old.ax = new.ax
            if hasattr(new, "_path_pts"):
                old._path_pts = new._path_pts
        # labels follow their anchors through their own updaters (text re-rendered only at the end of the motion)

    def _deps(self, o):
        d = o.get("_deps")
        if d is None:
            ids, names = set(), set()

            def walk(v):
                if isinstance(v, str):
                    if v in self.W.objs:
                        ids.add(v)
                    for n in re.findall(r"[A-Za-z_]\w*", v):
                        if n in self.W.vars.decl:
                            names.add(n)
                        if n in self.W.objs:
                            ids.add(n)
                elif isinstance(v, (list, tuple)):
                    for x in v:
                        walk(x)
                elif isinstance(v, dict):
                    for k2, x in v.items():
                        if not str(k2).startswith("_") and k2 not in ("id", "color", "type"):
                            walk(x)
            walk(o)
            # points/axes a referenced object itself depends on
            more = set()
            for i in list(ids):
                oo = self.W.objs.get(i, {})
                for key in ("from", "to", "center", "points", "on", "origin", "of"):
                    for x in GW._as_list(oo.get(key)):
                        if isinstance(x, str) and x in self.W.objs:
                            more.add(x)
            ids |= more
            if o.get("type") in ("function", "area", "curve") and o.get("on"):
                names |= set(self.W.vars.decl)  # cheap to rebuild, depends on any var through the expression
            d = o["_deps"] = (sorted(ids), sorted(names))
        return d

    def _sig(self, o):
        try:
            ids, names = self._deps(o)
            sig = [o["id"] in self.W.idx and tuple(np.round(self.W.pos(o["id"], self.X, self.vals), 4))]
            for i in ids:
                try:
                    sig.append(tuple(np.round(self.W.pos(i, self.X, self.vals), 4)))
                except Exception:  # noqa: BLE001
                    sig.append(None)
            sig += [round(self.vals.get(n, 0.0), 6) for n in names]
            return tuple(sig)
        except Exception:  # noqa: BLE001
            return None

    def _tick_cover(self):
        """Axis numbers that a drawn mark (a curve, a unit circle, an arrow and its tip, a dot) runs through or crowds within a
        clearance band of the number's own height: {axes id: (covered keys, uncovered faded keys)}."""
        out = {}
        for aid in list(self.shown):
            if self.W.objs.get(aid, {}).get("type") != "axes" or aid not in self.mobs:
                continue
            o = self.W.objs[aid]
            gone = o.setdefault("_ticks_gone", set())
            ticks = [m for m in self.mobs[aid].submobjects if getattr(m, "_tick", False)]
            if not ticks:
                continue
            _, pts = self._obstacles(exclude=(aid,))
            lab = [_box(self.mobs[x]) for x in self.shown if self.W.objs.get(x, {}).get("type") == "label" and x in self.mobs
                   and not getattr(self.mobs[x], "_tiny", False) and self.mobs[x].get_fill_opacity() > 0.05]
            hit, free = set(), set()
            for m in ticks:
                b = _box(m)
                g = self.LW["tick_clear"] * min(m.height, 0.4)
                covered = bool(len(pts)) and bool((_ink_dist(b, pts) < g).any())
                # a label that took (or crowds) the number's place
                covered = covered or any(_ovl(b, lb) > 0 for lb in lab)
                if _DBG and covered and m._tick not in gone:
                    print("TICK", m._tick, "ink" if bool(len(pts)) and bool((_ink_dist(b, pts) < g).any()) else "label")
                if covered and m._tick not in gone:
                    hit.add(m._tick)
                elif not covered and m._tick in gone:
                    free.add(m._tick)
            out[aid] = (hit, free)
        return out

    def _declutter_ticks(self):
        """Tick numbers that another drawn thing now runs through or crowds (a unit circle over the y-axis numbers, the vy arrow
        over the '40') fade out: a crossed-out number is worse than none. They stay out while covered (also when the axes are
        rebuilt as vars animate) and come back once what covered them has moved on (a projectile that flew past)."""
        fades = []
        for aid, (hit, free) in self._tick_cover().items():
            o = self.W.objs[aid]
            gone = o["_ticks_gone"]
            for m in self.mobs[aid].submobjects:
                key = getattr(m, "_tick", None)
                if key in hit:
                    gone.add(key)
                    fades.append(m.animate.set_opacity(0))
                    self.audit["ticks_faded"] += 1
                elif key in free:
                    gone.discard(key)
                    fades.append(m.animate.set_opacity(1))
                    self.audit["ticks_restored"] += 1
            if free and not any(getattr(m, "_tick", None) in free for m in self.mobs[aid].submobjects):
                # rebuilt while those numbers were out: rebuild once more with them back
                new = self._make(o)
                if new is not None:
                    self.mobs[aid].become(new)
                    self.mobs[aid].ax = new.ax
        if fades:
            self.scene.play(*fades, run_time=0.3)

    def _settle_labels(self, run_time=0.45, play=True, skip=()):
        """Re-place every visible label against everything now on screen (later objects may have landed on earlier labels, or
        sit nearer a label than its own target). A label only moves when the new spot is clearly better, and never beyond its
        reach from the target (the score's anchor term), so labels do not wander away from what they name."""
        anims = []
        for oid in list(self.shown):
            o = self.W.objs.get(oid)
            if not o or o["type"] != "label" or not o.get("for") or oid not in self.mobs or oid in skip:
                continue
            m = self.mobs[oid]
            if getattr(m, "_tiny", False):  # faded with its zero-length arrow; it comes back when the arrow grows
                continue
            best, bs, home, ctx = self._best_spot(m, o)
            cur = self._score(m, ctx["boxes"], ctx["pts"], home=home, ctx=ctx) + self._side_pen(m, o, home)
            h = max(min(m.height, m.width), 0.18)
            if _DBG:
                print("SETTLE", oid, round(cur, 2), "->", round(bs, 2), np.round(m.get_center()[:2], 2), np.round(best.get_center()[:2], 2))
            if bs < cur - 1.0 and np.linalg.norm(best.get_center() - m.get_center()) > 0.25 * h:
                delta = best.get_center() - m.get_center()
                anims.append(m.animate.shift(delta))
            # a label that cannot find a clean spot is taken off rather than left on top of something
            if min(bs, cur) >= 60 and not o.get("keep"):
                anims.append(FadeOut(m))
                self.shown.remove(oid)
                self.culled = getattr(self, "culled", []) + [oid]
        if anims and play:
            self.scene.play(*anims, run_time=run_time)
        return anims

    def _anchor_now(self, o):
        """The live point a label is attached to: the midpoint of its line/arrow/flow, an angle's vertex, a block's centre, a
        point's position. Read every frame by the label's updater."""
        ref = str(o["for"])
        try:
            if "[" in ref:
                c = self.cell(ref)
                return c.get_center() if c is not None else None
            tgt = self.W.objs.get(ref, {})
            t = tgt.get("type")
            if t in BLOCKY or t in ("circle", "polygon", "group"):
                return self.mobs[ref].get_center() if ref in self.mobs else None
            if t == "function":
                # the label of a function rides with the drawn end of its curve (a domain [0, t] grows as t animates)
                pp = getattr(self.mobs.get(ref), "_path_pts", None)
                return np.array(pp[int(0.9 * (len(pp) - 1))]) if pp else None
            if t == "flow":
                mob = self.mobs.get(ref)
                if mob is None:
                    return None
                path = mob[0] if isinstance(mob, VGroup) and len(mob) and not isinstance(mob, Arrow) else mob
                return path.point_from_proportion(0.5)
            if t == "angle":
                return self.P(tgt["points"][1])
            if t in ("segment", "line", "ray") or t in GW.TWO_TERMINAL:
                return (self.P(tgt["from"]) + self.P(tgt["to"])) / 2
            if t == "vector":
                a = self.P(tgt["from"])
                b = np.array([*self.W.to_frame(self.W.end(ref, self.X, self.vals)), 0.0])
                return (a + b) / 2
            if t is None and "-" in ref:
                pts = self.W.ref_points(ref)
                return (self.P(pts[0]) + self.P(pts[-1])) / 2
            return self.pos(ref)
        except Exception:  # noqa: BLE001
            return None

    def _follow(self, oid):
        """Attach a label to its target with an updater: every frame it moves by however much its anchor moved, whatever moved
        it (a var animating, a 'move', a rebuilt arrow), so it never drifts off mid-clip."""
        m = self.mobs.get(oid)
        o = self.W.objs.get(oid)
        if m is None or not o or not o.get("for") or getattr(m, "_follows", False):
            return

        def upd(mm):
            a = self._anchor_now(o)
            prev = getattr(mm, "_anchor", None)
            if a is None:
                return
            if prev is not None:
                d = a - prev
                if float(np.abs(d).max()) > 1e-6:
                    mm.shift(d)
            mm._anchor = a

        m._anchor = self._anchor_now(o)
        m.add_updater(upd)
        m._follows = True

    def _zero_length(self, ref):
        o = self.W.objs.get(ref) if isinstance(ref, str) else None
        if not o or o.get("type") not in ("vector", "segment") or not o.get("from"):
            return None
        try:
            return bool(np.linalg.norm(self.W.end(ref, self.X, self.vals) - self.W.pos(o["from"], self.X, self.vals)) * self.W.transform[1] < 0.08)
        except Exception:  # noqa: BLE001
            return None

    def _relabel(self):
        """After a change of vars: re-render templated label text and re-place labels around their (moved) anchors."""
        anims = []
        for oid in list(self.shown):
            o = self.W.objs.get(oid)
            if not o or o["type"] not in ("label", "pointer", "text", "box", "cells"):
                continue
            if o["type"] in ("pointer",):
                new = self._make(o)
                anims.append(Transform(self.mobs[oid], new))
                continue
            if o["type"] in ("box", "text"):
                if "{" in str(o.get("text", "")) + str(o.get("tex", "")) or isinstance(o.get("text"), list) or isinstance(o.get("tex"), list):
                    anims.append(Transform(self.mobs[oid], self._make(o)))
                continue
            if o["type"] == "cells":
                continue
            old = self.mobs[oid]
            templ = "{" in str(o.get("text", "")) + str(o.get("tex", "")) or isinstance(o.get("text"), list) or isinstance(o.get("tex"), list)
            new = self._make(o)
            new._anchor = self._anchor_now(o) if o.get("for") else None
            # the label of an arrow/segment that has shrunk to nothing (vy at the top of a throw) fades out, and back in when it grows
            tiny = self._zero_length(o.get("for"))
            if tiny is not None:
                new.set_opacity(0.0 if tiny else 1.0)
                if tiny != getattr(old, "_tiny", False):
                    templ = templ or True
                new._tiny = tiny
            if templ or np.linalg.norm(new.get_center() - old.get_center()) > 0.05:
                anims.append(Transform(old, new) if not templ else FadeTransform(old, new))
                if templ:
                    self.mobs[oid] = new
                    self._follow(oid)
                old._anchor = new._anchor
        return anims

    def _play(self, *anims, run_time=1.0):
        anims = [a for a in anims if a is not None]
        flat = []
        for a in anims:
            flat += a if isinstance(a, list) else [a]
        if flat:
            self.scene.play(*flat, run_time=max(0.3, run_time))

    def do(self, a, rt):
        a = _as(a)
        kind = a[0]
        args = a[1:]
        opts = args[-1] if args and isinstance(args[-1], dict) and kind not in ("set",) else {}
        if opts:
            args = args[:-1]
        rt = float(opts.get("run", rt)) if isinstance(opts, dict) else rt
        sc = self.scene
        if kind == "show":
            ids = []
            todo = [y for x in args for y in _as(x)]
            while todo:
                y = todo.pop(0)
                g = self.W.objs.get(y, {})
                if g.get("type") == "group":
                    todo = list(g.get("members") or []) + todo
                    if y not in self.shown:
                        self.shown.append(y)
                        self.mobs[y] = VGroup()
                    continue
                # an arrow between two things never appears before them
                if g.get("type") == "flow":
                    for end in (g.get("from"), g.get("to")):
                        if isinstance(end, str) and end in self.W.objs and end not in self.shown and end not in ids and "[" not in end:
                            ids.append(end)
                ids.append(y)
            anims = []
            for x in ids:
                an = self.show_anim(x)
                if an is not None:
                    anims.append(an)
                o = self.W.objs.get(x, {})
                if o.get("type") == "label" and x in self.mobs:
                    self.mobs[x]._anchor = self._anchor_now(o) if o.get("for") else None
                # labels for this object that no beat shows explicitly appear with it
                for lid2 in self._orphans.get(x, []):
                    if lid2 not in self.shown:
                        an3 = self.show_anim(lid2)
                        if an3 is not None:
                            anims.append(an3)
                            self.mobs[lid2]._anchor = self._anchor_now(self.W.objs[lid2])
                # auto labels created from "label" shorthand show with their object
                lid = f"{x}.lbl"
                if lid in self.W.objs and lid not in self.shown and self.W.objs[lid].get("_auto"):
                    an2 = self.show_anim(lid)
                    if an2 is not None:
                        anims.append(an2)
                        self.mobs[lid]._anchor = self._anchor_now(self.W.objs[lid])
            # everything in this show is built now: place its labels again, against all of it (one pass, in order)
            for x in list(self.shown):
                o = self.W.objs.get(x, {})
                if o.get("type") == "label" and o.get("for") and x in self.mobs and (x in ids or x.endswith(".lbl") and x[:-4] in ids):
                    self._place(self.mobs[x], o)
                    self._follow(x)
            new_ids = {x for x in ids} | {f"{x}.lbl" for x in ids}
            if any(self.W.objs.get(x, {}).get("type") != "label" for x in ids):
                # older labels that the new objects now cover move out of the way in the same animation
                anims += self._settle_labels(play=False, skip=new_ids)
            if anims:
                from manim import LaggedStart
                flat = []
                for an in anims:
                    flat += an if isinstance(an, list) else [an]
                sc.play(LaggedStart(*flat, lag_ratio=0.25 if len(flat) > 1 else 0), run_time=max(0.6, rt))
            return
        if kind == "hide":
            ids = [y for x in args for y in _as(x)]
            ms = []
            for x in ids:
                for y in (x, f"{x}.lbl"):
                    if y in self.shown and y in self.mobs:
                        ms.append(self.mobs[y])
                        self.shown.remove(y)
                if x in self.traces:
                    ms.append(self.traces.pop(x))
            if ms:
                sc.play(*[FadeOut(m) for m in ms], run_time=max(0.4, rt * 0.6))
            return
        if kind == "highlight":
            ms = []
            for x in args:
                for y in _as(x):
                    m = self.cell(y) if "[" in str(y) else self.mobs.get(y)
                    if m is not None:
                        ms.append(m)
            if ms:
                sc.play(*[Indicate(m, color=col(opts.get("color", "accent")), scale_factor=1.12) for m in ms], run_time=max(0.6, rt))
            return
        if kind == "color":
            role = args[-1] if len(args) >= 2 else "accent"
            anims = []
            for y in _as(args[0]):
                m = self.cell(y) if "[" in str(y) else self.mobs.get(y)
                if m is None:
                    continue
                if "[" in str(y):
                    for cellm in (m if isinstance(m, VGroup) and len(m) and isinstance(m[0], VGroup) else [m]):
                        anims.append(cellm[0].animate.set_fill(col(role), opacity=0.35 if role not in ("muted", "light") else 0.5).set_stroke(col(role) if role not in ("light",) else col("muted")))
                        if role == "muted":
                            anims.append(cellm[1].animate.set_opacity(0.35))
                elif self.W.objs.get(y, {}).get("type") == "box" and isinstance(m, VGroup) and len(m) == 2:
                    anims.append(m[0].animate.set_stroke(col(role)).set_fill(col(role), opacity=0.22))
                    o = self.W.objs.get(y)
                    if o is not None:
                        o["color"] = role
                else:
                    anims.append(m.animate.set_color(col(role)))
                    o = self.W.objs.get(y)
                    if o is not None:
                        o["color"] = role
            if anims:
                sc.play(*anims, run_time=max(0.5, rt))
            return
        if kind == "focus":
            ids = [y for x in args for y in _as(x)]
            anims = []
            for oid in self.shown:
                m = self.mobs.get(oid)
                if m is None:
                    continue
                keep = not ids or oid in ids or oid.rsplit(".lbl", 1)[0] in ids
                anims.append(m.animate.set_opacity(1.0 if keep else 0.25))
            self._focused = bool(ids)
            if anims:
                sc.play(*anims, run_time=max(0.5, rt))
            return
        if kind in ("animate", "set"):
            if kind == "set":
                upd = args[0] if args and isinstance(args[0], dict) else {}
                cur = dict(self.vals)
                new = {k: self.W.vars.eval(v, cur) for k, v in upd.items()}
                self.W.vars.overrides.update(new)
                self._advance(run_time=rt, steps=1)
                return
            name, to = args[0], args[1]
            v0 = self.vals[name]
            v1 = self.W.vars.eval(to, self.vals)
            self._advance(run_time=rt, var=(name, v0, v1), rate=opts.get("rate"))
            return
        if kind == "morph":
            src, dst = _as(args[0]), _as(args[1])
            anims = []
            for s, d in zip(src, dst):
                sm = self.mobs.get(s)
                dm = self._build(d)
                if sm is None or dm is None:
                    continue
                anims.append(Transform(sm, dm))
                self.mobs[d] = sm
                if s in self.shown:
                    self.shown.remove(s)
                self.shown.append(d)
                lid = f"{s}.lbl"
                if lid in self.shown and lid in self.mobs:
                    anims.append(FadeOut(self.mobs[lid]))
                    self.shown.remove(lid)
            if anims:
                sc.play(*anims, run_time=max(0.8, rt))
            return
        if kind == "trace":
            for x in args:
                for y in _as(x):
                    m = self.mobs.get(y) or self._build(y)
                    if m is None:
                        continue
                    if y not in self.shown:
                        self.shown.append(y)
                        sc.add(m)
                    tr = TracedPath(m.get_center, stroke_color=col(opts.get("color") or self.W.objs[y].get("color"), "highlight"), stroke_width=4)
                    self.traces[y] = tr
                    sc.add(tr)
            return
        if kind == "untrace":
            for x in args:
                for y in _as(x):
                    if y in self.traces:
                        self.traces[y].clear_updaters()
            return
        if kind == "flow":
            ids = [y for x in args for y in _as(x) if isinstance(y, str)]
            hidden = []
            for y in ids:
                o = self.W.objs.get(y) or {}
                if o.get("type") == "flow" and y not in self.shown:
                    for end in (o.get("from"), o.get("to")):  # its ends first, then the arrow
                        if end and "[" not in str(end) and end not in self.shown:
                            a = self.show_anim(end)
                            if a:
                                hidden += a if isinstance(a, list) else [a]
                    a = self.show_anim(y)
                    if a:
                        hidden += a if isinstance(a, list) else [a]
            if hidden:
                sc.play(*hidden, run_time=0.6)
            self._flow_dots(args, opts, rt)
            return
        if kind == "equation":
            self._equation(args, rt)
            return
        if kind == "note":
            txt = GW.fmt_template(str(args[0]) if args else "", self.vals)
            m = _t(GW.wrap(txt, 60 if not PORTRAIT else 30, 2), FS["note"], "muted")
            z = [-FW / 2 + 0.3, -FH / 2 + 0.1, FW / 2 - 0.3, self.bot - 0.05]
            if m.width > z[2] - z[0]:
                m.scale_to_fit_width(z[2] - z[0])
            m.move_to([0, (z[1] + z[3]) / 2, 0])
            if self.note_mob is None:
                sc.play(FadeIn(m), run_time=0.5)
            else:
                sc.play(FadeTransform(self.note_mob, m), run_time=0.5)
            self.note_mob = m
            return
        if kind == "wait":
            sc.wait(float(args[0]) if args else rt)
            return
        if kind == "glue":
            fn = self.glue.get(f"glue_{args[0]}") or self.glue.get(str(args[0]))
            if fn:
                fn(self, sc, *args[1:])
            return
        if kind == "move":
            ids = _as(args[0])
            to = args[1] if len(args) > 1 else opts.get("to")
            anims = []
            for y in ids:
                m = self.mobs.get(y)
                if m is None or to is None:
                    continue
                p = self.cell(to).get_center() if "[" in str(to) else (self.mobs[to].get_center() if to in self.mobs else self.pos(to))
                anims.append(m.animate.move_to(p))
            if anims:
                sc.play(*anims, run_time=max(0.6, rt))
            return

    def _advance(self, run_time, var=None, steps=None, rate=None):
        W = self.W
        if var is None:
            vals = W.vars.values()
            X, _ = W.solve(vals, warm=self.X, ks=W.transform[1])
            self.vals, self.X = vals, X
            self._refresh()
            anims = self._relabel()
            if anims:
                self.scene.play(*anims, run_time=max(0.5, run_time))
            return
        name, v0, v1 = var
        state = {"X": self.X}

        def upd(_m, alpha):
            v = v0 + (v1 - v0) * alpha
            W.vars.overrides[name] = v
            vals = W.vars.values()
            X, _ = W.solve(vals, warm=state["X"], ks=W.transform[1])
            state["X"] = X
            self.vals, self.X = vals, X
            self._refresh()

        dummy = VMobject()
        rf = {"linear": rate_functions.linear, "smooth": rate_functions.smooth}.get(rate or "smooth", rate_functions.smooth)
        self.scene.play(UpdateFromAlphaFunc(dummy, upd), run_time=max(0.8, run_time), rate_func=rf)
        W.vars.overrides[name] = v1
        anims = self._relabel()
        anims += self._settle_labels(play=False, skip={a.mobject for a in anims} and set())
        if anims:
            self.scene.play(*anims, run_time=0.5)

    def _flow_dots(self, args, opts, rt):
        paths = []
        for x in args:
            for y in _as(x):
                m = self.mobs.get(y) or self._build(y)
                if m is None:
                    continue
                o = self.W.objs.get(y, {})
                if o.get("type") in ("polygon",) or o.get("type") == "wire" or o.get("closed"):
                    pts = [self.pos(p) for p in o["points"]] + [self.pos(o["points"][0])]
                    path = VMobject().set_points_as_corners(pts)
                elif o.get("type") == "function":
                    pp = getattr(m, "_path_pts", None) or []
                    path = VMobject().set_points_smoothly(pp) if len(pp) > 2 else m
                elif isinstance(m, VGroup) and len(m) and not isinstance(m, Arrow):
                    path = m[0]
                else:
                    path = m
                paths.append(path)
        if not paths:
            return
        n = int(opts.get("n", 6))
        color = col(opts.get("color", "accent"))
        loops = float(opts.get("loops", 1.0))
        speed = float(opts.get("speed", 1.0))
        dots = VGroup()
        for p in paths:
            for i in range(n):
                d = Dot(radius=0.075, color=color)
                d._path, d._off = p, i / n
                d.move_to(p.point_from_proportion(d._off))
                dots.add(d)
        t = ValueTracker(0)

        def upd(g):
            for d in g:
                d.move_to(d._path.point_from_proportion((d._off + t.get_value()) % 1.0))
        dots.add_updater(upd)
        self.scene.add(dots)
        self.scene.play(t.animate.set_value(loops * speed), run_time=max(1.0, rt), rate_func=rate_functions.linear)
        dots.clear_updaters()
        if not opts.get("keep"):
            self.scene.play(FadeOut(dots), run_time=0.3)

    def _equation(self, args, rt):
        eid = args[0]
        o = self.W.objs[eid]
        lines = o.get("_lines") or []
        if not lines:
            return
        i = int(args[1]) if len(args) > 1 and str(args[1]).lstrip("-").isdigit() else o.get("_cur", -1) + 1
        i = max(0, min(len(lines) - 1, i))
        o["_cur"] = i
        ln = lines[i]
        m = self._eq_mob(ln)
        m.move_to(self._panel_slot(m.height))
        if self.band:
            m.move_to([(self.band[0] + self.band[2]) / 2, (self.band[1] + self.band[3]) / 2 + (0.18 if ln.get("note") else 0), 0])
        anims = []
        if self.eq_mob is None:
            anims.append(Write(m))
        elif getattr(self.eq_mob, "_eid", None) == eid and isinstance(m, MathTex) and isinstance(self.eq_mob, MathTex):
            anims.append(TransformMatchingTex(self.eq_mob, m))
        else:
            anims.append(FadeTransform(self.eq_mob, m))
        m._eid = eid
        note = None
        if ln.get("note"):
            z = self.band or self.panel or self.main_box
            chars = max(12, int(((z[2] - z[0]) - 0.2) / (FS["note"] * 0.0080)))
            note = _t(GW.wrap(GW.fmt_template(ln["note"], self.vals), chars, 3), FS["note"], "accent")
            if note.width > (z[2] - z[0]) - 0.2:
                note.scale(max(((z[2] - z[0]) - 0.2) / note.width, 0.92))
            note.next_to(m, DOWN, buff=0.18)
            if self.band:
                note.next_to(m, DOWN, buff=0.08)
        if self.eq_note is not None:
            anims.append(FadeOut(self.eq_note))
        if note is not None:
            anims.append(FadeIn(note, shift=UP * 0.1))
        self.scene.play(*anims, run_time=max(0.8, rt))
        self.eq_mob, self.eq_note = m, note

    # ── the whole scene ──
    def perform(self):
        sc = self.scene
        if self.ir.get("title"):
            t = _t(self.ir["title"], FS["title"], "ink", weight="BOLD")
            if t.width > FW - 0.8:
                t.scale_to_fit_width(FW - 0.8)
            t.move_to([0, FH / 2 - 0.55, 0])
            t.align_to(np.array([-FW / 2 + 0.4, 0, 0]), LEFT)
            rule = Line([-FW / 2 + 0.4, FH / 2 - 0.95, 0], [FW / 2 - 0.4, FH / 2 - 0.95, 0], color=col("light"), stroke_width=2)
            sc.play(FadeIn(t, shift=DOWN * 0.1), Create(rule), run_time=0.7)
            self.title_mob = t
        for b in self.ir.get("beats") or []:
            words = len(str(b.get("say", "")).split())
            dur = float(b.get("duration") or max(2.5, words / 2.6))
            acts = [_as(a) for a in b.get("do") or [] if _as(a)]
            weights = [2.0 if a[0] in ("animate", "flow") else 0.0 if a[0] in ("trace", "untrace", "wait") else 1.0 for a in acts]
            budget = dur * 0.85
            tw = sum(weights) or 1.0
            t0 = sc.renderer.time
            if getattr(self, "_focused", False) and not any(a[0] == "focus" for a in acts):
                # a focus lasts its beat: the next beat starts with everything back at full strength
                self.do(["focus"], 0.4)
            for a, w in zip(acts, weights):
                rt = max(0.6, min(4.0 if a[0] not in ("animate", "flow") else 8.0, budget * w / tw))
                self.do(a, rt)
            self._settle_labels()
            self._declutter_ticks()
            self._audit()
            used = sc.renderer.time - t0
            if dur - used > 0.05:
                sc.wait(dur - used)
        sc.wait(0.6)
        self._write_report()

    # ── layout outcome (logged per render; the web app learns from recurring patterns) ──
    def _audit(self):
        """After a beat settles: measure every visible label against its target and the ink around it, and the smallest text on
        screen. Keeps the worst value per label over the clip."""
        A = self.audit
        for oid in list(self.shown):
            o = self.W.objs.get(oid)
            m = self.mobs.get(oid)
            if not o or o["type"] != "label" or not o.get("for") or m is None or getattr(m, "_tiny", False) or m.get_fill_opacity() < 0.05:
                continue
            try:
                ctx = self._label_ctx(o)
                _, home = self._candidates(m, o)
            except Exception:  # noqa: BLE001
                continue
            h = max(min(m.height, m.width), 0.18)
            b = _box(m)
            gap = _box_dist(b, ctx["pts"]) / h if len(ctx["pts"]) else 9.0
            if ctx.get("tgt") is not None and len(ctx["tgt"]):
                far = _box_dist(b, ctx["tgt"]) / h
            else:
                far = float(np.linalg.norm(m.get_center()[:2] - np.asarray(home)[:2])) / h if home is not None else 0.0
            dt = _box_dist(b, ctx["tgt"]) if ctx.get("tgt") is not None and len(ctx["tgt"]) else 0.0
            do = _box_dist(b, ctx["other"]) if len(ctx["other"]) else 9.0
            ovl = sum(_ovl(b, x) for x in ctx["boxes"]) / (h * h)
            r = A["labels"].setdefault(oid, {"gap": 9.0, "far": 0.0, "own_margin": 9.0, "overlap": 0.0})
            r["gap"] = round(min(r["gap"], gap), 3)
            r["far"] = round(max(r["far"], far), 3)
            r["own_margin"] = round(min(r["own_margin"], (do - dt) / h), 3)
            r["overlap"] = round(max(r["overlap"], ovl), 3)
        mins = []
        stack = list(self.scene.mobjects) + [self.mobs[x] for x in self.shown if x in self.mobs] + \
            [x for x in (self.title_mob, self.eq_mob, self.eq_note, self.note_mob) if x is not None]
        while stack:
            x = stack.pop()
            if isinstance(x, (Text, MathTex)) and x.get_fill_opacity() > 0.05 and x.width > 1e-3:
                mins.append(text_px(x))
                continue
            stack.extend(x.submobjects)
        if mins:
            A["min_text_px"] = round(min(mins + ([A["min_text_px"]] if A["min_text_px"] is not None else [])), 2)

    def layout_report(self) -> dict:
        """The render's layout outcome: per-label clearance, distance from the anchor and ownership margin (all in label
        heights), the smallest text in phone px, tick numbers faded/restored, labels culled, and the failure patterns they add up
        to. Patterns are general (never scene content) so recurring ones can tune the solver and the scene writer."""
        A, LW = self.audit, self.LW
        pats: dict = {}
        for oid, r in A["labels"].items():
            if r["gap"] < 0.12:
                pats["label_touching"] = pats.get("label_touching", 0) + 1
            if r["far"] > LW["reach"]:
                pats["label_far"] = pats.get("label_far", 0) + 1
            if r["own_margin"] < -0.05:
                pats["label_ambiguous"] = pats.get("label_ambiguous", 0) + 1
            if r["overlap"] > 0.05:
                pats["label_overlap"] = pats.get("label_overlap", 0) + 1
        if A["min_text_px"] is not None and A["min_text_px"] < LW["min_xh_px"] - 0.25:
            pats["text_small"] = 1
        if getattr(self, "culled", None):
            pats["label_culled"] = len(self.culled)
        try:
            X, vals = self.X, self.vals
            ys = {oid: self.W.pos(oid, X, vals)[1] for oid, o in self.W.objs.items() if o.get("type") == "icon"}
            kinds = {oid: str(self.W.objs[oid].get("icon", self.W.objs[oid].get("kind"))) for oid in ys}
            if any(ys[s_] < ys[g] for s_ in ys for g in ys if kinds[s_] in GW.SKY_ICONS and kinds[g] in GW.GROUND_ICONS):
                pats["sky_below_ground"] = 1
        except Exception:  # noqa: BLE001
            pass
        worst = {}
        if A["labels"]:
            worst = {"gap": min(r["gap"] for r in A["labels"].values()), "far": max(r["far"] for r in A["labels"].values()),
                     "own_margin": min(r["own_margin"] for r in A["labels"].values()), "overlap": max(r["overlap"] for r in A["labels"].values())}
        return {"v": 1, "aspect": "9:16" if PORTRAIT else "16:9", "labels": len(A["labels"]), "worst": worst, "min_text_px": A["min_text_px"],
                "ticks_faded": A["ticks_faded"], "ticks_restored": A["ticks_restored"], "culled": list(getattr(self, "culled", []))[:8],
                "patterns": pats, "weights": {k: round(v, 4) for k, v in LW.items()}, "per_label": {k: v for k, v in list(A["labels"].items())[:16]}}

    def _write_report(self):
        import json
        import os
        path = os.environ.get("GM_LAYOUT_PATH")
        if not path:
            return
        try:
            with open(path, "w") as f:
                json.dump(self.layout_report(), f)
        except Exception as exc:  # noqa: BLE001
            print("layout report failed:", exc)


BLOCKY = {"box", "icon", "cells", "axes", "text"}


def _as(a):
    if isinstance(a, list):
        return a
    if isinstance(a, str):
        return [a]
    if isinstance(a, dict):  # {"show": [...]} style
        k = next(iter(a), None)
        if k:
            v = a[k]
            return [k] + (v if isinstance(v, list) else [v])
    return []


def _tick(m, key=None):
    m._tick = key or True
    return m


def _lab(s, fs, color):
    s = str(s)
    if re.search(r"[\\^_]|^[a-zA-Z]$|^[a-zA-Z]\([a-z]\)$", s):
        return MathTex(_tex_pow(s), font_size=fs + 6, color=col(color))
    return _t(s, fs, color)


def _num(v, pi=False):
    if pi:
        r = v / math.pi
        if abs(r - round(r * 2) / 2) < 1e-6:
            q = round(r * 2) / 2
            return "0" if q == 0 else ("π" if q == 1 else "-π" if q == -1 else f"{q:g}π")
    return f"{v:g}"


def _step(a, b, given):
    if given:
        return float(given)
    span = b - a
    for s in (0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000):
        if span / s <= 8:
            return float(s)
    return span / 6


def _ticks(a, b, s):
    import math as _m
    v = _m.ceil(a / s - 1e-9) * s
    out = []
    while v <= b + 1e-9:
        out.append(round(v, 10))
        v += s
    return out


def _clip(a, b, box):
    """Clip the segment a-b to the box (Liang-Barsky)."""
    x0, y0, x1, y1 = box
    dx, dy = b[0] - a[0], b[1] - a[1]
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, a[0] - x0), (dx, x1 - a[0]), (-dy, a[1] - y0), (dy, y1 - a[1])):
        if abs(p) < 1e-12:
            if q < 0:
                return a, a
            continue
        r = q / p
        if p < 0:
            t0 = max(t0, r)
        else:
            t1 = min(t1, r)
    if t0 > t1:
        return a, a
    return a + t0 * (b - a), a + t1 * (b - a)


def _edge_point(m, direction):
    """Where a ray from the centre of m in the given direction leaves its bounding box."""
    c = m.get_center()
    w, h = m.width / 2, m.height / 2
    d = np.array(direction, dtype=float)
    d[2] = 0
    if np.linalg.norm(d) < 1e-9:
        return c
    tx = w / abs(d[0]) if abs(d[0]) > 1e-9 else 1e9
    ty = h / abs(d[1]) if abs(d[1]) > 1e-9 else 1e9
    return c + d * min(tx, ty)


# ───────────────────────── icons ─────────────────────────
def icon(kind, size=1.2, color=None):
    s = size
    C = lambda c: col(color, c) if color else col(c)  # noqa: E731
    g = VGroup()
    if kind == "sun":
        core = Circle(radius=0.28 * s, color=col("accent"), fill_color=col("yellow"), fill_opacity=1, stroke_width=3)
        g.add(core)
        for i in range(12):
            a = i * math.pi / 6
            g.add(Line(0.36 * s * np.array([math.cos(a), math.sin(a), 0]), 0.5 * s * np.array([math.cos(a), math.sin(a), 0]), color=col("accent"), stroke_width=4))
    elif kind in ("cloud", "rain"):
        from manim import Union
        parts = [Circle(radius=0.2 * s).shift(LEFT * 0.22 * s + DOWN * 0.03 * s), Circle(radius=0.27 * s).shift(UP * 0.07 * s),
                 Circle(radius=0.19 * s).shift(RIGHT * 0.25 * s + DOWN * 0.04 * s), Rectangle(width=0.7 * s, height=0.2 * s).shift(DOWN * 0.13 * s)]
        u = Union(*parts, color=C("muted"), fill_color="#FFFFFF", fill_opacity=1, stroke_width=3)
        g.add(u)
        if kind == "rain":
            for i, x in enumerate((-0.2, 0, 0.2)):
                g.add(Line([x * s, -0.3 * s, 0], [x * s - 0.06 * s, -0.48 * s, 0], color=col("water"), stroke_width=4))
    elif kind == "drop":
        pts = [np.array([0, 0.45 * s, 0])] + [np.array([0.25 * s * math.cos(a), -0.12 * s + 0.25 * s * math.sin(a), 0]) for a in np.linspace(math.radians(20), math.radians(160), 1)]
        d = VMobject(color=col("water"), fill_color=col("water"), fill_opacity=0.85, stroke_width=2)
        arc = [np.array([0.25 * s * math.cos(a), -0.12 * s + 0.25 * s * math.sin(a), 0]) for a in np.linspace(math.radians(30), math.radians(-210), 24)]
        d.set_points_smoothly([np.array([0, 0.45 * s, 0])] + arc + [np.array([0, 0.45 * s, 0])])
        g.add(d)
        del pts
    elif kind == "mountain":
        g.add(Polygon([-0.55 * s, -0.4 * s, 0], [-0.1 * s, 0.4 * s, 0], [0.35 * s, -0.4 * s, 0], color=col("c"), fill_color=col("c"), fill_opacity=0.55, stroke_width=3))
        g.add(Polygon([0.0, -0.4 * s, 0], [0.3 * s, 0.1 * s, 0], [0.6 * s, -0.4 * s, 0], color=col("c"), fill_color=col("c"), fill_opacity=0.35, stroke_width=3))
        g.add(Polygon([-0.1 * s, 0.4 * s, 0], [-0.22 * s, 0.19 * s, 0], [0.02 * s, 0.19 * s, 0], color=col("c"), fill_color="#FFFFFF", fill_opacity=1, stroke_width=2))
    elif kind in ("sea", "lake"):
        g.add(Rectangle(width=1.1 * s, height=0.5 * s, color=col("water"), fill_color=col("water"), fill_opacity=0.35, stroke_width=0))
        for y in (0.1, -0.08):
            w = VMobject(color=col("water"), stroke_width=3).set_points_smoothly([[x * s, y * s + 0.04 * s * math.sin(x * 18), 0] for x in np.linspace(-0.5, 0.5, 20)])
            g.add(w)
    elif kind == "leaf":
        a1 = Arc(radius=0.5 * s, start_angle=math.radians(200), angle=math.radians(-80)).shift(RIGHT * 0.0)
        leaf = VMobject(color=col("c"), fill_color=col("good"), fill_opacity=0.6, stroke_width=3)
        top = [np.array([0.45 * s * math.cos(t), 0.22 * s * math.sin(t), 0]) for t in np.linspace(0, math.pi, 16)]
        bot = [np.array([0.45 * s * math.cos(t), 0.22 * s * math.sin(t), 0]) for t in np.linspace(math.pi, 2 * math.pi, 16)]
        leaf.set_points_smoothly(top + bot)
        g.add(leaf, Line([-0.45 * s, 0, 0], [0.45 * s, 0, 0], color=col("c"), stroke_width=2))
        g.rotate(math.radians(25))
        del a1
    elif kind in ("tree", "plant"):
        g.add(Rectangle(width=0.12 * s, height=0.4 * s, color=col("brown"), fill_color=col("brown"), fill_opacity=1).shift(DOWN * 0.3 * s))
        g.add(Circle(radius=0.32 * s, color=col("c"), fill_color=col("good"), fill_opacity=0.7, stroke_width=3).shift(UP * 0.12 * s))
    elif kind == "cell":
        g.add(Ellipse(width=1.0 * s, height=0.7 * s, color=col("d"), fill_color=col("d"), fill_opacity=0.12, stroke_width=3))
        g.add(Circle(radius=0.14 * s, color=col("d"), fill_color=col("d"), fill_opacity=0.5, stroke_width=2).shift(RIGHT * 0.1 * s))
    elif kind == "ball":
        g.add(Circle(radius=0.3 * s, color=C("b"), fill_color=C("b"), fill_opacity=0.8, stroke_width=3))
    elif kind == "house":
        g.add(Square(side_length=0.6 * s, color=C("ink"), stroke_width=3).shift(DOWN * 0.15 * s))
        g.add(Polygon([-0.4 * s, 0.15 * s, 0], [0, 0.48 * s, 0], [0.4 * s, 0.15 * s, 0], color=C("b"), fill_color=C("b"), fill_opacity=0.6, stroke_width=3))
    elif kind == "factory":
        g.add(Polygon([-0.5 * s, -0.35 * s, 0], [-0.5 * s, 0.05 * s, 0], [-0.2 * s, 0.2 * s, 0], [-0.2 * s, 0.05 * s, 0], [0.1 * s, 0.2 * s, 0], [0.1 * s, 0.05 * s, 0], [0.5 * s, 0.2 * s, 0], [0.5 * s, -0.35 * s, 0], color=C("muted"), fill_color=C("muted"), fill_opacity=0.4, stroke_width=3))
        g.add(Rectangle(width=0.12 * s, height=0.35 * s, color=C("muted"), fill_color=C("muted"), fill_opacity=0.6).move_to([0.35 * s, 0.35 * s, 0]))
    elif kind == "person":
        g.add(Circle(radius=0.12 * s, color=C("ink"), stroke_width=3).shift(UP * 0.32 * s), Line([0, 0.2 * s, 0], [0, -0.15 * s, 0], color=C("ink"), stroke_width=3),
              Line([-0.2 * s, 0.08 * s, 0], [0.2 * s, 0.08 * s, 0], color=C("ink"), stroke_width=3), Line([0, -0.15 * s, 0], [-0.15 * s, -0.45 * s, 0], color=C("ink"), stroke_width=3),
              Line([0, -0.15 * s, 0], [0.15 * s, -0.45 * s, 0], color=C("ink"), stroke_width=3))
    elif kind == "earth":
        g.add(Circle(radius=0.45 * s, color=col("water"), fill_color=col("water"), fill_opacity=0.3, stroke_width=3), Ellipse(width=0.3 * s, height=0.9 * s, color=col("water"), stroke_width=2),
              Line([-0.45 * s, 0, 0], [0.45 * s, 0, 0], color=col("water"), stroke_width=2))
    elif kind == "flask":
        g.add(Polygon([-0.08 * s, 0.4 * s, 0], [0.08 * s, 0.4 * s, 0], [0.08 * s, 0.1 * s, 0], [0.35 * s, -0.4 * s, 0], [-0.35 * s, -0.4 * s, 0], [-0.08 * s, 0.1 * s, 0], color=C("ink"), stroke_width=3))
        g.add(Polygon([0.2 * s, -0.12 * s, 0], [0.35 * s, -0.4 * s, 0], [-0.35 * s, -0.4 * s, 0], [-0.2 * s, -0.12 * s, 0], stroke_width=0, fill_color=C("teal"), fill_opacity=0.5))
    elif kind == "magnet":
        g.add(Arc(radius=0.3 * s, start_angle=math.pi, angle=math.pi, color=C("bad"), stroke_width=14).shift(DOWN * 0.05 * s))
        g.add(Line([-0.3 * s, -0.05 * s, 0], [-0.3 * s, 0.35 * s, 0], color=C("bad"), stroke_width=14), Line([0.3 * s, -0.05 * s, 0], [0.3 * s, 0.35 * s, 0], color=C("a"), stroke_width=14))
    elif kind == "bolt":
        g.add(Polygon([0.05 * s, 0.5 * s, 0], [-0.25 * s, 0, 0], [0, 0, 0], [-0.1 * s, -0.5 * s, 0], [0.25 * s, 0.08 * s, 0], [0.02 * s, 0.08 * s, 0], color=C("accent"), fill_color=col("yellow"), fill_opacity=1, stroke_width=2))
    elif kind == "fire":
        f = VMobject(color=C("warm"), fill_color=C("warm"), fill_opacity=0.8, stroke_width=2)
        f.set_points_smoothly([[0, 0.5 * s, 0], [0.25 * s, 0.05 * s, 0], [0.2 * s, -0.35 * s, 0], [-0.2 * s, -0.35 * s, 0], [-0.25 * s, 0.05 * s, 0], [0, 0.5 * s, 0]])
        g.add(f)
    elif kind == "snowflake":
        for i in range(3):
            g.add(Line(0.45 * s * LEFT, 0.45 * s * RIGHT, color=C("cool"), stroke_width=4).rotate(i * math.pi / 3))
    elif kind == "gear":
        pts = []
        for i in range(10):
            a0 = 2 * math.pi * i / 10
            for da, rr in ((0, 0.32), (0.18, 0.45), (0.32, 0.45), (0.5, 0.32)):
                a = a0 + da * 2 * math.pi / 10
                pts.append([rr * s * math.cos(a), rr * s * math.sin(a), 0])
        pts.append(pts[0])
        g.add(VMobject(color=C("a"), fill_color=C("a"), fill_opacity=0.2, stroke_width=3).set_points_as_corners(pts), Circle(radius=0.1 * s, color=C("a"), stroke_width=3))
    elif kind == "eye":
        top = Arc(radius=0.6 * s, start_angle=math.radians(50), angle=math.radians(80)).shift(DOWN * 0.38 * s)
        bot = Arc(radius=0.6 * s, start_angle=math.radians(-50), angle=math.radians(-80)).shift(UP * 0.38 * s)
        g.add(top.set_color(C("ink")), bot.set_color(C("ink")), Circle(radius=0.14 * s, color=C("a"), fill_color=C("a"), fill_opacity=0.8))
    elif kind == "lamp":
        g.add(Circle(radius=0.3 * s, color=C("accent"), fill_color=col("yellow"), fill_opacity=0.6, stroke_width=3).shift(UP * 0.08 * s),
              Rectangle(width=0.22 * s, height=0.16 * s, color=C("muted"), fill_color=C("muted"), fill_opacity=0.8).shift(DOWN * 0.3 * s))
    elif kind == "atom":
        for i in range(3):
            g.add(Ellipse(width=0.95 * s, height=0.32 * s, color=C("a"), stroke_width=2.5).rotate(i * math.pi / 3))
        g.add(Dot(radius=0.07 * s, color=C("b")))
    elif kind == "molecule":
        a, b, c = np.array([0, 0, 0]), np.array([-0.3 * s, -0.22 * s, 0]), np.array([0.3 * s, -0.22 * s, 0])
        g.add(Line(a, b, color=C("muted"), stroke_width=4), Line(a, c, color=C("muted"), stroke_width=4),
              Circle(radius=0.17 * s, color=C("bad"), fill_color=C("bad"), fill_opacity=0.8).move_to(a),
              Circle(radius=0.11 * s, color=C("muted"), fill_color="#FFFFFF", fill_opacity=1).move_to(b),
              Circle(radius=0.11 * s, color=C("muted"), fill_color="#FFFFFF", fill_opacity=1).move_to(c))
    elif kind == "arrow":
        g.add(Arrow(LEFT * 0.45 * s, RIGHT * 0.45 * s, buff=0, color=C("ink")))
    else:
        g.add(Circle(radius=0.4 * s, color=C("muted")))
    return g


# kept for glue code: Triangle/Square etc. are re-exported through `from manim import *` in the scene file
__all__ = ["Stage", "icon", "col", "COLORS", "FS", "BG"]
_unused = (Triangle, Brace, Rectangle)

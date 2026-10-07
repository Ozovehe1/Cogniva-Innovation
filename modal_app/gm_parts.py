"""gm_parts: the runtime of the semantic part-graph composer.

The LLM never writes coordinates. It names parts from a generic vocabulary, relations between them, quantities and the
beats of the narration (gm_solve.py turns that into a solved SCENE dict). This module draws the SCENE with Manim:

  * World: ONE source of truth for every number. Process progress (eased keyframes), steady rates (integrated angles),
    numerical models (Hodgkin-Huxley, ...), and sympy quantities are all evaluated from one time value T. Readouts,
    curves, dots on curves and mechanism motion all read World(T), so a readout can never disagree with its curve.
  * Mechanism solvers ("rigs"): deterministic geometry + kinematics for a relation pattern found in the part graph
    (fluid-linked pistons -> volume conservation; meshing gears -> pitch-matched counter-rotation; a sum constraint ->
    a differential; a duct with a reactive lattice -> flow + conversion; a cable -> a travelling spike; a host with a
    pocket + a guest -> complementary shapes + induced fit; a dissected shape -> rearrangement; ...).
  * Every element registers its bounding box function so the symbolic scene-graph check (overlap, out of frame, fill,
    motion per part) can run without rendering (analyze()).
"""
from __future__ import annotations

import json
import math
import os

import numpy as np
from manim import (
    DOWN, LEFT, ORIGIN, RIGHT, UP, PI, TAU, Arc, ArcBetweenPoints, Arrow, Axes, Circle, Circumscribe, Create,
    CubicBezier, DashedLine, DecimalNumber, Dot, Ellipse, FadeIn, FadeOut, Line, ManimColor, MathTex,
    MovingCameraScene, Polygon, Rectangle, RoundedRectangle, Text, VGroup, VMobject, ValueTracker, Write,
    interpolate_color, linear, smooth, config, AnnularSector, Sector, Annulus, Square, Succession,
)

BG = "#FDFCF9"
INK = "#14141A"
MUTED = "#6B6B73"
RULE = "#D9D6CE"
Q = {"green": "#1F6B4A", "clay": "#B4532A", "navy": "#24508F", "amber": "#B7862C", "plum": "#7A3B78", "teal": "#17808A",
     "rose": "#B23A55", "olive": "#6E7A1E"}
QWB = dict(Q)
QORDER = ["navy", "clay", "green", "plum", "teal", "rose", "amber", "olive"]
MAT = {"steel": "#8A9099", "brass": "#B08D3C", "copper": "#B5653A", "rubber": "#3A3A40", "tissue": "#C9776F", "protein": "#9C86BE",
       "membrane": "#D6B06A", "blood": "#A3243B", "bone": "#E6DCC3", "water": "#86B6DC", "wood": "#9C6B3E", "silicon": "#66727F",
       "leaf": "#5E9A4C", "glass": "#B9D3DE", "plastic": "#4F6F8F", "skin": "#D9A37E", "oil": "#D9A43A", "aluminium": "#B4BAC2",
       "iron": "#6F7378", "ceramic": "#E3D7BD", "platinum": "#A7ADB8", "gold": "#C9A227", "myelin": "#F1E4C3", "cytoplasm": "#F7E7DA",
       "neuron": "#E9B7A8", "air": "#DCE6EE", "gas": "#BFC6CC", "fluid": "#86B6DC", "paper": "#F4EFE4", "rock": "#9A8F84",
       "ice": "#CFE7F2", "sun": "#F2B630", "earth": "#3C7FB5", "moon": "#C9C6BF", "plasma": "#E07B39"}
FW, FH = config.frame_width, config.frame_height  # 14.22 x 8
OUTLINE = "#14141A"
# Visual modes: 'whiteboard' (cream board, ink) for derivations and abstract diagrams; 'real' (dark contextual backdrop,
# true material colours, glow) for physical / biological / chemical / geographic objects. Panels overlay either way.
THEMES = {
    "whiteboard": {"bg": "#FDFCF9", "bg2": "#FDFCF9", "ink": "#14141A", "muted": "#6B6B73", "rule": "#D9D6CE", "panel": "#FFFFFF", "panel_op": 0.6, "label_bg": "#FDFCF9"},
    "real": {"bg": "#0E141B", "bg2": "#1D2A36", "ink": "#ECE8E1", "muted": "#A9B0B8", "rule": "#46525E", "panel": "#16202A", "panel_op": 0.88, "label_bg": "#0E141B"},
}
QREAL = {"green": "#5CC08A", "clay": "#F08A5D", "navy": "#6FA8F0", "amber": "#F2C14E", "plum": "#C58BE0", "teal": "#4FC9D1", "rose": "#F27A93", "olive": "#B5C452"}
THEME = dict(THEMES["whiteboard"], mode="whiteboard")


def set_theme(mode: str):
    """Rebinds the module colours so every drawer created afterwards uses the mode (gm_rigs is reloaded after this)."""
    global BG, INK, MUTED, RULE
    mode = mode if mode in THEMES else "whiteboard"
    THEME.clear()
    THEME.update(THEMES[mode], mode=mode)
    BG, INK, MUTED, RULE = THEME["bg"], THEME["ink"], THEME["muted"], THEME["rule"]
    Q.update(QREAL if mode == "real" else QWB)
FONT = os.environ.get("GM_FONT", "Latin Modern Sans")

# CPK-ish atom colours (readable on a light board)
ATOM = {"H": "#FFFFFF", "C": "#3A3A40", "N": "#2F5DBF", "O": "#D2352B", "S": "#E0B428", "P": "#E07B20", "Cl": "#3FA34D",
        "Na": "#8E6CC9", "K": "#7B4FA6", "Ca": "#7A8A99", "Fe": "#C2602E", "Pt": "#A7ADB8", "Rh": "#8B93A3", "Mg": "#4E9A3A",
        "F": "#8FC93A", "Cu": "#B5653A", "Zn": "#7D80B0", "I": "#7B2E8E", "Br": "#9B3A2A"}
ATOM_R = {"H": 0.55, "C": 0.75, "N": 0.72, "O": 0.7, "S": 0.95, "P": 0.95, "Cl": 0.95, "Na": 1.0, "K": 1.1, "Pt": 1.0, "Rh": 1.0}


def col(name, default=INK):
    if not name:
        return default
    if isinstance(name, str) and name.startswith("#"):
        return name
    return MAT.get(name) or Q.get(name) or default


def mix(a, b, f):
    return interpolate_color(ManimColor(a), ManimColor(b), f).to_hex()


def light(c, f=0.4):
    return mix(c, "#FFFFFF", f)


def dark(c, f=0.3):
    return mix(c, "#000000", f)


def smooth01(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def label_text(s, size=24, color=None, weight="NORMAL"):
    s = str(s)
    color = color or THEME["ink"]
    try:
        return Text(s, font=FONT, font_size=size, color=color, weight=weight)
    except Exception:  # noqa: BLE001
        return Text(s, font_size=size, color=color)


# ───────────── Boxes and the 6x6 anchor grid ─────────────
class Box:
    def __init__(self, x0, y0, x1, y1):
        self.x0, self.y0, self.x1, self.y1 = float(min(x0, x1)), float(min(y0, y1)), float(max(x0, x1)), float(max(y0, y1))

    w = property(lambda s: s.x1 - s.x0)
    h = property(lambda s: s.y1 - s.y0)
    cx = property(lambda s: (s.x0 + s.x1) / 2)
    cy = property(lambda s: (s.y0 + s.y1) / 2)
    c = property(lambda s: np.array([(s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, 0.0]))

    def sub(self, fx0, fy0, fx1, fy1):
        """Fractions of this box, y measured from the bottom."""
        return Box(self.x0 + fx0 * self.w, self.y0 + fy0 * self.h, self.x0 + fx1 * self.w, self.y0 + fy1 * self.h)

    def shrink(self, m):
        return Box(self.x0 + m, self.y0 + m, self.x1 - m, self.y1 - m)

    def p(self, fx, fy):
        return np.array([self.x0 + fx * self.w, self.y0 + fy * self.h, 0.0])

    def aspect_fit(self, aspect):
        """Largest centred box of width/height = aspect inside this one."""
        w, h = self.w, self.h
        if w / h > aspect:
            w = h * aspect
        else:
            h = w / aspect
        return Box(self.cx - w / 2, self.cy - h / 2, self.cx + w / 2, self.cy + h / 2)

    def list(self):
        return [round(self.x0, 3), round(self.y0, 3), round(self.x1, 3), round(self.y1, 3)]


MARGIN = 0.25
COLS = "ABCDEF"


def grid_box(region: str) -> Box:
    """'A1:D6' -> Box on the 6x6 anchor grid (columns A-F left to right, rows 1-6 top to bottom)."""
    region = (region or "A1:F6").upper().replace(" ", "")
    a, _, b = region.partition(":")
    b = b or a

    def cell(s):
        c = COLS.index(s[0]) if s and s[0] in COLS else 0
        r = int(s[1:]) - 1 if s[1:].isdigit() else 0
        return min(5, max(0, c)), min(5, max(0, r))

    (c0, r0), (c1, r1) = cell(a), cell(b)
    c0, c1 = sorted((c0, c1))
    r0, r1 = sorted((r0, r1))
    cw, rh = (FW - 2 * MARGIN) / 6, (FH - 2 * MARGIN) / 6
    x0 = -FW / 2 + MARGIN + c0 * cw
    x1 = -FW / 2 + MARGIN + (c1 + 1) * cw
    y1 = FH / 2 - MARGIN - r0 * rh
    y0 = FH / 2 - MARGIN - (r1 + 1) * rh
    return Box(x0, y0, x1, y1)


# ───────────── World: one source of truth for every number ─────────────
class World:
    def __init__(self, S: dict):
        self.S = S
        self.duration = float(S.get("duration", 10))
        self.procs = {p["id"]: p for p in S.get("processes", [])}
        self.models = {}
        self.dt = 1 / 120
        n = int(self.duration / self.dt) + 3
        self.tgrid = np.arange(n) * self.dt
        self.rate_cum = {}
        for p in S.get("processes", []):
            if p.get("kind") == "rate":
                sp = np.array([self._keyed(p, t) for t in self.tgrid])
                self.rate_cum[p["id"]] = np.concatenate([[0.0], np.cumsum((sp[1:] + sp[:-1]) / 2 * self.dt)])
        for m in S.get("models", []):
            self.models[m["id"]] = run_model(m, self)
        self.quant = []
        self._compile_quantities(S.get("quantities", []))
        self._memo = {}

    def _keyed(self, p, t):
        v = float(p.get("init", 0.0))
        for k in p.get("keys", []):
            t0, t1, target = float(k[0]), float(k[1]), float(k[2])
            if t >= t1:
                v = target
            elif t >= t0:
                f = (t - t0) / max(1e-6, t1 - t0)
                v = v + (target - v) * (f if p.get("ease") == "linear" else smooth01(f))
                break
            else:
                break
        return v

    def _compile_quantities(self, qs):
        import sympy as sp

        base = set(self.procs) | {"t"} | {o for m in self.models.values() for o in getattr(m, "outputs", [])}
        known = set(base)
        local = {"pi": sp.pi, "E": sp.E}
        pending = list(qs)
        for _ in range(len(qs) + 1):
            left = []
            for q in pending:
                try:
                    expr = sp.sympify(str(q.get("expr", "0")).replace("^", "**"), locals={**local, **{k: sp.Symbol(k) for k in known}})
                except Exception:  # noqa: BLE001
                    expr = sp.Float(0)
                names = {str(s) for s in expr.free_symbols}
                if names <= known:
                    args = sorted(names)
                    f = sp.lambdify([sp.Symbol(a) for a in args], expr, "math")
                    self.quant.append((q["id"], args, f))
                    known.add(q["id"])
                else:
                    left.append(q)
            pending = left
            if not pending:
                break
        for q in pending:  # unresolved names: constant 0 (gm_solve reports these before render)
            self.quant.append((q["id"], [], lambda: 0.0))

    def __call__(self, t: float) -> dict:
        t = float(min(max(t, 0.0), self.duration))
        key = round(t, 4)
        if key in self._memo:
            return self._memo[key]
        st = {"t": t}
        i = min(len(self.tgrid) - 2, int(t / self.dt))
        f = (t - self.tgrid[i]) / self.dt
        for pid, p in self.procs.items():
            if p.get("kind") == "rate":
                c = self.rate_cum[pid]
                st[pid] = float(c[i] + (c[i + 1] - c[i]) * f)
            else:
                st[pid] = self._keyed(p, t)
        for mid, m in self.models.items():
            st.update(m(t, st))
        for qid, args, fn in self.quant:
            try:
                st[qid] = float(fn(*[st[a] for a in args]))
            except Exception:  # noqa: BLE001
                st[qid] = 0.0
        if len(self._memo) > 4000:
            self._memo.clear()
        self._memo[key] = st
        return st


# ───────────── Numerical models (driven by a progress or by time) ─────────────
def hh_trace(duration_ms=12.0, stim_at=1.0, dt=0.01):
    """Hodgkin-Huxley (squid axon, 6.3 C) membrane potential after a brief suprathreshold current pulse.
    Returns t (ms), V (mV, rest shifted to -70), m, h, n, gNa, gK."""
    gna, gk, gl, ena, ek, el = 120.0, 36.0, 0.3, 50.0, -77.0, -54.4
    v = -65.0

    def rates(v):
        am = 0.1 * (v + 40) / (1 - math.exp(-(v + 40) / 10)) if abs(v + 40) > 1e-6 else 1.0
        bm = 4 * math.exp(-(v + 65) / 18)
        ah = 0.07 * math.exp(-(v + 65) / 20)
        bh = 1 / (1 + math.exp(-(v + 35) / 10))
        an = 0.01 * (v + 55) / (1 - math.exp(-(v + 55) / 10)) if abs(v + 55) > 1e-6 else 0.1
        bn = 0.125 * math.exp(-(v + 65) / 80)
        return am, bm, ah, bh, an, bn

    am, bm, ah, bh, an, bn = rates(v)
    m, h, n = am / (am + bm), ah / (ah + bh), an / (an + bn)
    out = []
    t = 0.0
    while t <= duration_ms:
        i_ext = 20.0 if stim_at <= t < stim_at + 1.0 else 0.0
        am, bm, ah, bh, an, bn = rates(v)
        ina = gna * m ** 3 * h * (v - ena)
        ik = gk * n ** 4 * (v - ek)
        il = gl * (v - el)
        v += dt * (i_ext - ina - ik - il)
        m += dt * (am * (1 - m) - bm * m)
        h += dt * (ah * (1 - h) - bh * h)
        n += dt * (an * (1 - n) - bn * n)
        out.append((t, v - 5.0, m, h, n, gna * m ** 3 * h, gk * n ** 4))  # -65 rest shifted to the textbook -70
        t += dt
    return np.array(out)


def run_model(m: dict, world: World):
    kind = m.get("kind")
    if kind == "hodgkin_huxley":
        arr = hh_trace(float(m.get("ms", 12.0)), float(m.get("stim_ms", 1.0)))
        tms = arr[:, 0]
        drv = m.get("driver")  # a progress 0..1 mapping onto the model's ms axis

        def f(t, st, arr=arr, tms=tms):
            p = st.get(drv, 0.0) if drv else 0.0
            ms = p * tms[-1]
            j = int(np.clip(np.searchsorted(tms, ms), 0, len(tms) - 1))
            r = arr[j]
            return {m["id"] + "_ms": float(ms), m["id"] + "_V": float(r[1]), m["id"] + "_m": float(r[2]), m["id"] + "_h": float(r[3]),
                    m["id"] + "_n": float(r[4]), m["id"] + "_gNa": float(r[5]), m["id"] + "_gK": float(r[6])}
        f.trace = arr
        f.outputs = [m["id"] + s for s in ("_ms", "_V", "_m", "_h", "_n", "_gNa", "_gK")]
        return f
    raise ValueError(f"unknown model {kind}")


# ───────────── Elements: what the scene shows, when, and how its box is measured ─────────────
class Ctx:
    def __init__(self, S, world, T):
        self.S, self.W, self.T = S, world, T
        self.els: list[dict] = []
        self.anchors: dict[str, object] = {}  # part id -> callable returning a point on the part (for labels)
        self.bodies: dict[str, object] = {}  # part id -> mobject (for checks and labels)
        self.checks: list[dict] = []  # deterministic proportion checks (declared vs drawn)
        self.issues: list[str] = []
        self.qcolor: dict[str, str] = {}
        self.zones: list = []
        self.graphs: dict = {}
        self.geom: dict = {}
        self.static_obstacles: list = []  # named live points / vectors of the solved geometry (annotations attach here)  # reserved areas (where live content will move) that labels must avoid

    def st(self):
        return self.W(self.T.get_value())

    def add(self, eid, mob, *, show=0.0, kind="body", how="create", part=None, hide=None, z=0, moving=False):
        mob.set_z_index(z)
        self.els.append({"id": eid, "mob": mob, "show": float(show), "kind": kind, "how": how, "part": part or eid, "hide": hide, "moving": moving})
        if kind == "body":
            self.bodies.setdefault(part or eid, mob)
        return mob

    def show_time(self, pid, default=0.0):
        return float((self.S.get("show") or {}).get(pid, default))

    def color_of(self, qid, fallback=INK):
        return self.qcolor.get(qid, fallback)


def live(fn):
    """A mobject rebuilt from World every frame (one source of truth)."""
    m = fn()
    m.add_updater(lambda mob: mob.become(fn()))
    return m


# ───────────── Generic part drawers ─────────────
def shaded_rect(x0, y0, x1, y1, color, *, stroke=INK, sw=2.0, op=1.0, vertical=False, r=0.0):
    w, h = abs(x1 - x0), abs(y1 - y0)
    if r > 0:
        m = RoundedRectangle(width=max(w, 1e-3), height=max(h, 1e-3), corner_radius=min(r, w / 2.01, h / 2.01))
    else:
        m = Rectangle(width=max(w, 1e-3), height=max(h, 1e-3))
    m.move_to([(x0 + x1) / 2, (y0 + y1) / 2, 0])
    m.set_fill([light(color, 0.35), color, dark(color, 0.12)], opacity=op)
    m.set_sheen_direction(UP if vertical else RIGHT)
    m.set_stroke(stroke, sw)
    return m


def poly(points, color, *, stroke=INK, sw=2.0, op=1.0, sheen=None):
    m = Polygon(*[np.array([p[0], p[1], 0.0]) for p in points])
    if sheen is not None:
        m.set_fill([light(color, 0.35), color], opacity=op)
        m.set_sheen_direction(sheen)
    else:
        m.set_fill(color, opacity=op)
    m.set_stroke(stroke, sw)
    return m


def smooth_closed(points, color=None, *, stroke=INK, sw=2.5, op=1.0):
    m = VMobject()
    pts = [np.array([p[0], p[1], 0.0]) for p in points]
    m.set_points_smoothly(pts + [pts[0]])
    if color:
        m.set_fill(color, opacity=op)
    m.set_stroke(stroke, sw)
    return m


def gear_points(cx, cy, teeth, module, angle=0.0, inner=False):
    """Spur gear outline with involute-like flanks (sampled), pitch radius = teeth*module/2."""
    rp = teeth * module / 2
    ra, rd = rp + module, rp - 1.25 * module
    if inner:
        ra, rd = rp - module, rp + 1.25 * module
    pts = []
    pitch = TAU / teeth
    for i in range(teeth):
        a0 = angle + i * pitch
        # tooth: root -> flank -> tip -> flank -> root (tooth thickness half the pitch at the pitch circle)
        prof = [(-0.5, rd), (-0.27, rd), (-0.2, rp), (-0.13, ra), (0.13, ra), (0.2, rp), (0.27, rd), (0.5, rd)]
        for fa, r in prof:
            a = a0 + fa * pitch
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def gear_mob(cx, cy, teeth, module, angle, color, *, spokes=5, hub=0.22):
    rp = teeth * module / 2
    body = poly(gear_points(cx, cy, teeth, module, angle), color, sw=1.8)
    body.set_fill([light(color, 0.45), color, dark(color, 0.15)], opacity=1)
    body.set_sheen_direction(UP + RIGHT)
    grp = VGroup(body)
    rim = Circle(radius=rp - 1.6 * module).move_to([cx, cy, 0]).set_stroke(dark(color, 0.35), 1.2).set_fill(opacity=0)
    grp.add(rim)
    if rp > 0.5 and spokes:
        rin = rp - 1.6 * module
        for k in range(spokes):
            a = angle + k * TAU / spokes
            # lightening holes between spokes (a real cast gear)
            hc = (cx + 0.58 * rin * math.cos(a + PI / spokes), cy + 0.58 * rin * math.sin(a + PI / spokes))
            hole = Circle(radius=0.22 * rin).move_to([hc[0], hc[1], 0]).set_fill(BG, 1).set_stroke(dark(color, 0.35), 1.2)
            grp.add(hole)
    h = Circle(radius=max(0.06, hub * rp)).move_to([cx, cy, 0]).set_fill(dark(color, 0.25), 1).set_stroke(INK, 1.5)
    grp.add(h)
    key = Line([cx, cy, 0], [cx + hub * rp * math.cos(angle), cy + hub * rp * math.sin(angle), 0]).set_stroke(light(color, 0.5), 2)
    grp.add(key)
    return grp


def arrow(a, b, color=INK, sw=5, tip=0.2):
    a, b = np.array([a[0], a[1], 0.0]), np.array([b[0], b[1], 0.0])
    if np.linalg.norm(b - a) < 1e-3:
        b = a + np.array([0, 1e-3, 0])
    return Arrow(a, b, buff=0, stroke_width=sw, color=color, max_tip_length_to_length_ratio=0.4, tip_length=tip, max_stroke_width_to_length_ratio=20)


def readout(ctx, qid, label_tex, unit, decimals=0, size=34, color=None):
    """'F_2 = 1000 N' bound to World: the number is the quantity's value at this frame."""
    c = color or ctx.color_of(qid)
    lab = MathTex(label_tex + "=", font_size=size, color=c)
    num = DecimalNumber(0, num_decimal_places=decimals, font_size=size, color=c, group_with_commas=False)
    u = MathTex(r"\,\mathrm{" + unit + "}", font_size=size, color=c) if unit else VGroup()

    def upd(g):
        v = ctx.st().get(qid, 0.0)
        num.set_value(round(v, decimals) if decimals else round(v))
        num.next_to(lab, RIGHT, buff=0.12)
        if unit:
            u.next_to(num, RIGHT, buff=0.08)
            u.align_to(num, DOWN)
    g = VGroup(lab, num, u)
    upd(g)
    g.add_updater(upd)
    return g


def molecule_mob(mol: dict, scale=0.32, center=(0, 0), angle=0.0):
    """Ball-and-stick from 2D coordinates (RDKit / PubChem via gm_refdata, or the built-in table)."""
    atoms, bonds = mol["atoms"], mol["bonds"]
    xy = np.array([[a[1], a[2]] for a in atoms], dtype=float)
    if len(xy):
        xy = xy - xy.mean(axis=0)
    ca, sa = math.cos(angle), math.sin(angle)
    xy = xy @ np.array([[ca, sa], [-sa, ca]]) * scale + np.array(center)
    g = VGroup()
    for b in bonds:
        i, j, order = b[0], b[1], b[2] if len(b) > 2 else 1
        p, q = xy[i], xy[j]
        d = q - p
        nrm = np.array([-d[1], d[0]]) / (np.linalg.norm(d) + 1e-9) * 0.045
        offs = [0] if order == 1 else ([-1, 1] if order == 2 else [-1.6, 0, 1.6])
        for o in offs:
            g.add(Line([*(p + o * nrm), 0], [*(q + o * nrm), 0]).set_stroke(INK, 2.2))
    for (el, _, _), p in zip(atoms, xy):
        r = scale * 0.42 * ATOM_R.get(el, 0.8)
        c = ATOM.get(el, "#9A9A9A")
        d = Circle(radius=r).move_to([p[0], p[1], 0]).set_fill([light(c, 0.55), c], opacity=1).set_stroke(INK, 1.3)
        d.set_sheen_direction(UP + LEFT)
        g.add(d)
    return g


# ───────────── Label placement (deterministic, collision-free) ─────────────
def place_labels(ctx: Ctx, labels: list[dict], obstacles: list):
    """labels: [{id, text, part, show}]; each label tries 16 spots around its anchor and takes the one that
    overlaps no body, no other label and stays in frame; a thin leader line joins it to the part."""
    placed = []
    obs = [b for b in obstacles]
    lim = Box(-FW / 2 + 0.15, -FH / 2 + 0.15, FW / 2 - 0.15, FH / 2 - 0.15)
    for L in labels:
        anc = ctx.anchors.get(L["part"])
        if anc is None:
            continue
        follow = callable(anc)
        t_keep = ctx.T.get_value()
        ctx.T.set_value(float(L.get("show", 0.0)) + 0.9)  # place the label where the part is when the label appears
        p = np.array(anc() if follow else anc, dtype=float)
        ctx.T.set_value(t_keep)
        t = label_text(L["text"], size=L.get("size", 24), color=L.get("color", INK))
        w, h = t.width + 0.16, t.height + 0.12
        best, bscore = None, 1e9
        for rad in (0.7, 1.1, 1.6, 2.2):
            for k in range(16):
                a = k * TAU / 16
                c = p + rad * np.array([math.cos(a) * 1.35, math.sin(a), 0])
                b = (c[0] - w / 2, c[1] - h / 2, c[0] + w / 2, c[1] + h / 2)
                if b[0] < lim.x0 or b[2] > lim.x1 or b[1] < lim.y0 or b[3] > lim.y1:
                    continue
                mid = (c + p) / 2
                cross = sum(1 for o in obs if o[0] < mid[0] < o[2] and o[1] < mid[1] < o[3] and not (o[0] < p[0] < o[2] and o[1] < p[1] < o[3]))
                score = sum(_ov_area(b, o) for o in obs) * 50 + sum(_ov_area(b, q) for q in placed) * 200 + rad * 0.6 + cross * 0.4
                if score < bscore:
                    best, bscore = (c, b), score
            if bscore < 1.5:
                break
        if best is None:
            continue
        c, b = best
        t.move_to(c)
        placed.append(b)
        bg = RoundedRectangle(width=w, height=h, corner_radius=0.06).move_to(c).set_fill(BG, 0.85).set_stroke(width=0)
        edge = _edge_point(b, p)
        lead = Line(edge, p).set_stroke(MUTED, 1.6) if np.linalg.norm(edge - p) > 0.15 else VGroup()
        dot = Dot(p, radius=0.035, color=MUTED) if np.linalg.norm(edge - p) > 0.15 else VGroup()
        g = VGroup(lead, dot, bg, t)
        if follow:  # a moving part: the label rides along at the same offset, no leader
            off = c - p
            g = VGroup(bg, t)

            def ride(m, anc=anc, off=off):
                m.move_to(np.array(anc(), dtype=float) + off)
                keep_in_frame(m)
            g.add_updater(ride)
        ctx.add("label:" + L["id"], g, show=L.get("show", 0.0), kind="label", how="fade", part=L["part"], z=20, hide=L.get("hide"))
        if bscore >= 50:
            ctx.issues.append(f"label {L['id']} could not avoid every shape")
    return placed


def keep_in_frame(m, margin=0.12):
    """shift a text mobject back inside the frame (labels are protected: moved, never dropped)"""
    b = bbox(m)
    if not b:
        return m
    dx = max(0.0, (-FW / 2 + margin) - b[0]) - max(0.0, b[2] - (FW / 2 - margin))
    dy = max(0.0, (-FH / 2 + margin) - b[1]) - max(0.0, b[3] - (FH / 2 - margin))
    if dx or dy:
        m.shift(np.array([dx, dy, 0.0]))
    return m


def _ov_area(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    return max(0.0, w) * max(0.0, h)


def _edge_point(b, p):
    cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    x = min(max(p[0], b[0]), b[2])
    y = min(max(p[1], b[1]), b[3])
    if b[0] < p[0] < b[2] and b[1] < p[1] < b[3]:
        return np.array([cx, cy, 0.0])
    return np.array([x, y, 0.0])


def bbox(m):
    try:
        if len(m.get_family()) == 0:
            return None
        pts = np.concatenate([x.points for x in m.get_family() if len(x.points)]) if any(len(x.points) for x in m.get_family()) else None
        if pts is None or not len(pts):
            return None
        return [float(pts[:, 0].min()), float(pts[:, 1].min()), float(pts[:, 0].max()), float(pts[:, 1].max())]
    except Exception:  # noqa: BLE001
        return None


# ───────────── Scene assembly ─────────────
def assemble(S: dict, T: ValueTracker):
    import importlib

    import gm_rigs

    set_theme(S.get("mode", "whiteboard"))
    gm_rigs = importlib.reload(gm_rigs)  # rebinds the theme colours it imported
    W = World(S)
    ctx = Ctx(S, W, T)
    if THEME["mode"] == "real":  # contextual backdrop: dark gradient with a soft light from the upper left
        bgm = Rectangle(width=FW + 0.2, height=FH + 0.2).set_fill([THEME["bg2"], THEME["bg"]], opacity=1).set_stroke(width=0)
        bgm.set_sheen_direction(DOWN + RIGHT)
        glow = VGroup(*[Circle(radius=r).move_to([-3.5, 2.2, 0]).set_fill("#FFFFFF", 0.012).set_stroke(width=0) for r in np.linspace(1.0, 7.0, 10)])
        ctx.add("backdrop", VGroup(bgm, glow), show=0.0, kind="backdrop", how="none", z=-100)
    for i, q in enumerate(S.get("quantities", [])):
        ctx.qcolor[q["id"]] = Q.get(q.get("color") or QORDER[i % len(QORDER)], Q[QORDER[i % len(QORDER)]])
    for rig in S.get("rigs", []):
        gm_rigs.build(ctx, rig)
    # panels: readouts, graphs, equations
    gm_rigs.panels(ctx)
    ctx.static_obstacles = []  # leaf boxes of the drawn bodies at t=0: annotation text keeps off them
    for e in ctx.els:
        if e["kind"] in ("body", "panel"):
            for x in [x for x in e["mob"].get_family() if len(x.points) and not x.submobjects][:400]:
                b = bbox(x)
                if b and (b[2] - b[0]) * (b[3] - b[1]) > 0.0005:
                    ctx.static_obstacles.append(b)
    gm_rigs.annotations(ctx)
    obstacles = []
    for e in ctx.els:
        if e["kind"] in ("body", "panel", "overlay", "annot"):
            leaves = [x for x in e["mob"].get_family() if len(x.points) and not x.submobjects]
            if e["kind"] == "panel" or len(leaves) > 300:
                leaves = [e["mob"]]
            for x in leaves:
                b = bbox(x)
                if b and (b[2] - b[0]) * (b[3] - b[1]) > 0.002:
                    obstacles.append(b)
    obstacles += [list(z) for z in ctx.zones]
    place_labels(ctx, S.get("labels", []), obstacles)
    return ctx


class PartScene(MovingCameraScene):
    SCENE: dict = {}

    def construct(self):
        S = self.SCENE
        self.camera.background_color = BG
        T = ValueTracker(0.0)
        self.add(T)
        ctx = assemble(S, T)
        D = ctx.W.duration
        # segments between every show / hide / focus moment; T advances linearly through each
        INTRO = 0.9
        events = {0.0, D}
        for e in ctx.els:
            s = min(max(0.0, e["show"]), D - 0.3)
            e["show"] = s
            events.add(s)
            events.add(min(D, s + INTRO))
            if e.get("hide") is not None:
                events.add(min(D, float(e["hide"])))
                events.add(min(D, float(e["hide"]) + 0.6))
        focus = [(float(f["t"]), f["part"]) for f in S.get("focus", []) if f.get("part") in ctx.bodies]
        for t, _ in focus:
            events.add(min(D, t))
            events.add(min(D, t + 1.0))
        ev = sorted(x for x in events if 0 <= x <= D)
        segs = [(a, b) for a, b in zip(ev, ev[1:]) if b - a > 1e-3]
        shown, hidden = set(), set()
        for e in ctx.els:  # the backdrop is there from the first frame, everything else is drawn in
            if e["how"] == "none":
                self.add(e["mob"])
                shown.add(id(e))
        pen = {"covered": [], "missing": []}
        for a, b in segs:
            anims = []
            for i, e in enumerate(ctx.els):
                if id(e) in shown:
                    if e.get("hide") is not None and abs(float(e["hide"]) - a) < 1e-3 and id(e) not in hidden:
                        anims.append(FadeOut(e["mob"]))
                        hidden.add(id(e))
                    continue
                if abs(e["show"] - a) < 1e-3:
                    shown.add(id(e))
                    has_pts = any(len(x.points) for x in e["mob"].get_family())
                    annot = e["kind"] in ("label", "panel", "overlay", "annot")
                    # the hand draws every stroke and writes every text; only empty live groups (motion) fade in
                    if not has_pts:
                        anims.append(FadeIn(e["mob"]))
                        if annot:
                            pen["missing"].append(e["id"] + " (empty at its first frame)")
                    elif e["how"] == "write" or e["kind"] in ("label", "panel"):
                        anims.append(Write(e["mob"]))
                        pen["covered"].append(e["id"]) if annot else None
                    else:
                        anims.append(Create(e["mob"], lag_ratio=0.02))
                        pen["covered"].append(e["id"]) if annot else None
            for t, pid in focus:
                if abs(t - a) < 1e-3:
                    lab = next((e for e in ctx.els if e["kind"] == "label" and e["part"] == pid and id(e) in shown), None)
                    if lab is not None:
                        tx = lab["mob"][-1]
                        ul = Line(tx.get_corner(DOWN + LEFT) + DOWN * 0.06, tx.get_corner(DOWN + RIGHT) + DOWN * 0.06).set_stroke(Q["amber"], 4)
                        anims.append(Succession(Create(ul, run_time=0.6), FadeOut(ul, run_time=0.4)))
                    else:
                        anims.append(Circumscribe(ctx.bodies[pid], color=Q["amber"], buff=0.08, stroke_width=2.5, fade_out=True))
            dur = b - a
            self.play(T.animate.set_value(b), *anims, run_time=dur, rate_func=linear)
        gate = os.environ.get("GM_GATE_PATH")
        if gate:
            with open(gate, "w") as f:
                json.dump({"duration": D, "issues": ctx.issues, "checks": ctx.checks, "pen": pen, "mode": THEME["mode"]}, f)


def analyze(S: dict, step=0.25) -> dict:
    """Partial execution without rendering: build every element, step World through time, measure boxes.
    Returns per-time element boxes, per-part motion, and the declared-vs-drawn proportion checks."""
    md = os.environ.get("GM_MEDIA") or os.path.join(os.environ.get("TMPDIR", "/tmp"), "gm-media")
    os.makedirs(os.path.join(md, "Tex"), exist_ok=True)
    os.makedirs(os.path.join(md, "texts"), exist_ok=True)
    config.media_dir = md
    T = ValueTracker(0.0)
    ctx = assemble(S, T)
    D = ctx.W.duration
    frames = []
    prev = {}
    motion = {}
    times = list(np.arange(0, D + 1e-6, step))
    for t in times:
        T.set_value(t)
        items = []
        for e in ctx.els:
            m = e["mob"]
            for mm in m.get_family():
                for u in mm.get_updaters() if hasattr(mm, "get_updaters") else []:
                    try:
                        u(mm)
                    except TypeError:
                        u(mm, 0)
            vis = e["show"] <= t + 1e-6 and (e.get("hide") is None or t < float(e["hide"]))
            b = bbox(m)
            if vis and b:
                items.append({"id": e["id"], "kind": e["kind"], "part": e["part"], "b": [round(x, 3) for x in b]})
            if e["kind"] == "body" and vis:
                pts = np.concatenate([x.points for x in m.get_family() if len(x.points)]) if any(len(x.points) for x in m.get_family()) else np.zeros((0, 3))
                key = e["id"]
                if key in prev and prev[key].shape == pts.shape and len(pts):
                    d = float(np.abs(prev[key] - pts).max())
                else:
                    d = 0.0 if key in prev else None
                prev[key] = pts.copy()
                if d is not None:
                    motion.setdefault(key, []).append((round(t, 3), round(d, 4)))
        frames.append({"t": round(t, 3), "items": items})
    st = [ctx.W(t) for t in times]
    return {"duration": D, "frames": frames, "motion": motion, "checks": ctx.checks, "issues": ctx.issues, "world": st, "times": times}


def scene_code(S: dict) -> str:
    return ("from manim import *\nfrom gm_parts import PartScene\n\nSCENE = r'''" + json.dumps(S, separators=(",", ":")).replace("'''", "") +
            "'''\n\n\nclass GeneratedScene(PartScene):\n    import json as _j\n    SCENE = _j.loads(SCENE)\n")

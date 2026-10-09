"""gm_world: the open scene language for generated teaching animations, and its deterministic solvers (no Manim here).

The model never computes a coordinate or a number. It writes a small JSON scene (the IR):

  vars         named quantities as sympy expressions ("theta2": "asin(n1*sin(theta1)/n2)"); every derived number comes from here
  objects      a general vocabulary: point, segment, line, ray, polyline, polygon, circle, arc, angle, brace, vector, axes,
               function, curve, area, box, icon, cells, pointer, flow, wire, battery/resistor/bulb/switch/meter, label,
               equation, readout, group
  constraints  relations the solver satisfies: distance, equal_length, perpendicular, parallel, angle, direction, polar, on,
               midpoint, collinear, horizontal, vertical, same_x, same_y, tangent, intersection, ccw/cw, area, inside,
               left_of/right_of/above/below, aligned, row, column, ring, near, apart
  checks       claims verified numerically in every state the animation passes through ("eq", "lt", "true", "balanced")
  beats        narration + actions (show, hide, highlight, color, animate a var, set vars, morph, trace, flow, equation step,
               note, wait, glue)

World(ir) expands macros, validates references, evaluates vars with sympy, solves positions (Levenberg-Marquardt on the
constraint residuals, several starts, min-norm polish), verifies every hard constraint and check in every state the beats
reach, and fits the result into the frame's stage. Problems come back as plain sentences the planner can act on.
"""
from __future__ import annotations

import copy
import math
import re

import numpy as np
import sympy as sp

# ───────────────────────── vocabulary ─────────────────────────
GEOM = {"point", "segment", "line", "ray", "polyline", "polygon", "circle", "arc", "angle", "brace", "vector", "curve", "wire",
        "battery", "resistor", "bulb", "switch", "meter", "capacitor", "spring"}
BLOCKS = {"box", "icon", "cells", "axes", "text"}  # objects with a size and a centre the layout solver places
ON_AXES = {"function", "area"}
PANEL = {"equation", "readout"}
OTHER = {"label", "pointer", "flow", "group"}
TYPES = GEOM | BLOCKS | ON_AXES | PANEL | OTHER
TWO_TERMINAL = {"battery", "resistor", "bulb", "switch", "meter", "capacitor", "spring"}
ICONS = {"sun", "cloud", "rain", "drop", "mountain", "sea", "lake", "leaf", "tree", "plant", "cell", "ball", "house", "factory",
         "person", "earth", "flask", "magnet", "bolt", "fire", "snowflake", "gear", "eye", "lamp", "atom", "molecule", "arrow"}

HARD = {"fix", "offset", "distance", "equal_length", "perpendicular", "parallel", "angle", "direction", "polar", "on", "midpoint", "collinear",
        "horizontal", "vertical", "same_x", "same_y", "tangent", "intersection", "ccw", "cw", "area", "length_ratio", "equal_angle",
        "opposite_sides", "same_side"}
SOFT = {"left_of", "right_of", "above", "below", "aligned", "row", "column", "ring", "near", "apart", "inside", "gap"}
ACTIONS = {"show", "hide", "highlight", "color", "animate", "set", "morph", "trace", "untrace", "flow", "equation", "note", "wait",
           "glue", "move", "focus", "count"}

ROLES = {"ink", "muted", "a", "b", "c", "d", "accent", "highlight", "good", "bad", "water", "light", "warm", "cool"}

STAGE_HINT = (9.0, 5.4)  # nominal world size of the main stage (16:9); geometry is scaled to fit anyway


class IRError(Exception):
    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems[:6]))
        self.problems = problems


# ───────────────────────── expressions ─────────────────────────
_FUNCS = {n: getattr(sp, n) for n in ("sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sqrt", "exp", "log", "floor", "ceiling",
                                       "Abs", "Min", "Max", "pi", "E", "sinh", "cosh", "tanh", "Rational", "sign", "factorial", "binomial")}
_FUNCS.update(deg=sp.pi / 180, ceil=sp.ceiling, abs=sp.Abs, min=sp.Min, max=sp.Max, ln=sp.log, mod=sp.Mod, Mod=sp.Mod, e=sp.E, oo=sp.oo,
              round=lambda x, n=0: sp.Float(round(float(x), int(n))), Piecewise=sp.Piecewise, idiv=lambda a, b: sp.floor(a / b))


_UNSAFE = re.compile(r"__|\blambda\b|\bimport\b|\bexec\b|\beval\b|\bopen\b|\.\s*[A-Za-z_]|['\"\[\]{};:@`\\$#&|~]")


def safe_expr(s: str) -> str:
    """IR expressions are parsed by sympy / evaluated with Python: only maths may pass (no attributes, strings, dunders)."""
    s = str(s)
    if len(s) > 300 or _UNSAFE.search(s):
        raise ValueError(f"expression {s[:60]!r} is not plain maths")
    return s


def _clean(s: str) -> str:
    s = safe_expr(s).strip().replace("^", "**").replace("−", "-").replace("×", "*").replace("·", "*").replace("√", "sqrt").replace("π", "pi")
    s = re.sub(r"(\d+(?:\.\d+)?)\s*°", r"(\1*deg)", s)
    return s


def sym(expr, names: dict | None = None):
    """Parse an IR expression (number or string) to sympy. Unknown names become symbols."""
    if isinstance(expr, bool):
        return sp.Integer(int(expr))
    if isinstance(expr, (int, float)):
        return sp.nsimplify(expr) if isinstance(expr, int) or float(expr).is_integer() else sp.Float(expr)
    if isinstance(expr, sp.Basic):
        return expr
    from sympy.parsing.sympy_parser import implicit_multiplication_application, parse_expr, standard_transformations
    loc = dict(_FUNCS)
    if names:
        loc.update(names)
    try:
        return parse_expr(_clean(expr), local_dict=loc, transformations=standard_transformations)
    except Exception:  # noqa: BLE001
        try:
            return parse_expr(_clean(expr), local_dict=loc, transformations=standard_transformations + (implicit_multiplication_application,))
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"cannot read the expression {expr!r}: {type(exc).__name__}") from None


_EVAL_CACHE: dict = {}


class Vars:
    """Named quantities. Declared formulas are kept; set/animate override a var with a value and dependants recompute."""

    def __init__(self, decl: dict):
        self.decl = {}
        self.order: list[str] = []
        self.problems: list[str] = []
        self.symbols = {k: sp.Symbol(k) for k in decl}
        for k, v in decl.items():
            if not re.match(r"^[A-Za-z_][A-Za-z_0-9]*$", str(k)):
                self.problems.append(f"var name {k!r} must be a plain identifier")
                continue
            try:
                self.decl[k] = sym(v, {n: s for n, s in self.symbols.items()})
            except ValueError as exc:
                self.problems.append(f"var {k}: {exc}")
        # dependency order (formulas may reference vars declared later)
        seen, temp = set(), set()

        def visit(k):
            if k in seen or k not in self.decl:
                return
            if k in temp:
                self.problems.append(f"var {k} depends on itself")
                return
            temp.add(k)
            for s in self.decl[k].free_symbols:
                if s.name in self.decl:
                    visit(s.name)
            temp.discard(k)
            seen.add(k)
            self.order.append(k)

        for k in self.decl:
            visit(k)
        self.overrides: dict = {}
        self._fns = {}
        for k in self.order:
            e = self.decl[k]
            args = sorted((s.name for s in e.free_symbols if s.name in self.decl), key=self.order.index) if e.free_symbols else []
            try:
                self._fns[k] = (args, sp.lambdify([sp.Symbol(a) for a in args], e, modules=["math", {"floor": math.floor, "ceiling": math.ceil}]))
            except Exception:  # noqa: BLE001
                self._fns[k] = (args, None)
        for k in self.order:
            free = [s.name for s in self.decl[k].free_symbols if s.name not in self.decl]
            if free:
                self.problems.append(f"var {k} uses undefined name(s) {', '.join(free)}")

    def exact(self, name: str, overrides: dict | None = None):
        """Exact sympy value of a var (formulas substituted all the way down)."""
        ov = {**self.overrides, **(overrides or {})}
        if name in ov:
            return sym(ov[name])
        e = self.decl[name]
        subs = {s: self.exact(s.name, overrides) for s in e.free_symbols if s.name in self.decl}
        return e.subs(subs) if subs else e

    def values(self, overrides: dict | None = None) -> dict:
        ov = {**self.overrides, **(overrides or {})}
        out: dict = {}
        for k in self.order:
            if k in ov:
                out[k] = float(ov[k]) if not isinstance(ov[k], str) else self.eval(ov[k], out)
                continue
            args, fn = self._fns[k]
            try:
                v = fn(*[out[a] for a in args]) if fn else float(self.decl[k].subs({sp.Symbol(a): out[a] for a in args}).evalf())
                out[k] = float(v)
            except Exception:  # noqa: BLE001
                try:
                    out[k] = float(sp.N(self.decl[k].subs({sp.Symbol(a): out[a] for a in args})))
                except Exception:  # noqa: BLE001
                    out[k] = float("nan")
        return out

    def eval(self, expr, vals: dict, extra: dict | None = None) -> float:
        if isinstance(expr, (int, float)) and not isinstance(expr, bool):
            return float(expr)
        if isinstance(expr, str) and re.fullmatch(r"\s*-?\d+(\.\d*)?\s*", expr):
            return float(expr)
        if isinstance(expr, str) and expr in vals:
            return float(vals[expr])
        key = (str(expr), tuple(vals))
        hit = _EVAL_CACHE.get(key)
        if hit is None and not extra:
            names = {k: sp.Symbol(k) for k in vals}
            e = sym(expr, names)
            args = sorted(s.name for s in e.free_symbols)
            unknown = [a for a in args if a not in vals]
            if unknown:
                raise ValueError(f"{expr!r} uses undefined name(s) {', '.join(unknown)}")
            fn = sp.lambdify([sp.Symbol(a) for a in args], e, modules=["math", {"floor": math.floor, "ceiling": math.ceil}])
            hit = _EVAL_CACHE[key] = (args, fn, e)
        if hit is not None:
            args, fn, e = hit
            try:
                return float(fn(*[vals[a] for a in args]))
            except Exception:  # noqa: BLE001
                return float(sp.N(e.subs({sp.Symbol(a): vals[a] for a in args})))
        names = {k: sp.Symbol(k) for k in vals}
        e = sym(expr, {**names, **(extra or {})})
        v = e.subs({sp.Symbol(k): x for k, x in vals.items()})
        return float(sp.N(v))


# ───────────────────────── chemistry ─────────────────────────
def _formula_atoms(f: str) -> dict:
    """Atom counts of a formula like C6H12O6, Ca(OH)2 (no charges)."""
    tokens = re.findall(r"([A-Z][a-z]?|\(|\)|\d+)", f)
    stack = [{}]
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t == "(":
            stack.append({})
        elif t == ")":
            g = stack.pop()
            n = int(tokens[i + 1]) if i + 1 < len(tokens) and tokens[i + 1].isdigit() else 1
            if n != 1 or (i + 1 < len(tokens) and tokens[i + 1].isdigit()):
                i += 1 if (i + 1 < len(tokens) and tokens[i + 1].isdigit()) else 0
            for k, v in g.items():
                stack[-1][k] = stack[-1].get(k, 0) + v * n
        elif t.isdigit():
            pass
        else:
            n = int(tokens[i + 1]) if i + 1 < len(tokens) and tokens[i + 1].isdigit() else 1
            stack[-1][t] = stack[-1].get(t, 0) + n
        i += 1
    return stack[0]


def chem_sides(eq: str):
    eq = eq.replace("→", "->").replace("⟶", "->").replace("=", "->")
    if "->" not in eq:
        raise ValueError("a chemical equation needs ->")
    l, r = eq.split("->", 1)

    def side(s):
        out = []
        for term in [t.strip() for t in s.split("+") if t.strip()]:
            term = re.sub(r"\((aq|s|l|g)\)", "", term).strip()
            m = re.match(r"^(\d*)\s*(.+)$", term)
            out.append((int(m.group(1) or 1), m.group(2).strip()))
        return out
    return side(l), side(r)


def chem_balance_problem(eq: str) -> str | None:
    try:
        L, R = chem_sides(eq)
    except ValueError as exc:
        return str(exc)
    tot = lambda side: {k: sum(c * _formula_atoms(f).get(k, 0) for c, f in side) for k in {a for _, f in side for a in _formula_atoms(f)}}  # noqa: E731
    a, b = tot(L), tot(R)
    bad = [f"{k}: {a.get(k, 0)} left vs {b.get(k, 0)} right" for k in sorted(set(a) | set(b)) if a.get(k, 0) != b.get(k, 0)]
    return ("not balanced (" + "; ".join(bad) + ")") if bad else None


def chem_tex(eq: str) -> str:
    L, R = chem_sides(eq)

    def f(c, s):
        body = re.sub(r"(?<=[A-Za-z\)])(\d+)", r"_{\1}", s)
        return (str(c) if c != 1 else "") + r"\mathrm{" + body + "}"
    return " + ".join(f(c, s) for c, s in L) + r" \;\longrightarrow\; " + " + ".join(f(c, s) for c, s in R)


# ───────────────────────── equations ─────────────────────────
def eq_parse(s: str, names: dict):
    """'3*(y-5)=12' -> (lhs, rhs) sympy, unevaluated for display, evaluated for checking."""
    s = _clean(s).replace("==", "=")
    from sympy.parsing.sympy_parser import parse_expr, standard_transformations
    loc = dict(_FUNCS)
    loc.update(names)
    parts = s.split("=")
    if len(parts) > 2:
        raise ValueError(f"{s!r} has more than one '='")
    exprs = [parse_expr(p, local_dict=loc, transformations=standard_transformations) for p in parts]
    disp = [parse_expr(p, local_dict=loc, transformations=standard_transformations, evaluate=False) for p in parts]
    return exprs, disp


def eq_tex(disp) -> str:
    return " = ".join(sp.latex(d, mul_symbol=None) for d in disp)


# ───────────────────────── macros (optional accelerators) ─────────────────────────
def _mac_right_triangle(o):
    # right_triangle {id, legs:[a,b]} -> points id.A (right angle), id.B, id.C, polygon id, A-B = a horizontal, A-C = b vertical
    i = o["id"]
    a, b = (o.get("legs") or [3, 4])[:2]
    objs = [{"type": "point", "id": f"{i}.A"}, {"type": "point", "id": f"{i}.B"}, {"type": "point", "id": f"{i}.C"},
            {"type": "polygon", "id": i, "points": [f"{i}.A", f"{i}.B", f"{i}.C"], "color": o.get("color", "a"), "fill": o.get("fill", 0.25)}]
    cons = [["distance", f"{i}.A", f"{i}.B", a], ["distance", f"{i}.A", f"{i}.C", b], ["perpendicular", f"{i}.A-{i}.B", f"{i}.A-{i}.C"],
            ["ccw", f"{i}.A", f"{i}.B", f"{i}.C"]]
    if o.get("upright", True):
        cons.append(["horizontal", f"{i}.A", f"{i}.B"])
    return objs, cons


def _mac_square_on(o):
    # square_on {id, side:[P,Q], away: R}  -> square P,Q,id.2,id.1 built outward (on the side of PQ away from point R)
    i = o["id"]
    p, q = o["side"][:2]
    objs = [{"type": "point", "id": f"{i}.1"}, {"type": "point", "id": f"{i}.2"},
            {"type": "polygon", "id": i, "points": [p, q, f"{i}.2", f"{i}.1"], "color": o.get("color", "b"), "fill": o.get("fill", 0.2)}]
    cons = [["perpendicular", f"{p}-{q}", f"{q}-{i}.2"], ["equal_length", f"{p}-{q}", f"{q}-{i}.2"],
            ["perpendicular", f"{q}-{p}", f"{p}-{i}.1"], ["equal_length", f"{p}-{q}", f"{p}-{i}.1"]]
    if o.get("away"):
        cons.append(["opposite_sides", f"{i}.1", o["away"], f"{p}-{q}"])
        cons.append(["opposite_sides", f"{i}.2", o["away"], f"{p}-{q}"])
    return objs, cons


def _mac_regular_polygon(o):
    # regular_polygon {id, n, center: C, radius: r, rotation} -> points id.0..id.n-1 (polar about the centre)
    i, n = o["id"], int(o.get("n", 6))
    c = o.get("center") or f"{i}.O"
    objs = [] if o.get("center") else [{"type": "point", "id": c}]
    objs += [{"type": "point", "id": f"{i}.{k}"} for k in range(n)]
    objs.append({"type": "polygon", "id": i, "points": [f"{i}.{k}" for k in range(n)], "color": o.get("color", "a"), "fill": o.get("fill", 0.15)})
    rot = o.get("rotation", "pi/2")
    cons = [["polar", f"{i}.{k}", c, o.get("radius", 1.5), f"({rot}) + 2*pi*{k}/{n}"] for k in range(n)]
    return objs, cons


def _mac_balance(o):
    # balance {id, left: tex or [tex per step], right: same, tilt: expr(rad)} -> a beam on a stand with two pans holding boxes id.L/id.R
    i = o["id"]
    objs = [{"type": "point", "id": f"{i}.P"}, {"type": "point", "id": f"{i}.base"}, {"type": "point", "id": f"{i}.l"}, {"type": "point", "id": f"{i}.r"},
            {"type": "polygon", "id": f"{i}.stand", "points": [f"{i}.P", f"{i}.base"], "color": "muted"},
            {"type": "segment", "id": f"{i}.beam", "from": f"{i}.l", "to": f"{i}.r", "color": "ink", "width": 6},
            {"type": "segment", "id": f"{i}.post", "from": f"{i}.base", "to": f"{i}.P", "color": "muted", "width": 6}]
    objs = [x for x in objs if x["id"] != f"{i}.stand"]
    objs += [{"type": "point", "id": f"{i}.f1"}, {"type": "point", "id": f"{i}.f2"},
             {"type": "polygon", "id": f"{i}.foot", "points": [f"{i}.base", f"{i}.f1", f"{i}.f2"], "color": "muted", "fill": 0.35}]
    half = o.get("half", 2.6)
    cons = [["vertical", f"{i}.base", f"{i}.P"], ["distance", f"{i}.base", f"{i}.P", 2.0], ["above", f"{i}.P", f"{i}.base"],
            ["offset", f"{i}.f1", f"{i}.base", -0.6, -0.5], ["offset", f"{i}.f2", f"{i}.base", 0.6, -0.5],
            ["polar", f"{i}.l", f"{i}.P", half, f"pi + ({o.get('tilt', 0)})"], ["polar", f"{i}.r", f"{i}.P", half, f"{o.get('tilt', 0)}"]]
    for side, pt in (("left", "l"), ("right", "r")):
        v = o.get(side)
        if v is None:
            continue
        bid = f"{i}.{side[0].upper()}"
        box = {"type": "box", "id": bid, "color": o.get("color", "a")}
        box.update({"tex": v} if isinstance(v, list) else {"tex": v} if isinstance(v, str) and ("\\" in v or "^" in v or "=" not in v and re.search(r"[0-9a-z]\s*[\+\-\*/]", v)) else {"text": str(v)})
        objs.append(box)
        cons += [["same_x", bid, f"{i}.{pt}"], ["above", bid, f"{i}.{pt}", 0.05], ["near", bid, f"{i}.{pt}", 0.9]]
    return objs, cons


def _mac_circuit(o):
    # circuit {id, width?, height?, parts: [{type: battery|resistor|bulb|switch|meter|capacitor, side: left|top|right|bottom, id?, label?}]}
    # -> a rectangular loop: corners id.c0..c3 (bottom-left, counter-clockwise), each part centred on its side with wires to the
    # corners, and an invisible closed path id.loop for current-flow dots (["flow", "id.loop"]).
    i = o["id"]
    W, H = o.get("width", 6), o.get("height", 3.6)
    sides = {"bottom": (0, 1), "right": (1, 2), "top": (2, 3), "left": (3, 0)}
    objs = [{"type": "point", "id": f"{i}.c{k}"} for k in range(4)]
    cons = [["horizontal", f"{i}.c0", f"{i}.c1"], ["distance", f"{i}.c0", f"{i}.c1", W], ["vertical", f"{i}.c1", f"{i}.c2"],
            ["distance", f"{i}.c1", f"{i}.c2", H], ["horizontal", f"{i}.c2", f"{i}.c3"], ["vertical", f"{i}.c3", f"{i}.c0"],
            ["right_of", f"{i}.c1", f"{i}.c0", 0], ["above", f"{i}.c2", f"{i}.c1", 0]]
    used = {}
    for n, part in enumerate(o.get("parts") or []):
        side = part.get("side", ["left", "top", "right", "bottom"][n % 4])
        if side not in sides:
            side = "top"
        used.setdefault(side, []).append(part)
    for side, (a, b) in sides.items():
        parts = used.get(side, [])
        A, B = f"{i}.c{a}", f"{i}.c{b}"
        prev = A
        for k, part in enumerate(parts):
            pid = part.get("id") or f"{i}.{side}{k}"
            f0, f1 = (k + 0.5) / len(parts) - 0.12, (k + 0.5) / len(parts) + 0.12
            p0, p1 = f"{pid}.a", f"{pid}.b"
            objs += [{"type": "point", "id": p0}, {"type": "point", "id": p1}]
            cons += [["on", p0, f"{A}-{B}"], ["on", p1, f"{A}-{B}"], ["length_ratio", f"{A}-{p0}", f"{A}-{B}", f0], ["length_ratio", f"{A}-{p1}", f"{A}-{B}", f1]]
            comp = {"type": part.get("type", "resistor"), "id": pid, "from": p0, "to": p1}
            for key in ("label", "tex_label", "color", "glow", "letter", "closed", "label_side"):
                if key in part:
                    comp[key] = part[key]
            objs.append(comp)
            objs.append({"type": "wire", "id": f"{pid}.w", "points": [prev, p0]})
            prev = p1
        objs.append({"type": "wire", "id": f"{i}.{side}.w", "points": [prev, B]})
    objs.append({"type": "wire", "id": f"{i}.loop", "points": [f"{i}.c{k}" for k in range(4)], "closed": True, "width": 0})
    objs.append({"type": "group", "id": i, "members": [x["id"] for x in objs if x["type"] != "point" and x["id"] != f"{i}.loop"]})
    return objs, cons


def _mac_cycle(o):
    # cycle {id, items: [texts], radius?} -> boxes id.0.. on a ring with flows id.f0.. between consecutive items (closing the loop)
    i, items = o["id"], list(o.get("items") or [])
    objs = [{"type": "box", "id": f"{i}.{k}", "text": t, "color": o.get("color", "a")} for k, t in enumerate(items)]
    objs += [{"type": "flow", "id": f"{i}.f{k}", "from": f"{i}.{k}", "to": f"{i}.{(k + 1) % len(items)}", "bend": -0.35, "color": o.get("flow_color", "muted")}
             for k in range(len(items))]
    return objs, [["ring", [f"{i}.{k}" for k in range(len(items))], o.get("radius", 2.2)]]


def _mac_process(o):
    # process {id, items: [texts], direction?: row|column} -> boxes id.0.. in a row/column with flows id.f0.. between them
    i, items = o["id"], list(o.get("items") or [])
    objs = [{"type": "box", "id": f"{i}.{k}", "text": t, "color": o.get("color", "a")} for k, t in enumerate(items)]
    objs += [{"type": "flow", "id": f"{i}.f{k}", "from": f"{i}.{k}", "to": f"{i}.{k + 1}", "color": o.get("flow_color", "muted")} for k in range(len(items) - 1)]
    return objs, [[o.get("direction", "row") if o.get("direction") in ("row", "column") else "row", [f"{i}.{k}" for k in range(len(items))], o.get("gap", 1.0)]]


def _mac_vector_sum(o):
    # vector_sum {id, u: [x, y], v: [x, y], at?: [x, y]} -> points id.O id.U id.S id.V, vectors id.u (O->U), id.v (U->S), id.sum (O->S),
    # dashed parallelogram sides id.v2 (O->V) and id.u2 (V->S); all from offsets, so the sum is exact.
    i = o["id"]
    u, v = o.get("u", [3, 1]), o.get("v", [1, 2])
    objs = [{"type": "point", "id": f"{i}.O", "at": o.get("at", [0, 0])}, {"type": "point", "id": f"{i}.U"}, {"type": "point", "id": f"{i}.S"}, {"type": "point", "id": f"{i}.V"},
            {"type": "vector", "id": f"{i}.u", "from": f"{i}.O", "to": f"{i}.U", "color": "a", "tex_label": o.get("u_label", "\\vec{a}")},
            {"type": "vector", "id": f"{i}.v", "from": f"{i}.U", "to": f"{i}.S", "color": "b", "tex_label": o.get("v_label", "\\vec{b}")},
            {"type": "vector", "id": f"{i}.sum", "from": f"{i}.O", "to": f"{i}.S", "color": "c", "tex_label": o.get("sum_label", "\\vec{a}+\\vec{b}")},
            {"type": "segment", "id": f"{i}.v2", "from": f"{i}.O", "to": f"{i}.V", "color": "b", "dashed": True},
            {"type": "segment", "id": f"{i}.u2", "from": f"{i}.V", "to": f"{i}.S", "color": "a", "dashed": True}]
    cons = [["offset", f"{i}.U", f"{i}.O", u[0], u[1]], ["offset", f"{i}.S", f"{i}.U", v[0], v[1]], ["offset", f"{i}.V", f"{i}.O", v[0], v[1]]]
    return objs, cons


MACROS = {"circuit": _mac_circuit, "cycle": _mac_cycle, "process": _mac_process, "vector_sum": _mac_vector_sum,
          "right_triangle": _mac_right_triangle, "square_on": _mac_square_on, "regular_polygon": _mac_regular_polygon, "balance": _mac_balance}


# ───────────────────────── text size estimates (frame units, Manim Text/MathTex) ─────────────────────────
def text_size(text: str, fs: float) -> tuple[float, float]:
    lines = str(text).split("\n")
    return max(len(l) for l in lines) * fs * 0.0080 + 0.05, len(lines) * fs * 0.0145


def tex_size(tex: str, fs: float) -> tuple[float, float]:
    t = re.sub(r"\\(mathrm|text|mathbf|left|right|,|;|quad)", "", tex)
    t = re.sub(r"\\[a-zA-Z]+", "x", t)
    t = re.sub(r"[{}_^ ]", "", t)
    return max(1, len(t)) * fs * 0.0060 + 0.1, fs * (0.016 if "frac" in tex else 0.0125)


def wrap(text: str, width_chars: int = 16, max_lines: int = 3) -> str:
    words, lines, cur = str(text).split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > width_chars:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        lines.append(cur)
    return "\n".join(lines[:max_lines])


BOX_FS = 28
CELL_FS = 30


def block_size(o: dict) -> tuple[float, float]:
    t = o["type"]
    if t == "box":
        if o.get("tex"):
            w, h = max((tex_size(str(t), BOX_FS + 4) for t in _as_list(o["tex"])), key=lambda x: x[0])
        else:
            w, h = max((text_size(wrap(str(t), int(o.get("wrap", 16))), BOX_FS) for t in _as_list(o.get("text", ""))), key=lambda x: x[0])
        w, h = w + 0.5, h + 0.35
        if o.get("size"):
            s = o["size"]
            w, h = max(w, float(s[0])), max(h, float(s[1]))
        return w, h
    if t == "text":
        return text_size(wrap(o.get("text", ""), int(o.get("wrap", 28)), 4), o.get("font", 28))
    if t == "icon":
        s = float(o.get("size", 1.2))
        return s, s
    if t == "cells":
        n = len(o.get("values") or []) or int(o.get("n", 6))
        cw = float(o.get("cell", 0.8))
        return n * cw, cw + (0.45 if o.get("indices", True) else 0)
    if t == "axes":
        (x0, x1), (y0, y1) = _rng(o.get("x")), _rng(o.get("y"))
        ux, uy = _axes_units(o)
        return (x1 - x0) * ux, (y1 - y0) * uy
    return 0.0, 0.0


def _rng(r):
    r = list(r or [-1, 5])
    return float(r[0]), float(r[1])


def _axes_units(o):
    (x0, x1), (y0, y1) = _rng(o.get("x")), _rng(o.get("y"))
    if o.get("unit") is not None:
        u = o["unit"]
        u = u if isinstance(u, (list, tuple)) else [u, u]
        return float(u[0]), float(u[1])
    size = o.get("size") or [6.0, 4.0]
    return float(size[0]) / max(1e-6, x1 - x0), float(size[1]) / max(1e-6, y1 - y0)


# ───────────────────────── the world ─────────────────────────
def _as_list(x):
    return x if isinstance(x, list) else [x]


class World:
    def __init__(self, ir: dict, aspect: str = "16:9"):
        self.ir = copy.deepcopy(ir)
        self.aspect = aspect
        self.problems: list[str] = []
        self.warnings: list[str] = []
        self._expand()
        self.vars = Vars(self.ir.get("vars") or {})
        self.problems += self.vars.problems
        self.objs: dict = {}
        self.order: list[str] = []
        self._index()
        self.cons = [c for c in (self.ir.get("constraints") or []) if isinstance(c, list) and c]
        self._validate()
        self._unknowns()
        self.X = None
        self.state_vals = self.vars.values()
        self.transform = (np.zeros(2), 1.0, np.zeros(2))  # world centre, scale, frame centre

    # ── setup ──
    def _expand(self):
        objs, cons = [], list(self.ir.get("constraints") or [])
        for o in self.ir.get("objects") or []:
            if not isinstance(o, dict):
                continue
            if o.get("type") == "macro" or o.get("type") in MACROS:
                name = o.get("name") or o.get("type")
                if name not in MACROS:
                    self.problems.append(f"unknown macro {name!r} (have {', '.join(MACROS)})")
                    continue
                try:
                    a, b = MACROS[name](o)
                except Exception as exc:  # noqa: BLE001
                    self.problems.append(f"macro {name} {o.get('id')}: {exc}")
                    continue
                if o.get("id") and not any(x.get("id") == o["id"] for x in a):
                    a = a + [{"type": "group", "id": o["id"], "members": [x["id"] for x in a if x.get("type") not in ("point",)]}]
                objs += a
                cons += b
            else:
                objs.append(o)
            # shorthand: "label"/"tex_label" on any object
        extra = []
        for o in objs:
            for key, kind in (("label", "text"), ("tex_label", "tex")):
                if o.get(key) and o.get("type") not in ("label", "box", "pointer", "readout", "equation", "text") and o.get("id"):
                    extra.append({"type": "label", "id": f"{o['id']}.lbl", "for": o["id"], kind: o[key], "color": o.get("label_color", o.get("color", "ink")),
                                  "side": o.get("label_side"), "_auto": True})
        self.ir["objects"] = objs + extra
        self.ir["constraints"] = cons

    def _index(self):
        for k, o in enumerate(self.ir["objects"]):
            t = o.get("type")
            if t not in TYPES:
                self.problems.append(f"object #{k} has unknown type {t!r}; use one of: {', '.join(sorted(TYPES))}")
                continue
            oid = str(o.get("id") or f"_{t}{k}")
            o["id"] = oid
            if oid in self.objs:
                self.problems.append(f"two objects share the id {oid!r}")
                continue
            self.objs[oid] = o
            self.order.append(oid)
            if t == "cells" and o.get("cell") is None:
                n = len(o.get("values") or []) or int(o.get("n", 6))
                o["cell"] = round(max(0.7, min(1.25, 9.0 / max(n, 1))), 3)
            if t == "axes":
                v0 = self.vars.values()
                for key in ("x", "y", "unit", "size"):
                    if o.get(key) is not None:
                        try:
                            o[key] = [self.vars.eval(x, v0) for x in _as_list(o[key])][: (3 if key in ("x", "y") else 2)]
                        except Exception as exc:  # noqa: BLE001
                            self.problems.append(f"axes {oid}: {key} {o[key]!r}: {exc}")

    def ref_points(self, ref: str) -> list[str]:
        """'A-B' -> [A, B]; a segment/vector/ray/line id -> its two points; a point/block id -> [id]."""
        ref = str(ref)
        if ref in self.objs:
            o = self.objs[ref]
            if o["type"] in ({"segment", "line", "ray", "vector", "brace"} | TWO_TERMINAL) and o.get("from") and o.get("to") and isinstance(o.get("to"), str):
                return [o["from"], o["to"]]
            if o["type"] == "polygon":
                return list(o.get("points") or [])
            return [ref]
        if "-" in ref:
            a, b = ref.split("-", 1)
            if a in self.objs and b in self.objs:
                return [a, b]
        return [ref]

    def _validate(self):
        P = self.problems
        for oid, o in self.objs.items():
            t = o["type"]

            def need(key, kinds=None):
                for r in _as_list(o.get(key)):
                    if isinstance(r, str) and r not in self.objs and not re.match(r"^[A-Za-z_]\w*\[", r) and "-" not in r:
                        P.append(f"{t} {oid}: {key} refers to {r!r}, which is not an object id")
            if t in ({"segment", "line", "ray"} | TWO_TERMINAL):
                if not (o.get("from") and o.get("to")):
                    P.append(f"{t} {oid} needs from and to (point ids)")
                need("from"), need("to")
            elif t in ("polygon", "polyline", "wire"):
                pts = o.get("points") or []
                if len(pts) < 2:
                    P.append(f"{t} {oid} needs points (a list of point ids)")
                need("points")
            elif t == "circle":
                if not o.get("center"):
                    P.append(f"circle {oid} needs center (a point id)")
                need("center")
            elif t == "arc":
                need("center")
            elif t == "angle":
                if len(o.get("points") or []) != 3:
                    P.append(f"angle {oid} needs points [A, B, C] (the angle at B)")
                need("points")
            elif t == "vector":
                need("from")
                if not (o.get("to") or o.get("comp")):
                    P.append(f"vector {oid} needs to (a point id) or comp [dx, dy]")
            elif t in ON_AXES:
                if o.get("on") not in self.objs or self.objs[o["on"]]["type"] != "axes":
                    P.append(f"{t} {oid} needs on: the id of an axes object")
                if t == "function" and not o.get("expr"):
                    P.append(f"function {oid} needs expr in x")
                if t == "area" and not (o.get("of") or o.get("expr")):
                    P.append(f"area {oid} needs of: a function id")
            elif t == "curve":
                if not (o.get("x") and o.get("y")):
                    P.append(f"curve {oid} needs x and y expressions of its parameter (param, default u)")
            elif t == "point":
                if o.get("on") and o["on"] in self.objs and self.objs[o["on"]]["type"] == "axes" and not o.get("at"):
                    P.append(f"point {oid} is on axes {o['on']} but has no at: [x, y] in axes units")
            elif t in ("label",):
                if not (o.get("text") or o.get("tex")):
                    P.append(f"label {oid} needs text or tex")
                if o.get("for"):
                    f = str(o["for"])
                    if f not in self.objs and not re.match(r"^\w+\[", f) and not ("-" in f and all(x in self.objs for x in f.split("-", 1))):
                        P.append(f"label {oid}: for refers to {f!r}, which is not an object id")
            elif t == "flow":
                need("from"), need("to")
            elif t == "pointer":
                if not o.get("at"):
                    P.append(f"pointer {oid} needs at (e.g. \"arr[{{mid}}]\")")
            elif t == "equation":
                if not (o.get("lines") or o.get("chem") or o.get("sym") or o.get("tex")):
                    P.append(f"equation {oid} needs lines [{{sym: '3*(y-5)=12'}}, ...] or chem")
            elif t == "icon":
                if o.get("icon", o.get("kind")) not in ICONS:
                    P.append(f"icon {oid}: icon must be one of {', '.join(sorted(ICONS))}")
            elif t == "group":
                need("members")
        for c in self.cons:
            k = c[0]
            if k not in HARD | SOFT:
                P.append(f"unknown constraint {k!r}; use one of: {', '.join(sorted(HARD | SOFT))}")
                continue
            for r in c[1:]:
                for x in (r if isinstance(r, list) else [r]):
                    if isinstance(x, str) and x not in self.objs and "-" in x:
                        a, _, b = x.partition("-")
                        if a in self.objs and b in self.objs:
                            continue
                    if isinstance(x, str) and re.match(r"^[A-Za-z_][\w.]*$", x) and x not in self.objs and x not in self.vars.decl and x not in ("pi", "deg", "e", "h", "v"):
                        if k in ("distance", "angle", "direction", "polar", "area", "near", "apart", "ring", "row", "column", "gap", "length_ratio", "tangent", "offset") and c.index(r) >= 3:
                            continue
                        P.append(f"constraint {c!r}: {x!r} is not an object id or var")
        for bi, b in enumerate(self.ir.get("beats") or []):
            for a in b.get("do") or []:
                a = _as_list(a)
                if not a or a[0] not in ACTIONS:
                    P.append(f"beat {bi + 1}: unknown action {a[:1]!r}; use one of {', '.join(sorted(ACTIONS))}")
                    continue
                if a[0] in ("show", "hide", "highlight", "trace", "untrace", "flow", "focus"):
                    for x in a[1:]:
                        for y in _as_list(x):
                            if isinstance(y, str) and y not in self.objs and not re.match(r"^\w+\[", y) and a[0] != "show" or (a[0] == "show" and isinstance(y, str) and y not in self.objs and not re.match(r"^\w+\[", y)):
                                if isinstance(y, str) and y in self.vars.decl:
                                    continue
                                P.append(f"beat {bi + 1}: {a[0]} refers to {y!r}, which is not an object id")
                if a[0] in ("animate", "set"):
                    names = [a[1]] if a[0] == "animate" else list((a[1] if len(a) > 1 and isinstance(a[1], dict) else {}).keys())
                    for n in names:
                        if n not in self.vars.decl:
                            P.append(f"beat {bi + 1}: {a[0]} of {n!r}, which is not a declared var")
                if a[0] == "morph" and len(a) >= 3:
                    for x in _as_list(a[1]) + _as_list(a[2]):
                        if x not in self.objs:
                            P.append(f"beat {bi + 1}: morph refers to {x!r}, which is not an object id")
                    if len(_as_list(a[1])) != len(_as_list(a[2])):
                        P.append(f"beat {bi + 1}: morph needs as many targets as sources")
                if a[0] == "equation" and (len(a) < 2 or a[1] not in self.objs):
                    P.append(f"beat {bi + 1}: equation needs an equation id")

    def _unknowns(self):
        """Every point and every block centre without a fixed position is a 2-D unknown."""
        self.free: list[str] = []
        self.sizes: dict = {}
        for oid in self.order:
            o = self.objs[oid]
            t = o["type"]
            if t == "point":
                if o.get("at") is not None and not o.get("free"):
                    continue
                self.free.append(oid)
            elif t in BLOCKS:
                self.sizes[oid] = block_size(o)
                if o.get("at") is not None:
                    continue
                if t == "axes" and o.get("origin"):
                    continue
                self.free.append(oid)
        # points referenced by geometry but never declared become free points
        for oid, o in list(self.objs.items()):
            for key in ("from", "to", "center", "points"):
                for r in _as_list(o.get(key)):
                    if isinstance(r, str) and r and r not in self.objs and "-" not in r and "[" not in r and re.match(r"^[A-Za-z_][\w.]*$", r):
                        self.objs[r] = {"type": "point", "id": r, "_implicit": True}
                        self.order.insert(0, r)
                        self.free.append(r)
        self.idx = {k: i for i, k in enumerate(self.free)}

    # ── positions ──
    def _axes_map(self, ax_id: str, X, vals):
        o = self.objs[ax_id]
        ux, uy = _axes_units(o)
        (x0, x1), (y0, y1) = _rng(o.get("x")), _rng(o.get("y"))
        if o.get("origin"):
            org = self.pos(o["origin"], X, vals)
            return lambda x, y: org + np.array([x * ux, y * uy])
        c = self.pos(ax_id, X, vals)
        return lambda x, y: c + np.array([(x - (x0 + x1) / 2) * ux, (y - (y0 + y1) / 2) * uy])

    def pos(self, ref, X=None, vals=None) -> np.ndarray:
        X = self.X if X is None else X
        vals = self.state_vals if vals is None else vals
        if isinstance(ref, (list, tuple)):
            return np.array([self.vars.eval(ref[0], vals), self.vars.eval(ref[1], vals)], dtype=float)
        ref = str(ref)
        m = re.match(r"^(\w[\w.]*)\[(.+)\]$", ref)
        if m and m.group(1) in self.objs and self.objs[m.group(1)]["type"] == "cells":
            return self.cell_pos(m.group(1), m.group(2), X, vals)
        if ref not in self.objs and "-" in ref:
            a, b = ref.split("-", 1)
            return (self.pos(a, X, vals) + self.pos(b, X, vals)) / 2
        o = self.objs.get(ref)
        if o is None:
            raise KeyError(ref)
        if ref in self.idx:
            i = self.idx[ref]
            return np.array(X[2 * i:2 * i + 2], dtype=float)
        t = o["type"]
        if t == "point":
            at = o.get("at")
            if o.get("on") in self.objs and self.objs[o["on"]]["type"] == "axes":
                f = self._axes_map(o["on"], X, vals)
                return f(self.vars.eval(at[0], vals), self.vars.eval(at[1], vals))
            return np.array([self.vars.eval(at[0], vals), self.vars.eval(at[1], vals)], dtype=float)
        if t in BLOCKS:
            if t == "axes" and o.get("origin") and o.get("at") is None:
                (x0, x1), (y0, y1) = _rng(o.get("x")), _rng(o.get("y"))
                return self._axes_map(ref, X, vals)((x0 + x1) / 2, (y0 + y1) / 2)
            at = o.get("at")
            return np.array([self.vars.eval(at[0], vals), self.vars.eval(at[1], vals)], dtype=float)
        if t in ({"segment", "vector", "line", "ray"} | TWO_TERMINAL) and o.get("from"):
            return (self.pos(o["from"], X, vals) + self.end(ref, X, vals)) / 2
        if t in ("polygon", "polyline", "wire"):
            return np.mean([self.pos(p, X, vals) for p in o["points"]], axis=0)
        if t in ("circle", "arc"):
            return self.pos(o["center"], X, vals)
        if t == "label" and o.get("for"):
            return self.pos(o["for"], X, vals)
        raise KeyError(ref)

    def end(self, ref, X=None, vals=None):
        o = self.objs[ref]
        vals = self.state_vals if vals is None else vals
        if o.get("to") is not None and isinstance(o["to"], str):
            return self.pos(o["to"], X, vals)
        comp = o.get("comp") or o.get("to")
        d = np.array([self.vars.eval(comp[0], vals), self.vars.eval(comp[1], vals)]) * float(self.vars.eval(o.get("scale", 1), vals))
        if o.get("on") in self.objs and self.objs[o["on"]]["type"] == "axes":
            ux, uy = _axes_units(self.objs[o["on"]])
            d = d * np.array([ux, uy])
        return self.pos(o["from"], X, vals) + d

    def cell_pos(self, cid, idx_expr, X=None, vals=None):
        o = self.objs[cid]
        n = len(o.get("values") or []) or int(o.get("n", 6))
        vals = self.state_vals if vals is None else vals
        i = self.vars.eval(idx_expr, vals) if not str(idx_expr).lstrip("-").isdigit() else int(idx_expr)
        cw = float(o.get("cell", 0.8))
        c = self.pos(cid, X, vals)
        top = 0.45 / 2 if o.get("indices", True) else 0
        return c + np.array([(i - (n - 1) / 2) * cw, top])

    def radius(self, cid, X=None, vals=None):
        o = self.objs[cid]
        vals = self.state_vals if vals is None else vals
        r = o.get("radius", 1)
        if isinstance(r, str) and r in self.objs:
            return float(np.linalg.norm(self.pos(r, X, vals) - self.pos(o["center"], X, vals)))
        return float(self.vars.eval(r, vals))

    def fn_eval(self, fid, x, vals):
        o = self.objs[fid]
        e = o.get("_lam")
        if e is None:
            names = {k: sp.Symbol(k) for k in self.vars.decl}
            ex = sym(o["expr"], {**names, "x": sp.Symbol("x")})
            args = [sp.Symbol("x")] + [sp.Symbol(k) for k in self.vars.order]
            o["_sym"] = ex
            o["_lam"] = e = sp.lambdify(args, ex, modules=["numpy"])
        return float(e(x, *[vals[k] for k in self.vars.order]))

    def fn_deriv(self, fid, x0, vals):
        o = self.objs[fid]
        self.fn_eval(fid, x0, vals)
        d = sp.diff(o["_sym"], sp.Symbol("x"))
        return float(d.subs({sp.Symbol("x"): x0, **{sp.Symbol(k): v for k, v in vals.items()}}).evalf())

    # ── residuals ──
    def _seg(self, ref, X, vals):
        pts = self.ref_points(ref)
        if len(pts) < 2:
            raise KeyError(f"{ref} is not a segment")
        return self.pos(pts[0], X, vals), self.pos(pts[1], X, vals)

    def _num(self, v, vals):
        return float(self.vars.eval(v, vals))

    def _half(self, oid):
        w, h = self.sizes.get(oid, (0.0, 0.0))
        return w / 2 / self._ks, h / 2 / self._ks

    def residuals(self, X, vals, soft_w=1.0, which="all") -> list[tuple[float, str, bool]]:
        out = []
        for c in self.cons:
            k = c[0]
            hard = k in HARD
            if which == "hard" and not hard:
                continue
            try:
                out += [(r, k, hard) for r in self._res(c, X, vals)]
            except Exception:  # noqa: BLE001  (bad refs were reported by validate)
                continue
        if which != "hard":
            out += [(r, "apart", False) for r in self._apart(X, vals)]
        return out

    def _res(self, c, X, vals):
        k, a = c[0], c[1:]
        p = lambda r: self.pos(r, X, vals)  # noqa: E731
        if k == "fix":
            return list(p(a[0]) - np.array([self._num(a[1][0], vals), self._num(a[1][1], vals)]))
        if k == "distance":
            return [np.linalg.norm(p(a[0]) - p(a[1])) - self._num(a[2], vals)]
        if k == "offset":  # P = Q + (dx, dy)
            return list(p(a[0]) - p(a[1]) - np.array([self._num(a[2], vals), self._num(a[3], vals)]))
        if k == "equal_length":
            (a0, a1), (b0, b1) = self._seg(a[0], X, vals), self._seg(a[1], X, vals)
            return [np.linalg.norm(a1 - a0) - np.linalg.norm(b1 - b0)]
        if k == "length_ratio":
            (a0, a1), (b0, b1) = self._seg(a[0], X, vals), self._seg(a[1], X, vals)
            return [np.linalg.norm(a1 - a0) - self._num(a[2], vals) * np.linalg.norm(b1 - b0)]
        if k in ("perpendicular", "parallel"):
            (a0, a1), (b0, b1) = self._seg(a[0], X, vals), self._seg(a[1], X, vals)
            u, v = a1 - a0, b1 - b0
            nu, nv = np.linalg.norm(u) + 1e-9, np.linalg.norm(v) + 1e-9
            return [(u @ v) / (nu * nv)] if k == "perpendicular" else [(u[0] * v[1] - u[1] * v[0]) / (nu * nv)]
        if k == "angle":  # angle at B between BA and BC, in radians (use deg: "30*deg")
            A, B, C = p(a[0]), p(a[1]), p(a[2])
            th = self._num(a[3], vals)
            u, v = A - B, C - B
            nu, nv = np.linalg.norm(u) + 1e-9, np.linalg.norm(v) + 1e-9
            return [(u @ v) / (nu * nv) - math.cos(th)]
        if k == "equal_angle":
            A, B, C, D, E, F = (p(x) for x in a[:6])
            f = lambda u, v: (u @ v) / ((np.linalg.norm(u) + 1e-9) * (np.linalg.norm(v) + 1e-9))  # noqa: E731
            return [f(A - B, C - B) - f(D - E, F - E)]
        if k == "direction":  # direction of A->B measured from +x, radians
            A, B = p(a[0]), p(a[1])
            th = self._num(a[2], vals)
            d = B - A
            n = np.linalg.norm(d) + 1e-9
            return [d[0] / n - math.cos(th), d[1] / n - math.sin(th)]
        if k == "polar":  # P = O + r (cos t, sin t)
            P, O = p(a[0]), p(a[1])
            r, th = self._num(a[2], vals), self._num(a[3], vals)
            return list(P - O - r * np.array([math.cos(th), math.sin(th)]))
        if k in ("on", "intersection"):
            targets = a[1:] if k == "intersection" else [a[1]]
            return [self._on(a[0], t, X, vals) for t in targets]
        if k == "midpoint":
            M = p(a[0])
            A, B = self._seg(a[1], X, vals) if len(a) == 2 else (p(a[1]), p(a[2]))
            return list(M - (A + B) / 2)
        if k == "collinear":
            A, B, C = p(a[0]), p(a[1]), p(a[2])
            u, v = B - A, C - A
            return [(u[0] * v[1] - u[1] * v[0]) / ((np.linalg.norm(u) + 1e-9) * (np.linalg.norm(v) + 1e-9))]
        if k in ("horizontal", "vertical", "same_x", "same_y"):
            if len(a) == 1:
                A, B = self._seg(a[0], X, vals)
            else:
                A, B = p(a[0]), p(a[1])
            return [A[1] - B[1]] if k in ("horizontal", "same_y") else [A[0] - B[0]]
        if k == "tangent":
            # ["tangent", "A-B", circle] or ["tangent", "A-B", function, x0] (the line through A,B touches it)
            A, B = self._seg(a[0], X, vals)
            o = self.objs[a[1]]
            d = B - A
            n = np.linalg.norm(d) + 1e-9
            if o["type"] == "circle":
                C = p(o["center"])
                dist = abs(d[0] * (C - A)[1] - d[1] * (C - A)[0]) / n
                return [dist - self.radius(a[1], X, vals)]
            if o["type"] == "function":
                x0 = self._num(a[2], vals)
                f = self._axes_map(o["on"], X, vals)
                ux, uy = _axes_units(self.objs[o["on"]])
                T = f(x0, self.fn_eval(a[1], x0, vals))
                slope = self.fn_deriv(a[1], x0, vals) * uy / ux
                tdir = np.array([1.0, slope]) / math.hypot(1, slope)
                return [(d[0] * tdir[1] - d[1] * tdir[0]) / n, (d[0] * (T - A)[1] - d[1] * (T - A)[0]) / n]
            return [0.0]
        if k in ("ccw", "cw"):
            A, B, C = p(a[0]), p(a[1]), p(a[2])
            cr = (B - A)[0] * (C - A)[1] - (B - A)[1] * (C - A)[0]
            return [min(0.0, cr if k == "ccw" else -cr)]
        if k in ("opposite_sides", "same_side"):
            P, Q = p(a[0]), p(a[1])
            A, B = self._seg(a[2], X, vals)
            s = lambda R: (B - A)[0] * (R - A)[1] - (B - A)[1] * (R - A)[0]  # noqa: E731
            v = s(P) * s(Q)
            return [max(0.0, v) * 0.5 if k == "opposite_sides" else min(0.0, v) * 0.5]
        if k == "area":
            pts = [p(x) for x in self.ref_points(a[0])]
            return [abs(_shoelace(pts)) - self._num(a[1], vals)]
        # ── soft (layout) ──
        gap = lambda i, d=0.35: self._num(a[i], vals) if len(a) > i else d  # noqa: E731
        if k in ("left_of", "right_of", "above", "below"):
            A, B = p(a[0]), p(a[1])
            ha, hb = self._half(a[0]), self._half(a[1])
            g = gap(2)
            if k == "left_of":
                return [max(0.0, (A[0] + ha[0] + g) - (B[0] - hb[0]))]
            if k == "right_of":
                return [max(0.0, (B[0] + hb[0] + g) - (A[0] - ha[0]))]
            if k == "above":
                return [max(0.0, (B[1] + hb[1] + g) - (A[1] - ha[1]))]
            return [max(0.0, (A[1] + ha[1] + g) - (B[1] - hb[1]))]
        if k == "aligned":
            flat = [x for x in a if not isinstance(x, list)] + [y for x in a if isinstance(x, list) for y in x]
            axis = "v" if "v" in flat else "h"
            ids = [x for x in flat if x not in ("h", "v")]
            P = [p(x) for x in ids]
            j = 1 if axis == "h" else 0
            return [P[i][j] - P[0][j] for i in range(1, len(P))]
        if k in ("row", "column"):
            ids = a[0] if isinstance(a[0], list) else a
            g = self._num(a[1], vals) if isinstance(a[0], list) and len(a) > 1 else 0.6
            out = []
            for x, y in zip(ids, ids[1:]):
                A, B = p(x), p(y)
                ha, hb = self._half(x), self._half(y)
                if k == "row":
                    out += [A[1] - B[1], (B[0] - hb[0]) - (A[0] + ha[0]) - g]
                else:
                    out += [A[0] - B[0], (A[1] - ha[1]) - (B[1] + hb[1]) - g]
            return out
        if k == "ring":
            ids = a[0] if isinstance(a[0], list) else a
            r = self._num(a[1], vals) if isinstance(a[0], list) and len(a) > 1 else 2.4
            P = [p(x) for x in ids]
            C = np.mean(P, axis=0)
            out = []
            n = len(ids)
            for i, Q in enumerate(P):
                th = math.pi / 2 - 2 * math.pi * i / n
                out += list(Q - C - r * np.array([1.25 * math.cos(th), math.sin(th)]))
            return out
        if k == "near":
            A, B = p(a[0]), p(a[1])
            return [max(0.0, np.linalg.norm(A - B) - gap(2, 1.5))]
        if k == "apart":
            A, B = p(a[0]), p(a[1])
            return [max(0.0, gap(2, 1.5) - np.linalg.norm(A - B))]
        if k == "gap":
            A, B = p(a[0]), p(a[1])
            return [np.linalg.norm(A - B) - gap(2, 1.5)]
        if k == "inside":
            P = p(a[0])
            o = self.objs.get(a[1], {})
            if o.get("type") == "circle":
                return [max(0.0, np.linalg.norm(P - p(o["center"])) - self.radius(a[1], X, vals))]
            if o.get("type") in BLOCKS:
                C, h = p(a[1]), self._half(a[1])
                return [max(0.0, abs(P[0] - C[0]) - h[0]), max(0.0, abs(P[1] - C[1]) - h[1])]
            pts = [p(x) for x in self.ref_points(a[1])]
            lo, hi = np.min(pts, axis=0), np.max(pts, axis=0)
            return [max(0.0, lo[0] - P[0]), max(0.0, P[0] - hi[0]), max(0.0, lo[1] - P[1]), max(0.0, P[1] - hi[1])]
        return []

    def _on(self, pid, target, X, vals):
        P = self.pos(pid, X, vals)
        o = self.objs.get(target)
        if o is None and "-" in str(target):
            o = {"type": "segment", "from": target.split("-", 1)[0], "to": target.split("-", 1)[1]}
        t = o["type"]
        if t in ("segment", "line", "ray", "vector", "wire") and o.get("from"):
            A = self.pos(o["from"], X, vals)
            B = self.pos(o["to"], X, vals) if isinstance(o.get("to"), str) else self.end(o["id"], X, vals)
            d = B - A
            n = np.linalg.norm(d) + 1e-9
            cr = (d[0] * (P - A)[1] - d[1] * (P - A)[0]) / n
            if t in ("segment", "vector"):
                s = ((P - A) @ d) / (n * n)
                cr = math.copysign(abs(cr) + max(0.0, -s) * n + max(0.0, s - 1) * n, cr if cr else 1)
            elif t == "ray":
                s = ((P - A) @ d) / (n * n)
                cr = math.copysign(abs(cr) + max(0.0, -s) * n, cr if cr else 1)
            return cr
        if t in ("circle", "arc"):
            return float(np.linalg.norm(P - self.pos(o["center"], X, vals)) - self.radius(target, X, vals))
        if t == "function":
            ax = self.objs[o["on"]]
            ux, uy = _axes_units(ax)
            f = self._axes_map(o["on"], X, vals)
            O = f(0, 0)
            x = (P[0] - O[0]) / ux
            return (P[1] - f(x, self.fn_eval(target, x, vals))[1])
        if t in ("polygon", "polyline"):
            pts = [self.pos(x, X, vals) for x in o["points"]] + ([self.pos(o["points"][0], X, vals)] if t == "polygon" else [])
            return min(_seg_dist(P, A, B) for A, B in zip(pts, pts[1:]))
        if t in BLOCKS:
            C, h = self.pos(target, X, vals), self._half(target)
            return max(0.0, abs(P[0] - C[0]) - h[0]) + max(0.0, abs(P[1] - C[1]) - h[1])
        return 0.0

    def _apart(self, X, vals):
        """Blocks (boxes, icons, cells, axes, free circles) must not overlap: hinge on the box overlap, with a margin."""
        ids = [o for o in self.sizes if self.objs[o]["type"] in BLOCKS]
        ids += [o for o, ob in self.objs.items() if ob["type"] == "circle" and not ob.get("overlap_ok")]
        out = []
        boxes = {}
        for i in ids:
            try:
                if self.objs[i]["type"] == "circle":
                    r = self.radius(i, X, vals)
                    boxes[i] = (self.pos(i, X, vals), np.array([r, r]))
                else:
                    boxes[i] = (self.pos(i, X, vals), np.array(self._half(i)))
            except Exception:  # noqa: BLE001
                continue
        keys = list(boxes)
        attached = self._attached_pairs()
        for x in range(len(keys)):
            for y in range(x + 1, len(keys)):
                a, b = keys[x], keys[y]
                if (a, b) in attached or (b, a) in attached:
                    continue
                (ca, ha), (cb, hb) = boxes[a], boxes[b]
                m = 0.25 + (0.45 if "axes" in (self.objs[a]["type"], self.objs[b]["type"]) else 0.0)
                ox = ha[0] + hb[0] + m - abs(ca[0] - cb[0])
                oy = ha[1] + hb[1] + m - abs(ca[1] - cb[1])
                out.append(0.7 * max(0.0, min(ox, oy)))
        return out

    def _attached_pairs(self):
        if getattr(self, "_att", None) is not None:
            return self._att
        att = set()
        for c in self.cons:
            if c[0] in ("inside", "on", "near") and len(c) > 2 and isinstance(c[1], str) and isinstance(c[2], str):
                att.add((c[1], c[2]))
        for oid, o in self.objs.items():
            if o["type"] == "circle":
                cen = self.objs.get(o.get("center"), {})
                if cen.get("on") in self.objs:
                    att.add((oid, cen["on"]))
                for c in self.cons:
                    if c[0] in ("same_y", "same_x") and o.get("center") in c[1:]:
                        pass
        self._att = att
        return att

    # ── solve ──
    def _guess(self, seed):
        rng = np.random.default_rng(seed)
        X = np.zeros(2 * len(self.free))
        for oid, i in self.idx.items():
            o = self.objs[oid]
            h = o.get("hint") or o.get("near")
            if isinstance(h, (list, tuple)) and len(h) == 2:
                try:
                    X[2 * i:2 * i + 2] = [self.vars.eval(h[0], self.state_vals), self.vars.eval(h[1], self.state_vals)]
                    X[2 * i:2 * i + 2] += rng.normal(0, 0.05 if seed else 0.0, 2)
                    continue
                except Exception:  # noqa: BLE001
                    pass
            X[2 * i:2 * i + 2] = rng.uniform(-3.5, 3.5, 2) if seed else [((i * 1.7) % 7) - 3.5, ((i * 2.3) % 5) - 2.5]
        return X

    def _vec(self, X, vals, reg=None, X0=None):
        r = [w * (1.0 if hard else 0.6) for w, _, hard in self.residuals(X, vals)]
        if reg:
            r += list(reg * (X - X0))
        return np.array(r, dtype=float)

    def _lm(self, X, vals, iters=60, reg=0.0, X0=None):
        lam = 1e-2
        f = self._vec(X, vals, reg, X0)
        cost = f @ f
        n = len(X)
        if n == 0:
            return X, cost
        for _ in range(iters):
            J = np.empty((len(f), n))
            h = 1e-6
            for j in range(n):
                Xp = X.copy()
                Xp[j] += h
                J[:, j] = (self._vec(Xp, vals, reg, X0) - f) / h
            A = J.T @ J
            g = J.T @ f
            improved = False
            for _ in range(8):
                try:
                    step = np.linalg.solve(A + lam * (np.diag(np.diag(A)) + 1e-6 * np.eye(n)), -g)
                except np.linalg.LinAlgError:
                    step = -np.linalg.lstsq(J, f, rcond=None)[0]
                Xn = X + step
                fn = self._vec(Xn, vals, reg, X0)
                cn = fn @ fn
                if cn < cost:
                    X, f, cost = Xn, fn, cn
                    lam = max(lam / 3, 1e-9)
                    improved = True
                    break
                lam *= 4
            if not improved or cost < 1e-16 or np.linalg.norm(step) < 1e-10:
                break
        return X, cost

    def solve(self, vals=None, warm=None, starts: int = 6, ks: float = 1.0) -> tuple[np.ndarray, float]:
        vals = self.state_vals if vals is None else vals
        self._ks = ks
        if not self.free:
            return np.zeros(0), 0.0
        best = None
        seeds = [None] if warm is not None else list(range(starts))
        for s in seeds:
            X0 = warm.copy() if warm is not None else self._guess(s)
            X, _ = self._lm(X0, vals, iters=40 if warm is not None else 80, reg=1e-3, X0=X0)
            X, _ = self._lm(X, vals, iters=30)  # polish without the gauge regulariser
            hard = sum(r * r for r, _, h in self.residuals(X, vals, which="hard") if h)
            soft = sum(r * r for r, _, h in self.residuals(X, vals) if not h)
            score = hard * 1e3 + soft
            if best is None or score < best[1] - 1e-12:
                best = (X, score)
            if warm is None and hard < 1e-12 and soft < 1e-6:
                break
        return best[0], best[1]

    # ── verification ──
    def constraint_report(self, X, vals, tol=2e-4) -> list[str]:
        out = []
        for c in self.cons:
            if c[0] not in HARD:
                continue
            try:
                r = self._res(c, X, vals)
            except Exception as exc:  # noqa: BLE001
                out.append(f"constraint {c!r} cannot be evaluated ({type(exc).__name__}: {str(exc)[:80]})")
                continue
            m = max([abs(x) for x in r] or [0])
            if m > tol:
                fixed = [x for x in self._refs_in(c) if x in self.objs and x not in self.idx and self.objs[x]["type"] == "point"]
                hint = ""
                if fixed:
                    hint = f"; {', '.join(fixed)} {'is' if len(fixed) == 1 else 'are'} pinned by \"at\" (remove \"at\" and let constraints place {'it' if len(fixed) == 1 else 'them'})"
                out.append(f"constraint {c!r} is not satisfied (off by {m:.3g}); it conflicts with the other constraints or the vars{hint}")
        return out

    def _refs_in(self, c) -> list[str]:
        out = []
        for a in c[1:]:
            for x in (a if isinstance(a, list) else [a]):
                if isinstance(x, str):
                    out += self.ref_points(x) if (x in self.objs or "-" in x) else []
        return list(dict.fromkeys(out))

    def soft_report(self, X, vals, tol=0.05) -> list[str]:
        out = []
        for c in self.cons:
            if c[0] in SOFT:
                try:
                    m = max([abs(x) for x in self._res(c, X, vals)] or [0])
                except Exception:  # noqa: BLE001
                    continue
                if m > tol:
                    out.append(f"layout relation {c!r} could not be met (off by {m:.2f})")
        ov = [x for x in self._apart(X, vals) if x > 0.05]
        if ov:
            out.append(f"{len(ov)} pair(s) of boxes/icons/axes overlap; give them relations (left_of/above/row/ring) or fewer items")
        return out

    def measure_env(self, X, vals):
        P = lambda r: self.pos(r, X, vals)  # noqa: E731

        def length(a, b=None):
            A, B = (P(a), P(b)) if b is not None else self._seg(a, X, vals)
            return float(np.linalg.norm(A - B))

        def angle(a, b, c):
            u, v = P(a) - P(b), P(c) - P(b)
            return float(math.acos(max(-1, min(1, (u @ v) / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-12)))))

        def area(pid):
            return float(abs(_shoelace([P(x) for x in self.ref_points(pid)])))

        def slope(a, b=None):
            A, B = (P(a), P(b)) if b is not None else self._seg(a, X, vals)
            return float((B[1] - A[1]) / (B[0] - A[0] + 1e-12))
        def ax_xy(ax, pid, k):
            f = self._axes_map(ax, X, vals)
            ux, uy = _axes_units(self.objs[ax])
            O = f(0, 0)
            Q = P(pid)
            return float((Q[0] - O[0]) / ux) if k == 0 else float((Q[1] - O[1]) / uy)
        return {"length": length, "len": length, "dist": length, "angle": angle, "area": area, "slope": slope,
                "x": lambda a: float(P(a)[0]), "y": lambda a: float(P(a)[1]),
                "ax_x": lambda ax, p: ax_xy(ax, p, 0), "ax_y": lambda ax, p: ax_xy(ax, p, 1),
                "f": lambda fid, x: self.fn_eval(fid, x, vals), "deriv": lambda fid, x: self.fn_deriv(fid, x, vals)}

    def eval_check_expr(self, expr, X, vals):
        env = self.measure_env(X, vals)
        s = _clean(expr) if isinstance(expr, str) else expr
        if isinstance(s, (int, float)):
            return float(s)
        # object ids as strings inside measure calls: length(A,B) -> length('A','B')
        ids = sorted(self.objs, key=len, reverse=True)
        def q(m):
            inner = m.group(2)
            parts = [x.strip() for x in _split_args(inner)]
            parts = [repr(x) if (x in self.objs or ("-" in x and all(y in self.objs for y in x.split("-", 1)))) else x for x in parts]
            return f"{m.group(1)}({', '.join(parts)})"
        s = re.sub(r"\b(length|len|dist|angle|area|slope|x|y|ax_x|ax_y|f|deriv)\(([^()]*)\)", q, s)
        safe = {"__builtins__": {}}
        loc = {**{k: getattr(math, k) for k in ("sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sqrt", "exp", "log", "pi", "floor", "ceil", "e")},
               "deg": math.pi / 180, "abs": abs, "min": min, "max": max, "round": round, **vals, **env}
        del ids
        return float(eval(s, safe, loc))  # noqa: S307  (names restricted to maths, vars and measures)

    def checks_report(self, X, vals) -> list[str]:
        out = []
        for c in self.ir.get("checks") or []:
            c = _as_list(c)
            kind = c[0]
            try:
                if kind == "balanced":
                    p = chem_balance_problem(c[1])
                    if p:
                        out.append(f"check {c!r}: {p}")
                    continue
                if kind == "eq":
                    a, b = self.eval_check_expr(c[1], X, vals), self.eval_check_expr(c[2], X, vals)
                    tol = float(c[3]) if len(c) > 3 else 1e-6 * max(1.0, abs(a), abs(b))
                    if not abs(a - b) <= max(tol, 1e-6):
                        msg = f"check {c!r} fails: {c[1]} = {a:.6g} but {c[2]} = {b:.6g}"
                        if "angle(" in str(c[1]) + str(c[2]):
                            msg += f" (in degrees {math.degrees(a):.1f} vs {math.degrees(b):.1f})"
                            if abs(a + b - math.pi) < 1e-3:
                                msg += "; they add to 180 degrees: one ray points the opposite way (e.g. the point is on the other side of the vertex, or the polar angle needs + pi)"
                            elif abs(a + b - math.pi / 2) < 1e-3:
                                msg += "; they add to 90 degrees: one angle is measured from the surface and the other from the normal"
                        out.append(msg)
                elif kind in ("lt", "gt", "le", "ge"):
                    a, b = self.eval_check_expr(c[1], X, vals), self.eval_check_expr(c[2], X, vals)
                    ok = {"lt": a < b, "gt": a > b, "le": a <= b + 1e-9, "ge": a >= b - 1e-9}[kind]
                    if not ok:
                        out.append(f"check {c!r} fails: {a:.6g} vs {b:.6g}")
                elif kind == "true":
                    if not self.eval_check_expr(c[1], X, vals):
                        out.append(f"check {c!r} is false")
            except Exception as exc:  # noqa: BLE001
                out.append(f"check {c!r} cannot be evaluated: {type(exc).__name__}: {str(exc)[:100]}")
        return out

    def equation_report(self) -> list[str]:
        """Equation objects: sym lines are parsed; a chain is checked for equivalence (same solutions); a line whose symbols are
        all vars must hold for the vars; chem equations must balance. Their LaTeX is generated here (never model-written)."""
        out = []
        names = {k: sp.Symbol(k) for k in self.vars.decl}
        for oid, o in self.objs.items():
            if o["type"] != "equation":
                continue
            if o.get("chem"):
                p = chem_balance_problem(o["chem"])
                if p:
                    out.append(f"equation {oid}: {o['chem']} is {p}")
                try:
                    o["_lines"] = [{"tex": chem_tex(o["chem"]), "note": o.get("note")}]
                except Exception as exc:  # noqa: BLE001
                    out.append(f"equation {oid}: {exc}")
                continue
            lines = o.get("lines") or ([{"sym": o["sym"]}] if o.get("sym") else [{"tex": o.get("tex")}])
            lines = [x if isinstance(x, dict) else {"sym": x} for x in lines]
            parsed, built = [], []
            for li, ln in enumerate(lines):
                if ln.get("sym"):
                    try:
                        free = {s: sp.Symbol(s) for s in re.findall(r"[A-Za-z_]\w*", ln["sym"]) if s not in _FUNCS and s not in names}
                        exprs, disp = eq_parse(ln["sym"], {**names, **free})
                    except Exception as exc:  # noqa: BLE001
                        out.append(f"equation {oid} line {li + 1} {ln['sym']!r}: {exc}")
                        continue
                    parsed.append((li, exprs))
                    tex = ln.get("tex") or eq_tex(disp)
                    built.append({"tex": tex, "note": ln.get("note"), "sym": ln["sym"]})
                    # all symbols are vars -> the line must hold numerically
                    syms = set().union(*[e.free_symbols for e in exprs])
                    if len(exprs) == 2 and syms and all(s.name in self.vars.decl for s in syms):
                        vals = self.vars.values()
                        lhs, rhs = (float(e.subs({sp.Symbol(k): v for k, v in vals.items()}).evalf()) for e in exprs)
                        if abs(lhs - rhs) > 1e-6 * max(1, abs(lhs), abs(rhs)):
                            out.append(f"equation {oid} line {li + 1} {ln['sym']!r} is false for the vars ({lhs:.6g} vs {rhs:.6g})")
                elif ln.get("tex"):
                    built.append({"tex": ln["tex"], "note": ln.get("note")})
                elif ln.get("text"):
                    built.append({"text": ln["text"], "note": ln.get("note")})
            o["_lines"] = built
            chain = o.get("chain", "equiv" if len(parsed) > 1 else None)
            if chain == "equiv" and len(parsed) > 1:
                eqs = [(li, e) for li, e in parsed if len(e) == 2]
                unknowns = set().union(*[(e[0] - e[1]).free_symbols for _, e in eqs]) - {sp.Symbol(k) for k in self.vars.decl}
                if eqs and unknowns:
                    vals = {sp.Symbol(k): v for k, v in self.vars.values().items()}
                    ref = None
                    for li, (l, r) in eqs:
                        try:
                            sol = sp.solve(sp.Eq(l.subs(vals), r.subs(vals)), sorted(unknowns, key=str), dict=True)
                        except Exception:  # noqa: BLE001
                            sol = None
                        key = sorted([tuple(sorted((str(k), sp.nsimplify(v)) for k, v in s.items())) for s in sol or []]) if sol is not None else None
                        if ref is None:
                            ref = (li, key)
                        elif key is not None and ref[1] is not None and key != ref[1]:
                            out.append(f"equation {oid}: line {li + 1} ({lines[li]['sym']}) does not follow from line {ref[0] + 1} "
                                       f"({lines[ref[0]]['sym']}): solutions {key} vs {ref[1]}")
            elif chain == "equal" and len(parsed) > 1:
                exprs = [e[-1] if len(e) == 1 else e[1] for _, e in parsed]
                for (li, e), x in zip(parsed[1:], exprs[1:]):
                    if sp.simplify(x - exprs[0]) != 0:
                        out.append(f"equation {oid}: line {li + 1} is not equal to the first")
        return out

    # ── states the beats go through ──
    def states(self) -> list[tuple[str, dict]]:
        """(label, overrides) for every state the beats reach: start, each set, and 3 samples of each animate."""
        ov: dict = {}
        out = [("start", {})]
        for bi, b in enumerate(self.ir.get("beats") or []):
            for a in b.get("do") or []:
                a = _as_list(a)
                if not a:
                    continue
                if a[0] == "set" and len(a) > 1 and isinstance(a[1], dict):
                    cur = self.vars.values(ov)
                    for k, v in a[1].items():
                        if k in self.vars.decl:
                            try:
                                ov[k] = self.vars.eval(v, cur)
                            except Exception:  # noqa: BLE001
                                pass
                    out.append((f"beat {bi + 1} set", dict(ov)))
                elif a[0] == "animate" and len(a) >= 3 and a[1] in self.vars.decl:
                    cur = self.vars.values(ov)
                    try:
                        v0, v1 = cur[a[1]], self.vars.eval(a[2], cur)
                    except Exception:  # noqa: BLE001
                        continue
                    for f in (0.33, 0.67, 1.0):
                        out.append((f"beat {bi + 1} animate {a[1]}", {**ov, a[1]: v0 + f * (v1 - v0)}))
                    ov[a[1]] = v1
        return out

    def build(self, stage_box=None) -> dict:
        """Solve every state, verify, and fit to the stage. Returns {"ok", "problems", "warnings", "states": [...], "transform"}."""
        if self.problems:
            return {"ok": False, "problems": self.problems, "warnings": self.warnings}
        probs = list(self.equation_report())
        sts = self.states()
        solved = []
        X = None
        ks = 1.0
        # block sizes are frame units; the world is scaled to fit the stage, so re-solve with sizes in world units
        prevX = {}
        for it in range(3):
            solved = []
            X = None
            for label, ov in sts:
                vals = self.vars.values(ov)
                if any(isinstance(v, float) and math.isnan(v) for v in vals.values()):
                    bad = [k for k, v in vals.items() if isinstance(v, float) and math.isnan(v)]
                    probs.append(f"{label}: var(s) {', '.join(bad)} have no real value")
                    return {"ok": False, "problems": list(dict.fromkeys(probs)), "warnings": self.warnings}
                warm = prevX.get(label) if prevX.get(label) is not None else (X if X is not None and label != "start" else None)
                X, _ = self.solve(vals, warm=warm, ks=ks)
                if label != "start":
                    X2, s2 = self.solve(vals, warm=None, starts=2, ks=ks) if self.constraint_report(X, vals) else (X, 0)
                    X = X2
                solved.append((label, ov, vals, X))
            prevX = {lab: x for lab, _, _, x in solved}
            if stage_box is None:
                break
            bb = self.bbox_all(solved)
            k = _fit_scale(bb, stage_box)
            if abs(k - ks) / max(ks, 1e-6) < 0.08:
                ks = k
                break
            ks = k
        seen_kind: dict = {}
        for label, ov, vals, X in solved:
            for m in self.constraint_report(X, vals) + self.checks_report(X, vals) + self._degenerate(X, vals):
                key = m.split(" fails")[0].split(" is not satisfied")[0][:120]
                if key in seen_kind:
                    seen_kind[key][1] += 1
                    continue
                seen_kind[key] = [f"{label}: {m}", 0]
        for key, (m, more) in seen_kind.items():
            probs.append(m + (f" (also fails in {more} later state(s) of the animation)" if more else ""))
        warn = []
        for label, ov, vals, X in solved[:1] + solved[-1:]:
            warn += self.soft_report(X, vals)
        self.warnings += list(dict.fromkeys(warn))
        probs = list(dict.fromkeys(probs))
        self.solved = solved
        self.X = solved[0][3] if solved else np.zeros(0)
        self.state_vals = solved[0][2] if solved else self.vars.values()
        if stage_box is not None and solved:
            bb = self.bbox_all(solved)
            ks = _fit_scale(bb, stage_box)
            wc = np.array([(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2])
            fc = np.array([(stage_box[0] + stage_box[2]) / 2, (stage_box[1] + stage_box[3]) / 2])
            self.transform = (wc, ks, fc)
            if ks < 0.3:
                self.warnings.append(f"the scene is large for the frame (scaled to {ks:.2f}); fewer or smaller parts would read better")
        return {"ok": not probs, "problems": probs[:14], "warnings": self.warnings[:10], "scale": round(self.transform[1], 3)}

    def _degenerate(self, X, vals):
        out = []
        for oid, o in self.objs.items():
            try:
                if o["type"] == "polygon":
                    pts = [self.pos(p, X, vals) for p in o["points"]]
                    if len(pts) >= 3 and abs(_shoelace(pts)) < 1e-3:
                        out.append(f"polygon {oid} has zero area (its points are collinear or coincide)")
                elif o["type"] in ("segment", "vector") and isinstance(o.get("to"), str):
                    if np.linalg.norm(self.pos(o["from"], X, vals) - self.pos(o["to"], X, vals)) < 1e-4:
                        out.append(f"{o['type']} {oid} has zero length")
                elif o["type"] == "circle" and self.radius(oid, X, vals) <= 1e-4:
                    out.append(f"circle {oid} has zero radius")
            except Exception:  # noqa: BLE001
                continue
        return out

    def bbox_all(self, solved) -> list[float]:
        xs, ys = [], []
        for _, _, vals, X in solved:
            for oid, o in self.objs.items():
                t = o["type"]
                try:
                    if t == "point" and not o.get("_implicit"):
                        p = self.pos(oid, X, vals)
                        xs.append(p[0]); ys.append(p[1])  # noqa: E702
                    elif t in BLOCKS:
                        c = self.pos(oid, X, vals)
                        h = np.array(self.sizes[oid]) / 2 / max(self._ks, 1e-6)
                        xs += [c[0] - h[0], c[0] + h[0]]; ys += [c[1] - h[1], c[1] + h[1]]  # noqa: E702
                    elif t in ("circle", "arc"):
                        c, r = self.pos(o["center"], X, vals), self.radius(oid, X, vals)
                        xs += [c[0] - r, c[0] + r]; ys += [c[1] - r, c[1] + r]  # noqa: E702
                    elif t in ("polygon", "polyline", "wire"):
                        for p in o["points"]:
                            q = self.pos(p, X, vals)
                            xs.append(q[0]); ys.append(q[1])  # noqa: E702
                    elif t in ({"segment", "vector"} | TWO_TERMINAL):
                        for q in (self.pos(o["from"], X, vals), self.end(oid, X, vals)):
                            xs.append(q[0]); ys.append(q[1])  # noqa: E702
                except Exception:  # noqa: BLE001
                    continue
        if not xs:
            return [-1, -1, 1, 1]
        pad = 0.35
        return [min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad]

    def to_frame(self, p):
        wc, k, fc = self.transform
        return fc + k * (np.asarray(p, dtype=float)[:2] - wc)


def describe(w: "World", max_lines: int = 60) -> str:
    """What the solved scene actually is, in numbers the reviewer does not have to compute: every polygon's side lengths, angles
    and area, congruent pieces, circles, segment lengths/directions, vectors, the values of the vars at the start and end."""
    if not getattr(w, "solved", None):
        return ""
    out = []
    for label, ov, vals, X in (w.solved[:1] + (w.solved[-1:] if len(w.solved) > 1 else [])):
        out.append(f"[{label}] vars: " + ", ".join(f"{k}={v:.4g}" for k, v in list(vals.items())[:14]))
        polys = {}
        for oid, o in w.objs.items():
            t = o["type"]
            try:
                if t == "polygon":
                    P = [w.pos(p, X, vals) for p in o["points"]]
                    n = len(P)
                    sides = [float(np.linalg.norm(P[(i + 1) % n] - P[i])) for i in range(n)]
                    angs = []
                    for i in range(n):
                        u, v = P[i - 1] - P[i], P[(i + 1) % n] - P[i]
                        angs.append(math.degrees(math.acos(max(-1, min(1, (u @ v) / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-12))))))
                    polys[oid] = (tuple(sorted(round(x, 3) for x in sides)), round(abs(_shoelace(P)), 3))
                    out.append(f"polygon {oid} ({'-'.join(o['points'])}): sides {', '.join(f'{x:.3g}' for x in sides)}; angles {', '.join(f'{a:.0f}' for a in angs)} deg; area {abs(_shoelace(P)):.4g}")
                elif t == "circle":
                    out.append(f"circle {oid}: centre {o['center']}, radius {w.radius(oid, X, vals):.3g}")
                elif t in ("segment", "line", "ray", "vector") and o.get("from"):
                    A, B = w.pos(o["from"], X, vals), w.end(oid, X, vals)
                    d = B - A
                    out.append(f"{t} {oid} {o['from']}->{o.get('to', 'comp')}: length {np.linalg.norm(d):.3g}, direction {math.degrees(math.atan2(d[1], d[0])):.0f} deg")
                elif t == "function":
                    out.append(f"function {oid}: y = {o.get('expr')} on {o.get('on')}")
                elif t in ("box", "icon", "cells"):
                    c = w.pos(oid, X, vals)
                    out.append(f"{t} {oid} '{str(o.get('text') or o.get('tex') or o.get('icon') or o.get('values'))[:40]}' at ({c[0]:.1f}, {c[1]:.1f})")
                elif t == "flow":
                    out.append(f"flow {oid}: {o.get('from')} -> {o.get('to')}" + (f" '{o.get('label')}'" if o.get("label") else ""))
            except Exception:  # noqa: BLE001
                continue
        groups = {}
        for k, v in polys.items():
            groups.setdefault(v, []).append(k)
        same = [g for g in groups.values() if len(g) > 1]
        if same:
            out.append("congruent pieces (same sides and area): " + "; ".join(", ".join(g) for g in same))
        if len(out) > max_lines:
            break
    return "\n".join(out[:max_lines])


def _fit_scale(bb, box):
    w, h = max(bb[2] - bb[0], 1e-3), max(bb[3] - bb[1], 1e-3)
    return float(min((box[2] - box[0]) / w, (box[3] - box[1]) / h, 2.5))


def _shoelace(pts):
    pts = np.asarray(pts)
    x, y = pts[:, 0], pts[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def _seg_dist(P, A, B):
    d = B - A
    t = max(0.0, min(1.0, ((P - A) @ d) / (d @ d + 1e-12)))
    return float(np.linalg.norm(P - (A + t * d)))


def _split_args(s):
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch == "," and depth == 0:
            out.append(cur)
            cur = ""
            continue
        depth += ch in "([" and 1 or (-1 if ch in ")]" else 0)
        cur += ch
    if cur.strip():
        out.append(cur)
    return out


def pick_text(v, vals: dict, index: str | None = None):
    """A text or tex given as a list shows item int(vals[index or "step"]) (clamped): one box that changes as the steps go."""
    if isinstance(v, list):
        if not v:
            return ""
        k = int(round(vals.get(index or "step", 0))) if (index or "step") in vals else 0
        return str(v[max(0, min(len(v) - 1, k))])
    return v


def fmt_template(s: str, vals: dict) -> str:
    """'I = {I:.1f} A' -> 'I = 3.0 A'; '{n}' of a whole number prints without decimals."""
    def rep(m):
        name, spec = m.group(1), m.group(2) or ""
        try:
            v = vals[name] if name in vals else eval(_clean(name), {"__builtins__": {}}, {**{k: getattr(math, k) for k in ("sin", "cos", "tan", "sqrt", "pi", "floor", "ceil", "asin", "acos", "atan")}, "deg": math.pi / 180, "abs": abs, "round": round, "min": min, "max": max, **vals})  # noqa: S307
        except Exception:  # noqa: BLE001
            return m.group(0)
        if abs(v) < 5e-10:
            v = 0.0
        if not spec:
            if abs(v - round(v)) < 1e-9:
                return str(int(round(v)))
            return f"{v:.3g}"
        try:
            return format(v, spec.lstrip(":"))
        except Exception:  # noqa: BLE001
            return str(v)
    return re.sub(r"\{([^{}:]+)(:[^{}]*)?\}", rep, str(s))


def verify_ir(ir: dict, aspect: str = "16:9", stage_box=None) -> dict:
    w = World(ir, aspect)
    return w.build(stage_box or [-4.5, -2.7, 4.5, 2.7])

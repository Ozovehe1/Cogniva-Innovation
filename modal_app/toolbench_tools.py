"""
Ideanimo tool bench: the tool implementations (no Modal imports).

Each call runs in a fresh child process as an unprivileged user inside a Modal container that has
no network (block_network=True) and no secrets (see tool_bench.py). This module is that child:

    python toolbench_tools.py <workdir>      # reads <workdir>/job.json, writes <workdir>/result.json

Every tool follows prepare -> run -> validate -> fallback and returns

    {"ok": bool, "result": {...}, "artifacts": [{"name", "mime", "b64"|"text"}], "state": {...},
     "logs": "...", "error": str|None, "fallback": {"tool", "reason", "args"?}|None}

`state` is small JSON the agent can read back (or send back in a later call's `context`).
"""

from __future__ import annotations

import base64
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import traceback

MAX_ARTIFACT_BYTES = 6 * 1024 * 1024      # per call, after base64
MAX_TEXT = 12000


class ToolError(Exception):
    """A clear, learner-safe error with an optional cheaper alternative."""

    def __init__(self, msg: str, fallback: dict | None = None):
        super().__init__(msg)
        self.fallback = fallback


# ---------------------------------------------------------------------------------------------
# helpers

class Out:
    def __init__(self):
        self.artifacts: list[dict] = []
        self.logs: list[str] = []
        self.bytes = 0

    def log(self, *a):
        self.logs.append(" ".join(str(x) for x in a))

    def add_bytes(self, name: str, mime: str, data: bytes):
        b64 = base64.b64encode(data).decode()
        if self.bytes + len(b64) > MAX_ARTIFACT_BYTES:
            self.log(f"artifact {name} dropped: output size cap ({MAX_ARTIFACT_BYTES // 1024 // 1024} MB) reached")
            return False
        self.bytes += len(b64)
        self.artifacts.append({"name": name, "mime": mime, "b64": b64, "bytes": len(data)})
        return True

    def add_text(self, name: str, mime: str, text: str):
        if self.bytes + len(text) > MAX_ARTIFACT_BYTES:
            self.log(f"artifact {name} dropped: output size cap reached")
            return False
        self.bytes += len(text)
        self.artifacts.append({"name": name, "mime": mime, "text": text, "bytes": len(text)})
        return True

    def add_file(self, path: str, mime: str, name: str | None = None):
        with open(path, "rb") as f:
            data = f.read()
        if mime in ("image/svg+xml", "chemical/x-mdl-molfile", "application/json", "text/plain"):
            return self.add_text(name or os.path.basename(path), mime, data.decode("utf-8", "replace"))
        return self.add_bytes(name or os.path.basename(path), mime, data)


def need(args: dict, key: str, kind=str, max_len: int = 20000):
    v = args.get(key)
    if v is None or (isinstance(v, str) and not v.strip()):
        raise ToolError(f"missing required arg '{key}'")
    if kind is str:
        v = str(v)
        if len(v) > max_len:
            raise ToolError(f"arg '{key}' is too long ({len(v)} > {max_len} chars)")
    return v


def run_cmd(cmd: list[str], timeout: float, cwd: str | None = None, stdin: str | None = None, env: dict | None = None):
    try:
        p = subprocess.run(cmd, cwd=cwd, input=stdin, capture_output=True, text=True, timeout=timeout,
                           env={**os.environ, **(env or {})})
    except subprocess.TimeoutExpired:
        raise ToolError(f"{os.path.basename(cmd[0])} timed out after {timeout:.0f} s")
    except FileNotFoundError:
        raise ToolError(f"{cmd[0]} is not installed in this image")
    return p.returncode, (p.stdout or "")[-MAX_TEXT:], (p.stderr or "")[-MAX_TEXT:]


def png_nonblank(data: bytes) -> tuple[bool, float]:
    """True if the PNG has visible variation (std of greyscale > 2)."""
    try:
        import numpy as np
        from PIL import Image
        im = np.asarray(Image.open(io.BytesIO(data)).convert("L"), dtype=float)
        s = float(im.std())
        return s > 2.0, round(s, 2)
    except Exception:
        return len(data) > 2000, -1.0


def fig_png(fig, dpi=110) -> bytes:
    b = io.BytesIO()
    fig.savefig(b, format="png", dpi=dpi, bbox_inches="tight")
    return b.getvalue()


def fig_svg(fig) -> str:
    b = io.StringIO()
    fig.savefig(b, format="svg", bbox_inches="tight")
    return b.getvalue()


def mpl():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({"figure.figsize": (6.4, 4.0), "axes.grid": True, "grid.alpha": 0.3, "font.size": 10})
    return plt


def safe_sympify(expr: str, symbols: dict | None = None):
    import sympy as sp
    from sympy.parsing.sympy_parser import (convert_xor, implicit_multiplication_application, parse_expr,
                                            standard_transformations)
    if re.search(r"__|\bimport\b|\blambda\b|\bexec\b|\beval\b|\bopen\b", expr):
        raise ToolError("expression contains disallowed tokens")
    tr = standard_transformations + (implicit_multiplication_application, convert_xor)
    loc = {k: v for k, v in vars(sp).items() if not k.startswith("_")}
    loc.update(symbols or {})
    if "=" in expr and "==" not in expr and not re.search(r"[<>!]=", expr):
        l, r = expr.split("=", 1)
        return sp.Eq(parse_expr(l, local_dict=loc, transformations=tr), parse_expr(r, local_dict=loc, transformations=tr))
    return parse_expr(expr, local_dict=loc, transformations=tr)


# ---------------------------------------------------------------------------------------------
# compute image

def t_sympy(args, ctx, out: Out):
    """op: simplify|expand|factor|solve|diff|integrate|limit|series|evaluate|latex|plot"""
    import sympy as sp
    op = args.get("op", "simplify")
    expr_s = need(args, "expr", max_len=4000)
    var_s = args.get("var") or None
    expr = safe_sympify(expr_s)
    free = sorted(expr.free_symbols, key=lambda s: s.name) if hasattr(expr, "free_symbols") else []
    var = sp.Symbol(var_s) if var_s else (free[0] if free else sp.Symbol("x"))
    res = None
    if op == "simplify":
        res = sp.simplify(expr)
    elif op == "expand":
        res = sp.expand(expr)
    elif op == "factor":
        res = sp.factor(expr)
    elif op == "solve":
        sols = sp.solve(expr, var, dict=False)
        res = sols
    elif op == "diff":
        res = sp.diff(expr, var, int(args.get("order", 1)))
    elif op == "integrate":
        if "lower" in args and "upper" in args:
            res = sp.integrate(expr, (var, safe_sympify(str(args["lower"])), safe_sympify(str(args["upper"]))))
        else:
            res = sp.integrate(expr, var)
    elif op == "limit":
        res = sp.limit(expr, var, safe_sympify(str(args.get("to", 0))), dir=args.get("dir", "+-") if args.get("dir") else "+")
    elif op == "series":
        res = sp.series(expr, var, safe_sympify(str(args.get("at", 0))), int(args.get("n", 6))).removeO()
    elif op == "evaluate":
        subs = {sp.Symbol(k): safe_sympify(str(v)) for k, v in (args.get("subs") or {}).items()}
        res = sp.N(expr.subs(subs), int(args.get("digits", 10)))
    elif op == "latex":
        res = expr
    elif op == "plot":
        import numpy as np
        plt = mpl()
        lo, hi = float(args.get("xmin", -5)), float(args.get("xmax", 5))
        f = sp.lambdify(var, expr, "numpy")
        xs = np.linspace(lo, hi, 600)
        with np.errstate(all="ignore"):
            ys = np.asarray(f(xs), dtype=float) * np.ones_like(xs)
        ys[~np.isfinite(ys)] = np.nan
        if np.all(np.isnan(ys)):
            raise ToolError("the expression has no real values on that range", {"tool": "sympy", "reason": "try another xmin/xmax"})
        fig, ax = plt.subplots()
        ax.plot(xs, ys, lw=2, color="#2563eb")
        ax.axhline(0, color="k", lw=0.6); ax.axvline(0, color="k", lw=0.6)
        ax.set_xlabel(str(var)); ax.set_title(f"${sp.latex(expr)}$")
        png = fig_png(fig)
        ok, std = png_nonblank(png)
        if not ok:
            raise ToolError("plot came out blank")
        out.add_bytes("plot.png", "image/png", png)
        res = expr
    else:
        raise ToolError(f"unknown op '{op}'")
    text = str(res)
    latex = sp.latex(res) if not isinstance(res, list) else ", ".join(sp.latex(r) for r in res)
    # validate: for solve, substitute back
    checks = {}
    if op == "solve" and isinstance(res, list):
        eq = expr.lhs - expr.rhs if isinstance(expr, sp.Equality) else expr
        checks["residuals_zero"] = all(sp.simplify(eq.subs(var, s)) == 0 for s in res[:10])
    if op == "diff" and int(args.get("order", 1)) == 1:
        try:
            checks["integrates_back"] = sp.simplify(sp.integrate(res, var) - expr).free_symbols.issubset({var}) and sp.simplify(sp.diff(sp.integrate(res, var) - expr, var)) == 0
        except Exception:
            pass
    return {"text": text, "latex": latex, "var": str(var), "checks": checks}, {"expr": text, "var": str(var)}


def t_numeric(args, ctx, out: Out):
    """op: ode (y' = f(t,y) system) | roots (polynomial coeffs) | fsolve | fit (polyfit) | linsolve | stats"""
    import numpy as np
    op = need(args, "op")
    if op == "roots":
        r = np.roots([float(c) for c in args["coeffs"]])
        return {"roots": [[float(z.real), float(z.imag)] for z in r]}, {}
    if op == "linsolve":
        A = np.array(args["A"], dtype=float); b = np.array(args["b"], dtype=float)
        x = np.linalg.solve(A, b)
        resid = float(np.abs(A @ x - b).max())
        if resid > 1e-6:
            raise ToolError("linear system is ill-conditioned")
        return {"x": x.tolist(), "residual": resid, "cond": float(np.linalg.cond(A))}, {"x": x.tolist()}
    if op == "fit":
        x = np.array(args["x"], dtype=float); y = np.array(args["y"], dtype=float); deg = int(args.get("deg", 1))
        c = np.polyfit(x, y, deg)
        pred = np.polyval(c, x)
        ss = float(((y - pred) ** 2).sum()); st = float(((y - y.mean()) ** 2).sum()) or 1.0
        plt = mpl(); fig, ax = plt.subplots()
        ax.scatter(x, y, color="#111827", s=18, label="data")
        xs = np.linspace(x.min(), x.max(), 300); ax.plot(xs, np.polyval(c, xs), color="#2563eb", label=f"degree {deg} fit"); ax.legend()
        out.add_bytes("fit.png", "image/png", fig_png(fig))
        return {"coeffs": c.tolist(), "r2": 1 - ss / st}, {"coeffs": c.tolist()}
    if op == "stats":
        x = np.array(args["data"], dtype=float)
        return {"n": int(x.size), "mean": float(x.mean()), "std": float(x.std(ddof=1)) if x.size > 1 else 0.0,
                "min": float(x.min()), "max": float(x.max()), "median": float(np.median(x))}, {}
    if op == "ode":
        import sympy as sp
        from scipy.integrate import solve_ivp
        eqs = args["rhs"] if isinstance(args["rhs"], list) else [args["rhs"]]
        names = args.get("vars") or [f"y{i}" for i in range(len(eqs))] if len(eqs) > 1 else (args.get("vars") or ["y"])
        t = sp.Symbol("t"); ys = sp.symbols(names)
        ys = list(ys) if isinstance(ys, (list, tuple)) else [ys]
        loc = {n: s for n, s in zip(names, ys)}; loc["t"] = t
        exprs = [safe_sympify(e, loc) for e in eqs]
        f = sp.lambdify((t, ys), exprs, "numpy")
        t0, t1 = float(args.get("t0", 0)), float(args.get("t1", 10))
        y0 = [float(v) for v in (args["y0"] if isinstance(args["y0"], list) else [args["y0"]])]
        sol = solve_ivp(lambda tt, yy: f(tt, yy), (t0, t1), y0, dense_output=True, max_step=(t1 - t0) / 200, rtol=1e-7)
        if not sol.success:
            raise ToolError(f"integration failed: {sol.message}", {"tool": "python", "reason": "write a custom stepper"})
        T = np.linspace(t0, t1, 400); Y = sol.sol(T)
        plt = mpl(); fig, ax = plt.subplots()
        for i, n in enumerate(names):
            ax.plot(T, Y[i], label=n, lw=2)
        ax.set_xlabel("t"); ax.legend()
        out.add_bytes("ode.png", "image/png", fig_png(fig))
        step = max(1, len(T) // 40)
        return {"t": T[::step].round(5).tolist(), "y": [row[::step].round(6).tolist() for row in Y],
                "final": [float(v) for v in Y[:, -1]]}, {"final": [float(v) for v in Y[:, -1]]}
    if op == "fsolve":
        import sympy as sp
        from scipy.optimize import fsolve
        eqs = args["eqs"]; names = args["vars"]
        syms = sp.symbols(names); syms = list(syms) if isinstance(syms, (list, tuple)) else [syms]
        loc = dict(zip(names, syms))
        exprs = []
        for e in eqs:
            x = safe_sympify(e, loc)
            exprs.append(x.lhs - x.rhs if isinstance(x, sp.Equality) else x)
        f = sp.lambdify([syms], exprs, "numpy")
        guess = [float(g) for g in args.get("guess", [1.0] * len(syms))]
        sol, info, ier, msg = fsolve(lambda v: f(v), guess, full_output=True)
        resid = float(np.abs(np.array(f(sol), dtype=float)).max())
        if ier != 1 or resid > 1e-6:
            raise ToolError(f"no converged solution from that guess ({msg.strip()})", {"tool": "sympy", "reason": "try op=solve symbolically or another guess"})
        return {"solution": dict(zip(names, map(float, sol))), "residual": resid}, {"solution": dict(zip(names, map(float, sol)))}
    raise ToolError(f"unknown op '{op}'")


def t_chart(args, ctx, out: Out):
    """Data story chart: rows (list of dicts) or csv text -> Vega-Lite spec + matplotlib PNG + summary."""
    import pandas as pd
    if args.get("csv"):
        df = pd.read_csv(io.StringIO(need(args, "csv", max_len=200000)))
    else:
        df = pd.DataFrame(args.get("rows") or [])
    if df.empty:
        raise ToolError("no data rows")
    df = df.head(5000)
    x = args.get("x") or df.columns[0]
    ys = args.get("y") or [c for c in df.columns if c != x and pd.api.types.is_numeric_dtype(df[c])][:3]
    ys = ys if isinstance(ys, list) else [ys]
    kind = args.get("kind", "line")
    for c in [x, *ys]:
        if c not in df.columns:
            raise ToolError(f"column '{c}' not in data (have {list(df.columns)})")
    mark = {"line": "line", "bar": "bar", "scatter": "point", "area": "area"}.get(kind, "line")
    xtype = "quantitative" if pd.api.types.is_numeric_dtype(df[x]) else ("temporal" if "date" in x.lower() or "time" in x.lower() else "nominal")
    long = df[[x, *ys]].melt(id_vars=[x], var_name="series", value_name="value")
    spec = {"$schema": "https://vega.github.io/schema/vega-lite/v5.json", "title": args.get("title", ""),
            "data": {"values": json.loads(long.head(2000).to_json(orient="records"))},
            "mark": {"type": mark, "tooltip": True}, "width": "container", "height": 260,
            "encoding": {"x": {"field": x, "type": xtype}, "y": {"field": "value", "type": "quantitative"},
                         "color": {"field": "series", "type": "nominal"}}}
    plt = mpl(); fig, ax = plt.subplots()
    for c in ys:
        if mark == "bar":
            ax.bar(df[x].astype(str) if xtype == "nominal" else df[x], df[c], label=c, alpha=0.8)
        elif mark == "point":
            ax.scatter(df[x], df[c], label=c, s=16)
        else:
            ax.plot(df[x], df[c], label=c, lw=2)
    ax.set_xlabel(x); ax.legend(); ax.set_title(args.get("title", ""))
    png = fig_png(fig)
    if not png_nonblank(png)[0]:
        raise ToolError("chart came out blank")
    out.add_bytes("chart.png", "image/png", png)
    out.add_text("chart.vl.json", "application/json", json.dumps(spec))
    summary = {c: {"min": float(df[c].min()), "max": float(df[c].max()), "mean": float(df[c].mean()),
                   "first": float(df[c].iloc[0]), "last": float(df[c].iloc[-1])} for c in ys}
    return {"summary": summary, "rows": int(len(df)), "vega_lite": spec}, {"x": x, "y": ys}


def t_units(args, ctx, out: Out):
    """op: convert {quantity, to} | check {lhs, rhs} (dimensions equal?) | compute {expr} (expression with units)"""
    import pint
    ureg = pint.UnitRegistry()
    Q = ureg.Quantity
    op = args.get("op", "convert")
    if op == "convert":
        q = ureg.parse_expression(need(args, "quantity", max_len=500))
        r = q.to(need(args, "to", max_len=200))
        return {"value": float(r.magnitude), "unit": str(r.units), "text": f"{r:~P}"}, {"value": float(r.magnitude), "unit": str(r.units)}
    if op == "check":
        l = ureg.parse_expression(need(args, "lhs", max_len=500)); r = ureg.parse_expression(need(args, "rhs", max_len=500))
        ld = dict(getattr(l, "dimensionality", {})) ; rd = dict(getattr(r, "dimensionality", {}))
        ok = l.dimensionality == r.dimensionality if hasattr(l, "dimensionality") and hasattr(r, "dimensionality") else False
        res = {"consistent": ok, "lhs_dim": str(getattr(l, "dimensionality", "")), "rhs_dim": str(getattr(r, "dimensionality", ""))}
        if ok:
            res["ratio"] = float((l / r).to("dimensionless").magnitude)
        return res, {"consistent": ok}
    if op == "compute":
        q = ureg.parse_expression(need(args, "expr", max_len=1000))
        if args.get("to"):
            q = q.to(args["to"])
        elif hasattr(q, "to_compact"):
            q = q.to_base_units().to_compact() if args.get("base") else q
        return {"value": float(q.magnitude), "unit": str(q.units), "text": f"{q:~P}", "dim": str(q.dimensionality)}, {}
    raise ToolError(f"unknown op '{op}'")


def t_z3(args, ctx, out: Out):
    """Z3 constraints: {vars: {name: 'Int'|'Real'|'Bool'}, constraints: ['x + y == 10', 'x > y'], prove?: 'expr'}"""
    import z3
    vars_ = args.get("vars") or {}
    if not vars_ or len(vars_) > 50:
        raise ToolError("give 1-50 vars as {name: Int|Real|Bool}")
    env = {}
    for n, t in vars_.items():
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,30}", n):
            raise ToolError(f"bad var name {n}")
        env[n] = {"Int": z3.Int, "Real": z3.Real, "Bool": z3.Bool}.get(t, z3.Real)(n)
    env.update({"And": z3.And, "Or": z3.Or, "Not": z3.Not, "Implies": z3.Implies, "If": z3.If, "Sum": z3.Sum, "Distinct": z3.Distinct})

    def p(e):
        if re.search(r"__|import|lambda|open|exec|eval", e):
            raise ToolError("disallowed token in constraint")
        return eval(e, {"__builtins__": {}}, env)  # noqa: S307 - restricted env, isolated process

    s = z3.Solver(); s.set("timeout", int(args.get("timeout_ms", 8000)))
    for c in (args.get("constraints") or [])[:200]:
        s.add(p(c))
    if args.get("prove"):
        s.add(z3.Not(p(args["prove"])))
        r = s.check()
        if r == z3.unsat:
            return {"proved": True}, {"proved": True}
        if r == z3.sat:
            m = s.model()
            return {"proved": False, "counterexample": {str(d): str(m[d]) for d in m.decls()}}, {"proved": False}
        return {"proved": None, "status": "unknown"}, {}
    r = s.check()
    if r == z3.sat:
        m = s.model()
        return {"sat": True, "model": {str(d): str(m[d]) for d in m.decls()}}, {"sat": True}
    return {"sat": False if r == z3.unsat else None, "status": str(r)}, {"sat": r == z3.sat}


PY_PRELUDE = r'''
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.show = lambda *a, **k: None
'''


def t_python(args, ctx, out: Out):
    """Untrusted Python (numpy, scipy, sympy, pandas, matplotlib, pint, z3, networkx). No network, time + memory capped."""
    code = need(args, "code", max_len=20000)
    limit = min(float(args.get("timeout", 20)), 30)
    with open("user_code.py", "w") as f:
        f.write(code)
    runner = PY_PRELUDE + r'''
import io, contextlib, traceback, json, base64
buf = io.StringIO(); err = None
try:
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        exec(compile(open("user_code.py").read(), "<code>", "exec"), {"__name__": "__main__", "plt": plt})
except BaseException as e:
    err = "".join(traceback.format_exception_only(type(e), e)).strip()[-1500:]
imgs = []
for n in plt.get_fignums()[:4]:
    b = io.BytesIO(); plt.figure(n).savefig(b, format="png", dpi=110, bbox_inches="tight"); imgs.append(base64.b64encode(b.getvalue()).decode())
json.dump({"stdout": buf.getvalue()[-8000:], "error": err, "images": imgs}, open("py_result.json", "w"))
'''
    with open("py_runner.py", "w") as f:
        f.write(runner)
    rc, so, se = run_cmd([sys.executable, "py_runner.py"], timeout=limit + 2)
    if not os.path.exists("py_result.json"):
        raise ToolError(("crashed: " + (se or so)[-800:]) if (se or so) else "crashed (memory limit?)")
    r = json.load(open("py_result.json"))
    for i, im in enumerate(r["images"]):
        out.add_bytes(f"figure{i + 1}.png", "image/png", base64.b64decode(im))
    if r["error"]:
        return {"stdout": r["stdout"], "error": r["error"]}, {"failed": True}
    return {"stdout": r["stdout"]}, {}


def t_octave(args, ctx, out: Out):
    """GNU Octave code (MATLAB-style). Figures are saved as PNG."""
    code = need(args, "code", max_len=20000)
    if re.search(r"\b(system|unix|dos|shell_cmd|popen|urlread|webread|websave)\s*\(", code):
        raise ToolError("system/network calls are not allowed", {"tool": "python", "reason": "use the python tool"})
    wrapped = "graphics_toolkit('gnuplot'); set(0,'defaultfigurevisible','off');\n" + code + \
        "\nh=get(0,'children'); for i=1:numel(h); print(h(i), sprintf('oct_fig%d.png',i), '-dpng', '-r100'); end\n"
    with open("main.m", "w") as f:
        f.write(wrapped)
    rc, so, se = run_cmd(["octave-cli", "--no-gui", "--quiet", "--no-window-system", "main.m"], timeout=min(float(args.get("timeout", 25)), 40))
    figs = sorted(f for f in os.listdir(".") if f.startswith("oct_fig") and f.endswith(".png"))
    for f in figs[:4]:
        out.add_file(f, "image/png")
    if rc != 0:
        raise ToolError("octave error: " + (se or so)[-1500:], {"tool": "python", "reason": "same computation with numpy/scipy"})
    return {"stdout": so[-8000:], "stderr": se[-2000:], "figures": len(figs)}, {}


# ---------------------------------------------------------------------------------------------
# science/engineering image

SPICE_UNSAFE = re.compile(r"^\s*\.?(shell|system|exec|load|source|write|wrdata|hardcopy|setcs|codemodel|osdi|cd)\b", re.I | re.M)


def t_spice(args, ctx, out: Out):
    """ngspice: netlist -> analysis data + waveform plot. args: netlist, analysis ('op'|'tran 1u 5m'|'ac dec 20 1 1meg'|'dc V1 0 5 0.1'), probes ['v(out)','i(V1)']"""
    import numpy as np
    netlist = need(args, "netlist", max_len=20000)
    if SPICE_UNSAFE.search(netlist):
        raise ToolError("netlist contains disallowed control commands")
    lines = [l for l in netlist.strip().splitlines() if not re.match(r"^\s*\.(end|control|endc)\b", l, re.I)]
    analysis = (args.get("analysis") or "op").strip()
    if not re.fullmatch(r"(op|tran|ac|dc)(\s+[-\w.+]+){0,8}", analysis, re.I):
        raise ToolError("analysis must be op | tran <step> <stop> | ac dec <n> <f1> <f2> | dc <src> <start> <stop> <step>")
    kind = analysis.split()[0].lower()
    probes = [p for p in (args.get("probes") or []) if re.fullmatch(r"[viVI]\([\w.#:]+(,[\w.#]+)?\)|[\w.#]+#branch", p)]
    title = lines[0] if lines and not lines[0].strip().startswith(("R", "C", "L", "V", "I", "D", "Q", "M", "X", "*")) else "* netlist"
    body = lines[1:] if title == lines[0] else lines
    ctl = [".control", "set noaskquit", "set filetype=ascii", f"{analysis}"]
    if kind == "op":
        ctl += ["print all > op.txt"]
    else:
        if not probes:
            probes = ["all"]
        ctl += [f"wrdata data.txt {' '.join(probes)}"]
    ctl += [".endc"]
    deck = "\n".join([title, *body, *ctl, ".end", ""])
    with open("deck.cir", "w") as f:
        f.write(deck)
    rc, so, se = run_cmd(["ngspice", "-b", "deck.cir"], timeout=20)
    log = (so + "\n" + se)
    if re.search(r"(singular matrix|timestep too small|no convergence|gmin stepping failed|source stepping failed)", log, re.I):
        raise ToolError("circuit did not converge: " + re.findall(r".*(?:singular|timestep|convergence|stepping).*", log, re.I)[0][:300],
                        {"tool": "client:circuitjs", "reason": "check for floating nodes / missing ground (node 0); or simulate live in CircuitJS"})
    if kind == "op":
        if not os.path.exists("op.txt"):
            raise ToolError("ngspice gave no operating point: " + log[-800:], {"tool": "client:circuitjs", "reason": "simulate live"})
        vals = {}
        for l in open("op.txt").read().splitlines():
            m = re.match(r"\s*([\w().#:\-]+)\s*=\s*([-+0-9.eE]+)", l)
            if m:
                vals[m.group(1)] = float(m.group(2))
        if not vals:
            raise ToolError("no node values found")
        if any(not math.isfinite(v) or abs(v) > 1e9 for v in vals.values()):
            raise ToolError("non-physical values (check the netlist)")
        return {"op": vals}, {"op": vals}
    if not os.path.exists("data.txt"):
        raise ToolError("ngspice produced no data: " + log[-800:], {"tool": "client:circuitjs", "reason": "simulate live"})
    raw = np.loadtxt("data.txt", ndmin=2)
    if raw.size == 0:
        raise ToolError("empty waveform")
    # wrdata writes x y pairs per vector
    n = raw.shape[1] // 2
    x = raw[:, 0]
    series = {}
    names = probes if probes != ["all"] else [f"vec{i}" for i in range(n)]
    plt = mpl(); fig, ax = plt.subplots()
    for i in range(n):
        y = raw[:, 2 * i + 1]
        nm = names[i] if i < len(names) else f"vec{i}"
        if kind == "ac":
            y = 20 * np.log10(np.abs(y) + 1e-30)
        series[nm] = y
        ax.plot(x, y, lw=2, label=nm)
    if kind == "ac":
        ax.set_xscale("log"); ax.set_xlabel("frequency (Hz)"); ax.set_ylabel("magnitude (dB)")
    elif kind == "tran":
        ax.set_xlabel("time (s)")
    else:
        ax.set_xlabel("sweep")
    ax.legend()
    png = fig_png(fig)
    if not png_nonblank(png)[0]:
        raise ToolError("waveform plot is blank")
    out.add_bytes("waveform.png", "image/png", png)
    step = max(1, len(x) // 200)
    summary = {k: {"min": float(v.min()), "max": float(v.max()), "final": float(v[-1])} for k, v in series.items()}
    return {"x": x[::step].tolist(), "series": {k: v[::step].tolist() for k, v in series.items()}, "summary": summary,
            "points": int(len(x))}, {"summary": summary}


def t_molecule(args, ctx, out: Out):
    """RDKit: SMILES (or name resolved upstream) -> 2D SVG, 3D molblock (for 3Dmol.js), properties."""
    from rdkit import Chem, RDLogger
    from rdkit.Chem import AllChem, Descriptors, Draw, rdMolDescriptors
    from rdkit.Chem.Draw import rdMolDraw2D
    RDLogger.DisableLog("rdApp.*")
    smi = need(args, "smiles", max_len=2000)
    mol = Chem.MolFromSmiles(smi)
    if mol is None:
        raise ToolError(f"invalid SMILES '{smi}'", {"tool": "client:3dmol", "reason": "load by PubChem name/CID in the browser"})
    if mol.GetNumHeavyAtoms() > 150:
        raise ToolError("molecule too large for 3D embedding here", {"tool": "client:3dmol", "reason": "load from PDB/PubChem"})
    d = rdMolDraw2D.MolDraw2DSVG(int(args.get("width", 420)), int(args.get("height", 300)))
    d.drawOptions().addAtomIndices = bool(args.get("atom_indices", False))
    d.DrawMolecule(mol); d.FinishDrawing()
    svg = d.GetDrawingText()
    out.add_text("molecule.svg", "image/svg+xml", svg)
    mh = Chem.AddHs(mol)
    state3d = None
    if args.get("3d", True):
        if AllChem.EmbedMolecule(mh, randomSeed=0xF00D) == 0:
            try:
                AllChem.MMFFOptimizeMolecule(mh, maxIters=500)
            except Exception:
                pass
            mb = Chem.MolToMolBlock(mh)
            out.add_text("molecule.mol", "chemical/x-mdl-molfile", mb)
            state3d = "molblock"
        else:
            out.log("3D embedding failed; 2D only")
    props = {"formula": rdMolDescriptors.CalcMolFormula(mol), "mol_weight": round(Descriptors.MolWt(mol), 3),
             "heavy_atoms": mol.GetNumHeavyAtoms(), "rings": rdMolDescriptors.CalcNumRings(mol),
             "h_donors": rdMolDescriptors.CalcNumHBD(mol), "h_acceptors": rdMolDescriptors.CalcNumHBA(mol),
             "logp": round(Descriptors.MolLogP(mol), 3), "canonical_smiles": Chem.MolToSmiles(mol)}
    if args.get("name"):
        props["name"] = args["name"]
    return props, {"smiles": props["canonical_smiles"], "has_3d": state3d is not None}


def t_pde(args, ctx, out: Out):
    """FiPy heat/diffusion. args: dims 1|2, n (grid cells per side), D, steps, dt, ic ('hot_center'|'hot_left'|'step'),
    bc_left/bc_right (fixed values, 1D) | bc 'fixed0'|'insulated' (2D), animate (mp4)"""
    import numpy as np
    from fipy import CellVariable, DiffusionTerm, Grid1D, Grid2D, TransientTerm
    dims = int(args.get("dims", 1)); n = max(10, min(int(args.get("n", 60 if dims == 1 else 40)), 120 if dims == 1 else 60))
    D = float(args.get("D", 1.0)); L = float(args.get("L", 1.0)); dx = L / n
    dt = float(args.get("dt", 0.9 * dx * dx / (2 * D * dims) * 5)); steps = max(1, min(int(args.get("steps", 100)), 400))
    ic = args.get("ic", "hot_center")
    mesh = Grid1D(nx=n, dx=dx) if dims == 1 else Grid2D(nx=n, ny=n, dx=dx, dy=dx)
    phi = CellVariable(mesh=mesh, name="T", value=0.0)
    xc = np.array(mesh.cellCenters[0])
    if dims == 1:
        if ic == "hot_left":
            phi.setValue(1.0, where=xc < L * 0.2)
        elif ic == "step":
            phi.setValue(1.0, where=xc < L / 2)
        else:
            phi.setValue(1.0, where=abs(xc - L / 2) < L * 0.1)
        if "bc_left" in args:
            phi.constrain(float(args["bc_left"]), mesh.facesLeft)
        if "bc_right" in args:
            phi.constrain(float(args["bc_right"]), mesh.facesRight)
    else:
        yc = np.array(mesh.cellCenters[1])
        r = np.hypot(xc - L / 2, yc - L / 2)
        phi.setValue(1.0, where=r < L * 0.15)
        if args.get("bc", "fixed0") == "fixed0":
            phi.constrain(0.0, mesh.exteriorFaces)
    eq = TransientTerm() == DiffusionTerm(coeff=D)
    frames = []
    total0 = float(np.sum(phi.value))
    keep = max(1, steps // 40)
    for i in range(steps):
        eq.solve(var=phi, dt=dt)
        if i % keep == 0 or i == steps - 1:
            frames.append(np.array(phi.value).copy())
    v = np.array(phi.value)
    if not np.all(np.isfinite(v)):
        raise ToolError("solution blew up (unstable dt)", {"tool": "pde", "reason": "lower dt or steps", "args": {"dt": dt / 4}})
    vmax0 = 1.0
    if v.max() > vmax0 * 1.0001 + 1e-9:
        out.log("warning: maximum principle violated (values above initial max)")
    plt = mpl()
    fig, ax = plt.subplots()
    if dims == 1:
        for k, fr in enumerate(frames[:: max(1, len(frames) // 6)]):
            ax.plot(xc, fr, lw=1.8, label=f"frame {k}")
        ax.set_xlabel("x"); ax.set_ylabel("T"); ax.set_title("Heat diffusion (1D)")
    else:
        im = ax.imshow(v.reshape(n, n), origin="lower", extent=[0, L, 0, L], cmap="inferno", vmin=0, vmax=max(1e-9, frames[0].max()))
        fig.colorbar(im, ax=ax, label="T"); ax.set_title(f"Heat diffusion (2D) after {steps} steps"); ax.grid(False)
    png = fig_png(fig)
    out.add_bytes("field.png", "image/png", png)
    if args.get("animate"):
        from matplotlib import animation
        fig2, ax2 = plt.subplots()
        if dims == 1:
            (ln,) = ax2.plot(xc, frames[0], lw=2, color="#dc2626"); ax2.set_ylim(-0.05, 1.05); ax2.set_xlabel("x")
            upd = lambda k: (ln.set_ydata(frames[k]),)  # noqa: E731
        else:
            im2 = ax2.imshow(frames[0].reshape(n, n), origin="lower", cmap="inferno", vmin=0, vmax=frames[0].max()); ax2.grid(False)
            upd = lambda k: (im2.set_data(frames[k].reshape(n, n)),)  # noqa: E731
        ani = animation.FuncAnimation(fig2, upd, frames=len(frames), interval=80)
        try:
            ani.save("field.mp4", writer=animation.FFMpegWriter(fps=12, codec="libx264", extra_args=["-pix_fmt", "yuv420p"]), dpi=90)
            out.add_file("field.mp4", "video/mp4")
        except Exception as e:
            out.log(f"animation skipped: {e}")
    return {"steps": steps, "dt": dt, "max": float(v.max()), "min": float(v.min()), "mean": float(v.mean()),
            "energy_ratio": float(np.sum(v) / total0) if total0 else None,
            "profile": (v[:: max(1, len(v) // 60)].round(5).tolist() if dims == 1 else None)}, {"max": float(v.max()), "t": steps * dt}


def t_graphviz(args, ctx, out: Out):
    src = need(args, "dot", max_len=40000)
    engine = args.get("engine", "dot")
    if engine not in ("dot", "neato", "fdp", "circo", "twopi", "sfdp"):
        raise ToolError("engine must be dot|neato|fdp|circo|twopi|sfdp")
    with open("g.dot", "w") as f:
        f.write(src)
    rc, so, se = run_cmd([engine, "-Tsvg", "g.dot", "-o", "g.svg"], timeout=15)
    if rc != 0 or not os.path.exists("g.svg"):
        raise ToolError("graphviz error: " + se[-800:], {"tool": "client:mermaid", "reason": "draw the graph as Mermaid in the browser"})
    out.add_file("g.svg", "image/svg+xml", "graph.svg")
    if args.get("png"):
        run_cmd([engine, "-Tpng", "-Gdpi=110", "g.dot", "-o", "g.png"], timeout=15)
        if os.path.exists("g.png"):
            out.add_file("g.png", "image/png", "graph.png")
    nodes = len(re.findall(r'class="node"', open("g.svg").read()))
    if nodes == 0:
        raise ToolError("graph has no nodes")
    return {"nodes": nodes}, {}


def t_plantuml(args, ctx, out: Out):
    src = need(args, "uml", max_len=40000)
    if not src.strip().startswith("@start"):
        src = "@startuml\n" + src + "\n@enduml\n"
    if re.search(r"!include(url)?\b|!import\b", src, re.I):
        raise ToolError("!include is not allowed")
    with open("d.puml", "w") as f:
        f.write(src)
    rc, so, se = run_cmd(["plantuml", "-tsvg", "-nometadata", "d.puml"], timeout=30, env={"JAVA_TOOL_OPTIONS": "-Xmx384m -Djava.awt.headless=true", "PLANTUML_SECURITY_PROFILE": "SANDBOX"})
    if not os.path.exists("d.svg"):
        raise ToolError("plantuml error: " + (se or so)[-800:], {"tool": "graphviz", "reason": "or client:mermaid"})
    svg = open("d.svg").read()
    if "Syntax Error" in svg:
        raise ToolError("plantuml syntax error", {"tool": "client:mermaid", "reason": "draw as Mermaid"})
    out.add_text("diagram.svg", "image/svg+xml", svg)
    return {"svg_bytes": len(svg)}, {}


# ---------------------------------------------------------------------------------------------
# render/media image

def t_latex(args, ctx, out: Out):
    """LaTeX/TikZ -> SVG (+PNG). args: tex (body or full document), packages[], png bool"""
    tex = need(args, "tex", max_len=40000)
    if re.search(r"\\(write18|input|include|openout|openin|immediate|catcode|read)\b", tex):
        raise ToolError("disallowed TeX primitive", {"tool": "client:katex", "reason": "render the formula with KaTeX"})
    if "\\documentclass" not in tex:
        pk = "".join(f"\\usepackage{{{p}}}\n" for p in (args.get("packages") or []) if re.fullmatch(r"[\w-]+", p))
        tex = ("\\documentclass[border=4pt,varwidth=16cm]{standalone}\n\\usepackage{amsmath,amssymb,tikz,pgfplots}\n"
               "\\usetikzlibrary{arrows.meta,calc,positioning,decorations.pathmorphing,shapes}\n\\pgfplotsset{compat=1.17}\n" + pk +
               "\\begin{document}\n" + tex + "\n\\end{document}\n")
    with open("f.tex", "w") as f:
        f.write(tex)
    rc, so, se = run_cmd(["latex", "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "f.tex"], timeout=30)
    if rc != 0 or not os.path.exists("f.dvi"):
        errs = re.findall(r"^! .*", so, re.M)
        raise ToolError("LaTeX error: " + (errs[0] if errs else so[-600:]), {"tool": "client:katex", "reason": "simple formulas render client-side"})
    rc, so2, se2 = run_cmd(["dvisvgm", "--no-fonts", "--exact-bbox", "-o", "f.svg", "f.dvi"], timeout=20)
    if not os.path.exists("f.svg"):
        raise ToolError("dvisvgm failed: " + se2[-500:])
    out.add_file("f.svg", "image/svg+xml", "figure.svg")
    if args.get("png", True):
        try:
            run_cmd(["dvipng", "-D", "160", "-T", "tight", "-bg", "White", "-o", "f.png", "f.dvi"], timeout=20)
        except ToolError as e:
            out.log(f"png skipped: {e}")
        if os.path.exists("f.png"):
            data = open("f.png", "rb").read()
            ok, std = png_nonblank(data)
            if not ok:
                raise ToolError("rendered figure is blank")
            out.add_bytes("figure.png", "image/png", data)
    return {"svg_bytes": os.path.getsize("f.svg")}, {}


MANIM_BLOCK = re.compile(r"\b(subprocess|socket|requests|urllib|httpx|os\.system|shutil\.rmtree|__import__|eval\(|exec\()")


def t_manim(args, ctx, out: Out):
    """Manim CE 0.19 scene code -> mp4 (+ last frame png). args: code (defines a Scene subclass), scene (class name), quality l|m"""
    code = need(args, "code", max_len=30000)
    if MANIM_BLOCK.search(code):
        raise ToolError("code uses disallowed modules", {"tool": "latex", "reason": "static figure instead"})
    if "from manim import" not in code:
        code = "from manim import *\n" + code
    m = re.findall(r"class\s+(\w+)\s*\(\s*\w*Scene\s*\)", code)
    scene = args.get("scene") or (m[0] if m else None)
    if not scene:
        raise ToolError("no Scene subclass found")
    with open("scene.py", "w") as f:
        f.write(code)
    q = {"l": "-ql", "m": "-qm"}.get(args.get("quality", "l"), "-ql")
    rc, so, se = run_cmd(["manim", "render", q, "--progress_bar", "none", "--disable_caching", "--media_dir", "media", "-o", "clip.mp4", "scene.py", scene],
                         timeout=min(float(args.get("timeout", 75)), 90))
    mp4 = None
    for root, _, files in os.walk("media"):
        for fn in files:
            if fn == "clip.mp4":
                mp4 = os.path.join(root, fn)
    if rc != 0 or not mp4:
        raw = re.sub(r"[│╭╮╰╯─]+", " ", (se + "\n" + so))
        errs = [l.strip() for l in raw.splitlines() if re.search(r"\b\w*(Error|Exception)\b", l)]
        tb = (errs[-1] if errs else raw.strip()[-800:])[:800]
        raise ToolError("manim error: " + tb, {"tool": "latex", "reason": "draw a still figure; or retry with fixed code"})
    out.add_file(mp4, "video/mp4", "clip.mp4")
    rc2, dur, _ = run_cmd(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4], timeout=10)
    run_cmd(["ffmpeg", "-y", "-loglevel", "error", "-sseof", "-0.1", "-i", mp4, "-frames:v", "1", "last.png"], timeout=15)
    blank = None
    if os.path.exists("last.png"):
        data = open("last.png", "rb").read()
        ok, std = png_nonblank(data)
        blank = not ok
        out.add_bytes("last_frame.png", "image/png", data)
    if blank:
        raise ToolError("the clip's final frame is blank", {"tool": "manim", "reason": "objects may be off-screen or faded out"})
    return {"duration_s": float(dur.strip() or 0), "scene": scene}, {"scene": scene}


def t_ffmpeg(args, ctx, out: Out):
    """op: frames_to_mp4 {frames: [b64 png], fps} | mp4_to_gif {video: b64} | concat {videos: [b64]} | probe {video}"""
    op = need(args, "op")
    if op == "frames_to_mp4":
        frames = args.get("frames") or []
        if not 1 <= len(frames) <= 600:
            raise ToolError("give 1-600 frames")
        for i, b in enumerate(frames):
            open(f"f{i:04d}.png", "wb").write(base64.b64decode(b))
        fps = max(1, min(int(args.get("fps", 12)), 60))
        rc, so, se = run_cmd(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", "f%04d.png", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                              "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "out.mp4"], timeout=60)
        if rc != 0:
            raise ToolError("ffmpeg error: " + se[-600:])
        out.add_file("out.mp4", "video/mp4")
        return {"frames": len(frames), "fps": fps, "duration_s": len(frames) / fps}, {}
    if op in ("mp4_to_gif", "probe"):
        open("in.mp4", "wb").write(base64.b64decode(need(args, "video", max_len=12_000_000)))
        rc, so, se = run_cmd(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=width,height,codec_name", "-of", "json", "in.mp4"], timeout=15)
        info = json.loads(so or "{}")
        if op == "probe":
            return info, {}
        rc, so, se = run_cmd(["ffmpeg", "-y", "-loglevel", "error", "-i", "in.mp4", "-vf", f"fps={int(args.get('fps', 10))},scale={int(args.get('width', 480))}:-1:flags=lanczos", "out.gif"], timeout=60)
        if rc != 0:
            raise ToolError("ffmpeg error: " + se[-600:])
        out.add_file("out.gif", "image/gif")
        return {"probe": info}, {}
    if op == "concat":
        vids = args.get("videos") or []
        if not 2 <= len(vids) <= 12:
            raise ToolError("give 2-12 videos")
        with open("list.txt", "w") as f:
            for i, b in enumerate(vids):
                open(f"v{i}.mp4", "wb").write(base64.b64decode(b)); f.write(f"file 'v{i}.mp4'\n")
        rc, so, se = run_cmd(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "list.txt", "-c:v", "libx264", "-pix_fmt", "yuv420p", "out.mp4"], timeout=90)
        if rc != 0:
            raise ToolError("ffmpeg error: " + se[-600:])
        out.add_file("out.mp4", "video/mp4")
        return {"videos": len(vids)}, {}
    raise ToolError(f"unknown op '{op}'")


BLENDER_SCENE = r'''
import bpy, json, math, sys
spec = json.load(open("blender_spec.json"))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = int(spec.get("samples", 24))
try:
    sc.cycles.use_denoising = False
except Exception:
    pass
sc.render.resolution_x, sc.render.resolution_y = int(spec.get("width", 640)), int(spec.get("height", 360))
sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = "PNG"
world = bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (*spec.get("background", [0.95, 0.95, 0.97]), 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
adders = {"cube": bpy.ops.mesh.primitive_cube_add, "sphere": bpy.ops.mesh.primitive_uv_sphere_add, "cylinder": bpy.ops.mesh.primitive_cylinder_add,
          "cone": bpy.ops.mesh.primitive_cone_add, "torus": bpy.ops.mesh.primitive_torus_add, "plane": bpy.ops.mesh.primitive_plane_add,
          "monkey": bpy.ops.mesh.primitive_monkey_add, "ico": bpy.ops.mesh.primitive_ico_sphere_add}
for i, o in enumerate(spec.get("objects", [])[:60]):
    adders.get(o.get("type", "cube"), bpy.ops.mesh.primitive_cube_add)(location=tuple(o.get("location", [0, 0, 0])))
    ob = bpy.context.active_object
    ob.scale = tuple(o.get("scale", [1, 1, 1])); ob.rotation_euler = tuple(math.radians(a) for a in o.get("rotation", [0, 0, 0]))
    if o.get("smooth"):
        bpy.ops.object.shade_smooth()
    mat = bpy.data.materials.new(f"m{i}"); mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*o.get("color", [0.2, 0.4, 0.9]), 1)
    if "metallic" in o: bsdf.inputs["Metallic"].default_value = float(o["metallic"])
    if "roughness" in o: bsdf.inputs["Roughness"].default_value = float(o["roughness"])
    ob.data.materials.append(mat)
    if o.get("spin"):
        ob.rotation_euler[2] = 0; ob.keyframe_insert("rotation_euler", frame=1)
        ob.rotation_euler[2] = math.radians(360); ob.keyframe_insert("rotation_euler", frame=int(spec.get("frames", 1)) + 1)
        for fc in ob.animation_data.action.fcurves:
            for kp in fc.keyframe_points: kp.interpolation = "LINEAR"
cam = spec.get("camera", {"location": [6, -6, 4.5], "look_at": [0, 0, 0.5]})
bpy.ops.object.camera_add(location=tuple(cam["location"])); c = bpy.context.active_object; sc.camera = c
import mathutils
d = mathutils.Vector(cam.get("look_at", [0, 0, 0])) - c.location
c.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
bpy.ops.object.light_add(type="SUN", location=(4, -3, 8)); bpy.context.active_object.data.energy = float(spec.get("sun", 3.5))
bpy.context.active_object.rotation_euler = (math.radians(40), math.radians(15), math.radians(30))
frames = int(spec.get("frames", 1))
sc.frame_start, sc.frame_end = 1, frames
if frames <= 1:
    sc.render.filepath = "//render.png"; bpy.ops.render.render(write_still=True)
else:
    sc.render.filepath = "//frame_"; bpy.ops.render.render(animation=True)
'''


def t_blender(args, ctx, out: Out):
    """Blender headless (Cycles CPU, low samples). args: objects[{type,location,scale,rotation,color,smooth,spin}], camera, frames<=48, width, height, samples<=64"""
    spec = {k: args[k] for k in ("objects", "camera", "frames", "width", "height", "samples", "background", "sun") if k in args}
    if not spec.get("objects"):
        raise ToolError("give objects: [{type: cube|sphere|cylinder|cone|torus|plane|ico|monkey, location, scale, color}]")
    spec["frames"] = max(1, min(int(spec.get("frames", 1)), 48))
    spec["width"] = max(64, min(int(spec.get("width", 640)), 960)); spec["height"] = max(64, min(int(spec.get("height", 360)), 540))
    spec["samples"] = max(4, min(int(spec.get("samples", 24)), 64))
    budget = spec["frames"] * spec["width"] * spec["height"] * spec["samples"]
    if budget > 640 * 360 * 24 * 24:
        raise ToolError("render budget too high (frames x pixels x samples); lower one of them", {"tool": "manim", "reason": "2D/3D animation is cheaper in Manim"})
    json.dump(spec, open("blender_spec.json", "w"))
    open("scene_build.py", "w").write(BLENDER_SCENE)
    rc, so, se = run_cmd(["blender", "-b", "--factory-startup", "-noaudio", "--python", "scene_build.py", "--", "x"], timeout=min(float(args.get("timeout", 70)), 85),
                         env={"BLENDER_USER_CONFIG": os.getcwd(), "BLENDER_USER_SCRIPTS": os.getcwd()})
    files = sorted(f for f in os.listdir(".") if (f == "render.png" or f.startswith("frame_")) and f.endswith(".png"))
    if not files:
        raise ToolError("blender produced no image: " + (se or so)[-1200:], {"tool": "client:three", "reason": "build the 3D view client-side"})
    first = open(files[0], "rb").read()
    ok, std = png_nonblank(first)
    if not ok:
        raise ToolError("render is blank (camera/lights?)", {"tool": "blender", "reason": "move the camera or add a light"})
    if len(files) == 1:
        out.add_bytes("render.png", "image/png", first)
    else:
        rc, _, se2 = run_cmd(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "24", "-pattern_type", "glob", "-i", "frame_*.png", "-c:v", "libx264", "-pix_fmt", "yuv420p", "render.mp4"], timeout=30)
        if os.path.exists("render.mp4"):
            out.add_file("render.mp4", "video/mp4")
        out.add_bytes("first_frame.png", "image/png", first)
    m = re.findall(r"Time: ([\d:.]+)", so)
    return {"frames": len(files), "render_times": m[-3:]}, {}


def t_ping(args, ctx, out: Out):
    return {"pong": True, "python": sys.version.split()[0]}, {}


TOOLS = {
    # compute
    "sympy": t_sympy, "numeric": t_numeric, "chart": t_chart, "units": t_units, "z3": t_z3, "python": t_python, "octave": t_octave,
    # sci
    "spice": t_spice, "molecule": t_molecule, "pde": t_pde, "graphviz": t_graphviz, "plantuml": t_plantuml,
    # render
    "latex": t_latex, "manim": t_manim, "ffmpeg": t_ffmpeg, "blender": t_blender,
    "ping": t_ping,
}


def main(workdir: str):
    os.chdir(workdir)
    job = json.load(open("job.json"))
    out = Out()
    t0 = time.time()
    res = {"ok": False, "result": None, "artifacts": [], "state": {}, "logs": "", "error": None, "fallback": None}
    try:
        fn = TOOLS.get(job["tool"])
        if fn is None:
            raise ToolError(f"unknown tool '{job['tool']}'")
        result, state = fn(job.get("args") or {}, job.get("context") or {}, out)
        res.update(ok=not (isinstance(state, dict) and state.get("failed")), result=result, state=state or {})
        if isinstance(result, dict) and result.get("error"):
            res["error"] = result["error"]
    except ToolError as e:
        res.update(error=str(e)[:3000], fallback=e.fallback)
    except Exception as e:  # unexpected: give the error, not a stack dump
        res.update(error=f"{type(e).__name__}: {str(e)[:1500]}")
        out.log(traceback.format_exc()[-2500:])
    res["artifacts"] = out.artifacts
    res["logs"] = "\n".join(out.logs)[-4000:]
    res["tool_ms"] = int((time.time() - t0) * 1000)
    with open("result.json", "w") as f:
        json.dump(res, f, default=str)


if __name__ == "__main__":
    main(sys.argv[1])

"""
Ideanimo tool bench (Modal app "geniusmap-toolbench"): heavy Linux tools the tutor agent drives.

POST /run    headers: Authorization: Bearer <TOOLBENCH_TOKEN>   (or X-Toolbench-Token)
  body: {"tool": str, "args": {...}, "context": {...}}
  -> {"ok", "tool", "group", "result", "artifacts": [{"name","mime","b64"|"text","bytes"}], "state", "logs",
      "error", "fallback": {"tool","reason","args"?}|null, "ms", "tool_ms", "warm"}
POST /warm   {"groups": ["compute","sci","render"]} -> starts the backends (no-op ping) ahead of a call
GET  /tools  -> the tool list (names, group, args summary, typical latency)
GET  /health -> {"ok": true}

Layout: one light web function (holds the token, no tool code) dispatches to three CPU backends, one per image:
  compute : SymPy, NumPy/SciPy, pandas + Vega-Lite, Pint, Z3, sandboxed Python, GNU Octave
  sci     : ngspice, RDKit, FiPy, Graphviz, PlantUML
  render  : Manim CE 0.19, LaTeX/TikZ, ffmpeg, Blender (Cycles CPU, small renders)
Backends have block_network=True and no secrets. Every call runs toolbench_tools.py in a fresh child process as a
per-slot unprivileged user with rlimits (address space, processes, file size) and a wall-clock timeout; the slot's
processes are killed and its work dir removed afterwards.

Cost guard (Starter plan, $30/month credit, 100-container cap): CPU only, min_containers=0, short scaledown
windows, max_containers=2 per function with input concurrency, so the whole bench is at most 8 containers.

Secret: Modal secret "geniusmap-toolbench" = TOOLBENCH_TOKEN (created by scripts/deploy-modal.mjs from the Vercel env).
Deployed from the Vercel production build (scripts/deploy-modal.mjs).
"""


import os

import modal

APP_NAME = "geniusmap-toolbench"
BUILD = "2026-10-10.3"
SECRET_NAME = "geniusmap-toolbench"
HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS_SRC = os.path.join(HERE, "toolbench_tools.py")

app = modal.App(APP_NAME)

USERS = "for i in 0 1 2 3 4 5 6 7; do useradd -m -s /bin/bash tb$i; done"
ENV = {"MPLBACKEND": "Agg", "PYTHONDONTWRITEBYTECODE": "1", "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1"}
APT = "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "

compute_image = (
    modal.Image.debian_slim(python_version="3.11")
    .run_commands(APT + "procps fonts-dejavu-core fonts-freefont-otf ghostscript octave gnuplot-nox && rm -rf /var/lib/apt/lists/*")
    .pip_install("numpy==2.3.3", "scipy==1.16.2", "sympy==1.14.0", "matplotlib==3.10.6", "pandas==2.3.3", "pint==0.24.4",
                 "z3-solver", "networkx==3.5", "pillow")
    .run_commands(USERS, "python -c 'import matplotlib; matplotlib.use(\"Agg\"); import matplotlib.pyplot'")
    .env(ENV)
    .add_local_file(TOOLS_SRC, "/root/toolbench_tools.py")
)

sci_image = (
    modal.Image.debian_slim(python_version="3.11")
    .run_commands(
        APT + "procps ca-certificates wget fonts-dejavu-core ngspice graphviz default-jre-headless ffmpeg && rm -rf /var/lib/apt/lists/*",
        # PlantUML is in Debian contrib (not enabled on debian_slim): use the upstream jar behind a small wrapper.
        "wget -q -O /opt/plantuml.jar https://github.com/plantuml/plantuml/releases/download/v1.2024.7/plantuml-1.2024.7.jar",
        "printf '#!/bin/sh\\nexec java $JAVA_TOOL_OPTIONS -jar /opt/plantuml.jar \"$@\"\\n' > /usr/local/bin/plantuml && chmod 755 /usr/local/bin/plantuml",
    )
    .pip_install("numpy==2.3.3", "scipy==1.16.2", "matplotlib==3.10.6", "rdkit==2024.9.6", "fipy", "pillow")
    .run_commands(USERS, "python -c 'import matplotlib; matplotlib.use(\"Agg\"); import matplotlib.pyplot'")
    .env(ENV)
    .add_local_file(TOOLS_SRC, "/root/toolbench_tools.py")
)

render_image = (
    modal.Image.debian_slim(python_version="3.11")
    .run_commands(
        APT + "procps ffmpeg build-essential pkg-config python3-dev libcairo2-dev libpango1.0-dev "
        "texlive-latex-base texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended texlive-science "
        "texlive-pictures cm-super dvisvgm dvipng librsvg2-bin lmodern tipa fonts-dejavu-core && rm -rf /var/lib/apt/lists/*",
    )
    .run_commands(APT + "blender && rm -rf /var/lib/apt/lists/*")
    .pip_install("manim==0.19.0", "numpy==2.3.3", "pillow")
    .run_commands(USERS)
    .env(ENV)
    .add_local_file(TOOLS_SRC, "/root/toolbench_tools.py")
)

web_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]==0.115.6", "httpx==0.27.2")

# tool -> (group, timeout s, address-space cap MB or None)
TOOLS = {
    "sympy": ("compute", 30, 1536), "numeric": ("compute", 30, 1536), "chart": ("compute", 30, 1536),
    "units": ("compute", 20, 1024), "z3": ("compute", 30, 1536), "python": ("compute", 35, 1024),
    "octave": ("compute", 45, None),
    "spice": ("sci", 30, 1536), "molecule": ("sci", 30, 1536), "pde": ("sci", 75, 2048),
    "graphviz": ("sci", 20, 1024), "plantuml": ("sci", 40, None),
    "latex": ("render", 45, 2048), "manim": ("render", 100, None), "ffmpeg": ("render", 100, 2048),
    "blender": ("render", 95, None),
}

TOOL_DOCS = {
    "sympy": "op simplify|expand|factor|solve|diff|integrate|limit|series|evaluate|latex|plot; expr; var?",
    "numeric": "op ode|roots|fsolve|fit|linsolve|stats (+ op args)",
    "chart": "csv|rows, x?, y?, kind line|bar|scatter|area, title? -> PNG + Vega-Lite spec",
    "units": "op convert{quantity,to}|check{lhs,rhs}|compute{expr,to?}",
    "z3": "vars{name:Int|Real|Bool}, constraints[], prove?",
    "python": "code, timeout<=30 (no network)",
    "octave": "code, timeout<=40",
    "spice": "netlist, analysis op|tran|ac|dc ..., probes[]",
    "molecule": "smiles | name (PubChem lookup), 3d? -> SVG + molblock",
    "pde": "dims 1|2, n, D, steps, dt?, ic, bc_*, animate?",
    "graphviz": "dot, engine?, png?",
    "plantuml": "uml",
    "latex": "tex (TikZ body or full doc), packages[], png?",
    "manim": "code (Scene subclass), scene?, quality l|m",
    "ffmpeg": "op frames_to_mp4|mp4_to_gif|concat|probe",
    "blender": "objects[], camera?, frames<=48, width, height, samples<=64",
}


# ----------------------------------------------------------------------------------------------- backends

def _isolated(tool: str, args: dict, context: dict, timeout: float, mem_mb: int | None) -> dict:
    import json
    import pwd
    import resource
    import shutil
    import signal
    import subprocess
    import sys
    import tempfile
    import time

    g = globals()
    if "_SLOTS" not in g:
        import queue
        q = queue.Queue()
        for i in range(8):
            q.put(i)
        g["_SLOTS"] = q
        g["_CALLS"] = 0
    g["_CALLS"] += 1
    calls = g["_CALLS"]
    slot = g["_SLOTS"].get(timeout=timeout)
    user = f"tb{slot}"
    pw = pwd.getpwnam(user)
    d = tempfile.mkdtemp(prefix=f"job{slot}_", dir="/tmp")
    t0 = time.time()
    try:
        with open(os.path.join(d, "job.json"), "w") as f:
            json.dump({"tool": tool, "args": args, "context": context}, f)
        for root, dirs, files in os.walk(d):
            for n in [root, *[os.path.join(root, x) for x in files]]:
                os.chown(n, pw.pw_uid, pw.pw_gid)

        def pre():
            if mem_mb:
                resource.setrlimit(resource.RLIMIT_AS, (mem_mb * 1024 * 1024, mem_mb * 1024 * 1024))
            resource.setrlimit(resource.RLIMIT_NPROC, (512, 512))
            resource.setrlimit(resource.RLIMIT_FSIZE, (300 * 1024 * 1024, 300 * 1024 * 1024))
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
            os.setgroups([])
            os.setgid(pw.pw_gid)
            os.setuid(pw.pw_uid)

        env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": d, "TMPDIR": d, "MPLCONFIGDIR": os.path.join(d, ".mpl"),
               "LANG": "C.UTF-8", **{k: v for k, v in os.environ.items() if k.endswith("_NUM_THREADS") or k in ("MPLBACKEND",)}}
        p = subprocess.Popen([sys.executable, "/root/toolbench_tools.py", d], cwd=d, env=env, preexec_fn=pre,
                             start_new_session=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        timed_out = False
        try:
            so, se = p.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except Exception:
                pass
            so, se = p.communicate()
        subprocess.run(["pkill", "-KILL", "-u", user], capture_output=True)
        rp = os.path.join(d, "result.json")
        if timed_out:
            res = {"ok": False, "error": f"{tool} hit the {timeout:.0f} s time limit", "artifacts": [], "state": {}, "result": None,
                   "fallback": {"tool": "python" if tool not in ("python",) else "sympy", "reason": "simplify the request or use a cheaper tool"}}
        elif os.path.exists(rp):
            with open(rp) as f:
                res = json.load(f)
        else:
            err = (se or b"").decode("utf-8", "replace")[-1200:]
            res = {"ok": False, "error": f"{tool} process died (exit {p.returncode}; memory limit?) {err}".strip(), "artifacts": [],
                   "state": {}, "result": None, "fallback": None}
        res["run_ms"] = int((time.time() - t0) * 1000)
        res["warm"] = calls > 1
        return res
    finally:
        shutil.rmtree(d, ignore_errors=True)
        g["_SLOTS"].put(slot)


@app.function(image=compute_image, cpu=1.0, memory=2048, timeout=60, max_containers=2, min_containers=0,
              scaledown_window=45, block_network=True)
@modal.concurrent(max_inputs=4)
def compute(tool: str, args: dict, context: dict, timeout: float, mem_mb: int | None) -> dict:
    return _isolated(tool, args, context, timeout, mem_mb)


@app.function(image=sci_image, cpu=1.0, memory=2048, timeout=90, max_containers=2, min_containers=0,
              scaledown_window=45, block_network=True)
@modal.concurrent(max_inputs=3)
def sci(tool: str, args: dict, context: dict, timeout: float, mem_mb: int | None) -> dict:
    return _isolated(tool, args, context, timeout, mem_mb)


@app.function(image=render_image, cpu=2.0, memory=4096, timeout=120, max_containers=2, min_containers=0,
              scaledown_window=30, block_network=True)
@modal.concurrent(max_inputs=2)
def render(tool: str, args: dict, context: dict, timeout: float, mem_mb: int | None) -> dict:
    return _isolated(tool, args, context, timeout, mem_mb)


BACKENDS = {"compute": compute, "sci": sci, "render": render}


# ----------------------------------------------------------------------------------------------- web

@app.function(image=web_image, secrets=[modal.Secret.from_name(SECRET_NAME)], timeout=150, max_containers=2,
              min_containers=0, scaledown_window=60)
@modal.concurrent(max_inputs=32)
@modal.asgi_app(label="geniusmap-toolbench")
def web():
    import asyncio
    import hmac
    import re
    import time
    from typing import Any

    import httpx
    from fastapi import FastAPI, Header, HTTPException, Request
    from pydantic import BaseModel, Field

    api = FastAPI(title="Ideanimo tool bench", docs_url=None, redoc_url=None, openapi_url=None)
    sem = asyncio.Semaphore(8)

    class RunRequest(BaseModel):
        tool: str = Field(min_length=1, max_length=40)
        args: dict[str, Any] = Field(default_factory=dict)
        context: dict[str, Any] = Field(default_factory=dict)

    class WarmRequest(BaseModel):
        groups: list[str] = Field(default_factory=lambda: ["compute", "sci", "render"])

    def check(auth: str | None, tok: str | None):
        expected = os.environ.get("TOOLBENCH_TOKEN", "")
        given = tok or (auth[7:] if auth and auth.lower().startswith("bearer ") else None)
        if not expected or not given or not hmac.compare_digest(given, expected):
            raise HTTPException(status_code=401, detail="unauthorized")

    async def body_json(request):
        try:
            d = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="invalid JSON body")
        if not isinstance(d, dict):
            raise HTTPException(status_code=400, detail="JSON body must be an object")
        return d

    @api.get("/health")
    def health():
        return {"ok": True, "app": APP_NAME, "build": BUILD}

    @api.get("/tools")
    def tools():
        return {"tools": [{"name": n, "group": g, "timeout_s": t, "args": TOOL_DOCS.get(n, "")} for n, (g, t, _) in TOOLS.items()]}

    async def pubchem_smiles(name: str) -> str | None:
        if not re.fullmatch(r"[\w\s,()'+-]{1,80}", name):
            return None
        from urllib.parse import quote
        url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{quote(name.strip())}/property/IsomericSMILES,CanonicalSMILES/JSON"
        try:
            async with httpx.AsyncClient(timeout=8) as c:
                r = await c.get(url)
            if r.status_code != 200:
                return None
            p = r.json()["PropertyTable"]["Properties"][0]
            return p.get("IsomericSMILES") or p.get("CanonicalSMILES") or p.get("SMILES") or p.get("ConnectivitySMILES")
        except Exception:
            return None

    @api.post("/warm")
    async def warm(request: Request, authorization: str | None = Header(default=None), x_toolbench_token: str | None = Header(default=None)):
        check(authorization, x_toolbench_token)
        req = WarmRequest.model_validate(await body_json(request))
        started = []
        for g in req.groups:
            if g in BACKENDS:
                await BACKENDS[g].spawn.aio("ping", {}, {}, 20, None)
                started.append(g)
        return {"ok": True, "warming": started}

    @api.post("/run")
    async def run(request: Request, authorization: str | None = Header(default=None), x_toolbench_token: str | None = Header(default=None)):
        check(authorization, x_toolbench_token)
        body = await body_json(request)
        try:
            req = RunRequest.model_validate(body)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"body must be {{tool, args, context}}: {str(e)[:300]}")
        t0 = time.time()
        spec = TOOLS.get(req.tool)
        if not spec:
            return {"ok": False, "tool": req.tool, "error": f"unknown tool; have {sorted(TOOLS)}", "artifacts": [], "state": {},
                    "result": None, "logs": "", "fallback": None, "ms": 0}
        group, timeout, mem = spec
        args = dict(req.args)
        logs = []
        if req.tool == "molecule" and not args.get("smiles") and args.get("name"):
            smi = await pubchem_smiles(str(args["name"]))
            if not smi:
                return {"ok": False, "tool": req.tool, "group": group, "error": f"could not resolve '{args['name']}' on PubChem; pass smiles",
                        "artifacts": [], "state": {}, "result": None, "logs": "", "ms": int((time.time() - t0) * 1000),
                        "fallback": {"tool": "client:3dmol", "reason": "load by name in the browser viewer"}}
            args["smiles"] = smi
            logs.append(f"PubChem: {args['name']} -> {smi}")
        async with sem:
            try:
                res = await asyncio.wait_for(BACKENDS[group].remote.aio(req.tool, args, req.context, float(timeout), mem), timeout + 60)
            except asyncio.TimeoutError:
                res = {"ok": False, "error": f"{req.tool} timed out (queue + run > {timeout + 60} s)", "artifacts": [], "state": {}, "result": None,
                       "fallback": None}
            except Exception as e:
                res = {"ok": False, "error": f"backend error: {type(e).__name__}: {str(e)[:500]}", "artifacts": [], "state": {}, "result": None,
                       "fallback": None}
        res.setdefault("logs", "")
        if logs:
            res["logs"] = "\n".join(logs + ([res["logs"]] if res["logs"] else []))
        res.update(tool=req.tool, group=group, ms=int((time.time() - t0) * 1000))
        return res

    return api

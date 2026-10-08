"""
GeniusMap Manim render service (Modal app "geniusmap-manim").

POST /render  (header X-Render-Token must equal the RENDER_TOKEN secret)
POST /video   records a lesson as an MP4 (function lesson_video, see lesson_video.py) and calls back /api/video/callback
  body: {"job_id": str, "code": str, "scene_name": str, "upload_url": str, "paths_upload_url"?: str}
  -> 202 {"accepted": true}; the render runs asynchronously.

The render function writes the code to a temp dir, runs
`manim -qm --format mp4` (720p30), PUTs the MP4 to the Supabase signed upload
URL (and, when paths_upload_url is given, the clip's pen paths as JSON, see
pen_export.py: every Create / Write / DrawBorderThenFill / GrowArrow stroke with its
bezier points in frame coordinates and how much of it is revealed over time, so the
whiteboard hand can trace the lines as they appear), then calls back POST {APP_URL}/api/manim/callback with
{"job_id", "status": "done"|"failed", "error"} and the same X-Render-Token.

Secrets (Modal secret "geniusmap-render"): RENDER_TOKEN, APP_URL.
Deployed from the Vercel production build (scripts/deploy-modal.mjs).
Web endpoint: https://<modal-workspace>--geniusmap-manim-render.modal.run
"""

import hmac
import json
import os
import modal

APP_NAME = "geniusmap-manim"
SECRET_NAME = "geniusmap-render"

app = modal.App(APP_NAME)

render_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(
        "ffmpeg",
        "build-essential",
        "pkg-config",
        "python3-dev",
        "libcairo2-dev",
        "libpango1.0-dev",
        # LaTeX: the set Manim needs for MathTex/Tex.
        "texlive-latex-base",
        "texlive-latex-recommended",
        "texlive-latex-extra",
        "texlive-fonts-recommended",
        "texlive-science",
        "cm-super",
        "dvisvgm",
        "lmodern",
        "tipa",
    )
    .pip_install("manim==0.19.0", "httpx==0.27.2", "sympy==1.14.0", "shapely==2.0.6", "rdkit==2024.9.6")
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pen_export.py"), "/root/pen_export.py")
    # The scene grammar runtime + the AI visual composer (plan -> spec -> validate -> render -> gate -> repair).
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_scene.py"), "/root/gm_scene.py")
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_compose.py"), "/root/gm_compose.py")
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_grammar.md"), "/root/gm_grammar.md")
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_llm.py"), "/root/gm_llm.py")
    # The part-graph composer: semantic part graph -> deterministic solvers / World / gates (tried first, gm_compose is the fallback).
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_parts.py"), "/root/gm_parts.py")
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_rigs.py"), "/root/gm_rigs.py")
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_refdata.py"), "/root/gm_refdata.py")
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_mesh3d.py"), "/root/gm_mesh3d.py")
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_partcompose.py"), "/root/gm_partcompose.py")
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_memory.json"), "/root/gm_memory.json")
)

web_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("fastapi[standard]==0.115.6", "httpx==0.27.2")
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_llm.py"), "/root/gm_llm.py")
)

# Lesson videos (Download -> Video): headless Google Chrome (H.264 for the Manim clips) records the render page.
video_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "wget", "ca-certificates", "fonts-liberation", "fonts-dejavu-core", "fonts-noto-color-emoji")
    .run_commands(
        "wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb",
        "apt-get update && apt-get install -y /tmp/chrome.deb && rm /tmp/chrome.deb",
    )
    .pip_install("playwright==1.55.0", "httpx==0.27.2")
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "lesson_video.py"), "/root/lesson_video.py")
)

secret = modal.Secret.from_name(SECRET_NAME)


# ---- Static Manim Community v0.19 guard (mirrors src/lib/manim-guard.ts) ----
# Runs in the lightweight web container before a render container is spawned,
# so old ManimGL / pre-0.6 calls never cost render time.
import re as _re

_REWRITES = [
    (r"\.get_graph\s*\(", ".plot(", "axes.get_graph( -> axes.plot("),
    (r"\bShowCreation\s*\(", "Create(", "ShowCreation -> Create"),
    (r"\bTextMobject\s*\(", "Text(", "TextMobject -> Text"),
    (r"\bTexMobject\s*\(", "MathTex(", "TexMobject -> MathTex"),
    (r"\bTexText\s*\(", "Tex(", "TexText -> Tex"),
]

_DEPRECATED = [
    (r"\bget_line_from_equation\b", "get_line_from_equation does not exist in v0.19; use ax.plot(lambda x: m*x + b, x_range=[a, b]) or Line(ax.c2p(x1, y1), ax.c2p(x2, y2))."),
    (r"\bget_derivative_graph\b", "get_derivative_graph does not exist; use ax.plot_derivative_graph(graph)."),
    (r"\bget_v(?:ertical)?_line_to_graph\b", "get_v_line_to_graph does not exist; use ax.get_vertical_line(ax.i2gp(x, graph))."),
    (r"\bsetup_axes\s*\(", "setup_axes() is GraphScene API; build Axes(...) directly."),
    (r"\bGraphScene\b", "GraphScene was removed; subclass Scene and create Axes(...)."),
    (r"\bShowCreationThenDestruction\b", "ShowCreationThenDestruction was removed."),
    (r"\bFadeInFrom(?:Down|Large|Point)?\b", "FadeInFrom* was removed; use FadeIn(mob, shift=...)."),
    (r"\bFadeOutAndShift(?:Down)?\b", "FadeOutAndShift was removed; use FadeOut(mob, shift=...)."),
    (r"\bCircleIndicate\b", "CircleIndicate was removed; use Circumscribe."),
    (r"[(,]\s*[xy]_(?:min|max)\s*=(?!=)", "x_min/x_max/y_min/y_max keyword args are old API; use x_range / y_range."),
    (r"\b(?:from\s+manimlib\b|import\s+manimlib\b|from\s+manimgl\b|import\s+manimgl\b)", "ManimGL (manimlib) is not installed; use `from manim import *`."),
    (r"(?m)^\s*CONFIG\s*=\s*\{", "CONFIG = {...} class dicts are ignored in v0.19."),
    (r"\bembed\s*\(", "Interactive embed() is not allowed in a headless render."),
    (r"\bself\.frame\b", "self.frame is ManimGL; use self.camera.frame in a MovingCameraScene."),
]


def guard_manim_code(code: str) -> tuple[str, list[str], list[str]]:
    """Returns (rewritten_code, rewrites, problems)."""
    rewrites: list[str] = []
    for pat, to, note in _REWRITES:
        code, n = _re.subn(pat, to, code)
        if n:
            rewrites.append(note)
    if _re.search(r"\bself\.camera\.frame\b", code) and _re.search(r"class\s+\w+\s*\(\s*Scene\s*\)", code):
        code = _re.sub(r"(class\s+\w+\s*\(\s*)Scene(\s*\))", r"\1MovingCameraScene\2", code, count=1)
        rewrites.append("Scene -> MovingCameraScene")
    problems = [msg for pat, msg in _DEPRECATED if _re.search(pat, code)]
    return code, rewrites, problems


WARM_JOB = "__warm__"


def _callback(job_id: str, status: str, error: str | None = None, extra: dict | None = None) -> None:
    if job_id == WARM_JOB:
        return  # a warm-up spawn (POST /warm): nothing to report
    import httpx

    app_url = os.environ.get("APP_URL", "").rstrip("/")
    token = os.environ.get("RENDER_TOKEN", "")
    if not app_url:
        print("APP_URL not set; cannot call back")
        return
    for attempt in range(3):
        try:
            r = httpx.post(
                f"{app_url}/api/manim/callback",
                json={"job_id": job_id, "status": status, "error": error, **(extra or {})},
                headers={"X-Render-Token": token},
                timeout=60,
            )
            print(f"callback {status} -> {r.status_code}")
            if r.status_code < 500:
                return
        except Exception as exc:  # noqa: BLE001
            print(f"callback attempt {attempt + 1} failed: {exc}")


@app.function(image=render_image, secrets=[secret], timeout=600, cpu=2.0, memory=4096, max_containers=4)
def render(job_id: str, code: str, scene_name: str, upload_url: str, paths_upload_url: str | None = None) -> dict:
    import glob
    import subprocess
    import tempfile

    import httpx

    _callback(job_id, "rendering")
    workdir = tempfile.mkdtemp(prefix="manim-")
    src = os.path.join(workdir, "scene.py")
    pen_path = os.path.join(workdir, "pen.json")
    with open(src, "w") as f:
        f.write(code)
    # Grammar scenes (`from gm_scene import build`) import the runtime from /root.
        # Records the drawing animations for the hand (no effect on the video). Appended, so traceback line numbers
        # still match the scene's own code; the CLI renders only after the whole module has run.
        f.write("\n\nimport sys as _pen_sys\n_pen_sys.path.insert(0, '/root')\ntry:\n    import pen_export  # noqa: F401,E402\nexcept Exception as _pen_err:  # noqa: BLE001\n    print('pen_export unavailable:', _pen_err)\n")

    cmd = [
        "manim",
        "-qm",  # 720p30
        "--format",
        "mp4",
        "--media_dir",
        os.path.join(workdir, "media"),
        "--disable_caching",
        "--progress_bar",
        "none",
        src,
        scene_name,
    ]
    try:
        proc = subprocess.run(cmd, cwd=workdir, capture_output=True, text=True, timeout=540, env={**os.environ, "PEN_EXPORT_PATH": pen_path, "PYTHONPATH": "/root"})
    except subprocess.TimeoutExpired:
        _callback(job_id, "failed", "Render timed out after 9 minutes.")
        return {"ok": False}

    log = (proc.stdout or "")[-3000:] + "\n" + (proc.stderr or "")[-5000:]
    if proc.returncode != 0:
        _callback(job_id, "failed", log.strip()[-6000:])
        return {"ok": False}

    files = sorted(glob.glob(os.path.join(workdir, "media", "videos", "**", "*.mp4"), recursive=True))
    files = [p for p in files if "partial_movie_files" not in p]
    if not files:
        _callback(job_id, "failed", "Render finished but no MP4 was produced.\n" + log.strip()[-3000:])
        return {"ok": False}

    with open(files[-1], "rb") as f:
        data = f.read()
    try:
        r = httpx.put(
            upload_url,
            content=data,
            headers={"Content-Type": "video/mp4", "x-upsert": "true", "cache-control": "max-age=31536000"},
            timeout=120,
        )
        if r.status_code >= 300:
            _callback(job_id, "failed", f"Upload failed ({r.status_code}): {r.text[:500]}")
            return {"ok": False}
    except Exception as exc:  # noqa: BLE001
        _callback(job_id, "failed", f"Upload failed: {exc}")
        return {"ok": False}

    pen_bytes = 0
    if paths_upload_url and os.path.exists(pen_path):
        # The hand's paths are a bonus: a failed upload never fails the clip.
        try:
            with open(pen_path, "rb") as f:
                pen = f.read()
            r = httpx.put(paths_upload_url, content=pen, headers={"Content-Type": "application/json", "x-upsert": "true", "cache-control": "max-age=31536000"}, timeout=60)
            pen_bytes = len(pen) if r.status_code < 300 else 0
            print(f"pen paths upload {r.status_code} ({len(pen)} bytes)")
        except Exception as exc:  # noqa: BLE001
            print(f"pen paths upload failed: {exc}")

    _callback(job_id, "done")
    return {"ok": True, "bytes": len(data), "pen_bytes": pen_bytes}


def _video_callback(callback_url: str | None, job_id: str, status: str, **extra) -> None:
    import httpx

    url = callback_url or (os.environ.get("APP_URL", "").rstrip("/") + "/api/video/callback")
    for attempt in range(3):
        try:
            r = httpx.post(url, json={"job_id": job_id, "status": status, **extra}, headers={"X-Render-Token": os.environ.get("RENDER_TOKEN", "")}, timeout=30)
            if r.status_code < 500:
                return
        except Exception as exc:  # noqa: BLE001
            print(f"video callback attempt {attempt + 1} failed: {exc}")


# Real time: the lesson plays through once while it is recorded, so a 20-minute lesson takes ~22 minutes. Kept small
# (2 CPUs, at most 2 at once; more requests queue) because renders only happen when a learner taps Download -> Video.
@app.function(image=video_image, secrets=[secret], timeout=4 * 3600, cpu=2.0, memory=3072, max_containers=2)
def lesson_video(job_id: str, page_url: str, upload_url: str, max_s: int = 7200, callback_url: str | None = None) -> dict:
    import sys
    import time

    import httpx

    sys.path.insert(0, "/root")
    import lesson_video as lv

    t0 = time.time()
    _video_callback(callback_url, job_id, "rendering", progress=0)
    try:
        res = lv.render_lesson_video(page_url, max_s=max_s, channel="chrome",
                                     on_progress=lambda p: _video_callback(callback_url, job_id, "rendering", progress=round(p, 3)))
    except Exception as exc:  # noqa: BLE001
        print(f"lesson video failed: {exc}")
        _video_callback(callback_url, job_id, "failed", error=f"{type(exc).__name__}: {exc}"[:3000])
        return {"ok": False, "error": str(exc)[:500]}
    with open(res["path"], "rb") as f:
        data = f.read()
    try:
        r = httpx.put(upload_url, content=data, headers={"Content-Type": "video/mp4", "x-upsert": "true", "cache-control": "max-age=31536000"}, timeout=300)
        if r.status_code >= 300:
            raise RuntimeError(f"upload failed ({r.status_code}): {r.text[:300]}")
    except Exception as exc:  # noqa: BLE001
        _video_callback(callback_url, job_id, "failed", error=str(exc)[:3000])
        return {"ok": False, "error": str(exc)[:500]}
    meta = {**res["meta"], "wall_s": round(time.time() - t0, 1)}
    _video_callback(callback_url, job_id, "done", bytes=res["bytes"], duration_ms=res["duration_ms"], meta=meta)
    return {"ok": True, "bytes": res["bytes"], "duration_ms": res["duration_ms"], "meta": meta}


def _put(url: str | None, data: bytes, ctype: str) -> bool:
    if not url:
        return False
    import httpx

    try:
        r = httpx.put(url, content=data, headers={"Content-Type": ctype, "x-upsert": "true", "cache-control": "max-age=31536000"}, timeout=120)
        return r.status_code < 300
    except Exception as exc:  # noqa: BLE001
        print(f"upload failed: {exc}")
        return False


@app.function(image=render_image, secrets=[secret], timeout=3600, cpu=4.0, memory=6144, max_containers=28)
def compose(job_id: str, description: str, narration: dict | None, context: str, upload_url: str, paths_upload_url: str | None,
            report_upload_url: str | None, vision: str = "auto", callback: bool = True, models: str | None = None, engine: str = "auto") -> dict:
    """AI visual composer at render time (never on the learner's path). First the part-graph composer (semantic part graph ->
    deterministic solvers, single-source numbers, fact checks, hard gates, pairwise critic); when no solver fits the topic or a
    gate cannot be met, the free grammar composer (plan -> spec -> validate -> render -> gate -> repair)."""
    import sys
    import time

    sys.path.insert(0, "/root")
    if models:  # pin the Gemini order for this call (e.g. flash-lite only, to verify the backup)
        os.environ["GM_FORCE_MODELS"] = models
    else:
        os.environ.pop("GM_FORCE_MODELS", None)
    import gm_compose

    if callback:
        _callback(job_id, "rendering")
    t0 = time.time()
    log: list = []
    r = None
    parts_report = None
    if engine in ("auto", "parts"):
        try:
            import gm_partcompose
            pr = gm_partcompose.compose_parts(description, narration, log=log, budget_s=600)
        except Exception as exc:  # noqa: BLE001
            pr = {"ok": False, "error": f"{type(exc).__name__}: {exc}", "fallback": True}
        parts_report = {k: pr.get(k) for k in ("ok", "error", "graph", "scene", "gate", "facts", "checklist", "timings", "stages", "mode", "pen_coverage")}
        if pr.get("ok"):
            r = {"ok": True, "video": pr["video"], "pen": pr.get("pen"), "engine": "parts", "code": gm_partcompose_code(pr["scene"]), "timings": pr.get("timings"), "issues": pr["gate"].get("soft")}
        else:
            log.append(f"parts composer: {pr.get('error')} -> free composer")
    if r is None and engine != "parts":
        try:
            r = gm_compose.compose_and_render(description, narration, context, vision=vision, log=log, budget_s=max(240, 780 - (time.time() - t0)))
            r["engine"] = "grammar"
        except Exception as exc:  # noqa: BLE001
            r = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    r = r or {"ok": False, "error": "parts composer failed"}
    report = {k: r.get(k) for k in ("ok", "plan", "spec", "issues", "critique", "history", "timings", "attempt", "error", "engine")}
    report["parts"] = parts_report
    report["log"] = log[-60:]
    report["wall_s"] = round(time.time() - t0, 1)
    if r.get("gate") and r.get("engine") == "grammar":
        report["gate"] = {"duration": r["gate"].get("duration"), "checks": r["gate"].get("checks")}
    _put(report_upload_url, json.dumps(report, default=lambda o: float(o) if hasattr(o, "__float__") else str(o)).encode(), "application/json")
    if not r.get("ok"):
        if callback:
            _callback(job_id, "failed", (r.get("error") or "composition failed") + "\n" + "\n".join(log[-8:]), {"composed": True})
        return json.loads(json.dumps(report, default=lambda o: float(o) if hasattr(o, "__float__") else str(o)))
    with open(r["video"], "rb") as f:
        video = f.read()
    if not _put(upload_url, video, "video/mp4"):
        if callback:
            _callback(job_id, "failed", "Upload failed", {"composed": True})
        report["ok"] = False
        return report
    if r.get("pen") and os.path.exists(r["pen"]):
        with open(r["pen"], "rb") as f:
            _put(paths_upload_url, f.read(), "application/json")
    report["bytes"] = len(video)
    report = json.loads(json.dumps(report, default=lambda o: float(o) if hasattr(o, "__float__") else str(o)))  # numpy-free for the web container
    if callback:
        code = r.get("code") or gm_compose.scene_code(r["spec"])
        _callback(job_id, "done", None, {"composed": True, "code": code, "issues": r.get("issues"), "timings": r.get("timings")})
    return report


def gm_partcompose_code(scene: dict) -> str:
    import gm_parts
    return gm_parts.scene_code(scene)


@app.function(image=web_image, secrets=[secret])
@modal.asgi_app(label="geniusmap-manim-render")
def web():
    from fastapi import FastAPI, Header, HTTPException
    from pydantic import BaseModel, Field

    api = FastAPI(title="GeniusMap Manim render", docs_url=None, redoc_url=None, openapi_url=None)

    class RenderRequest(BaseModel):
        job_id: str = Field(min_length=1, max_length=64)
        code: str = Field(min_length=1, max_length=20000)
        scene_name: str = Field(default="GeneratedScene", pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
        upload_url: str = Field(min_length=10, max_length=4000)
        paths_upload_url: str | None = Field(default=None, max_length=4000)

    @api.get("/health")
    def health():
        return {"ok": True}

    def _auth(tok):
        expected = os.environ.get("RENDER_TOKEN", "")
        if not expected or not tok or not hmac.compare_digest(tok, expected):
            raise HTTPException(status_code=401, detail="unauthorized")

    class ComposeRequest(BaseModel):
        job_id: str = Field(min_length=1, max_length=64)
        description: str = Field(min_length=3, max_length=4000)
        narration: dict | None = None
        context: str = Field(default="", max_length=3000)
        upload_url: str = Field(min_length=10, max_length=4000)
        paths_upload_url: str | None = Field(default=None, max_length=4000)
        report_upload_url: str | None = Field(default=None, max_length=4000)
        vision: str = Field(default="auto", pattern=r"^(auto|always|never)$")
        callback: bool = True
        models: str | None = Field(default=None, max_length=300)  # comma list pinning the Gemini order (tests of the backup)
        engine: str = Field(default="auto", pattern=r"^(auto|parts|grammar)$")

    @api.post("/compose", status_code=202)
    def compose_endpoint(req: ComposeRequest, x_render_token: str | None = Header(default=None)):
        # Concept + narration in; the composer plans, writes and validates a grammar spec, renders, gates and repairs.
        _auth(x_render_token)
        for u in (req.upload_url, req.paths_upload_url, req.report_upload_url):
            if u and not u.startswith("https://"):
                raise HTTPException(status_code=400, detail="upload urls must be https")
        call = compose.spawn(req.job_id, req.description, req.narration, req.context, req.upload_url, req.paths_upload_url, req.report_upload_url, req.vision, req.callback,
                             req.models, req.engine)
        return {"accepted": True, "call_id": call.object_id}

    @api.get("/result/{call_id}")
    def result(call_id: str, x_render_token: str | None = Header(default=None)):
        _auth(x_render_token)
        try:
            out = modal.FunctionCall.from_id(call_id).get(timeout=0)
        except TimeoutError:
            return {"done": False}
        except Exception as exc:  # noqa: BLE001
            return {"done": True, "error": str(exc)[:500]}
        return {"done": True, "result": out}

    class GeminiRequest(BaseModel):
        prompt: str = Field(min_length=1, max_length=60000)
        json_out: bool = True
        temperature: float = 0.4
        strong: bool = False
        images: list[str] = Field(default_factory=list, max_length=4)  # base64 jpeg

    @api.post("/gemini")
    def gemini_proxy(req: GeminiRequest, x_render_token: str | None = Header(default=None)):
        # Token-protected access to the composer's Gemini client (offline evaluation of prompts without the key leaving Modal).
        _auth(x_render_token)
        import base64 as _b64
        import sys as _sys
        _sys.path.insert(0, "/root")
        try:
            from gm_llm import gemini as _gemini_call
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"client unavailable: {exc}")
        log: list = []
        try:
            text = _gemini_call(req.prompt, json_out=req.json_out, images=[_b64.b64decode(i) for i in req.images], temperature=req.temperature, log=log, strong=req.strong)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=503, detail=str(exc)[:300])
        return {"text": text, "log": log}

    class VideoRequest(BaseModel):
        job_id: str = Field(min_length=1, max_length=64)
        page_url: str = Field(min_length=10, max_length=2000)
        upload_url: str = Field(min_length=10, max_length=4000)
        max_s: int = Field(default=7200, ge=60, le=4 * 3600 - 900)
        callback_url: str | None = Field(default=None, max_length=500)

    @api.post("/video", status_code=202)
    def video_endpoint(req: VideoRequest, x_render_token: str | None = Header(default=None)):
        # Record a lesson as an MP4 (lesson_video): the page URL carries its own signed, expiring job token.
        _auth(x_render_token)
        for u in (req.page_url, req.upload_url, req.callback_url):
            if u and not u.startswith("https://"):
                raise HTTPException(status_code=400, detail="urls must be https")
        call = lesson_video.spawn(req.job_id, req.page_url, req.upload_url, req.max_s, req.callback_url)
        return {"accepted": True, "call_id": call.object_id}

    @api.post("/warm", status_code=202)
    def warm(x_render_token: str | None = Header(default=None)):
        # Boots a render container ahead of a lesson's first clip: the spawned call renders an empty
        # scene (fails at once, nothing uploaded, no callback), which also loads manim from disk.
        expected = os.environ.get("RENDER_TOKEN", "")
        if not expected or not x_render_token or not hmac.compare_digest(x_render_token, expected):
            raise HTTPException(status_code=401, detail="unauthorized")
        render.spawn(WARM_JOB, "", "GeneratedScene", "")
        return {"warming": True}

    @api.post("/render", status_code=202)
    def render_endpoint(req: RenderRequest, x_render_token: str | None = Header(default=None)):
        expected = os.environ.get("RENDER_TOKEN", "")
        if not expected or not x_render_token or not hmac.compare_digest(x_render_token, expected):
            raise HTTPException(status_code=401, detail="unauthorized")
        if not req.upload_url.startswith("https://"):
            raise HTTPException(status_code=400, detail="upload_url must be https")
        code, rewrites, problems = guard_manim_code(req.code)
        if problems:
            # Fail fast: no render container is started.
            raise HTTPException(
                status_code=422,
                detail="Static check (Manim Community v0.19) rejected the code: " + " | ".join(problems),
            )
        if req.paths_upload_url and not req.paths_upload_url.startswith("https://"):
            raise HTTPException(status_code=400, detail="paths_upload_url must be https")
        call = render.spawn(req.job_id, code, req.scene_name, req.upload_url, req.paths_upload_url)
        return {"accepted": True, "call_id": call.object_id, "rewrites": rewrites}

    return api

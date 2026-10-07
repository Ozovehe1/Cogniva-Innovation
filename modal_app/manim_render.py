"""
GeniusMap Manim render service (Modal app "geniusmap-manim").

POST /render  (header X-Render-Token must equal the RENDER_TOKEN secret)
  body: {"job_id": str, "code": str, "scene_name": str, "upload_url": str}
  -> 202 {"accepted": true}; the render runs asynchronously.

The render function writes the code to a temp dir, runs
`manim -qm --format mp4` (720p30), PUTs the MP4 to the Supabase signed upload
URL, then calls back POST {APP_URL}/api/manim/callback with
{"job_id", "status": "done"|"failed", "error"} and the same X-Render-Token.

Secrets (Modal secret "geniusmap-render"): RENDER_TOKEN, APP_URL.
Deployed from the Vercel production build (scripts/deploy-modal.mjs).
Web endpoint: https://<modal-workspace>--geniusmap-manim-render.modal.run
"""

import hmac
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
    .pip_install("manim==0.19.0", "httpx==0.27.2")
)

web_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]==0.115.6", "httpx==0.27.2")

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


def _callback(job_id: str, status: str, error: str | None = None) -> None:
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
                json={"job_id": job_id, "status": status, "error": error},
                headers={"X-Render-Token": token},
                timeout=60,
            )
            print(f"callback {status} -> {r.status_code}")
            if r.status_code < 500:
                return
        except Exception as exc:  # noqa: BLE001
            print(f"callback attempt {attempt + 1} failed: {exc}")


@app.function(image=render_image, secrets=[secret], timeout=600, cpu=2.0, memory=4096, max_containers=4)
def render(job_id: str, code: str, scene_name: str, upload_url: str) -> dict:
    import glob
    import subprocess
    import tempfile

    import httpx

    _callback(job_id, "rendering")
    workdir = tempfile.mkdtemp(prefix="manim-")
    src = os.path.join(workdir, "scene.py")
    with open(src, "w") as f:
        f.write(code)

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
        proc = subprocess.run(cmd, cwd=workdir, capture_output=True, text=True, timeout=540)
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

    _callback(job_id, "done")
    return {"ok": True, "bytes": len(data)}


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

    @api.get("/health")
    def health():
        return {"ok": True}

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
        call = render.spawn(req.job_id, code, req.scene_name, req.upload_url)
        return {"accepted": True, "call_id": call.object_id, "rewrites": rewrites}

    return api

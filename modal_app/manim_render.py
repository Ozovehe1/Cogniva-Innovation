"""
GeniusMap Manim render service (Modal app "geniusmap-manim").

POST /render  (header X-Render-Token must equal the RENDER_TOKEN secret)
POST /freeform  free-form Manim for a concept (gm_freeform.py: plan -> code -> sandboxed render -> repair -> critic), template
              composer fallback; same upload URLs and callback as /compose
POST /video   renders a lesson as an MP4 (function lesson_video: parts in parallel on a virtual clock, see lesson_video.py)
              and calls back /api/video/callback
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
    # Free-form generation with a render-and-fix loop (the agent's animate_concept clips): planner -> coder -> sandbox -> critic.
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_freeform.py"), "/root/gm_freeform.py")
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_ffkit.py"), "/root/gm_ffkit.py")
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_ffprobe.py"), "/root/gm_ffprobe.py")
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_manim_docs.json"), "/root/gm_manim_docs.json")
    # The open scene language: the model writes objects + relations + vars + checks; sympy, the constraint solver and the
    # layout engine compute everything; scenes are verified before rendering (gm_scenegen.py -> gm_world.py -> gm_stage.py).
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_world.py"), "/root/gm_world.py")
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_stage.py"), "/root/gm_stage.py")
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_scenegen.py"), "/root/gm_scenegen.py")
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_ir_doc.md"), "/root/gm_ir_doc.md")
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gm_gallery.json"), "/root/gm_gallery.json")
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
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "lesson_video_clock.js"), "/root/lesson_video_clock.js")
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


# Lesson videos render on a virtual clock (lesson_video.py): each part of the lesson is drawn frame by frame as fast as
# Chrome can capture, and the parts render side by side. Parts are ~10-25 s of lesson, so a lesson of any length is
# ready in well under two minutes. A capture's cost is latency in Chrome's compositor, not CPU: 2, 4 and 8 cores
# measured the same, so a part gets 2.
PART_CPU = 2.0
# The longest parts of a lesson (up to this many) render on more cores: they set the render time.
HEAVY_PARTS = 16
HEAVY_CPU = 4.0
# How long the orchestrator may hold parts back for its Storage prefetch (seconds from the start).
PREFETCH_WAIT_S = 6.0


# Parts are one-shot (one input per container): no 60 s idle window, which would bill ~90 idle containers per render.
@app.function(image=video_image, secrets=[secret], timeout=600, cpu=PART_CPU, memory=3072, max_containers=90, scaledown_window=2,
              retries=modal.Retries(max_retries=1, initial_delay=0.0, backoff_coefficient=1.0))
def lesson_video_part(index: int, page_url: str, max_frames: int, settle_s: float, maxrate: int | None, assets: dict | None = None,
                      t_spawn: float | None = None, clip_urls: list | None = None, skip_frames: int = 0, stop_at_max: bool = False) -> dict:
    import sys
    import time
    sys.path.insert(0, "/root")
    import lesson_video as lv

    t = time.time()
    res = lv.render_part(page_url, max_frames=max_frames, settle_s=settle_s, maxrate=maxrate, channel="chrome", assets=assets or {},
                         clip_urls=clip_urls or [], skip_frames=skip_frames, stop_at_max=stop_at_max)
    res["timing"]["fn_s"] = round(time.time() - t, 2)
    if t_spawn:
        res["timing"]["queue_s"] = round(t - t_spawn, 2)  # input ready -> running (upload + container start)
    res["timing"]["t_start"] = t
    print(f"part {index}: {res['duration_s']:.1f}s of video, {res['shots']}/{res['frames']} frames drawn, {res['timing']}")
    return {"index": index, **res}


@app.function(image=video_image, secrets=[secret], timeout=1800, cpu=4.0, memory=4096, max_containers=8, scaledown_window=2)
def lesson_video(job_id: str, page_url: str, upload_url: str, max_s: int = 7200, callback_url: str | None = None,
                 parts: list | None = None, total_s: float | None = None, asset_urls: list | None = None,
                 part_assets: list | None = None, part_ms: list | None = None) -> dict:
    """Render the parts in parallel, join them, upload the MP4 and call back. `parts` are [from, to) step ranges;
    `asset_urls` are every narration line / clip of the lesson and `part_assets[i]` the indices part i needs."""
    import sys
    import tempfile
    import time

    import httpx

    sys.path.insert(0, "/root")
    import lesson_video as lv

    t0 = time.time()
    # [from, to) steps, or a piece of one long clip step: [step, step + 1, skip ms into it, length ms (0: to its end)].
    ranges = [(int(p[0]), int(p[1])) for p in (parts or [])] or [(0, 10 ** 6)]
    pieces = [(int(p[2]), int(p[3])) if len(p) >= 4 else (0, 0) for p in (parts or [])] or [(0, 0)]
    total = float(total_s or max_s / 2)
    maxrate = lv.max_video_rate(total)
    sep = "&" if "?" in page_url else "?"
    _video_callback(callback_url, job_id, "rendering", progress=0.02)
    # Read Storage once for the whole lesson (32 files at a time, with backoff) and hand each part its files.
    urls = list(dict.fromkeys(str(u) for u in (asset_urls or [])))[:5000]
    workdir = tempfile.mkdtemp(prefix="lesson-video-")
    narration = lv.Narration(workdir)
    track = lv.AudioTrack(workdir, narration)
    is_clip = lambda u: "/manim-clips/" in u and u.split("?")[0].lower().endswith(".mp4")  # noqa: E731
    # Clip MP4s are not prefetched: each part downloads its own (one part per clip), so dispatch never waits on them.
    # The longest parts set the render time: they get their files and start first (part_ms: estimated lesson time).
    order = list(range(len(ranges)))
    if part_ms and len(part_ms) == len(ranges):
        order.sort(key=lambda i: -float(part_ms[i] or 0))
    want = [urls[k] for i in order for k in (part_assets[i] if part_assets and i < len(part_assets) else []) if 0 <= k < len(urls)]
    want += urls
    fetcher = lv.Prefetcher(32)
    fetches = {}

    def keep_voice(u, f):
        data = f.result()
        if data is not None and u.endswith(".mp3"):
            narration.files[u] = data  # a late download still saves the narration a second fetch

    for u in want:
        if u not in fetches and not is_clip(u):
            fetches[u] = fetcher.submit(u)
            fetches[u].add_done_callback(lambda f, u=u: keep_voice(u, f))
    stamps: dict = {}
    from concurrent.futures import TimeoutError as FuturesTimeout

    # The heaviest parts (the critical path) get 4 cores: SwiftShader captures ~15-40% faster than on 2 and vary less.
    heavy: set = set()
    if part_ms and len(part_ms) == len(ranges):
        top = max(float(x or 0) for x in part_ms)
        heavy = {i for i in order[:HEAVY_PARTS] if float(part_ms[i] or 0) >= max(8_000.0, 0.85 * top)}

    def inputs(which):
        # Parts are handed to Modal in order as soon as their own files are in, so downloading overlaps the
        # containers starting; map() uploads the inputs in batches instead of one spawn round trip per part.
        for i in order:
            if (i in heavy) != which:
                continue
            a, b = ranges[i]
            last = i == len(ranges) - 1
            url = page_url + (f"{sep}from={a}&to={b}" if parts else "")
            mine = [urls[k] for k in (part_assets[i] if part_assets and i < len(part_assets) else []) if 0 <= k < len(urls)]
            assets, clips = {}, []
            for u in mine:
                if is_clip(u):
                    clips.append(u)
                    continue
                # Storage sometimes throttles (429s with backoff): never hold a part back more than PREFETCH_WAIT_S
                # from the start. A file still on its way is left out and the part fetches it itself, with retries.
                try:
                    data = fetches[u].result(timeout=max(0.0, t0 + PREFETCH_WAIT_S - time.time()))
                except FuturesTimeout:
                    data = None
                    stamps["late_assets"] = stamps.get("late_assets", 0) + 1
                if data is not None:
                    assets[u] = data
                    if u.endswith(".mp3"):
                        narration.files[u] = data
                        narration.want([u])  # decode while the parts render
            # Generous frame cap per part (a part normally runs ~10-40 s of video): stops a page that never finishes.
            max_frames = int(min(max_s, max(600, total * 3 / len(ranges) + 300)) * lv.FPS)
            skip_ms, len_ms = pieces[i]
            if len_ms > 0:
                max_frames = max(1, round(len_ms / lv.FRAME_MS))  # a piece that ends inside its step stops there
            yield (i, url, max_frames, 2.0 if last else 0.0, maxrate, assets, time.time(), clips, round(skip_ms / lv.FRAME_MS), len_ms > 0)
        stamps["inputs_s"] = max(stamps.get("inputs_s", 0), round(time.time() - t0, 1))

    import queue
    import threading

    results: "queue.Queue" = queue.Queue()

    def run_map(fn, which):
        try:
            for res in fn.starmap(inputs(which), order_outputs=False):
                results.put(res)
        except BaseException as exc:  # noqa: BLE001
            results.put(exc)

    maps = [(lesson_video_part, False)] + ([(lesson_video_part.with_options(cpu=HEAVY_CPU), True)] if heavy else [])
    for fn, which in maps:
        threading.Thread(target=run_map, args=(fn, which), daemon=True).start()

    done: dict[int, dict] = {}
    last_report = 0.0
    try:
        while len(done) < len(ranges):
            res = results.get(timeout=900)
            if isinstance(res, BaseException):
                raise res
            i = res["index"]
            stamps.setdefault("first_part_s", round(time.time() - t0, 1))
            # Write the part's video now and hand its narration to the encoder (AAC is encoded as parts land).
            with open(os.path.join(workdir, f"part{i:03d}.mp4"), "wb") as v:
                v.write(res.pop("video"))
            res["timing"]["heavy"] = i in heavy
            done[i] = res
            narration.want(sg[0] for sg in res["segments"])
            track.add(i, res["segments"], res["frames"])
            now = time.time()
            if now - last_report > 2 or len(done) == len(ranges):
                last_report = now
                _video_callback(callback_url, job_id, "rendering", progress=round(0.05 + 0.85 * len(done) / len(ranges), 3))
        if len(done) != len(ranges):
            raise RuntimeError(f"only {len(done)} of {len(ranges)} parts came back")
        failed = [u for u, f in fetches.items() if f.result() is None]
        fetcher.close()
        t_parts = time.time()
        out = lv.assemble([done[i] for i in range(len(ranges))], workdir, narration, track=track, written=True)
        t_join = time.time()
        with open(out["path"], "rb") as f:
            data = f.read()
        r = httpx.put(upload_url, content=data, headers={"Content-Type": "video/mp4", "x-upsert": "true", "cache-control": "max-age=31536000"}, timeout=300)
        if r.status_code >= 300:
            raise RuntimeError(f"upload failed ({r.status_code}): {r.text[:300]}")
    except Exception as exc:  # noqa: BLE001
        print(f"lesson video failed: {exc}")
        _video_callback(callback_url, job_id, "failed", error=f"{type(exc).__name__}: {exc}"[:3000])
        return {"ok": False, "error": str(exc)[:500]}
    parts_meta = [done[i] for i in range(len(ranges))]
    pt = [p["timing"] for p in parts_meta]
    slow = max(range(len(pt)), key=lambda i: pt[i].get("fn_s", 0))
    meta = {
        "renderer": "virtual-clock", "parts": len(ranges), "wall_s": round(time.time() - t0, 1), "spawned_s": stamps.get("inputs_s"),
        "first_part_s": stamps.get("first_part_s"), "prefetch_s": round(fetcher.last_done - t0, 1) if fetcher.last_done else None,
        "prefetch_retries": fetcher.stats["retries"], "late_assets": stamps.get("late_assets", 0), "heavy_parts": len(heavy), "swiftshader_parts": sum(1 for p in pt if p.get("compositor") == "swiftshader"),
        "prefetched": len(fetches) - len(failed), "prefetch_failed": len(failed), "parts_s": round(t_parts - t0, 1),
        "join_s": round(t_join - t_parts, 1), "upload_s": round(time.time() - t_join, 1),
        "slowest_part_s": pt[slow].get("fn_s", 0), "slowest_part": {"index": slow, **pt[slow]},
        "max_queue_s": max(p.get("queue_s", 0) for p in pt), "last_start_s": round(max(p.get("t_start", t0) for p in pt) - t0, 1),
        "part_cpu_s": round(sum(p.get("fn_s", 0) for p in pt), 1),
        "frames": sum(p["frames"] for p in parts_meta), "frames_drawn": sum(p["shots"] for p in parts_meta),
        "audio": out["audio"], "width": out["width"], "height": out["height"], "has_audio": out["has_audio"],
        "unvoiced": sum((p.get("info") or {}).get("missing", 0) for p in parts_meta),
        "storage_fetches_in_parts": sum(p.get("fetched", 0) for p in pt),
        "errors": [e for p in parts_meta for e in p.get("errors", [])][:5],
        # Per part: [index, seconds in the function, frames, frames drawn, probe ms, compositor (C software / G SwiftShader), heavy,
        # seconds to open the page, seconds stepping to a piece's start]
        "per_part": [[i, p.get("fn_s"), parts_meta[i]["frames"], parts_meta[i]["shots"], p.get("probe_ms"), "G" if p.get("compositor") == "swiftshader" else "C",
                      int(bool(p.get("heavy"))), p.get("open_s"), p.get("skip_s", 0)] for i, p in enumerate(pt)],
    }
    print(f"lesson video {job_id}: {meta}")
    _video_callback(callback_url, job_id, "done", bytes=out["bytes"], duration_ms=out["duration_ms"], meta=meta)
    return {"ok": True, "bytes": out["bytes"], "duration_ms": out["duration_ms"], "meta": meta}


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


# ───────────── Free-form scenes (gm_freeform.py) ─────────────
# The sandbox: model-written code runs only here, with no network, no secrets, capped CPU / memory / time, and rlimits
# on the manim subprocess (gm_freeform.render_local). The AST allow-list runs before it, in the orchestrator.
@app.function(image=render_image, timeout=300, cpu=4.0, memory=4096, max_containers=12, block_network=True, scaledown_window=120)
def ff_render(code: str, quality: str = "l", aspect: str = "16:9", want_frames: bool = True, pen: bool = False) -> dict:
    import sys
    sys.path.insert(0, "/root")
    import gm_freeform

    return gm_freeform.render_local(code, quality, aspect, want_frames, pen, manim_bin="manim", kit_dir="/root", cpu_s=600, mem_mb=3800)


@app.function(image=render_image, secrets=[secret], timeout=3600, cpu=1.0, memory=2048, max_containers=12)
def freeform(job_id: str, description: str, narration: dict | None, context: str, upload_url: str, paths_upload_url: str | None,
             report_upload_url: str | None, ff_report_upload_url: str | None, aspect: str = "16:9", fallback: bool = True, callback: bool = True) -> dict:
    """Free-form animation: plan -> code -> sandbox render (repair errors <= 3) -> layout + vision critic -> one visual repair.
    If it cannot produce a clip, the template composer (compose: part graph, then the grammar composer) takes over, so the
    request never ends without a clip unless both fail (then the web app's last-resort code path runs on the failed callback)."""
    import sys
    import time

    sys.path.insert(0, "/root")
    import gm_freeform

    if callback:
        _callback(job_id, "rendering")
    t0 = time.time()
    log: list = []

    def render(code, quality, asp, want_frames, pen):
        return ff_render.remote(code, quality, asp, want_frames, pen)

    # 1) the scene language (verified before rendering, best of 2), 2) free-form Manim code with the render-and-fix loop,
    # 3) the template composer (below, on failure)
    import gm_scenegen

    r = gm_scenegen.run(description, render, narration=narration, context=context, aspect=aspect, log=log)
    if not r.get("ok"):
        log.append(f"scene language failed ({(r.get('error') or '')[:200]}); free-form code next")
        first = r.get("report") or {}
        r = gm_freeform.run(description, render, narration=narration, context=context, aspect=aspect, log=log)
        (r.setdefault("report", {}))["scene_ir_attempt"] = {k: first.get(k) for k in ("error", "variants", "examples")}
    rep = r.get("report") or {}
    rep.pop("_frames", None)
    rep.pop("_frames_v1", None)
    rep.pop("_frames_v2", None)
    rep["log"] = log[-40:]
    rep["wall_s"] = round(time.time() - t0, 1)
    rep["ok"] = bool(r.get("ok"))
    safe = lambda o: float(o) if hasattr(o, "__float__") else str(o)  # noqa: E731
    if r.get("ok") and _put(upload_url, r["video"], "video/mp4"):
        if r.get("pen"):
            _put(paths_upload_url, r["pen"], "application/json")
        rep["bytes"] = len(r["video"])
        _put(ff_report_upload_url or report_upload_url, json.dumps(rep, default=safe).encode(), "application/json")
        if callback:
            _callback(job_id, "done", None, {"composed": True, "engine": rep.get("engine", "freeform"), "code": r["code"], "timings": rep.get("timings")})
        return json.loads(json.dumps(rep, default=safe))
    rep["fallback"] = "template composer" if fallback else None
    _put(ff_report_upload_url or report_upload_url, json.dumps(rep, default=safe).encode(), "application/json")
    print(f"freeform {job_id} failed ({rep.get('error')}); fallback={fallback}")
    if fallback:
        compose.spawn(job_id, description, narration, context, upload_url, paths_upload_url, report_upload_url, "auto", callback, None, "auto")
    elif callback:
        _callback(job_id, "failed", (rep.get("error") or "free-form failed")[:3000], {"composed": True})
    return json.loads(json.dumps(rep, default=safe))


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

    class FreeformRequest(ComposeRequest):
        ff_report_upload_url: str | None = Field(default=None, max_length=4000)
        aspect: str = Field(default="16:9", pattern=r"^(16:9|9:16)$")
        fallback: bool = True

    @api.post("/freeform", status_code=202)
    def freeform_endpoint(req: FreeformRequest, x_render_token: str | None = Header(default=None)):
        # Concept in; free-form Manim with a render-and-fix loop (template composer as the fallback).
        _auth(x_render_token)
        for u in (req.upload_url, req.paths_upload_url, req.report_upload_url, req.ff_report_upload_url):
            if u and not u.startswith("https://"):
                raise HTTPException(status_code=400, detail="upload urls must be https")
        call = freeform.spawn(req.job_id, req.description, req.narration, req.context, req.upload_url, req.paths_upload_url, req.report_upload_url,
                              req.ff_report_upload_url, req.aspect, req.fallback, req.callback)
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
        models: str | None = Field(default=None, max_length=300)  # comma list pinning the model order for this call

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
            text = _gemini_call(req.prompt, json_out=req.json_out, images=[_b64.b64decode(i) for i in req.images], temperature=req.temperature, log=log, strong=req.strong,
                                models=[m.strip() for m in (req.models or "").split(",") if m.strip()] or None)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=503, detail=str(exc)[:300])
        return {"text": text, "log": log}

    class VideoRequest(BaseModel):
        job_id: str = Field(min_length=1, max_length=64)
        page_url: str = Field(min_length=10, max_length=2000)
        upload_url: str = Field(min_length=10, max_length=4000)
        max_s: int = Field(default=7200, ge=60, le=4 * 3600 - 900)
        callback_url: str | None = Field(default=None, max_length=500)
        parts: list[list[int]] | None = Field(default=None, max_length=200)
        total_s: float | None = Field(default=None, ge=0, le=6 * 3600)
        asset_urls: list[str] | None = Field(default=None, max_length=5000)
        part_assets: list[list[int]] | None = Field(default=None, max_length=200)
        part_ms: list[float] | None = Field(default=None, max_length=200)

    @api.post("/video", status_code=202)
    def video_endpoint(req: VideoRequest, x_render_token: str | None = Header(default=None)):
        # Record a lesson as an MP4 (lesson_video): the page URL carries its own signed, expiring job token.
        _auth(x_render_token)
        for u in (req.page_url, req.upload_url, req.callback_url):
            if u and not u.startswith("https://"):
                raise HTTPException(status_code=400, detail="urls must be https")
        for u in req.asset_urls or []:
            if not u.startswith("https://"):
                raise HTTPException(status_code=400, detail="asset urls must be https")
        call = lesson_video.spawn(req.job_id, req.page_url, req.upload_url, req.max_s, req.callback_url, req.parts, req.total_s,
                                  req.asset_urls, req.part_assets, req.part_ms)
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

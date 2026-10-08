"""
Lesson video renderer (used by the Modal functions `lesson_video` and `lesson_video_part` in manim_render.py).

The token-protected render page /render/lesson/<id> (src/app/render/lesson) plays the lesson by itself exactly as the
player does: boards drawn by the hand, Manim clips, KaTeX maths, checks shown on the board and answered after a pause.

Nothing is recorded in real time. lesson_video_clock.js is injected before the page's own scripts and puts the page on
a virtual clock (performance.now, Date, timers, requestAnimationFrame, CSS/Web animations, and the playheads of every
<audio>/<video>). We step that clock one frame (40 ms) at a time, capture each frame that changed and pipe it straight
into ffmpeg, so a frame costs only what it takes to draw (~30-40 ms) and lands exactly on its timestamp. The
narration is never played: the page logs when each narration line starts and stops on the virtual clock
(window.__gmAudioLog), and the track is rebuilt sample-exactly from the cached MP3s.

To go faster still, the lesson is split into parts at step boundaries (?from=&to= on the render page; each part
starts from the board exactly as it stands at that step) and the parts render in parallel containers. The narration
track is encoded to AAC as parts finish (AudioTrack); assemble() joins the parts' H.264 and muxes the track, both by
stream copy.

Storage is read once per render: the orchestrator downloads every narration line and clip pen path of the lesson
(prefetch_one) and hands each part the files it needs; the part's browser is served those bytes instead of asking
Supabase Storage (dozens of parts asking at once got 429 "too many connections"). Clip MP4s are the exception: each
part downloads its own (a clip is used by one part, and shipping megabytes through the spawn slowed dispatch).

Capture speed: Chrome paces screenshots to its 60 Hz frame clock, which on a busy CPU cost 100-175 ms a frame; with
--disable-frame-rate-limit --disable-gpu-vsync a capture is only the draw itself.

Local test of one part:  python lesson_video.py "<render page url>" /tmp/out
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

FPS = 25
WIDTH, HEIGHT = 1280, 720
# The narration voice (Kokoro) is 24 kHz mono: the track is built and encoded at that rate.
SAMPLE_RATE = 24000
# Supabase Storage's per-file limit is 50 MB on this project; stay safely under it.
MAX_BYTES = 47 * 1024 * 1024
AUDIO_KBPS = 64
CLOCK_JS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lesson_video_clock.js")
FRAME_MS = 1000 / FPS
# SwiftShader GPU compositing: the fallback on hosts where the software compositor is slow (see record()).
SWIFTSHADER_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
PROBE_SHOTS = 8
SLOW_SHOT_MS = 75
# Threads for each part's H.264 encoder (it runs beside Chrome in the same container).
X264_THREADS = 2
CHROME_ARGS = [
    "--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage", "--hide-scrollbars", "--force-color-profile=srgb",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    # Draw a frame the moment the recorder asks for it instead of waiting for the next 60 Hz tick.
    "--disable-frame-rate-limit", "--disable-gpu-vsync",
    # The clips come from a local file server (ClipCache); let the public page load them.
    "--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks",
]


def _log(*a):
    print("[lesson-video]", *a, flush=True)


def x264_args(maxrate: int | None) -> list[str]:
    """One encoder setting for every part, so the parts join by stream copy."""
    rate = ["-crf", "26"] + (["-maxrate", str(maxrate), "-bufsize", str(maxrate * 2)] if maxrate else [])
    return ["-c:v", "libx264", "-preset", "veryfast", "-tune", "animation", "-threads", str(X264_THREADS), *rate, "-pix_fmt", "yuv420p", "-r", str(FPS),
            "-x264-params", f"keyint={FPS * 10}:min-keyint={FPS}:scenecut=40"]


def max_video_rate(total_s: float) -> int:
    """A peak video bitrate that keeps the whole lesson under the storage file limit (CRF decides below it)."""
    budget = (MAX_BYTES * 8 * 0.9) / max(30.0, total_s) - AUDIO_KBPS * 1000
    return int(max(120_000, min(2_500_000, budget)))


class ClipCache:
    """The lesson's Manim clips as still frames. Seeking a <video> to every frame and compositing it cost ~30 ms a step
    and ~150-180 ms a capture on the recorder's CPU (a clip-heavy part ran at ~5 fps), so the clock never seeks clip
    videos: each clip is cut once into JPEG frames at the video's frame rate, and lesson_video_clock.js shows the frame
    for the clip's virtual playhead in an <img> laid exactly over the (hidden) video. The page still loads the original
    MP4 (duration, size and the narration clock come from it); it is served from memory with byte ranges."""

    def __init__(self, workdir: str, assets: dict[str, bytes] | None = None):
        self.dir = workdir
        os.makedirs(workdir, exist_ok=True)
        self.assets = assets or {}
        self.jobs: dict[str, asyncio.Future] = {}
        self.data: dict[str, bytes] = {}

    @staticmethod
    def key(url: str) -> str:
        return url.split("?")[0]

    def _cut(self, url: str) -> dict | None:
        import hashlib
        h = hashlib.sha1(url.encode()).hexdigest()[:16]
        out = os.path.join(self.dir, h)
        os.makedirs(out, exist_ok=True)
        try:
            data = self.assets.get(url)
            if data is None:
                data = _get(url)
            self.data[url] = data
            src = os.path.join(out, "src.mp4")
            with open(src, "wb") as f:
                f.write(data)
            _run(["ffmpeg", "-y", "-loglevel", "error", "-threads", "2", "-i", src, "-an", "-vf", f"fps={FPS}", "-q:v", "3", "-start_number", "0",
                  os.path.join(out, "%d.jpg")], timeout=300)
            if os.environ.get("LV_CLIP_CODEC") == "vp8":
                # Local runs in Playwright's Chromium, which has no H.264: the page gets a VP8 copy for its metadata.
                webm = os.path.join(out, "src.webm")
                _run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-an", "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "1M", webm], timeout=300)
                with open(webm, "rb") as f:
                    self.data[url] = f.read()
            n = len([x for x in os.listdir(out) if x.endswith(".jpg")])
            # Frames identical to an earlier one (the clip's holds) map to it, so they cost no capture.
            # Only runs of identical frames collapse (an exact repeat later in the clip still shows its own index).
            same = []
            prev_dig, prev_idx = None, 0
            for i in range(n):
                with open(os.path.join(out, f"{i}.jpg"), "rb") as f:
                    dig = hashlib.md5(f.read()).digest()
                if dig != prev_dig:
                    prev_dig, prev_idx = dig, i
                same.append(prev_idx)
            return {"base": f"/__gmclip/{h}/", "count": n, "fps": FPS, "same": same, "dir": out} if n else None
        except Exception as exc:  # noqa: BLE001
            _log(f"clip frames failed ({url[-60:]}): {exc}")
            return None

    def prepare(self, url: str) -> asyncio.Future:
        k = self.key(url)
        if k not in self.jobs:
            self.jobs[k] = asyncio.ensure_future(asyncio.get_running_loop().run_in_executor(None, self._cut, k))
        return self.jobs[k]

    async def frames_map(self) -> dict:
        out = {}
        for k, fut in list(self.jobs.items()):
            r = await fut
            if r:
                out[k] = {"base": r["base"], "count": r["count"], "fps": r["fps"], "same": r["same"]}
        return out

    async def handle_video(self, route):
        """The clip's MP4 itself, from memory, honouring Range."""
        k = self.key(route.request.url)
        try:
            fut = self.prepare(k)
            data = self.data.get(k) or (self.assets.get(k) if os.environ.get("LV_CLIP_CODEC") != "vp8" else None)
            if data is None:
                await fut
                data = self.data.get(k)
            if data is None:
                await route.continue_()
                return
            size = len(data)
            start, end = 0, size - 1
            rng = route.request.headers.get("range")
            hdr = {"Content-Type": "video/webm" if data[:4] == b"\x1a\x45\xdf\xa3" else "video/mp4", "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=3600"}
            if rng and rng.startswith("bytes="):
                x, _, y = rng[6:].partition("-")
                start = min(size - 1, int(x or 0))
                end = min(size - 1, int(y) if y else size - 1)
                hdr["Content-Range"] = f"bytes {start}-{end}/{size}"
                await route.fulfill(status=206, body=data[start:end + 1], headers=hdr)
            else:
                await route.fulfill(status=200, body=data, headers=hdr)
        except Exception as exc:  # noqa: BLE001
            _log(f"clip route failed: {exc}")
            await route.continue_()

    async def handle_frame(self, route):
        from urllib.parse import urlparse
        parts = urlparse(route.request.url).path.split("/")  # /__gmclip/<hash>/<n>.jpg
        path = os.path.join(self.dir, os.path.basename(parts[-2]), os.path.basename(parts[-1]))
        if not os.path.isfile(path):
            await route.fulfill(status=404, body=b"")
            return
        await route.fulfill(status=200, path=path, headers={"Content-Type": "image/jpeg", "Cache-Control": "max-age=3600"})


def _ctype(url: str) -> str:
    u = url.split("?")[0].lower()
    return "audio/mpeg" if u.endswith(".mp3") else "application/json" if u.endswith(".json") else "video/mp4" if u.endswith(".mp4") else "application/octet-stream"


async def record(page_url: str, out_video: str, max_frames: int, settle_s: float = 0.0, on_progress=None, channel: str | None = None,
                 maxrate: int | None = None, extra_args: list[str] | None = None, assets: dict[str, bytes] | None = None,
                 stop_at_max: bool = False, clip_urls: list[str] | None = None) -> dict:
    """Play the render page on a virtual clock (lesson_video_clock.js): step it one frame at a time, capture each frame
    that changed and pipe them to ffmpeg as constant-25-fps H.264. Returns timings, the narration log and page info.

    Chrome's software compositor captures a frame in ~35 ms on most hosts but ~150-200 ms on others (same CPU speed;
    the difference is in the sandbox), where SwiftShader GPU compositing captures in ~60-70 ms. Both browsers open the
    page side by side; a few captures are timed on the default one and the other is closed (fast host) or used (slow
    host), so a slow host no longer pays a full restart (~6-7 s)."""
    from playwright.async_api import async_playwright

    assets = assets or {}
    clips = ClipCache(tempfile.mkdtemp(prefix="lv-clips-"), assets)
    # Cut the clips' frames while the page loads (the part downloads its own clips; the orchestrator does not).
    for u in list(clip_urls or []) + [u for u in assets if "/manim-clips/" in u and u.endswith(".mp4")]:
        clips.prepare(u)
    args = list(extra_args or [])
    probe = not any(a.startswith("--use-angle") for a in args)
    console: list[str] = []
    served = {"hit": 0, "miss": 0}
    timing: dict = {}
    t_launch = time.time()
    async with async_playwright() as p:
        opens = {"software" if probe else "swiftshader": asyncio.ensure_future(
            _open(p, page_url, channel, args, assets, clips, served, console))}
        if probe:
            opens["swiftshader"] = asyncio.ensure_future(_open(p, page_url, channel, args + SWIFTSHADER_ARGS, assets, clips, served, console))

        async def discard(task):
            try:
                await (await task)["browser"].close()
            except Exception:  # noqa: BLE001
                pass

        chosen = next(iter(opens))
        try:
            st = await opens[chosen]
        except Exception as exc:  # noqa: BLE001
            if "swiftshader" not in opens or chosen == "swiftshader":
                raise
            _log(f"default browser failed to open ({exc}); using SwiftShader")
            chosen, st = "swiftshader", await opens["swiftshader"]
        timing.update({"launch_s": st["launch_s"], "ready_s": st["ready_s"]})
        shot_args = {"format": "jpeg", "quality": 88, "optimizeForSpeed": True}
        if probe and chosen == "software":
            for _ in range(2):
                await st["cdp"].send("Page.captureScreenshot", shot_args)
            tp = time.time()
            for _ in range(PROBE_SHOTS):
                await st["cdp"].send("Page.captureScreenshot", shot_args)
            ms = round((time.time() - tp) / PROBE_SHOTS * 1000)
            timing["probe_ms"] = ms
            if ms > SLOW_SHOT_MS:
                tw = time.time()
                try:
                    alt = await opens["swiftshader"]
                    asyncio.ensure_future(st["browser"].close())
                    chosen, st = "swiftshader", alt
                    timing["probe_lost_s"] = round(time.time() - tw, 2)
                except Exception as exc:  # noqa: BLE001
                    _log(f"SwiftShader browser failed to open ({exc}); staying on the software compositor")
            else:
                asyncio.ensure_future(discard(opens["swiftshader"]))
        elif "software" in opens and chosen == "swiftshader":
            asyncio.ensure_future(discard(opens["software"]))
        timing["compositor"] = chosen
        timing["open_s"] = round(time.time() - t_launch, 2)
        try:
            res = await _capture(st, out_video, max_frames, settle_s, on_progress, maxrate, stop_at_max, shot_args)
        finally:
            for k, task in opens.items():
                if task.done() and not task.cancelled() and task.exception() is None:
                    try:
                        await task.result()["browser"].close()
                    except Exception:  # noqa: BLE001
                        pass
    res["timing"] = {**timing, **res["timing"], "prefetched": served["hit"], "fetched": served["miss"]}
    res["console"] = console[-30:]
    return res


async def _open(p, page_url: str, channel: str | None, args: list[str], assets: dict[str, bytes], clips: "ClipCache", served: dict,
                console: list[str]) -> dict:
    """Launch Chrome with these flags, open the render page and wait until it is ready to play."""
    t_launch = time.time()
    proxy = None
    if os.environ.get("LV_PROXY"):
        from urllib.parse import urlparse
        u = urlparse(os.environ["LV_PROXY"])
        proxy = {"server": f"{u.scheme}://{u.hostname}:{u.port}", "username": u.username or "", "password": u.password or ""}
    browser = await p.chromium.launch(channel=channel, proxy=proxy, args=[*CHROME_ARGS, *args])
    try:
        ctx = await browser.new_context(viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=1, reduced_motion="no-preference")
        await ctx.add_init_script(path=CLOCK_JS)
        await ctx.route(lambda url: "/manim-clips/" in url and ".mp4" in url, clips.handle_video)
        await ctx.route(lambda url: "/__gmclip/" in url, clips.handle_frame)

        async def from_prefetch(route):
            # Narration lines and clip pen paths the orchestrator already downloaded: never ask Storage again.
            body = assets.get(route.request.url.split("?")[0])
            if body is None:
                served["miss"] += 1
                await route.continue_()
                return
            served["hit"] += 1
            await route.fulfill(status=200, body=body, headers={"Content-Type": _ctype(route.request.url), "Access-Control-Allow-Origin": "*",
                                                                 "Cache-Control": "max-age=3600"})

        if assets:
            await ctx.route(lambda url: "/storage/v1/object/public/" in url and not ("/manim-clips/" in url and ".mp4" in url), from_prefetch)
        page = await ctx.new_page()
        page.on("console", lambda m: console.append(f"{m.type}: {m.text}"[:300]) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: console.append(f"pageerror: {e}"[:300]))
        t_open = time.time()
        resp = await page.goto(page_url, wait_until="load", timeout=120_000)
        if not resp or resp.status >= 400:
            raise RuntimeError(f"render page answered {resp.status if resp else 'nothing'}")
        # The page fetches its narration lines and clips before it says it is ready.
        await page.wait_for_function("window.__gmRender && window.__gmRender.ready", timeout=180_000, polling=100)
        info = await page.evaluate("({missing: __gmRender.missing, lines: __gmRender.lines, total: __gmRender.total})")
        frames_map = await clips.frames_map()
        await page.evaluate("(m) => { window.__gmClipFrames = m }", frames_map)
        info["clips"] = len(frames_map)
        cdp = await ctx.new_cdp_session(page)
        return {"browser": browser, "page": page, "cdp": cdp, "info": info, "launch_s": round(t_open - t_launch, 2), "ready_s": round(time.time() - t_open, 2)}
    except BaseException:
        await browser.close()
        raise


async def _capture(st: dict, out_video: str, max_frames: int, settle_s: float, on_progress, maxrate: int | None, stop_at_max: bool,
                   shot_args: dict) -> dict:
    page, cdp, info = st["page"], st["cdp"], st["info"]
    timing: dict = {}
    ok = False
    frames = shots = 0
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", str(FPS), "-i", "-",
                           *x264_args(maxrate), "-an", "-movflags", "+faststart", out_video], stdin=subprocess.PIPE)
    try:
        t0 = await page.evaluate("__vclock.enable(), __gmRender.start()") / 1000.0
        t_cap = time.time()
        last = None
        settle_frames = int(round(settle_s * FPS))
        done_at = None
        first = True
        prof = {"step_s": 0.0, "shot_s": 0.0, "pipe_s": 0.0}
        while True:
            ts = time.time()
            try:
                s = await asyncio.wait_for(page.evaluate("__vclock.step(%s).then(r => ({d: r.dirty, c: __gmRender.cursor, t: __gmRender.total, e: __gmRender.done}))" % (0 if first else FRAME_MS)), 60.0)
            except asyncio.TimeoutError:
                raise RuntimeError(f"the page stopped responding at frame {frames}: {await page.evaluate('__vclock.stats()')}")
            first = False
            prof["step_s"] += time.time() - ts
            if s["d"] or last is None:
                t1 = time.time()
                shot = await cdp.send("Page.captureScreenshot", shot_args)
                last = base64.b64decode(shot["data"])
                shots += 1
                prof["shot_s"] += time.time() - t1
            t1 = time.time()
            ff.stdin.write(last)
            prof["pipe_s"] += time.time() - t1
            frames += 1
            if s["e"] and done_at is None:
                done_at = frames
            if done_at is not None and frames - done_at >= settle_frames:
                break
            if frames >= max_frames:
                if stop_at_max:
                    break
                raise RuntimeError(f"the lesson did not finish within {max_frames // FPS} s of video (at step {s['c']} of {s['t']})")
            if on_progress and frames % 125 == 0:
                on_progress(s["c"], s["t"], frames)
        timing["capture_s"] = round(time.time() - t_cap, 2)
        timing.update({k: round(v, 2) for k, v in prof.items()})
        audio_log = await page.evaluate("window.__gmAudioLog || []")
        errors = await page.evaluate("(window.__gmRender.errors || []).concat(window.__vclock.errors || [])")
        ok = True
    finally:
        if not ok and ff.poll() is None:
            ff.kill()
    ff.stdin.close()
    if ff.wait(timeout=600) != 0:
        raise RuntimeError(f"ffmpeg could not encode the frames ({frames} frames, {shots} drawn)")
    timing["encode_tail_s"] = round(time.time() - t_cap - timing.get("capture_s", 0), 2)
    dur = frames / FPS
    return {"t0": t0, "t_end": t0 + dur, "frames": frames, "shots": shots, "duration_s": dur, "audio_log": audio_log, "info": info,
            "errors": (errors or [])[:20], "timing": timing}


def _run(cmd: list[str], timeout: float = 3600):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"{os.path.basename(cmd[0])} failed: {(r.stderr or r.stdout)[-1500:]}")
    return r


def _get(url: str, attempts: int = 5) -> bytes:
    """GET with retry and backoff on Storage's 429 / 5xx and network errors."""
    import random
    import urllib.error
    delay = 0.4
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "geniusmap-lesson-video"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as exc:
            if exc.code not in (408, 425, 429, 500, 502, 503, 504) or attempt == attempts - 1:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
            if attempt == attempts - 1:
                raise
        time.sleep(delay + random.random() * delay)
        delay *= 2
    raise RuntimeError("unreachable")


def _fetch(url: str, dest: str):
    data = _get(url)
    with open(dest, "wb") as f:
        f.write(data)


class Prefetcher:
    """The orchestrator's Storage downloads over one pool of kept-alive connections (a new TLS connection per file was
    slow from Modal and counts against Storage's connection limit), with retry and backoff on 429 / 5xx."""

    def __init__(self, workers: int = 32):
        import httpx
        self.client = httpx.Client(timeout=60, follow_redirects=True, headers={"User-Agent": "geniusmap-lesson-video"},
                                   limits=httpx.Limits(max_connections=workers, max_keepalive_connections=workers))
        self.pool = ThreadPoolExecutor(max_workers=workers)
        self.stats = {"retries": 0, "failed": 0}
        self.last_done = 0.0

    def _get(self, url: str, attempts: int = 5) -> bytes | None:
        import random
        delay = 0.3
        for attempt in range(attempts):
            try:
                r = self.client.get(url)
                if r.status_code < 300:
                    return r.content
                if r.status_code not in (408, 425, 429, 500, 502, 503, 504):
                    break
            except Exception:  # noqa: BLE001
                pass
            if attempt < attempts - 1:
                self.stats["retries"] += 1
                time.sleep(delay + random.random() * delay)
                delay *= 2
        self.stats["failed"] += 1
        return None

    def _get_timed(self, url: str) -> bytes | None:
        try:
            return self._get(url)
        finally:
            self.last_done = max(self.last_done, time.time())

    def submit(self, url: str):
        return self.pool.submit(self._get_timed, url)

    def close(self):
        self.pool.shutdown(wait=False)


def prefetch_one(url: str) -> bytes | None:
    """One file for the orchestrator's prefetch; None when it is missing (a line never voiced) or keeps failing."""
    try:
        return _get(url)
    except Exception:  # noqa: BLE001
        return None


def _decode(path: str) -> bytes:
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-"], capture_output=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode()[-300:])
    return r.stdout


def narration_segments(audio_log: list[dict], t0_ms: float, dur_s: float) -> list[tuple[str, float, float, float]]:
    """(src, position in the file, start, end) in seconds from the part's start: each play runs until the next audio
    event (one narration element plays at a time)."""
    events = sorted([e for e in audio_log if isinstance(e, dict) and e.get("src") and isinstance(e.get("t"), (int, float))], key=lambda e: e["t"])
    segs = []
    for i, e in enumerate(events):
        if e.get("ev") != "play":
            continue
        start = (e["t"] - t0_ms) / 1000.0
        end = (events[i + 1]["t"] - t0_ms) / 1000.0 if i + 1 < len(events) else dur_s
        end = min(end, dur_s)
        if end > start:
            segs.append((e["src"], float(e.get("pos") or 0.0), start, end))
    return segs


class Narration:
    """Fetches and decodes narration files in the background (started as soon as a part reports its lines)."""

    def __init__(self, workdir: str, files: dict[str, bytes] | None = None):
        self.dir = os.path.join(workdir, "audio")
        os.makedirs(self.dir, exist_ok=True)
        self.pool = ThreadPoolExecutor(max_workers=max(4, os.cpu_count() or 4))
        self.jobs: dict[str, object] = {}
        self.files = files or {}
        import threading
        self.lock = threading.Lock()

    def want(self, srcs):
        with self.lock:
            for src in srcs:
                if src not in self.jobs:
                    self.jobs[src] = self.pool.submit(self._load, src, os.path.join(self.dir, f"{len(self.jobs)}.mp3"))

    def _load(self, src: str, dest: str) -> bytes | None:
        try:
            data = self.files.get(src.split("?")[0])
            if data is not None:
                with open(dest, "wb") as f:
                    f.write(data)
            else:
                _fetch(src, dest)
            return _decode(dest)
        except Exception as exc:  # noqa: BLE001
            _log(f"narration file failed ({src[-60:]}): {exc}")
        return None

    def pcm(self, src: str) -> bytes | None:
        job = self.jobs.get(src)
        return job.result() if job else None  # type: ignore[attr-defined]


def probe(path: str) -> dict:
    r = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height", "-of", "json", path], timeout=60)
    j = json.loads(r.stdout)
    streams = j.get("streams", [])
    return {
        "duration_s": float(j.get("format", {}).get("duration") or 0),
        "bytes": int(j.get("format", {}).get("size") or os.path.getsize(path)),
        "video": next((s for s in streams if s.get("codec_type") == "video"), None),
        "audio": next((s for s in streams if s.get("codec_type") == "audio"), None),
    }


def host_info() -> dict:
    """What the container runs on (part timings vary a lot between hosts)."""
    info: dict = {"cpus": os.cpu_count()}
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("model name"):
                    info["cpu"] = line.split(":", 1)[1].strip()[:60]
                    break
    except OSError:
        pass
    t, n = time.perf_counter(), 0
    while time.perf_counter() - t < 0.2:
        sum(range(2000))
        n += 1
    info["cpu_score"] = n
    return info


def render_part(page_url: str, max_frames: int, settle_s: float = 0.0, maxrate: int | None = None, channel: str | None = None, on_progress=None,
                extra_args: list[str] | None = None, assets: dict[str, bytes] | None = None, stop_at_max: bool = False,
                clip_urls: list[str] | None = None) -> dict:
    """Render one part (the render page with its from/to). Returns the H.264 bytes and its narration segments."""
    workdir = tempfile.mkdtemp(prefix="lesson-part-")
    out = os.path.join(workdir, "part.mp4")
    t = time.time()
    host = host_info()
    rec = asyncio.run(record(page_url, out, max_frames, settle_s=settle_s, on_progress=on_progress, channel=channel, maxrate=maxrate, extra_args=extra_args,
                             assets=assets, stop_at_max=stop_at_max, clip_urls=clip_urls))
    segs = narration_segments(rec["audio_log"], rec["t0"] * 1000.0, rec["duration_s"])
    with open(out, "rb") as f:
        data = f.read()
    shutil.rmtree(workdir, ignore_errors=True)
    return {
        "video": data, "frames": rec["frames"], "shots": rec["shots"], "duration_s": rec["duration_s"], "segments": segs, "info": rec["info"],
        "errors": rec["errors"][:5], "console": rec["console"][-5:], "timing": {**rec["timing"], **host, "total_s": round(time.time() - t, 2)},
    }


def _adts_frames(data: bytes) -> list[bytes]:
    out, i = [], 0
    while i + 7 <= len(data):
        n = ((data[i + 3] & 3) << 11) | (data[i + 4] << 3) | (data[i + 5] >> 5)
        if n < 7 or data[i] != 0xFF:
            raise RuntimeError("bad ADTS stream")
        out.append(data[i:i + n])
        i += n
    return out


class AudioTrack:
    """The narration track, encoded to AAC while the parts are still rendering, in chunks on several cores.

    Parts are laid on the track in order as they finish (part i's samples are known once parts 0..i are in). The track
    is cut into chunks at silent moments (between narration lines) on the AAC frame grid (1024 samples); each chunk
    is encoded on its own (with a little real audio before it, whose frames are dropped) and the chunks' AAC frames
    are joined by stream copy. A seam inside speech would click (two encoders' windows do not cancel), a seam in
    silence is inaudible. When the last part lands only the rest of the track is left, and it is split over the cores.
    The joined ADTS stream carries no priming edit list, so the track starts 1024 samples in (the encoder's delay)
    and decodes exactly on the video's timeline."""

    FRAME = 1024
    PRE = 2048          # real audio encoded before each chunk; its frames are dropped (PRE // FRAME of them)
    QUIET = 4096        # samples of silence on each side of a seam
    MIN_CHUNK = 20 * SAMPLE_RATE
    MAX_CHUNK = 120 * SAMPLE_RATE  # no silence found within this: cut anyway

    def __init__(self, workdir: str, narration: Narration, workers: int | None = None):
        import queue
        import threading
        self.narration = narration
        self.path = os.path.join(workdir, "narration.aac")
        self.parts: dict[int, tuple[list, int]] = {}
        self.next = 0
        self.offset_s = 0.0
        self.pcm = bytearray()      # 16-bit mono samples laid so far (parts 0..next-1)
        self.cs = self.FRAME        # start sample of the next chunk to encode
        self.placed = 0.0
        self.missing = 0
        self.segments = 0
        self.workers = workers or max(2, min(6, os.cpu_count() or 2))
        self.pool = ThreadPoolExecutor(max_workers=self.workers)
        self.chunks: list = []      # futures of AAC frame lists, in track order
        self.q: "queue.Queue" = queue.Queue()
        self.err: Exception | None = None
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def add(self, index: int, segments: list, frames: int):
        """A finished part (its narration segments, relative to its own start, and its frame count)."""
        self.parts[index] = (segments, frames)
        while self.next in self.parts:
            segs, n = self.parts.pop(self.next)
            self.q.put((self.offset_s, segs, n / FPS))
            self.offset_s += n / FPS
            self.next += 1

    def _lay(self, off: float, segs: list, dur: float):
        start = int(round(off * SAMPLE_RATE))
        n = max(0, int(round((off + dur) * SAMPLE_RATE)) - start)
        buf = bytearray(n * 2)
        for src, pos, ts, te in segs:
            self.segments += 1
            data = self.narration.pcm(src)
            if not data:
                self.missing += 1
                continue
            a = int(pos * SAMPLE_RATE) * 2
            chunk = data[a:a + max(0, int(round((te - ts) * SAMPLE_RATE))) * 2]
            o = (int(round((ts + off) * SAMPLE_RATE)) - start) * 2
            if o < 0:
                chunk, o = chunk[-o:], 0
            chunk = chunk[: max(0, len(buf) - o)]
            if chunk:
                buf[o:o + len(chunk)] = chunk
                self.placed += len(chunk) / 2 / SAMPLE_RATE
        self.pcm += buf

    def _quiet(self, b: int) -> bool:
        # Near silence: every sample within +-255 (high byte 0x00 or 0xFF), about -42 dBFS.
        seg = bytes(self.pcm[(b - self.QUIET) * 2 + 1:(b + self.QUIET) * 2:2])
        return len(seg) == self.QUIET * 2 and not seg.translate(None, b"\x00\xff")

    def _cut(self, start: int, limit: int, min_len: int) -> int | None:
        """The first silent frame boundary in [start + min_len, limit - QUIET], or a forced cut after MAX_CHUNK."""
        F = self.FRAME
        b = start + -(-min_len // F) * F
        while b + self.QUIET <= limit:
            if self._quiet(b) or b - start >= self.MAX_CHUNK:
                return b
            b += F
        return None

    def _encode(self, s: int, e: int | None) -> list[bytes]:
        """AAC frames of samples [s, e) (e None: to the end of the track, encoder tail included)."""
        pre = bytes(self.pcm[max(0, s - self.PRE) * 2:s * 2])
        pre = bytes(self.PRE * 2 - len(pre)) + pre
        body = bytes(self.pcm[s * 2:(e * 2 if e is not None else len(self.pcm))])
        r = subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "1", "-i", "-", "-c:a", "aac", "-b:a", f"{AUDIO_KBPS}k",
                            "-ac", "1", "-f", "adts", "-"], input=pre + body, capture_output=True, timeout=600)
        if r.returncode != 0:
            raise RuntimeError(r.stderr.decode()[-300:])
        frames = _adts_frames(r.stdout)[self.PRE // self.FRAME:]
        return frames if e is None else frames[: (e - s) // self.FRAME]

    def _run(self):
        try:
            while True:
                item = self.q.get()
                if item is None:
                    break
                self._lay(*item)
                total = len(self.pcm) // 2
                while True:
                    b = self._cut(self.cs, total, self.MIN_CHUNK)
                    if b is None:
                        break
                    self.chunks.append(self.pool.submit(self._encode, self.cs, b))
                    self.cs = b
        except Exception as exc:  # noqa: BLE001
            self.err = exc

    def finish(self, timeout: float = 300) -> dict:
        self.q.put(None)
        self.thread.join(timeout)
        if self.err:
            raise RuntimeError(f"narration track failed: {self.err}")
        total = len(self.pcm) // 2
        # The rest of the track, split over the cores at silent moments.
        rest = total - self.cs
        step = max(5 * SAMPLE_RATE, rest // (self.workers * 2))
        while total - self.cs > step + self.QUIET:
            b = self._cut(self.cs, total, step)
            if b is None:
                break
            self.chunks.append(self.pool.submit(self._encode, self.cs, b))
            self.cs = b
        if self.cs < total or not self.chunks:
            self.chunks.append(self.pool.submit(self._encode, self.cs, None))
        with open(self.path, "wb") as f:
            for c in self.chunks:
                f.write(b"".join(c.result(timeout=timeout)))
        self.pool.shutdown(wait=False)
        return {"segments": self.segments, "segments_missing": self.missing, "speech_s": round(self.placed, 1), "chunks": len(self.chunks)}


def assemble(parts: list[dict], workdir: str, narration: Narration | None = None, track: AudioTrack | None = None, written: bool = False) -> dict:
    """Join rendered parts (in order) into the final MP4: video by stream copy, narration as AAC (encoded while the
    parts rendered when `track` is given), one stream-copy mux. `written`: the parts' videos are already at
    part{i:03d}.mp4 in workdir."""
    narration = narration or Narration(workdir)
    if track is None:
        track = AudioTrack(workdir, narration)
        for i, p in enumerate(parts):
            narration.want(s[0] for s in p["segments"])
            track.add(i, p["segments"], p["frames"])
    lst = os.path.join(workdir, "parts.txt")
    total = 0.0
    with open(lst, "w") as f:
        for i, p in enumerate(parts):
            path = os.path.join(workdir, f"part{i:03d}.mp4")
            if not written:
                with open(path, "wb") as v:
                    v.write(p["video"])
            f.write(f"file '{path}'\n")
            total += p["frames"] / FPS
    a = track.finish()
    out = os.path.join(workdir, "lesson.mp4")
    # Video parts joined by stream copy and the AAC track muxed in the same pass: nothing is re-encoded.
    _run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-i", track.path, "-map", "0:v:0", "-map", "1:a:0",
          "-c", "copy", "-movflags", "+faststart", "-t", f"{total:.3f}", out], timeout=900)
    size = os.path.getsize(out)
    if size > MAX_BYTES:
        # Over the storage limit after all: one re-encode at the bitrate that fits (540p when that is very low).
        vbps = int((MAX_BYTES * 8 * 0.92) / max(1.0, total) - AUDIO_KBPS * 1000)
        if vbps < 60_000:
            raise RuntimeError(f"the lesson is too long for one video file ({total / 60:.0f} min)")
        _log(f"{size / 1e6:.1f} MB is over the limit; re-encoding at {vbps // 1000} kb/s")
        small = os.path.join(workdir, "video-small.mp4")
        scale = ["-vf", "scale=960:540:flags=lanczos"] if vbps < 180_000 else []
        _run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, *scale, "-c:v", "libx264", "-preset", "veryfast", "-tune", "animation",
              "-b:v", str(vbps), "-maxrate", str(int(vbps * 1.5)), "-bufsize", str(vbps * 3), "-an", small], timeout=1800)
        _run(["ffmpeg", "-y", "-loglevel", "error", "-i", small, "-i", track.path, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-movflags", "+faststart",
              "-t", f"{total:.3f}", out], timeout=900)
        size = os.path.getsize(out)
        if size > 50 * 1024 * 1024:
            raise RuntimeError(f"the video is {size / 1e6:.0f} MB, over the 50 MB file limit")
    info = probe(out)
    return {"path": out, "bytes": size, "duration_ms": int(info["duration_s"] * 1000), "audio": a,
            "width": (info.get("video") or {}).get("width"), "height": (info.get("video") or {}).get("height"), "has_audio": bool(info.get("audio"))}


if __name__ == "__main__":
    url, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    part = render_part(url, max_frames=int(os.environ.get("MAX_FRAMES", str(FPS * 3600))), settle_s=2.0, channel=os.environ.get("CHROME_CHANNEL") or None,
                       stop_at_max=bool(os.environ.get("MAX_FRAMES")))
    res = assemble([part], outdir)
    print(json.dumps({**{k: v for k, v in part.items() if k not in ("video", "segments")}, "result": res}, indent=1, default=str))

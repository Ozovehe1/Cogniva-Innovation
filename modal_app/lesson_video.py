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
starts from the board exactly as it stands at that step) and the parts render in parallel containers. assemble()
joins the parts' H.264 by stream copy, lays every part's narration on one track and muxes the MP4.

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
SAMPLE_RATE = 44100
# Supabase Storage's per-file limit is 50 MB on this project; stay safely under it.
MAX_BYTES = 47 * 1024 * 1024
AUDIO_KBPS = 96
CLOCK_JS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lesson_video_clock.js")
FRAME_MS = 1000 / FPS


def _log(*a):
    print("[lesson-video]", *a, flush=True)


def x264_args(maxrate: int | None) -> list[str]:
    """One encoder setting for every part, so the parts join by stream copy."""
    rate = ["-crf", "26"] + (["-maxrate", str(maxrate), "-bufsize", str(maxrate * 2)] if maxrate else [])
    return ["-c:v", "libx264", "-preset", "veryfast", "-tune", "animation", *rate, "-pix_fmt", "yuv420p", "-r", str(FPS),
            "-x264-params", f"keyint={FPS * 10}:min-keyint={FPS}:scenecut=40"]


def max_video_rate(total_s: float) -> int:
    """A peak video bitrate that keeps the whole lesson under the storage file limit (CRF decides below it)."""
    budget = (MAX_BYTES * 8 * 0.9) / max(30.0, total_s) - AUDIO_KBPS * 1000
    return int(max(120_000, min(2_500_000, budget)))


class ClipCache:
    """Serves the lesson's Manim clips re-encoded with every frame a keyframe, so the virtual clock can seek them to
    the exact frame each time (seeking a normal H.264 file means decoding from the last keyframe, ~0.3 s a frame).
    The page's clip requests are redirected to a small local file server with byte ranges (sending ~20 MB bodies
    through the DevTools pipe on every range request is far too slow)."""

    def __init__(self, workdir: str):
        import http.server
        import threading

        self.dir = workdir
        os.makedirs(workdir, exist_ok=True)
        self.files: dict[str, asyncio.Future] = {}
        self.codec = os.environ.get("LV_CLIP_CODEC", "h264")  # vp8 for local tests in Chromium (no H.264)
        root = workdir

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):  # noqa: D401
                pass

            def _cors(self):
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Private-Network", "true")

            def do_OPTIONS(self):  # noqa: N802
                self.send_response(204)
                self._cors()
                self.send_header("Access-Control-Allow-Headers", "*")
                self.end_headers()

            def do_GET(self):  # noqa: N802
                path = os.path.join(root, os.path.basename(self.path.split("?")[0]))
                if not os.path.isfile(path):
                    self.send_response(404)
                    self._cors()
                    self.end_headers()
                    return
                size = os.path.getsize(path)
                start, end = 0, size - 1
                rng = self.headers.get("Range")
                if rng and rng.startswith("bytes="):
                    x, _, y = rng[6:].partition("-")
                    start = int(x or 0)
                    end = min(size - 1, int(y) if y else size - 1)
                    self.send_response(206)
                    self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                else:
                    self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "video/webm" if path.endswith(".webm") else "video/mp4")
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(end - start + 1))
                self.send_header("Cache-Control", "max-age=3600")
                self.end_headers()
                try:
                    with open(path, "rb") as f:
                        f.seek(start)
                        left = end - start + 1
                        while left > 0:
                            chunk = f.read(min(left, 1 << 20))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            left -= len(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        try:
            self.server.shutdown()
        except Exception:  # noqa: BLE001
            pass

    def _convert(self, url: str) -> str | None:
        import hashlib
        base = os.path.join(self.dir, hashlib.sha1(url.encode()).hexdigest()[:16])
        src = base + ".src.mp4"
        out = base + (".webm" if self.codec == "vp8" else ".mp4")
        if os.environ.get("LV_CLIP_DIR") and os.path.exists(out):
            return out
        try:
            _fetch(url, src)
            if self.codec == "vp8":
                enc = ["-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "4M", "-g", "1", "-auto-alt-ref", "0"]
            else:
                enc = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-g", "1", "-bf", "0", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
            _run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-an", *enc, out], timeout=300)
            return out
        except Exception as exc:  # noqa: BLE001
            _log(f"clip re-encode failed ({url[-60:]}): {exc}")
            return src if os.path.exists(src) else None

    async def get(self, url: str) -> str | None:
        key = url.split("?")[0]
        if key not in self.files:
            self.files[key] = asyncio.ensure_future(asyncio.get_running_loop().run_in_executor(None, self._convert, key))
        return await self.files[key]

    async def handle(self, route):
        try:
            path = await self.get(route.request.url)
            if not path:
                await route.continue_()
                return
            await route.fulfill(status=302, headers={"Location": f"http://127.0.0.1:{self.port}/{os.path.basename(path)}", "Access-Control-Allow-Origin": "*"})
        except Exception as exc:  # noqa: BLE001
            _log(f"clip route failed: {exc}")
            await route.continue_()


async def record(page_url: str, out_video: str, max_frames: int, settle_s: float = 0.0, on_progress=None, channel: str | None = None,
                 maxrate: int | None = None) -> dict:
    """Play the render page on a virtual clock (lesson_video_clock.js): step it one frame at a time, capture each frame
    that changed and pipe them to ffmpeg as constant-25-fps H.264. Returns timings, the narration log and page info."""
    from playwright.async_api import async_playwright

    console: list[str] = []
    timing: dict = {}
    t_launch = time.time()
    ff = None
    clips = ClipCache(os.environ.get("LV_CLIP_DIR") or tempfile.mkdtemp(prefix="lv-clips-"))
    frames = shots = 0
    async with async_playwright() as p:
        proxy = None
        if os.environ.get("LV_PROXY"):
            from urllib.parse import urlparse
            u = urlparse(os.environ["LV_PROXY"])
            proxy = {"server": f"{u.scheme}://{u.hostname}:{u.port}", "username": u.username or "", "password": u.password or ""}
        if os.environ.get("LV_DEBUG"):
            _log("launching")
        browser = await p.chromium.launch(
            channel=channel, proxy=proxy,
            args=["--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage", "--hide-scrollbars", "--force-color-profile=srgb",
                  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
                  # The clips come from a local file server (ClipCache); let the public page load them.
                  "--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks",
                  *[a for a in os.environ.get("LV_EXTRA_ARGS", "").split() if a]],
        )
        try:
            ctx = await browser.new_context(viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=1, reduced_motion="no-preference")
            await ctx.add_init_script(path=CLOCK_JS)
            await ctx.route(lambda url: "/manim-clips/" in url and ".mp4" in url, clips.handle)
            page = await ctx.new_page()
            if os.environ.get("LV_DEBUG"):
                _log("page open, loading", page_url[:80])
            page.on("console", lambda m: console.append(f"{m.type}: {m.text}"[:300]) if m.type in ("error", "warning") else None)
            page.on("pageerror", lambda e: console.append(f"pageerror: {e}"[:300]))
            t_open = time.time()
            timing["launch_s"] = round(t_open - t_launch, 2)
            resp = await page.goto(page_url, wait_until="load", timeout=120_000)
            if os.environ.get("LV_DEBUG"):
                _log(f"page loaded {time.time() - t_open:.1f}s", resp and resp.status, resp and await resp.all_headers(), resp and resp.url)
            if not resp or resp.status >= 400:
                raise RuntimeError(f"render page answered {resp.status if resp else 'nothing'}")
            # The page fetches its narration lines and clips before it says it is ready.
            if os.environ.get("LV_DEBUG"):
                page.on("requestfailed", lambda r: _log("request failed", r.url[:100], r.failure))
                page.on("response", lambda r: _log("response", r.status, r.url[:100]) if ("127.0.0.1" in r.url or "manim" in r.url) else None)
            await page.wait_for_function("window.__gmRender && window.__gmRender.ready", timeout=180_000, polling=100)
            info = await page.evaluate("({missing: __gmRender.missing, lines: __gmRender.lines, total: __gmRender.total})")
            timing["ready_s"] = round(time.time() - t_open, 2)
            if os.environ.get("LV_DEBUG"):
                _log("ready", timing, info)
            ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", str(FPS), "-i", "-",
                                   *x264_args(maxrate), "-an", "-movflags", "+faststart", out_video], stdin=subprocess.PIPE)
            cdp = await ctx.new_cdp_session(page)
            if os.environ.get("LV_DEBUG"):
                _log("cdp ok")
            t0 = await page.evaluate("__vclock.enable(), __gmRender.start()") / 1000.0
            if os.environ.get("LV_DEBUG"):
                _log("started", t0)
            t_cap = time.time()
            last = None
            settle_frames = int(round(settle_s * FPS))
            done_at = None
            first = True
            while True:
                ts = time.time()
                try:
                    st = await asyncio.wait_for(page.evaluate("__vclock.step(%s).then(r => ({d: r.dirty, c: __gmRender.cursor, t: __gmRender.total, e: __gmRender.done}))" % (0 if first else FRAME_MS)), float(os.environ.get('LV_STEP_TIMEOUT', 60)))
                except asyncio.TimeoutError:
                    if os.environ.get("LV_DEBUG"):
                        _log("step timed out; pausing the page")
                        fut = asyncio.get_running_loop().create_future()
                        cdp.on("Debugger.paused", lambda e: fut.done() or fut.set_result(e))
                        await cdp.send("Debugger.pause")
                        ev = await asyncio.wait_for(fut, 20)
                        for fr in ev["callFrames"][:25]:
                            _log("  at", fr["functionName"], fr["url"][-60:], fr["location"]["lineNumber"])
                    raise RuntimeError(f"the page stopped responding at frame {frames}: {await page.evaluate('__vclock.stats()')}")
                first = False
                if os.environ.get("LV_DEBUG") and (time.time() - ts > 0.5 or frames % 250 == 0):
                    _log(f"frame {frames} step {time.time() - ts:.2f}s cursor {st['c']}/{st['t']} wall {time.time() - t_cap:.1f}s", await page.evaluate("__vclock.stats()"))
                if st["d"] or last is None:
                    shot = await cdp.send("Page.captureScreenshot", {"format": "jpeg", "quality": 88, "optimizeForSpeed": True})
                    last = base64.b64decode(shot["data"])
                    shots += 1
                ff.stdin.write(last)
                frames += 1
                if st["e"] and done_at is None:
                    done_at = frames
                if done_at is not None and frames - done_at >= settle_frames:
                    break
                if frames >= max_frames:
                    if os.environ.get("LV_TEST"):
                        break
                    raise RuntimeError(f"the lesson did not finish within {max_frames // FPS} s of video (at step {st['c']} of {st['t']})")
                if on_progress and frames % 125 == 0:
                    on_progress(st["c"], st["t"], frames)
            timing["capture_s"] = round(time.time() - t_cap, 2)
            audio_log = await page.evaluate("window.__gmAudioLog || []")
            errors = await page.evaluate("(window.__gmRender.errors || []).concat(window.__vclock.errors || [])")
        finally:
            await browser.close()
            clips.close()
            if ff and ff.poll() is None and sys.exc_info()[0] is not None:
                ff.kill()
    ff.stdin.close()
    if ff.wait(timeout=600) != 0:
        raise RuntimeError("ffmpeg could not encode the frames")
    timing["encode_tail_s"] = round(time.time() - t_cap - timing.get("capture_s", 0), 2)
    dur = frames / FPS
    return {"t0": t0, "t_end": t0 + dur, "frames": frames, "shots": shots, "duration_s": dur, "audio_log": audio_log, "info": info,
            "errors": (errors or [])[:20], "console": console[-30:], "timing": timing}


def _run(cmd: list[str], timeout: float = 3600):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"{os.path.basename(cmd[0])} failed: {(r.stderr or r.stdout)[-1500:]}")
    return r


def _fetch(url: str, dest: str):
    req = urllib.request.Request(url, headers={"User-Agent": "geniusmap-lesson-video"})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


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

    def __init__(self, workdir: str):
        self.dir = os.path.join(workdir, "audio")
        os.makedirs(self.dir, exist_ok=True)
        self.pool = ThreadPoolExecutor(max_workers=8)
        self.jobs: dict[str, object] = {}

    def want(self, srcs):
        for src in srcs:
            if src not in self.jobs:
                self.jobs[src] = self.pool.submit(self._load, src, os.path.join(self.dir, f"{len(self.jobs)}.mp3"))

    @staticmethod
    def _load(src: str, dest: str) -> bytes | None:
        for attempt in range(3):
            try:
                _fetch(src, dest)
                return _decode(dest)
            except Exception as exc:  # noqa: BLE001
                if attempt == 2:
                    _log(f"narration file failed ({src[-60:]}): {exc}")
        return None

    def pcm(self, src: str) -> bytes | None:
        job = self.jobs.get(src)
        return job.result() if job else None  # type: ignore[attr-defined]


def write_track(segs: list[tuple[str, float, float, float]], total_s: float, narration: Narration, out: str) -> dict:
    """One mono WAV with every narration segment at its place on the lesson timeline."""
    n = max(1, int(round(total_s * SAMPLE_RATE)))
    buf = bytearray(n * 2)
    placed = 0.0
    missing = 0
    for src, pos, ts, te in segs:
        data = narration.pcm(src)
        if not data:
            missing += 1
            continue
        a = int(pos * SAMPLE_RATE) * 2
        chunk = data[a:a + max(0, int(round((te - ts) * SAMPLE_RATE))) * 2]
        off = int(round(ts * SAMPLE_RATE)) * 2
        if off < 0:
            chunk, off = chunk[-off:], 0
        chunk = chunk[: max(0, len(buf) - off)]
        if chunk:
            buf[off:off + len(chunk)] = chunk
            placed += len(chunk) / 2 / SAMPLE_RATE
    with open(out, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 36 + len(buf)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, SAMPLE_RATE, SAMPLE_RATE * 2, 2, 16) + b"data" + struct.pack("<I", len(buf)))
        f.write(buf)
    return {"segments": len(segs), "segments_missing": missing, "speech_s": round(placed, 1)}


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


def render_part(page_url: str, max_frames: int, settle_s: float = 0.0, maxrate: int | None = None, channel: str | None = None, on_progress=None) -> dict:
    """Render one part (the render page with its from/to). Returns the H.264 bytes and its narration segments."""
    workdir = tempfile.mkdtemp(prefix="lesson-part-")
    out = os.path.join(workdir, "part.mp4")
    t = time.time()
    rec = asyncio.run(record(page_url, out, max_frames, settle_s=settle_s, on_progress=on_progress, channel=channel, maxrate=maxrate))
    segs = narration_segments(rec["audio_log"], rec["t0"] * 1000.0, rec["duration_s"])
    with open(out, "rb") as f:
        data = f.read()
    shutil.rmtree(workdir, ignore_errors=True)
    return {
        "video": data, "frames": rec["frames"], "shots": rec["shots"], "duration_s": rec["duration_s"], "segments": segs, "info": rec["info"],
        "errors": rec["errors"][:5], "console": rec["console"][-5:], "timing": {**rec["timing"], "total_s": round(time.time() - t, 2)},
    }


def assemble(parts: list[dict], workdir: str, narration: Narration | None = None) -> dict:
    """Join rendered parts (in order) into the final MP4: video by stream copy, one narration track, mux."""
    narration = narration or Narration(workdir)
    lst = os.path.join(workdir, "parts.txt")
    segs: list[tuple[str, float, float, float]] = []
    offset = 0.0
    with open(lst, "w") as f:
        for i, p in enumerate(parts):
            path = os.path.join(workdir, f"part{i:03d}.mp4")
            with open(path, "wb") as v:
                v.write(p["video"])
            f.write(f"file '{path}'\n")
            narration.want(s[0] for s in p["segments"])
            segs += [(src, pos, a + offset, b + offset) for src, pos, a, b in p["segments"]]
            offset += p["frames"] / FPS
    total = offset
    video = os.path.join(workdir, "video.mp4")
    _run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", video], timeout=600)
    audio = os.path.join(workdir, "narration.wav")
    a = write_track(segs, total, narration, audio)
    out = os.path.join(workdir, "lesson.mp4")
    mux = lambda src: _run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac",  # noqa: E731
                            "-b:a", f"{AUDIO_KBPS}k", "-ac", "1", "-movflags", "+faststart", "-t", f"{total:.3f}", out], timeout=900)
    mux(video)
    size = os.path.getsize(out)
    if size > MAX_BYTES:
        # Over the storage limit after all: one re-encode at the bitrate that fits (540p when that is very low).
        vbps = int((MAX_BYTES * 8 * 0.92) / max(1.0, total) - AUDIO_KBPS * 1000)
        if vbps < 60_000:
            raise RuntimeError(f"the lesson is too long for one video file ({total / 60:.0f} min)")
        _log(f"{size / 1e6:.1f} MB is over the limit; re-encoding at {vbps // 1000} kb/s")
        small = os.path.join(workdir, "video-small.mp4")
        scale = ["-vf", "scale=960:540:flags=lanczos"] if vbps < 180_000 else []
        _run(["ffmpeg", "-y", "-loglevel", "error", "-i", video, *scale, "-c:v", "libx264", "-preset", "veryfast", "-tune", "animation", "-b:v", str(vbps),
              "-maxrate", str(int(vbps * 1.5)), "-bufsize", str(vbps * 3), "-an", small], timeout=1800)
        mux(small)
        size = os.path.getsize(out)
        if size > 50 * 1024 * 1024:
            raise RuntimeError(f"the video is {size / 1e6:.0f} MB, over the 50 MB file limit")
    info = probe(out)
    return {"path": out, "bytes": size, "duration_ms": int(info["duration_s"] * 1000), "audio": a,
            "width": (info.get("video") or {}).get("width"), "height": (info.get("video") or {}).get("height"), "has_audio": bool(info.get("audio"))}


if __name__ == "__main__":
    url, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    part = render_part(url, max_frames=int(os.environ.get("MAX_FRAMES", str(FPS * 3600))), settle_s=2.0, channel=os.environ.get("CHROME_CHANNEL") or None)
    res = assemble([part], outdir)
    print(json.dumps({**{k: v for k, v in part.items() if k not in ("video", "segments")}, "result": res}, indent=1, default=str))

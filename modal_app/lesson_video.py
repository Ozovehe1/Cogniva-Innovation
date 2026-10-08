"""
Lesson video recorder (used by the Modal function `lesson_video` in manim_render.py).

Opens the token-protected render page /render/lesson/<id> (see src/app/render/lesson) in headless Chrome at
1280x720. That page plays the whole lesson by itself, exactly as the player does: boards drawn by the hand, Manim
clips, KaTeX maths, checks shown on the board and answered after a pause. While it plays we:

  * capture the screen with the DevTools screencast (every painted frame, with its wall-clock timestamp), and
  * read the page's narration log (window.__gmAudioLog: every time the narration audio really started or stopped,
    which file, at which position, on the wall clock).

Afterwards the frames become a constant-25-fps H.264 stream on their real timeline, the narration track is rebuilt
sample-exactly from the cached MP3s at the times they actually played, and ffmpeg muxes the two. Both clocks are the
same machine's wall clock, so sound and picture line up without any guessing.

Run locally:  python lesson_video.py "<render page url>" /tmp/out
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
# No step change for this long means the page is stuck (a clip that never ends, a crash).
STUCK_S = 300


def _log(*a):
    print("[lesson-video]", *a, flush=True)


async def record(page_url: str, workdir: str, max_s: float, on_progress=None, channel: str | None = None) -> dict:
    """Play the lesson in headless Chrome and capture frames + the narration log. Returns timings and paths."""
    from playwright.async_api import async_playwright

    frames_dir = os.path.join(workdir, "frames")
    os.makedirs(frames_dir, exist_ok=True)
    frames: list[tuple[float, str]] = []
    console: list[str] = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            channel=channel,
            args=["--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage", "--hide-scrollbars", "--force-color-profile=srgb",
                  *[a for a in os.environ.get("LV_EXTRA_ARGS", "").split() if a]],
        )
        try:
            ctx = await browser.new_context(viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=1, reduced_motion="no-preference")
            page = await ctx.new_page()
            if os.environ.get("LV_USE_PROXY"):
                # Local testing only: the sandbox's egress needs an authenticating proxy Chrome can't use; fetch
                # storage files from Python instead.
                async def via_python(route):
                    def get():
                        req = urllib.request.Request(route.request.url, headers={"User-Agent": "geniusmap-lesson-video"})
                        with urllib.request.urlopen(req, timeout=60) as r:
                            return r.status, r.headers.get("Content-Type", "application/octet-stream"), r.read()
                    try:
                        status, ctype, body = await asyncio.get_running_loop().run_in_executor(None, get)
                        await route.fulfill(status=status, body=body, headers={"Content-Type": ctype, "Access-Control-Allow-Origin": "*", "Accept-Ranges": "none"})
                    except Exception:  # noqa: BLE001
                        await route.fulfill(status=404, body=b"", headers={"Access-Control-Allow-Origin": "*"})
                await page.route("https://*.supabase.co/**", via_python)
            page.on("console", lambda m: console.append(f"{m.type}: {m.text}"[:300]) if m.type in ("error", "warning") else None)
            page.on("pageerror", lambda e: console.append(f"pageerror: {e}"[:300]))
            t_open = time.time()
            resp = await page.goto(page_url, wait_until="load", timeout=120_000)
            if not resp or resp.status >= 400:
                raise RuntimeError(f"render page answered {resp.status if resp else 'nothing'}")
            # The page fetches every narration line and clip before it says it is ready.
            await page.wait_for_function("window.__gmRender && window.__gmRender.ready", timeout=420_000, polling=500)
            info = await page.evaluate("({missing: __gmRender.missing, lines: __gmRender.lines, total: __gmRender.total})")
            _log(f"page ready in {time.time() - t_open:.1f}s: {info}")

            cdp = await ctx.new_cdp_session(page)
            count = 0
            skew: list[float] = []

            async def on_frame(params):
                nonlocal count
                arrived = time.time()
                ts = float(params.get("metadata", {}).get("timestamp") or arrived)
                skew.append(arrived - ts)
                path = os.path.join(frames_dir, f"{count:07d}.jpg")
                count += 1
                with open(path, "wb") as f:
                    f.write(base64.b64decode(params["data"]))
                frames.append((ts, path))
                try:
                    await cdp.send("Page.screencastFrameAck", {"sessionId": params["sessionId"]})
                except Exception:  # noqa: BLE001
                    pass

            cdp.on("Page.screencastFrame", lambda prm: asyncio.ensure_future(on_frame(prm)))
            await cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 90, "maxWidth": WIDTH, "maxHeight": HEIGHT, "everyNthFrame": 1})
            await asyncio.sleep(0.6)
            t0 = (await page.evaluate("window.__gmRender.start()")) / 1000.0
            last_cursor, last_change, last_report = -1, time.time(), 0.0
            while True:
                await asyncio.sleep(1.0)
                st = await page.evaluate("({c: __gmRender.cursor, t: __gmRender.total, d: __gmRender.done})")
                now = time.time()
                if st["c"] != last_cursor:
                    last_cursor, last_change = st["c"], now
                if st["d"]:
                    break
                if now - t0 > max_s:
                    raise RuntimeError(f"the lesson did not finish within {int(max_s)} s (at step {st['c']} of {st['t']})")
                if now - last_change > STUCK_S:
                    raise RuntimeError(f"playback stopped at step {st['c']} of {st['t']}")
                if on_progress and now - last_report > 20:
                    last_report = now
                    on_progress(min(0.99, st["c"] / max(1, st["t"])))
            await asyncio.sleep(2.0)  # let the last stroke and word settle
            t_end = (await page.evaluate("Date.now()")) / 1000.0
            await cdp.send("Page.stopScreencast")
            await asyncio.sleep(0.3)
            audio_log = await page.evaluate("window.__gmAudioLog || []")
            errors = await page.evaluate("window.__gmRender.errors || []")
        finally:
            await browser.close()
    # Screencast timestamps are the compositor's wall clock; if they ever disagree with ours, use arrival times.
    med = sorted(skew)[len(skew) // 2] if skew else 0.0
    if abs(med) > 0.5:
        _log(f"frame timestamps off by {med:.2f}s; shifting")
        frames = [(ts + med, p) for ts, p in frames]
    return {"t0": t0, "t_end": t_end, "frames": frames, "audio_log": audio_log, "info": info, "errors": (errors or [])[:20], "console": console[-30:]}


def _run(cmd: list[str], timeout: float = 3600):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"{os.path.basename(cmd[0])} failed: {(r.stderr or r.stdout)[-1500:]}")
    return r


def build_video(frames: list[tuple[float, str]], t0: float, t_end: float, workdir: str, out: str, crf: int = 25, bitrate: int | None = None, scale: tuple[int, int] | None = None):
    """Frames on their real timeline (from t0 to t_end) -> constant-fps H.264."""
    if not frames:
        raise RuntimeError("no frames were captured")
    frames = sorted(frames)
    before = [f for f in frames if f[0] <= t0]
    seq = [(t0, (before[-1] if before else frames[0])[1])] + [f for f in frames if t0 < f[0] < t_end]
    lst = os.path.join(workdir, "frames.ffconcat")
    with open(lst, "w") as f:
        f.write("ffconcat version 1.0\n")
        for i, (ts, p) in enumerate(seq):
            nxt = seq[i + 1][0] if i + 1 < len(seq) else t_end
            f.write(f"file '{p}'\nduration {max(0.001, nxt - ts):.4f}\n")
        f.write(f"file '{seq[-1][1]}'\n")
    vf = f"fps={FPS}" + (f",scale={scale[0]}:{scale[1]}:flags=lanczos" if scale else "") + ",format=yuv420p"
    rate = ["-b:v", str(bitrate), "-maxrate", str(int(bitrate * 1.6)), "-bufsize", str(bitrate * 3)] if bitrate else ["-crf", str(crf)]
    _run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-tune", "animation",
          *rate, "-g", str(FPS * 10), "-an", out])
    return len(seq)


def _fetch(url: str, dest: str):
    req = urllib.request.Request(url, headers={"User-Agent": "geniusmap-lesson-video"})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


def _decode(path: str) -> bytes:
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-"], capture_output=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode()[-300:])
    return r.stdout


def build_audio(audio_log: list[dict], t0: float, t_end: float, workdir: str, out: str) -> dict:
    """The narration as it was heard: each play runs until the next audio event (one audio element plays at a time)."""
    events = sorted([e for e in audio_log if isinstance(e, dict) and e.get("src") and isinstance(e.get("t"), (int, float))], key=lambda e: e["t"])
    segs = []
    for i, e in enumerate(events):
        if e.get("ev") != "play":
            continue
        end = events[i + 1]["t"] / 1000.0 if i + 1 < len(events) else t_end
        segs.append((e["src"], float(e.get("pos") or 0.0), e["t"] / 1000.0, end))
    srcs = sorted({s[0] for s in segs})
    adir = os.path.join(workdir, "audio")
    os.makedirs(adir, exist_ok=True)
    pcm: dict[str, bytes] = {}

    def load(i_src):
        i, src = i_src
        dest = os.path.join(adir, f"{i}.mp3")
        try:
            _fetch(src, dest)
            pcm[src] = _decode(dest)
        except Exception as exc:  # noqa: BLE001
            _log(f"narration file failed ({src[-60:]}): {exc}")

    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(load, enumerate(srcs)))
    n = max(1, int((t_end - t0) * SAMPLE_RATE))
    buf = bytearray(n * 2)
    placed = 0.0
    for src, pos, ts, te in segs:
        data = pcm.get(src)
        if not data:
            continue
        a = int(pos * SAMPLE_RATE) * 2
        chunk = data[a:a + max(0, int((te - ts) * SAMPLE_RATE)) * 2]
        off = int((ts - t0) * SAMPLE_RATE) * 2
        if off < 0:
            chunk, off = chunk[-off:], 0
        chunk = chunk[: max(0, len(buf) - off)]
        if chunk:
            buf[off:off + len(chunk)] = chunk
            placed += len(chunk) / 2 / SAMPLE_RATE
    with open(out, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 36 + len(buf)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, SAMPLE_RATE, SAMPLE_RATE * 2, 2, 16) + b"data" + struct.pack("<I", len(buf)))
        f.write(buf)
    return {"segments": len(segs), "files": len(srcs), "files_ok": len(pcm), "speech_s": round(placed, 1)}


def mux(video: str, audio: str, out: str):
    _run(["ffmpeg", "-y", "-loglevel", "error", "-i", video, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", f"{AUDIO_KBPS}k", "-ac", "1",
          "-movflags", "+faststart", "-shortest", out])


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


def render_lesson_video(page_url: str, max_s: float, on_progress=None, channel: str | None = None, workdir: str | None = None) -> dict:
    """Record + encode. Returns {"path", "bytes", "duration_ms", "meta"}; raises with a readable message on failure."""
    workdir = workdir or tempfile.mkdtemp(prefix="lesson-video-")
    t_start = time.time()
    rec = asyncio.run(record(page_url, workdir, max_s, on_progress, channel))
    t_rec = time.time()
    dur = rec["t_end"] - rec["t0"]
    _log(f"recorded {dur:.1f}s, {len(rec['frames'])} frames, {len(rec['audio_log'])} audio events")
    video = os.path.join(workdir, "video.mp4")
    audio = os.path.join(workdir, "narration.wav")
    out = os.path.join(workdir, "lesson.mp4")
    used = build_video(rec["frames"], rec["t0"], rec["t_end"], workdir, video)
    a = build_audio(rec["audio_log"], rec["t0"], rec["t_end"], workdir, audio)
    mux(video, audio, out)
    size = os.path.getsize(out)
    if size > MAX_BYTES:
        # Too big for storage: re-encode at the bitrate that fits (and at 540p when that bitrate is very low).
        vbps = int((MAX_BYTES * 8 * 0.93) / max(1.0, dur) - AUDIO_KBPS * 1000)
        if vbps < 60_000:
            raise RuntimeError(f"the lesson is too long for one video file ({dur / 60:.0f} min)")
        _log(f"{size / 1e6:.1f} MB is over the limit; re-encoding at {vbps // 1000} kb/s")
        build_video(rec["frames"], rec["t0"], rec["t_end"], workdir, video, bitrate=vbps, scale=(960, 540) if vbps < 180_000 else None)
        mux(video, audio, out)
        size = os.path.getsize(out)
        if size > 50 * 1024 * 1024:
            raise RuntimeError(f"the video is {size / 1e6:.0f} MB, over the 50 MB file limit")
    info = probe(out)
    shutil.rmtree(os.path.join(workdir, "frames"), ignore_errors=True)
    meta = {
        "frames": used, "fps_captured": round(len(rec["frames"]) / max(1.0, dur), 1), "audio": a, "page": rec["info"],
        "record_s": round(t_rec - t_start, 1), "encode_s": round(time.time() - t_rec, 1), "errors": rec["errors"][:5], "console": rec["console"][-8:],
        "width": (info.get("video") or {}).get("width"), "height": (info.get("video") or {}).get("height"), "has_audio": bool(info.get("audio")),
    }
    return {"path": out, "bytes": size, "duration_ms": int(info["duration_s"] * 1000), "meta": meta}


if __name__ == "__main__":
    url, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    res = render_lesson_video(url, max_s=float(os.environ.get("MAX_S", "3600")), on_progress=lambda p: _log(f"progress {p:.0%}"), channel=os.environ.get("CHROME_CHANNEL") or None, workdir=outdir)
    print(json.dumps({k: v for k, v in res.items()}, indent=1, default=str))

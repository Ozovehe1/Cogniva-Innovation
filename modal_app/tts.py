"""
GeniusMap narration voice (Modal app "geniusmap-tts").

Kokoro-82M (Apache-2.0, https://huggingface.co/hexgrad/Kokoro-82M) on CPU.

POST /synth   (header X-Render-Token must equal the RENDER_TOKEN secret)
  body: {"texts": [str, ...] (1..12, each <= 1200 chars), "voice": "af_heart", "speed": 1.0}
  -> {"clips": [{"audio": base64 mp3 (mono 24 kHz, 48 kbps), "ms": int,
                 "words": [{"w": str, "s": ms, "e": ms}, ...]}, ...], "voice": str, "synth_ms": int}
  `words` has exactly one entry per whitespace-separated word of the input text, in order,
  with the time it is spoken (from Kokoro's per-token durations; words Kokoro skipped are
  interpolated from their neighbours).
GET /health -> {"ok": true, "voice": ..., "loaded": bool}

Secrets (Modal secret "geniusmap-render", shared with the Manim app): RENDER_TOKEN.
Deployed from the Vercel production build (scripts/deploy-modal.mjs).
Cost: CPU only (2 cores + 2 GiB ~ $0.11 per container-hour on Modal list prices). The container
stays up 5 min after the last request (scaledown_window) and the site wakes it when a lesson page
opens (/api/tts/warm). Memory snapshots make cold starts restore the loaded model instead of
re-importing torch and Kokoro.
"""

import base64
import hmac
import os
import re
import subprocess
import threading
import time

import modal

APP_NAME = "geniusmap-tts"
SECRET_NAME = "geniusmap-render"
DEFAULT_VOICE = "af_heart"
VOICES = ["af_heart", "af_bella", "am_michael", "am_fenrir", "bf_emma", "bm_george"]
SAMPLE_RATE = 24000

app = modal.App(APP_NAME)


def _download_weights():
    # Bake the model, the voices and the spaCy model into the image so cold starts never download.
    from kokoro import KPipeline

    for lang in ("a", "b"):
        p = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
        for v in VOICES:
            if v[0] == lang:
                p.load_voice(v)
        list(p("Warm up.", voice=[v for v in VOICES if v[0] == lang][0]))


image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("espeak-ng", "ffmpeg")
    .pip_install("torch==2.14.1", index_url="https://download.pytorch.org/whl/cpu")
    .pip_install("kokoro==0.9.4", "soundfile", "numpy", "fastapi[standard]==0.115.6")
    .run_commands("python -m spacy download en_core_web_sm")
    .env({"HF_HUB_DISABLE_TELEMETRY": "1", "TOKENIZERS_PARALLELISM": "false"})
    .run_function(_download_weights)
)

secret = modal.Secret.from_name(SECRET_NAME)


def _word_spans(text: str):
    return [(m.start(), m.end()) for m in re.finditer(r"\S+", text)]


def align_words(text: str, tokens: list[tuple[str, float, float]], total_ms: int):
    """Map Kokoro tokens (text, start_s, end_s; already offset per chunk) onto the input's words."""
    spans = _word_spans(text)
    starts: list[float | None] = [None] * len(spans)
    ends: list[float | None] = [None] * len(spans)
    cursor = 0
    wi = 0
    for tok, s, e in tokens:
        if not tok or s is None or e is None:
            continue
        idx = text.find(tok, cursor)
        if idx < 0:
            # misaki may normalise a token (quotes, dashes); try case-insensitive, then skip.
            low = text.lower().find(tok.lower(), cursor)
            if low < 0:
                continue
            idx = low
        cursor = idx + len(tok)
        while wi < len(spans) and spans[wi][1] <= idx:
            wi += 1
        if wi >= len(spans):
            break
        if starts[wi] is None or s < starts[wi]:
            starts[wi] = s
        if ends[wi] is None or e > ends[wi]:
            ends[wi] = e
    out = []
    n = len(spans)
    # Interpolate words without a token from their neighbours.
    for i in range(n):
        if starts[i] is None:
            prev_e = next((ends[j] for j in range(i - 1, -1, -1) if ends[j] is not None), 0.0)
            nxt = next(((j, starts[j]) for j in range(i + 1, n) if starts[j] is not None), None)
            nxt_s = nxt[1] if nxt else total_ms / 1000
            gap = (nxt[0] - i + 1) if nxt else (n - i + 1)
            starts[i] = prev_e
            ends[i] = prev_e + max(0.05, (nxt_s - prev_e) / max(1, gap))
    for i, (a, b) in enumerate(spans):
        s = int(round((starts[i] or 0) * 1000))
        e = int(round((ends[i] or 0) * 1000))
        out.append({"w": text[a:b], "s": s, "e": max(s + 30, e)})
    return out


def to_mp3(audio) -> bytes:
    import numpy as np

    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "1", "-i", "pipe:0",
         "-codec:a", "libmp3lame", "-b:a", "48k", "-f", "mp3", "pipe:1"],
        input=pcm,
        capture_output=True,
        check=True,
    )
    return proc.stdout


@app.cls(
    image=image,
    secrets=[secret],
    cpu=2.0,
    memory=2048,
    scaledown_window=300,
    max_containers=3,
    timeout=300,
    enable_memory_snapshot=True,
)
@modal.concurrent(max_inputs=4)
class TTS:
    @modal.enter(snap=True)
    def load(self):
        # Runs once when the snapshot is taken; later cold starts restore this state.
        from kokoro import KPipeline

        t = time.time()
        self.pipes = {"a": KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")}
        try:
            self.pipes["b"] = KPipeline(lang_code="b", repo_id="hexgrad/Kokoro-82M", model=self.pipes["a"].model)
        except Exception as exc:  # noqa: BLE001
            print("British pipeline unavailable:", exc)
        list(self.pipes["a"]("Ready.", voice=DEFAULT_VOICE))
        print(f"Kokoro loaded in {time.time() - t:.1f}s")

    @modal.enter(snap=False)
    def after_restore(self):
        import torch

        torch.set_num_threads(max(1, os.cpu_count() or 2))
        self.lock = threading.Lock()

    def synth_one(self, text: str, voice: str, speed: float):
        import numpy as np

        pipe = self.pipes.get(voice[0]) or self.pipes["a"]
        chunks = []
        tokens: list[tuple[str, float, float]] = []
        offset = 0.0
        with self.lock:
            for r in pipe(text, voice=voice, speed=speed, split_pattern=r"\n+"):
                audio = r.audio
                if audio is None:
                    continue
                a = audio.numpy() if hasattr(audio, "numpy") else np.asarray(audio)
                for tk in (r.tokens or []):
                    if tk.start_ts is not None and tk.end_ts is not None:
                        tokens.append((tk.text, offset + tk.start_ts, offset + tk.end_ts))
                chunks.append(a)
                offset += len(a) / SAMPLE_RATE
        if not chunks:
            raise ValueError("no audio produced")
        audio = np.concatenate(chunks)
        ms = int(round(len(audio) / SAMPLE_RATE * 1000))
        return {"audio": base64.b64encode(to_mp3(audio)).decode(), "ms": ms, "words": align_words(text, tokens, ms)}

    @modal.asgi_app(label="geniusmap-tts")
    def web(self):
        from fastapi import FastAPI, Header, HTTPException
        from pydantic import BaseModel, Field

        api = FastAPI(title="GeniusMap TTS", docs_url=None, redoc_url=None, openapi_url=None)

        class SynthRequest(BaseModel):
            texts: list[str] = Field(min_length=1, max_length=12)
            voice: str = DEFAULT_VOICE
            speed: float = Field(default=1.0, ge=0.7, le=1.3)

        @api.get("/health")
        def health():
            return {"ok": True, "voice": DEFAULT_VOICE, "loaded": bool(getattr(self, "pipes", None))}

        @api.post("/synth")
        def synth(req: SynthRequest, x_render_token: str | None = Header(default=None)):
            expected = os.environ.get("RENDER_TOKEN", "")
            if not expected or not x_render_token or not hmac.compare_digest(x_render_token, expected):
                raise HTTPException(status_code=401, detail="unauthorized")
            voice = req.voice if req.voice in VOICES else DEFAULT_VOICE
            texts = [t.strip()[:1200] for t in req.texts]
            if any(not t for t in texts):
                raise HTTPException(status_code=400, detail="empty text")
            t0 = time.time()
            clips = []
            for t in texts:
                try:
                    clips.append(self.synth_one(t, voice, req.speed))
                except Exception as exc:  # noqa: BLE001
                    print("synth failed:", exc)
                    clips.append({"error": str(exc)[:300]})
            return {"clips": clips, "voice": voice, "synth_ms": int((time.time() - t0) * 1000)}

        return api

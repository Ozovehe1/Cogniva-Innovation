"""Gemini (free tier) client for the visual composer: flash-lite first, falls through the chain on 429/5xx.

With GEMINI_API_KEY (Modal secret) it calls Google directly. Without it, and with GM_GEMINI_PROXY + RENDER_TOKEN set
(offline evaluation outside Modal), it goes through the render service's token-protected /gemini endpoint, so the key
never leaves Modal.
"""
from __future__ import annotations

import base64
import json
import os
import re
import time

MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-2.5-flash"]
_skip: dict[str, float] = {}


def gemini(prompt: str, *, json_out=True, images: list[bytes] | None = None, temperature=0.4, timeout=60, log=None) -> str:
    import httpx

    key = os.environ.get("GEMINI_API_KEY", "")
    if not key and os.environ.get("GM_GEMINI_PROXY"):
        for attempt in range(5):
            r = httpx.post(os.environ["GM_GEMINI_PROXY"].rstrip("/") + "/gemini", headers={"X-Render-Token": os.environ.get("RENDER_TOKEN", "")},
                           json={"prompt": prompt, "json_out": json_out, "temperature": temperature, "images": [base64.b64encode(i).decode() for i in images or []]}, timeout=timeout * 3 + 60)
            if r.status_code == 503 and "429" in r.text and attempt < 4:
                time.sleep(30 + 15 * attempt)  # the shared free-tier minute window
                continue
            break
        if r.status_code != 200:
            raise RuntimeError(f"Gemini proxy {r.status_code}: {r.text[:200]}")
        j = r.json()
        if log is not None:
            log.extend(j.get("log", []))
        return j["text"]
    if not key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    parts = [{"text": prompt}]
    for img in images or []:
        parts.append({"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(img).decode()}})
    last = None
    wait_hint = 0.0
    for attempt in range(3):
        for model in MODELS:
            cfg = {"temperature": temperature}
            if json_out:
                cfg["responseMimeType"] = "application/json"
            if model.startswith("gemini-3"):
                cfg["thinkingConfig"] = {"thinkingLevel": "low"}
            if time.time() < _skip.get(model, 0):
                continue
            try:
                r = httpx.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                    params={"key": key}, json={"contents": [{"role": "user", "parts": parts}], "generationConfig": cfg}, timeout=timeout,
                )
            except Exception as exc:  # noqa: BLE001
                last = f"{model}: {exc}"
                continue
            if r.status_code == 200:
                j = r.json()
                try:
                    text = "".join(p.get("text", "") for p in j["candidates"][0]["content"]["parts"] if not p.get("thought"))
                except Exception:  # noqa: BLE001
                    last = f"{model}: empty answer"
                    continue
                if log is not None:
                    log.append(f"gemini {model} ok")
                return text
            last = f"{model}: {r.status_code} {r.text[:160]}"
            if log is not None:
                log.append(f"gemini {model}: {r.status_code}")
            if r.status_code == 429:
                daily = "PerDay" in r.text or "per day" in r.text.lower()
                m = re.search(r'"retryDelay":\s*"(\d+(?:\.\d+)?)s"', r.text)
                delay = float(m.group(1)) if m else 20.0
                # a daily quota is gone for hours; a per-minute one frees up within the hint
                _skip[model] = time.time() + (600 if daily else delay)
                if not daily:
                    wait_hint = max(wait_hint, min(delay, 45.0))
        soon = [t for t in (_skip.get(m, 0) for m in MODELS) if t - time.time() < 60]
        time.sleep(max(3.0, min(45.0, wait_hint or 5.0)) if soon or attempt == 0 else 3.0)
        wait_hint = 0.0
    raise RuntimeError(f"Gemini unavailable: {last}")


def parse_json(text: str):
    """Strict JSON first; then the usual model slips: fences, // comments, trailing commas, text around the object."""
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        pass
    m = re.search(r"[\[{].*[\]}]", t, re.S)
    if m:
        t = m.group(0)
    t2 = _strip_comments(t)
    t2 = re.sub(r",\s*([\]}])", r"\1", t2)
    return json.loads(t2)


def _strip_comments(t: str) -> str:
    out, i, n, ins = [], 0, len(t), False
    while i < n:
        c = t[i]
        if ins:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(t[i + 1])
                i += 2
                continue
            if c == '"':
                ins = False
        elif c == '"':
            ins = True
            out.append(c)
        elif t.startswith("//", i):
            while i < n and t[i] != "\n":
                i += 1
            continue
        else:
            out.append(c)
        i += 1
    return "".join(out)


def ask_json(prompt: str, **kw):
    """gemini() + parse_json(), with one re-ask quoting the parse error when the JSON is broken."""
    raw = gemini(prompt, **kw)
    try:
        return parse_json(raw)
    except json.JSONDecodeError as exc:
        lo = max(0, exc.pos - 120)
        again = gemini(prompt + f"\n\nYour previous answer was not valid JSON ({exc.msg} at char {exc.pos}, near: {raw[lo:exc.pos + 40]!r}). Return the complete answer again as strictly valid JSON only.", **kw)
        return parse_json(again)

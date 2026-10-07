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

MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-2.5-flash"]


def gemini(prompt: str, *, json_out=True, images: list[bytes] | None = None, temperature=0.4, timeout=60, log=None) -> str:
    import httpx

    key = os.environ.get("GEMINI_API_KEY", "")
    if not key and os.environ.get("GM_GEMINI_PROXY"):
        r = httpx.post(os.environ["GM_GEMINI_PROXY"].rstrip("/") + "/gemini", headers={"X-Render-Token": os.environ.get("RENDER_TOKEN", "")},
                       json={"prompt": prompt, "json_out": json_out, "temperature": temperature, "images": [base64.b64encode(i).decode() for i in images or []]}, timeout=timeout * 3 + 30)
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
    for attempt in range(2):
        for model in MODELS:
            cfg = {"temperature": temperature}
            if json_out:
                cfg["responseMimeType"] = "application/json"
            if model.startswith("gemini-3"):
                cfg["thinkingConfig"] = {"thinkingLevel": "low"}
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
                log.append(f"gemini {last[:120]}")
            if r.status_code not in (429, 500, 503, 504, 404, 400):
                break
        time.sleep(4 + attempt * 6)
    raise RuntimeError(f"Gemini unavailable: {last}")


def parse_json(text: str):
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", t, re.S)
        if m:
            return json.loads(m.group(0))
        raise

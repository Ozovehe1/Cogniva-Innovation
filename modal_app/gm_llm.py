"""Gemini (free tier) client for the visual composer: strongest models first (composing calls wait out per-minute limits on
them), flash-lite as the backup; falls through the chain on 429/5xx.

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
_why: dict[str, str] = {}
LAST_MODEL: dict = {}  # the model that served the latest call (stage logs)  # last refusal per model (status + quota id), for the error message


STRONG = ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-2.5-flash"]  # composing / repairing a scene: quality over speed


def gemini(prompt: str, *, json_out=True, images: list[bytes] | None = None, temperature=0.4, timeout=60, log=None, strong=False) -> str:
    import httpx

    keys = [k.strip() for k in (os.environ.get(n, "") for n in ("GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3", "GEMINI_API_KEY_4")) if k.strip()]
    key = keys[0] if keys else ""
    if not key and os.environ.get("GM_GEMINI_PROXY"):
        for attempt in range(5):
            r = httpx.post(os.environ["GM_GEMINI_PROXY"].rstrip("/") + "/gemini", headers={"X-Render-Token": os.environ.get("RENDER_TOKEN", "")},
                           json={"prompt": prompt, "json_out": json_out, "temperature": temperature, "strong": strong, "images": [base64.b64encode(i).decode() for i in images or []]}, timeout=timeout * 3 + 60)
            if r.status_code == 503 and "429" in r.text and attempt < 4:
                time.sleep(30 + 15 * attempt)  # the shared free-tier minute window
                continue
            break
        if r.status_code != 200:
            raise RuntimeError(f"Gemini proxy {r.status_code}: {r.text[:200]}")
        j = r.json()
        if log is not None:
            log.extend(j.get("log", []))
        oks = [x for x in j.get("log", []) if x.endswith(" ok")]
        if oks:
            LAST_MODEL["model"] = oks[-1].split()[1].split("#")[0]
        return j["text"]
    if not key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    parts = [{"text": prompt}]
    for img in images or []:
        parts.append({"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(img).decode()}})
    last = None
    wait_hint = 0.0
    for attempt in range(3):
        # strongest available models first; flash-lite is the backup. GM_FORCE_MODELS (comma list) pins the order,
        # e.g. to verify that the backup alone still meets the bar.
        forced = [m.strip() for m in os.environ.get("GM_FORCE_MODELS", "").split(",") if m.strip()]
        order = forced or (STRONG + [m for m in MODELS if m not in STRONG])
        if strong and not forced and attempt < 2:
            # composing calls wait out a per-minute limit on the strong models (twice) before falling back to flash-lite;
            # a daily limit (skip >= 10 min) is not waited for
            alive = [m for m in STRONG for k in range(len(keys)) if _skip.get(m if k == 0 else f"{m}#{k}", 0) - time.time() < 120]
            if alive:
                order = STRONG
        # model-major: each model is tried on every key (a 429 on one key rotates to the next) before the next model
        for slot in [m if k == 0 else f"{m}#{k}" for m in order for k in range(len(keys))]:
            model, _, kidx = slot.partition("#")
            key = keys[int(kidx or 0)]
            cfg = {"temperature": temperature}
            if json_out:
                cfg["responseMimeType"] = "application/json"
            if model.startswith("gemini-3"):
                cfg["thinkingConfig"] = {"thinkingLevel": "medium" if strong else "low"}
            elif model.startswith("gemini-2.5-flash") and "lite" not in model:
                cfg["thinkingConfig"] = {"thinkingBudget": 2048 if strong else 512}
            if time.time() < _skip.get(slot, 0):
                continue
            try:
                r = httpx.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                    params={"key": key}, json={"contents": [{"role": "user", "parts": parts}], "generationConfig": cfg}, timeout=timeout,
                )
            except Exception as exc:  # noqa: BLE001
                last = f"{slot}: {exc}"
                continue
            if r.status_code == 200:
                j = r.json()
                try:
                    text = "".join(p.get("text", "") for p in j["candidates"][0]["content"]["parts"] if not p.get("thought"))
                except Exception:  # noqa: BLE001
                    last = f"{slot}: empty answer"
                    continue
                if log is not None:
                    log.append(f"gemini {slot} ok")
                LAST_MODEL["model"] = model
                return text
            last = f"{slot}: {r.status_code} {r.text[:160]}"
            qid = re.findall(r'"quotaId":\s*"([^"]+)"', r.text)
            _why[slot] = f"{r.status_code} {','.join(sorted(set(qid)))[:120]}"
            if log is not None:
                log.append(f"gemini {slot}: {r.status_code}")
            if r.status_code == 404:  # this key has no access to the model: do not ask again in this container
                _skip[slot] = time.time() + 86400
            if r.status_code == 429:
                daily = "PerDay" in r.text or "per day" in r.text.lower()
                m = re.search(r'"retryDelay":\s*"(\d+(?:\.\d+)?)s"', r.text)
                delay = float(m.group(1)) if m else 20.0
                # a daily quota is gone for hours; a per-minute one frees up within the hint
                _skip[slot] = time.time() + (600 if daily else delay)
                if not daily:
                    wait_hint = max(wait_hint, min(delay, 45.0))
        soon = [t for t in _skip.values() if t - time.time() < 60]
        time.sleep(max(3.0, min(45.0, wait_hint or 5.0)) if soon or attempt == 0 else 3.0)
        wait_hint = 0.0
    raise RuntimeError(f"Gemini unavailable: {last or ''} | " + "; ".join(f"{m}={_why.get(m, '?')} skip {max(0, int(_skip.get(m, 0) - time.time()))}s" for m in _why))


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

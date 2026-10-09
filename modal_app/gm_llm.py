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


def gemini(prompt: str, *, json_out=True, images: list[bytes] | None = None, temperature=0.4, timeout=60, log=None, strong=False, models: list[str] | None = None) -> str:
    import httpx

    keys = [k.strip() for k in (os.environ.get(n, "") for n in ("GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3", "GEMINI_API_KEY_4")) if k.strip()]
    key = keys[0] if keys else ""
    if not key and os.environ.get("GM_GEMINI_PROXY"):
        for attempt in range(5):
            r = httpx.post(os.environ["GM_GEMINI_PROXY"].rstrip("/") + "/gemini", headers={"X-Render-Token": os.environ.get("RENDER_TOKEN", "")},
                           json={"prompt": prompt, "json_out": json_out, "temperature": temperature, "strong": strong, "images": [base64.b64encode(i).decode() for i in images or []],
                                 **({"models": ",".join(models)} if models else {})}, timeout=timeout * 3 + 60, follow_redirects=True)
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
        forced = list(models or []) or [m.strip() for m in os.environ.get("GM_FORCE_MODELS", "").split(",") if m.strip()]
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


# ───────────── Groq-first text chain (free-form animation pipeline, gm_freeform.py) ─────────────
# Same order the web app's agent uses for structured work (src/lib/agent/llm.ts): gpt-oss-120b, qwen3.8-27b, gpt-oss-20b,
# then the Gemini chain above. Groq free tier is ~8K tokens/minute per model, so a 429 or a too-large request moves on to
# the next model at once instead of waiting.
GROQ_CHAIN = {
    "plan": ["openai/gpt-oss-20b", "qwen/qwen3.8-27b", "openai/gpt-oss-120b"],
    "code": ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"],
    "fix": ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"],
    "ir": ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"],
}
_groq_skip: dict[str, float] = {}
# token headroom per model from Groq's x-ratelimit headers: {model: (remaining_tokens, refill_at_epoch)}. Shared across calls in
# this process, and (deployed) through a Modal Dict so concurrent containers route around a model another one just drained.
_headroom: dict[str, tuple[float, float]] = {}
_HEADROOM_DICT = None


def _hr_dict():
    global _HEADROOM_DICT
    if _HEADROOM_DICT is None:
        _HEADROOM_DICT = False
        if os.environ.get("MODAL_TASK_ID"):
            try:
                import modal
                _HEADROOM_DICT = modal.Dict.from_name("gm-llm-headroom", create_if_missing=True)
            except Exception:  # noqa: BLE001
                _HEADROOM_DICT = False
    return _HEADROOM_DICT or None


def _dur(s: str) -> float:
    t = 0.0
    for n, u in re.findall(r"([\d.]+)(ms|s|m|h)", s or ""):
        t += float(n) * {"ms": 0.001, "s": 1, "m": 60, "h": 3600}[u]
    return t


def _note_headroom(model: str, headers) -> None:
    try:
        rem = float(headers.get("x-ratelimit-remaining-tokens"))
        reset = time.time() + _dur(headers.get("x-ratelimit-reset-tokens", "0s"))
    except Exception:  # noqa: BLE001
        return
    _headroom[model] = (rem, reset)
    d = _hr_dict()
    if d is not None:
        try:
            d[model] = (rem, reset)
        except Exception:  # noqa: BLE001
            pass


def headroom(model: str) -> float:
    """Tokens this model can take right now (8000 when unknown or refilled)."""
    rec = _headroom.get(model)
    d = _hr_dict()
    if d is not None:
        try:
            rec = d.get(model) or rec
        except Exception:  # noqa: BLE001
            pass
    if not rec:
        return 8000.0
    rem, reset = rec
    if time.time() >= reset:
        return 8000.0
    # tokens refill continuously over the minute window
    return min(8000.0, rem + max(0.0, 60 - (reset - time.time())) * 8000 / 60)


def route(order: list[str], need: float, prefer: str | None = None) -> list[str]:
    """Models with room for this request first (the preferred one first among those), then the rest by headroom."""
    order = list(dict.fromkeys(([prefer] if prefer in order else []) + order))
    fits = [m for m in order if headroom(m) >= need]
    rest = sorted([m for m in order if m not in fits], key=lambda m: -headroom(m))
    return fits + rest


def chat(prompt: str, *, purpose: str = "code", system: str | None = None, json_out: bool = False, max_tokens: int = 4000,
         temperature: float = 0.3, log: list | None = None, timeout: float = 60, gemini_fallback: bool = True, reasoning: str = "low",
         prefer: str | None = None, est_tokens: float | None = None) -> str:
    """One completion from the Groq chain (fall through on 429/413/5xx/timeouts), then Gemini (strong) as the fallback."""
    import httpx

    key = os.environ.get("GROQ_API_KEY", "").strip()
    order = [m.strip() for m in os.environ.get("GM_GROQ_MODELS", "").split(",") if m.strip()] or GROQ_CHAIN.get(purpose, GROQ_CHAIN["code"])
    need = float(est_tokens or (len(prompt) / 3.2 + max_tokens * 0.6))
    order = route(order, need, prefer)
    if need > 7800:
        order = []  # larger than a free-tier minute window on any model: go straight to Gemini
    errors = []
    waited = 0.0
    if key or os.environ.get("GM_GROQ_GATEWAY"):
        queue = list(order)
        retried: set = set()
        while queue:
            model = queue.pop(0)
            left = _groq_skip.get(model, 0) - time.time()
            if left > 0:
                if model in retried and left <= 20 and waited + left <= 35:
                    waited += left + 0.3
                    time.sleep(left + 0.3)  # every other model was tried first: wait out this one's minute window
                else:
                    continue
            msgs = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
            body = {"model": model, "messages": msgs, "max_completion_tokens": max_tokens, "temperature": temperature}
            if "gpt-oss" in model:
                body.update(reasoning_effort=reasoning, include_reasoning=False)
            elif "qwen" in model:
                body.update(reasoning_format="hidden", reasoning_effort="none" if reasoning == "low" else "default")
            if json_out:
                body["response_format"] = {"type": "json_object"}
            t = time.time()
            try:
                r = httpx.post("https://api.groq.com/openai/v1/chat/completions", headers={"Authorization": f"Bearer {key or 'gateway'}"}, json=body, timeout=timeout)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{model}: {type(exc).__name__}")
                if log is not None:
                    log.append(f"groq {model}: {type(exc).__name__}")
                continue
            _note_headroom(model, r.headers)
            if r.status_code == 200:
                try:
                    text = r.json()["choices"][0]["message"].get("content") or ""
                except Exception:  # noqa: BLE001
                    text = ""
                if text.strip():
                    if log is not None:
                        log.append(f"groq {model} ok {time.time() - t:.1f}s")
                    LAST_MODEL["model"] = model
                    return text
                errors.append(f"{model}: empty")
                if log is not None:
                    log.append(f"groq {model}: empty answer ({r.json().get('choices', [{}])[0].get('finish_reason')})")
                continue
            errors.append(f"{model}: {r.status_code} {r.text[:120]}")
            if log is not None:
                log.append(f"groq {model}: {r.status_code}")
            if r.status_code == 429:
                m = re.search(r"try again in ([\d.]+)(m?s)", r.text)
                wait = float(m.group(1)) / (1000 if m and m.group(2) == "ms" else 1) if m else 20.0
                daily = "per day" in r.text.lower() or "(TPD)" in r.text or "(RPD)" in r.text
                if not daily and wait <= 20 and model not in retried:
                    # a per-minute token window refills within seconds: try the other models now, come back to this one
                    # (waiting if needed) before dropping to Gemini
                    retried.add(model)
                    _groq_skip[model] = time.time() + wait
                    queue.append(model)
                    continue
                _groq_skip[model] = time.time() + (900 if daily else min(wait, 60))
    if not gemini_fallback:
        raise RuntimeError("Groq unavailable: " + " | ".join(errors))
    if log is not None:
        log.append("groq chain exhausted -> gemini")
    return gemini((system + "\n\n" if system else "") + prompt, json_out=json_out, temperature=temperature, log=log, strong=True, timeout=max(timeout, 90))

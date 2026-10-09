"""gm_scenegen: concept -> open scene IR -> deterministic solve + verify -> sandboxed render -> score -> best of N.

The model writes a small JSON scene in the gm_world language (objects, relations, vars as formulas, checks, beats). It never
computes a coordinate or a number: sympy evaluates every value, the constraint solver places every point, the layout
engine (gm_stage) places every text, and gm_world verifies every relation and check in every state the beats reach.
A scene that fails verification goes back to the planner with the solver's sentences (not to a coder). Verified
scenes are rendered at low quality in parallel, scored deterministically (verification, layout probe, pacing, motion),
the vision critic breaks ties and may ask for one IR revision, and only the winner is rendered at full quality.
Verified scenes that score well are added to the example gallery that later prompts retrieve from.

Raw Manim stays available as glue (IR "glue": {"name": "def glue_name(st, scene): ..."}), inside the same AST sandbox.
"""
from __future__ import annotations

import json
import math
import os
import pprint
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import gm_world as GW
from gm_freeform import SCENE, critique, guard, layout_issues, short_traceback
from gm_llm import chat, parse_json

_HERE = os.path.dirname(os.path.abspath(__file__))
DOC = open(os.path.join(_HERE, "gm_ir_doc.md")).read()
GALLERY_PATH = os.path.join(_HERE, "gm_gallery.json")
MAX_IR_REPAIRS = 2
MAX_RENDER_REPAIRS = 1


# ───────────────────────── gallery (verified examples, retrieved as few-shot) ─────────────────────────
_gal_lock = threading.Lock()


def _words(s: str) -> set:
    stop = {"the", "a", "an", "of", "and", "to", "in", "on", "as", "is", "it", "its", "by", "with", "for", "at", "from", "that", "this", "show", "how"}
    return {w for w in re.findall(r"[a-z]{3,}", s.lower()) if w not in stop}


def gallery_load(extra_path: str | None = None) -> list[dict]:
    items = []
    for p in (GALLERY_PATH, extra_path or os.environ.get("GM_GALLERY_EXTRA", "")):
        if p and os.path.exists(p):
            try:
                items += json.load(open(p))
            except Exception:  # noqa: BLE001
                pass
    try:  # the self-improving part lives in a Modal Dict when deployed
        d = _modal_dict("gm-scene-gallery")
        if d is not None:
            items += list(d.get("items", []) or [])
    except Exception:  # noqa: BLE001
        pass
    return items


def retrieve_examples(description: str, k: int = 2, exclude_topic: str | None = None) -> list[dict]:
    q = _words(description)
    scored = []
    for it in gallery_load():
        if exclude_topic and it.get("topic") == exclude_topic:
            continue
        w = _words(it.get("topic", "") + " " + it.get("tags", ""))
        s = len(q & w) / (1 + math.sqrt(len(w)))
        scored.append((s, it))
    scored.sort(key=lambda x: -x[0])
    out = [it for s, it in scored[:k]]
    # keep variety: if both examples are the same family, swap the second for a different family
    return out


def gallery_add(description: str, ir: dict, score: float | None, path: str | None = None):
    item = {"topic": description[:200], "tags": " ".join(sorted(_words(description)))[:200], "ir": ir, "score": score, "added": time.strftime("%Y-%m-%d")}
    with _gal_lock:
        d = _modal_dict("gm-scene-gallery")
        if d is not None:
            items = list(d.get("items", []) or [])
            items = [x for x in items if x.get("topic") != item["topic"]][-60:] + [item]
            d["items"] = items
            return "modal"
        p = path or os.environ.get("GM_GALLERY_EXTRA")
        if p:
            items = json.load(open(p)) if os.path.exists(p) else []
            items = [x for x in items if x.get("topic") != item["topic"]] + [item]
            json.dump(items, open(p, "w"), indent=1)
            return p
    return None


def _modal_dict(name):
    if not os.environ.get("MODAL_TASK_ID"):
        return None
    try:
        import modal
        return modal.Dict.from_name(name, create_if_missing=True)
    except Exception:  # noqa: BLE001
        return None


# ───────────────────────── prompts ─────────────────────────
def _ex_text(ex: list[dict]) -> str:
    if not ex:
        return ""
    parts = []
    for it in ex:
        parts.append(f"Example (verified) for \"{it['topic']}\":\n" + json.dumps(it["ir"], separators=(",", ":")))
    return "\n\n".join(parts)


def plan_prompt(description: str, narration: dict | None, context: str, aspect: str, examples: list[dict], variant: int = 0) -> str:
    nar = ""
    if narration and narration.get("text"):
        nar = f"\nThe clip plays while the tutor says (match the beats to it): \"{str(narration['text'])[:700]}\""
    frame = "a 16:9 landscape frame" if aspect == "16:9" else "a 9:16 portrait phone frame (stack things vertically)"
    angle = ["", "\nFor this version, choose a different visual approach than the most obvious one (a different layout or a different way to show the key idea)."][variant % 2]
    return (DOC + "\n\n" + _ex_text(examples) + "\n\nThe examples show the language; do not copy their topic. Write a new scene for:\n"
            f"CONCEPT: {description[:900]}\n" + (f"Context: {context[:400]}\n" if context else "") + nar +
            f"\nFrame: {frame}. 3-6 beats, about 12-30 seconds in total." + angle)


def repair_prompt(ir: dict, problems: list[str], description: str, kind: str = "verify") -> str:
    head = {"verify": "The engine could not verify your scene. Its solver and checker report:",
            "render": "The scene verified but failed while rendering:",
            "visual": "The scene rendered. A reviewer looking at its frames reports:"}[kind]
    return (DOC + f"\n\nCONCEPT: {description[:600]}\n\nYour scene:\n" + json.dumps(ir, separators=(",", ":")) + f"\n\n{head}\n- " +
            "\n- ".join(p[:300] for p in problems[:10]) +
            "\n\nFix the scene (change relations, vars or beats; never add coordinates or computed numbers; keep what works). Return the complete corrected JSON only.")


REVIEW_PROMPT = """You check a teaching animation's scene before it is drawn. A solver computed the exact geometry; here it is in numbers.
CONCEPT: {concept}
SOLVED SCENE (start and end of the animation):
{desc}
BEATS (narration -> actions):
{beats}
Does this scene correctly and recognisably show the concept? Think about what the shapes/curves/boxes actually are from the numbers
and check each one against the concept like a strict teacher, e.g.:
- a rearrangement proof needs congruent right triangles (legs a, b, hypotenuse c) tiling a square of side a+b with no partial overlaps,
  and the inner shape must really be a square of side c;
- a ray crossing a boundary keeps going forward: the refracted ray leaves the boundary on the FAR side of the normal from the incident ray
  (if the incident ray travels right, the refracted ray also travels right); only a reflected ray comes back on the same side;
- a tangent touches the curve at the point with the curve's slope; vectors add head to tail; a circuit loop is closed;
- an algorithm's states step correctly; an equation's steps are valid and the answer is not on screen before it is derived;
- the values the concept gives (20 m/s, 45 degrees, R = 2 ohms, the array, the equation) are the vars' values exactly;
- every beat DOES what it SAYS: if the narration says the pieces are rearranged / something slides, grows or shifts, that beat must
  morph/animate/set it (showing a caption is not a rearrangement); a proof must actually show its steps, not just state the result.
Directions are degrees from +x (0 = right, 90 = up, -90 = down). Ignore style. Return JSON only:
{{"correct": true|false, "problems": ["what is wrong, and which objects/relations to change"]}}  (problems empty when correct)"""


def semantic_review(description: str, ir: dict, aspect: str, log: list) -> list[str]:
    """Text-only review of the SOLVED scene (numbers from the solver, so the reviewer never computes). Returns problems."""
    try:
        w = GW.World(ir, aspect)
        w.build([-4.5, -2.7, 4.5, 2.7])
        desc = GW.describe(w)
        beats = "\n".join(f"{i + 1}. \"{str(b.get('say', ''))[:140]}\" -> does: " + json.dumps(b.get("do") or [], separators=(",", ":"))[:220]
                          for i, b in enumerate(ir.get("beats") or []))[:1600]
        raw = chat(REVIEW_PROMPT.format(concept=description[:600], desc=desc[:3500], beats=beats), purpose="plan", json_out=True, max_tokens=900,
                   temperature=0.1, log=log, timeout=40, reasoning="medium", est_tokens=2600)
        r = parse_json(raw)
        if isinstance(r, dict) and r.get("correct") is False:
            return [str(p)[:300] for p in (r.get("problems") or [])][:5] or ["the reviewer found the scene does not show the concept"]
    except Exception as exc:  # noqa: BLE001
        log.append(f"semantic review skipped: {type(exc).__name__} {str(exc)[:100]}")
    return []


def scene_facts(ir: dict, aspect: str) -> str:
    """describe() of a verified scene, handed to the vision critic so it judges geometry from exact numbers."""
    try:
        w = GW.World(ir, aspect)
        w.build([-4.5, -2.7, 4.5, 2.7])
        return GW.describe(w, max_lines=30)
    except Exception:  # noqa: BLE001
        return ""


# ───────────────────────── compile ─────────────────────────
def compile_scene(ir: dict) -> str:
    glue = ir.get("glue") if isinstance(ir.get("glue"), dict) else {}
    clean = {k: v for k, v in ir.items() if k != "glue"}
    funcs = []
    names = []
    for name, src in glue.items():
        if not re.match(r"^[A-Za-z_]\w*$", str(name)) or not isinstance(src, str):
            continue
        src = src.strip()
        if not src.startswith("def "):
            body = "\n".join("    " + ln for ln in src.splitlines())
            src = f"def glue_{name}(st, scene, *args):\n{body}"
        funcs.append(src)
        fn = re.match(r"def\s+(\w+)", src).group(1)
        names.append((name, fn))
    gl = "{" + ", ".join(f"{n!r}: {f}" for n, f in names) + "}"
    return ("from manim import *\nfrom gm_stage import Stage\n\nIR = " + pprint.pformat(clean, width=150, sort_dicts=False) + "\n\n" +
            "\n\n".join(funcs) + "\n\n\nclass " + SCENE + "(Scene):\n    def construct(self):\n        Stage(self, IR, glue=" + gl + ").perform()\n")


def normalize(ir) -> dict:
    """Light, safe fixes of the usual model slips before validation."""
    if not isinstance(ir, dict):
        raise ValueError("the scene must be a JSON object")
    if "scene" in ir and isinstance(ir["scene"], dict):
        ir = ir["scene"]
    ir.setdefault("vars", {})
    ir.setdefault("objects", [])
    ir.setdefault("constraints", [])
    ir.setdefault("beats", [])
    if isinstance(ir["vars"], list):
        ir["vars"] = {v.get("name"): v.get("value", v.get("expr")) for v in ir["vars"] if isinstance(v, dict)}
    for k in ("pi", "e", "E", "deg", "x"):
        ir["vars"].pop(k, None)
    for o in ir["objects"]:
        if isinstance(o, dict) and "kind" in o and "type" not in o:
            o["type"] = o.pop("kind")
        if isinstance(o, dict) and o.get("type") == "icon" and "icon" not in o and o.get("name"):
            o["icon"] = o["name"]
    # an object without an id can never be shown: name it after its type (curve -> curve1)
    used = {o.get("id") for o in ir["objects"] if isinstance(o, dict)}
    for o in ir["objects"]:
        if isinstance(o, dict) and not o.get("id") and o.get("type"):
            n = 1
            while f"{o['type']}{n}" in used:
                n += 1
            o["id"] = f"{o['type']}{n}"
            used.add(o["id"])
    _bind_axes(ir)
    # 'light' is a fill colour: as an icon, stroke or text colour it vanishes on the paper background
    for o in ir["objects"]:
        if isinstance(o, dict) and str(o.get("color", "")).lower() == "light" and o.get("type") not in ("box", "polygon", "area", "cells", "circle"):
            o["color"] = "muted"
    cons = []
    for c in ir["constraints"]:
        if isinstance(c, dict):
            k = c.get("type") or c.get("relation") or c.get("kind")
            args = c.get("args") or [v for kk, v in c.items() if kk not in ("type", "relation", "kind")]
            c = [k, *args]
        if isinstance(c, list) and c:
            cons.append(c)
    ir["constraints"] = cons
    beats = []
    for b in ir["beats"]:
        if isinstance(b, dict):
            do = b.get("do") or b.get("actions") or []
            b["do"] = [d if isinstance(d, list) else ([d.get("action") or d.get("type"), *(d.get("args") or [])] if isinstance(d, dict) and (d.get("action") or d.get("type")) else d) for d in do]
            beats.append(b)
    ir["beats"] = beats
    return ir


def _bind_axes(ir: dict):
    """Vectors drawn in world units from a world point at (0, 0), beside one free-standing axes (no origin/unit/size):
    the model means the vectors on that grid, so the axes take that point as their origin (1 axes unit = 1 world unit)."""
    objs = [o for o in ir["objects"] if isinstance(o, dict)]
    axes = [o for o in objs if o.get("type") == "axes"]
    if len(axes) != 1 or any(axes[0].get(k) for k in ("origin", "unit", "size", "at")):
        return
    zero = {o.get("id") for o in objs if o.get("type") == "point" and not o.get("on") and isinstance(o.get("at"), list)
            and len(o["at"]) == 2 and all(str(v).strip() in ("0", "0.0") for v in o["at"])}
    tails = [o.get("from") for o in objs if o.get("type") == "vector" and not o.get("on")]
    hit = [t for t in tails if t in zero]
    if hit:
        axes[0]["origin"] = hit[0]


_UNIT = r"(?:m/s\^?2|m/s|km/h|degrees?|deg|°|ohms?|Ω|V|A|kg|N|m|s|Hz|J|W|cm|mm|km|g)"


def given_values_report(description: str, ir: dict) -> list[str]:
    """Numbers the concept gives with a unit (20 m/s, 45 degrees, n = 1.5) must appear in the scene's vars or actions; a scene
    that silently changes them (v0 = 15 for a 20 m/s launch) teaches the wrong numbers."""
    given = re.findall(r"(?<![\w.])(\d+(?:\.\d+)?)\s*" + _UNIT + r"(?![A-Za-z])", description)
    given += re.findall(r"\b[A-Za-z]\w{0,2}\s*=\s*(\d+(?:\.\d+)?)\b(?!\s*[A-Za-z(])", description)
    if not given:
        return []
    try:
        w = GW.World(ir)
        vals = [v for v in w.vars.values().values() if isinstance(v, (int, float))]
    except Exception:  # noqa: BLE001
        vals = []
    blob = json.dumps({k: ir.get(k) for k in ("vars", "beats", "objects", "checks")})
    out = []
    for g in dict.fromkeys(given):
        x = float(g)
        if any(abs(v - x) < 1e-6 * max(1, abs(x)) or abs(v - x * math.pi / 180) < 1e-6 for v in vals):
            continue
        if re.search(r"(?<![\w.])" + re.escape(g) + r"(?:\.0+)?(?![\w.])", blob):
            continue
        out.append(f"the concept gives the value {g}, but no var or action of the scene uses it: use the given numbers (put {g} in vars)")
    return out[:3]


def concept_terms_report(description: str, ir: dict) -> list[str]:
    """Deterministic must-haves named by the concept."""
    d = description.lower()
    blob = json.dumps(ir)
    out = []
    stage_types = GW.GEOM | GW.BLOCKS | GW.ON_AXES | {"flow", "pointer"} | set(GW.MACROS) | {"macro"}
    shown = {str(x) for b in ir.get("beats") or [] for a in b.get("do") or [] if GW._as_list(a)[:1] in (["show"], ["morph"])
             for x in (GW._as_list(a)[1:] if GW._as_list(a)[0] == "show" else GW._as_list(a)[2:3]) for x in GW._as_list(x)}
    objs = {o.get("id"): o for o in ir.get("objects") or [] if isinstance(o, dict)}

    def pictured(i, depth=0):
        o = objs.get(i.split("[")[0]) or {}
        if o.get("type") == "group" and depth < 4:
            return any(pictured(str(m), depth + 1) for m in o.get("members") or [])
        return o.get("type") in stage_types and o.get("type") != "text"
    if not any(pictured(i) for i in shown):
        out.append("the main stage shows no picture (only equations/readouts/text): draw the idea itself on the stage "
                   "(a balance, a diagram, a graph, cells...) and show it in the first beat")
    if re.search(r"\bbalance\b", d) and re.search(r"equation|solv", d) and "->" not in d and '"balance"' not in blob:
        out.append('the concept asks for the balance of both sides: use the balance macro {"type": "balance", "id": ..., "left": [...], '
                   '"right": [...]} (one entry per step) and tilt/level it as the equation steps change')
    if "tangent" in d and re.search(r"\b(curve|y\s*=|function|slope|derivative)", d) and '"tangent"' not in blob and "deriv(" not in blob:
        out.append('the concept is about a tangent line, but the scene draws none: add a line through two points T1, T2 with '
                   '["tangent", "T1-T2", functionId, x0] and show it when the secant reaches it (a secant whose points meet vanishes)')
    if re.search(r"rearrang|dissect|cut .{0,40}(slid|mov)", d) and '"morph"' not in blob:
        out.append('the concept is a rearrangement, but nothing moves into the new arrangement: draw the second arrangement as '
                   'other polygons and ["morph", [old pieces], [new pieces]] (pieces must tile in both arrangements)')
    return out


# ───────────────────────── scoring ─────────────────────────
def score_render(ir: dict, res: dict, aspect: str, verify: dict) -> dict:
    lay = layout_issues(res.get("probe"), aspect) if res.get("ok") else []
    hi = sum(1 for i in lay if i["severity"] == "high")
    med = sum(1 for i in lay if i["severity"] == "medium")
    words = sum(len(str(b.get("say", "")).split()) for b in ir.get("beats") or [])
    dur = float(res.get("duration") or 0)
    pacing = abs(dur - max(8.0, words / 2.6 + 1.5)) / max(dur, 1)
    acts = [GW._as_list(a)[0] for b in ir.get("beats") or [] for a in b.get("do") or [] if GW._as_list(a)]
    motion = sum(1 for a in acts if a in ("animate", "set", "morph", "flow", "trace"))
    beats_with_motion = sum(1 for b in ir.get("beats") or [] if any(GW._as_list(a)[:1] and GW._as_list(a)[0] in ("animate", "set", "morph", "flow", "highlight", "equation") for a in b.get("do") or []))
    n_checks = len(ir.get("checks") or [])
    stage_types = GW.GEOM | GW.BLOCKS | GW.ON_AXES | {"flow", "pointer", "group"} | set(GW.MACROS) | {"macro"}
    has_stage = any(isinstance(o, dict) and o.get("type") in stage_types and o.get("type") != "text" for o in ir.get("objects") or [])
    s = 10.0 - 1.5 * hi - 0.5 * med - 2.0 * min(1.0, pacing) + 0.4 * min(motion, 4) + 0.3 * min(n_checks, 3) + 0.3 * beats_with_motion
    s -= 0.5 * len(verify.get("warnings") or [])
    if not has_stage:
        s -= 8  # only text and equations: nothing is shown
    if not verify.get("ok"):
        s -= 20
    return {"score": round(s, 2), "has_stage": has_stage, "layout_high": hi, "layout_medium": med, "pacing": round(pacing, 2), "motion": motion, "checks": n_checks,
            "layout": lay[:8], "duration": dur}


# ───────────────────────── one variant: plan -> verify (repair) -> render (repair) ─────────────────────────
def parse_ir(raw: str):
    """parse_json + the slips models make in this JSON: LaTeX backslashes left single (\\theta would become a tab)."""
    fixed = re.sub(r'(?<!\\)\\(?=[A-Za-z]{2,})', r'\\\\', raw)
    try:
        return parse_json(fixed)
    except Exception:  # noqa: BLE001
        return parse_json(raw)


def _ask_ir(prompt: str, log: list, model_first: str | None = None, temperature: float = 0.35) -> dict:
    try:
        return normalize(parse_ir(_raw_ir(prompt, log, model_first, temperature)))
    except json.JSONDecodeError as exc:
        log.append(f"IR JSON broken ({exc.msg} at {exc.pos}); asking again")
        return normalize(parse_ir(_raw_ir(prompt + f"\n\nIMPORTANT: your previous answer was invalid JSON ({exc.msg}). Return strictly valid JSON.", log, None, 0.2)))


def _raw_ir(prompt: str, log: list, model_first: str | None = None, temperature: float = 0.35) -> str:
    return chat(prompt, purpose="ir", json_out=True, max_tokens=3200, temperature=temperature, log=log, timeout=75, reasoning="medium",
               prefer=model_first, est_tokens=len(prompt) // 3.6 + 3200)


def variant(description, render, *, narration, context, aspect, examples, log, idx=0, model_first=None, t_end=None):
    rec = {"idx": idx, "ok": False, "verify_rounds": 0, "render_rounds": 0, "problems": []}
    t0 = time.time()
    try:
        ir = _ask_ir(plan_prompt(description, narration, context, aspect, examples, idx), log, model_first, 0.3 + 0.25 * idx)
    except Exception as exc:  # noqa: BLE001
        rec["error"] = f"planner: {type(exc).__name__}: {str(exc)[:200]}"
        return rec
    rec["t_plan"] = round(time.time() - t0, 1)
    ver = None
    for r in range(MAX_IR_REPAIRS + 1):
        try:
            ver = GW.verify_ir(ir, aspect)
        except Exception as exc:  # noqa: BLE001
            ver = {"ok": False, "problems": [f"engine could not read the scene: {type(exc).__name__}: {str(exc)[:200]}"]}
        if ver.get("ok"):
            det = given_values_report(description, ir) + concept_terms_report(description, ir)
            if det:
                ver = {**ver, "ok": False, "problems": det}
        rec["problems"] = ver.get("problems", [])
        if ver.get("ok") and rec.get("reviewed", 0) < 2 and (not t_end or time.time() < t_end - 80):
            # verified = consistent; the review asks whether it is the RIGHT scene (from the solver's numbers). A scene repaired
            # after a review is reviewed once more (a repair can trade one mistake for another)
            rec["reviewed"] = rec.get("reviewed", 0) + 1
            sem = semantic_review(description, ir, aspect, log)
            rec["review"] = sem
            if sem:
                ver = {"ok": False, "problems": ["CONCEPT REVIEW: " + p for p in sem]}
                rec["problems"] = ver["problems"]
        if ver.get("ok"):
            break
        if r == MAX_IR_REPAIRS or (t_end and time.time() > t_end - 40):
            break
        log.append(f"v{idx} verify failed: {'; '.join(ver['problems'][:3])[:300]}")
        try:
            ir = normalize(parse_ir(chat(repair_prompt(ir, ver["problems"], description, "verify"), purpose="fix", json_out=True, max_tokens=3200,
                                           temperature=0.2, log=log, timeout=75, reasoning="low", est_tokens=len(DOC) // 3.6 + 4400)))
        except Exception as exc:  # noqa: BLE001
            rec["error"] = f"repair: {type(exc).__name__}: {str(exc)[:200]}"
            break
        rec["verify_rounds"] += 1
    if ver and not ver.get("ok") and ver.get("problems") and all(str(p).startswith("CONCEPT REVIEW") for p in ver["problems"]):
        # the engine verifies it and only the reviewer still objects: keep it in the running with a penalty (the vision critic
        # and the other variant decide) rather than lose the clip to a reviewer that may be wrong
        try:
            v2 = GW.verify_ir(ir, aspect)
            if v2.get("ok"):
                rec["review_unresolved"] = ver["problems"][:3]
                ver = v2
        except Exception:  # noqa: BLE001
            pass
    rec["ir"] = ir
    rec["verify"] = ver
    rec["t_verify"] = round(time.time() - t0, 1)
    if not ver or not ver.get("ok"):
        rec["error"] = "did not verify: " + "; ".join((ver or {}).get("problems", [])[:4])[:500]
        return rec
    for r in range(MAX_RENDER_REPAIRS + 1):
        code, probs = guard(compile_scene(ir))
        res = {"ok": False, "error": "; ".join(probs), "static": True} if probs else render(code, "l", aspect, True, False)
        if res.get("ok"):
            break
        err = res.get("error") or ""
        rec["render_error"] = short_traceback(err, code)[-800:]
        if r == MAX_RENDER_REPAIRS or (t_end and time.time() > t_end - 40):
            break
        log.append(f"v{idx} render failed: {rec['render_error'][-200:]}")
        try:
            ir = normalize(parse_ir(chat(repair_prompt(ir, [rec["render_error"]], description, "render"), purpose="fix", json_out=True,
                                           max_tokens=3200, temperature=0.2, log=log, timeout=75, reasoning="low", est_tokens=len(DOC) // 3.6 + 4400)))
            ver = GW.verify_ir(ir, aspect)
            if not ver.get("ok"):
                rec["error"] = "render repair broke verification: " + "; ".join(ver["problems"][:3])
                return rec
        except Exception as exc:  # noqa: BLE001
            rec["error"] = f"render repair: {type(exc).__name__}: {str(exc)[:200]}"
            return rec
        rec["render_rounds"] += 1
    rec["t_render"] = round(time.time() - t0, 1)
    if not res.get("ok"):
        rec["error"] = "render failed: " + rec.get("render_error", "")[-300:]
        return rec
    rec.update(ok=True, ir=ir, code=code, verify=ver, res={k: v for k, v in res.items() if k != "video"}, score=score_render(ir, res, aspect, ver))
    if rec.get("review_unresolved"):
        rec["score"]["score"] = round(rec["score"]["score"] - 4, 2)
        rec["score"]["review_unresolved"] = rec["review_unresolved"]
    return rec


# ───────────────────────── the loop ─────────────────────────
def final_verdict(description: str, ir: dict, aspect: str = "16:9") -> dict:
    """The deterministic verifier's verdict on the scene that ships ({ok, failed}): the engine's checks (geometry, given
    numbers, concept terms) re-run on the final IR. Sent with the 'done' callback; ok False blocks the clip in the web app."""
    try:
        v = GW.verify_ir(ir, aspect)
        failed = list(v.get("problems") or [])
        if v.get("ok"):
            failed += given_values_report(description, ir) + concept_terms_report(description, ir)
        return {"ok": not failed, "failed": [str(p)[:300] for p in failed][:12], "warnings": [str(w)[:200] for w in (v.get("warnings") or [])][:6], "verifier": "scene-ir"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "failed": [f"verifier error: {type(exc).__name__}: {str(exc)[:200]}"], "verifier": "scene-ir"}


def run(description: str, render, *, narration: dict | None = None, context: str = "", aspect: str = "16:9", log: list | None = None,
        n_variants: int = 2, budget_s: float = 240.0, vision: bool = True, learn: bool = True, examples: list | None = None) -> dict:
    """render(code, quality, aspect, want_frames, pen) -> {"ok", "error", "probe", "duration", "frames", "video"?}.
    Returns {"ok", "code", "ir", "video", "pen", "report"}."""
    log = log if log is not None else []
    t0 = time.time()
    t_end = t0 + budget_s
    rep: dict = {"engine": "scene-ir", "aspect": aspect, "variants": []}
    ex = examples if examples is not None else retrieve_examples(description, 2)
    rep["examples"] = [e.get("topic") for e in ex]
    firsts = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"]
    pool = ThreadPoolExecutor(max_workers=max(2, n_variants))
    try:
        futs = [pool.submit(variant, description, render, narration=narration, context=context, aspect=aspect, examples=ex, log=log, idx=i,
                            model_first=firsts[i % len(firsts)], t_end=t_end) for i in range(n_variants)]
        recs = [f.result() for f in futs]
        T = {"variants_s": round(time.time() - t0, 1)}
        for r in recs:
            rep["variants"].append({k: r.get(k) for k in ("idx", "ok", "verify_rounds", "render_rounds", "error", "t_plan", "t_verify", "t_render", "score", "problems", "review", "review_unresolved")})
        good = sorted([r for r in recs if r.get("ok")], key=lambda r: -r["score"]["score"])
        if not good:
            rep["error"] = "no variant verified and rendered: " + " | ".join((r.get("error") or "?")[:200] for r in recs)
            rep["timings"] = T
            return {"ok": False, "error": rep["error"], "report": rep}
        best = good[0]
        crit = None
        if vision:
            # the critic sees the leader; when the runner-up is within a point it sees that too and the better critique wins
            crit = critique(best["res"].get("frames") or [], {"objective": description}, best["score"]["layout"], log, scene_facts(best["ir"], aspect))
            best["critique"] = crit
            low_first = isinstance(crit.get("score"), (int, float)) and crit["score"] < 6
            if len(good) > 1 and (good[1]["score"]["score"] >= best["score"]["score"] - 1.0 or low_first) and time.time() < t_end - 60:
                c2 = critique(good[1]["res"].get("frames") or [], {"objective": description}, good[1]["score"]["layout"], log, scene_facts(good[1]["ir"], aspect))
                good[1]["critique"] = c2
                if isinstance(c2.get("score"), (int, float)) and isinstance(crit.get("score"), (int, float)) and c2["score"] > crit["score"]:
                    best, crit = good[1], c2
        rep["chosen"] = best["idx"]
        rep["critique"] = crit
        T["critic_s"] = round(time.time() - t0, 1)
        # one IR revision from the critic's high/medium issues (or layout problems); kept only if it verifies and scores no worse
        issues = []
        if crit and crit.get("issues"):
            issues += [f"(frame {i.get('frame', '?')}) {i.get('problem', '')} -> {i.get('fix', '')}" for i in crit["issues"] if i.get("severity") in ("high", "medium")]
        issues += [i["problem"] for i in best["score"]["layout"] if i["severity"] == "high"][:4]
        low = crit and isinstance(crit.get("score"), (int, float)) and crit["score"] < 7
        if issues and (low or best["score"]["layout_high"]) and time.time() < t_end - 70:
            try:
                ir2 = normalize(parse_ir(chat(repair_prompt(best["ir"], issues, description, "visual"), purpose="fix", json_out=True, max_tokens=3200,
                                                temperature=0.2, log=log, timeout=75, reasoning="low", est_tokens=len(DOC) // 3.6 + 4400)))
                v2 = GW.verify_ir(ir2, aspect)
                if not v2.get("ok") and time.time() < t_end - 60:
                    ir2 = normalize(parse_ir(chat(repair_prompt(ir2, v2["problems"], description, "verify"), purpose="fix", json_out=True, max_tokens=3200,
                                                  temperature=0.2, log=log, timeout=75, reasoning="low", est_tokens=len(DOC) // 3.6 + 4400)))
                    v2 = GW.verify_ir(ir2, aspect)
                rep["revision"] = {"verified": v2.get("ok"), "problems": v2.get("problems", [])[:4]}
                if v2.get("ok"):
                    code2, probs = guard(compile_scene(ir2))
                    r2 = {"ok": False, "error": "; ".join(probs)} if probs else render(code2, "l", aspect, True, False)
                    if r2.get("ok"):
                        s2 = score_render(ir2, r2, aspect, v2)
                        rep["revision"]["score"] = s2["score"]
                        if s2["score"] >= best["score"]["score"] - 0.3 and s2["layout_high"] <= best["score"]["layout_high"]:
                            c3 = critique(r2.get("frames") or [], {"objective": description}, s2["layout"], log, scene_facts(ir2, aspect)) if vision else None
                            if not (c3 and isinstance(c3.get("score"), (int, float)) and crit and isinstance(crit.get("score"), (int, float)) and c3["score"] < crit["score"]):
                                best = {**best, "ir": ir2, "code": code2, "res": r2, "score": s2, "verify": v2, "critique": c3 or crit}
                                crit = c3 or crit
                                rep["revision"]["accepted"] = True
                                rep["critique"] = crit
                    else:
                        rep["revision"]["render_error"] = (r2.get("error") or "")[-300:]
            except Exception as exc:  # noqa: BLE001
                rep["revision"] = {"error": f"{type(exc).__name__}: {str(exc)[:200]}"}
        T["revision_s"] = round(time.time() - t0, 1)
        verdict = final_verdict(description, best["ir"], aspect)
        rep["verdict"] = verdict
        if not verdict["ok"]:
            rep["error"] = "verifier failed the final scene: " + "; ".join(verdict["failed"][:4])
            rep["timings"] = T
            return {"ok": False, "error": rep["error"], "verdict": verdict, "report": rep}
        fin = render(best["code"], "m", aspect, False, True)
        T["final_s"] = round(time.time() - t0, 1)
        rep["timings"] = T
        rep["score"] = best["score"]
        rep["verify"] = {"ok": best["verify"].get("ok"), "warnings": best["verify"].get("warnings")}
        rep["_frames"] = best["res"].get("frames") or []
        rep["ir"] = best["ir"]
        if not fin.get("ok"):
            rep["error"] = "final render failed: " + (fin.get("error") or "")[-400:]
            return {"ok": False, "error": rep["error"], "report": rep}
        rep["duration_s"] = fin.get("duration")
        cs = crit.get("score") if crit else None
        if learn and isinstance(cs, (int, float)) and cs >= 7 and best["score"]["layout_high"] == 0:
            rep["gallery"] = gallery_add(description, best["ir"], cs)
        return {"ok": True, "code": best["code"], "ir": best["ir"], "video": fin.get("video"), "pen": fin.get("pen"), "verdict": verdict, "report": rep}
    except Exception as exc:  # noqa: BLE001
        rep["error"] = f"{type(exc).__name__}: {exc}"[:600]
        return {"ok": False, "error": rep["error"], "report": rep}
    finally:
        pool.shutdown(wait=False)

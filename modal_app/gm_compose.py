"""GeniusMap visual composer: concept -> plan -> scene spec -> validated -> rendered -> gated -> (repaired).

Runs inside the Modal render container (Manim + LaTeX are there), entirely at render time, ahead of
playback: nothing here is on a learner's path. Gemini free tier only (flash-lite first).

  plan     decompose the concept: objects and quantities, how each is built from primitives, one colour per
           quantity, what changes over time, which equation terms bind to which objects, real numbers.
  compose  write the scene spec in the grammar (gm_grammar.md), cued to the narration's word timings.
  validate deterministic repairs, then a dry run that builds every object (every LaTeX snippet is compiled)
           and resolves every action; one re-ask with the exact errors if it still fails.
  render   manim -qm (720p30) with the hand's pen export and the layout report.
  gate     cheap heuristics from the layout report (off-frame, overlaps, text density, colours, duration);
           a vision critique of a few key frames only when the heuristics flag something or for a sample.
  repair   at most one re-compose + re-render; the better of the two renders ships.
"""
from __future__ import annotations

import base64
import copy
import json
import os
import random
import re
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
GRAMMAR = open(os.path.join(HERE, "gm_grammar.md")).read()
VISION_SAMPLE = float(os.environ.get("GM_VISION_SAMPLE", "0.25"))


from gm_llm import ask_json, gemini, parse_json  # noqa: E402,F401


# ───────────── Narration ─────────────
def beats(narr: dict | None) -> str:
    if not narr or not narr.get("words"):
        if narr and narr.get("text"):
            return f'Narration (no timings; ~2.6 words/s): """{narr["text"]}"""'
        return "No narration: aim for 12-20 seconds."
    words = narr["words"]
    out, cur, start = [], [], words[0]["s"]
    for i, w in enumerate(words):
        cur.append(w["w"])
        last = i == len(words) - 1
        if last or re.search(r"[,.;:!?]$", w["w"]) or w["e"] - start > 1500 or (not last and words[i + 1]["s"] - w["e"] > 180):
            out.append(f'{start / 1000:.2f}s "{" ".join(cur)}"')
            cur = []
            if not last:
                start = words[i + 1]["s"]
    return "Narration with real timings (seconds from clip start):\n" + "\n".join(out) + f"\nTotal: {narr.get('ms', words[-1]['e']) / 1000:.2f}s"


# ───────────── Prompts ─────────────
PLAN_PROMPT = """You are the visual designer of a 3Blue1Brown-style animated explanation, drawn on a light paper board.
Decompose the concept before anything is drawn. Concept / request:
\"\"\"{desc}\"\"\"
{context}
{beats}

Return JSON:
{{
 "idea": "the one visual insight the clip must make obvious",
 "quantities": [{{"id": "short id", "name": "...", "color": one of green clay navy amber plum teal rose olive (all different), "symbol": "LaTeX or null"}}],
 "params": {{"name": real number with units noted in the name}},   // real values, physically accurate
 "objects": [{{"id": "...", "what": "what it is", "build": "how it is drawn from primitives (point, line, arc, circle, ellipse, rect, polygon, path, bezier, curve, axes, plane, axes3d, graph, area, riemann, tangent, secant, surface, field, text, tex, matrix, number, brace, angle, array, trace), with sizes and positions in frame units (x -7..7, y -4..4)", "quantity": "quantity id or null"}}],
 "changes": [{{"when": "narration words", "what": "what moves / morphs / grows, driven by which tracker through which formula"}}],
 "equations": [{{"tex": "LaTeX with {{{{term}}}} groups", "terms": {{"term": "quantity id"}}, "linked_to": "object ids"}}],
 "layout": "where each group sits in the frame (e.g. device left x -6..-1, graph right x 0.5..6.5, equation top right); use the whole 16:9 frame, nothing crammed in one corner",
 "mode": "2d" or "3d" (3d only if depth is essential)
}}
For a real-world object or device, design a simplified but recognisable construction from primitives (outline shapes, repeated parts as arrays, teeth/coils/waves as curves), name its 2-4 key parts only, and make the mechanism itself move (parts rotate, slide or flow at rates from the real relationship), not just arrows beside a box.
For a process (biology, chemistry), show the actors as shapes that move and change state through the stages, not a flow chart of words.
For an abstract idea, find the picture that makes it obvious (lengths, areas, grids, number lines, rotations) and let it evolve.
Plan for 6-12 objects and 8-16 timeline actions so the clip is rich and something moves on every sentence.
Craft: one colour per quantity everywhere; objects persist and evolve (morph, trackers) rather than being replaced; minimal text; accurate scale and motion from the real numbers; each equation term coloured like its object."""

COMPOSE_PROMPT = """Write the scene spec for this plan, in the grammar below. Return ONLY the JSON spec.

Plan:
{plan}

{beats}

Timing: every action has "cue" = an exact word or 2-3 word phrase from the narration (in order) where it starts, and "dur"
(seconds) until the next idea; the clip lasts as long as the narration. Keep something moving while the voice talks.

{grammar}
"""

REPAIR_PROMPT = """This scene spec failed {why}. Fix it and return the full corrected JSON spec only.
Problems:
{problems}

Spec:
{spec}

Grammar reminder (follow it exactly):
{grammar}
"""

CRITIC_PROMPT = """You are a strict reviewer of key frames (in time order, left to right, top to bottom) of a 3Blue1Brown-style educational animation drawn on a light board.
Intended idea: {idea}
Quantities and their colours: {quantities}
Planned objects: {objects}
Planned changes: {changes}
Planned equations: {equations}
A planned key element (object, equation or change) that never appears in any frame is a defect.
Check only for real defects a learner would notice: text or labels overlapping each other or a drawing so they cannot be read;
things cut off by the frame edge; an empty or nearly empty frame where the idea should be visible; unreadable/tiny text;
raw LaTeX code shown as text; a quantity drawn in two different colours; a drawing that does not resemble what it should be.
Return JSON: {{"pass": true|false, "score": 1-10 for clarity, completeness and beauty, "issues": ["specific defect and which object / where"], "fixes": ["concrete spec change"]}}
pass is true only if score >= 7 and there is no defect above."""


# ───────────── Deterministic repairs ─────────────
QC = ["green", "clay", "navy", "amber", "plum", "teal", "rose", "olive"]
NEUTRALS = {"ink", "muted", "rule"}
OBJ_KINDS = {"dot", "point", "line", "arrow", "vector", "arc", "circle", "ellipse", "rect", "polygon", "path", "bezier", "curve", "axes", "plane", "axes3d",
             "graph", "area", "riemann", "tangent", "secant", "surface", "field", "text", "tex", "matrix", "number", "brace", "angle", "array", "group", "trace"}
ACTIONS = {"show", "hide", "set", "morph", "match_tex", "move", "rotate", "scale", "follow", "matrix", "warp", "camera", "indicate", "circle", "link", "color", "drift", "wait"}
ALIASES = {"square": "rect", "rectangle": "rect", "box": "rect", "label": "text", "math": "tex", "equation": "tex", "latex": "tex", "segment": "line",
           "point": "dot", "parametric": "curve", "function": "graph", "plot": "graph", "particles": "array", "copies": "array", "numberplane": "plane",
           "triangle": "polygon", "spline": "path", "vectorfield": "field", "vector_field": "field", "streamlines": "field", "decimal": "number", "readout": "number"}
DO_ALIASES = {"create": "show", "draw": "show", "write": "show", "fade_in": "show", "fadein": "show", "grow": "show", "fade_out": "hide", "fadeout": "hide",
              "remove": "hide", "animate": "set", "transform": "morph", "replace": "morph", "transform_matching_tex": "match_tex", "shift": "move",
              "move_to": "move", "move_along": "follow", "move_along_path": "follow", "apply_matrix": "matrix", "apply_function": "warp", "highlight": "indicate",
              "flash": "indicate", "circumscribe": "circle", "recolor": "color", "pause": "wait"}


def _has_latex(s: str) -> bool:
    return bool(re.search(r"\\[a-zA-Z]+|[\^_]\{|\$", s))


def normalize(spec, notes: list[str]) -> dict:
    while isinstance(spec, list) and spec:
        spec = next((x for x in spec if isinstance(x, dict) and x.get("objects")), spec[0])
    if isinstance(spec, dict) and "objects" not in spec:
        inner = next((v for v in spec.values() if isinstance(v, dict) and "objects" in v), None)
        if inner:
            spec = inner
    if not isinstance(spec, dict):
        raise RuntimeError("model returned no scene spec")
    s = copy.deepcopy(spec)
    s.setdefault("objects", [])
    s.setdefault("timeline", [])
    # quantities: valid, distinct colours
    used = set()
    qs = []
    for q in s.get("quantities") or []:
        if not isinstance(q, dict) or not q.get("id"):
            continue
        c = str(q.get("color", "")).lower()
        if c not in QC or c in used:
            free = [x for x in QC if x not in used]
            if not free:
                notes.append(f"dropped quantity {q['id']} (more than 8 colours)")
                continue
            notes.append(f"quantity {q['id']}: colour {c or 'none'} -> {free[0]}")
            c = free[0]
        used.add(c)
        qs.append({**q, "color": c})
    s["quantities"] = qs
    qids = {q["id"] for q in qs}
    # trackers as dicts
    s["trackers"] = [t if isinstance(t, dict) else {"id": str(t), "value": 0} for t in s.get("trackers") or []]
    tids = {t["id"] for t in s["trackers"]}
    # objects
    objs, ids = [], set()
    for o in s["objects"]:
        if not isinstance(o, dict) or not o.get("id"):
            continue
        k = str(o.get("kind", "")).lower()
        k = ALIASES.get(k, k)
        if k not in OBJ_KINDS:
            notes.append(f"dropped object {o['id']} (unknown kind {o.get('kind')})")
            continue
        o = {**o, "kind": k, "id": str(o["id"])}
        if o["id"] in ids:
            notes.append(f"renamed duplicate id {o['id']}")
            o["id"] = o["id"] + "_2"
        if o.get("q") and o["q"] not in qids:
            notes.append(f"{o['id']}: unknown quantity {o['q']} removed")
            o.pop("q")
        col = o.get("color")
        if col is not None and col not in NEUTRALS:
            # a quantity colour without q: bind it to that quantity if one has it, else ink
            match = next((q["id"] for q in qs if q["color"] == col), None)
            if match and not o.get("q"):
                o["q"] = match
            notes.append(f"{o['id']}: colour {col} -> {'q=' + match if match else 'ink'}")
            o.pop("color")
        if k == "text" and _has_latex(str(o.get("text", ""))):
            notes.append(f"{o['id']}: text with LaTeX -> tex")
            o["kind"] = "tex"
            t = str(o.pop("text"))
            o["tex"] = t.strip("$") if t.count("$") >= 2 and t.strip().startswith("$") and t.strip().endswith("$") else (re.sub(r"\$([^$]*)\$", r"\1", t) if "$" in t else t)
            if "$" in str(t) and not (t.strip().startswith("$") and t.strip().endswith("$")):
                # mixed words + maths: wrap words in \text{}
                o["tex"] = _mixed_to_tex(t)
        if o["kind"] == "tex":
            o["tex"] = str(o.get("tex", "")).strip().strip("$")
            terms = o.get("terms") or {}
            if isinstance(terms, list):
                terms = {str(x.get("tex", x.get("term", ""))): x.get("q") for x in terms if isinstance(x, dict)}
            fixed = {}
            for term, q in terms.items():
                if q not in qids:
                    notes.append(f"{o['id']}: term {term} unknown quantity dropped")
                    continue
                if "{{" + term + "}}" not in o["tex"]:
                    if term in o["tex"] and o["tex"].count(term) == 1 and "{{" not in term:
                        o["tex"] = o["tex"].replace(term, "{{" + term + "}}")
                        notes.append(f"{o['id']}: wrapped term {term} in {{{{}}}}")
                    else:
                        notes.append(f"{o['id']}: term {term} not isolated; dropped")
                        continue
                fixed[term] = q
            o["terms"] = fixed
        if o["kind"] == "text":
            o["text"] = str(o.get("text", ""))[:80]
        ids.add(o["id"])
        objs.append(o)
    s["objects"] = objs
    # actions
    acts = []
    for a in _flatten_actions(s["timeline"], notes):
        do = str(a.get("do", "")).lower()
        do = DO_ALIASES.get(do, do)
        if do not in ACTIONS:
            notes.append(f"dropped action {a.get('do')}")
            continue
        a = {**a, "do": do}
        if "target" in a and "targets" not in a:
            a["targets"] = a.pop("target")
        if isinstance(a.get("targets"), str):
            a["targets"] = [a["targets"]]
        if a.get("targets"):
            keep = [t for t in a["targets"] if t in ids]
            if len(keep) != len(a["targets"]):
                notes.append(f"{do}: unknown targets {set(a['targets']) - ids} dropped")
            if not keep and do not in ("wait", "camera"):
                continue
            a["targets"] = keep
        if do in ("morph", "match_tex") and (a.get("from") not in ids or a.get("to") not in ids):
            notes.append(f"dropped {do} with unknown from/to")
            continue
        if do == "set":
            vals = a.get("values") or ({a["tracker"]: a.get("to", a.get("value"))} if "tracker" in a else {})
            vals = {k: v for k, v in vals.items() if k in tids and v is not None}
            if not vals:
                notes.append("dropped set with unknown tracker")
                continue
            a["values"] = vals
        if do == "link":
            if a.get("eq") not in ids or a.get("target") not in ids and not (a.get("targets") or []):
                notes.append("dropped link with unknown eq/target")
                continue
            if "target" not in a and a.get("targets"):
                a["target"] = a["targets"][0]
        if do == "color" and a.get("q") not in qids:
            notes.append("dropped color with unknown quantity")
            continue
        try:
            a["dur"] = max(0.2, min(12.0, float(a.get("dur", 1.0))))
        except (TypeError, ValueError):
            a["dur"] = 1.0
        acts.append(a)
    s["timeline"] = acts
    # objects that are morph/match targets must not be shown first; objects never shown are fine (unused)
    return s


def _flatten_actions(timeline, notes: list[str]) -> list[dict]:
    """Accept the shapes models drift into: {"show": [ids]}, {"set": {...}}, {"show": {"targets": [...]}}, lists of those."""
    out = []
    keys = ACTIONS | set(DO_ALIASES)
    for a in timeline if isinstance(timeline, list) else []:
        if isinstance(a, list):
            out += _flatten_actions(a, notes)
            continue
        if not isinstance(a, dict):
            continue
        if "do" in a or "action" in a or "type" in a:
            a = dict(a)
            a["do"] = a.get("do") or a.pop("action", None) or a.pop("type", None)
            out.append(a)
            continue
        found = [k for k in a if str(k).lower() in keys]
        if not found:
            continue
        rest = {k: v for k, v in a.items() if k not in found}
        for k in found:
            v = a[k]
            act = {**rest, "do": str(k).lower()}
            if isinstance(v, dict):
                if str(k).lower() in ("set", "animate"):
                    act["values"] = v.get("values", v)
                else:
                    act.update(v)
            elif isinstance(v, list):
                act["targets"] = v
            elif isinstance(v, str):
                act["targets"] = [v]
            out.append(act)
        notes.append(f"reshaped action {list(a)[:3]}")
    return out


def _mixed_to_tex(t: str) -> str:
    out = []
    for i, part in enumerate(re.split(r"\$", t)):
        if not part:
            continue
        out.append(part if i % 2 else "\\text{" + part.replace("{", "").replace("}", "") + "}")
    return "".join(out)


# ───────────── Validation (dry run: compiles every LaTeX snippet, evaluates every expression) ─────────────
def validate(spec: dict, media_dir: str) -> list[str]:
    errors = []
    os.makedirs(os.path.join(media_dir, "Tex"), exist_ok=True)
    os.makedirs(os.path.join(media_dir, "texts"), exist_ok=True)
    try:
        import gm_scene
        from manim import tempconfig

        spec2 = copy.deepcopy(spec)
        # every expression must parse and evaluate at the start and at each tracker's targets
        for o in spec2.get("objects", []):
            for key, v in o.items():
                if key in ("fn",) and isinstance(v, str):
                    try:
                        gm_scene._compile(v)
                    except Exception as exc:  # noqa: BLE001
                        errors.append(f"object {o['id']} fn: {exc}")
        with tempconfig({"dry_run": True, "disable_caching": True, "media_dir": media_dir, "write_to_movie": False, "quality": "low_quality", "verbosity": "ERROR", "progress_bar": "none"}):
            Cls = gm_scene.build(spec2)
            sc = Cls()
            sc.render()
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        if "latex error" in msg.lower() or "LaTeX" in msg:
            bad = _latex_culprit(spec, media_dir)
            msg = f"LaTeX failed to compile{(': ' + bad) if bad else ''}"
        errors.append(f"{type(exc).__name__}: {msg[:600]}")
    return errors


def _latex_culprit(spec: dict, media_dir: str) -> str | None:
    from manim import MathTex, tempconfig
    import gm_scene

    os.makedirs(os.path.join(media_dir, "Tex"), exist_ok=True)
    with tempconfig({"media_dir": media_dir, "verbosity": "CRITICAL"}):
        for o in spec.get("objects", []):
            snippets = []
            if o.get("kind") == "tex":
                snippets = gm_scene.split_terms(o.get("tex", ""))
            elif o.get("kind") == "matrix":
                snippets = [str(c) for r in o.get("rows", []) for c in r]
            for key in ("label", "prefix", "suffix"):
                if o.get(key):
                    snippets.append(str(o[key]))
            if o.get("kind") == "axes":
                snippets += [str(x) for x in o.get("labels") or []]
            for sn in snippets:
                if not sn.strip():
                    continue
                try:
                    MathTex(sn)
                except Exception:  # noqa: BLE001
                    return f"object {o.get('id')}: {sn!r}"
    return None


def fix_latex(spec: dict, media_dir: str, notes: list[str], allow_remove: bool = False) -> bool:
    """Deterministic LaTeX repair for the culprit snippet: common slips, else remove the object."""
    bad = _latex_culprit(spec, media_dir)
    if not bad:
        return False
    oid = bad.split(":")[0].replace("object ", "")
    for o in spec["objects"]:
        if o["id"] != oid:
            continue
        for key in ("tex", "label", "prefix", "suffix"):
            if isinstance(o.get(key), str):
                t = o[key]
                t2 = t.replace("\\\\(", "").replace("\\\\)", "").replace("$", "")
                t2 = re.sub(r"\\text\{([^}]*)\\\}", r"\\text{\1}", t2)
                t2 = t2.replace("\\deg", "^\\circ").replace("°", "^\\circ").replace("μ", "\\mu ").replace("Ω", "\\Omega ").replace("π", "\\pi ").replace("θ", "\\theta ").replace("·", "\\cdot ").replace("×", "\\times ").replace("−", "-")
                opens, closes = t2.count("{"), t2.count("}")
                if opens > closes:
                    t2 += "}" * (opens - closes)
                o[key] = t2
        notes.append(f"latex repair on {oid}")
        if allow_remove and _latex_culprit({"objects": [o]}, media_dir):
            spec["objects"] = [x for x in spec["objects"] if x["id"] != oid]
            spec["timeline"] = [a for a in spec["timeline"] if oid not in (a.get("targets") or []) and oid not in (a.get("from"), a.get("to"), a.get("eq"), a.get("target"))]
            notes.append(f"removed {oid}: LaTeX did not compile")
        return not _latex_culprit({"objects": [o]}, media_dir) or allow_remove
    return False


# ───────────── Render + gate ─────────────
def scene_code(spec: dict) -> str:
    return ("from manim import *\nfrom gm_scene import build\n\nSPEC = r'''" + json.dumps(spec, separators=(",", ":")).replace("'''", "") +
            "'''\n\n\nclass GeneratedScene(build(SPEC)):\n    pass\n")


PEN_TAIL = "\n\nimport sys as _pen_sys\n_pen_sys.path.insert(0, '/root')\ntry:\n    import pen_export  # noqa: F401,E402\nexcept Exception as _pen_err:  # noqa: BLE001\n    print('pen_export unavailable:', _pen_err)\n"


def render_spec(spec: dict, workdir: str, quality="-qm") -> dict:
    os.makedirs(workdir, exist_ok=True)
    src = os.path.join(workdir, "scene.py")
    with open(src, "w") as f:
        f.write(scene_code(spec) + PEN_TAIL)
    env = {**os.environ, "PYTHONPATH": HERE + os.pathsep + os.environ.get("PYTHONPATH", ""), "GM_GATE_PATH": os.path.join(workdir, "gate.json"), "PEN_EXPORT_PATH": os.path.join(workdir, "pen.json")}
    t0 = time.time()
    p = subprocess.run([sys.executable, "-m", "manim", quality, "--format", "mp4", "--media_dir", os.path.join(workdir, "media"), "--disable_caching", "--progress_bar", "none", src, "GeneratedScene"],
                       cwd=workdir, env=env, capture_output=True, text=True, timeout=480)
    out = {"render_s": round(time.time() - t0, 1), "ok": p.returncode == 0}
    if p.returncode:
        out["error"] = ((p.stdout or "")[-1500:] + "\n" + (p.stderr or "")[-2500:]).strip()
        return out
    vids = [os.path.join(r, f) for r, _, fs in os.walk(os.path.join(workdir, "media", "videos")) for f in fs if f.endswith(".mp4") and "partial" not in r]
    out["video"] = vids[0]
    gp = os.path.join(workdir, "gate.json")
    out["gate"] = json.load(open(gp)) if os.path.exists(gp) else {"frames": [], "checks": []}
    out["pen"] = os.path.join(workdir, "pen.json") if os.path.exists(os.path.join(workdir, "pen.json")) else None
    return out


def keyframes(video: str, gate: dict, workdir: str, n=4) -> bytes | None:
    """A 2x2 (or 3x2) JPEG sheet of a few key frames: the ends of evenly spaced action groups."""
    ts = [max(0.0, f["t"] - 0.05) for f in gate.get("frames", [])]
    if not ts:
        return None
    if len(ts) > n:
        ts = [ts[round(i * (len(ts) - 1) / (n - 1))] for i in range(n)]
    files = []
    for i, t in enumerate(ts):
        fp = os.path.join(workdir, f"k{i}.jpg")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", video, "-frames:v", "1", "-vf", "scale=640:-1", "-q:v", "4", fp])
        if os.path.exists(fp):
            files.append(fp)
    if not files:
        return None
    sheet = os.path.join(workdir, "sheet.jpg")
    if len(files) == 1:
        return open(files[0], "rb").read()
    cols = 2
    layout = "|".join(f"{(i % cols) * 640}_{(i // cols) * 360}" for i in range(len(files)))
    args = ["ffmpeg", "-y", "-loglevel", "error"]
    for f in files:
        args += ["-i", f]
    args += ["-filter_complex", "".join(f"[{i}:v]" for i in range(len(files))) + f"xstack=inputs={len(files)}:layout={layout}:fill=white", "-q:v", "4", sheet]
    subprocess.run(args)
    return open(sheet, "rb").read() if os.path.exists(sheet) else None


def heuristics(r: dict, spec: dict) -> list[str]:
    issues = []
    g = r.get("gate") or {}
    for c in g.get("checks") or []:
        t = c["type"]
        if t == "off_frame":
            issues.append(f"'{c['id']}' goes {c['by']} units outside the frame at {c['t']}s; move or shrink it")
        elif t == "text_overlap":
            issues.append(f"labels {c['ids'][0]} and {c['ids'][1]} overlap at {c['t']}s; separate them")
        elif t == "text_on_shape":
            issues.append(f"text {c['ids'][0]} sits on the filled shape {c['ids'][1]} at {c['t']}s")
        elif t == "text_density":
            issues.append(f"{c['words']} words of text on screen at {c['t']}s; cut text, show it instead")
        elif t == "unused_quantity":
            issues.append(f"quantity {c['id']} is declared but never drawn")
    narr = spec.get("narration") or {}
    if narr.get("ms") and g.get("duration"):
        d = g["duration"] - narr["ms"] / 1000
        if abs(d) > 1.5:
            issues.append(f"clip lasts {g['duration']:.1f}s but narration {narr['ms'] / 1000:.1f}s")
    frames = g.get("frames") or []
    if frames and sum(1 for f in frames if len(f.get("items", [])) <= 1) > len(frames) / 2:
        issues.append("most key frames are nearly empty; show the idea, keep objects on screen")
    shown = {t for a in spec.get("timeline", []) if a.get("do") == "show" for t in a.get("targets", [])}
    if len(shown) < 2:
        issues.append("fewer than two objects are ever shown")
    return issues


def plan_gaps(plan: dict, spec: dict) -> list[str]:
    """Planned equations that never reach the screen (a frequent loss when LaTeX had to be repaired)."""
    out = []
    kinds = {o["id"]: o["kind"] for o in spec.get("objects", [])}
    shown = {t for a in spec.get("timeline", []) if a.get("do") in ("show", "morph", "match_tex") for t in (a.get("targets") or []) + [a.get("to")] if t}
    if plan.get("equations") and not any(kinds.get(t) == "tex" for t in shown):
        out.append("the planned equation never appears; add it as a tex object with its terms and show it")
    return out


def critique(sheet: bytes, plan: dict, log: list) -> dict:
    qs = ", ".join(f"{q.get('name', q.get('id'))}={q.get('color')}" for q in plan.get("quantities", []))
    try:
        objs = "; ".join(f"{o.get('id')}: {o.get('what', '')}" for o in plan.get("objects", []))[:900]
        chg = "; ".join(f"{c.get('when', '')}: {c.get('what', '')}" for c in plan.get("changes", []))[:900]
        eqs = "; ".join(str(e.get("tex", "")) for e in plan.get("equations", []))[:400] or "none"
        out = ask_json(CRITIC_PROMPT.format(idea=plan.get("idea", ""), quantities=qs, objects=objs, changes=chg, equations=eqs), images=[sheet], temperature=0.2, timeout=45, log=log)
        if isinstance(out, dict) and out.get("score") is not None and float(out.get("score", 10)) < 7:
            out["pass"] = False
        return out
    except Exception as exc:  # noqa: BLE001
        log.append(f"critique skipped: {exc}")
        return {"pass": True, "skipped": True}


# ───────────── Pipeline ─────────────
LAST: dict = {}  # the latest plan / spec (diagnostics when a run fails)


def make_spec(desc: str, narr: dict | None, context: str, media_dir: str, log: list, plan: dict | None = None) -> tuple[dict, dict]:
    b = beats(narr)
    if plan is None:
        plan = ask_json(PLAN_PROMPT.format(desc=desc[:2500], context=context[:1500], beats=b), temperature=0.5, log=log)
    LAST["plan"] = plan
    raw = ask_json(COMPOSE_PROMPT.format(plan=json.dumps(plan)[:6000], beats=b, grammar=GRAMMAR), temperature=0.3, timeout=90, log=log)
    LAST["raw"] = raw
    spec = prepare(raw, narr, media_dir, log, plan)
    return plan, spec


def prepare(raw: dict, narr: dict | None, media_dir: str, log: list, plan: dict | None = None) -> dict:
    """Normalize, then validate with a dry run (every LaTeX snippet compiled, every expression evaluated).
    LaTeX slips are repaired deterministically; anything left goes back to the model once with the exact errors;
    only after that may a still-broken LaTeX object be dropped. Raw backslash commands never reach a Text object."""
    notes: list[str] = []

    def norm(r):
        sp = normalize(r, notes)
        if narr:
            sp["narration"] = {"ms": narr.get("ms"), "words": narr.get("words")}
        return sp

    def check(sp, allow_remove):
        errs = validate(sp, media_dir)
        for _ in range(4):
            if not (errs and any("LaTeX" in e for e in errs)):
                break
            if not fix_latex(sp, media_dir, notes, allow_remove=allow_remove):
                break
            errs = validate(sp, media_dir)
        return errs

    spec = norm(raw)
    errs = check(spec, False)
    if errs:
        log.append("validate: " + " | ".join(errs)[:400])
        raw2 = ask_json(REPAIR_PROMPT.format(why="validation before rendering", problems="\n".join(errs), spec=json.dumps({k: v for k, v in spec.items() if k != "narration"})[:14000], grammar=GRAMMAR), temperature=0.2, timeout=90, log=log)
        spec = norm(raw2)
        errs = check(spec, True)
        if errs:
            raise RuntimeError("spec invalid after repair: " + " | ".join(errs)[:800])
    if notes:
        log.append("normalize: " + "; ".join(notes)[:600])
    return spec


def compose_and_render(desc: str, narr: dict | None = None, context: str = "", workdir: str | None = None, vision: str = "auto", log: list | None = None) -> dict:
    """Returns {ok, spec, video, pen, gate, issues, critique, timings, log}. Never more than 2 renders."""
    log = [] if log is None else log
    workdir = workdir or tempfile.mkdtemp(prefix="gm-")
    media = os.path.join(workdir, "media-validate")
    t0 = time.time()
    timings = {}
    plan, spec = make_spec(desc, narr, context, media, log)
    timings["compose_s"] = round(time.time() - t0, 1)
    best = None
    for attempt in range(2):
        t1 = time.time()
        r = render_spec(spec, os.path.join(workdir, f"r{attempt}"))
        timings[f"render{attempt}_s"] = r["render_s"]
        if not r["ok"]:
            log.append(f"render {attempt} failed: {r['error'][-300:]}")
            if attempt == 0:
                raw = ask_json(REPAIR_PROMPT.format(why="to render", problems=r["error"][-2500:], spec=json.dumps({k: v for k, v in spec.items() if k != "narration"})[:14000], grammar=GRAMMAR), temperature=0.2, timeout=90, log=log)
                spec = prepare(raw, narr, media, log, plan)
                continue
            break
        t2 = time.time()
        issues = heuristics(r, spec) + plan_gaps(plan, spec)
        crit = None
        if vision == "always" or (vision == "auto" and (issues or random.random() < VISION_SAMPLE)):
            sheet = keyframes(r["video"], r["gate"], os.path.join(workdir, f"r{attempt}"))
            if sheet:
                crit = critique(sheet, plan, log)
                if crit and not crit.get("pass", True):
                    issues += [f"vision: {x}" for x in crit.get("issues", [])][:6]
        timings[f"gate{attempt}_s"] = round(time.time() - t2, 1)
        cand = {"spec": spec, "video": r["video"], "pen": r.get("pen"), "gate": r["gate"], "issues": issues, "critique": crit, "attempt": attempt}
        if best is None or len(issues) < len(best["issues"]):
            best = cand
        if not issues or attempt == 1:
            break
        # one repair round with the gate's findings
        try:
            fixes = (crit or {}).get("fixes") or []
            raw = ask_json(REPAIR_PROMPT.format(why="the quality check after rendering", problems="\n".join(issues + [f"suggested: {f}" for f in fixes]), spec=json.dumps({k: v for k, v in spec.items() if k != "narration"})[:14000], grammar=GRAMMAR), temperature=0.2, timeout=90, log=log)
            spec = prepare(raw, narr, media, log, plan)
        except Exception as exc:  # noqa: BLE001
            log.append(f"repair skipped: {exc}")
            break
    timings["total_s"] = round(time.time() - t0, 1)
    if best is None:
        return {"ok": False, "plan": plan, "spec": spec, "timings": timings, "log": log}
    return {"ok": True, "plan": plan, **best, "timings": timings, "log": log}

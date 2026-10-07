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
Before anything is drawn, work out what physically exists and how it works. Concept / request:
\"\"\"{desc}\"\"\"
{context}
{beats}

Return JSON:
{{
 "idea": "the one visual insight the clip must make obvious",
 "structure": [   // REQUIRED for every real object the clip draws (an enzyme, a differential, a heart, a transistor, a cell...)
   {{"object": "name",
     "reference": "the real reference features a viewer recognises it by: silhouette, landmarks, proportions, real colours",
     "parts": [{{"name": "real part name", "shape": "its true shape (e.g. bevel gear with 10 teeth seen edge-on; folded protein with a cleft)",
                "size": "size relative to the others (real proportions/counts)", "connects": "what it meshes / bonds / attaches to and where",
                "position": "where it sits relative to the other parts"}}],
     "states": ["state 1 (e.g. enzyme open, substrate free)", "state 2 ...", "..."],
     "transitions": [{{"from": "state", "to": "state", "cause": "what physically causes the change", "visible_as": "what moves / reshapes / recolours on screen"}}],
     "linked_quantities": ["quantity ids whose values follow these states (e.g. reaction progress drives the dot on the energy curve)"],
     "render": "primitives" or "svg" (svg only when fine real-life detail matters and you can write a clean SVG with an id per part) or "3d" (only if depth is essential)}}
 ],
 "quantities": [{{"id": "short id", "name": "...", "color": one of green clay navy amber plum teal rose olive (all different), "symbol": "LaTeX or null"}}],
 "params": {{"name": real number with units noted in the name}},   // real values, physically accurate
 "objects": [{{"id": "...", "what": "what it is (a part from structure, or a graph / equation / readout)", "build": "how it is drawn from primitives (dot, line, arrow, arc, circle, ellipse, rect, polygon, path smooth, bezier, curve, gear (tooth generator), axes, plane, graph, area, riemann, tangent, secant, field, text, tex, matrix, number, brace, angle, array, group, svg), with sizes in frame units", "quantity": "quantity id or null", "material": "steel/brass/protein/tissue/... for a non-quantity body, or null", "region": "left|right|center|top|bottom"}}],
 "changes": [{{"when": "narration words", "what": "what moves / morphs / grows, driven by which tracker through which formula"}}],
 "motion_per_sentence": ["for EACH narration sentence in order: the continuous change on screen during it (a tracker drive, morph, follow, drift, spin)"],
 "equations": [{{"tex": "LaTeX with {{{{term}}}} groups", "terms": {{"term": "quantity id"}}, "linked_to": "object ids"}}],
 "mode": "2d" or "3d"
}}
Regions (the layout engine gives each its own zone, so regions never overlap): "left" = the stage where the real object
or mechanism lives, "right" = graph / diagram / readouts, "center" = a single main picture, "top" = the equation band,
"bottom" = a short caption. Use 2-3 regions; the real object gets the biggest one. Every object belongs to one region.
Structure first: build each part from its true shape (gear teeth as a gear with the real count, a protein as an irregular
smooth closed path with a pocket complementary to the substrate, a molecule as atoms (dots) + bonds (lines), organs from
bezier outlines with their landmarks). Never a placeholder box or a plain circle for something that has a shape.
Mechanism: the states and the causal transitions must be animated in order (approach, bind, deform, change, release...),
with a tracker for the progress that also drives the linked quantity (e.g. the dot on an energy curve).
Contact is geometry: a part that binds, meshes or sits in another is placed at the contact point computed from the other's
shape (the pocket's centre, pitch circles tangent), and moves there along a path, it never just overlaps a body.
Distinct bodies that touch never share a colour: a body a quantity tracks (the substrate, the current, the oil pressure)
takes that quantity's colour, the same colour as its curve / term; other bodies take a real material.
Plan 8-16 objects and 12-20 timeline actions; something moves continuously in every sentence. Minimal text, but name
the 2-4 key parts with short labels."""

COMPOSE_PROMPT = """Write the scene spec for this plan, in the grammar below. Return ONLY the JSON spec.

Plan:
{plan}

{beats}

Zones (frame units) for the regions this plan uses; give every object "region" and keep its coordinates inside its zone:
{zones}

Timing: every action has "cue" = an exact word or 2-3 word phrase from the narration (in order) where it starts, and "dur"
(seconds) until the next idea; the clip lasts as long as the narration. Every sentence needs a continuous change
(set / speed / follow / drift / morph / match_tex / rotate) and every mechanism part that moves in reality must move here
(steady trackers with "rate" for things that keep turning or flowing; "jiggle" for molecules).
Build every structural part from the plan as its own object (so it can be highlighted and animated) and group them.
Labels: "next_to" their owner, short, never on top of another shape.

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
Real objects and how they work (structure plan): {structure}
Real numbers (check drawn proportions against them, e.g. an area 10x larger must LOOK 10x larger): {params}
Quantities and their colours: {quantities}
Planned changes: {changes}
Planned equations: {equations}
Scene objects you may reference in ops (id kind region): {ids}
Score each axis 1-10, harshly and honestly (7 = acceptable, 9 = a viewer instantly recognises the real thing):
 Be harsh: a reviewer who gives 8 to a picture with a wrong proportion, a part that does not move when the narration says it
 does, or two bodies drawn as the same plain shape is wrong. Compare consecutive frames: if a state change is narrated but
 the frames look the same, mechanism and motion are <= 4.
 structure: does each real object look like the real thing (silhouette, the right parts, counts and proportions, parts connected / meshed correctly)? Blobs, plain circles or boxes standing in for a shaped object score <= 4.
 mechanism: are the states and causal transitions shown in the right order and physically right (gears turn at the ratio, molecules bind then change...)?
 layout: nothing overlapping or cut off, labels beside (not on) what they name, the frame used and balanced.
 motion: frames show the scene evolving (positions/shapes differ between frames), not a static picture.
 tex: maths typeset correctly (no raw code, no broken subscripts like v_o uter), colours match quantities.
Return JSON: {{"scores": {{"structure": n, "mechanism": n, "layout": n, "motion": n, "tex": n}}, "score": overall 1-10,
 "issues": ["specific defect, which object, which frame"],
 "ops": [concrete deterministic fixes using the ids above, any of:
   {{"op": "move", "id": "...", "by": [dx, dy]}}, {{"op": "resize", "id": "...", "factor": 0.8}},
   {{"op": "region", "id": "...", "region": "left|right|center|top|bottom"}}, {{"op": "recolor", "id": "...", "q": "quantity id"}},
   {{"op": "add_motion", "id": "...", "motion": "spin|jiggle", "rate": deg_per_s_or_amplitude}}, {{"op": "drop", "id": "..."}}],
 "rebuild": ["object or part that must be redrawn by the composer because it does not look like the real thing / the mechanism is wrong"]}}"""


# ───────────── Deterministic repairs ─────────────
QC = ["green", "clay", "navy", "amber", "plum", "teal", "rose", "olive"]
NEUTRALS = {"ink", "muted", "rule", "steel", "brass", "copper", "rubber", "tissue", "protein", "membrane", "blood", "bone", "water", "wood", "silicon", "leaf", "glass", "plastic", "skin"}
OBJ_KINDS = {"dot", "point", "line", "arrow", "vector", "arc", "circle", "ellipse", "rect", "polygon", "path", "bezier", "curve", "axes", "plane", "axes3d",
             "graph", "area", "riemann", "tangent", "secant", "surface", "field", "text", "tex", "matrix", "number", "brace", "angle", "array", "group", "trace",
             "gear", "svg", "cylinder", "prism", "sphere", "cone", "torus"}
ACTIONS = {"speed", "show", "hide", "set", "morph", "match_tex", "move", "rotate", "scale", "follow", "matrix", "warp", "camera", "indicate", "circle", "link", "color", "drift", "wait"}
ALIASES = {"square": "rect", "rectangle": "rect", "box": "rect", "label": "text", "math": "tex", "equation": "tex", "latex": "tex", "segment": "line",
           "point": "dot", "parametric": "curve", "function": "graph", "plot": "graph", "particles": "array", "copies": "array", "numberplane": "plane",
           "triangle": "polygon", "spline": "path", "cog": "gear", "gearwheel": "gear", "image": "svg", "box3d": "prism", "cube": "prism", "vectorfield": "field", "vector_field": "field", "streamlines": "field", "decimal": "number", "readout": "number"}
DO_ALIASES = {"create": "show", "draw": "show", "write": "show", "fade_in": "show", "fadein": "show", "grow": "show", "fade_out": "hide", "fadeout": "hide",
              "remove": "hide", "animate": "set", "transform": "morph", "replace": "morph", "transform_matching_tex": "match_tex", "shift": "move",
              "move_to": "move", "move_along": "follow", "move_along_path": "follow", "apply_matrix": "matrix", "apply_function": "warp", "highlight": "indicate",
              "flash": "indicate", "circumscribe": "circle", "recolor": "color", "pause": "wait"}


def _has_latex(s: str) -> bool:
    return bool(re.search(r"\\[a-zA-Z]+|[\^_]\{|\$|[A-Za-z0-9][_^][A-Za-z0-9]", s))


_TEXT_CMDS = ("\\text", "\\mathrm", "\\textbf", "\\mathbf", "\\operatorname", "\\mbox", "\\textit", "\\mathit")


def tex_hygiene(t: str) -> str:
    """Deterministic LaTeX clean-up: multi-character sub/superscripts get braces (v_outer -> v_{\\text{outer}},
    x_ij -> x_{ij}, e^-x -> e^{-x}, 10^23 -> 10^{23}); bare words (4+ letters) in maths become \\text{...}."""
    if not isinstance(t, str) or not t:
        return t
    t = t.replace("\u2212", "-").replace("\u00b7", "\\cdot ").replace("\u00d7", "\\times ").replace("\u00b0", "^\\circ").replace("\u0394", "\\Delta ")
    # sub/superscripts without braces
    def sub(m):
        op, body = m.group(1), m.group(2)
        if body.isalpha() and len(body) >= 3:
            return f"{op}{{\\text{{{body}}}}}"
        return f"{op}{{{body}}}"
    t = re.sub(r"(?<!\\)([_^])(-?[A-Za-z]{2,}|-?[0-9]{2,}|-[A-Za-z0-9])(?![A-Za-z0-9{])", sub, t)
    # bare words -> \text{}; skip commands and the arguments of text-like commands
    out, i, n = [], 0, len(t)
    while i < n:
        if t[i] == "\\":
            m = re.match(r"\\[A-Za-z]+", t[i:])
            if m:
                cmd = m.group(0)
                out.append(cmd)
                i += len(cmd)
                if cmd in _TEXT_CMDS and i < n and t[i] == "{":
                    depth, j = 0, i
                    while j < n:
                        depth += t[j] == "{"
                        depth -= t[j] == "}"
                        j += 1
                        if depth == 0:
                            break
                    out.append(t[i:j])
                    i = j
                continue
            out.append(t[i : i + 2])
            i += 2
            continue
        m = re.match(r"[A-Za-z]+(?:\s+[A-Za-z]+)*", t[i:])
        if m and (i == 0 or t[i - 1] not in "_^"):
            run = m.group(0)
            words = run.split()
            if any(len(w) >= 4 for w in words):
                if all(len(w) >= 2 for w in words):
                    out.append("\\text{" + run + "}")
                else:
                    out.append(" ".join("\\text{" + w + "}" if len(w) >= 4 else w for w in words))
                i += len(run)
                continue
            out.append(run)
            i += len(run)
            continue
        out.append(t[i])
        i += 1
    return "".join(out)


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
        for key in ("label", "prefix", "suffix"):
            if isinstance(o.get(key), str):
                h = tex_hygiene(o[key])
                if h != o[key]:
                    notes.append(f"{o['id']}: {key} tex hygiene")
                    o[key] = h
        if o["kind"] == "axes" and isinstance(o.get("labels"), list):
            o["labels"] = [tex_hygiene(str(x)) for x in o["labels"]]
        if o["kind"] == "matrix" and isinstance(o.get("rows"), list):
            o["rows"] = [[tex_hygiene(c) if isinstance(c, str) else c for c in r] for r in o["rows"] if isinstance(r, list)]
        if o["kind"] == "tex":
            o["tex"] = str(o.get("tex", "")).strip().strip("$")
            terms = o.get("terms") or {}
            if isinstance(terms, list):
                terms = {str(x.get("tex", x.get("term", ""))): x.get("q") for x in terms if isinstance(x, dict)}
            h = tex_hygiene(o["tex"])
            if h != o["tex"]:
                notes.append(f"{o['id']}: tex hygiene")
                o["tex"] = h
                terms = {tex_hygiene(k): v for k, v in terms.items()}
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
    svg_ids = {o["id"] for o in objs if o["kind"] == "svg"}
    for o in objs:  # a colour word given for a body: a material, else ink
        if o.get("material") and not o.get("q") and "color" not in o:
            o["color"] = o.pop("material")
    for o in objs:
        if o.get("color") is not None and o["color"] not in NEUTRALS:
            o.pop("color")
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
            keep = [t for t in a["targets"] if t in ids or (isinstance(t, str) and "." in t and t.split(".")[0] in svg_ids)]
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


# ───────────── Motion density (deterministic lint + fill) ─────────────
MOVING = {"set", "speed", "follow", "drift", "rotate", "morph", "match_tex", "matrix", "warp", "move", "camera", "scale"}


def motion_cover(spec: dict) -> tuple[list, float, float]:
    """Intervals in which something on screen changes continuously, mirroring the renderer's grouping and stretching
    (continuous drives fill the gap to the next cue up to 4x). Steady trackers and jiggle / spin count while their
    objects are visible."""
    import gm_scene
    acts = [a for a in gm_scene.schedule(spec) if a.get("do") != "wait"]
    end = gm_scene.total_duration(spec) or (max((a["_t0"] + a["_dur"] for a in acts), default=0))
    starts = sorted({round(a["_t0"], 2) for a in acts})
    cover = []
    for a in acts:
        if a.get("do") not in MOVING:
            continue
        nxt = next((t for t in starts if t > a["_t0"] + 0.12), end)
        d = a["_dur"]
        if a.get("do") in gm_scene.CONTINUOUS and not a.get("exact"):
            d = min(nxt - a["_t0"], d * 4)
        cover.append((a["_t0"], a["_t0"] + min(d, max(0.15, nxt - a["_t0"]))))
    vis = gm_scene._visibility(spec)
    steady = {t["id"] for t in spec.get("trackers") or [] if isinstance(t, dict) and t.get("rate")}
    for o in spec.get("objects") or []:
        live = o.get("jiggle") or o.get("spin") or (steady and gm_scene.names_in([v for k, v in o.items() if k not in ("id", "kind", "tex", "text")]) & steady)
        if live and o["id"] in vis:
            cover.append((vis[o["id"]][0], min(end, vis[o["id"]][1])))
    first = min((a["_t0"] for a in acts if a.get("do") == "show"), default=0.0)
    return sorted(cover), first, end


def motion_gaps(spec: dict, longest=2.0) -> list[tuple[float, float]]:
    cover, first, end = motion_cover(spec)
    gaps, t = [], first + 1.0  # the opening draw-in counts as change
    for a, b in cover:
        if a > t + longest:
            gaps.append((round(t, 2), round(a, 2)))
        t = max(t, b)
    if end - 0.6 > t + longest:
        gaps.append((round(t, 2), round(end - 0.6, 2)))
    return gaps


def fill_motion(spec: dict, notes: list[str]) -> list[str]:
    """Close static stretches deterministically: molecules/particles (arrays) jiggle; a steady tracker keeps turning;
    otherwise the next continuous action is pulled forward into the gap (motion anticipates the words, as 3Blue1Brown
    often does). Returns what still could not be filled."""
    import gm_scene
    for o in spec.get("objects") or []:
        if o["kind"] == "array" and not o.get("jiggle") and (o.get("of") or {}).get("kind") in ("dot", "circle", "point", "ellipse", None):
            o["jiggle"] = 0.04
            notes.append(f"motion: {o['id']} jiggles")
    left = []
    for _ in range(6):
        gaps = motion_gaps(spec)
        if not gaps:
            break
        g0, g1 = gaps[0]
        sched = gm_scene.schedule(spec)
        nxt = next((a for a in sched if a.get("do") in MOVING and a["_t0"] >= g1 - 0.05), None)
        if nxt is not None and nxt["_t0"] - g0 < 7:
            src = spec["timeline"][nxt["_i"]]
            src.pop("cue", None)
            src["t"] = round(g0 + 0.2, 2)
            src["dur"] = round(float(src.get("dur", 1)) + (nxt["_t0"] - g0 - 0.2), 2)
            src.pop("exact", None)
            notes.append(f"motion: {src['do']} pulled from {nxt['_t0']:.1f}s to {g0 + 0.2:.1f}s")
            continue
        prev = [a for a in sched if a.get("do") in ("set",) and a["_t0"] < g0]
        if prev:
            src = spec["timeline"][prev[-1]["_i"]]
            src["dur"] = round(float(src.get("dur", 1)) + (g1 - g0), 2)
            src.pop("exact", None)
            notes.append(f"motion: {src['do']} at {prev[-1]['_t0']:.1f}s stretched over {g0:.1f}-{g1:.1f}s")
            if any(abs(a - g0) < 0.01 for a, _ in motion_gaps(spec)):
                left.append(f"{g0:.1f}-{g1:.1f}s")
                break
            continue
        left.append(f"{g0:.1f}-{g1:.1f}s")
        break
    return left


# ───────────── Critic ops (deterministic repair) ─────────────
def _owner(spec, oid):
    defs = {o["id"]: o for o in spec.get("objects") or []}
    o = defs.get(oid)
    seen = 0
    while o and o.get("on") and seen < 4:
        o = defs.get(o["on"])
        seen += 1
    return o


def apply_ops(spec: dict, ops: list, notes: list[str]) -> int:
    n = 0
    qids = {q["id"] for q in spec.get("quantities") or []}
    for op in ops or []:
        if not isinstance(op, dict):
            continue
        kind, oid = op.get("op"), str(op.get("id", ""))
        o = _owner(spec, oid) if kind in ("move", "resize") else next((x for x in spec.get("objects") or [] if x["id"] == oid), None)
        if o is None:
            continue
        try:
            if kind == "move":
                by = op.get("by") or ([float(op["to"][0]) - float((o.get("at") or o.get("center") or [0, 0])[0]), float(op["to"][1]) - float((o.get("at") or o.get("center") or [0, 0])[1])] if op.get("to") else None)
                if not by:
                    continue
                by = [max(-3.0, min(3.0, float(by[0]))), max(-2.5, min(2.5, float(by[1])))]
                off = o.get("offset") or [0, 0]
                o["offset"] = [float(off[0]) + by[0], float(off[1]) + by[1]]
            elif kind == "resize":
                o["scale_by"] = float(o.get("scale_by", 1)) * max(0.4, min(1.8, float(op.get("factor", 1))))
            elif kind == "region" and op.get("region") in ("left", "right", "center", "top", "bottom"):
                o["region"] = op["region"]
            elif kind == "recolor" and op.get("q") in qids:
                o["q"] = op["q"]
                o.pop("color", None)
            elif kind == "add_motion":
                if op.get("motion") == "spin":
                    o["spin"] = float(op.get("rate", 40))
                else:
                    o["jiggle"] = min(0.12, float(op.get("rate", 0.05)))
            elif kind == "drop":
                spec["timeline"] = [a for a in spec["timeline"] if not (a.get("do") == "show" and a.get("targets") == [oid])]
                for a in spec["timeline"]:
                    if a.get("targets"):
                        a["targets"] = [t for t in a["targets"] if t != oid]
                spec["timeline"] = [a for a in spec["timeline"] if a.get("targets") != [] or a.get("do") not in ("show", "hide", "indicate", "circle", "move", "rotate", "scale")]
            else:
                continue
            n += 1
            notes.append(f"op {kind} {oid}")
        except (TypeError, ValueError, KeyError, IndexError):
            continue
    return n


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
                pieces = gm_scene.split_terms(o.get("tex", ""))
                # the scene compiles a formula whole when its groups only make sense inside it (\frac{{{a}}}{2})
                try:
                    MathTex("".join(pieces))
                    snippets = []
                except Exception:  # noqa: BLE001
                    snippets = ["".join(pieces)]
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


AXES = ("structure", "mechanism", "layout", "motion", "tex")
BAR = {"structure": 9, "overall": 8}


def critique(sheet: bytes, plan: dict, spec: dict, log: list) -> dict:
    qs = ", ".join(f"{q.get('name', q.get('id'))}={q.get('color')}" for q in plan.get("quantities", []))
    try:
        st = json.dumps(plan.get("structure") or [], separators=(",", ":"))[:2200]
        chg = "; ".join(f"{c.get('when', '')}: {c.get('what', '')}" for c in plan.get("changes", []))[:900]
        eqs = "; ".join(str(e.get("tex", "")) for e in plan.get("equations", []))[:400] or "none"
        ids = ", ".join(f"{o['id']}({o['kind']},{o.get('region', '-')})" for o in spec.get("objects", []))[:1500]
        out = ask_json(CRITIC_PROMPT.format(idea=plan.get("idea", ""), structure=st, params=json.dumps(plan.get("params") or {})[:500], quantities=qs, changes=chg, equations=eqs, ids=ids), images=[sheet], temperature=0.2, timeout=60, log=log)
        if not isinstance(out, dict):
            raise RuntimeError("critic returned no object")
        sc = out.get("scores") or {}
        out["scores"] = {k: float(sc.get(k, 0) or 0) for k in AXES}
        out["score"] = float(out.get("score") or 0)
        out["pass"] = out["score"] >= BAR["overall"] and out["scores"]["structure"] >= BAR["structure"] and min(out["scores"].values()) >= 7
        return out
    except Exception as exc:  # noqa: BLE001
        log.append(f"critique skipped: {exc}")
        return {"pass": None, "skipped": True}


def lint(spec: dict) -> list[str]:
    """Deterministic issues the critic cannot fix by ops: static stretches left after fill, missing trackers."""
    out = []
    gaps = motion_gaps(spec)
    if gaps:
        out.append("static stretches with nothing moving: " + ", ".join(f"{a:.1f}-{b:.1f}s" for a, b in gaps) + "; add a continuous change (set / speed / follow / morph) in each")
    if not spec.get("trackers"):
        out.append("no tracker drives anything; the mechanism must be driven by a tracker through its real relation")
    return out


# ───────────── Pipeline ─────────────
LAST: dict = {}  # the latest plan / spec (diagnostics when a run fails)


def make_spec(desc: str, narr: dict | None, context: str, media_dir: str, log: list, plan: dict | None = None) -> tuple[dict, dict]:
    b = beats(narr)
    if plan is None:
        plan = ask_json(PLAN_PROMPT.format(desc=desc[:2500], context=context[:1500], beats=b), temperature=0.5, log=log, strong=True)
    LAST["plan"] = plan
    import gm_scene
    regs = {str(o.get("region")) for o in plan.get("objects") or [] if isinstance(o, dict) and o.get("region")}
    zs = gm_scene.zones(regs or {"left", "right", "top"})
    ztxt = "\n".join(f"  {r}: x {z[0]:.2f}..{z[2]:.2f}, y {z[1]:.2f}..{z[3]:.2f}" for r, z in zs.items() if r != "full")
    raw = ask_json(COMPOSE_PROMPT.format(plan=json.dumps(plan)[:9000], beats=b, zones=ztxt, grammar=GRAMMAR), temperature=0.3, timeout=150, log=log, strong=True)
    LAST["raw"] = raw
    spec = prepare(raw, narr, media_dir, log, plan)
    return plan, spec


def det_fix(sp: dict, errs: list[str], notes: list[str]) -> bool:
    """Deterministic fixes for validation errors that do not need the model: a name used in an expression that is
    neither a param nor a tracker becomes a tracker at 0; a timeline action that fails is dropped; a link to a term that
    is not isolated is dropped."""
    import gm_scene
    e = " ".join(errs)
    m = re.search(r"name '([A-Za-z_][A-Za-z0-9_]*)' is not defined", e)
    if m:
        nm = m.group(1)
        if nm not in {t["id"] for t in sp.get("trackers") or []} and nm not in (sp.get("params") or {}):
            sp.setdefault("trackers", []).append({"id": nm, "value": 0})
            notes.append(f"declared tracker {nm}")
            # if it was set before declared, fine; if it is not driven at all it stays at its start value
            return True
    m = re.search(r"action (\w+) #(\d+) failed", e)
    if m:
        k = int(m.group(2))
        sched = gm_scene.schedule(sp)
        tl = sp.get("timeline") or []
        if 0 <= k < len(tl):
            notes.append(f"dropped failing action {tl[k].get('do')} #{k}: {e[:120]}")
            tl.pop(k)
            return True
    m = re.search(r"link: term '(.+?)' not found in (\S+)", e)
    if m:
        before = len(sp["timeline"])
        sp["timeline"] = [a for a in sp["timeline"] if not (a.get("do") == "link" and a.get("eq") == m.group(2).strip("'\""))]
        if len(sp["timeline"]) < before:
            notes.append(f"dropped links into {m.group(2)}")
            return True
    m = re.search(r"refers to unknown object '([^']+)'", e)
    if m:
        bad = m.group(1)
        for a in sp["timeline"]:
            if a.get("targets"):
                a["targets"] = [t for t in a["targets"] if t != bad]
        sp["timeline"] = [a for a in sp["timeline"] if a.get("targets") != [] and bad not in (a.get("from"), a.get("to"), a.get("eq"), a.get("target"), a.get("path"))]
        notes.append(f"dropped references to {bad}")
        return True
    return False


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
        for _ in range(2):  # an SVG reference that cannot be fetched / parsed falls back to its primitive build
            bad = [o for o in sp["objects"] if o["kind"] == "svg" and any(f"object {o['id']} " in e or f"svg {o['id']}" in e for e in errs)]
            if not bad:
                break
            for o in bad:
                fb = [x for x in (o.get("fallback") or []) if isinstance(x, str)]
                sp["objects"] = [x for x in sp["objects"] if x["id"] != o["id"]]
                for act in sp["timeline"]:
                    if act.get("targets") and any(t == o["id"] or str(t).startswith(o["id"] + ".") for t in act["targets"]):
                        act["targets"] = [t for t in act["targets"] if not (t == o["id"] or str(t).startswith(o["id"] + "."))] + (fb if act.get("do") == "show" else [])
                sp["timeline"] = [act for act in sp["timeline"] if act.get("targets") != []]
                notes.append(f"svg {o['id']} failed; primitive fallback {fb}")
            errs = validate(sp, media_dir)
        for _ in range(6):  # failing actions / undeclared trackers: fixed without an LLM
            if not errs or not det_fix(sp, errs, notes):
                break
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
        for _ in range(3):  # last resort: drop the one object that still fails (with every reference to it), keep the rest
            m = re.search(r"object (\S+) \(", " ".join(errs))
            if not errs or not m or m.group(1) not in {o["id"] for o in spec["objects"]}:
                break
            bad = m.group(1)
            spec["objects"] = [o for o in spec["objects"] if o["id"] != bad and (o.get("on"), o.get("graph"), o.get("target"), (o.get("next_to") or [None])[0]).count(bad) == 0]
            ids = {o["id"] for o in spec["objects"]}
            for a in spec["timeline"]:
                if a.get("targets"):
                    a["targets"] = [t for t in a["targets"] if t in ids or "." in str(t)]
            spec["timeline"] = [a for a in spec["timeline"] if a.get("targets") != [] and all(a.get(k) in ids for k in ("from", "to", "eq", "target", "path") if isinstance(a.get(k), str))]
            notes.append(f"dropped {bad}: {' '.join(errs)[:160]}")
            errs = check(spec, True)
        if errs:
            raise RuntimeError("spec invalid after repair: " + " | ".join(errs)[:800])
    left = fill_motion(spec, notes)
    if left:
        notes.append("motion gaps left: " + ", ".join(left))
    if notes:
        log.append("normalize: " + "; ".join(notes)[:900])
    return spec


def _rank(c):
    cr = c.get("critique") or {}
    if cr.get("skipped") or cr.get("score") is None:
        return (-1.0, -len(c["issues"]))
    return (float(cr.get("score", 0)) + 0.5 * float((cr.get("scores") or {}).get("structure", 0)), -len(c["issues"]))


def compose_and_render(desc: str, narr: dict | None = None, context: str = "", workdir: str | None = None, vision: str = "auto", log: list | None = None,
                       max_renders: int = 3, budget_s: float = 780) -> dict:
    """Returns {ok, spec, video, pen, gate, issues, critique, history, timings, log}.
    render -> gate + critic (per-axis scores) -> critic ops applied deterministically (no LLM) when they cover the
    defects -> else / then one LLM repair with the critic's findings (rebuild list for structure / mechanism).
    At most max_renders renders (initial + 2 repairs); a failure mode is never retried more than twice."""
    log = [] if log is None else log
    workdir = workdir or tempfile.mkdtemp(prefix="gm-")
    media = os.path.join(workdir, "media-validate")
    t0 = time.time()
    timings = {}
    plan, spec = make_spec(desc, narr, context, media, log)
    timings["compose_s"] = round(time.time() - t0, 1)
    best = None
    history = []
    tries: dict[str, int] = {}
    for attempt in range(max_renders):
        t1 = time.time()
        r = render_spec(spec, os.path.join(workdir, f"r{attempt}"))
        timings[f"render{attempt}_s"] = r["render_s"]
        if not r["ok"]:
            log.append(f"render {attempt} failed: {r['error'][-300:]}")
            tries["render"] = tries.get("render", 0) + 1
            if tries["render"] <= 2 and attempt < max_renders - 1:
                raw = ask_json(REPAIR_PROMPT.format(why="to render", problems=r["error"][-2500:], spec=json.dumps(_clean(spec))[:16000], grammar=GRAMMAR), temperature=0.2, timeout=120, log=log)
                spec = prepare(raw, narr, media, log, plan)
                continue
            break
        t2 = time.time()
        issues = heuristics(r, spec) + plan_gaps(plan, spec) + lint(spec)
        crit = None
        if vision != "never":
            sheet = keyframes(r["video"], r["gate"], os.path.join(workdir, f"r{attempt}"), n=6)
            if sheet:
                crit = critique(sheet, plan, spec, log)
                if crit and crit.get("pass") is False:
                    issues += [f"vision: {x}" for x in crit.get("issues", [])][:8]
        timings[f"gate{attempt}_s"] = round(time.time() - t2, 1)
        cand = {"spec": copy.deepcopy(spec), "video": r["video"], "pen": r.get("pen"), "gate": r["gate"], "issues": issues, "critique": crit, "attempt": attempt}
        history.append({"attempt": attempt, "scores": (crit or {}).get("scores"), "score": (crit or {}).get("score"), "issues": issues[:10], "ops": (crit or {}).get("ops"), "rebuild": (crit or {}).get("rebuild")})
        if best is None or _rank(cand) > _rank(best):
            best = cand
        ok = (crit or {}).get("pass") if crit and not crit.get("skipped") else not issues
        if ok or attempt == max_renders - 1 or time.time() - t0 > budget_s:
            break
        # which failure modes remain (a mode is retried at most twice)
        sc = (crit or {}).get("scores") or {}
        modes = [k for k in AXES if sc.get(k, 10) < (BAR["structure"] if k == "structure" else 8)] or ["general"]
        for m in modes:
            tries[m] = tries.get(m, 0) + 1
        if all(tries[m] > 2 for m in modes):
            log.append(f"stop: {modes} already repaired twice")
            break
        notes: list[str] = []
        rebuild = [x for x in (crit or {}).get("rebuild") or [] if x]
        needs_llm = bool(rebuild) or any(m in ("structure", "mechanism") for m in modes) or any("static stretches" in x or "never appears" in x for x in issues)
        nops = apply_ops(spec, (crit or {}).get("ops") or [], notes)
        if notes:
            log.append("ops: " + "; ".join(notes)[:500])
        if needs_llm:
            try:
                problems = issues + [f"rebuild so it looks like the real thing / works like it: {x}" for x in rebuild]
                problems += [f"axis scores {sc}: structure must reach 9 (real silhouette, real parts and counts, shading, parts connected), every axis 8"]
                raw = ask_json(REPAIR_PROMPT.format(why="the quality check after rendering", problems="\n".join(problems), spec=json.dumps(_clean(spec))[:16000],
                                                    grammar=GRAMMAR + "\nStructure plan to match:\n" + json.dumps(plan.get("structure") or [])[:3000]), temperature=0.25, timeout=150, log=log, strong=True)
                spec = prepare(raw, narr, media, log, plan)
            except Exception as exc:  # noqa: BLE001
                log.append(f"repair skipped: {exc}")
                if not nops:
                    break
        elif not nops:
            break
    timings["total_s"] = round(time.time() - t0, 1)
    if best is None:
        return {"ok": False, "plan": plan, "spec": spec, "timings": timings, "log": log, "history": history}
    return {"ok": True, "plan": plan, **best, "history": history, "timings": timings, "log": log}


def _clean(spec):
    return {k: v for k, v in spec.items() if k not in ("narration", "_src_boxes", "_layout")}

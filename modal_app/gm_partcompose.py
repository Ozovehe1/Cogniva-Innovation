"""Part-graph composer: the LLM classifies, names, picks and labels; deterministic code does geometry, numbers,
motion and checks.

  narration -> [LLM] part graph (solver, parts by role, relations, quantities, beats with events, required elements)
            -> [det] fact checks (equation balance, molecules resolvable, narrated numbers = quantity values, causal order)
            -> [LLM] fact-check yes/no review (blocking problems go back for one repair)
            -> [det] solver: SCENE (rig geometry from relations/ratios, World processes keyed on the narration's words,
                     quantities as sympy expressions, layout on the 6x6 anchor grid, labels, readouts, graphs, annotations)
            -> [det] symbolic scene-graph gates (partial execution: off-frame, overlaps, fill, motion coverage,
                     narrated change per beat, completeness, axis labels, proportions) with deterministic fixes
            -> render candidates (best-of-N) -> [LLM] pairwise tournament + yes/no checklist -> final render
            -> pen coverage gate -> ship, and store the graph in episodic memory.
A topic no solver fits (fits=false, unknown solver, or gates that cannot be fixed) returns ok=False so the caller
falls back to the free composer (gm_compose)."""
from __future__ import annotations

import concurrent.futures as cf
import copy
import json
import math
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
import time

from gm_llm import LAST_MODEL, ask_json

HERE = os.path.dirname(os.path.abspath(__file__))

# ───────────── Solver catalogue the LLM picks from (generic mechanisms + an abstract board) ─────────────
CATALOG = r"""
SOLVERS (pick the ONE whose relations match the idea; they are generic, not topics):
- fluid_link: pistons/plungers joined by an enclosed incompressible fluid (Pascal; volume conservation sets the output travel).
  roles: small_piston, large_piston, fluid, housing, load.  params: area_ratio (A_large/A_small), fluid ("oil"|"water").
  quantities you may set: F_in (N), d_in (cm), A_in (cm^2, optional).  derived: P = F_in/A_in, F_out = area_ratio*F_in, d_out = d_in/area_ratio.
  events: push (input piston moves its stroke), release, pressure (show equal pressure arrows in the fluid), forces (show force arrows).
- gear_differential: open bevel differential between two driven wheels (sum constraint w_left + w_right = 2 w_carrier), with a top view of the car cornering.
  roles: ring_gear, pinion, carrier, spider_gears, side_gears, left_wheel, right_wheel, axle, drive_shaft, car.  params: turn_ratio (0.1-0.4, outer wheel speeds up by this fraction).
  events: drive (engine turns the ring gear), turn (car corners: wheel speeds split), straight (equal speeds again), split (show the readouts/equation).
- cable_signal: an excitable cable (neuron: dendrites, soma, myelinated axon, nodes, terminals) carrying a spike computed by the Hodgkin-Huxley model; optional membrane close-up with Na+/K+ channels and a voltage trace.
  roles: neuron, dendrites, soma, axon, myelin, node, terminals, membrane, na_channel, k_channel.  params: myelinated (bool).
  events: rest, stimulus, depolarize (Na+ channels open, Na+ flows in, V rises), repolarize (K+ channels open, K+ out, V falls), propagate (spike travels node to node to the terminals).
- binding: a host molecule/protein with a pocket and guest(s) whose shape is the pocket's complement; induced fit closes the host; a reaction joins (or splits) the guests; optional energy profile.
  roles: host, site, guest, product.  params: reaction ("join"|"split"), energy_graph (bool), protein ("hexokinase" | "adenylate kinase" | "OPEN/CLOSED" PDB ids of a real enzyme's apo and substrate-bound structures; the host outline is traced from that real backbone; default hexokinase).
  events: approach (guests move into the pocket), close (host bends around them: induced fit), react (bonds strained, products form), release (products leave, host reopens).
- flow_reactor: a duct/shell with a reactive channel zone (catalyst-coated honeycomb, filter, membrane bed); gas/liquid molecules flow through and are converted; close-up of the surface reactions.
  roles: converter, inlet, outlet, monolith, channels, catalyst, surface, gas.  params: zones [{"name","coat"}], inputs (molecules in, formulas), map {reactant: product}, reactions [{"eq": balanced equation with formulas, "site": metal}].
  events: flow (stream runs), react:<k> (play surface reaction k), show_zone.
- dissection: a disc cut into n wedges that rearrange (alternating) into a near-rectangle pi r x r; n refines 8 -> 16 -> 32.
  roles: circle, strip.  events: cut, unroll, refine, radius, circumference, width, height, equation.
- projectile: a body launched at an angle under gravity (solved kinematics, true parabola, launch angle, v0 with components, g, range R, max height H).
  roles: ball, launcher, ground, path.  quantities you may set: v0 (m/s), theta (deg), g (m/s^2).  derived: vx, vy, R, H, T.
  events: launch (flight), angle, velocity, components, gravity, height, range, equation.
- board: abstract content on the 6x6 anchor grid (columns A-F, rows 1-6): items of type
  network {nodes:[{id, at:"B2"}], edges:[[a,b,weight]], algorithm:"dijkstra"|null, source},
  chart {x_label:"Quantity (units)", y_label:"Price ($)", x_range:[a,b], y_range:[a,b], curves:[{id, label, expr:"y as a function of x", shift:"event that moves it", shift_by:"+2" }], equilibrium:true},
  array {values:[...], algorithm:"binary_search"|null, target}, timeline {events:[{t, label}]}, venn {sets:[{label}], members:[{label}]},
  number_line {x_range:[a,b]}, freeform {points:[[fx,fy],...] fractions of its region, closed, color} for any shape the list lacks,
  reference {commons:"File:<exact Wikimedia Commons SVG title>", landmarks:{part_id:[fx,fy]}, points:[...] fallback outline} for organic anatomy
  (heart, cell, eye, ...) drawn from a real reference illustration; its text is removed and the parts are labelled through landmarks.
  events: step (algorithm advances one step), run (algorithm runs to the end), shift:<curve id>, reveal:<item id>.
If none of these shows the idea truthfully, answer fits=false.
"""

GRAPH_PROMPT = """You turn a narrated explanation into a PART GRAPH for a deterministic animation engine. You never give
coordinates or sizes: you only classify, name, pick, count and label. The engine computes geometry, physics and motion.

Topic: {desc}
Narration sentences (index: text):
{sentences}
{memory}
{catalog}

Return JSON only:
{{"fits": true|false, "why_not": "if fits is false",
 "solver": "<one solver name>",
 "mode": "real" (physical/biological/mechanical/chemical/geographic objects: full colour on a dark backdrop) | "whiteboard" (derivations, maths, algorithms, abstract diagrams),
 "idea": "the one idea of this clip in a sentence",
 "parts": [{{"id": "short_id", "role": "<a role of the solver>", "name": "real name to label it with", "count": 1}}],
 "relations": [{{"rel": "connected_by|meshes_with|inside|attached_to|fits_into|flows_through|ratio|sum|drives|above|left_of", "a": "id", "b": "id", "k": number_if_ratio}}],
 "params": {{solver params}},
 "quantities": [{{"id": "F_in", "name": "input force", "symbol": "F_1" (LaTeX), "unit": "N", "value": 100}}],
 "items": [board items only, each with "id", "type", "region" like "A1:D6" and its fields],
 "beats": [{{"s": sentence index, "events": ["event names of the solver, in causal order"], "show": ["part ids first seen here"],
            "label": ["part ids NAMED in this sentence"], "readouts": ["quantity ids SPOKEN in this sentence"], "equation": false}}],
 "equation": "one LaTeX equation that states the idea, or empty",
 "required": ["every part, quantity, angle, force, dimension, axis the narration names or the idea needs, as short names"]}}
Rules: one beat per sentence, every sentence covered; a part is labelled only in the sentence that names it; numbers must equal
the narration's numbers (\"a hundred newtons\" -> 100, \"ten times\" -> 10); events in the order the science happens.
Chemistry: specific molecules with formulas (NO not NOx, C3H8 for unburned fuel, never CxHy), one species per map value, balanced
equations with whole-number coefficients."""

FACT_PROMPT = """You are a strict science fact-checker for an educational animation. Check this part graph against the narration and
established science: part names, counts, arrangement, values and units, directions of flow / rotation / charge, and causal order.
Narration: \"\"\"{text}\"\"\"
Part graph: {graph}
Deterministic findings already made: {det}
Return JSON only: {{"ok": true|false, "problems": [{{"severity": "block"|"warn", "what": "...", "fix": "..."}}]}}
Block only for a real error that would make the PICTURE or the NUMBERS wrong (wrong science, wrong number, wrong direction, wrong
order, a part the idea needs is missing). The engine draws sub-parts itself (wedges, gear teeth, channels, nodes, atoms) and its own
relation semantics, so counts in the parts list and relation names are never a reason to block."""

PAIR_PROMPT = """Two candidate animations (A = first image, B = second image; each image shows key frames in time order) illustrate:
\"{idea}\". Narration: \"{text}\"
Answer yes/no per question for EACH candidate, then pick the better one for accuracy (looks and works like the real thing), clarity and completeness.
Questions:
{questions}
Return JSON only: {{"A": [true/false per question], "B": [true/false per question], "better": "A"|"B", "why": "short"}}"""

CHECK_PROMPT = """Key frames (time order) of an educational animation that should show: \"{idea}\".
Answer each question strictly yes/no from what you SEE. Return JSON only: {{"answers": [true/false per question], "problems": ["short, for each no"]}}
Questions:
{questions}"""


# ───────────── Narration timing ─────────────
def sentences(narr: dict | None, text: str = "") -> list[dict]:
    if narr and narr.get("words"):
        out, cur, s0 = [], [], None
        words = narr["words"]
        for i, w in enumerate(words):
            if s0 is None:
                s0 = w["s"]
            cur.append(w["w"])
            if re.search(r"[.!?]$", w["w"]) or i == len(words) - 1:
                out.append({"text": " ".join(cur), "t0": s0 / 1000, "t1": w["e"] / 1000})
                cur, s0 = [], None
        dur = max(narr.get("ms", words[-1]["e"]) / 1000, out[-1]["t1"]) + 0.6
        for k in range(len(out)):  # a beat lasts until the next sentence starts
            out[k]["t1"] = out[k + 1]["t0"] if k + 1 < len(out) else dur
        return out
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", text or "") if p.strip()]
    t, out = 0.4, []
    for p in parts:
        d = max(2.0, len(p.split()) / 2.6)
        out.append({"text": p, "t0": t, "t1": t + d})
        t += d
    return out


# ───────────── Numbers in words (fact checks: narrated numbers vs quantities) ─────────────
_NUM = {"zero": 0, "one": 1, "a": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
        "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
        "eighty": 80, "ninety": 90, "hundred": 100, "thousand": 1000}


def spoken_numbers(text: str) -> list[float]:
    t = text.lower().replace("-", " ")
    out = [float(x) for x in re.findall(r"(?<![\w.])\d+(?:\.\d+)?", t)]
    words = re.findall(r"[a-z]+", t)
    i = 0
    while i < len(words):
        w = words[i]
        if w in _NUM and w != "a":
            v = _NUM[w]
            j = i + 1
            if j < len(words) and words[j] in ("hundred", "thousand") and v < 100:
                v *= _NUM[words[j]]
                j += 1
            elif v >= 20 and v < 100 and j < len(words) and words[j] in _NUM and _NUM[words[j]] < 10 and words[j] != "a":
                v += _NUM[words[j]]
                j += 1
            # "nine point eight one" -> 9.81 (each digit after "point" is one decimal place)
            if j < len(words) and words[j] == "point":
                k, dec = j + 1, ""
                while k < len(words) and words[k] in _NUM and _NUM[words[k]] < 10 and words[k] != "a":
                    dec += str(int(_NUM[words[k]]))
                    k += 1
                if dec:
                    v = float(f"{int(v)}.{dec}")
                    j = k
            neg = i > 0 and words[i - 1] == "minus"
            out.append(-v if neg else float(v))
            i = j
            continue
        if w == "a" and i + 1 < len(words) and words[i + 1] in ("hundred", "thousand"):
            out.append(float(_NUM[words[i + 1]]))
            i += 2
            continue
        i += 1
    return out


def _words(s):
    return set(re.findall(r"[a-z]{3,}", (s or "").lower()))


# ───────────── Deterministic fact checks ─────────────
def fact_checks(G: dict, text: str) -> list[dict]:
    import gm_refdata
    out = []
    solver = G.get("solver")
    P = G.get("params") or {}
    for r in P.get("reactions") or []:
        ok, why = gm_refdata.balanced(r.get("eq", ""))
        if not ok:  # deterministic repair first: solve the stoichiometry exactly (null space of the element matrix)
            fixed = gm_refdata.balance(r.get("eq", ""))
            if fixed:
                out.append({"severity": "fixed", "what": f"equation balanced deterministically: {r.get('eq')} => {fixed}"})
                r["eq"] = fixed
                continue
            out.append({"severity": "block", "what": f"equation not balanced: {r.get('eq')}", "fix": why})
    for m in list(P.get("inputs") or []) + list((P.get("map") or {}).values()):
        if gm_refdata.molecule(str(m)) is None:
            out.append({"severity": "warn", "what": f"molecule {m!r} not found in PubChem/RDKit", "fix": "use a formula or a common name"})
    spoken = spoken_numbers(text)
    qv = [float(q["value"]) for q in G.get("quantities") or [] if isinstance(q.get("value"), (int, float))]
    for q in G.get("quantities") or []:
        v = q.get("value")
        if isinstance(v, (int, float)) and spoken and v not in (0, 1) and not any(abs(v - s) <= 0.02 * max(1, abs(s)) for s in spoken):
            out.append({"severity": "warn", "what": f"quantity {q.get('id')}={v} {q.get('unit', '')} is never spoken", "fix": "use the narrated value"})
    if solver == "fluid_link":
        k = float(P.get("area_ratio") or 0)
        if "ten times" in text.lower() and k and abs(k - 10) > 1e-6:
            out.append({"severity": "block", "what": f"narration says ten times the area but area_ratio={k}", "fix": "area_ratio 10"})
    if solver == "cable_signal":
        ev = [e for b in G.get("beats") or [] for e in b.get("events") or []]
        if "repolarize" in ev and "depolarize" in ev and ev.index("repolarize") < ev.index("depolarize"):
            out.append({"severity": "block", "what": "repolarisation placed before depolarisation", "fix": "Na+ in first, then K+ out"})
        for v in spoken:
            if v in (-70.0, 40.0):
                continue
    if solver == "gear_differential":
        tr = float(P.get("turn_ratio") or 0.25)
        if not 0 < tr < 0.6:
            out.append({"severity": "block", "what": f"turn_ratio {tr} unphysical", "fix": "0.1-0.4"})
    del qv
    return out


# ───────────── Solvers: part graph -> SCENE ─────────────
def _roles(G):
    return {p.get("role"): p for p in G.get("parts") or [] if p.get("role")}


def _q(G, qid, default=None):
    for q in G.get("quantities") or []:
        if q.get("id") == qid and isinstance(q.get("value"), (int, float)):
            G.setdefault("_consumed", []).append(qid)
            return float(q["value"])
    return default


def _beat_events(G, S):
    for b in G.get("beats") or []:
        i = int(b.get("s", 0))
        if 0 <= i < len(S):
            yield S[i], b


class Scene:
    def __init__(self, G, sents, solver):
        self.G, self.sents = G, sents
        self.D = round(sents[-1]["t1"], 2) if sents else 12.0
        self.S = {"duration": self.D, "mode": G.get("mode", "whiteboard"), "processes": [], "quantities": [], "rigs": [], "show": {}, "labels": [],
                  "readouts": [], "tex": [], "graphs": [], "annotations": [], "focus": [], "models": [], "solver": solver}
        self.keys: dict[str, list] = {}
        self.notes: list[str] = []
        self.roles = _roles(G)
        self.consumed: set = set()
        self.idmap = {r: (p.get("id") or r) for r, p in self.roles.items()}

    def pid(self, role):
        return self.idmap.get(role, role)

    def key(self, proc, t0, t1, v, replay=True):
        ks = self.keys.setdefault(proc, [])
        cur = ks[-1][2] if ks else 0.0
        if replay and ks and abs(cur - v) < 1e-9 and t1 - t0 > 1.6:
            # narrated again when already there: replay it (quick reset, then the change again)
            base = 0.0 if not isinstance(v, (int, float)) or v != 0 else 1.0
            ks.append([round(t0, 3), round(t0 + 0.6, 3), base, "reset"])
            t0 += 0.7
        ks.append([round(t0, 3), round(max(t1, t0 + 0.3), 3), v])

    def rate(self, proc, t, speed):
        self.keys.setdefault(proc, []).append([round(t, 3), round(t + 0.8, 3), speed])

    def finish_procs(self, rates=(), linear=()):
        for p, ks in self.keys.items():
            ks.sort()
            proc = {"id": p, "keys": ks}
            if p in rates:
                proc["kind"] = "rate"
            if p in linear:
                proc["ease"] = "linear"
            self.S["processes"].append(proc)

    def show(self, role, t):
        pid = self.pid(role)
        if pid not in self.S["show"] or t < self.S["show"][pid]:
            self.S["show"][pid] = round(t, 3)

    def label(self, role, t, text=None):
        p = self.roles.get(role)
        name = text or (p or {}).get("name") or role.replace("_", " ")
        if any(L["part"] == self.pid(role) for L in self.S["labels"]):
            return
        self.S["labels"].append({"id": "L_" + role, "text": name, "part": self.pid(role), "show": round(t, 3)})

    def quantity(self, qid, expr, color=None, name=None, unit=None):
        q = {"id": qid, "expr": str(expr)}
        if color:
            q["color"] = color
        if name:
            q["name"] = name
        if unit:
            q["unit"] = unit
        self.S["quantities"].append(q)

    def readout(self, qid, tex, unit, t, decimals=0):
        if any(r["q"] == qid for r in self.S["readouts"]):
            return
        self.S["readouts"].append({"q": qid, "tex": tex, "unit": unit, "show": round(t, 3), "decimals": decimals})


def _role_for_part_id(G):
    return {p.get("id"): p.get("role") for p in G.get("parts") or []}


def _common_beats(sc: Scene, handle):
    """show / label / readout / equation per beat; events go to the solver handler with the beat window"""
    G = sc.G
    r_of = _role_for_part_id(G)
    first = None
    for s, b in _beat_events(G, sc.sents):
        t0, t1 = s["t0"], s["t1"]
        first = t0 if first is None else first
        for pid in b.get("show") or []:
            sc.show(r_of.get(pid, pid), t0)
        for pid in b.get("label") or []:
            role = r_of.get(pid, pid)
            sc.show(role, t0)
            sc.label(role, t0 + 0.4)
        evs = b.get("events") or []
        n = max(1, len(evs))
        for k, e in enumerate(evs):
            a = t0 + (t1 - t0) * k / n
            z = t0 + (t1 - t0) * (k + 1) / n
            handle(str(e), a + 0.15, max(a + 0.6, z - 0.1), b)
        for qid in b.get("readouts") or []:
            handle("readout:" + str(qid), t0 + 0.2, t1, b)
        if b.get("equation"):
            handle("equation", t0 + 0.2, t1, b)


def solve_fluid_link(sc: Scene):
    sc.S["drawn"] = ["small piston", "large piston", "piston", "cylinder", "oil", "fluid", "tube", "pipe", "load", "force arrows", "pressure arrows", "travel distances", "area ratio", "areas"]  # what this solver always draws (completeness gate)
    G, P = sc.G, sc.G.get("params") or {}
    k = float(P.get("area_ratio") or next((r.get("k") for r in G.get("relations") or [] if r.get("rel") == "ratio" and r.get("k")), 10))
    F1 = _q(G, "F_in", 100.0)
    d1 = _q(G, "d_in", 10.0)
    A1 = _q(G, "A_in")
    sc.quantity("F1", F1, "clay", "input force", "N")
    sc.quantity("F2", f"{k}*F1", "green", "output force", "N")
    sc.quantity("d1", f"{d1}*stroke", "navy", "input travel", "cm")
    sc.quantity("d2", f"d1/{k}", "plum", "output travel", "cm")
    sc.quantity("P", f"F1/{A1}" if A1 else "F1", "teal", "pressure", "N/cm^2")
    shown = {}

    def h(e, a, z, b):
        if e == "push":
            sc.key("stroke", a, z, 1.0)
            for q in ("d1", "d2"):
                shown.setdefault(q, a)
        elif e == "release":
            sc.key("stroke", a, z, 0.0)
        elif e == "pressure":
            shown.setdefault("P", a)
        elif e == "forces":
            shown.setdefault("F1", a)
            shown.setdefault("F2", a + 0.8)
        elif e.startswith("readout:"):
            q = e.split(":", 1)[1].lower()
            m = {"f_in": "F1", "f1": "F1", "f_out": "F2", "f2": "F2", "d_in": "d1", "d1": "d1", "d_out": "d2", "d2": "d2", "p": "P", "pressure": "P"}.get(q)
            if m:
                shown.setdefault(m, a)
        elif e == "equation":
            shown.setdefault("eq", a)
    _common_beats(sc, h)
    sc.keys.setdefault("stroke", [])
    sc.finish_procs()
    sc.S["rigs"].append({"type": "fluid_link", "box": [-6.9, -3.75, 2.4, 3.6], "k": k, "input": "stroke", "fluid_color": P.get("fluid", "oil"),
                         "F_in": "F1", "F_out": "F2", "P": "P" if "P" in shown else None, "d_in": "d1", "d_out": "d2",
                         "roles": {r: sc.pid(r) for r in ("small_piston", "large_piston", "fluid", "housing", "load", "pipe")}})
    for q, t in shown.items():
        if q in ("F1", "F2", "P", "d1", "d2"):
            sc.S["show"][q] = round(t, 3)
    ro = [("F1", "F_1", "N", 0), ("F2", "F_2", "N", 0), ("d1", "d_1", "cm", 1), ("d2", "d_2", "cm", 1)]
    for q, tex, u, dec in ro:
        if q in shown:
            sc.readout(q, tex, u, shown[q], dec)
    sc.S["readout_box"] = [2.9, -2.4, 6.9, 0.9]
    eq = G.get("equation") or r"\frac{F_1}{A_1}=\frac{F_2}{A_2}"
    sc.S["tex"].append({"id": "eq", "tex": eq, "box": [2.7, 1.5, 6.9, 3.6], "show": round(shown.get("eq", shown.get("P", sc.D * 0.55)), 3), "size": 46})


def solve_dissection(sc: Scene):
    sc.S["drawn"] = ["circle", "disc", "wedges", "slices", "radius", "strip", "rectangle", "parallelogram", "circumference", "half circumference", "width", "height", "area"]  # what this solver always draws (completeness gate)
    S = sc.S
    st = {}

    def h(e, a, z, b):
        if e == "cut":
            sc.key("cut", a, min(z, a + 1.5), 1.0)
        elif e == "unroll":
            sc.key("unroll", a, z, 1.0)
            st.setdefault("ghost", a)
        elif e == "refine":
            st.setdefault("refine", []).append((a, z))
        elif e in ("radius", "height"):
            st.setdefault(e, a)
        elif e in ("circumference", "width"):
            st.setdefault(e, a)
        elif e == "equation":
            st.setdefault("eq", a)
    _common_beats(sc, h)
    if "unroll" not in sc.keys:
        sc.key("unroll", sc.D * 0.3, sc.D * 0.5, 1.0)
    # thinner slices only make the strip look more like a rectangle once it is a strip: refine after the unroll
    u_end = sc.keys["unroll"][-1][1]
    wins = [(max(a, u_end + 0.2), max(z, u_end + 2.6)) for a, z in st.get("refine", [])] or [(u_end + 0.3, min(sc.D - 0.5, u_end + 3.0))]
    a, z = wins[0]
    mid = (a + z) / 2
    sc.key("n", a, mid - 0.1, 1, replay=False)
    sc.key("n", mid, z, 2, replay=False)
    sc.finish_procs(linear=("n",))
    sc.quantity("r", 1, "clay", "radius", "")
    sc.quantity("w", "pi", "navy", "half circumference", "")
    D = sc.D
    rig = {"type": "dissection", "box": [-6.9, -2.6, 6.9, 3.3], "n_proc": "n" if "n" in sc.keys else None, "unroll": "unroll", "cut": "cut", "n_steps": [8, 16, 32],
           "r_q": "r", "w_q": "w", "roles": {"circle": sc.pid("circle")}, "radius_show": st.get("radius", 0.6), "ghost_show": st.get("ghost", 1e9),
           "circ_show": st.get("circumference", st.get("width", 1e9)), "circ_hide": min(D, st.get("circumference", st.get("width", D)) + 2.5) if ("circumference" in st or "width" in st) else None,
           "w_show": st.get("width", st.get("circumference", 1e9)), "h_show": st.get("height", st.get("radius_h", 1e9))}
    if rig["h_show"] >= 1e9 and "radius" in st and "unroll" in sc.keys:
        rig["h_show"] = max(st["radius"], sc.keys["unroll"][-1][1])
    S["rigs"].append(rig)
    S["show"][sc.pid("circle")] = 0.0
    eq = sc.G.get("equation") or r"A=\pi r\cdot r=\pi r^2"
    S["tex"].append({"id": "eq", "tex": eq, "box": [-3.2, -3.85, 3.2, -2.75], "show": round(st.get("eq", D * 0.8), 3), "size": 52})


def solve_cable(sc: Scene):
    sc.S["drawn"] = ["neuron", "cell body", "soma", "axon", "dendrites", "myelin", "nodes", "terminals", "membrane", "sodium channels", "potassium channels", "ions", "sodium", "potassium", "voltage", "membrane potential", "action potential", "spike", "signal", "resting potential"]  # what this solver always draws (completeness gate)
    S = sc.S
    N, dms = 6, 2.5
    total_ms = 10 + (N - 1) * dms + 2
    marks = {"stimulus": 0.9, "depolarize": 2.1, "repolarize": 6.5, "propagate": total_ms}
    st = {}

    def h(e, a, z, b):
        if e in marks:
            sc.key("ap", a, z, marks[e] / total_ms)
            st.setdefault(e, a)
        elif e == "rest":
            st.setdefault("rest", a)
        elif e.startswith("readout:"):
            st.setdefault("V", a)
    _common_beats(sc, h)
    sc.finish_procs()
    for p in S["processes"]:
        p["ease"] = "linear"
    S["models"].append({"id": "hh", "kind": "hodgkin_huxley", "driver": "ap", "ms": total_ms, "stim_ms": 0.5})
    sc.quantity("V", "hh_V", "rose", "membrane potential", "mV")
    sc.quantity("tms", "hh_ms", "navy", "time", "ms")
    t_inset = min([st.get(k, 1e9) for k in ("stimulus", "depolarize")] + [S["show"].get(sc.pid("membrane"), 1e9)])
    t_graph = min(st.get("rest", 1e9), st.get("V", 1e9), t_inset)
    if t_graph >= 1e9:
        t_graph = 1.0
    S["rigs"].append({"type": "cable_signal", "box": [-6.9, 0.1, 6.9, 3.85], "model": "hh", "nodes": N, "delay_ms": dms,
                      "inset_box": [-6.7, -3.75, -1.0, -0.55], "inset_show": round(t_inset if t_inset < 1e9 else t_graph, 3),
                      "electrode_show": round(t_graph, 3),
                      "roles": {r: sc.pid(r) for r in ("neuron", "soma", "axon", "dendrites", "terminals", "membrane", "na_channel", "k_channel", "myelin", "node", "channel")}})
    S["show"].setdefault(sc.pid("neuron"), 0.0)
    S["graphs"].append({"id": "vm", "box": [-0.5, -3.75, 6.9, -0.6], "x": "tms", "y": "V", "x_range": [0, 10], "y_range": [-90, 50], "y_step": 20, "x_step": 2,
                        "x_label": r"\text{time } t\ (\mathrm{ms})", "y_label": r"\text{membrane potential } V_m\ (\mathrm{mV})", "y_numbers": [-70, 0, 40],
                        "refs": [{"y": -70, "tex": r"\text{rest}"}], "show": round(t_graph, 3), "from": 0})
    S["readouts"].append({"q": "V", "tex": "V_m", "unit": "mV", "show": round(t_graph, 3), "decimals": 0})
    S["readout_box"] = [3.9, -0.75, 6.9, -0.15]
    if "depolarize" in st:
        S["annotations"].append({"id": "peak", "kind": "feature", "graph": "vm", "feature": "peak", "tex": "", "unit": "mV", "show": st["depolarize"]})
    for k, txt in (("depolarize", "depolarisation: Na⁺ in"), ("repolarize", "repolarisation: K⁺ out"), ("propagate", "propagation along the axon")):
        if k in st:
            nxt = sorted(v for v in st.values() if v > st[k])
            S["annotations"].append({"id": "ph_" + k, "kind": "phase", "text": txt, "show": st[k], "hide": nxt[0] if nxt else None, "box": [0.6, 3.4, 5.6, 3.9], "size": 26})


def solve_binding(sc: Scene):
    sc.S["drawn"] = ["enzyme", "active site", "pocket", "substrate", "reactants", "products", "bonds", "induced fit", "energy", "activation energy", "energy profile"]  # what this solver always draws (completeness gate)
    S, P = sc.S, sc.G.get("params") or {}
    st = {}

    def h(e, a, z, b):
        if e in ("approach", "close", "react", "release"):
            sc.key(e, a, z, 1.0)
            st.setdefault(e, a)
            sc.key("rc", a, z, {"approach": 0.2, "close": 0.35, "react": 0.75, "release": 1.0}[e])
    _common_beats(sc, h)
    for e in ("approach", "close", "react", "release"):
        sc.keys.setdefault(e, [])
    sc.finish_procs()
    sc.quantity("E", "rc", "navy", "energy", "kJ/mol")
    graph = bool(P.get("energy_graph", True))
    box = [-6.9, -3.75, 1.3, 3.75] if graph else [-5, -3.75, 5, 3.75]
    prot = str(P.get("protein", "hexokinase"))
    try:
        import gm_refdata as RD
        chem = RD.PROTEIN_CHEM.get(prot.lower())
    except Exception:  # noqa: BLE001
        chem = None
    S["rigs"].append({"type": "binding", "box": box, "approach": "approach", "close": "close", "react": "react", "release": "release",
                      "reaction": (chem or {}).get("reaction") or P.get("reaction", "join"), "protein": prot, "roles": {r: sc.pid(r) for r in ("host", "guest", "site", "product")}})
    S["show"].setdefault(sc.pid("host"), 0.0)
    S["show"].setdefault(sc.pid("guest"), 0.6)
    if st.get("react") is not None:  # once they have reacted the guests are products: their label goes, the product's comes
        tre = sc.keys["react"][-1][1] if sc.keys.get("react") else st["react"] + 2
        for L in S["labels"]:
            if L["part"] == sc.pid("guest"):
                L["hide"] = round(tre, 3)
            if L["part"] == sc.pid("product"):
                L["show"] = max(L["show"], round(tre, 3))
    if chem:  # name the real molecules: each substrate and each product its own label, the enzyme by name, its two domains
        t_cl = st.get("close", st.get("approach", sc.D * 0.4))
        gp, pp, hp = sc.pid("guest"), sc.pid("product"), sc.pid("host")
        tre = (sc.keys["react"][-1][1] if sc.keys.get("react") else st.get("react", sc.D * 0.6) + 2)
        t_g0 = min([L["show"] for L in S["labels"] if L["part"] == gp] + [S["show"].get(gp, 0.6) + 0.3])
        S["labels"] = [L for L in S["labels"] if L["part"] not in (gp, pp)]
        sub, prd = chem["substrates"], chem["products"]
        S["labels"] += [{"id": "L_guest", "text": sub[0], "part": gp, "show": round(t_g0, 3), "hide": round(tre, 3), "keep": True},
                        {"id": "L_guest2", "text": sub[1], "part": gp + ":1", "show": round(t_g0 + 0.5, 3), "hide": round(tre, 3), "keep": True},
                        {"id": "L_product", "text": prd[0], "part": pp, "show": round(tre, 3), "keep": True},
                        {"id": "L_product2", "text": prd[1], "part": pp + ":1", "show": round(tre + 0.5, 3), "keep": True},
                        {"id": "L_dom_small", "text": chem["domains"][1], "part": hp + ":small", "show": round(t_cl, 3), "keep": True},
                        {"id": "L_dom_large", "text": chem["domains"][0], "part": hp + ":large", "show": round(t_cl + 0.5, 3), "keep": True}]
        for L in S["labels"]:
            if L["part"] == hp and chem["enzyme"].lower() not in L["text"].lower():
                L["text"] = f"{L['text']} ({chem['enzyme'].lower()})" if L["text"].lower() in ("enzyme", "protein") else L["text"]
                L["keep"] = True
        eq0 = str(sc.G.get("equation") or "")
        if not any(m.lower() in eq0.lower() for m in sub + prd):  # a generic E + S -> ES equation gives way to the real reaction
            sc.G["equation"] = chem["equation"]
    if graph:
        t_g = 0.8
        # schematic but realistic magnitudes: uncatalysed Ea ~75 kJ/mol, catalysed ~25 kJ/mol, reaction downhill ~30 kJ/mol
        S["graphs"].append({"id": "en", "mode": "function", "box": [1.6, -3.5, 6.9, 1.5], "x": "rc", "y": "E", "x_range": [0, 1], "y_range": [0, 140], "y_step": 20, "y_numbers": [0, 40, 80, 120], "x_numbers": False,
                            "x_label": r"\text{reaction progress}", "y_label": r"\text{energy (kJ/mol)}", "show": t_g,
                            "functions": [{"expr": "60+75*exp(-((x-0.5)/0.13)**2)-30/(1+exp(-(x-0.5)/0.08))", "color": "muted", "dashed": True, "tex": r"\text{without enzyme}", "label_at": 0.5},
                                          {"expr": "60+25*exp(-((x-0.5)/0.13)**2)-30/(1+exp(-(x-0.5)/0.08))", "q": "E", "tex": r"\text{with enzyme}", "label_at": 0.66, "dot_x": "rc",
                                           "show": round(st.get("close", st.get("approach", 2.0)), 3)}]})
    if sc.G.get("equation"):
        S["tex"].append({"id": "eq", "tex": sc.G["equation"], "box": [1.6, 2.0, 6.9, 3.6], "show": round(st.get("react", sc.D * 0.6), 3), "size": 40})


def solve_differential(sc: Scene):
    sc.S["drawn"] = ["differential", "ring gear", "pinion", "drive shaft", "carrier", "spider gears", "side gears", "axles", "wheels", "inner wheel", "outer wheel", "car", "wheel speeds", "gears"]  # what this solver always draws (completeness gate)
    S, P = sc.S, sc.G.get("params") or {}
    tr = float(P.get("turn_ratio") or 0.25)
    w = 6.0
    st = {}
    cur = {"turn": 0.0}
    sc.rate("phiC", 0.0, w)
    sc.rate("phiL", 0.0, w)
    sc.rate("phiR", 0.0, w)

    def h(e, a, z, b):
        if e == "turn":
            sc.key("turn", a, min(z, a + 2.5), 1.0)
            sc.rate("phiL", a, w * (1 - tr))
            sc.rate("phiR", a, w * (1 + tr))
            st.setdefault("turn", a)
        elif e == "straight":
            sc.key("turn", a, min(z, a + 2.0), 0.0)
            sc.rate("phiL", a, w)
            sc.rate("phiR", a, w)
        elif e in ("split", "drive") or e.startswith("readout:"):
            st.setdefault(e if e in ("split", "drive") else "ro", a)
        elif e == "equation":
            st.setdefault("eq", a)
    _common_beats(sc, h)
    sc.keys.setdefault("turn", [])
    sc.finish_procs(rates=("phiC", "phiL", "phiR"))
    sc.quantity("wL", f"60*(1-{tr}*turn)", "navy", "left wheel speed", "rpm")
    sc.quantity("wR", f"60*(1+{tr}*turn)", "clay", "right wheel speed", "rpm")
    sc.quantity("wC", "(wL+wR)/2", "green", "ring gear speed", "rpm")
    t_ro = min(st.get("turn", 1e9), st.get("ro", 1e9), st.get("split", 1e9))
    t_ro = t_ro if t_ro < 1e9 else 1.0
    view3d = str(P.get("view", "3d")).lower() != "2d"
    S["rigs"].append({"type": "differential3d" if view3d else "differential", "box": [-6.9, -1.05, 6.9, 3.95] if view3d else [-6.75, -0.55, 6.75, 3.6],
                      "inset_box": [-6.7, -3.9, -3.1, -1.1] if view3d else [-6.6, -3.7, -2.4, -0.75], "qL": "wL", "qR": "wR", "turn": "turn",
                      "roles": {r: sc.pid(r) for r in ("differential", "ring_gear", "pinion", "carrier", "spider_gears", "side_gears", "left_wheel", "right_wheel", "axle", "drive_shaft", "car")}})
    S["show"].setdefault(sc.pid("differential"), 0.0)
    S["show"].setdefault(sc.pid("car"), round(min(st.get("turn", 0.3), 0.3), 3))
    sc.readout("wL", r"\omega_{\text{inner}}", "rpm", t_ro)
    sc.readout("wR", r"\omega_{\text{outer}}", "rpm", t_ro)
    sc.readout("wC", r"\omega_{\text{ring}}", "rpm", st.get("split", st.get("drive", t_ro)))
    S["readout_box"] = [-2.6, -3.8, 1.3, -1.25] if view3d else [-1.9, -3.55, 1.9, -0.95]
    eq = r"\omega_{\text{inner}}+\omega_{\text{outer}}=2\,\omega_{\text{ring}}"  # same symbols as the readouts
    S["tex"].append({"id": "eq", "tex": eq, "parts": None, "box": [1.6, -3.3, 6.85, -1.7] if view3d else [2.2, -2.9, 6.85, -1.4], "show": round(st.get("eq", st.get("split", sc.D * 0.6)), 3), "size": 40})


def solve_flow(sc: Scene):
    sc.S["drawn"] = ["converter", "catalytic converter", "honeycomb", "channels", "monolith", "catalyst", "platinum", "rhodium", "surface", "molecules", "exhaust", "gas", "inlet", "outlet", "tailpipe"]  # what this solver always draws (completeness gate)
    S, P = sc.S, sc.G.get("params") or {}
    rx = [r for r in P.get("reactions") or [] if r.get("eq")]
    st = {}
    sc.rate("flow", 0.0, 4.0)

    def h(e, a, z, b):
        if e.startswith("react:") or e == "react":
            try:
                k = int(e.split(":")[1]) if ":" in e else len([x for x in st if x.startswith("r")])
            except ValueError:
                k = 0
            if 0 <= k < len(rx) and f"r{k}" not in st:
                sc.key(f"r{k}", a, z, 1.0)
                st[f"r{k}"] = a
        elif e == "flow":
            st.setdefault("flow", a)
    _common_beats(sc, h)
    for k in range(len(rx)):  # a declared reaction nobody narrated still needs a slot: give it the next free beat
        if f"r{k}" not in st:
            sc.notes.append(f"reaction {k} has no beat")
    sc.finish_procs(rates=("flow",))
    t_in = min([v for k, v in st.items() if k.startswith("r")] + [sc.D * 0.3])
    S["rigs"].append({"type": "flow_reactor", "box": [-6.9, 0.25, 6.9, 3.8], "inset_box": [-6.9, -3.8, 1.3, -0.1], "inset_show": round(max(0.5, t_in - 1.0), 3),
                      "flow": "flow", "zones": P.get("zones") or [{"name": "catalyst", "coat": "Pt"}], "inputs": P.get("inputs") or ["CO", "NO", "C3H8"],
                      "map": P.get("map") or {}, "reactions": [{"proc": f"r{k}", "site": r.get("site", "Pt"), "eq": r["eq"]} for k, r in enumerate(rx)],
                      "roles": {r: sc.pid(r) for r in ("converter", "inlet", "outlet", "monolith", "channels", "catalyst", "surface", "gas")}})
    S["show"].setdefault(sc.pid("converter"), 0.0)
    for k, r in enumerate(rx):
        if f"r{k}" in st:
            S["tex"].append({"id": f"eq{k}", "tex": _chem_tex(r["eq"]), "box": [1.6, -1.25 - 1.05 * k, 6.9, -0.35 - 1.05 * k], "show": round(st[f"r{k}"] + 0.3, 3), "size": 38})


def _chem_tex(eq):
    def term(t):
        t = t.strip()
        m = re.match(r"^(\d*)\s*(.+)$", t)
        c, f = m.group(1), m.group(2)
        f = re.sub(r"(\d+)", r"_{\1}", f)
        return (c + r"\," if c else "") + r"\mathrm{" + f + "}"
    L, _, R = eq.replace("→", "->").partition("->")
    return " + ".join(term(x) for x in L.split("+")) + r" \rightarrow " + " + ".join(term(x) for x in R.split("+"))


def solve_projectile(sc: Scene):
    sc.S["drawn"] = ["ball", "cannon", "launcher", "ground", "trajectory", "parabola", "path", "launch angle", "angle", "theta", "velocity", "launch velocity", "components", "horizontal component", "vertical component", "gravity", "max height", "maximum height", "range", "time"]  # what this solver always draws (completeness gate)
    S = sc.S
    v0, th, g = _q(sc.G, "v0", 20.0), _q(sc.G, "theta", 45.0), _q(sc.G, "g", 9.81)
    st = {}

    def h(e, a, z, b):
        if e == "launch":
            st.setdefault("launch", a)
            st.setdefault("launch_end", z)
        elif e in ("angle", "velocity", "components", "gravity", "height", "range", "equation"):
            st.setdefault(e, a)
            st[e + "_end"] = z
        elif e.startswith("readout:"):
            st.setdefault("ro:" + e.split(":")[1], a)
    _common_beats(sc, h)
    # the flight lasts from the launch until the sentence that lands it (height / range), so the narration of the
    # components and gravity plays over the moving ball instead of a ball already on the ground
    f0 = st.get("launch", sc.D * 0.3)
    f1 = st.get("height_end") or st.get("range") or st.get("launch_end") or sc.D * 0.7
    if st.get("height_end") and st.get("range") and st["range"] > st["height_end"]:
        f1 = st["range"]
    if f1 - f0 < 2.0:
        f1 = min(sc.D - 0.5, f0 + 3.0)
    sc.key("fly", f0, f1, 1.0)
    sc.finish_procs(linear=("fly",))
    for q, e, c, n, u in (("v0", v0, "navy", "launch speed", "m/s"), ("theta", th, "clay", "launch angle", "deg"), ("g", g, "plum", "gravity", "m/s^2"),
                          ("vx", "v0*cos(theta*pi/180)", "amber", "horizontal velocity", "m/s"), ("vy", "v0*sin(theta*pi/180)", "rose", "vertical velocity", "m/s"),
                          ("R", "v0**2*sin(2*theta*pi/180)/g", "green", "range", "m"), ("H", "(v0*sin(theta*pi/180))**2/(2*g)", "teal", "maximum height", "m")):
        sc.quantity(q, e, c, n, u)
    fly = sc.keys["fly"][0]
    t = lambda k, d: round(st.get(k, d), 3)  # noqa: E731
    T_ = 2 * v0 * math.sin(math.radians(th)) / g
    vx_, vy_ = v0 * math.cos(math.radians(th)), v0 * math.sin(math.radians(th))
    sc.quantity("tf", f"fly*{T_:.6f}", "navy", "flight time", "s")
    sc.quantity("vyt", f"{vy_:.6f}-{g}*tf", "rose", "vertical velocity", "m/s")
    lim = math.ceil(max(vx_, vy_) / 5) * 5
    S["graphs"].append({"id": "vel", "box": [-6.9, 0.55, 0.9, 3.95], "x": "tf", "y": "vyt", "x_range": [0, round(T_ * 1.05, 2)], "y_range": [-lim, lim],
                        "x_step": round(max(0.5, round(T_ / 4 * 2) / 2), 2), "y_step": lim / 2, "y_numbers": [-lim, 0, lim],
                        "x_label": r"\text{time } t\ (\mathrm{s})", "y_label": r"\text{velocity } (\mathrm{m/s})",
                        "refs": [{"y": round(vx_, 3), "tex": r"v_x=v_0\cos\theta"}], "show": t("components", fly[0] - 0.5), "from": fly[0], "x_axis_at_zero": True})
    S["rigs"].append({"type": "projectile", "box": [-6.9, -3.7, 6.9, 0.9], "fly": "fly", "ghost_show": round(fly[1] + 0.2, 3),
                      "roles": {r: sc.pid(r) for r in ("ball", "launcher", "ground", "path")}})
    for r in ("ground", "launcher"):
        S["show"].setdefault(sc.pid(r), 0.0)
    S["show"].setdefault(sc.pid("ball"), round(min(fly[0], 1.0), 3))
    S["annotations"] += [
        {"id": "theta", "kind": "angle", "at": "O", "from": "ground", "to": "v0_tip", "tex": r"\theta", "q": "theta", "unit": "deg", "show": t("angle", 0.8), "r": 0.9},
        {"id": "v0", "kind": "vector", "from": "O", "to": "v0_tip", "tex": "v_0", "q": "v0", "unit": "m/s", "show": t("velocity", t("angle", 0.8) + 0.6)},
        {"id": "v0x", "kind": "vector", "from": "O", "to": "v0x_tip", "tex": r"v_0\cos\theta", "color": "amber", "show": t("components", fly[0] - 0.5), "label_side": "right", "sw": 4},
        {"id": "v0y", "kind": "vector", "from": "O", "to": "v0y_tip", "tex": r"v_0\sin\theta", "color": "rose", "show": t("components", fly[0] - 0.5), "sw": 4},
        {"id": "v", "kind": "vector", "from": "ball", "to": "v_tip", "tex": r"\vec v", "color": "navy", "show": round(fly[0] + 0.15 * (fly[1] - fly[0]), 3), "hide": round(fly[1], 3)},
        {"id": "g", "kind": "force", "from": "ball", "to": "g_tip", "tex": "g", "q": "g", "unit": "m/s^2", "show": t("gravity", fly[0] + 0.5), "label_side": "left", "hide": round(fly[1], 3)},
        {"id": "H", "kind": "dim", "a": "apex_ground", "b": "apex", "tex": "H", "q": "H", "unit": "m", "side": "right", "show": max(t("height", fly[1]), (fly[0] + fly[1]) / 2)},
        {"id": "R", "kind": "brace", "a": "O", "b": "land", "tex": "R", "q": "R", "unit": "m", "side": "down", "show": max(t("range", fly[1]), fly[1])}]
    # the components with their values (what the second sentence computes), then H and R, in the right column
    t_c = t("components", fly[0] + 0.5)
    S["tex"].append({"id": "vx_val", "tex": rf"v_x=v_0\cos\theta={vx_:.1f}\,\mathrm{{m/s}}", "box": [1.3, 3.2, 6.9, 3.95], "show": t_c, "size": 38})
    S["tex"].append({"id": "vy_val", "tex": rf"v_y=v_0\sin\theta={vy_:.1f}\,\mathrm{{m/s}}", "box": [1.3, 2.45, 6.9, 3.2], "show": round(t_c + 0.8, 3), "size": 38})
    S["tex"].append({"id": "eqH", "tex": r"H=\frac{v_0^2\sin^2\theta}{2g}", "box": [1.3, 1.0, 4.1, 2.4], "show": t("height", fly[1] - 1.0), "size": 40,
                     "hide": None})
    S["tex"].append({"id": "eq", "tex": r"R=\frac{v_0^2\sin 2\theta}{g}", "box": [4.1, 1.0, 6.9, 2.4], "show": t("equation", t("range", fly[1] + 0.5)), "size": 40})


def solve_board(sc: Scene):
    S, G = sc.S, sc.G
    items = copy.deepcopy(G.get("items") or [])
    reveal = {}
    steps = {}
    shifts = {}

    def h(e, a, z, b):
        if e == "step":
            for it in items:
                if it.get("algorithm"):
                    n = len(sc.keys.get("algo_" + it["id"], []))
                    cur = sc.keys["algo_" + it["id"]][-1][2] if n else 0
                    sc.key("algo_" + it["id"], a, z, cur + 1)
        elif e == "run":
            for it in items:
                if it.get("algorithm"):
                    steps.setdefault(it["id"], []).append((a, z))
        elif e.startswith("shift:"):
            shifts.setdefault(e.split(":", 1)[1], (a, z))
        elif e.startswith("reveal:"):
            reveal.setdefault(e.split(":", 1)[1], a)
    _common_beats(sc, h)
    import gm_rigs
    for it in items:
        it["show"] = round(reveal.get(it.get("id"), 0.0), 3)
        if it.get("algorithm") == "dijkstra":
            nodes = [n["id"] for n in it.get("nodes") or []]
            total = len(nodes)
            it["proc"] = "algo_" + it["id"]
            for a, z in steps.get(it["id"], []):
                cur = sc.keys.get(it["proc"], [[0, 0, 0]])[-1][2]
                sc.key(it["proc"], a, z, total)
            if it["proc"] not in sc.keys:
                sc.key(it["proc"], sc.D * 0.2, sc.D * 0.85, total)
        if it.get("algorithm") == "binary_search":
            it["proc"] = "algo_" + it["id"]
            n = len(gm_rigs._binary_search(it["values"], it.get("target")))
            for a, z in steps.get(it["id"], []):
                sc.key(it["proc"], a, z, n)
            if it["proc"] not in sc.keys:
                sc.key(it["proc"], sc.D * 0.2, sc.D * 0.85, n)
        if it.get("type") == "chart":
            it.setdefault("x_label", "x")
            it.setdefault("y_label", "y")
            for c in it.get("curves") or []:
                expr = str(c.get("expr", "x"))
                sid = c.get("id")
                if sid in shifts:
                    a, z = shifts[sid]
                    proc = "shift_" + sid
                    sc.key(proc, a, z, 1.0)
                    try:  # a shift moves the curve along the quantity axis (demand / supply shift right or left)
                        by = float(str(c.get("shift_by", "+2")).replace(" ", "").replace("+", "") or 2)
                    except ValueError:
                        by = 2.0
                    c["shift_dx"] = by
                    c["shift_proc"], c["ghost_at"], c["ghost_show"], c["shift_end"] = proc, 0.0, round(a, 3), round(z, 3)
            if it.get("equilibrium") is True:
                it["equilibrium"] = [0, 1]
        if it.get("region"):
            import gm_parts
            it["box"] = gm_parts.grid_box(it["region"]).list()
            if G.get("equation") and it["box"][3] > 2.9:  # the equation strip at the top stays free
                it["box"][3] = 2.9
    sc.finish_procs(linear=tuple(k for k in sc.keys if k.startswith("algo_")))
    S["rigs"].append({"type": "board", "box": [-7, -4, 7, 4], "items": items})
    if G.get("equation"):
        S["tex"].append({"id": "eq", "tex": G["equation"], "box": [1.0, 3.0, 6.9, 3.9], "show": round(sc.D * 0.7, 3), "size": 40})


SOLVERS = {"fluid_link": solve_fluid_link, "dissection": solve_dissection, "cable_signal": solve_cable, "binding": solve_binding,
           "gear_differential": solve_differential, "flow_reactor": solve_flow, "projectile": solve_projectile, "board": solve_board}


def solve(G: dict, sents: list[dict]) -> dict:
    solver = G.get("solver")
    if solver not in SOLVERS:
        raise ValueError(f"no solver {solver!r}")
    sc = Scene(G, sents, solver)
    SOLVERS[solver](sc)
    prune(sc)
    label_all_parts(sc)
    beats = []
    for s_ in sents:
        sw = _words(s_["text"])
        sc_ = sorted(((len(_words(p.get("name") or "") & sw), sc.pid(r)) for r, p in sc.roles.items() if sc.pid(r) in sc.S["show"]), key=lambda x: -x[0])
        named = [pid for n, pid in sc_ if n > 0]
        beats.append({"t0": s_["t0"], "t1": s_["t1"], "parts": named})
    sc.S["_beats"] = beats
    sc.S["notes"] = sc.notes
    return sc.S


def label_all_parts(sc: Scene):
    """Completeness: every named sub-part the rig draws carries a label (spider gears, side gears ... even when the
    narration does not say them); staggered after the narrated labels so the hand writes them one by one."""
    rig_roles = set()
    for r in sc.S.get("rigs") or []:
        rig_roles |= set((r.get("roles") or {}).values())
    have = {L["part"] for L in sc.S["labels"]}
    ts = sorted(L["show"] for L in sc.S["labels"])
    base = ts[len(ts) // 2] if ts else sc.D * 0.3
    k = 0
    for role, p in sc.roles.items():
        pid = sc.pid(role)
        if pid in have or pid not in rig_roles:
            continue
        t = min(max(base, sc.S["show"].get(pid, 0.0)) + 0.7 * (k + 1), sc.D * 0.85)
        sc.S["labels"].append({"id": "L_" + role, "text": (p or {}).get("name") or role.replace("_", " "), "part": pid, "show": round(t, 3), "auto": True})
        sc.notes.append(f"labelled named part {pid!r} (completeness)")
        have.add(pid)
        k += 1


def prune(sc: Scene):
    """To the point: a label survives only if its part is named in the narration (or listed for that sentence);
    a readout only if its quantity is spoken or driven; nothing decorative."""
    text = " ".join(s["text"] for s in sc.sents).lower()
    tw = _words(text)
    keep = []
    for L in sc.S["labels"]:
        lw = _words(L["text"])
        if lw & tw or not lw or L.get("keep"):
            keep.append(L)
        else:
            sc.notes.append(f"pruned label {L['text']!r}: not in the narration")
    sc.S["labels"] = keep


# ───────────── Gates (symbolic scene graph, before any render) ─────────────
FRAME = (-7.11, -4.0, 7.11, 4.0)


def gates(S: dict, G: dict, sents: list[dict]) -> dict:
    import gm_parts
    a = gm_parts.analyze(S, step=0.25)
    hard, soft = [], []
    D = a["duration"]
    # off-frame / overlaps per sampled frame
    seen = set()
    for fr in a["frames"]:
        items = [it for it in fr["items"] if it["kind"] != "backdrop"]
        for it in items:
            b = it["b"]
            out = max(FRAME[0] + 0.05 - b[0], b[2] - FRAME[2] + 0.05, FRAME[1] + 0.05 - b[1], b[3] - FRAME[3] + 0.05)
            if out > 0.02 and ("off", it["id"]) not in seen:
                seen.add(("off", it["id"]))
                hard.append(f"{it['id']} leaves the frame by {out:.2f} at {fr['t']}s")
        tx = [it for it in items if it["kind"] in ("label", "panel") or it["id"].startswith("annot:")]
        for i in range(len(tx)):
            for j in range(i + 1, len(tx)):
                A, B_ = tx[i]["b"], tx[j]["b"]
                w = min(A[2], B_[2]) - max(A[0], B_[0])
                h = min(A[3], B_[3]) - max(A[1], B_[1])
                if w > 0.05 and h > 0.05:
                    small = min((A[2] - A[0]) * (A[3] - A[1]), (B_[2] - B_[0]) * (B_[3] - B_[1])) or 1
                    if w * h / small > 0.25 and ("ov", tx[i]["id"], tx[j]["id"]) not in seen:
                        seen.add(("ov", tx[i]["id"], tx[j]["id"]))
                        soft.append(f"{tx[i]['id']} overlaps {tx[j]['id']} at {fr['t']}s")
    # layout gates (repaired deterministically, reported when a repair cannot clear them; they do not discard the clip):
    # text on drawn bodies (annotation text that could not find a free spot) and vectors too short to read
    layout = []
    for aid, (sc_, t_) in (a.get("text_over") or {}).items():
        if sc_ > 0.06:
            layout.append(f"annot:{aid} text sits on a drawn shape at {t_}s")
    for aid, L_ in (a.get("vec_len") or {}).items():
        if L_ < 0.55:
            layout.append(f"vector annot:{aid} is too short to read ({L_:.2f})")
    # empty halves: after the opening, no half of the frame stays (nearly) empty for more than 4 s
    halves = ("left", "right", "top", "bottom")
    run = {k: None for k in halves}
    empty = []
    for fr in a["frames"]:
        if fr["t"] < 1.5 or "halves" not in fr:
            continue
        for k_ in halves:
            frac = fr["halves"][k_]
            if frac < 0.10:
                run[k_] = run[k_] if run[k_] is not None else fr["t"]
            else:
                if run[k_] is not None and fr["t"] - run[k_] > 4.0:
                    empty.append((k_, run[k_], fr["t"]))
                run[k_] = None
    for k_, t0_ in run.items():
        if t0_ is not None and D - t0_ > 4.0:
            empty.append((k_, t0_, D))
    for k_, t0_, t1_ in empty:
        layout.append(f"the {k_} half of the frame is empty from {t0_}s to {t1_}s")
    # fill: the union of what is drawn must reach a meaningful share of the frame (best frame of the second half)
    fill = 0.0
    for fr in a["frames"][len(a["frames"]) // 2:]:
        bodies = [it["b"] for it in fr["items"] if it["kind"] in ("body", "image", "panel", "annot", "label")]
        if bodies:
            x0, y0 = max(-7.11, min(b[0] for b in bodies)), max(-4.0, min(b[1] for b in bodies))
            x1, y1 = min(7.11, max(b[2] for b in bodies)), min(4.0, max(b[3] for b in bodies))
            fill = max(fill, (x1 - x0) * (y1 - y0) / (14.22 * 8))
    if fill < 0.28:
        hard.append(f"content fills only {fill:.0%} of the frame")
    # motion coverage: longest stretch with nothing moving (bodies, annotations, curves)
    iv = [(t - 0.25, t) for k, v in a["motion"].items() for t, d in v if d > 0.004]
    first_seen = {}
    for fr in a["frames"]:
        for it in fr["items"]:
            first_seen.setdefault(it["id"], fr["t"])
    iv += [(t - 0.2, t + 0.9) for eid, t in first_seen.items() if eid != "backdrop"]  # drawn in by the hand
    iv += [(float(f["t"]), float(f["t"]) + 1.0) for f in S.get("focus") or []]  # the hand circling a part
    iv.sort()
    gaps, last = [], 0.0
    for x, y in iv:
        if x - last > 2.0:
            gaps.append((round(last, 2), round(x, 2)))
        last = max(last, y)
    if D - last > 2.0:
        gaps.append((round(last, 2), round(D, 2)))
    moving_t = sorted({round(t, 3) for x, y in iv for t in (x, (x + y) / 2, y)})
    if gaps:
        soft.append("still stretches > 2 s: " + ", ".join(f"{x}-{y}s" for x, y in gaps))
    # narrated change: every beat with an event shows a measurable change somewhere in its window
    for s, b in _beat_events(G, sents):
        if b.get("events"):
            mv = [t for t in moving_t if s["t0"] - 0.1 <= t <= s["t1"] + 0.1]
            if not mv:
                hard.append(f"sentence {b.get('s')} ('{s['text'][:40]}') narrates {b['events']} but nothing changes")
    # proportions / fits / kinematics declared by the rigs
    for c in a["checks"]:
        if c.get("type") == "ratio" and abs(c["drawn"] - c["declared"]) > 0.03 * c["declared"]:
            hard.append(f"proportion {c['what']}: drawn {c['drawn']} vs declared {c['declared']}")
        if c.get("type") == "fits_into" and not c.get("ok"):
            hard.append(f"guest does not fit the pocket (overlap {c['overlap_frac']}, inside {c['inside_frac']})")
        if c.get("type") == "kinematics" and abs(c["drawn_R_over_H"] - c["declared_R_over_H"]) > 0.02 * c["declared_R_over_H"]:
            hard.append("trajectory shape does not match R/H")
    # readouts == quantities (by construction they read World; verify on samples)
    # axis labels: every graph carries both labels with units
    for g in S.get("graphs") or []:
        for k in ("x_label", "y_label"):
            if not g.get(k):
                hard.append(f"graph {g['id']} has no {k}")
            elif "(" not in g[k] and g.get("x_numbers", True) is not False and k == "y_label":
                soft.append(f"graph {g['id']} {k} lacks a unit")
    for it in (S["rigs"][0].get("items") or []) if S.get("rigs") else []:
        if it.get("type") == "chart" and (not it.get("x_label") or not it.get("y_label")):
            hard.append(f"chart {it['id']} lacks an axis label")
    # a label must point at something drawn when it appears (its leader ends on a visible body)
    report_delay = {}
    for L in a.get("labels") or []:
        if L.get("follow"):
            continue
        px, py = L["p"]
        hit = None
        for fr in a["frames"]:
            if fr["t"] < L["show"] + 0.9:
                continue
            for it in fr["items"]:
                if it["kind"] in ("body", "image"):
                    b = it["b"]
                    if b[0] - 0.25 <= px <= b[2] + 0.25 and b[1] - 0.25 <= py <= b[3] + 0.25:
                        hit = fr["t"]
                        break
            if hit is not None:
                break
        if hit is None:
            hard.append(f"label {L['id']} points at nothing")
            report_delay[L["id"]] = None
        elif hit > L["show"] + 1.2:
            soft.append(f"label {L['id']} appears before its part ({L['show']}s < {hit}s)")
            report_delay[L["id"]] = hit
    # completeness: everything required is drawn and labelled somewhere
    shown_text = " ".join(list(S.get("drawn") or []) + [L["text"] for L in S["labels"]] + [r.get("tex", "") for r in S["readouts"]] + [x.get("tex", "") + " " + x.get("id", "") + " " + x.get("text", "") for x in S["annotations"]] +
                          [t.get("tex", "") for t in S["tex"]] + [str(g.get(k, "")) for g in S["graphs"] for k in ("x_label", "y_label")] +
                          [json.dumps(it) for r in S["rigs"] for it in r.get("items") or []] + [q.get("name", "") + " " + q["id"] for q in S["quantities"] if any(q["id"] == r["q"] for r in S["readouts"])] +
                          [json.dumps(S["rigs"][0].get("roles", {})) if S.get("rigs") else ""] + [p.get("name", "") for p in G.get("parts") or []] +
                          [f"{q.get('id')} {q.get('name', '')} {q.get('symbol', '')}" for q in G.get("quantities") or [] if q.get("id") in (G.get("_consumed") or [])]).lower()
    missing = []
    for req in G.get("required") or []:
        w = _words(req) or {str(req).lower()}
        if not any(x in shown_text for x in w):
            missing.append(req)
    if missing:
        soft.append("required but not shown: " + ", ".join(map(str, missing)))
    # every named sub-part the rig draws must be labelled (the "drawn" list does not excuse an unnamed part)
    rig_roles = set()
    for r in S.get("rigs") or []:
        rig_roles |= set((r.get("roles") or {}).values())
    labelled = {L["part"] for L in S["labels"]}
    unl = [p.get("name") or p.get("id") for p in G.get("parts") or [] if p.get("id") in rig_roles and p.get("id") not in labelled]
    if unl:
        soft.append("named part not labelled: " + ", ".join(map(str, unl)))
        missing = missing + unl
    # where every text element sits over the clip (det_fix uses it to move a label off another text)
    tboxes = {}
    for fr in a["frames"]:
        for it in fr["items"]:
            if it["kind"] in ("label", "panel") or it["id"].startswith("annot:") or it["id"].startswith("tex:"):
                b = it["b"]
                o = tboxes.get(it["id"])
                tboxes[it["id"]] = b if o is None else [min(o[0], b[0]), min(o[1], b[1]), max(o[2], b[2]), max(o[3], b[3])]
    first = {}
    for fr in a["frames"]:
        for it in fr["items"]:
            first.setdefault(it["id"], (fr["t"], it["b"], it["kind"]))
    ov = [x for x in soft if " overlaps " in x]
    return {"hard": hard, "soft": soft, "layout": layout, "overlaps": ov, "fill": round(fill, 3), "gaps": gaps, "checks": a["checks"], "issues": a["issues"], "missing": missing, "label_delay": report_delay,
            "empty": empty, "tboxes": tboxes, "first": first}


def fill_still(S: dict, gaps: list) -> bool:
    """stretch the transition next to a still gap across it (slower, continuous motion instead of a pause)"""
    changed = False
    for a, b in gaps:
        best = None
        for p in S.get("processes") or []:
            if p.get("kind") == "rate":
                continue
            ks = p.get("keys") or []
            for i, k in enumerate(ks):
                if len(k) > 3:  # a reset is never slowed down (it would read as a narrated change)
                    continue
                nxt = ks[i + 1][0] if i + 1 < len(ks) else S["duration"]
                prv = ks[i - 1][1] if i > 0 else 0.0
                if abs(k[1] - a) < 0.6 and nxt > k[1] + 0.2:
                    best = (k, "end", min(b - 0.1, nxt - 0.05, k[1] + 3.0))
                elif abs(k[0] - b) < 0.6 and k[0] > prv + 0.2:
                    best = best or (k, "start", max(a + 0.1, prv + 0.05, k[0] - 3.0))
        if best:
            k, which, v = best
            if which == "end":
                a = max(a, v)
                k[1] = round(max(k[1], v), 3)
            else:
                b = min(b, v)
                k[0] = round(min(k[0], v), 3)
            changed = True
        # what is left: the hand circles the part the sentence is about, every ~1.8 s (attention, not fake mechanism)
        t = a + 0.4
        while t < b - 0.8:
            tgt = _gap_target(S, t)
            if not tgt:
                break
            S.setdefault("focus", []).append({"t": round(t, 3), "part": tgt})
            changed = True
            t += 1.8
    return changed


def _gap_target(S, t):
    for b in S.get("_beats") or []:  # the part the current sentence names
        if b["t0"] <= t < b["t1"] and b.get("parts"):
            return b["parts"][0]
    labs = sorted([L for L in S.get("labels") or [] if L["show"] <= t], key=lambda L: -L["show"])
    if labs:
        return labs[0]["part"]
    shown = sorted([(v, k) for k, v in (S.get("show") or {}).items() if v <= t])
    return shown[-1][1] if shown else None


def det_fix(S: dict, report: dict) -> bool:
    """deterministic repairs for gate findings: pull labels inward, stretch motion over still gaps; True if changed"""
    changed = False
    for lid, t in (report.get("label_delay") or {}).items():
        for L in list(S["labels"]):
            if L["id"] == lid:
                if t is None:
                    S["labels"].remove(L)
                else:
                    L["show"] = round(t - 0.6, 3)
                changed = True
    if report.get("gaps"):
        changed = fill_still(S, report["gaps"]) or changed
    halves = {"left": lambda c: c[0] < 0, "right": lambda c: c[0] > 0, "top": lambda c: c[1] > 0, "bottom": lambda c: c[1] < 0}
    t_open = min([b["t0"] for b in S.get("_beats") or []] + [S.get("duration", 10) * 0.05])
    for half, t0_, t1_ in report.get("empty") or []:
        for eid, (tf, b, kind) in (report.get("first") or {}).items():
            c = ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
            if tf <= t0_ + 0.3 or not halves[half](c):
                continue
            new_t = round(max(t_open, min(t0_, 1.0)), 3)
            if eid.startswith("graph:"):  # a graph (axes + labels) can be on screen before its curve starts
                for g_ in S.get("graphs") or []:
                    if "graph:" + g_["id"] == eid and g_.get("show", 0) > new_t:
                        g_.setdefault("from", g_.get("show", 0.0))
                        g_["show"] = new_t
                        changed = True
            elif kind in ("body", "image") and eid in (S.get("show") or {}) and S["show"][eid] > new_t and eid not in (S.get("_late_ok") or []):
                S["show"][eid] = new_t
                changed = True
    seen_pairs = set()
    for sft in report.get("soft") or []:
        m = re.match(r"(label:(\S+)) overlaps (\S+) at", sft) or re.match(r"(\S+) overlaps (label:(\S+)) at", sft)
        if not m:
            continue
        if sft.startswith("label:"):
            lid, other = m.group(2), m.group(3)
        else:
            lid, other = m.group(3), m.group(1)
        ob = (report.get("tboxes") or {}).get(other)
        if ob and (lid, other) not in seen_pairs:
            seen_pairs.add((lid, other))
            for L in S["labels"]:
                if L["id"] == lid:
                    L.setdefault("avoid_boxes", []).append([round(x, 3) for x in ob])
                    changed = True
    for h in report["hard"]:
        m = re.match(r"(label:\S+) leaves the frame", h)
        if m:
            S["labels"] = [L for L in S["labels"] if "label:" + L["id"] != m.group(1)] + [dict(L, size=20) for L in S["labels"] if "label:" + L["id"] == m.group(1)]
            changed = True
    return changed


# ───────────── Rendering, frames, critic ─────────────
def render(S: dict, workdir: str, quality="-qm", timeout=420) -> dict:
    import gm_parts
    os.makedirs(workdir, exist_ok=True)
    src = os.path.join(workdir, "scene.py")
    pen_tail = "\n\nimport sys as _pen_sys\n_pen_sys.path.insert(0, '/root')\ntry:\n    import pen_export  # noqa: F401,E402\nexcept Exception as _pen_err:  # noqa: BLE001\n    print('pen_export unavailable:', _pen_err)\n"
    with open(src, "w") as f:
        f.write(gm_parts.scene_code(S) + pen_tail)
    env = {**os.environ, "PYTHONPATH": HERE + os.pathsep + os.environ.get("PYTHONPATH", ""), "GM_GATE_PATH": os.path.join(workdir, "gate.json"), "PEN_EXPORT_PATH": os.path.join(workdir, "pen.json")}
    t0 = time.time()
    p = subprocess.run([sys.executable, "-m", "manim", quality, "--format", "mp4", "--media_dir", os.path.join(workdir, "media"), "--disable_caching", "--progress_bar", "none", src, "GeneratedScene"],
                       cwd=workdir, env=env, capture_output=True, text=True, timeout=timeout)
    out = {"render_s": round(time.time() - t0, 1), "ok": p.returncode == 0}
    if p.returncode:
        out["error"] = ((p.stdout or "")[-1200:] + "\n" + (p.stderr or "")[-2500:]).strip()
        return out
    vids = [os.path.join(r, f) for r, _, fs in os.walk(os.path.join(workdir, "media", "videos")) for f in fs if f.endswith(".mp4") and "partial" not in r]
    out["video"] = vids[0]
    gp = os.path.join(workdir, "gate.json")
    out["gate"] = json.load(open(gp)) if os.path.exists(gp) else {}
    out["pen"] = os.path.join(workdir, "pen.json") if os.path.exists(os.path.join(workdir, "pen.json")) else None
    return out


def contact_sheet(video: str, out_png: str, n=9, width=640) -> bytes | None:
    d = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]).decode().strip() or 0)
    files = []
    tmp = os.path.dirname(out_png)
    for i in range(n):
        t = d * (i + 0.5) / n
        fp = os.path.join(tmp, f"_cs{i}.jpg")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", video, "-frames:v", "1", "-vf",
                        f"scale={width}:-1,drawtext=text='{t:.1f}s':x=8:y=8:fontsize=22:fontcolor=red", "-q:v", "3", fp])
        if os.path.exists(fp):
            files.append(fp)
    if not files:
        return None
    cols = 3
    h = int(width * 9 / 16)
    lay = "|".join(f"{(i % cols) * width}_{(i // cols) * h}" for i in range(len(files)))
    args = ["ffmpeg", "-y", "-loglevel", "error"]
    for f in files:
        args += ["-i", f]
    args += ["-filter_complex", "".join(f"[{i}:v]" for i in range(len(files))) + f"xstack=inputs={len(files)}:layout={lay}:fill=white", out_png]
    subprocess.run(args)
    if not os.path.exists(out_png):
        return None
    jpg = out_png.rsplit(".", 1)[0] + ".jpg"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", out_png, "-q:v", "4", jpg])
    return open(jpg, "rb").read()


def checklist(G: dict, S: dict) -> list[str]:
    """yes/no questions generated from the part graph itself (relations, ratios, events, labels)"""
    names = {p.get("id"): p.get("name") or p.get("role") for p in G.get("parts") or []}
    qs = []
    solver = G.get("solver")
    for r in G.get("relations") or []:
        a, b = names.get(r.get("a"), r.get("a")), names.get(r.get("b"), r.get("b"))
        rel = r.get("rel")
        if rel == "inside":
            qs.append(f"Is the {a} drawn inside the {b}?")
        elif rel == "fits_into":
            qs.append(f"Does the {a} sit snugly in the {b}'s pocket in some frame?")
        elif rel == "connected_by":
            qs.append(f"Are the {a} and the {b} visibly connected?")
        elif rel == "meshes_with":
            qs.append(f"Do the {a} and {b} touch where they mesh?")
        elif rel == "ratio":
            qs.append(f"Is the {a} visibly larger than the {b}?")
    extra = {
        "fluid_link": ["Is the large piston visibly wider than the small piston?", "Does the small piston move down while the large piston rises a smaller distance?"],
        "dissection": ["Do the wedges end up laid side by side, alternating up and down, forming a near-rectangle?"],
        "cable_signal": ["Is there a neuron with branching dendrites, a cell body and a long axon?", "Does the voltage trace show a spike rising to about +40 mV and falling back?"],
        "binding": ["Do the substrate shapes fit the enzyme's pocket?", "Does the enzyme change shape (close) around the substrates?"],
        "gear_differential": ["Are the two wheels connected through gears in a central housing?", "Is the outer wheel speed shown larger than the inner one when turning?"],
        "flow_reactor": ["Is there a converter body with many parallel channels between an inlet and an outlet pipe?", "Do molecules (ball-and-stick) appear on a catalyst surface?"],
        "projectile": ["Is the launch angle marked with an arc and labelled?", "Is the path a parabola from the launcher back to the ground?"],
        "board": ["Is every axis or node labelled?"],
    }.get(solver, [])
    qs += extra
    qs += ["Is all text readable and not overlapping other text?", "Is everything inside the frame (nothing cut off at the edges)?"]
    return qs[:10]


def _sheet_pair(a: bytes, b: bytes, wd: str) -> list[bytes]:
    return [a, b]


def tournament(cands: list[dict], G0: dict, text: str, log: list) -> int:
    if len(cands) < 2:
        return 0
    qs = checklist(cands[0]["G"], cands[0]["S"])
    try:
        out = ask_json(PAIR_PROMPT.format(idea=G0.get("idea", ""), text=text[:1200], questions="\n".join(f"{i + 1}. {q}" for i, q in enumerate(qs))),
                       images=[cands[0]["sheet"], cands[1]["sheet"]], temperature=0.1, timeout=90, log=log)
        log.append(f"stage pairwise: {LAST_MODEL.get('model')} -> {out.get('better')} ({str(out.get('why'))[:120]})")
        ya, yb = sum(1 for x in out.get("A") or [] if x), sum(1 for x in out.get("B") or [] if x)
        if out.get("better") == "B" and yb >= ya - 1:
            return 1
        if out.get("better") == "A":
            return 0
        return 1 if yb > ya else 0
    except Exception as exc:  # noqa: BLE001
        log.append(f"pairwise skipped: {exc}")
        return 0


def final_check(sheet: bytes, G: dict, S: dict, log: list) -> dict:
    qs = checklist(G, S)
    try:
        out = ask_json(CHECK_PROMPT.format(idea=G.get("idea", ""), questions="\n".join(f"{i + 1}. {q}" for i, q in enumerate(qs))), images=[sheet], temperature=0.1, timeout=90, log=log)
        ans = out.get("answers") or []
        log.append(f"stage checklist: {LAST_MODEL.get('model')} {sum(1 for x in ans if x)}/{len(qs)} yes")
        return {"questions": qs, "answers": ans, "problems": out.get("problems") or []}
    except Exception as exc:  # noqa: BLE001
        log.append(f"checklist skipped: {exc}")
        return {"questions": qs, "answers": [], "skipped": True}


# ───────────── Episodic memory (successful part graphs + pitfalls), Modal Dict or local file ─────────────
MEM_FILE = os.path.join(HERE, "gm_memory.json")


def _mem_store():
    try:
        import modal
        return modal.Dict.from_name("gm-episodic", create_if_missing=True)
    except Exception:  # noqa: BLE001
        return None


def recall(desc: str, k=2) -> list[dict]:
    items = []
    try:
        items += json.load(open(MEM_FILE)).get("graphs", [])
    except Exception:  # noqa: BLE001
        pass
    d = _mem_store()
    if d is not None:
        try:
            items += d.get("graphs", []) or []
        except Exception:  # noqa: BLE001
            pass
    stop = {"animated", "explanation", "curious", "learner", "secondary", "school", "first", "year", "university", "student", "how", "the", "for", "and", "works", "why", "what"}
    w = _words(desc) - stop
    scored = sorted(items, key=lambda it: -len(w & _words(it.get("topic", "") + " " + it.get("solver", ""))))
    return [x for x in scored[:k] if len(w & (_words(x.get("topic", "")) - stop)) >= 2]


def remember(desc: str, G: dict, pitfalls: list[str]):
    d = _mem_store()
    if d is None:
        return
    try:
        cur = d.get("graphs", []) or []
        cur = [x for x in cur if x.get("topic") != desc][-40:]
        cur.append({"topic": desc, "solver": G.get("solver"), "graph": {k: G.get(k) for k in ("solver", "mode", "parts", "relations", "params", "quantities", "items")}, "pitfalls": pitfalls[:6]})
        d["graphs"] = cur
    except Exception:  # noqa: BLE001
        pass


# ───────────── The pipeline ─────────────
def make_graph(desc, sents, log, temperature=0.3, extra="", mem=None):
    sl = "\n".join(f"{i}: {s['text']}" for i, s in enumerate(sents))
    memo = ""
    if mem:
        memo = "Validated part graphs for related topics (follow their style, not their content):\n" + "\n".join(json.dumps(m["graph"])[:1500] + (" | pitfalls: " + "; ".join(m.get("pitfalls") or []) if m.get("pitfalls") else "") for m in mem)
    G = ask_json(GRAPH_PROMPT.format(desc=desc, sentences=sl, memory=memo, catalog=CATALOG) + extra, temperature=temperature, timeout=120, log=log, strong=True)
    log.append(f"stage part_graph(t={temperature}): {LAST_MODEL.get('model')} solver={G.get('solver')} fits={G.get('fits')}")
    return G


def fact_review(G, text, log):
    det = fact_checks(G, text)
    try:
        out = ask_json(FACT_PROMPT.format(text=text[:2500], graph=json.dumps({k: G.get(k) for k in ("solver", "parts", "relations", "params", "quantities", "beats", "equation", "items")})[:7000],
                                          det=json.dumps(det)[:1500]), temperature=0.1, timeout=90, log=log, strong=True)
        log.append(f"stage fact_check: {LAST_MODEL.get('model')} ok={out.get('ok')} problems={len(out.get('problems') or [])}")
        probs = det + [p for p in out.get("problems") or [] if isinstance(p, dict)]
    except Exception as exc:  # noqa: BLE001
        log.append(f"fact_check llm skipped: {exc}")
        probs = det
    return probs


def ensure_axis_units(S: dict, text: str, log: list) -> None:
    """every numbered axis names its quantity AND its unit; labels without a unit get one from the narration's context
    (one short LLM call for all of them), e.g. 'Quantity' -> 'Quantity (cups per day)'."""
    need = []
    for r_ in S.get("rigs") or []:
        for it in r_.get("items") or []:
            if it.get("type") == "chart":
                for k in ("x_label", "y_label"):
                    if "(" not in str(it.get(k, "")):
                        need.append((it, k))
    for g in S.get("graphs") or []:
        for k in ("x_label", "y_label"):
            numbered = g.get("x_numbers", True) is not False if k == "x_label" else True
            if numbered and g.get(k) and "(" not in str(g[k]) and "mathrm" not in str(g[k]):
                need.append((g, k))
    if not need:
        return
    labels = [str(o.get(k, "")) for o, k in need]
    try:
        out = ask_json("Axis labels of a teaching animation must name the quantity and its unit in parentheses. Narration: " + text[:1200] +
                       "\nFor each label give the same label with the right unit added, e.g. 'Quantity' -> 'Quantity (cups per day)', 'Price' -> 'Price ($ per cup)'. "
                       "Keep LaTeX labels in LaTeX (\\text{...}). Return JSON {\"labels\": [..same order..]}\nLabels: " + json.dumps(labels), temperature=0.1, timeout=60, log=log)
        new = (out or {}).get("labels") or []
        for (o, k), old_, nw in zip(need, labels, new):
            if isinstance(nw, str) and "(" in nw and len(nw) < 60:
                o[k] = nw
        log.append(f"stage axis_units: {LAST_MODEL.get('model')} {labels} -> {[o.get(k) for o, k in need]}")
    except Exception as exc:  # noqa: BLE001
        log.append(f"axis units: {str(exc)[:160]}")


def compose_parts(desc: str, narr: dict | None, workdir: str | None = None, log: list | None = None, n_cands: int = 2, budget_s: float = 780) -> dict:
    log = [] if log is None else log
    wd = workdir or tempfile.mkdtemp(prefix="gmp-")
    t0 = time.time()
    timings: dict = {}
    text = (narr or {}).get("text") or desc
    sents = sentences(narr, text)
    mem = recall(desc)
    if mem:
        log.append(f"memory: {len(mem)} related graphs")
    # 1. part graphs (best-of-N, parallel, different temperatures)
    temps = [0.25, 0.7][:max(1, n_cands)]
    with cf.ThreadPoolExecutor(len(temps)) as ex:
        futs = [ex.submit(make_graph, desc, sents, log, t, "", mem) for t in temps]
        graphs = []
        for f in futs:
            try:
                graphs.append(f.result())
            except Exception as exc:  # noqa: BLE001
                log.append(f"part graph failed: {str(exc)[:200]}")
    timings["graph_s"] = round(time.time() - t0, 1)
    graphs = [g for g in graphs if isinstance(g, dict) and g.get("fits") and g.get("solver") in SOLVERS]
    if not graphs:
        return {"ok": False, "error": "no solver fits this topic", "log": log, "timings": timings, "fallback": True}
    # 2. fact check (blocking problems -> one repair of that graph)
    t1 = time.time()
    checked = []
    facts = []
    for G in graphs:
        probs = fact_review(G, text, log)
        block = [p for p in probs if p.get("severity") == "block"]
        if block:  # up to two repairs of the graph with the checker's findings
            for _rep in range(2):
                try:
                    G2 = make_graph(desc, sents, log, 0.2, "\n\nA fact-checker found these errors in a previous part graph; fix them:\n" + json.dumps(block)[:2500], mem)
                    probs2 = fact_review(G2, text, log)
                    b2 = [p for p in probs2 if p.get("severity") == "block"]
                    if not b2 and G2.get("fits") and G2.get("solver") in SOLVERS:
                        facts.append({"solver": G.get("solver"), "first": probs, "after_fix": probs2})
                        checked.append(G2)
                        break
                    block = b2 or block
                except Exception as exc:  # noqa: BLE001
                    log.append(f"fact repair failed: {exc}")
            else:
                facts.append({"solver": G.get("solver"), "first": probs, "blocked": True, "last": block})
            continue
        facts.append({"solver": G.get("solver"), "first": probs})
        checked.append(G)
    timings["fact_s"] = round(time.time() - t1, 1)
    if not checked:
        return {"ok": False, "error": "fact check blocked every part graph", "facts": facts, "log": log, "timings": timings, "fallback": True}
    # 3. solve + symbolic gates
    t2 = time.time()
    cands = []
    for i, G in enumerate(checked):
        try:
            S = solve(G, sents)
            ensure_axis_units(S, text, log)
            rep = gates(S, G, sents)
            for _ in range(2):
                if (rep["hard"] or rep["gaps"] or rep.get("layout") or rep.get("overlaps")) and det_fix(S, rep):
                    rep = gates(S, G, sents)
                else:
                    break
            log.append(f"cand {i} {G.get('solver')}: hard={rep['hard'][:4]} layout={rep.get('layout', [])[:4]} soft={rep['soft'][:4]} fill={rep['fill']}")
            cands.append({"G": G, "S": S, "gate": rep})
        except Exception as exc:  # noqa: BLE001
            log.append(f"solve {i} failed: {type(exc).__name__}: {str(exc)[:300]}")
    timings["solve_s"] = round(time.time() - t2, 1)
    cands.sort(key=lambda c: (len(c["gate"]["hard"]), len(c["gate"].get("layout") or []), len(c["gate"]["soft"])))
    cands = [c for c in cands if not c["gate"]["hard"]] or cands[:1]
    if not cands:
        return {"ok": False, "error": "solver failed", "facts": facts, "log": log, "timings": timings, "fallback": True}
    if cands[0]["gate"]["hard"]:
        return {"ok": False, "error": "hard gates failed: " + "; ".join(cands[0]["gate"]["hard"][:5]), "facts": facts, "log": log, "timings": timings,
                "graph": cands[0]["G"], "scene": cands[0]["S"], "fallback": True}
    # 4. preview renders of distinct candidates + pairwise tournament
    t3 = time.time()
    distinct = [cands[0]]
    for c in cands[1:]:
        if json.dumps(c["S"], sort_keys=True) != json.dumps(cands[0]["S"], sort_keys=True):
            distinct.append(c)
    win = 0
    if len(distinct) > 1 and time.time() - t0 < budget_s * 0.4:
        with cf.ThreadPoolExecutor(2) as ex:
            rs = list(ex.map(lambda ic: render(ic[1]["S"], os.path.join(wd, f"prev{ic[0]}"), "-ql", 300), enumerate(distinct[:2])))
        ok = []
        for c, r in zip(distinct, rs):
            if r.get("ok"):
                c["sheet"] = contact_sheet(r["video"], os.path.join(wd, f"prev_{len(ok)}.png"), n=6, width=480)
                if c["sheet"]:
                    ok.append(c)
            else:
                log.append(f"preview failed: {r.get('error', '')[-300:]}")
        if len(ok) == 2:
            win = tournament(ok, ok[0]["G"], text, log)
            distinct = ok
        elif ok:
            distinct = ok
    best = distinct[win] if win < len(distinct) else distinct[0]
    timings["preview_s"] = round(time.time() - t3, 1)
    # 5. final render + pen coverage + checklist
    t4 = time.time()
    r = render(best["S"], os.path.join(wd, "final"), "-qm", int(max(120, budget_s - (time.time() - t0))))
    timings["render_s"] = r.get("render_s")
    if not r.get("ok"):
        log.append(f"final render failed: {r.get('error', '')[-400:]}")
        return {"ok": False, "error": "render failed", "facts": facts, "log": log, "timings": timings, "graph": best["G"], "scene": best["S"], "fallback": True}
    pen = (r.get("gate") or {}).get("pen") or {}
    if pen.get("missing"):
        log.append(f"pen coverage gate: missing {pen['missing'][:6]}")
        return {"ok": False, "error": "pen coverage below 100%: " + ", ".join(pen["missing"][:6]), "facts": facts, "log": log, "timings": timings, "graph": best["G"], "scene": best["S"], "fallback": True}
    sheet = contact_sheet(r["video"], os.path.join(wd, "final_sheet.png"), n=9, width=640)
    chk = final_check(sheet, best["G"], best["S"], log) if sheet else {"skipped": True}
    timings["final_s"] = round(time.time() - t4, 1)
    timings["total_s"] = round(time.time() - t0, 1)
    ans = chk.get("answers") or []
    nos = [q for q, a in zip(chk.get("questions") or [], ans) if a is False]
    remember(desc, best["G"], nos)
    models = [x for x in log if x.startswith("stage ")]
    return {"ok": True, "video": r["video"], "pen": r.get("pen"), "graph": best["G"], "scene": best["S"], "gate": best["gate"], "render_gate": r.get("gate"),
            "facts": facts, "checklist": chk, "timings": timings, "log": log, "stages": models, "sheet": os.path.join(wd, "final_sheet.png") if sheet else None,
            "mode": best["S"].get("mode"), "pen_coverage": {"covered": len(pen.get("covered") or []), "missing": pen.get("missing") or []}}

"""gm_ffprobe: layout probe for free-form Manim scenes (gm_freeform.py).

Imported at the end of a generated scene file (after the Scene class is defined, before the CLI renders it). It wraps
Scene.play (Scene.wait goes through it) and, after each call, records what is on screen: every text unit (Text, MathTex, Tex,
DecimalNumber ...) with its bounding box, font size and string, and the bounding box of every other top-level object.
At exit it writes the snapshots to $FF_PROBE_PATH as JSON. It never changes what is drawn.
"""
from __future__ import annotations

import atexit
import json
import os

import numpy as np
from manim import Scene, config
from manim import DecimalNumber, MarkupText, Paragraph, SingleStringMathTex, Text

TEXT_TYPES = (DecimalNumber, Text, MarkupText, Paragraph, SingleStringMathTex)
_SNAPS: list = []
_MAX_SNAPS = 120


def _bbox(m):
    pts = [x.points for x in m.get_family() if len(getattr(x, "points", ())) and _visible(x)]
    if not pts:
        return None
    p = np.concatenate(pts)
    return [float(p[:, 0].min()), float(p[:, 1].min()), float(p[:, 0].max()), float(p[:, 1].max())]


def _visible(x):
    try:
        so = x.get_stroke_opacity() if x.get_stroke_width() > 0 else 0.0
    except Exception:  # noqa: BLE001
        so = 0.0
    try:
        fo = x.get_fill_opacity()
    except Exception:  # noqa: BLE001
        fo = 0.0
    return max(float(so or 0), float(fo or 0)) > 0.02


def _label(m):
    for a in ("text", "tex_string", "original_text"):
        v = getattr(m, a, None)
        if isinstance(v, str) and v.strip():
            return v.strip()[:60]
    if isinstance(m, DecimalNumber):
        try:
            return f"{m.get_value():g}"
        except Exception:  # noqa: BLE001
            return "number"
    return type(m).__name__


def _texts(m, out, depth=0):
    if depth > 12:
        return
    if isinstance(m, TEXT_TYPES):
        out.append(m)
        return
    for s in m.submobjects:
        _texts(s, out, depth + 1)


def _snap(scene, what):
    if len(_SNAPS) >= _MAX_SNAPS:
        return
    try:
        t = float(scene.renderer.time)
    except Exception:  # noqa: BLE001
        t = 0.0
    texts, objs = [], []
    for top in scene.mobjects:
        units: list = []
        _texts(top, units)
        for u in units:
            b = _bbox(u)
            if b is None:
                continue
            try:
                fs = float(u.font_size)
            except Exception:  # noqa: BLE001
                fs = None
            texts.append({"id": id(u), "label": _label(u), "kind": type(u).__name__, "bbox": [round(v, 3) for v in b], "font_size": round(fs, 1) if fs else None})
        b = _bbox(top)
        if b is not None:
            objs.append({"id": id(top), "kind": type(top).__name__, "bbox": [round(v, 3) for v in b], "has_text": bool(units)})
    crossings = _crossings(scene) if texts else []
    _SNAPS.append({"t": round(t, 2), "after": what, "texts": texts, "objects": objs, "crossings": crossings})


def _seg_hits_rect(p0, p1, r):
    """Liang-Barsky: does segment p0-p1 pass through rectangle r = [x0, y0, x1, y1]?"""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, p0[0] - r[0]), (dx, r[2] - p0[0]), (-dy, p0[1] - r[1]), (dy, r[3] - p0[1])):
        if abs(p) < 1e-12:
            if q < 0:
                return False
        else:
            t = q / p
            if p < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
            if t0 > t1:
                return False
    return True


def _crossings(scene):
    """Stroked lines / curves that pass through the middle of a text unit (a label drawn over a line)."""
    units, text_ids = [], set()
    for top in scene.mobjects:
        us: list = []
        _texts(top, us)
        for u in us:
            text_ids.update(id(x) for x in u.get_family())
            b = _bbox(u)
            if b is None:
                continue
            w, h = b[2] - b[0], b[3] - b[1]
            units.append((u, [b[0] + 0.08 * w, b[1] + 0.22 * h, b[2] - 0.08 * w, b[3] - 0.22 * h]))
    if not units:
        return []
    out, seen, budget = [], set(), 6000
    for top in scene.mobjects:
        for leaf in top.get_family():
            if id(leaf) in text_ids or leaf.submobjects or not len(getattr(leaf, "points", ())):
                continue
            try:
                if leaf.get_stroke_width() <= 0.5 or float(leaf.get_stroke_opacity() or 0) < 0.15:
                    continue
                pts = leaf.points
            except Exception:  # noqa: BLE001
                continue
            n = len(pts) // 4
            if n == 0:
                continue
            segs = [(pts[4 * k], pts[4 * k + 3]) for k in range(min(n, 400))]
            budget -= len(segs) * len(units)
            if budget < 0:
                return out
            for u, r in units:
                if r[2] <= r[0] or r[3] <= r[1]:
                    continue
                if any(_seg_hits_rect(a, b, r) for a, b in segs):
                    key = (id(u), type(leaf).__name__)
                    if key not in seen:
                        seen.add(key)
                        out.append({"text": _label(u), "by": type(leaf).__name__, "by_parent": type(top).__name__})
    return out[:12]


_orig_play = Scene.play


def _play(self, *args, **kwargs):
    r = _orig_play(self, *args, **kwargs)
    try:
        names = []
        for a in args:
            n = type(a).__name__
            if n == "_AnimationBuilder":
                n = "animate"
            names.append(n)
        _snap(self, "play:" + ",".join(names)[:80])
    except Exception as exc:  # noqa: BLE001
        print("ffprobe snap failed:", exc)
    return r


Scene.play = _play


@atexit.register
def _dump():
    path = os.environ.get("FF_PROBE_PATH")
    if not path:
        return
    try:
        with open(path, "w") as f:
            json.dump({"frame": [float(config.frame_width), float(config.frame_height)], "snaps": _SNAPS}, f)
    except Exception as exc:  # noqa: BLE001
        print("ffprobe dump failed:", exc)

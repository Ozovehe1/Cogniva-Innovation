"""Pen paths for the whiteboard hand (imported ahead of a scene by the render service).

Records every drawing animation the scene plays (Create / ShowPartial, Write / DrawBorderThenFill,
GrowArrow / GrowFromPoint) and, when the scene finishes rendering, writes JSON to $PEN_EXPORT_PATH:

  {"v": 1, "fps": 60, "frame": {"w": 14.22, "h": 8.0, "px": [1280, 720]},
   "strokes": [{"t0": 2.9, "t1": 3.9, "kind": "create",
                "curves": [[x, y], ...],      # cubic bezier control points, 4 per curve, frame-normalised (0..1, y down)
                "p": [[t, proportion], ...]}]} # how much of the stroke Manim has revealed at time t (s)

The proportion is exactly what Manim reveals: pointwise_become_partial(0, p) ends on curve floor(p * n) at residue
p * n - floor(p * n), so the player puts the marker tip on that point of that curve. Pure motion (shifts, updaters,
value trackers, fades) is not recorded: the hand rests then.
"""
import json
import os

import numpy as np
from manim import Scene, config
from manim.animation.creation import Create, DrawBorderThenFill, ShowPartial, Uncreate, Unwrite, Write
from manim.animation.growing import GrowArrow, GrowFromPoint

FPS = 60
_records: list = []


def _norm(pts):
    fw, fh = config.frame_width, config.frame_height
    out = []
    for x, y, _z in pts:
        out.append([round(float((x + fw / 2) / fw), 5), round(float((fh / 2 - y) / fh), 5)])
    return out


def _family(anim):
    try:
        return [m for m in anim.mobject.family_members_with_points()]
    except Exception:  # noqa: BLE001
        return []


def _kind(anim):
    if isinstance(anim, (Uncreate, Unwrite)):
        return None
    if isinstance(anim, (Write, DrawBorderThenFill)):
        return "write"
    if isinstance(anim, ShowPartial):
        return "create"
    if isinstance(anim, (GrowArrow, GrowFromPoint)):
        return "grow"
    return None


def _record(anim, t0):
    kind = _kind(anim)
    if not kind:
        return
    run = float(getattr(anim, "run_time", 0) or 0)
    if run <= 0:
        return
    rate = anim.rate_func
    fam = _family(anim)
    n = len(fam)
    steps = max(2, int(round(run * FPS)) + 1)
    ts = np.linspace(0, run, steps)
    if kind == "grow":
        # The whole arrow/shape scales up from its start point: the tip is the far end of its first curve run.
        mob = anim.mobject
        try:
            start = mob.get_start()
            end = mob.get_end()
        except Exception:  # noqa: BLE001
            return
        p = [[round(float(t0 + t), 4), round(float(rate(t / run)), 4)] for t in ts]
        _records.append({"t0": round(t0, 4), "t1": round(t0 + run, 4), "kind": "grow", "curves": _norm([start, start + (end - start) / 3, start + 2 * (end - start) / 3, end]), "p": p})
        return
    for i, sub in enumerate(fam):
        pts = sub.points
        if pts is None or len(pts) < 4:
            continue
        nc = len(pts) // 4
        pts = pts[: nc * 4]
        samples = []
        for t in ts:
            a = rate(t / run)
            sa = anim.get_sub_alpha(a, i, n)
            prop = min(1.0, 2 * sa) if kind == "write" else sa  # Write draws the outline in its first half
            samples.append([round(float(t0 + t), 4), round(float(max(0.0, min(1.0, prop))), 4)])
        # Keep only the part where this stroke is being drawn (plus one sample either side).
        first = next((k for k, s in enumerate(samples) if s[1] > 0), None)
        last = next((k for k in range(len(samples) - 1, -1, -1) if samples[k][1] < 1), None)
        if first is None or last is None or last < first - 1:
            continue
        lo, hi = max(0, first - 1), min(len(samples) - 1, last + 1)
        samples = samples[lo : hi + 1]
        _records.append({"t0": samples[0][0], "t1": samples[-1][0], "kind": kind, "curves": _norm(pts), "p": samples})


_orig_play = Scene.play
_orig_render = Scene.render


def _play(self, *args, **kwargs):
    t0 = float(self.renderer.time)
    out = _orig_play(self, *args, **kwargs)
    for a in args:
        try:
            _record(a, t0)
        except Exception as exc:  # noqa: BLE001 - never break a render for the hand
            print(f"pen_export: skipped an animation ({exc})")
    return out


def _render(self, *args, **kwargs):
    out = _orig_render(self, *args, **kwargs)
    path = os.environ.get("PEN_EXPORT_PATH")
    try:
        _dump(self, path)
    except Exception as exc:  # noqa: BLE001 - never break a render for the hand
        print(f"pen_export: could not write paths ({exc})")
    return out


def _dump(self, path):
    if path:
        data = {
            "v": 1,
            "fps": FPS,
            "frame": {"w": config.frame_width, "h": config.frame_height, "px": [config.pixel_width, config.pixel_height]},
            "duration": round(float(self.renderer.time), 4),
            "strokes": sorted(_records, key=lambda r: r["t0"]),
        }
        with open(path, "w") as f:
            json.dump(data, f, separators=(",", ":"))


Scene.play = _play
Scene.render = _render

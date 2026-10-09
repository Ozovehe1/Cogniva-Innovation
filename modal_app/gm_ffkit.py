"""gm_ffkit: the small helper API free-form scenes may import (`from gm_ffkit import *`), see gm_freeform.py.

Palette, phone-readable layout zones for 16:9 and 9:16 frames, text helpers that never go below the legible size, and a
few drawn parts Manim does not ship (circuit symbols, spring, gear). Everything returns ordinary Manim mobjects.
"""
from __future__ import annotations

import math

import numpy as np
from manim import (
    DOWN, LEFT, ORIGIN, RIGHT, UP, Arrow, Circle, Line, MathTex, Text, VGroup, VMobject, config,
)

# ── palette (light background, matches the whiteboard) ──
BG = "#FDFCF9"
INK = "#14141A"
MUTED = "#6B6B73"
RULE = "#D9D6CE"
GREEN = "#1F4D3A"
CLAY = "#A4502A"
NAVY = "#23406A"
AMBER = "#B7862C"
PLUM = "#7A3B78"
TEAL = "#17808A"

PORTRAIT = config.frame_height > config.frame_width
FW, FH = float(config.frame_width), float(config.frame_height)
# smallest font size that stays readable when the clip is shown on a phone (see gm_freeform.min_font_size)
MIN_FONT = 28 if not PORTRAIT else 16
BODY_FONT = 34 if not PORTRAIT else 22
TITLE_FONT = 42 if not PORTRAIT else 28
MARGIN = 0.35


def _z(cx, cy, w, h):
    return {"center": np.array([cx, cy, 0.0]), "width": w, "height": h}


# Layout zones (frame units). 16:9: title strip on top, main stage left/centre, side column right, caption strip at the
# bottom. 9:16: title, a square-ish main stage, a notes block and a caption, stacked.
if not PORTRAIT:
    ZONES = {
        "title": _z(0, FH / 2 - 0.65, FW - 2 * MARGIN, 0.9),
        "main": _z(-1.6, -0.15, FW - 2 * MARGIN - 4.4, FH - 2.6),
        "side": _z(FW / 2 - MARGIN - 2.0, -0.15, 4.0, FH - 2.6),
        "caption": _z(0, -FH / 2 + 0.6, FW - 2 * MARGIN, 0.8),
        "full": _z(0, -0.15, FW - 2 * MARGIN, FH - 2.6),
    }
else:
    ZONES = {
        "title": _z(0, FH / 2 - 0.6, FW - 2 * MARGIN, 0.8),
        "main": _z(0, 1.0, FW - 2 * MARGIN, FW - 2 * MARGIN),
        "side": _z(0, -2.2, FW - 2 * MARGIN, 1.8),
        "caption": _z(0, -FH / 2 + 0.6, FW - 2 * MARGIN, 0.8),
        "full": _z(0, 0, FW - 2 * MARGIN, FH - 2.6),
    }


def zone(name: str) -> dict:
    """{'center': point, 'width': w, 'height': h} of a layout zone: title, main, side, caption, full."""
    return ZONES[name]


def fit(mob, zone_name: str = "main", buff: float = 0.1, scale_up: bool = False):
    """Scale mob down (never up unless scale_up) to fit the zone and centre it there. Returns mob."""
    z = ZONES[zone_name]
    w, h = max(mob.width, 1e-3), max(mob.height, 1e-3)
    k = min((z["width"] - 2 * buff) / w, (z["height"] - 2 * buff) / h)
    if k < 1 or scale_up:
        mob.scale(k)
    mob.move_to(z["center"])
    return mob


def keep_in_frame(mob, margin: float = 0.15):
    """Shift mob back inside the frame if any part sticks out. Returns mob."""
    dx = max(0.0, (-FW / 2 + margin) - mob.get_left()[0]) - max(0.0, mob.get_right()[0] - (FW / 2 - margin))
    dy = max(0.0, (-FH / 2 + margin) - mob.get_bottom()[1]) - max(0.0, mob.get_top()[1] - (FH / 2 - margin))
    mob.shift(np.array([dx, dy, 0.0]))
    return mob


def label(text: str, size: float | None = None, color=INK, **kw):
    """Plain words, never smaller than MIN_FONT."""
    return Text(str(text), font_size=max(MIN_FONT, size or BODY_FONT), color=color, **kw)


def math_tex(*tex: str, size: float | None = None, color=INK, **kw):
    """MathTex, never smaller than MIN_FONT (maths reads best a bit larger than words)."""
    return MathTex(*tex, font_size=max(MIN_FONT + 4, size or BODY_FONT + 6), color=color, **kw)


def title(text: str, color=INK):
    """One short title in the title zone (top-left)."""
    t = Text(str(text), font_size=TITLE_FONT, color=color)
    z = ZONES["title"]
    if t.width > z["width"]:
        t.scale_to_fit_width(z["width"])
    t.move_to(z["center"]).align_to(np.array([-FW / 2 + MARGIN, 0, 0]), LEFT)
    return t


def caption(text: str, color=MUTED, size: float | None = None):
    """A one-line caption centred in the caption zone (shrinks to fit, but not below MIN_FONT)."""
    t = Text(str(text), font_size=max(MIN_FONT, size or BODY_FONT - 4), color=color)
    z = ZONES["caption"]
    if t.width > z["width"]:
        t.scale_to_fit_width(z["width"])
    return t.move_to(z["center"])


def place_label(lab, target, direction=UP, buff: float = 0.2):
    """next_to + keep_in_frame: a label beside its target that never leaves the frame."""
    lab.next_to(target, direction, buff=buff)
    return keep_in_frame(lab)


def arrow(a, b, color=INK, width: float = 4, tip: float = 0.22):
    """A clean arrow from point a to point b (no buff, tip scaled for short arrows too)."""
    a, b = np.array([a[0], a[1], 0.0]), np.array([b[0], b[1], 0.0])
    return Arrow(a, b, buff=0, stroke_width=width, color=color, tip_length=tip, max_tip_length_to_length_ratio=0.35,
                 max_stroke_width_to_length_ratio=20)


def stack(*mobs, direction=DOWN, buff: float = 0.3, aligned_edge=LEFT):
    """VGroup(*mobs).arrange(direction, buff, aligned_edge)."""
    return VGroup(*mobs).arrange(direction, buff=buff, aligned_edge=aligned_edge)


# ── drawn parts ──
def resistor(a, b, color=INK, zigs: int = 6, amp: float = 0.18):
    """Zig-zag resistor between points a and b (a VMobject)."""
    a, b = np.array(a, dtype=float), np.array(b, dtype=float)
    d = b - a
    n = np.array([-d[1], d[0], 0.0]) / (np.linalg.norm(d) + 1e-9)
    pts = [a, a + 0.15 * d]
    for i in range(zigs):
        f = 0.15 + 0.7 * (i + 0.5) / zigs
        pts.append(a + f * d + (amp if i % 2 == 0 else -amp) * n)
    pts += [a + 0.85 * d, b]
    return VMobject(color=color, stroke_width=3).set_points_as_corners(pts)


def battery(center=ORIGIN, color=INK, vertical: bool = False, cells: int = 1):
    """Battery symbol (long + plate, short - plate); horizontal current flow by default."""
    g = VGroup()
    for i in range(cells):
        x = (i - (cells - 1) / 2) * 0.35
        g.add(Line(UP * 0.45, DOWN * 0.45, color=color, stroke_width=4).shift(RIGHT * (x - 0.07)))
        g.add(Line(UP * 0.22, DOWN * 0.22, color=color, stroke_width=7).shift(RIGHT * (x + 0.07)))
    if vertical:
        g.rotate(math.pi / 2)
    return g.move_to(center)


def bulb(center=ORIGIN, color=INK, glow=None, r: float = 0.35):
    """Lamp symbol: a circle with a cross. glow= a colour fills it lightly."""
    c = Circle(radius=r, color=color, stroke_width=3)
    if glow:
        c.set_fill(glow, opacity=0.35)
    k = r * 0.7
    x = VGroup(Line([-k, -k, 0], [k, k, 0]), Line([-k, k, 0], [k, -k, 0])).set_stroke(color, 2)
    return VGroup(c, x).move_to(center)


def wire(*points, color=INK):
    """A wire through the given points (straight segments)."""
    return VMobject(color=color, stroke_width=3).set_points_as_corners([np.array(p, dtype=float) for p in points])


def spring(a, b, coils: int = 8, amp: float = 0.2, color=INK):
    """Zig-zag spring between a and b."""
    a, b = np.array(a, dtype=float), np.array(b, dtype=float)
    d = b - a
    n = np.array([-d[1], d[0], 0.0]) / (np.linalg.norm(d) + 1e-9)
    pts = [a, a + 0.08 * d]
    for i in range(2 * coils):
        pts.append(a + (0.08 + 0.84 * (i + 0.5) / (2 * coils)) * d + (amp if i % 2 == 0 else -amp) * n)
    pts += [a + 0.92 * d, b]
    return VMobject(color=color, stroke_width=3).set_points_as_corners(pts)


def gear(center=ORIGIN, teeth: int = 12, radius: float = 1.0, color=NAVY, angle: float = 0.0):
    """A simple spur gear outline (rotate it with .animate.rotate or Rotate)."""
    pts = []
    m = 2 * radius / max(teeth, 3)
    for i in range(teeth):
        a0 = angle + 2 * math.pi * i / teeth
        for da, rr in ((0, radius - m * 0.6), (0.18, radius + m * 0.5), (0.32, radius + m * 0.5), (0.5, radius - m * 0.6)):
            a = a0 + da * 2 * math.pi / teeth
            pts.append([rr * math.cos(a), rr * math.sin(a), 0])
    pts.append(pts[0])
    body = VMobject(color=color, stroke_width=2.5).set_points_as_corners(pts).set_fill(color, opacity=0.15)
    hub = Circle(radius=radius * 0.22, color=color, stroke_width=2.5)
    return VGroup(body, hub).move_to(center)


__all__ = [
    "BG", "INK", "MUTED", "RULE", "GREEN", "CLAY", "NAVY", "AMBER", "PLUM", "TEAL", "PORTRAIT", "FW", "FH", "MIN_FONT", "BODY_FONT",
    "TITLE_FONT", "ZONES", "zone", "fit", "keep_in_frame", "label", "math_tex", "title", "caption", "place_label", "arrow", "stack",
    "resistor", "battery", "bulb", "wire", "spring", "gear",
]

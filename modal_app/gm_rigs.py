"""gm_rigs: deterministic mechanism solvers + drawers for relation patterns of the part graph.

A rig never invents numbers: proportions come from declared ratios (gm_solve), motion comes from World processes
through the real relation (volume conservation, pitch-matched meshing, a sum constraint, a numerically integrated
membrane model, ...). Each rig registers part anchors (for labels), bodies (for checks) and proportion checks.
"""
from __future__ import annotations

import math

import numpy as np
from manim import (
    DOWN, LEFT, RIGHT, UP, PI, TAU, Arc, Arrow, Axes, Brace, Circle, DashedLine, DecimalNumber, Dot, Ellipse, Line,
    MathTex, Polygon, Rectangle, RoundedRectangle, Sector, AnnularSector, VGroup, VMobject, DoubleArrow, Annulus, Square,
)

from gm_parts import (
    keep_in_frame, grid_box, OUTLINE, THEME, BG, INK, MUTED, RULE, Q, MAT, FW, FH, Box, col, light, dark, mix, smooth01, shaded_rect, poly, smooth_closed,
    gear_mob, arrow, readout, molecule_mob, label_text, live, bbox,
)


def build(ctx, rig):
    fn = RIGS.get(rig["type"])
    if fn is None:
        raise ValueError(f"no solver for rig {rig['type']}")
    fn(ctx, rig)


def B(rig):
    return Box(*rig["box"])


def role(rig, r):
    return (rig.get("roles") or {}).get(r) or r


def sh(ctx, rig, r, default=0.0):
    """show time of a role's part (the beat that first names it), default when never named."""
    pid = role(rig, r)
    return ctx.show_time(pid, rig.get("show_default", default))


# ════════════════ Fluid link (Pascal): pistons joined by an incompressible fluid ════════════════
def fluid_link(ctx, rig):
    box = B(rig).aspect_fit(1.55)
    k = max(1.5, float(rig.get("k", 10)))  # A_out / A_in
    stroke = float(rig.get("stroke_frac", 0.4)) * box.h
    pin = rig.get("input", "stroke")
    fl = col(rig.get("fluid_color", "oil"))
    steel = col("steel")
    wB = 0.30 * box.w
    wS = max(0.16, wB / math.sqrt(k))  # piston area ~ diameter^2 -> diameter ratio sqrt(k)
    wall = 0.11
    xs = box.x0 + 0.17 * box.w
    xb = box.x0 + 0.70 * box.w
    yb0 = box.y0 + 0.06 * box.h
    hp = max(0.32, 0.55 * wS)
    ytop = box.y0 + 0.80 * box.h
    yf0 = box.y0 + 0.58 * box.h
    ctx.checks.append({"type": "ratio", "what": "piston area (diameter^2)", "declared": k, "drawn": round((wB / wS) ** 2, 3), "parts": [role(rig, "small_piston"), role(rig, "large_piston")]})

    def lv():
        p = ctx.st().get(pin, 0.0)
        return yf0 - stroke * p, yf0 + stroke * p / k  # volume conservation: A_s * d_s = A_b * d_b

    # housing: the U of cylinders and the channel (cutaway: steel walls, open bores)
    def housing():
        g = VGroup()
        outer = [(xs - wS / 2 - wall, ytop), (xs - wS / 2 - wall, yb0 - wall), (xb + wB / 2 + wall, yb0 - wall), (xb + wB / 2 + wall, ytop),
                 (xb + wB / 2, ytop), (xb + wB / 2, yb0), (xs - wS / 2, yb0), (xs - wS / 2, ytop)]
        g.add(poly(outer, steel, sw=2, sheen=RIGHT))
        g.add(poly([(xs + wS / 2, ytop), (xs + wS / 2, yb0 + hp), (xb - wB / 2, yb0 + hp), (xb - wB / 2, ytop), (xb - wB / 2 - wall, ytop),
                    (xb - wB / 2 - wall, yb0 + hp + wall), (xs + wS / 2 + wall, yb0 + hp + wall), (xs + wS / 2 + wall, ytop)], steel, sw=2, sheen=RIGHT))
        # base plate / floor
        g.add(shaded_rect(xs - wS / 2 - wall - 0.25, yb0 - wall - 0.14, xb + wB / 2 + wall + 0.25, yb0 - wall, dark(steel, 0.2), sw=1.5))
        for x in np.linspace(xs - wS / 2 - wall - 0.2, xb + wB / 2 + wall + 0.2, 26):  # ground hatching
            g.add(Line([x, yb0 - wall - 0.14, 0], [x - 0.12, yb0 - wall - 0.28, 0]).set_stroke(MUTED, 1.2))
        return g

    def fluid():
        ys, yb = lv()
        pts = [(xs - wS / 2, ys), (xs - wS / 2, yb0), (xb + wB / 2, yb0), (xb + wB / 2, yb), (xb - wB / 2, yb), (xb - wB / 2, yb0 + hp),
               (xs + wS / 2, yb0 + hp), (xs + wS / 2, ys)]
        m = poly(pts, fl, sw=0, op=0.85)
        m.set_fill([light(fl, 0.25), fl], opacity=0.9)
        m.set_sheen_direction(DOWN)
        return m

    ph = 0.2  # piston head height

    def piston(x, w, y, big):
        g = VGroup()
        g.add(shaded_rect(x - w / 2, y, x + w / 2, y + ph, col("steel"), sw=2))
        for f in (0.3, 0.7):  # seal rings
            g.add(Line([x - w / 2, y + ph * f, 0], [x + w / 2, y + ph * f, 0]).set_stroke(col("rubber"), 3))
        rw = max(0.07, 0.18 * w) if not big else 0.22 * w
        top = y + (ytop + (0.55 if not big else 0.12) - yf0)  # rigid rod: the handle / platform moves with the piston
        g.add(shaded_rect(x - rw / 2, y + ph, x + rw / 2, top, light(steel, 0.15), sw=1.6))
        if not big:  # plunger handle
            g.add(shaded_rect(x - 0.32, top, x + 0.32, top + 0.12, dark(steel, 0.1), sw=1.6, r=0.04))
        else:  # platform + load
            g.add(shaded_rect(x - w / 2 - 0.15, top, x + w / 2 + 0.15, top + 0.12, dark(steel, 0.1), sw=1.6))
            lh = 0.7
            g.add(shaded_rect(x - w / 2 + 0.05, top + 0.12, x + w / 2 - 0.05, top + 0.12 + lh, col(rig.get("load_color", "wood")), sw=2, r=0.05, vertical=True))
            for f in (0.33, 0.66):
                g.add(Line([x - w / 2 + 0.05, top + 0.12 + lh * f, 0], [x + w / 2 - 0.05, top + 0.12 + lh * f, 0]).set_stroke(dark(col("wood"), 0.3), 1.4))
        return g

    ctx.add(role(rig, "housing"), housing(), show=sh(ctx, rig, "housing"), how="create", z=1)
    ctx.add(role(rig, "fluid"), live(fluid), show=sh(ctx, rig, "fluid", sh(ctx, rig, "housing")), how="fade", z=0, moving=True)
    sp = live(lambda: piston(xs, wS, lv()[0], False))
    bp = live(lambda: piston(xb, wB, lv()[1], True))
    ctx.add(role(rig, "small_piston"), sp, show=sh(ctx, rig, "small_piston"), how="fade", z=3, moving=True)
    ctx.add(role(rig, "large_piston"), bp, show=sh(ctx, rig, "large_piston"), how="fade", z=3, moving=True)
    ctx.anchors[role(rig, "small_piston")] = lambda: [xs - wS / 2, lv()[0] + ph / 2, 0]
    ctx.anchors[role(rig, "large_piston")] = lambda: [xb + wB / 2, lv()[1] + ph / 2, 0]
    ctx.anchors[role(rig, "fluid")] = [(xs + xb) / 2, yb0 + hp / 2, 0]
    ctx.anchors[role(rig, "housing")] = [xs + wS / 2 + wall, ytop - 0.3, 0]
    ctx.anchors[role(rig, "load")] = lambda: [xb + wB / 2 - 0.05, lv()[1] + (ytop + 0.12 - yf0) + 0.12 + 0.35, 0]
    ctx.anchors[role(rig, "pipe")] = [(xs + xb) / 2, yb0 + hp / 2, 0]
    # forces: arrow thickness follows the force (area of the stroke ~ F), both labelled with their live readouts
    fin, fout, pq = rig.get("F_in"), rig.get("F_out"), rig.get("P")
    if fin:
        c = ctx.color_of(fin)
        a = live(lambda c=c: arrow([xs, lv()[0] + (ytop + 0.67 - yf0) + 1.05], [xs, lv()[0] + (ytop + 0.67 - yf0) + 0.06], c, sw=6))
        ctx.add("arrow:" + fin, a, show=ctx.show_time(fin, 0.0), how="fade", kind="body", part="arrow:" + fin, z=6, moving=True)
    if fout:
        c = ctx.color_of(fout)
        a = live(lambda c=c: arrow([xb, ytop + 0.12 + 0.12 + 0.7 + (lv()[1] - yf0) + 0.1], [xb, ytop + 0.94 + (lv()[1] - yf0) + 1.0], c, sw=14, tip=0.32))
        ctx.add("arrow:" + fout, a, show=ctx.show_time(fout, 0.0), how="fade", kind="body", part="arrow:" + fout, z=6, moving=True)
    if pq:  # Pascal: the same pressure on every wetted surface -> equal arrows everywhere in the fluid
        c = ctx.color_of(pq)

        def parrows(c=c):
            ys, yb = lv()
            p = ctx.st().get(pq, 0.0)
            L = 0.3 if p > 1e-9 else 0.0
            g = VGroup()
            spots = [((xs, ys - 0.05), (0, -1)), ((xb - wB / 4, yb - 0.05), (0, -1)), ((xb + wB / 4, yb - 0.05), (0, -1)),
                     ((xs - wS / 2 + 0.03, (ys + yb0) / 2), (1, 0)), ((xb + wB / 2 - 0.03, (yb + yb0) / 2 + 0.2), (-1, 0)),
                     ((xb - wB / 2 + 0.03, (yb + yb0 + hp) / 2 + 0.15), (1, 0)), (((xs + xb) / 2, yb0 + 0.03), (0, 1)), (((xs + xb) / 2, yb0 + hp - 0.03), (0, -1)),
                     ((xs + 0.35 * (xb - xs), yb0 + 0.03), (0, 1))]
            for (x, y), (dx, dy) in spots:  # arrows point from the fluid onto the surface
                g.add(arrow([x - dx * L, y - dy * L], [x, y], c, sw=4, tip=0.1) if L else VGroup())
            return g
        ctx.add("arrows:" + pq, live(parrows), show=ctx.show_time(pq, 0.0), how="fade", kind="overlay", part=role(rig, "fluid"), z=5, moving=True)
    # travel brackets d_in / d_out (exact: drawn from the same levels)
    for side, (x, idx, q) in {"in": (xs - wS / 2 - wall - 0.22, 0, rig.get("d_in")), "out": (xb + wB / 2 + wall + 0.22, 1, rig.get("d_out"))}.items():
        if not q:
            continue
        c = ctx.color_of(q)

        def br(x=x, idx=idx, c=c):
            y = lv()[idx]
            g = VGroup(DashedLine([x - 0.12, yf0, 0], [x + 0.12, yf0, 0]).set_stroke(c, 2))
            if abs(y - yf0) > 0.03:
                g.add(Line([x, yf0, 0], [x, y, 0]).set_stroke(c, 3), Line([x - 0.1, y, 0], [x + 0.1, y, 0]).set_stroke(c, 3))
            return g
        ctx.add("travel:" + q, live(br), show=ctx.show_time(q, 0.0), how="fade", kind="overlay", part="travel:" + q, z=5, moving=True)


# ════════════════ Dissection: a disc cut into n wedges rearranged into a near-rectangle ════════════════
def dissection(ctx, rig):
    box = B(rig)
    n_proc, un = rig.get("n_proc"), rig.get("unroll", "unroll")
    cut = rig.get("cut", "cut")
    ns = [int(x) for x in rig.get("n_steps", [8, 16, 32])]
    R = min(box.h * 0.36, box.w / (2 + math.pi + 1.4) * 0.98)
    cx = box.x0 + R + 0.15
    cy = box.cy + 0.25
    sx0 = cx + R + 0.9  # strip origin (left end)
    sy = cy - R / 2  # strip mid-height baseline
    c1, c2 = col(rig.get("color_a", "#3F7CBF")), col(rig.get("color_b", "#4F9A6B"))
    ctx.checks.append({"type": "ratio", "what": "strip width / radius", "declared": round(math.pi, 4), "drawn": round(math.pi, 4)})

    def wedges():
        st = ctx.st()
        n = ns[min(len(ns) - 1, int(round(st.get(n_proc, 0.0))))] if n_proc else ns[0]
        u = st.get(un, 0.0)
        cu = st.get(cut, 0.0)
        g = VGroup()
        dth = TAU / n
        for i in range(n):
            th = PI / 2 + (i + 0.5) * dth  # wedge bisector angle in the disc
            top = math.sin(th) >= 0
            # target: alternate apex-down (from the top half) and apex-up wedges, arcs on the outside of the strip
            j = i if True else 0
            down = (i % 2 == 0)
            tx = sx0 + (i + 1) * (math.pi * R / n)
            tgt_bis = -PI / 2 if not down else PI / 2  # bisector from apex toward the arc
            tgt_apex = np.array([tx, sy + (R / 2 if not down else -R / 2) * 1.0, 0])
            # staggered unroll: wedge i moves in its own window
            ui = smooth01((u * (n + 3) / 4 * 4 / (n + 3) * 1.6 - (i / n) * 0.6) / 1.0) if u < 1 else 1.0
            src_apex = np.array([cx, cy, 0]) + cu * 0.12 * np.array([math.cos(th), math.sin(th), 0])
            apex = src_apex * (1 - ui) + tgt_apex * ui + np.array([0, 0.5 * math.sin(PI * ui) * (0.6 if down else -0.6), 0])
            d = (tgt_bis - th + PI) % TAU - PI
            ang = th + d * ui
            w = Sector(radius=R, start_angle=ang - dth / 2, angle=dth, arc_center=apex)
            cc = c1 if down else c2
            w.set_fill(cc, 0.92).set_stroke(INK, 1.4 if n <= 16 else 0.9)
            g.add(w)
        return g

    ghost = Circle(radius=R).move_to([cx, cy, 0]).set_stroke(MUTED, 2).set_fill(opacity=0)
    from manim import DashedVMobject
    ghost = DashedVMobject(ghost, num_dashes=60)
    ctx.add(role(rig, "circle") + ":ghost", ghost, show=rig.get("ghost_show", 1e9), how="fade", kind="overlay", z=0)
    w = live(wedges)
    ctx.add(role(rig, "circle"), w, show=sh(ctx, rig, "circle"), how="create", z=2, moving=True)
    ctx.anchors[role(rig, "circle")] = [cx + R * 0.7, cy + R * 0.7, 0]
    # radius marker on the disc (before unrolling)
    rq, wq = rig.get("r_q"), rig.get("w_q")
    rc = ctx.color_of(rq) if rq else Q["clay"]
    wc = ctx.color_of(wq) if wq else Q["navy"]
    rad = VGroup(Line([cx, cy, 0], [cx + R * math.cos(-0.35), cy + R * math.sin(-0.35), 0]).set_stroke(rc, 5), Dot([cx, cy, 0], radius=0.05, color=INK),
                 MathTex("r", color=rc, font_size=40).move_to([cx + 0.55 * R * math.cos(-0.35) + 0.1, cy + 0.55 * R * math.sin(-0.35) - 0.3, 0]))
    ctx.add("radius", rad, show=rig.get("radius_show", 0.5), how="create", kind="overlay", z=4, hide=rig.get("radius_hide"))
    circ = Circle(radius=R + 0.07).move_to([cx, cy, 0]).set_stroke(wc, 5).set_fill(opacity=0)
    ctx.add("circumference", circ, show=rig.get("circ_show", 1e9), how="create", kind="overlay", z=3, hide=rig.get("circ_hide"))
    # braces on the finished strip: height r (left edge), width pi r (bottom)
    x0, x1 = sx0 + math.pi * R / ns[0] * 0.5, sx0 + math.pi * R + math.pi * R / ns[0] * 0.5
    hb = Brace(Line([x0, sy - R / 2, 0], [x1, sy - R / 2, 0]), DOWN, color=wc)
    ht = MathTex(r"\pi r", color=wc, font_size=44).next_to(hb, DOWN, buff=0.1)
    vb = Brace(Line([sx0 + math.pi * R + math.pi * R / ns[0] + 0.05, sy - R / 2, 0], [sx0 + math.pi * R + math.pi * R / ns[0] + 0.05, sy + R / 2, 0]), RIGHT, color=rc)
    vt = MathTex("r", color=rc, font_size=44).next_to(vb, RIGHT, buff=0.1)
    ctx.add("brace_w", VGroup(hb, ht), show=rig.get("w_show", 1e9), how="fade", kind="overlay", z=4)
    ctx.add("brace_h", VGroup(vb, vt), show=rig.get("h_show", 1e9), how="fade", kind="overlay", z=4)
    ctx.anchors["strip"] = [sx0 + math.pi * R / 2, sy + R / 2, 0]


RIGS = {"fluid_link": fluid_link, "dissection": dissection}


# ════════════════ Panels: readouts, graphs, equations (all read World) ════════════════
def panels(ctx):
    S = ctx.S
    for g in S.get("graphs", []):
        graph(ctx, g)
    ro = S.get("readouts", [])
    if ro:
        box = Box(*S.get("readout_box", [3.5, -3.6, 6.9, -1.2]))
        n = len(ro)
        size = min(34, 34 * (box.h / max(1, n)) / 0.62)
        for i, r in enumerate(ro):
            m = readout(ctx, r["q"], r.get("tex", r["q"]), r.get("unit", ""), int(r.get("decimals", 0)), size=size)
            y = box.y1 - (i + 0.5) * box.h / n

            def upd(mm, y=y):
                mm.move_to([box.x0 + mm.width / 2, y, 0])
            upd(m)
            m.add_updater(upd)
            ctx.add("readout:" + r["q"], m, show=r.get("show", 0.0), how="fade", kind="panel", part="readout:" + r["q"], z=10)
    for e in S.get("tex", []):
        try:
            m = MathTex(*e["parts"], font_size=e.get("size", 44), color=INK) if e.get("parts") else MathTex(e["tex"], font_size=e.get("size", 44), color=INK)
        except Exception as exc:  # noqa: BLE001
            ctx.issues.append(f"tex failed: {e.get('tex')}: {str(exc)[:80]}")
            continue
        for i, c in enumerate(e.get("colors") or []):
            if c and i < len(m):
                m[i].set_color(ctx.color_of(c, INK) if c in ctx.qcolor else col(c))
        b = Box(*e["box"])
        if m.width > b.w:
            m.scale_to_fit_width(b.w)
        if m.height > b.h:
            m.scale_to_fit_height(b.h)
        m.move_to(b.c)
        ctx.add("tex:" + e["id"], m, show=e.get("show", 0.0), how="write", kind="panel", part="tex:" + e["id"], z=10, hide=e.get("hide"))


def graph(ctx, g):
    """mode 'trace': (x(t), y(t)) drawn progressively from World + a dot at now; mode 'function': y = f(x) drawn whole,
    the dot sits at x = World[x] on the same function (one source of truth)."""
    box = Box(*g["box"])
    xr, yr = g["x_range"], g["y_range"]
    ax = Axes(x_range=[xr[0], xr[1], g.get("x_step", (xr[1] - xr[0]) / 4)], y_range=[yr[0], yr[1], g.get("y_step", (yr[1] - yr[0]) / 4)],
              x_length=box.w - 1.0, y_length=box.h - 1.3, tips=False,
              axis_config={"color": MUTED, "stroke_width": 2, "include_ticks": True, "tick_size": 0.04, "include_numbers": False})
    ax.move_to(box.c + np.array([0.35, 0.05, 0]))
    parts = VGroup(ax)
    if yr[0] < 0 < yr[1] and not g.get("x_axis_at_zero"):
        ax.x_axis.set_opacity(0)
        parts.add(Line(ax.c2p(xr[0], yr[0]), ax.c2p(xr[1], yr[0])).set_stroke(MUTED, 2))
        for xv in np.arange(xr[0], xr[1] + 1e-9, g.get("x_step", (xr[1] - xr[0]) / 4)):
            parts.add(Line(ax.c2p(xv, yr[0]), ax.c2p(xv, yr[0]) + DOWN * 0.07).set_stroke(MUTED, 2))
            if g.get("x_numbers", True):
                parts.add(MathTex(f"{xv:g}", font_size=24, color=MUTED).next_to(ax.c2p(xv, yr[0]), DOWN, buff=0.1))
    if g.get("y_numbers"):
        for v in g["y_numbers"]:
            parts.add(MathTex(f"{v:g}", font_size=24, color=MUTED).next_to(ax.c2p(xr[0], v), LEFT, buff=0.08))
    if g.get("x_label"):
        # x label centred under the axis, below the tick numbers (protected: never dropped)
        parts.add(MathTex(g["x_label"], font_size=28, color=MUTED).next_to(ax.c2p((xr[0] + xr[1]) / 2, yr[0]), DOWN, buff=0.42))
    if g.get("y_label"):
        parts.add(MathTex(g["y_label"], font_size=28, color=ctx.color_of(g["y"], MUTED)).next_to(ax.y_axis.get_end(), UP, buff=0.12).align_to(ax.y_axis, LEFT).shift(LEFT * 0.35))
    for ref in g.get("refs") or []:  # horizontal reference lines (e.g. rest potential)
        parts.add(DashedLine(ax.c2p(xr[0], ref["y"]), ax.c2p(xr[1], ref["y"])).set_stroke(RULE, 2))
        if ref.get("tex"):
            parts.add(MathTex(ref["tex"], font_size=24, color=MUTED).next_to(ax.c2p(xr[1], ref["y"]), UP, buff=0.05).shift(LEFT * 0.6))
    ctx.add("graph:" + g["id"], parts, show=g.get("show", 0.0), how="create", kind="panel", part="graph:" + g["id"], z=8)
    c = ctx.color_of(g["y"], INK)
    W = ctx.W

    def clampy(v):
        return min(yr[1], max(yr[0], v))
    if g.get("mode", "trace") == "trace":
        t0 = float(g.get("from", g.get("show", 0.0)))
        ts = np.linspace(0, W.duration, int(W.duration * 30) + 2)
        xs = np.array([W(t).get(g["x"], 0.0) for t in ts])
        ys = np.array([W(t).get(g["y"], 0.0) for t in ts])

        def curve():
            now = ctx.T.get_value()
            sel = [(x, y) for t, x, y in zip(ts, xs, ys) if t0 <= t <= now and xr[0] <= x <= xr[1]]
            m = VMobject()
            if len(sel) >= 2:
                m.set_points_as_corners([ax.c2p(x, clampy(y)) for x, y in sel])
            else:
                m.set_points_as_corners([ax.c2p(xr[0], yr[0]), ax.c2p(xr[0], yr[0])])
                m.set_stroke(opacity=0)
                return m
            return m.set_stroke(c, 4)
        ctx.add("curve:" + g["id"], live(curve), show=g.get("show", 0.0), how="fade", kind="overlay", part="graph:" + g["id"], z=9, moving=True)

        def dot():
            st = ctx.st()
            x, y = st.get(g["x"], 0.0), st.get(g["y"], 0.0)
            return Dot(ax.c2p(min(xr[1], max(xr[0], x)), clampy(y)), radius=0.07, color=c)
        ctx.add("dot:" + g["id"], live(dot), show=g.get("show", 0.0), how="fade", kind="overlay", part="graph:" + g["id"], z=10, moving=True)
        sel = [(x, y, t) for t, x, y in zip(ts, xs, ys) if xr[0] <= x <= xr[1] and t >= t0]
        if sel:
            ctx.graphs[g["id"]] = (ax, np.array([a for a, _, _ in sel]), np.array([b for _, b, _ in sel]), np.array([c for _, _, c in sel]), g)
    else:
        import sympy as sp

        for k, fdef in enumerate(g.get("functions") or [{"expr": g["expr"], "q": g["y"]}]):
            xs_ = sp.Symbol("x")
            f = sp.lambdify(xs_, sp.sympify(fdef["expr"].replace("^", "**")), "math")
            cc = ctx.color_of(fdef.get("q"), col(fdef.get("color"), MUTED)) if fdef.get("q") else col(fdef.get("color"), MUTED)
            xx = np.linspace(xr[0], xr[1], 200)
            pts = [ax.c2p(x, clampy(float(f(x)))) for x in xx]
            m = VMobject().set_points_smoothly(pts).set_stroke(cc, 4 if fdef.get("q") else 3)
            if fdef.get("dashed"):
                from manim import DashedVMobject
                m = DashedVMobject(m, num_dashes=40)
            ctx.add(f"fn:{g['id']}:{k}", m, show=fdef.get("show", g.get("show", 0.0)), how="create", kind="overlay", part="graph:" + g["id"], z=9)
            if fdef.get("tex"):
                lab = MathTex(fdef["tex"], font_size=24, color=cc).next_to(pts[int(len(pts) * fdef.get("label_at", 0.5))], UP, buff=0.12)
                ctx.add(f"fnlab:{g['id']}:{k}", lab, show=fdef.get("show", g.get("show", 0.0)), how="fade", kind="overlay", part="graph:" + g["id"], z=9)
            if fdef.get("dot_x"):
                xq = fdef["dot_x"]

                def dot(f=f, xq=xq, cc=cc, fdef=fdef):
                    x = ctx.st().get(xq, xr[0])
                    x = min(xr[1], max(xr[0], x))
                    return Dot(ax.c2p(x, clampy(float(f(x)))), radius=0.08, color=cc).set_stroke(INK, 1.5)
                ctx.add(f"fndot:{g['id']}:{k}", live(dot), show=fdef.get("dot_show", g.get("show", 0.0)), how="fade", kind="overlay", part="graph:" + g["id"], z=10, moving=True)


# ════════════════ Cable signal: a neuron (dendrites, soma, myelinated axon, terminals) carrying a spike ════════════════
def _branches(x, y, ang, length, width, depth, rng, out):
    if depth == 0 or length < 0.12:
        return
    x2, y2 = x + length * math.cos(ang), y + length * math.sin(ang)
    mid = ((x + x2) / 2 + rng.uniform(-0.08, 0.08), (y + y2) / 2 + rng.uniform(-0.08, 0.08))
    out.append(((x, y), mid, (x2, y2), width))
    n = 2 if depth > 1 else rng.choice([1, 2])
    for k in range(n):
        da = (k - (n - 1) / 2) * rng.uniform(0.45, 0.75) + rng.uniform(-0.15, 0.15)
        _branches(x2, y2, ang + da, length * rng.uniform(0.62, 0.8), width * 0.68, depth - 1, rng, out)


def cable_signal(ctx, rig):
    box = B(rig)
    rng = np.random.default_rng(int(rig.get("seed", 7)))
    mid = rig.get("model", "hh")
    trace = ctx.W.models[mid].trace if mid in ctx.W.models else None
    N = int(rig.get("nodes", 6))
    dms = float(rig.get("delay_ms", 2.5))
    tissue = col(rig.get("color", "neuron"))
    rs = min(0.75, 0.16 * box.h)
    for _fit in range(12):  # the whole cell (dendritic tree included) must fit its region: shrink until it does
        rng = np.random.default_rng(int(rig.get("seed", 7)))
        sx, sy = box.x0 + 0.15, box.cy
        segs = []
        for k in range(6):
            a = PI * (0.62 + 0.76 * k / 5) + rng.uniform(-0.1, 0.1)
            _branches(rs * 0.8 * math.cos(a), rs * 0.8 * math.sin(a), a, rs * 1.05, 10, 4, rng, segs)
        xs_ = [p[0] for sgm in segs for p in (sgm[0], sgm[2])]
        ys_ = [p[1] for sgm in segs for p in (sgm[0], sgm[2])]
        sx = box.x0 + 0.12 - min(xs_)
        if max(ys_) - min(ys_) < box.h - 0.25 or rs < 0.25:
            break
        rs *= 0.92
    segs = [((p0[0] + sx, p0[1] + sy), (pm[0] + sx, pm[1] + sy), (p1[0] + sx, p1[1] + sy), w) for p0, pm, p1, w in segs]
    ax0, ax1 = sx + rs * 0.9, box.x1 - 0.75
    aw = max(0.14, 0.3 * rs)  # axon diameter
    den = VGroup()
    for p0, pm, p1, w in segs:
        c = VMobject().set_points_smoothly([np.array([*p0, 0]), np.array([*pm, 0]), np.array([*p1, 0])])
        den.add(c.set_stroke(dark(tissue, 0.25), w + 2.2))
    for p0, pm, p1, w in segs:
        c = VMobject().set_points_smoothly([np.array([*p0, 0]), np.array([*pm, 0]), np.array([*p1, 0])])
        den.add(c.set_stroke(tissue, w))
    # soma (irregular smooth blob) + nucleus + hillock
    pts = []
    for k in range(14):
        a = k * TAU / 14
        r = rs * (1 + 0.12 * math.sin(3 * a + 0.4) + 0.06 * math.cos(5 * a))
        pts.append((sx + r * math.cos(a), sy + r * math.sin(a)))
    soma = smooth_closed(pts, tissue, stroke=dark(tissue, 0.35), sw=2.5)
    soma.set_fill([light(tissue, 0.35), tissue], opacity=1).set_sheen_direction(UP + LEFT)
    nuc = Circle(radius=rs * 0.38).move_to([sx - rs * 0.1, sy + rs * 0.05, 0]).set_fill(dark(tissue, 0.25), 0.8).set_stroke(dark(tissue, 0.45), 1.5)
    nucl = Dot([sx - rs * 0.05, sy + rs * 0.1, 0], radius=rs * 0.09, color=dark(tissue, 0.5))
    hill = poly([(sx + rs * 0.75, sy + rs * 0.42), (ax0 + 0.35, sy + aw / 2), (ax0 + 0.35, sy - aw / 2), (sx + rs * 0.75, sy - rs * 0.42)], tissue, stroke=dark(tissue, 0.35), sw=2)
    # axon core + myelin sheaths with nodes of Ranvier between them
    core = shaded_rect(ax0 + 0.3, sy - aw / 2, ax1, sy + aw / 2, tissue, stroke=dark(tissue, 0.35), sw=1.8, vertical=True)
    L = (ax1 - (ax0 + 0.5))
    gap = 0.16
    seg = (L - N * gap) / N
    nodes_x = []
    myel = VGroup()
    x = ax0 + 0.5
    for k in range(N):
        nodes_x.append(x + gap / 2)
        x += gap
        m = RoundedRectangle(width=seg, height=aw * 2.6, corner_radius=aw * 1.2).move_to([x + seg / 2, sy, 0])
        m.set_fill([light(col("myelin"), 0.3), col("myelin"), dark(col("myelin"), 0.08)], opacity=1).set_sheen_direction(UP).set_stroke(dark(col("myelin"), 0.35), 1.6)
        for f in (-0.5, 0.0, 0.5):  # wraps of the Schwann cell membrane
            myel.add(m) if f == -0.5 else None
            myel.add(Line([x + 0.06 * seg, sy + f * aw * 0.9, 0], [x + 0.94 * seg, sy + f * aw * 0.9, 0]).set_stroke(dark(col("myelin"), 0.18), 1))
        x += seg
    # terminals
    term = VGroup()
    tx = ax1
    tips = []
    for k, a in enumerate((-0.55, -0.18, 0.2, 0.55)):
        p0 = np.array([tx, sy, 0])
        p1 = p0 + np.array([0.35 * math.cos(a), 0.35 * math.sin(a), 0])
        p2 = p1 + np.array([0.35 * math.cos(a * 1.6), 0.35 * math.sin(a * 1.6), 0])
        c = VMobject().set_points_smoothly([p0, p1, p2]).set_stroke(tissue, 5)
        term.add(VMobject().set_points_smoothly([p0, p1, p2]).set_stroke(dark(tissue, 0.35), 7.5), c)
        bout = Circle(radius=0.11).move_to(p2 + 0.08 * np.array([math.cos(a * 1.6), math.sin(a * 1.6), 0])).set_fill([light(tissue, 0.3), tissue], 1).set_stroke(dark(tissue, 0.35), 1.8)
        term.add(bout)
        tips.append(bout.get_center())
    body = VGroup(den, hill, core, soma, nuc, nucl, myel, term)
    ctx.add(role(rig, "neuron"), body, show=sh(ctx, rig, "neuron"), how="create")
    ctx.anchors[role(rig, "dendrites")] = list(segs[3][2]) + [0]
    ctx.anchors[role(rig, "soma")] = [sx, sy + rs * 0.9, 0]
    ctx.anchors[role(rig, "axon")] = [nodes_x[1] + seg / 2, sy + aw * 1.3, 0]
    ctx.anchors[role(rig, "myelin")] = [nodes_x[3] + seg / 2, sy - aw * 1.3, 0]
    ctx.anchors[role(rig, "node")] = [nodes_x[2], sy - aw * 0.6, 0]
    ctx.anchors[role(rig, "terminals")] = list(tips[0])
    ctx.anchors[role(rig, "neuron")] = [sx, sy - rs, 0]
    for k in ("dendrites", "soma", "axon", "terminals", "myelin", "node"):
        ctx.bodies.setdefault(role(rig, k), body)

    def v_at(ms):
        if trace is None:
            return -70.0
        j = int(np.clip(np.searchsorted(trace[:, 0], ms), 0, len(trace) - 1))
        return float(trace[j, 1]) if ms >= 0 else -70.0

    rest_c, hot_c = Q["navy"], "#E8A33A"

    def spikes():
        st = ctx.st()
        ms = st.get(mid + "_ms", 0.0)
        g = VGroup()
        for k, xk in enumerate(nodes_x):
            v = v_at(ms - k * dms)
            f = min(1.0, max(0.0, (v + 70) / 110))
            c = mix(rest_c, hot_c, f)
            if f > 0.05:  # glow of the depolarised node (charge flowing in)
                for gr_ in (0.7, 0.5, 0.33):
                    g.add(Circle(radius=(0.12 + gr_ * f) * (1 + aw)).move_to([xk, sy, 0]).set_fill(hot_c, 0.22 * f).set_stroke(width=0))
            g.add(Circle(radius=0.07 + 0.16 * f).move_to([xk, sy, 0]).set_fill(c, 0.35 + 0.55 * f).set_stroke(c, 2.5))
            if f > 0.25:  # local current spreading inside the next internode (faint)
                g.add(Line([xk, sy, 0], [xk + seg * 0.95 * f, sy, 0]).set_stroke(hot_c, 10 * f, opacity=0.75))
        # terminal boutons light up when the last node fires
        v = v_at(ms - N * dms)
        f = min(1.0, max(0.0, (v + 70) / 110))
        for p in tips:
            g.add(Circle(radius=0.13).move_to(p).set_stroke(hot_c, 4 * f + 0.01, opacity=f))
        return g
    ctx.add("spike", live(spikes), show=sh(ctx, rig, "axon"), how="fade", kind="body", part="spike", z=6, moving=True)
    # recording electrode at node 0
    e0 = np.array([nodes_x[0], sy + aw / 2 + 0.02, 0])
    elec = VGroup(poly([(e0[0] - 0.03, e0[1]), (e0[0] - 0.12, e0[1] + 0.9), (e0[0] + 0.12, e0[1] + 0.9), (e0[0] + 0.03, e0[1])], col("glass"), sw=1.5, op=0.8),
                  Line(e0 + [0, 0.9, 0], e0 + [0.5, 1.4, 0]).set_stroke(MUTED, 2))
    if rig.get("electrode", True):
        ctx.add("electrode", elec, show=rig.get("electrode_show", 0.0), how="fade", kind="overlay", z=3)
        ctx.anchors["electrode"] = list(e0 + [0.1, 0.7, 0])
    # channel inset: membrane patch with a Na+ and a K+ channel whose gates follow m^3 h and n^4
    ib = rig.get("inset_box")
    if ib and trace is not None:
        ibox = Box(*ib)
        gna = trace[:, 5] / trace[:, 5].max()
        kk = trace[:, 6]
        gk = (kk - kk.min()) / (kk.max() - kk.min())
        frame = RoundedRectangle(width=ibox.w, height=ibox.h, corner_radius=0.12).move_to(ibox.c).set_fill(THEME_PANEL(), THEME_PANEL_OP()).set_stroke(RULE, 2)
        my = ibox.cy
        lip = VGroup()
        thick = 0.42
        heads = int(ibox.w / 0.13)
        for i in range(heads):
            xx = ibox.x0 + 0.08 + i * (ibox.w - 0.16) / (heads - 1)
            for sgn in (1, -1):
                lip.add(Line([xx, my + sgn * thick * 0.42, 0], [xx, my + sgn * 0.03, 0]).set_stroke(dark(col("membrane"), 0.2), 1.4))
                lip.add(Dot([xx, my + sgn * thick / 2, 0], radius=0.05, color=col("membrane")).set_stroke(dark(col("membrane"), 0.35), 1))
        chx = {"Na": ibox.x0 + 0.33 * ibox.w, "K": ibox.x0 + 0.70 * ibox.w}
        lab = VGroup(label_text("outside", 18, MUTED).move_to(ibox.p(0.12, 0.9)), label_text("inside", 18, MUTED).move_to(ibox.p(0.1, 0.1)))
        ctx.add(role(rig, "membrane"), VGroup(frame, lip, lab), show=rig.get("inset_show", 0.0), how="fade", kind="body", part=role(rig, "membrane"), z=2)
        ctx.anchors[role(rig, "membrane")] = [ibox.x0 + 0.5 * ibox.w, my + thick / 2, 0]
        if rig.get("inset_link", True):
            link = DashedLine([nodes_x[0], sy - aw, 0], [ibox.cx, ibox.y1, 0]).set_stroke(MUTED, 1.5)
            ctx.add("inset_link", link, show=rig.get("inset_show", 0.0), how="fade", kind="overlay", z=1)
        ion_c = {"Na": "#E07B20", "K": "#7B4FA6"}
        rngi = np.random.default_rng(3)
        bg_ions = {"Na": [(rngi.uniform(0.05, 0.95), rngi.uniform(0.66, 0.95)) for _ in range(9)], "K": [(rngi.uniform(0.05, 0.95), rngi.uniform(0.05, 0.34)) for _ in range(9)]}

        def chans():
            st = ctx.st()
            ms = st.get(mid + "_ms", 0.0)
            j = int(np.clip(np.searchsorted(trace[:, 0], ms), 0, len(trace) - 1))
            op = {"Na": float(gna[j]), "K": float(gk[j])}
            t = st["t"]
            g = VGroup()
            for ion in ("Na", "K"):
                x = chx[ion]
                o = op[ion]
                half = 0.07 + 0.09 * o
                pc = col("protein") if ion == "Na" else mix(col("protein"), Q["teal"], 0.35)
                for sgn in (-1, 1):
                    xc = x + sgn * (half + 0.13)
                    g.add(RoundedRectangle(width=0.26, height=thick + 0.3, corner_radius=0.1).move_to([xc, my, 0]).set_fill([light(pc, 0.3), pc], 1).set_stroke(dark(pc, 0.35), 1.6))
                # gate lid at the inner mouth: swings open with the gating variable
                ang = (1 - o) * 0.0 + o * 1.2
                g.add(Line([x - half, my - thick / 2 - 0.15, 0], [x - half + 2 * half * math.cos(ang), my - thick / 2 - 0.15 - 2 * half * math.sin(ang), 0]).set_stroke(dark(pc, 0.4), 4))
                g.add(label_text(("Na⁺" if ion == "Na" else "K⁺") + " channel", 17, dark(pc, 0.3)).move_to([x, ibox.y0 + 0.17 if ion == "Na" else ibox.y1 - 0.17, 0]))
                # ions passing through: inward Na+, outward K+ (count and speed follow the open fraction)
                for q in range(5):
                    ph = (t * 0.55 + q / 5) % 1.0
                    if o < 0.08:
                        continue
                    y = (my + 0.75 - 1.5 * ph) if ion == "Na" else (my - 0.75 + 1.5 * ph)
                    if abs(y - my) > ibox.h / 2 - 0.12:
                        continue
                    g.add(Dot([x + 0.02 * math.sin(7 * ph + q), y, 0], radius=0.065, color=ion_c[ion]).set_opacity(min(1, o * 1.5)))
            for ion, ps in bg_ions.items():
                for (fx, fy) in ps:
                    g.add(Dot(ibox.p(fx, fy) + np.array([0.04 * math.sin(t * 2 + fx * 9), 0.03 * math.cos(t * 2.3 + fy * 7), 0]), radius=0.06, color=ion_c[ion]))
            return g
        ctx.add("channels", live(chans), show=rig.get("inset_show", 0.0), how="fade", kind="body", part=role(rig, "channel"), z=4, moving=True)
        ctx.anchors[role(rig, "na_channel")] = [chx["Na"], my + thick / 2 + 0.15, 0]
        ctx.anchors[role(rig, "k_channel")] = [chx["K"], my + thick / 2 + 0.15, 0]
        ctx.anchors[role(rig, "channel")] = [chx["Na"], my + thick / 2 + 0.15, 0]


RIGS["cable_signal"] = cable_signal


# ════════════════ Binding: a host with a pocket, guests whose shapes are the pocket's complement, induced fit ════════════════
def _rounded_poly(pts, r=0.06, res=8):
    from shapely.geometry import Polygon as SP
    return SP(pts).buffer(-r).buffer(r, resolution=res)


def _sp_mob(geom, color, sw=2.2, op=1.0, stroke=INK):
    """shapely polygon (largest part) -> smooth manim polygon"""
    from shapely.geometry import MultiPolygon
    if isinstance(geom, MultiPolygon):
        geom = max(geom.geoms, key=lambda g: g.area)
    xy = np.array(geom.exterior.coords)[:-1]
    m = Polygon(*[np.array([x, y, 0.0]) for x, y in xy])
    m.set_fill([light(color, 0.35), color, dark(color, 0.1)], opacity=op).set_sheen_direction(UP + LEFT).set_stroke(stroke, sw)
    return m


def binding(ctx, rig):
    from shapely.geometry import Point, Polygon as SP, box as sbox
    from shapely import affinity
    from shapely.ops import unary_union

    bx = B(rig)
    R = min(bx.w * 0.30, bx.h * 0.36)
    ex, ey = bx.x0 + bx.w * 0.42, bx.y0 + bx.h * 0.40
    pcol = col(rig.get("host_color", "protein"))
    gcols = [col(c) for c in rig.get("guest_colors", ["#E07B39", "#3F8FBF"])]
    rng = np.random.default_rng(int(rig.get("seed", 11)))
    # guests: two reactant shapes that sit side by side (join) or one substrate (split); distinctive notches
    s = R * 0.30
    A = _rounded_poly([(-1.0 * s, -0.55 * s), (-0.15 * s, -0.95 * s), (0.05 * s, -0.35 * s), (0.05 * s, 0.55 * s), (-0.55 * s, 0.85 * s), (-1.1 * s, 0.35 * s)], 0.05 * s / 0.3)
    Bg = _rounded_poly([(0.05 * s, -0.35 * s), (0.6 * s, -0.95 * s), (1.1 * s, -0.45 * s), (1.05 * s, 0.5 * s), (0.45 * s, 0.85 * s), (0.05 * s, 0.55 * s)], 0.05 * s / 0.3)
    guests = [A, Bg] if rig.get("guests", 2) == 2 else [unary_union([A, Bg])]
    G = unary_union(guests)
    pocket_c = (ex, ey + R * 0.62)  # where the guests sit when bound
    Gp = affinity.translate(G, pocket_c[0], pocket_c[1])
    # host: smooth blob minus the pocket (complement of the guests, small clearance), plus a mouth to the surface
    pts = []
    for k in range(48):
        a = k * TAU / 48
        r = R * (1 + 0.07 * math.sin(3 * a + 0.7) + 0.05 * math.cos(5 * a + 0.3) + 0.03 * math.sin(7 * a))
        pts.append((ex + r * math.cos(a), ey + r * math.sin(a)))
    blob = SP(pts)
    mouth = sbox(pocket_c[0] - s * 0.55, pocket_c[1], pocket_c[0] + s * 0.55, ey + R * 2)
    host = blob.difference(unary_union([Gp.buffer(0.035), mouth])).buffer(-0.02).buffer(0.02)
    hinge = (ex, ey - R * 0.55)
    left = host.intersection(sbox(ex - 3 * R, ey - 3 * R, ex, ey + 3 * R))
    right = host.intersection(sbox(ex, ey - 3 * R, ex + 3 * R, ey + 3 * R))
    open_deg = float(rig.get("open_deg", 14))
    # secondary-structure hints (helices / strands) inside each lobe
    deco = {"L": [], "Rt": []}
    for lobe_name, lobe in (("L", left), ("Rt", right)):
        tries = 0
        while len(deco[lobe_name]) < 3 and tries < 200:
            tries += 1
            x = rng.uniform(ex - R, ex + R)
            y = rng.uniform(ey - R, ey + R)
            if lobe.buffer(-0.28 * R).contains(Point(x, y)):
                deco[lobe_name].append((x, y, rng.uniform(-0.6, 0.6), rng.random() < 0.6))
    proc = {k: rig.get(k) for k in ("approach", "close", "react", "release")}
    react_kind = rig.get("reaction", "join")

    def angle_open(st):
        c = st.get(proc["close"], 0.0) if proc["close"] else 0.0
        rl = st.get(proc["release"], 0.0) if proc["release"] else 0.0
        return open_deg * (1 - c) + open_deg * rl * c

    hy = hinge[1]
    top = ey + R * 1.2

    def warp(x, y, a):
        """continuous hinge bend: points above the hinge rotate about it by a fraction that grows with height,
        left half one way, right half the other (no seam, the chain stays connected at the hinge)"""
        w = smooth01((y - hy) / (top - hy)) if y > hy else 0.0
        side = math.tanh((x - ex) / (0.12 * R))
        th = -math.radians(a) * w * side
        dx, dy = x - hinge[0], y - hinge[1]
        return hinge[0] + dx * math.cos(th) - dy * math.sin(th), hinge[1] + dx * math.sin(th) + dy * math.cos(th)

    from shapely.geometry import MultiPolygon as _MP
    hgeom = max(host.geoms, key=lambda g: g.area) if isinstance(host, _MP) else host
    hxy = np.array(hgeom.segmentize(0.05).exterior.coords)[:-1]
    deco_all = deco["L"] + deco["Rt"]

    def host_mob():
        st = ctx.st()
        a = angle_open(st)
        P = [warp(x, y, a) for x, y in hxy]
        m = Polygon(*[np.array([x, y, 0.0]) for x, y in P])
        m.set_fill([light(pcol, 0.35), pcol, dark(pcol, 0.1)], opacity=1).set_sheen_direction(UP + LEFT).set_stroke(INK, 2.5)
        grp = VGroup(m)
        for (x, y, rot, helix) in deco_all:
            L = 0.32 * R
            if helix:
                us = np.linspace(-L / 2, L / 2, 40)
                vs = 0.06 * R * np.sin(us / L * 6 * PI)
            else:
                us = np.linspace(-L / 2, L / 2, 2)
                vs = np.zeros(2)
            pts = [warp(x + u * math.cos(rot) - v * math.sin(rot), y + u * math.sin(rot) + v * math.cos(rot), a) for u, v in zip(us, vs)]
            P3 = [np.array([px, py, 0]) for px, py in pts]
            if helix:
                grp.add(VMobject().set_points_smoothly(P3).set_stroke(dark(pcol, 0.3), 3))
            else:
                grp.add(Arrow(P3[0], P3[-1], buff=0, stroke_width=7, color=dark(pcol, 0.22), tip_length=0.12, max_tip_length_to_length_ratio=0.35))
        return grp
    hm = live(host_mob)
    ctx.add(role(rig, "host"), hm, show=sh(ctx, rig, "host"), how="fade", z=2, moving=True)
    ctx.anchors[role(rig, "host")] = [ex - R * 0.9, ey - R * 0.5, 0]
    ctx.anchors[role(rig, "site")] = [pocket_c[0] + s * 1.0, pocket_c[1] - s * 0.6, 0]
    ctx.bodies[role(rig, "site")] = hm
    start = [(bx.x0 + bx.w * 0.12, bx.y0 + bx.h * 0.9), (bx.x0 + bx.w * 0.30, bx.y0 + bx.h * 0.97)]
    exitp = (bx.x0 + bx.w * 0.80, bx.y0 + bx.h * 0.88)

    def guest_mob():
        st = ctx.st()
        ap = st.get(proc["approach"], 0.0) if proc["approach"] else 1.0
        rx = st.get(proc["react"], 0.0) if proc["react"] else 0.0
        rl = st.get(proc["release"], 0.0) if proc["release"] else 0.0
        g = VGroup()
        for i, sh_ in enumerate(guests):
            s0 = start[i % len(start)]
            # approach: straight in from the solvent with a gentle tumble that settles into the pocket orientation
            f = smooth01(ap)
            px = s0[0] + (pocket_c[0] - s0[0]) * f
            py = s0[1] + (pocket_c[1] - s0[1]) * f
            rot = (1 - f) * (40 if i == 0 else -55)
            if rl > 0:
                px += (exitp[0] - pocket_c[0]) * smooth01(rl) + (0.0 if react_kind == "join" else (i - 0.5) * 0.8 * smooth01(rl))
                py += (exitp[1] - pocket_c[1]) * smooth01(rl)
            gg = affinity.translate(affinity.rotate(sh_, rot, origin=(0, 0)), px, py)
            cc = gcols[i % len(gcols)]
            if rx > 0.5:
                cc = mix(cc, gcols[0] if react_kind == "join" else cc, 0.0)
            g.add(_sp_mob(gg, cc, sw=2.2))
        # the bond being made (join) or strained/broken (split): drawn from the same reaction progress
        if len(guests) == 2 and rx > 0:
            a = np.array([pocket_c[0] - 0.12 * s, pocket_c[1] + 0.1 * s, 0])
            b = np.array([pocket_c[0] + 0.22 * s, pocket_c[1] + 0.1 * s, 0])
            off = np.array([(exitp[0] - pocket_c[0]) * smooth01(rl), (exitp[1] - pocket_c[1]) * smooth01(rl), 0])
            if react_kind == "join":
                w = 7 * smooth01((rx - 0.3) / 0.7)
                g.add(Line(a + off, b + off).set_stroke(INK, max(0.01, w)))
            glow = math.sin(PI * min(1, rx * 1.2)) if rx < 1 else 0
            if glow > 0.02:
                g.add(Circle(radius=0.3 * s + 0.1 * glow).move_to((a + b) / 2 + off).set_stroke("#E8A33A", 5 * glow, opacity=glow))
        return g
    gm = live(guest_mob)
    ctx.add(role(rig, "guest"), gm, show=sh(ctx, rig, "guest"), how="fade", z=3, moving=True)
    ctx.anchors[role(rig, "guest")] = lambda: (gm.get_center() + np.array([0, gm.height / 2, 0])).tolist()
    ctx.anchors[role(rig, "product")] = lambda: (gm.get_center() + np.array([gm.width / 2, 0, 0])).tolist()
    # fit check (SGA-style, exact geometry): bound + closed guests overlap the host by < 2 % of their area
    closed_host = unary_union([left, right])
    ov = Gp.intersection(closed_host).area / Gp.area
    inside = Gp.intersection(blob).area / Gp.area
    ctx.checks.append({"type": "fits_into", "parts": [role(rig, "guest"), role(rig, "host")], "overlap_frac": round(ov, 4), "inside_frac": round(inside, 3), "ok": ov < 0.02 and inside > 0.6})


RIGS["binding"] = binding


# ════════════════ Gear train with a sum constraint (open differential), top-view schematic ════════════════
def _stripes(x0, y0, x1, y1, phase, spacing, vertical, color, sw=1.6, taper=None):
    """Tooth / tread lines on a face seen edge-on; they scroll with the rotation angle (phase in face units)."""
    g = VGroup()
    if vertical:  # lines across x, scrolling in y
        k0 = math.floor((y0 - phase) / spacing)
        y = phase + k0 * spacing
        while y <= y1:
            if y >= y0:
                g.add(Line([x0, y, 0], [x1, y, 0]).set_stroke(color, sw))
            y += spacing
    else:
        k0 = math.floor((x0 - phase) / spacing)
        x = phase + k0 * spacing
        while x <= x1:
            if x >= x0:
                g.add(Line([x, y0, 0], [x, y1, 0]).set_stroke(color, sw))
            x += spacing
    return g


def _trap(cx, cy, wide, narrow, depth, facing, color):
    """bevel gear seen edge-on: a trapezoid, wide face toward `facing` (unit vector)"""
    fx, fy = facing
    px, py = -fy, fx
    a = (cx - fx * depth / 2 + px * narrow / 2, cy - fy * depth / 2 + py * narrow / 2)
    b = (cx - fx * depth / 2 - px * narrow / 2, cy - fy * depth / 2 - py * narrow / 2)
    c = (cx + fx * depth / 2 - px * wide / 2, cy + fy * depth / 2 - py * wide / 2)
    d = (cx + fx * depth / 2 + px * wide / 2, cy + fy * depth / 2 + py * wide / 2)
    return poly([a, b, c, d], color, sw=2, sheen=np.array([px, py, 0]))


def differential(ctx, rig):
    bx = B(rig)
    steel, brass, rub = col("steel"), col("brass"), col("rubber")
    pL, pR, pC = rig.get("left", "phiL"), rig.get("right", "phiR"), rig.get("carrier", "phiC")
    cx, ay = bx.x0 + bx.w * 0.5, bx.y0 + bx.h * 0.62
    H = min(bx.h * 0.62, bx.w * 0.26)
    # wheels
    ww, wh = H * 0.32, H * 0.95
    xl, xr = bx.x0 + ww / 2 + 0.1, bx.x1 - ww / 2 - 0.1
    cw, ch = H * 0.95, H * 0.78  # carrier box
    sg = H * 0.16  # side-gear depth
    rgx = cx + cw / 2 + 0.06  # ring gear plane
    ctx.checks.append({"type": "sum_constraint", "what": "omega_L + omega_R = 2 omega_carrier", "ok": True})

    def scene():
        st = ctx.st()
        aL, aR, aC = st.get(pL, 0.0), st.get(pR, 0.0), st.get(pC, 0.0)
        g = VGroup()
        # axles
        g.add(shaded_rect(xl, ay - 0.07, cx - cw / 2 + 0.05, ay + 0.07, steel, sw=1.5, vertical=True))
        g.add(shaded_rect(cx + cw / 2 - 0.05, ay - 0.07, xr, ay + 0.07, steel, sw=1.5, vertical=True))
        # wheels: tyre with tread scrolling at the wheel's angle (top view: the tread moves along the car)
        for x, a in ((xl, aL), (xr, aR)):
            g.add(shaded_rect(x - ww / 2, ay - wh / 2, x + ww / 2, ay + wh / 2, rub, sw=2, r=0.12))
            g.add(_stripes(x - ww / 2 + 0.05, ay - wh / 2 + 0.06, x + ww / 2 - 0.05, ay + wh / 2 - 0.06, (a * wh * 0.5) % 0.16, 0.16, True, "#6A6A72", 2.2))
            g.add(shaded_rect(x - ww * 0.18, ay - 0.12, x + ww * 0.18, ay + 0.12, steel, sw=1.2))
        # carrier (cage) + ring gear bolted to it; its cross bolts scroll with the carrier angle
        g.add(shaded_rect(cx - cw / 2, ay - ch / 2, cx + cw / 2, ay + ch / 2, light(steel, 0.25), sw=2, r=0.08))
        g.add(_stripes(cx - cw / 2 + 0.02, ay - ch / 2 + 0.03, cx - cw / 2 + 0.12, ay + ch / 2 - 0.03, (aC * ch * 0.4) % 0.22, 0.22, True, dark(steel, 0.35), 2.5))
        g.add(shaded_rect(rgx - 0.06, ay - H * 0.62, rgx + 0.2, ay + H * 0.62, brass, sw=2, vertical=False))
        g.add(_stripes(rgx - 0.06, ay - H * 0.62 + 0.04, rgx + 0.2, ay + H * 0.62 - 0.04, (aC * H * 0.5) % 0.09, 0.09, True, dark(brass, 0.4), 1.4))
        # side gears (on the axles), spider gears (on the cross pin, carried by the cage)
        sgx = cw * 0.27  # side gears sit on the axles, spider gears between them on the cross pin
        side_c, spid_c = "#7F9DB8", mix(brass, "#FFFFFF", 0.1)
        g.add(Line([cx, ay - ch * 0.44, 0], [cx, ay + ch * 0.44, 0]).set_stroke(dark(steel, 0.3), 6))  # cross pin
        for sgn, a in ((-1, aL), (1, aR)):
            xg = cx + sgn * sgx
            g.add(_trap(xg, ay, ch * 0.62, ch * 0.28, sg, (-sgn, 0), side_c))
            xf = xg - sgn * sg / 2
            g.add(_stripes(min(xf, xf - sgn * 0.06), ay - ch * 0.3, max(xf, xf - sgn * 0.06), ay + ch * 0.3, (a * ch * 0.3) % 0.07, 0.07, True, INK, 1.3))
        spin = (aR - aL) / 2  # spider rotation relative to the cage (equal side-gear and spider teeth)
        for sgn in (1, -1):
            yg = ay + sgn * ch * 0.27
            g.add(_trap(cx, yg, ch * 0.42, ch * 0.2, sg, (0, -sgn), spid_c))
            yf = yg - sgn * sg / 2
            g.add(_stripes(cx - ch * 0.2, min(yf, yf - sgn * 0.06), cx + ch * 0.2, max(yf, yf - sgn * 0.06), (sgn * spin * ch * 0.3) % 0.06, 0.06, False, INK, 1.3))
        # pinion on the drive shaft, meshing with the ring gear; drive shaft to the gearbox
        py0 = ay - H * 0.62 - 0.02
        g.add(_trap(rgx + 0.42, py0 + 0.02, 0.5, 0.22, 0.3, (-1, 0), col("aluminium")))
        g.add(shaded_rect(rgx + 0.55, py0 - 0.06, bx.x1 - ww - 0.7, py0 + 0.1, steel, sw=1.5, vertical=True))
        g.add(_stripes(rgx + 0.62, py0 - 0.06, bx.x1 - ww - 0.75, py0 + 0.1, (aC * 0.37) % 0.25, 0.25, False, dark(steel, 0.4), 1.5))
        return g
    m = live(scene)
    ctx.add(role(rig, "differential"), m, show=sh(ctx, rig, "differential"), how="fade", z=2, moving=True)
    for k in ("ring_gear", "pinion", "spider_gears", "side_gears", "left_wheel", "right_wheel", "axle", "drive_shaft", "carrier"):
        ctx.bodies[role(rig, k)] = m
    ctx.anchors[role(rig, "ring_gear")] = [rgx + 0.1, ay + H * 0.55, 0]
    ctx.anchors[role(rig, "pinion")] = [rgx + 0.42, ay - H * 0.62 - 0.1, 0]
    ctx.anchors[role(rig, "spider_gears")] = [cx, ay + ch * 0.3, 0]
    ctx.anchors[role(rig, "side_gears")] = [cx - cw * 0.27, ay - ch * 0.28, 0]
    ctx.anchors[role(rig, "left_wheel")] = [xl, ay + wh / 2, 0]
    ctx.anchors[role(rig, "right_wheel")] = [xr, ay + wh / 2, 0]
    ctx.anchors[role(rig, "axle")] = [(xl + cx) / 2, ay, 0]
    ctx.anchors[role(rig, "drive_shaft")] = [bx.x1 - ww - 1.0, ay - H * 0.62, 0]
    ctx.anchors[role(rig, "carrier")] = [cx - cw / 4, ay - ch / 2, 0]
    ctx.anchors[role(rig, "differential")] = [cx, ay - ch / 2, 0]
    # inset: the car seen from above taking a corner; inner and outer wheel tracks drawn from the same angles
    ib = rig.get("inset_box")
    if ib:
        ibx = Box(*ib)
        turn = rig.get("turn", "turn")
        track = 0.5
        Rc = min(ibx.h - 0.45, ibx.w) * 0.66
        C = np.array([ibx.x0 + 0.75, ibx.y0 + 0.55, 0])  # turning centre (left turn: centre on the left)
        cL = ctx.color_of(rig.get("qL"), Q["navy"])
        cR = ctx.color_of(rig.get("qR"), Q["clay"])
        rwheel = float(rig.get("wheel_r", 0.3))

        def car():
            st = ctx.st()
            aC = st.get(pC, 0.0)
            # arc travelled by the axle centre = wheel radius x carrier angle (rolling without slip)
            s = rwheel * aC
            th = (s / Rc) % (PI / 2 * 0.85)  # laps of the corner, so the car keeps moving
            g = VGroup()
            g.add(Arc(radius=Rc + track * 1.4, start_angle=0, angle=PI / 2, arc_center=C).set_stroke(RULE, 2))
            g.add(Arc(radius=Rc - track * 1.4, start_angle=0, angle=PI / 2, arc_center=C).set_stroke(RULE, 2))
            if th > 1e-3:
                g.add(Arc(radius=Rc - track / 2, start_angle=0, angle=th, arc_center=C).set_stroke(cL, 5))
                g.add(Arc(radius=Rc + track / 2, start_angle=0, angle=th, arc_center=C).set_stroke(cR, 5))
            pos = C + Rc * np.array([math.cos(th), math.sin(th), 0])
            body = RoundedRectangle(width=track * 1.25, height=track * 2.1, corner_radius=0.12).set_fill(col("plastic"), 1).set_stroke(INK, 2)
            body.move_to(pos + 0.35 * np.array([-math.sin(th), math.cos(th), 0]))
            wl = VGroup(*[Rectangle(width=0.1, height=0.26).set_fill(rub, 1).set_stroke(INK, 1).move_to(pos + d * (track / 2) * np.array([math.cos(th), math.sin(th), 0]) + f * np.array([-math.sin(th), math.cos(th), 0]))
                          for d in (-1, 1) for f in (0.0, 0.75)])
            body.rotate(th, about_point=body.get_center())
            for w in wl:
                w.rotate(th, about_point=w.get_center())
            g.add(body, wl)
            return g
        cm = live(car)
        ctx.add(role(rig, "car"), cm, show=sh(ctx, rig, "car", ctx.show_time(turn, 0.0)), how="fade", z=3, moving=True)
        ctx.anchors[role(rig, "car")] = lambda: cm.get_center().tolist()
        ctx.anchors["inner_track"] = [C[0] + (Rc - track / 2) * 0.98, C[1] + 0.2, 0]
        ctx.anchors["outer_track"] = [C[0] + (Rc + track / 2) * 0.98, C[1] + 0.2, 0]


RIGS["differential"] = differential


# ════════════════ Flow reactor: a duct with a reactive channel zone, gas molecules converted on a catalytic surface ════════════════
_MOLCACHE: dict = {}


def _mol(name):
    if name not in _MOLCACHE:
        import gm_refdata
        _MOLCACHE[name] = gm_refdata.molecule(name)
    return _MOLCACHE[name]


def _mol_at(name, x, y, scale, angle=0.0, op=1.0):
    m = _mol(name)
    if not m:
        d = Circle(radius=scale * 0.35).move_to([x, y, 0]).set_fill(MUTED, op).set_stroke(INK, 1)
        return d
    g = molecule_mob(m, scale=scale, center=(x, y), angle=angle)
    if op < 1:
        g.set_opacity(op)
    return g


def _terms(side: str):
    import re
    out = []
    for term in side.split("+"):
        term = term.strip()
        mm = re.match(r"^(\d*)\s*(.+)$", term)
        if mm:
            out.append((int(mm.group(1) or 1), mm.group(2).strip()))
    return out


def flow_reactor(ctx, rig):
    bx = B(rig)
    steel, cer = col("steel"), col("ceramic")
    flow = rig.get("flow", "flow")
    yc = bx.cy
    hp = bx.h * 0.22  # pipe bore
    hs = bx.h * 0.78  # shell height
    x_in0, x_c0, x_s0 = bx.x0, bx.x0 + bx.w * 0.12, bx.x0 + bx.w * 0.22
    x_s1, x_c1, x_out1 = bx.x0 + bx.w * 0.78, bx.x0 + bx.w * 0.88, bx.x1
    zones = rig.get("zones") or [{"name": "catalyst", "coat": "Pt"}]
    zx = [x_s0 + 0.15 + k * ((x_s1 - x_s0 - 0.3) / len(zones)) for k in range(len(zones) + 1)]
    nch = 9
    body = VGroup()
    # shell: inlet pipe, cones, can, outlet pipe (cutaway: walls only, interior visible)
    top = [(x_in0, yc + hp / 2), (x_c0, yc + hp / 2), (x_s0, yc + hs / 2), (x_s1, yc + hs / 2), (x_c1, yc + hp / 2), (x_out1, yc + hp / 2)]
    bot = [(x, 2 * yc - y) for x, y in top]
    for edge in (top, bot):
        sgn = 1 if edge is top else -1
        outer = [(x, y + sgn * 0.12) for x, y in edge]
        body.add(poly(edge + outer[::-1], steel, sw=2, sheen=UP))
    body.add(Polygon(*[np.array([x, y, 0]) for x, y in top + bot[::-1]]).set_fill(col("gas"), 0.18).set_stroke(width=0))
    # monolith bricks: ceramic with many parallel channels (walls), one per zone
    bricks = VGroup()
    for k, z in enumerate(zones):
        a, b = zx[k] + 0.06, zx[k + 1] - 0.06
        y0, y1 = yc - hs / 2 + 0.05, yc + hs / 2 - 0.05
        br = shaded_rect(a, y0, b, y1, cer, sw=2, vertical=True)
        bricks.add(br)
        for i in range(nch + 1):
            yy = y0 + (y1 - y0) * i / nch
            bricks.add(Line([a, yy, 0], [b, yy, 0]).set_stroke(dark(cer, 0.35), 2.2))
        coat = col("platinum") if z.get("coat", "Pt") == "Pt" else col("rh") if False else "#8B93A3"
        for i in range(nch):  # catalyst grains on the channel walls
            yy = y0 + (y1 - y0) * (i + 0.5) / nch
            for xx in np.linspace(a + 0.1, b - 0.1, 7):
                bricks.add(Dot([xx, yy - (y1 - y0) / nch / 2 + 0.035, 0], radius=0.025, color=dark(coat, 0.2)))
        for i in range(nch):  # channels are open: gas inside each lane
            yy = y0 + (y1 - y0) * (i + 0.5) / nch
            bricks.add(Line([a, yy, 0], [b, yy, 0]).set_stroke(BG, (y1 - y0) / nch * 40, opacity=0.55))
    body.add(bricks)
    ctx.add(role(rig, "converter"), body, show=sh(ctx, rig, "converter"), how="create", z=1)
    ctx.anchors[role(rig, "converter")] = [(x_s0 + x_s1) / 2, yc + hs / 2 + 0.12, 0]
    ctx.anchors[role(rig, "inlet")] = [x_in0 + 0.4, yc + hp / 2 + 0.1, 0]
    ctx.anchors[role(rig, "outlet")] = [x_out1 - 0.4, yc + hp / 2 + 0.1, 0]
    ctx.anchors[role(rig, "monolith")] = [(zx[0] + zx[-1]) / 2, yc - hs / 2 + 0.2, 0]
    ctx.anchors[role(rig, "channels")] = [(zx[0] + zx[1]) / 2, yc + hs / 4, 0]
    for k, z in enumerate(zones):
        ctx.anchors[role(rig, f"zone{k}")] = [(zx[k] + zx[k + 1]) / 2, yc + hs / 2 - 0.1, 0]
    for r in ("inlet", "outlet", "monolith", "channels", "zone0", "zone1"):
        ctx.bodies[role(rig, r)] = body
    # gas stream: species follow lanes; inside the zones each reactant becomes its product (the mapping is declared)
    ins = rig.get("inputs") or ["CO", "NO", "CCC"]
    mp = rig.get("map") or {}
    lanes = [yc + (i - 2) * hp * 0.22 for i in range(5)]
    n = int(rig.get("n_particles", 16))
    L = x_out1 - x_in0
    conv = rig.get("active")
    zone_mid = (zx[0] + zx[-1]) / 2
    sc = min(0.3, hp * 0.3)

    def gas():
        st = ctx.st()
        ph = st.get(flow, 0.0)
        act = st.get(conv, 1.0) if conv else 1.0
        g = VGroup()
        for j in range(n):
            u = (ph * 0.06 + j / n) % 1.0
            x = x_in0 + 0.4 + u * (L - 0.8)
            # lanes: in the can the stream spreads over the channels, in the pipes it is narrow
            spread = 1.0
            if x_c0 < x < x_c1:
                spread = 1 + (hs / hp - 1) * 0.75 * (min(1, (x - x_c0) / (x_s0 - x_c0)) if x < x_s0 else (1 if x < x_s1 else max(0, (x_c1 - x) / (x_c1 - x_s1))))
            lane = (j * 7) % 5
            yy = yc + (lanes[lane] - yc) * spread
            sp = ins[j % len(ins)]
            if act > 0.5 and x > zone_mid:
                prod = [q.strip() for q in str(mp.get(sp, sp)).split("+") if q.strip()]  # 'CO2 + H2O': products take turns
                sp = prod[(j // len(ins)) % len(prod)] if prod else sp
            g.add(_mol_at(sp, x, yy, sc, angle=(j * 1.3 + ph * 0.05 * (1 + j % 3)) % TAU))
        return g
    ctx.add("gas", live(gas), show=ctx.show_time(flow, sh(ctx, rig, "converter")), how="fade", kind="body", part=role(rig, "gas"), z=4, moving=True)
    ctx.anchors[role(rig, "gas")] = [x_in0 + 0.6, yc - hp / 2 - 0.1, 0]
    # close-up of one channel wall: washcoat with metal grains; each declared reaction plays on its own progress
    ib = rig.get("inset_box")
    if ib:
        ibx = Box(*ib)
        wall_y = ibx.y0 + ibx.h * 0.22
        fr = RoundedRectangle(width=ibx.w, height=ibx.h, corner_radius=0.12).move_to(ibx.c).set_fill(THEME_PANEL(), THEME_PANEL_OP()).set_stroke(RULE, 2)
        wall = shaded_rect(ibx.x0 + 0.05, ibx.y0 + 0.05, ibx.x1 - 0.05, wall_y - 0.12, cer, sw=1.5, vertical=True)
        wash = shaded_rect(ibx.x0 + 0.05, wall_y - 0.12, ibx.x1 - 0.05, wall_y, "#D9D2C3", sw=1.2, vertical=True)
        rx = rig.get("reactions") or []
        sites = []
        grains = VGroup()
        for k, r in enumerate(rx):
            sxk = ibx.x0 + ibx.w * (k + 0.5) / max(1, len(rx))
            sites.append(sxk)
            metal = col("platinum") if r.get("site", "Pt") in ("Pt", "Pd") else "#8B93A3"
            for d in (-0.5, -0.17, 0.17, 0.5):
                grains.add(Ellipse(width=0.22, height=0.13).move_to([sxk + d * 0.6, wall_y + 0.03, 0]).set_fill([light(metal, 0.5), metal], 1).set_stroke(dark(metal, 0.4), 1))
            grains.add(label_text(r.get("site", "Pt"), 16, dark(metal, 0.45)).move_to([sxk, wall_y - 0.06 - 0.12, 0]))
        ctx.add(role(rig, "surface"), VGroup(fr, wall, wash, grains), show=rig.get("inset_show", 0.0), how="fade", kind="body", part=role(rig, "surface"), z=2)
        ctx.anchors[role(rig, "surface")] = [ibx.x0 + 0.3, wall_y - 0.06, 0]
        ctx.anchors[role(rig, "catalyst")] = [sites[0] + 0.3 if sites else ibx.cx, wall_y + 0.05, 0]
        ctx.bodies[role(rig, "catalyst")] = grains
        if rig.get("inset_link", True):
            link = DashedLine([zx[0] + 0.3, yc - hs / 2 + 0.1, 0], [ibx.cx, ibx.y1, 0]).set_stroke(MUTED, 1.5)
            ctx.add("inset_link", link, show=rig.get("inset_show", 0.0), how="fade", kind="overlay", z=1)
        msc = min(0.42, ibx.h * 0.11)
        ctx.zones.append([ibx.x0, wall_y + 0.05, ibx.x1, ibx.y1])
        for k, r in enumerate(rx):
            L_, _, R_ = r["eq"].replace("→", "->").partition("->")
            reac, prod = _terms(L_), _terms(R_)
            sxk = sites[k]
            span = ibx.w / max(1, len(rx)) * 0.8
            pid = r["proc"]

            def rxn(reac=reac, prod=prod, sxk=sxk, span=span, pid=pid, k=k):
                p = ctx.st().get(pid, 0.0)
                g = VGroup()
                if p <= 0.001:
                    return g
                mols_r = [s for c, s in reac for _ in range(min(c, 5))]
                mols_p = [s for c, s in prod for _ in range(min(c, 5))]
                nr, np_ = len(mols_r), len(mols_p)
                # reactants: fall from the gas onto the grains (adsorb), sit, react
                if p < 0.6:
                    f = smooth01(p / 0.35)
                    for i, s in enumerate(mols_r):
                        x0_ = sxk + (i - (nr - 1) / 2) * span / max(nr, 1) * 1.4
                        xs = sxk + (i - (nr - 1) / 2) * min(span / max(nr, 1), msc * 2.4)
                        y = (ibx.y1 - 0.35) + (wall_y + msc * 0.9 - (ibx.y1 - 0.35)) * f
                        x = x0_ + (xs - x0_) * f
                        squeeze = smooth01((p - 0.42) / 0.18)
                        x = x + (sxk - x) * squeeze * 0.6
                        g.add(_mol_at(s, x, y, msc, angle=(1 - f) * (1.2 + i)))
                    if p > 0.45:  # bond rearrangement on the metal
                        gl = math.sin(PI * min(1.0, (p - 0.45) / 0.3))
                        g.add(Circle(radius=msc * 2).move_to([sxk, wall_y + msc, 0]).set_stroke("#E8A33A", 5 * gl + 0.01, opacity=gl))
                else:
                    f = smooth01((p - 0.6) / 0.4)
                    for i, s in enumerate(mols_p):
                        xs = sxk + (i - (np_ - 1) / 2) * min(span / max(np_, 1), msc * 2.6)
                        y = wall_y + msc * 0.9 + f * (ibx.y1 - 0.4 - wall_y - msc * 0.9) * (0.7 + 0.3 * ((i % 2)))
                        x = xs + f * (i - (np_ - 1) / 2) * 0.25
                        g.add(_mol_at(s, x, y, msc, angle=f * (1 + i)))
                return g
            ctx.add(f"rxn{k}", live(rxn), show=rig.get("inset_show", 0.0), how="fade", kind="body", part=f"rxn{k}", z=5, moving=True)


RIGS["flow_reactor"] = flow_reactor


# ════════════════ General annotations: attach to any named live point / vector of the solved geometry ════════════════
def _gp(ctx, name):
    v = ctx.geom.get(name)
    if v is None:
        v = ctx.anchors.get(name)
    if v is None:
        raise KeyError(name)
    p = v() if callable(v) else v
    return np.array([float(p[0]), float(p[1]), 0.0])


def _val_tex(ctx, a):
    """'\\theta' or '\\theta = 45^\\circ' / 'R = 20.4\\,\\mathrm{m}' with the live value of the bound quantity"""
    tex = a.get("tex", "")
    q = a.get("q")
    if not q or not a.get("value", True):
        return tex
    v = ctx.st().get(q, 0.0)
    d = int(a.get("decimals", 0 if abs(v) >= 10 else 1))
    num = f"{v:.{d}f}"
    unit = a.get("unit", "")
    u = "^{\\circ}" if unit in ("deg", "°") else (f"\\,\\mathrm{{{unit}}}" if unit else "")
    return (tex + " = " if tex else "") + num + u


def _tex_mob(ctx, a, size=34):
    c = ctx.color_of(a.get("q"), INK) if a.get("q") else col(a.get("color"), INK)
    return MathTex(_val_tex(ctx, a), font_size=a.get("size", size), color=c), c


def _angle(ctx, a):
    def f():
        V, A, Bp = _gp(ctx, a["at"]), _gp(ctx, a["from"]), _gp(ctx, a["to"])
        a1 = math.atan2(A[1] - V[1], A[0] - V[0])
        a2 = math.atan2(Bp[1] - V[1], Bp[0] - V[0])
        d = (a2 - a1 + PI) % TAU - PI
        r = float(a.get("r", 0.7))
        m, c = _tex_mob(ctx, a, 32)
        g = VGroup()
        if abs(abs(d) - PI / 2) < 0.01 and a.get("right_mark", True):
            u1 = np.array([math.cos(a1), math.sin(a1), 0]) * 0.28
            u2 = np.array([math.cos(a2), math.sin(a2), 0]) * 0.28
            g.add(VMobject().set_points_as_corners([V + u1, V + u1 + u2, V + u2]).set_stroke(c, 3))
        elif abs(d) > 1e-3:
            g.add(Arc(radius=r, start_angle=a1, angle=d, arc_center=V).set_stroke(c, 3.5))
        mid = a1 + d / 2
        m.move_to(V + (r + 0.18 + m.width * 0.45) * np.array([math.cos(mid), math.sin(mid), 0]))
        keep_in_frame(m)
        g.add(m)
        return g
    ctx.add("annot:" + a["id"], live(f), show=a.get("show", 0.0), kind="annot", how="create", part="annot:" + a["id"], z=12, hide=a.get("hide"), moving=True)


def _brace(ctx, a):
    def f():
        P, Qp = _gp(ctx, a["a"]), _gp(ctx, a["b"])
        if np.linalg.norm(Qp - P) < 0.05:
            return VGroup(Dot(P, radius=0.001).set_opacity(0))
        side = a.get("side", "down")
        d = {"down": DOWN, "up": UP, "left": LEFT, "right": RIGHT}.get(side, DOWN)
        m, c = _tex_mob(ctx, a, 32)
        if a.get("style") == "dim":  # dimension line with end ticks (good for heights over empty space)
            n = np.array([-(Qp - P)[1], (Qp - P)[0], 0]) / (np.linalg.norm(Qp - P) + 1e-9) * 0.1
            br = VGroup(DashedLine(P, Qp).set_stroke(c, 2.5), Line(P - n, P + n).set_stroke(c, 2.5), Line(Qp - n, Qp + n).set_stroke(c, 2.5))
            m.next_to(Line(P, Qp), d, buff=0.12)
            return VGroup(br, m)
        br = Brace(Line(P, Qp), direction=d, color=c, buff=0.08)
        m.next_to(br, d, buff=0.08)
        return VGroup(br, m)
    ctx.add("annot:" + a["id"], live(f), show=a.get("show", 0.0), kind="annot", how="create", part="annot:" + a["id"], z=12, hide=a.get("hide"), moving=True)


def _vector(ctx, a):
    def f():
        P = _gp(ctx, a["from"])
        Qp = _gp(ctx, a["to"]) if a.get("to") else P + np.array(a.get("d", [1, 0]) + [0])[:3]
        m, c = _tex_mob(ctx, a, 32)
        if np.linalg.norm(Qp - P) < 0.08:
            return VGroup(m.move_to(P + UP * 0.3).set_opacity(0))
        ar = arrow(P, Qp, c, sw=float(a.get("sw", 6)), tip=0.22)
        if a.get("dashed"):
            from manim import DashedVMobject
            ar = VGroup(DashedLine(P, Qp - (Qp - P) / np.linalg.norm(Qp - P) * 0.2).set_stroke(c, 3), ar.get_tip() if hasattr(ar, "get_tip") else VGroup())
        d = (Qp - P) / np.linalg.norm(Qp - P)
        pref = 1 if a.get("label_side", "left") == "left" else -1
        best = None
        for sgn in (pref, -pref):
            for along in (0.3, 0.0, -0.4):
                n = np.array([-d[1], d[0], 0]) * sgn
                c = Qp + d * (0.15 + m.width * along) + n * (0.15 + m.height * 0.5 + m.width * 0.2 * abs(n[1]) * 0)
                bb = [c[0] - m.width / 2, c[1] - m.height / 2, c[0] + m.width / 2, c[1] + m.height / 2]
                sc_ = sum(_ovl(bb, o) for o in ctx.static_obstacles) + (0.0 if sgn == pref else 0.02) + abs(along - 0.3) * 0.01
                if best is None or sc_ < best[0]:
                    best = (sc_, c)
        m.move_to(best[1])
        keep_in_frame(m)
        return VGroup(ar, m)
    ctx.add("annot:" + a["id"], live(f), show=a.get("show", 0.0), kind="annot", how="create", part="annot:" + a["id"], z=13, hide=a.get("hide"), moving=True)


def _ovl(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    return max(0.0, w) * max(0.0, h)


def _point(ctx, a):
    def f():
        P = _gp(ctx, a["at"])
        m, c = _tex_mob(ctx, a, 30)
        d = {"down": DOWN, "up": UP, "left": LEFT, "right": RIGHT, "ur": UP + RIGHT, "ul": UP + LEFT, "dr": DOWN + RIGHT, "dl": DOWN + LEFT}.get(a.get("side", "ur"), UP + RIGHT)
        m.next_to(P, d, buff=0.12)
        return VGroup(Dot(P, radius=0.07, color=c), m)
    ctx.add("annot:" + a["id"], live(f), show=a.get("show", 0.0), kind="annot", how="create", part="annot:" + a["id"], z=13, hide=a.get("hide"), moving=True)


def _phase(ctx, a):
    """a state / phase banner ('depolarisation', 'step 3: relax edges'): written at the top centre while it holds"""
    m = label_text(a.get("text", ""), size=a.get("size", 28), color=col(a.get("color"), INK) if a.get("color") else INK)
    b = Box(*a["box"]) if a.get("box") else Box(-3, 3.35, 3, 3.85)
    m.move_to(b.c)
    ctx.add("annot:" + a["id"], m, show=a.get("show", 0.0), kind="annot", how="write", part="annot:" + a["id"], z=14, hide=a.get("hide"))


def _feature(ctx, a):
    """a feature of a trace graph: the peak / minimum of y, labelled with its value (from the same samples)"""
    gr = ctx.graphs.get(a["graph"])
    if not gr:
        ctx.issues.append(f"annotation {a['id']}: graph {a['graph']} not found")
        return
    ax, xs, ys, ts, g = gr
    k = int(np.argmax(ys)) if a.get("feature", "peak") == "peak" else int(np.argmin(ys))
    P = ax.c2p(xs[k], min(g["y_range"][1], max(g["y_range"][0], ys[k])))
    c = ctx.color_of(g["y"], INK)
    unit = a.get("unit", "")
    m = MathTex((a.get("tex", "") + " " if a.get("tex") else "") + f"{ys[k]:+.0f}" + (f"\\,\\mathrm{{{unit}}}" if unit else ""), font_size=26, color=c)
    m.next_to(P, UP + RIGHT if a.get("feature", "peak") == "peak" else DOWN + RIGHT, buff=0.08)
    ctx.add("annot:" + a["id"], VGroup(Circle(radius=0.1).move_to(P).set_stroke(c, 2.5), m), show=max(a.get("show", 0.0), float(ts[k]) + 0.2),
            kind="annot", how="create", part="annot:" + a["id"], z=13, hide=a.get("hide"))


ANNOT = {"angle": _angle, "brace": _brace, "dim": _brace, "vector": _vector, "force": _vector, "point": _point, "phase": _phase, "feature": _feature}


def annotations(ctx):
    for a in ctx.S.get("annotations", []):
        fn = ANNOT.get(a.get("kind"))
        if not fn:
            ctx.issues.append(f"annotation kind {a.get('kind')} unknown")
            continue
        if a.get("kind") == "dim":
            a = dict(a, style="dim")
        try:
            fn(ctx, a)
        except KeyError as exc:
            ctx.issues.append(f"annotation {a.get('id')}: unknown point {exc}")


# ════════════════ Projectile: launch at an angle, solved kinematics, every vector / angle / dimension labelled ════════════════
def projectile(ctx, rig):
    bx = B(rig)
    st0 = ctx.W(0.0)
    v0 = float(st0.get(rig.get("v0", "v0"), rig.get("v0_val", 20.0)))
    th = math.radians(float(st0.get(rig.get("theta", "theta"), rig.get("theta_val", 45.0))))
    g = float(st0.get(rig.get("g", "g"), 9.81))
    T = 2 * v0 * math.sin(th) / g
    R = v0 * v0 * math.sin(2 * th) / g
    H = (v0 * math.sin(th)) ** 2 / (2 * g)
    # one scale for x and y (true shape of the parabola)
    vs0 = float(rig.get("vec_scale", 2.4 / v0))
    k = min((bx.w - 2.4 - (vs0 * v0 * math.cos(th) + 0.9)) / R, (bx.h - 1.6) / max(H, 1e-6))
    O = np.array([bx.x0 + 1.5, bx.y0 + 0.75, 0])
    fly = rig.get("fly", "fly")

    def tt():
        return min(1.0, max(0.0, ctx.st().get(fly, 0.0))) * T

    def pos(t):
        return O + k * np.array([v0 * math.cos(th) * t, v0 * math.sin(th) * t - g * t * t / 2, 0])
    vs = float(rig.get("vec_scale", 2.4 / v0))  # arrow length per m/s (same for every velocity arrow)
    # every velocity arrow (launch, and along the flight) must stay inside the frame with room for its label
    for tq in np.linspace(0, T, 41):
        p_ = O + k * np.array([v0 * math.cos(th) * tq, v0 * math.sin(th) * tq - g * tq * tq / 2, 0])
        v_ = np.array([v0 * math.cos(th), v0 * math.sin(th) - g * tq, 0])
        for lim_ in range(30):
            tip = p_ + vs * v_
            if -FW / 2 + 0.7 < tip[0] < FW / 2 - 0.7 and -FH / 2 + 0.5 < tip[1] < FH / 2 - 0.5:
                break
            vs *= 0.92
    ctx.geom.update({
        "O": O, "ground": O + RIGHT * 1.5, "ball": lambda: pos(tt()),
        "v0_tip": O + vs * v0 * np.array([math.cos(th), math.sin(th), 0]),
        "v0x_tip": O + vs * v0 * np.array([math.cos(th), 0, 0]), "v0y_tip": O + vs * v0 * np.array([0, math.sin(th), 0]),
        "v_tip": lambda: pos(tt()) + vs * np.array([v0 * math.cos(th), v0 * math.sin(th) - g * tt(), 0]),
        "vx_tip": lambda: pos(tt()) + vs * np.array([v0 * math.cos(th), 0, 0]),
        "vy_tip": lambda: pos(tt()) + vs * np.array([0, v0 * math.sin(th) - g * tt(), 0]),
        "g_tip": lambda: pos(tt()) + DOWN * 0.9, "apex": pos(T / 2), "apex_ground": np.array([pos(T / 2)[0], O[1], 0]), "land": pos(T),
    })
    ctx.checks.append({"type": "kinematics", "R_m": round(R, 3), "H_m": round(H, 3), "T_s": round(T, 3), "drawn_R_over_H": round((pos(T)[0] - O[0]) / (pos(T / 2)[1] - O[1]), 4),
                       "declared_R_over_H": round(R / H, 4)})
    ground = VGroup(Line(O + LEFT * 0.7, [bx.x1 - 0.1, O[1], 0]).set_stroke(MUTED if THEME_MODE() == "real" else OUTLINE_C(), 3))
    for x in np.arange(O[0] - 0.6, bx.x1 - 0.2, 0.3):
        ground.add(Line([x, O[1], 0], [x - 0.15, O[1] - 0.15, 0]).set_stroke(MUTED, 1.5))
    ctx.add(role(rig, "ground"), ground, show=sh(ctx, rig, "ground"), how="create", kind="body", z=1)
    # launcher: a barrel along the launch direction on a wheel
    u = np.array([math.cos(th), math.sin(th), 0])
    n = np.array([-u[1], u[0], 0])
    bl = 0.75
    barrel = Polygon(O - n * 0.12, O - n * 0.09 + u * bl, O + n * 0.09 + u * bl, O + n * 0.12).set_fill([light(col("iron"), 0.3), col("iron")], 1).set_stroke(OUTLINE_C(), 2)
    wheel = Circle(radius=0.2).move_to(O + DOWN * 0.0).set_fill(col("wood"), 1).set_stroke(OUTLINE_C(), 2)
    ctx.add(role(rig, "launcher"), VGroup(barrel, wheel), show=sh(ctx, rig, "launcher"), how="create", z=3)
    ctx.anchors[role(rig, "launcher")] = O + DOWN * 0.2 + LEFT * 0.1
    path_c = col(rig.get("path_color"), MUTED) if rig.get("path_color") else MUTED
    full = VMobject().set_points_smoothly([pos(t) for t in np.linspace(0, T, 60)])
    from manim import DashedVMobject
    ctx.add(role(rig, "path") + ":ghost", DashedVMobject(full.set_stroke(path_c, 2), num_dashes=50), show=rig.get("ghost_show", 1e9), how="create", kind="overlay", z=2)

    def trail():
        t = tt()
        if t < 1e-3:
            return VMobject().set_points_as_corners([O, O + RIGHT * 1e-3]).set_stroke(opacity=0)
        return VMobject().set_points_smoothly([pos(x) for x in np.linspace(0, t, max(3, int(40 * t / T) + 3))]).set_stroke(Q["amber"], 4)
    ctx.add(role(rig, "path"), live(trail), show=sh(ctx, rig, "ball"), how="fade", kind="body", z=4, moving=True)
    ctx.anchors[role(rig, "path")] = lambda: pos(T * 0.75)
    ball = live(lambda: Circle(radius=0.14).move_to(pos(tt())).set_fill([light(col("iron"), 0.4), col("iron")], 1).set_stroke(OUTLINE_C(), 2))
    ctx.add(role(rig, "ball"), ball, show=sh(ctx, rig, "ball"), how="create", z=8, moving=True)
    ctx.anchors[role(rig, "ball")] = lambda: pos(tt())


def THEME_MODE():
    import gm_parts
    return gm_parts.THEME.get("mode")


def OUTLINE_C():
    import gm_parts
    return gm_parts.OUTLINE


RIGS["projectile"] = projectile


# ════════════════ Board: abstract parts placed on the 6x6 anchor grid (graphs/networks, charts, arrays, timelines,
#                  Venn sets, number lines, freeform shapes). Algorithms and equilibria are computed, never drawn by hand. ════════════════
def _dijkstra(nodes, edges, src):
    """Steps of Dijkstra: each step = (current node, relaxations [(u, v, new_dist, improved)], dist snapshot, done set, prev)."""
    import heapq
    adj = {n: [] for n in nodes}
    for a, b, w in edges:
        adj[a].append((b, w))
        adj[b].append((a, w))
    dist = {n: math.inf for n in nodes}
    prev = {n: None for n in nodes}
    dist[src] = 0
    done = set()
    pq = [(0, src)]
    steps = []
    while pq:
        d, u = heapq.heappop(pq)
        if u in done:
            continue
        done.add(u)
        rel = []
        for v, w in sorted(adj[u]):
            if v in done:
                continue
            nd = d + w
            imp = nd < dist[v]
            if imp:
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
            rel.append((u, v, nd, imp))
        steps.append({"cur": u, "rel": rel, "dist": dict(dist), "done": set(done), "prev": dict(prev)})
    return steps


def _binary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    steps = []
    while lo <= hi:
        mid = (lo + hi) // 2
        steps.append({"lo": lo, "hi": hi, "mid": mid, "found": arr[mid] == target})
        if arr[mid] == target:
            break
        if arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return steps


def _cell(ref, region):
    """grid position inside a region: [fx, fy] fractions or a cell name like 'B3' (of the full 6x6 grid)"""
    if isinstance(ref, str):
        b = grid_box(ref)
        return b.c
    return region.p(float(ref[0]), float(ref[1]))


def _network(ctx, it, box):
    nodes = [n["id"] for n in it["nodes"]]
    pos = {n["id"]: _cell(n.get("at", [0.5, 0.5]), box) for n in it["nodes"]}
    edges = [(e[0], e[1], float(e[2]) if len(e) > 2 else 1.0) for e in it.get("edges", [])]
    algo = it.get("algorithm")
    proc = it.get("proc")
    steps = _dijkstra(nodes, edges, it.get("source", nodes[0])) if algo == "dijkstra" else []
    if steps:
        ctx.checks.append({"type": "algorithm", "what": "dijkstra", "final_dist": {k: (None if v == math.inf else v) for k, v in steps[-1]["dist"].items()}, "steps": len(steps)})
    R = float(it.get("node_r", 0.36))
    c_done, c_cur, c_edge = Q["green"], Q["amber"], Q["clay"]
    ctx.geom.update({"node:" + k: v for k, v in pos.items()})

    def draw():
        st = ctx.st()
        s = st.get(proc, 0.0) if proc else 0.0  # 0..len(steps): whole steps done, fraction = within step
        k = int(min(len(steps), max(0, math.floor(s)))) if steps else 0
        frac = s - k
        cur = steps[k] if steps and k < len(steps) else None
        snap = steps[k - 1] if steps and k > 0 else None
        done = set(snap["done"]) if snap else set()
        dist = dict(snap["dist"]) if snap else {n: (0 if n == it.get("source", nodes[0]) else math.inf) for n in nodes}
        prev = dict(snap["prev"]) if snap else {}
        if cur and frac > 0:
            # within a step: the relaxations of the current node land one after another
            nrel = len(cur["rel"])
            for j, (u, v, nd, imp) in enumerate(cur["rel"]):
                if frac > (j + 1) / (nrel + 1) and imp:
                    dist[v] = nd
                    prev[v] = u
        g = VGroup()
        tree = {(prev[v], v) for v in prev if prev.get(v)} | {(v, prev[v]) for v in prev if prev.get(v)}
        for a, b, w in edges:
            on_tree = (a, b) in tree and (s >= len(steps) - 1e-6 if steps else False)
            active = cur and frac > 0 and cur["cur"] in (a, b) and (b if cur["cur"] == a else a) not in done
            c = c_done if on_tree else (c_edge if active else MUTED)
            g.add(Line(pos[a], pos[b], buff=R).set_stroke(c, 7 if on_tree else (5 if active else 3)))
            mid = (pos[a] + pos[b]) / 2
            d = pos[b] - pos[a]
            n = np.array([-d[1], d[0], 0]) / (np.linalg.norm(d) + 1e-9)
            g.add(MathTex(f"{w:g}", font_size=38, color=c if (on_tree or active) else INK).move_to(mid + n * 0.28))
        for nid in nodes:
            p = pos[nid]
            isc = cur is not None and frac > 0 and cur["cur"] == nid
            fill = c_cur if isc else (c_done if nid in done else THEME_PANEL())
            g.add(Circle(radius=R).move_to(p).set_fill(fill, 1).set_stroke(INK, 3))
            g.add(label_text(nid, 30, "#FFFFFF" if (isc or nid in done) else INK).move_to(p))
            dv = dist.get(nid, math.inf)
            up = 1 if p[1] >= box.cy else -1
            g.add(MathTex("\\infty" if dv == math.inf else f"{dv:g}", font_size=40, color=c_edge if dv != math.inf else MUTED).move_to(p + up * UP * (R + 0.32)))
        return g
    m = live(draw)
    ctx.add(it["id"], m, show=it.get("show", 0.0), how="create", kind="body", z=3, moving=True)
    ctx.anchors[it["id"]] = box.p(0.05, 0.95)


def _chart(ctx, it, box):
    """y = f(x) curves (sympy, may contain process ids so they shift), intersections solved numerically each frame,
    axes always labelled with name and unit, dashed guides to the equilibrium values on both axes."""
    import sympy as sp
    xr, yr = it["x_range"], it["y_range"]
    ax = Axes(x_range=[xr[0], xr[1], it.get("x_step", (xr[1] - xr[0]) / 5)], y_range=[yr[0], yr[1], it.get("y_step", (yr[1] - yr[0]) / 5)],
              x_length=box.w - 1.6, y_length=box.h - 1.2, tips=True, axis_config={"color": MUTED, "stroke_width": 2.5, "include_numbers": True, "font_size": 22,
                                                                                 "tip_length": 0.15, "decimal_number_config": {"num_decimal_places": 0}})
    ax.move_to(box.c + np.array([0.2, 0.3, 0]))
    for a_ in (ax.x_axis, ax.y_axis):
        if getattr(a_, "numbers", None) is not None:
            a_.numbers.set_color(MUTED)
    xl = label_text(it.get("x_label", "quantity"), 24, MUTED).next_to(ax.x_axis, DOWN, buff=0.5)
    yl = label_text(it.get("y_label", "price"), 24, MUTED).next_to(ax.y_axis.get_top(), UP, buff=0.12).align_to(ax.y_axis, LEFT).shift(LEFT * 0.3)
    ctx.add(it["id"] + ":axes", VGroup(ax, xl, yl), show=it.get("show", 0.0), how="create", kind="panel", z=4)
    ctx.axis_label_boxes = getattr(ctx, "axis_label_boxes", []) + [(it["id"], xl, yl)]
    X = sp.Symbol("x")
    procs = sorted(ctx.W.procs)
    fns = []
    for k, c in enumerate(it.get("curves", [])):
        syms = [X] + [sp.Symbol(p) for p in procs]
        f = sp.lambdify(syms, chart_expr(c["expr"], procs), "math")
        cc = ctx.color_of(c.get("q"), col(c.get("color"), INK)) if c.get("q") else col(c.get("color"), [Q["navy"], Q["clay"], Q["green"]][k % 3])
        fns.append((c, f, cc))

        def curve(f=f, cc=cc, c=c):
            st = ctx.st()
            args = [st.get(p, 0.0) for p in procs]
            pts = []
            for x in np.linspace(xr[0], xr[1], 120):
                y = f(x, *args)
                if yr[0] - 1e-9 <= y <= yr[1] + 1e-9:
                    pts.append(ax.c2p(x, y))
            m = VMobject()
            if len(pts) >= 2:
                m.set_points_smoothly(pts)
            else:
                m.set_points_as_corners([ax.c2p(xr[0], yr[0])] * 2)
            m.set_stroke(cc, 5)
            lab = label_text(c.get("label", ""), 24, cc)
            if len(pts) >= 2:
                lab.next_to(pts[-1], RIGHT if c.get("label_end", "right") == "right" else UP, buff=0.1)
            return VGroup(m, lab)
        ctx.add(it["id"] + ":" + c.get("id", str(k)), live(curve), show=c.get("show", it.get("show", 0.0)), how="create", kind="annot", z=6, moving=True)
        if c.get("ghost_at") is not None:  # the original position stays as a faint dashed copy after a shift
            st0 = {p: (c["ghost_at"] if p == c.get("shift_proc") else 0.0) for p in procs}
            gp = [ax.c2p(x, f(x, *[st0[p] for p in procs])) for x in np.linspace(xr[0], xr[1], 80) if yr[0] <= f(x, *[st0[p] for p in procs]) <= yr[1]]
            from manim import DashedVMobject
            if len(gp) > 2:
                ctx.add(it["id"] + ":ghost" + str(k), DashedVMobject(VMobject().set_points_smoothly(gp).set_stroke(cc, 2.5, opacity=0.6), num_dashes=30),
                        show=c.get("ghost_show", 1e9), how="create", kind="overlay", z=5)
    eq = it.get("equilibrium")
    if eq and len(fns) >= 2:
        from scipy.optimize import brentq
        f1, f2 = fns[eq[0]][1], fns[eq[1]][1]
        qx, qy = it.get("eq_q", [None, None])

        def solve(st):
            args = [st.get(p, 0.0) for p in procs]
            h = lambda x: f1(x, *args) - f2(x, *args)  # noqa: E731
            xs = np.linspace(xr[0], xr[1], 200)
            for a_, b_ in zip(xs, xs[1:]):
                if h(a_) == 0 or h(a_) * h(b_) < 0:
                    x = brentq(h, a_, b_)
                    return x, f1(x, *args)
            return None
        tq = {"x": qx, "y": qy}

        def eqm():
            r = solve(ctx.st())
            g = VGroup()
            if not r:
                return g
            x, y = r
            P = ax.c2p(x, y)
            g.add(DashedLine(ax.c2p(x, yr[0]), P).set_stroke(INK, 2), DashedLine(ax.c2p(xr[0], y), P).set_stroke(INK, 2))
            g.add(Dot(P, radius=0.09, color=INK))
            g.add(MathTex(it.get("eq_x_tex", "Q^*") + f"={x:.1f}", font_size=26, color=INK).next_to(ax.c2p(x, yr[0]), UP + RIGHT, buff=0.12).shift(RIGHT * 0.05))
            g.add(MathTex(it.get("eq_y_tex", "P^*") + f"={y:.1f}", font_size=26, color=INK).next_to(ax.c2p(xr[0], y), UP + RIGHT, buff=0.12).shift(RIGHT * 0.12))
            return g
        ctx.add(it["id"] + ":eq", live(eqm), show=it.get("eq_show", it.get("show", 0.0)), how="create", kind="annot", z=7, moving=True)
        r0 = solve(ctx.W(0.0))
        ctx.checks.append({"type": "equilibrium", "initial": [round(v, 3) for v in r0] if r0 else None, "final": [round(v, 3) for v in (solve(ctx.W(ctx.W.duration)) or [])]})
        if qx:
            ctx.W.quant.append((qx, [], lambda: 0.0))  # placeholder ids so readouts can bind (values come from solve)


def chart_expr(expr, procs):
    """'y = 10 - 0.5Q', 'P = 2 + q' -> sympy in x: the right-hand side, its one free variable renamed to x"""
    import sympy as sp
    from sympy.parsing.sympy_parser import implicit_multiplication_application, parse_expr, standard_transformations
    e = str(expr).replace("^", "**")
    if "=" in e:
        e = e.split("=")[-1]
    loc = {p: sp.Symbol(p) for p in procs}
    ex = parse_expr(e, local_dict=loc, transformations=standard_transformations + (implicit_multiplication_application,))
    free = [s_ for s_ in ex.free_symbols if str(s_) not in procs and str(s_) != "x"]
    if len(free) == 1:
        ex = ex.subs(free[0], sp.Symbol("x"))
    return ex


def _array(ctx, it, box):
    vals = it["values"]
    n = len(vals)
    w = min(1.0, (box.w - 0.4) / n)
    y = box.cy
    x0 = box.cx - w * n / 2
    steps = _binary_search(vals, it.get("target")) if it.get("algorithm") == "binary_search" else []
    proc = it.get("proc")

    def draw():
        s = ctx.st().get(proc, 0.0) if proc else 0.0
        k = min(len(steps) - 1, int(s)) if steps else -1
        cur = steps[k] if k >= 0 and s > 0 else None
        g = VGroup()
        for i, v in enumerate(vals):
            out = cur is not None and not (cur["lo"] <= i <= cur["hi"])
            fill = Q["amber"] if cur is not None and i == cur["mid"] else (THEME_PANEL() if not out else RULE)
            if cur is not None and cur["found"] and i == cur["mid"] and s - k > 0.5:
                fill = Q["green"]
            g.add(Square(side_length=w * 0.94).move_to([x0 + (i + 0.5) * w, y, 0]).set_fill(fill, 1).set_stroke(INK, 2.5))
            g.add(MathTex(str(v), font_size=34, color=MUTED if out else INK).move_to([x0 + (i + 0.5) * w, y, 0]))
            g.add(MathTex(str(i), font_size=20, color=MUTED).move_to([x0 + (i + 0.5) * w, y - w * 0.7, 0]))
        if cur is not None:
            for name, idx, dy in (("lo", cur["lo"], -1.25), ("hi", cur["hi"], -1.25), ("mid", cur["mid"], 0.85)):
                px = x0 + (idx + 0.5) * w
                if name == "hi" and cur["hi"] == cur["lo"]:
                    px += 0.25
                g.add(label_text(name, 22, Q["amber"] if name == "mid" else Q["navy"]).move_to([px, y + dy * w, 0]))
        return g
    ctx.add(it["id"], live(draw), show=it.get("show", 0.0), how="create", kind="body", z=3, moving=True)
    ctx.anchors[it["id"]] = [x0, y + w, 0]


def _timeline(ctx, it, box):
    ev = it["events"]  # [{"t": 1492, "label": "...", "show": s}]
    t0, t1 = min(e["t"] for e in ev), max(e["t"] for e in ev)
    pad = (t1 - t0) * 0.08 or 1
    y = box.cy
    line = Line(box.p(0.03, 0.5), box.p(0.97, 0.5)).set_stroke(INK, 3)
    ctx.add(it["id"], line, show=it.get("show", 0.0), how="create", kind="body", z=2)

    def X(t):
        return box.x0 + 0.03 * box.w + (t - t0 + pad) / (t1 - t0 + 2 * pad) * 0.94 * box.w
    for k, e in enumerate(ev):  # every row gets its label (category labels are mandatory)
        up = k % 2 == 0
        p = np.array([X(e["t"]), y, 0])
        lab = label_text(e.get("label", str(e["t"])), 22, INK)
        yr_ = MathTex(str(e["t"]), font_size=24, color=Q["navy"])
        stem = Line(p, p + (UP if up else DOWN) * 0.6).set_stroke(MUTED, 2)
        yr_.next_to(stem, UP if up else DOWN, buff=0.06)
        lab.next_to(yr_, UP if up else DOWN, buff=0.06)
        ctx.add(f"{it['id']}:ev{k}", VGroup(Dot(p, radius=0.08, color=Q["navy"]), stem, yr_, lab), show=e.get("show", it.get("show", 0.0)), how="create", kind="annot", z=4)


def _venn(ctx, it, box):
    sets = it["sets"]
    r = min(box.w, box.h) * 0.3
    cols_ = [Q["navy"], Q["clay"], Q["green"]]
    cs = [box.c + r * 0.6 * np.array([math.cos(PI / 2 + k * TAU / len(sets) + (PI / 2 if len(sets) == 2 else 0)), math.sin(PI / 2 + k * TAU / len(sets) + (PI / 2 if len(sets) == 2 else 0)), 0])
          for k in range(len(sets))]
    for k, s_ in enumerate(sets):
        c = Circle(radius=r).move_to(cs[k]).set_fill(cols_[k % 3], 0.18).set_stroke(cols_[k % 3], 4)
        lab = label_text(s_["label"], 26, cols_[k % 3]).move_to(cs[k] + (cs[k] - box.c) / (np.linalg.norm(cs[k] - box.c) + 1e-9) * (r + 0.35))
        ctx.add(f"{it['id']}:{k}", VGroup(c, lab), show=s_.get("show", it.get("show", 0.0)), how="create", kind="body", z=2 + k)
    for k, m_ in enumerate(it.get("members", [])):
        p = box.c + np.array(m_.get("offset", [0, 0]) + [0])[:3]
        ctx.add(f"{it['id']}:m{k}", label_text(m_["label"], 22, INK).move_to(p), show=m_.get("show", it.get("show", 0.0)), how="write", kind="annot", z=8)


def _number_line(ctx, it, box):
    from manim import NumberLine
    xr = it["x_range"]
    nl = NumberLine(x_range=[xr[0], xr[1], it.get("step", 1)], length=box.w - 0.6, include_numbers=True, color=INK, font_size=26)
    nl.move_to(box.c)
    nl.numbers.set_color(MUTED)
    ctx.add(it["id"], nl, show=it.get("show", 0.0), how="create", kind="body", z=2)
    proc = it.get("proc")
    if proc:
        def mk():
            v = ctx.st().get(proc, 0.0)
            return VGroup(Dot(nl.n2p(v), radius=0.1, color=Q["clay"]), MathTex(f"{v:.2f}", font_size=28, color=Q["clay"]).next_to(nl.n2p(v), UP, buff=0.15))
        ctx.add(it["id"] + ":pt", live(mk), show=it.get("show", 0.0), how="create", kind="annot", z=5, moving=True)


def _freeform(ctx, it, box):
    """anything the vocabulary lacks: LLM landmarks (fractions of the region) smoothed into a bezier outline"""
    pts = [box.p(float(p[0]), float(p[1])) for p in it["points"]]
    m = VMobject()
    if it.get("closed", True):
        m.set_points_smoothly(pts + [pts[0]])
        c = col(it.get("color"), MAT["paper"])
        m.set_fill([light(c, 0.3), c], opacity=1).set_sheen_direction(UP + LEFT)
    else:
        m.set_points_smoothly(pts)
    m.set_stroke(OUTLINE_C() if it.get("closed", True) else INK, 3)
    ctx.add(it["id"], m, show=it.get("show", 0.0), how="create", kind="body", z=2)
    ctx.anchors[it["id"]] = pts[0]


def THEME_PANEL_OP():
    import gm_parts
    return gm_parts.THEME.get("panel_op", 0.6)


def THEME_PANEL():
    import gm_parts
    return gm_parts.THEME.get("panel")


BOARD = {"network": _network, "graph_network": _network, "chart": _chart, "array": _array, "timeline": _timeline, "venn": _venn,
         "number_line": _number_line, "freeform": _freeform}


def board(ctx, rig):
    for it in rig.get("items", []):
        fn = BOARD.get(it.get("type"))
        if not fn:
            ctx.issues.append(f"board item type {it.get('type')} unknown")
            continue
        fn(ctx, it, Box(*it["box"]) if it.get("box") else grid_box(it.get("region", "A1:F6")))


RIGS["board"] = board

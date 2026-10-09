"""Label layout rules of the scene engine (gm_stage), checked on solved scenes without rendering video: a Stage is built on a
bare Manim Scene, objects are drawn (built + marked shown) and labels placed exactly as the engine does during a clip.

    .../wt-manim-venv/bin/python -m pytest modal_app/tests/test_layout.py      (needs Manim + LaTeX)

The rules are geometric and size-relative (label heights, the frame, the output's pixels), never per-scene coordinates:
clearance from the label's own glyph, anchoring to the target every frame, ownership (nearer its target than any rival
line), legible text from the frame and resolution, axis numbers fading under marks and coming back, sky above ground.
"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import gm_world as GW  # noqa: E402

try:  # Manim writes its TeX/text caches under media_dir: keep them out of the repo
    import tempfile
    from manim import config as _cfg
    _cfg.media_dir = tempfile.mkdtemp(prefix="gm-layout-test-")
except Exception:  # noqa: BLE001
    pass


def ir(name):
    return json.load(open(os.path.join(HERE, "fixtures_layout", name + ".json")))


def stage(scene_ir, **vars_):
    from manim import Scene
    import gm_stage as S
    st = S.Stage(Scene(), scene_ir)
    if vars_:
        st.W.vars.overrides.update({k: st.W.vars.eval(v, st.vals) for k, v in vars_.items()})
        st.vals = st.W.vars.values()
        st.X, _ = st.W.solve(st.vals, warm=st.X, ks=st.W.transform[1])
    return st


def show(st, *ids):
    for oid in ids:
        o = st.W.objs[oid]
        if o["type"] in ("equation", "readout"):
            continue
        if o["type"] == "group":
            show(st, *o.get("members") or [])
            continue
        if st._build(oid) is not None:
            st.shown.append(oid)


def label(st, lid):
    m = st._build(lid)
    st.shown.append(lid)
    st._follow(lid)
    return m, st.W.objs[lid]


def h_of(m):
    return max(min(m.height, m.width), 0.18)


def own_margin(st, m, o):
    import gm_stage as S
    ctx = st._label_ctx(o)
    b = S._box(m)
    dt = S._box_dist(b, ctx["tgt"])
    do = S._box_dist(b, ctx["other"]) if len(ctx["other"]) else 9.0
    return (do - dt) / h_of(m), dt / h_of(m)


def test_label_keeps_clearance_from_its_glyph():
    """Ohm: the '12V' label of a battery clears the battery's plates (measured ink, stroke width included) by the band."""
    import gm_stage as S
    st = stage(ir("ohm"), V=12)
    show(st, "circ")
    lid = next(k for k in st.W.objs if k.endswith(".lbl") and st.W.objs[k].get("for", "").startswith("circ.left"))
    m, o = label(st, lid)
    bat = st._stroke_samples(st.mobs[o["for"]])
    gap = S._box_dist(S._box(m), bat)
    assert gap >= 0.9 * st.LW["clear"] * h_of(m), (gap, h_of(m))
    # the band is a weight in label heights: a wider learned clearance places it further out
    st2 = stage({**ir("ohm"), "layout_weights": {"clear": 0.9}}, V=12)
    show(st2, "circ")
    m2, o2 = label(st2, lid)
    gap2 = S._box_dist(S._box(m2), st2._stroke_samples(st2.mobs[o2["for"]]))
    assert gap2 > gap + 0.05, (gap, gap2)


def test_flow_label_anchored_owned_and_follows():
    """Water cycle: 'Precipitation' sits beside its own (curved) arrow, nearer it than any other, and moves with it."""
    st = stage(ir("water_cycle"))
    show(st, "sun", "sea", "f_evap", "cloud", "mountain", "f_precip")
    m, o = label(st, "f_precip.lbl")
    margin, att = own_margin(st, m, o)
    assert margin > 0 and att <= st.LW["reach"], (margin, att)
    show(st, "f_runoff")
    label(st, "f_runoff.lbl")
    before = m.get_center().copy()
    st.mobs["f_precip"].shift(np.array([0.4, -0.3, 0.0]))  # whatever moves the arrow, the label goes with it (its updater)
    m.update(0)
    assert np.allclose(m.get_center() - before, [0.4, -0.3, 0.0], atol=1e-6)


def test_sky_above_ground_unless_the_scene_says_otherwise():
    w = GW.World(ir("water_cycle"))
    assert w.build([-6.5, -3, 6.5, 3])["ok"]
    y = lambda k: w.pos(k, w.X, w.state_vals)[1]  # noqa: E731
    assert y("sun") > y("sea") and y("sun") > y("mountain") and y("cloud") > y("mountain")
    assert not any("could not be met" in x and "sun" in x for x in w.warnings)
    # an explicit relation between the two wins (a sunset below the horizon line is the author's call)
    sunset = ir("water_cycle")
    sunset["constraints"] = sunset["constraints"] + [["below", "sun", "sea", 0.2]]
    w2 = GW.World(sunset)
    assert not any(c[1:3] == ["sun", "sea"] for c in w2._auto_cons)


def test_resultant_label_is_owned_by_the_resultant():
    """Vectors: once the dashed parallelogram side is drawn, 'a + b' must read as the resultant's, not the dashed copy's."""
    st = stage(ir("vectors"), t=1)
    show(st, "grid", "vec_a", "vec_b", "vec_sum", "para_a")
    for lid in ("vec_a.lbl", "vec_b.lbl"):
        label(st, lid)
    m, o = label(st, "vec_sum.lbl")
    margin, att = own_margin(st, m, o)
    assert margin >= 0 and att <= st.LW["reach"], (margin, att)


def test_angle_label_stays_at_its_vertex():
    """Sine: at a full turn the '360°' label stays by its angle, not floating off past the circle."""
    import gm_stage as S
    st = stage(ir("sine"), t="2*pi")
    show(st, "O", "circ", "P", "P_ref", "ang", "ax", "sine_curve", "P_wave", "proj")
    m, o = label(st, "ang.lbl")
    _, att = own_margin(st, m, o)
    vertex = st.P("O")[:2]
    d = S._box_dist(S._box(m), np.array([vertex]))
    r_arc = float(st.W.objs["ang"].get("radius", 0.45))
    assert att <= st.LW["reach"] and d <= r_arc + st.LW["reach"] * h_of(m), (att, d, h_of(m))


def test_legible_text_scales_with_frame_and_resolution():
    import gm_stage as S
    land = S.legible_fs("text", frame_w=128 / 9, pixel_w=1920)
    port = S.legible_fs("text", frame_w=4.5, pixel_w=1080)
    low = S.legible_fs("text", frame_w=128 / 9, pixel_w=300)
    tex = S.legible_fs("tex", frame_w=128 / 9, pixel_w=1920)
    assert 28 <= land <= 33 and port < land / 2 and low > land and tex > land * 1.3
    # the Modal-free copy of the rule agrees with the measured one
    assert abs(GW.legible_font_size("16:9") - land) < 1.0 and abs(GW.legible_font_size("16:9", "tex") - tex) < 1.5
    # a learned floor raises every size with it; maths in a box is never under the TeX floor
    S.set_sizes(7.0)
    assert S.FS["min"] > land and S.FS["tex_min"] > tex and GW.BOX_TEX_FS >= S.FS["tex_min"]
    S.set_sizes()


def test_box_text_meets_the_phone_floor():
    """Balance boxes (linear equation): the maths inside is at least the phone-legible x-height."""
    import gm_stage as S
    st = stage(ir("linear_eq"))
    show(st, "bal")
    texts = []
    for oid in st.shown:
        stack = [st.mobs[oid]]
        while stack:
            x = stack.pop()
            if isinstance(x, (S.Text, S.MathTex)):
                texts.append(S.text_px(x))
            else:
                stack.extend(x.submobjects)
    assert texts and min(texts) >= st.LW["min_xh_px"] - 0.05, texts


def test_axis_numbers_fade_under_arrows_and_return():
    """Projectile: the vy arrow at landing covers the '40' tick, which fades; once the ball is back up it returns."""
    T = "2*v0*sin(theta)/g"
    st = stage(ir("projectile"), t=T)
    show(st, "ax", "ball", "vxv", "vyv")
    hit, _ = st._tick_cover()["ax"]
    assert ("x", 40.0) in hit, hit
    st.W.objs["ax"]["_ticks_gone"].add(("x", 40.0))
    for m in st.mobs["ax"].submobjects:
        if getattr(m, "_tick", None) == ("x", 40.0):
            m.set_opacity(0)
    st.W.vars.overrides["t"] = st.W.vars.eval("v0*sin(theta)/g", st.vals)
    st.vals = st.W.vars.values()
    st.X, _ = st.W.solve(st.vals, warm=st.X, ks=st.W.transform[1])
    for oid in ("ball", "vxv", "vyv"):
        st.mobs[oid].become(st._make(st.W.objs[oid]))
    _, free = st._tick_cover()["ax"]
    assert ("x", 40.0) in free


def test_weights_are_bounded_and_report_patterns():
    import gm_stage as S
    w = S.layout_weights({"clear": 99, "own": -5, "bogus": 3, "anchor": "x"})
    assert w["clear"] == S.LAYOUT_BOUNDS["clear"][1] and w["own"] == S.LAYOUT_BOUNDS["own"][0] and "bogus" not in w
    assert w["anchor"] == S.LAYOUT_DEFAULTS["anchor"]
    st = stage(ir("growth"), t=6)
    show(st, "ax", "lin", "expo", "pl", "pe")
    for lid in ("lin.lbl", "expo.lbl"):
        label(st, lid)
    st._audit()
    rep = st.layout_report()
    assert rep["labels"] == 2 and rep["min_text_px"] >= st.LW["min_xh_px"] - 0.25
    assert not {"label_touching", "label_far", "label_culled"} & set(rep["patterns"]), rep["patterns"]
    # a label forced onto its line is reported as touching
    m = st.mobs["lin.lbl"]
    m.move_to(st.mobs["lin"]._path_pts[len(st.mobs["lin"]._path_pts) // 2])
    st.audit["labels"] = {}
    st._audit()
    assert "label_touching" in st.layout_report()["patterns"]


def test_new_physics_scene_labels_are_clear_and_owned():
    """Held-out scene (not one of the eval topics): forces on a ramp. Every label clears ink and belongs to its arrow/angle."""
    st = stage(ir("incline"), th="40*deg")
    show(st, "ramp", "ang", "K", "wv", "nv", "fv")
    for lid in ("ang.lbl", "wv.lbl", "nv.lbl", "fv.lbl"):
        m, o = label(st, lid)
    st._audit()
    for lid, r in st.audit["labels"].items():
        assert r["gap"] >= 0.3 and r["far"] <= st.LW["reach"] and r["own_margin"] >= -0.05, (lid, r)
    # an angle's label sits inside its opening
    A, B, C = (st.P(x)[:2] for x in st.W.objs["ang"]["points"])
    p = st.mobs["ang.lbl"].get_center()[:2] - B
    cr = lambda a, b: a[0] * b[1] - a[1] * b[0]  # noqa: E731
    assert cr(A - B, p) * cr(A - B, C - B) >= 0 and cr(C - B, p) * cr(C - B, A - B) >= 0
    assert math.isfinite(st.layout_report()["worst"]["gap"])

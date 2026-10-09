"""Unit tests for the scene language solver/verifier (gm_world) and the gallery scenes. Run: python modal_app/tests/test_world.py
(no Manim needed). Golden-frame rendering of the gallery is in test_golden.py (needs Manim + LaTeX)."""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import gm_world as GW  # noqa: E402

STAGE = [-4.5, -2.7, 4.5, 2.7]


def solved(ir):
    w = GW.World(ir)
    r = w.build(STAGE)
    return w, r


def P(w, k):
    return w.pos(k)


def test_right_triangle_and_squares():
    ir = {"vars": {"a": 3, "b": 4},
          "objects": [{"type": "right_triangle", "id": "T", "legs": ["a", "b"]},
                      {"type": "square_on", "id": "Sa", "side": ["T.A", "T.B"], "away": "T.C"},
                      {"type": "square_on", "id": "Sb", "side": ["T.C", "T.A"], "away": "T.B"},
                      {"type": "square_on", "id": "Sc", "side": ["T.B", "T.C"], "away": "T.A"}],
          "checks": [["eq", "area(Sa)+area(Sb)", "area(Sc)"]], "beats": []}
    w, r = solved(ir)
    assert r["ok"], r
    A, B, C = P(w, "T.A"), P(w, "T.B"), P(w, "T.C")
    assert abs((B - A) @ (C - A)) < 1e-6
    assert abs(np.linalg.norm(B - C) - 5) < 1e-6
    assert abs(GW._shoelace([P(w, x) for x in ["T.B", "T.C", "Sc.2", "Sc.1"]])) - 25 < 1e-5
    # squares are outward: their far corners are on the other side of the side from the opposite vertex
    side = lambda p, q, r_: np.sign((q - p)[0] * (r_ - p)[1] - (q - p)[1] * (r_ - p)[0])  # noqa: E731
    assert side(B, C, P(w, "Sc.1")) != side(B, C, A)


def test_pythagoras_rearrangement_constraints():
    ir = json.load(open(os.path.join(HERE, "fixtures", "pythagoras.json")))
    w, r = solved(ir)
    assert r["ok"], r
    assert abs(w.measure_env(w.X, w.state_vals)["area"]("inner") - 25) < 1e-6


def test_snell_all_states():
    ir = {"vars": {"n1": 1.0, "n2": 1.5, "t1": "40*deg", "t2": "asin(n1*sin(t1)/n2)"},
          "objects": [{"type": "point", "id": "O", "at": [0, 0]}, {"type": "point", "id": "N", "at": [0, 2]}, {"type": "point", "id": "S"},
                      {"type": "point", "id": "T"}, {"type": "point", "id": "M", "at": [0, -2]}],
          "constraints": [["polar", "S", "O", 3, "pi/2+t1"], ["polar", "T", "O", 3, "-pi/2+t2"]],
          "checks": [["eq", "angle(N,O,S)", "t1"], ["eq", "angle(M,O,T)", "t2"], ["eq", "n1*sin(angle(N,O,S))", "n2*sin(angle(M,O,T))"]],
          "beats": [{"say": "x", "do": [["animate", "t1", "70*deg"]]}]}
    w, r = solved(ir)
    assert r["ok"], r
    assert len(w.solved) >= 4  # start + 3 samples of the animation, each verified


def test_wrong_claim_is_caught_with_hint():
    ir = {"vars": {"t1": "30*deg"}, "objects": [{"type": "point", "id": "O", "at": [0, 0]}, {"type": "point", "id": "N", "at": [0, 2]}, {"type": "point", "id": "S"}],
          "constraints": [["polar", "S", "O", 3, "-pi/2+t1"]], "checks": [["eq", "angle(N,O,S)", "t1"]], "beats": []}
    w, r = solved(ir)
    assert not r["ok"]
    assert any("180 degrees" in p for p in r["problems"]), r["problems"]


def test_tangent_to_function():
    ir = {"vars": {"x0": 1},
          "objects": [{"type": "axes", "id": "ax", "x": [-1, 3], "y": [-1, 5], "unit": [1, 0.8]}, {"type": "function", "id": "f", "on": "ax", "expr": "x**2"},
                      {"type": "point", "id": "T", "on": "ax", "at": ["x0", "x0**2"]}, {"type": "point", "id": "U"}],
          "constraints": [["tangent", "T-U", "f", "x0"], ["distance", "T", "U", 1.5], ["right_of", "U", "T", 0]],
          "checks": [["eq", "deriv(f, x0)", "2*x0"]], "beats": []}
    w, r = solved(ir)
    assert r["ok"], r
    T, U = P(w, "T"), P(w, "U")
    s = (U - T)[1] / (U - T)[0] / 0.8  # world slope back to axes units
    assert abs(s - 2) < 1e-4


def test_equation_chain_and_chem():
    ok = {"objects": [{"type": "equation", "id": "e", "lines": [{"sym": "3*(y-5)=12"}, {"sym": "y-5=4"}, {"sym": "y=9"}]},
                      {"type": "equation", "id": "c", "chem": "6CO2 + 6H2O -> C6H12O6 + 6O2"}], "beats": []}
    w, r = solved(ok)
    assert r["ok"], r
    assert "3" in w.objs["e"]["_lines"][0]["tex"]
    bad = {"objects": [{"type": "equation", "id": "e", "lines": [{"sym": "3*(y-5)=12"}, {"sym": "y-5=9"}]},
                       {"type": "equation", "id": "c", "chem": "CO2 + H2O -> C6H12O6 + O2"}], "beats": []}
    w, r = solved(bad)
    assert not r["ok"]
    assert any("does not follow" in p for p in r["problems"]) and any("not balanced" in p for p in r["problems"]), r["problems"]


def test_vars_lines_must_hold():
    ir = {"vars": {"V": 12, "R": 2, "I": "V/R"}, "objects": [{"type": "equation", "id": "e", "lines": [{"sym": "V = I*R"}, {"sym": "I = 6"}], "chain": "none"}], "beats": []}
    assert solved(ir)[1]["ok"]
    ir["vars"]["I"] = "V*R"
    assert not solved(ir)[1]["ok"]


def test_layout_relations_no_overlap():
    ir = {"objects": [{"type": "box", "id": k, "text": k} for k in ("sunlight", "water", "carbon dioxide", "leaf", "glucose", "oxygen")],
          "constraints": [["column", ["sunlight", "water", "carbon dioxide"], 0.4], ["left_of", "water", "leaf", 1.2], ["right_of", "glucose", "leaf", 1.2],
                          ["right_of", "oxygen", "leaf", 1.2], ["column", ["glucose", "oxygen"], 0.6], ["aligned", "h", ["water", "leaf"]]], "beats": []}
    w, r = solved(ir)
    assert r["ok"], r
    assert not [x for x in w._apart(w.X, w.state_vals) if x > 0.05]


def test_algorithm_state_sets():
    ir = {"vars": {"lo": 0, "hi": 9, "mid": "floor((lo+hi)/2)"}, "objects": [{"type": "cells", "id": "a", "values": [2, 5, 8, 12, 16, 23, 38, 56, 72, 91]}],
          "checks": [["true", "lo <= hi"]], "beats": [{"say": "x", "do": [["show", "a"], ["set", {"lo": "mid+1"}], ["set", {"hi": "mid-1"}]]}]}
    w, r = solved(ir)
    assert r["ok"], r
    st = w.states()
    assert st[1][1]["lo"] == 5 and st[2][1]["hi"] == 6


def test_unsafe_expressions_rejected():
    for bad in ("__import__('os').system('id')", "().__class__", "open('x')", "a.b"):
        ir = {"vars": {"x": bad}, "beats": []}
        w, r = solved(ir)
        assert not r["ok"], bad
    assert GW.fmt_template("{__import__}", {}) == "{__import__}"


def test_circuit_vector_cycle_macros():
    w, r = solved(json.load(open(os.path.join(HERE, "fixtures", "circuit_macro.json"))))
    assert r["ok"], r
    c = [P(w, f"C.c{k}") for k in range(4)]
    assert abs(np.linalg.norm(c[1] - c[0]) - 5) < 1e-6 and abs(np.linalg.norm(c[2] - c[1]) - 3) < 1e-6
    assert abs((c[1] - c[0]) @ (c[2] - c[1])) < 1e-6
    # every part sits on its side of the loop
    for pid, (a, b) in (("C.left0", (3, 0)), ("C.top0", (2, 3)), ("C.right0", (1, 2))):
        for end in ("a", "b"):
            q = P(w, f"{pid}.{end}")
            assert GW._seg_dist(q, c[a], c[b]) < 1e-6
    w, r = solved(json.load(open(os.path.join(HERE, "fixtures", "vector_cycle_macros.json"))))
    assert r["ok"], r
    O, S = P(w, "S.O"), P(w, "S.S")
    assert np.allclose(S - O, [4, 3], atol=1e-6)  # a + b = (3,1) + (1,2)
    assert np.allclose(P(w, "S.V") - O, [1, 2], atol=1e-6)


def test_named_shapes_and_labels_must_match_the_solve():
    # the Pythagoras scene that once passed: the 'inner square' was a parallelogram, sides labelled b and c had other lengths
    r = GW.verify_ir(json.load(open(os.path.join(HERE, "fixtures_bad", "pythagoras_wrong.json"))))
    assert not r["ok"]
    txt = " ".join(r["problems"])
    assert "called a square" in txt and "labelled 'c'" in txt


def test_never_shown_and_transient_zero_size():
    ir = {"vars": {"t": 0}, "objects": [{"type": "point", "id": "O", "at": [0, 0]}, {"type": "point", "id": "P"},
                                         {"type": "segment", "id": "s", "from": "O", "to": "P"}, {"type": "circle", "id": "c", "center": "O", "radius": 1}],
          "constraints": [["polar", "P", "O", "sin(t)", 0]],
          "beats": [{"say": "x", "do": [["show", "s"], ["animate", "t", "pi"]]}]}
    r = GW.verify_ir(ir)
    assert not r["ok"] and any("'c' is never shown" in p for p in r["problems"])
    assert not any("zero length" in p for p in r["problems"])  # s is zero only at t = 0 and t = pi



def test_screen_overlap_scale_and_deterministic_concept_checks():
    import gm_scenegen as sg
    # a rearrangement with one piece in the wrong corner: two shaded pieces on top of each other after the morph
    bad = json.load(open(os.path.join(HERE, "fixtures_bad", "pythagoras_rearranged_overlap.json")))
    w, r = solved(sg.normalize(bad))
    assert not r["ok"] and any("partly overlap" in p and "after beat 3" in p for p in r["problems"]), r["problems"]
    # given numbers must be used; a tangent concept needs a tangent; a rearrangement needs a morph
    ir = {"vars": {"v0": 15, "theta": "45*deg"}, "objects": [], "beats": []}
    assert sg.given_values_report("a ball launched at 20 m/s at 45 degrees", ir)[0].startswith("the concept gives the value 20")
    assert not sg.given_values_report("a ball launched at 15 m/s at 45 degrees", ir)
    assert sg.concept_terms_report("the derivative as the slope of the tangent line on y = x^2", ir)
    assert sg.concept_terms_report("Pythagoras proof by rearrangement", ir)
    # id-less objects get ids; world vectors beside a free axes are bound to it
    ir = sg.normalize({"objects": [{"type": "axes", "id": "g", "x": [-1, 6], "y": [-1, 5]}, {"type": "point", "id": "O", "at": [0, 0]},
                                   {"type": "vector", "from": "O", "comp": [3, 1]}]})
    assert ir["objects"][0]["origin"] == "O" and ir["objects"][2]["id"] == "vector1"
    # a world-unit graph 34 units wide is shrunk unreadably: a problem, not a warning
    big = {"vars": {}, "objects": [{"type": "point", "id": "O", "at": [0, 0]}, {"type": "axes", "id": "ax", "x": [0, 40], "y": [0, 20], "origin": "O"}],
           "beats": [{"say": "x", "do": [["show", "ax"]]}]}
    w, r = solved(big)
    assert not r["ok"] and any("shrunk" in p for p in r["problems"])


def test_tex_exponents_grouped():
    import re as _re
    src = open(os.path.join(os.path.dirname(HERE), "gm_stage.py")).read()
    ns = {"re": _re}
    exec(src[src.index("def _tex_pow"):src.index("def _m(")], ns)  # noqa: S102
    assert ns["_tex_clean"]("x**(n-1)") == "x^{n-1}"
    assert ns["_tex_clean"]("x^10 + 2*x**2") == "x^{10} + 2x^{2}"
    assert ns["_tex_clean"]("e^{x}") == "e^{x}"


if __name__ == "__main__":
    n = 0
    for k, f in list(globals().items()):
        if k.startswith("test_") and callable(f):
            f()
            n += 1
            print("ok", k)
    print(n, "tests passed")

#!/usr/bin/env python3
"""Builds modal_app/gm_manim_docs.json: a retrieval index of the installed Manim Community API (v0.19), used by the
free-form animation coder (modal_app/gm_freeform.py) to put real signatures, docstring summaries and official examples
in front of the model for exactly the APIs it uses (and the ones a traceback names).

Run with the same Manim version the render image pins:  python scripts/build-manim-docs.py
"""
import inspect
import json
import os
import re
import sys

import manim

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "modal_app", "gm_manim_docs.json")

# classes whose own methods are worth indexing as Class.method
METHOD_CLASSES = ["Mobject", "VMobject", "Scene", "MovingCameraScene", "ThreeDScene", "Axes", "CoordinateSystem", "NumberPlane", "NumberLine",
                  "Line", "Arrow", "Vector", "DashedLine", "Circle", "Dot", "Polygon", "Rectangle", "Text", "MathTex", "Tex", "DecimalNumber",
                  "ValueTracker", "VGroup", "Brace", "BarChart", "ThreeDAxes", "Angle", "TracedPath", "ParametricFunction", "Arc", "Sector"]


def clean(doc: str, limit=360) -> str:
    doc = inspect.cleandoc(doc or "")
    para = doc.split("\n\n")[0]
    para = re.sub(r":(class|meth|func|attr|mod):`~?([^`]+)`", r"\2", para)
    para = re.sub(r"``([^`]+)``", r"\1", para)
    para = re.sub(r"\s+", " ", para).strip()
    return para[:limit]


def params(doc: str, limit=700) -> str:
    doc = inspect.cleandoc(doc or "")
    m = re.search(r"\nParameters\n-+\n(.*?)(\n[A-Z][a-z]+\n-+\n|\Z)", doc, re.S)
    if not m:
        return ""
    lines = []
    for block in re.split(r"\n(?=\S)", m.group(1).strip()):
        head, _, body = block.partition("\n")
        lines.append(f"{head.strip()}: {re.sub(r'[ ]+', ' ', body.strip().splitlines()[0]) if body.strip() else ''}".strip())
    out = "; ".join(lines)
    out = re.sub(r":(class|meth|func|attr|mod):`~?\.?([^`]+)`", r"\2", out)
    return re.sub(r"``([^`]+)``", r"\1", out)[:limit]


def example(doc: str, limit=900) -> str:
    doc = inspect.cleandoc(doc or "")
    m = re.search(r"\.\. manim:: \w+.*?\n((?:\s*:[a-z_]+:.*\n)*)\n((?:(?:    .*)?\n)+)", doc + "\n")
    if not m:
        return ""
    code = inspect.cleandoc("\n" + m.group(2))
    return code[:limit]


def sig(obj, name):
    try:
        if inspect.isclass(obj):
            return f"{name}{inspect.signature(obj.__init__)}".replace("(self, ", "(").replace("(self)", "()")
        return f"{name}{inspect.signature(obj)}"
    except (TypeError, ValueError):
        return name


def main():
    idx = {}
    for name in sorted(dir(manim)):
        if name.startswith("_"):
            continue
        obj = getattr(manim, name)
        if not (inspect.isclass(obj) or inspect.isfunction(obj)):
            continue
        if not getattr(obj, "__module__", "").startswith("manim"):
            continue
        doc = obj.__doc__ or ""
        e = {"sig": sig(obj, name)[:500], "doc": clean(doc)}
        p = params(doc)
        if p:
            e["params"] = p
        ex = example(doc)
        if ex:
            e["example"] = ex
        if inspect.isclass(obj):
            e["bases"] = [b.__name__ for b in obj.__mro__[1:4] if b.__module__.startswith("manim")]
        idx[name] = e
    for cname in METHOD_CLASSES:
        cls = getattr(manim, cname, None)
        if cls is None:
            continue
        for mname, fn in vars(cls).items():
            if mname.startswith("_") or not callable(fn):
                continue
            key = f"{cname}.{mname}"
            e = {"sig": sig(fn, mname)[:400].replace("(self, ", "(").replace("(self)", "()"), "doc": clean(fn.__doc__ or "", 260)}
            ex = example(fn.__doc__ or "", 600)
            if ex:
                e["example"] = ex
            idx[key] = e
    json.dump({"version": manim.__version__, "entries": idx}, open(OUT, "w"), separators=(",", ":"))
    print(f"{len(idx)} entries, manim {manim.__version__}, {os.path.getsize(OUT) // 1024} KB -> {OUT}")


if __name__ == "__main__":
    sys.exit(main())

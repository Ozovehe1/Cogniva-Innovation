"""Golden frames for the verified gallery scenes (gm_gallery.json) and the test fixtures: each scene is compiled exactly as the
pipeline does (gm_scenegen.compile_scene), its last frame rendered at low quality and compared with tests/golden/<name>.png.

    MANIM_BIN=.../manim python modal_app/tests/test_golden.py            # compare
    MANIM_BIN=.../manim python modal_app/tests/test_golden.py --update   # re-record after an intended visual change
"""
import glob
import json
import os
import re
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
sys.path.insert(0, APP)
import gm_scenegen  # noqa: E402
import gm_world  # noqa: E402

GOLD = os.path.join(HERE, "golden")
MANIM = os.environ.get("MANIM_BIN", "manim")


def scenes():
    out = []
    for it in json.load(open(os.path.join(APP, "gm_gallery.json"))):
        out.append(("gallery_" + re.sub(r"[^a-z0-9]+", "_", it["topic"].lower())[:40].strip("_"), it["ir"]))
    for p in sorted(glob.glob(os.path.join(HERE, "fixtures", "*.json"))):
        out.append((os.path.basename(p)[:-5], json.load(open(p))))
    return out


def last_frame(ir) -> np.ndarray:
    from PIL import Image
    code = gm_scenegen.compile_scene(ir)
    with tempfile.TemporaryDirectory() as wd:
        src = os.path.join(wd, "scene.py")
        open(src, "w").write(code)
        env = {**os.environ, "PYTHONPATH": APP}
        r = subprocess.run([MANIM, "-ql", "-s", "--format", "png", "--media_dir", wd, "--disable_caching", "--progress_bar", "none", src, gm_scenegen.SCENE],
                           cwd=wd, capture_output=True, text=True, env=env, timeout=240)
        if r.returncode != 0:
            raise RuntimeError(r.stderr[-1500:])
        png = sorted(glob.glob(os.path.join(wd, "**", "*.png"), recursive=True))[-1]
        return np.asarray(Image.open(png).convert("L"), dtype=float)


def main(update=False):
    from PIL import Image
    os.makedirs(GOLD, exist_ok=True)
    fails = 0
    for name, ir in scenes():
        v = gm_world.verify_ir(ir)
        assert v["ok"], (name, v["problems"])
        img = last_frame(ir)
        path = os.path.join(GOLD, name + ".png")
        if update or not os.path.exists(path):
            Image.fromarray(img.astype(np.uint8)).save(path)
            print("recorded", name)
            continue
        ref = np.asarray(Image.open(path).convert("L"), dtype=float)
        d = float(np.abs(ref - img).mean()) if ref.shape == img.shape else 255.0
        ok = d < 2.0
        fails += not ok
        print("ok " if ok else "DIFF", name, f"mean abs diff {d:.2f}")
    if fails:
        raise SystemExit(f"{fails} golden frame(s) changed")


if __name__ == "__main__":
    main("--update" in sys.argv)

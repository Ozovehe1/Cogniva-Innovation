"""
OmniSVG 1.1 4B (Apache-2.0) text-to-SVG evaluation on Modal: NOT used by the app; a measured trial only.

    POST /start   {prompts: [...], candidates?: 1}   X-Render-Token   -> {call_id}   (runs in the background)
    GET  /result?call_id=...                         X-Render-Token   -> {status, results?: [{prompt, svg, seconds}], ...}

Weights (Qwen2.5-VL-3B base + OmniSVG weights, ~15 GB) are fetched once by a CPU function into a Volume, so the GPU
is never billed for downloads. The GPU function scales to zero immediately and is capped at 12 minutes per run.
"""
import os
import time

import modal

app = modal.App("geniusmap-omnisvg-eval")
weights = modal.Volume.from_name("omnisvg-weights", create_if_missing=True)
HF = "/weights/hf"

image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("git", "libcairo2", "libcairo2-dev", "pkg-config")
    .pip_install(
        "torch==2.3.0", "torchvision==0.18.0", "transformers==4.51.3", "accelerate==1.2.1", "numpy==1.26.4", "Pillow==10.1.0",
        "CairoSVG==2.7.1", "einops==0.4.1", "qwen-vl-utils==0.0.11", "ConfigArgParse==1.7.1", "PyYAML==6.0.2", "shapely==2.0.7",
        "huggingface_hub==0.30.2", "fastapi[standard]",
    )
    .run_commands("git clone --depth 1 https://github.com/OmniSVG/OmniSVG.git /opt/OmniSVG")
    .env({"HF_HOME": HF, "HF_HUB_ENABLE_HF_TRANSFER": "0"})
)


@app.function(image=image, volumes={"/weights": weights}, timeout=40 * 60, cpu=2, memory=4096)
def fetch_weights():
    from huggingface_hub import snapshot_download
    t = time.time()
    for repo in ["Qwen/Qwen2.5-VL-3B-Instruct", "OmniSVG/OmniSVG1.1_4B"]:
        snapshot_download(repo)
    weights.commit()
    return round(time.time() - t, 1)


@app.function(image=image, gpu="L4", volumes={"/weights": weights}, timeout=12 * 60, scaledown_window=2, max_containers=1)
def generate(prompts: list[str], candidates: int = 1):
    import subprocess
    import glob
    import tempfile
    t0 = time.time()
    out = tempfile.mkdtemp()
    src = os.path.join(out, "prompts.txt")
    with open(src, "w") as f:
        f.write("\n".join(p.replace("\n", " ") for p in prompts))
    r = subprocess.run(
        ["python", "inference.py", "--task", "text-to-svg", "--input", src, "--output", out, "--model-size", "4B",
         "--num-candidates", str(candidates), "--verbose"],
        cwd="/opt/OmniSVG", capture_output=True, text=True, timeout=11 * 60, env={**os.environ, "HF_HUB_OFFLINE": "1"},
    )
    log = (r.stdout + r.stderr)[-6000:]
    results = []
    for i, p in enumerate(prompts):
        files = sorted(glob.glob(os.path.join(out, f"{i + 1:04d}_*.svg")))
        results.append({"prompt": p, "svg": open(files[0]).read() if files else None})
    # Per-prompt seconds from the script's own log ("Generated N candidates in 12.34s").
    import re
    secs = [float(x) for x in re.findall(r"candidates in ([\d.]+)s", log)]
    load = re.search(r"All 4B models loaded", log)
    return {"results": results, "gen_seconds": secs, "total_seconds": round(time.time() - t0, 1), "loaded": bool(load), "exit": r.returncode, "log_tail": log[-2500:]}


@app.function(image=image, secrets=[modal.Secret.from_name("geniusmap-render")], timeout=60)
@modal.asgi_app(label="geniusmap-omnisvg-eval")
def web():
    from fastapi import FastAPI, Header, HTTPException
    from pydantic import BaseModel

    api = FastAPI()

    def auth(tok):
        if not tok or tok != os.environ.get("RENDER_TOKEN"):
            raise HTTPException(403, "forbidden")

    class Start(BaseModel):
        prompts: list[str] = []
        candidates: int = 1
        weights_only: bool = False

    @api.post("/start")
    def start(body: Start, x_render_token: str | None = Header(default=None)):
        auth(x_render_token)
        if body.weights_only:
            return {"call_id": fetch_weights.spawn().object_id}
        prompts = [p[:300] for p in body.prompts[:6]]
        return {"call_id": generate.spawn(prompts, max(1, min(2, body.candidates))).object_id}

    @api.get("/result")
    def result(call_id: str, x_render_token: str | None = Header(default=None)):
        auth(x_render_token)
        fc = modal.FunctionCall.from_id(call_id)
        try:
            r = fc.get(timeout=0)
            return {"status": "done", **r} if isinstance(r, dict) else {"status": "done", "seconds": r}
        except TimeoutError:
            return {"status": "running"}
        except Exception as e:  # noqa: BLE001
            return {"status": "error", "error": str(e)[:500]}

    return api

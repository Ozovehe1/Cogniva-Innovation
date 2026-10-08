"""
GeniusMap Python sandbox (Modal app "geniusmap-py") for the "Ask GeniusMap" agent's run_python tool.

POST /run   (header X-Render-Token must equal the RENDER_TOKEN secret)
  body: {"code": str (<= 12000 chars)}
  -> {"ok": bool, "stdout": str (<= 8000 chars), "error": str | null, "images": [base64 PNG, ...] (<= 4), "ms": int}
GET /health -> {"ok": true}

Every run is a fresh Modal Sandbox (gVisor): no network (block_network=True), 1 CPU, 1 GiB memory,
a 20 s wall clock limit on the code (the sandbox itself dies at 30 s), no secrets, an empty
writable /tmp, and a non-root process with RLIMIT_AS / RLIMIT_NPROC / RLIMIT_FSIZE caps. Libraries:
numpy, sympy, scipy, matplotlib (Agg), pandas, networkx. matplotlib figures left open at the end
(or created with plt.show()) are returned as PNGs.

Secrets (Modal secret "geniusmap-render", shared with the other apps): RENDER_TOKEN (only the web
endpoint sees it; the sandbox gets no secrets). Deployed from the Vercel production build
(scripts/deploy-modal.mjs).
"""

import hmac
import json
import os
import time

import modal

APP_NAME = "geniusmap-py"
SECRET_NAME = "geniusmap-render"
CODE_LIMIT_S = 20

app = modal.App(APP_NAME)

sandbox_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("numpy==2.3.3", "sympy==1.14.0", "scipy==1.16.2", "matplotlib==3.10.6", "pandas==2.3.3", "networkx==3.5")
    .run_commands("useradd -m runner", "python -c 'import matplotlib; matplotlib.use(\"Agg\"); import matplotlib.pyplot'")
    .env({"MPLBACKEND": "Agg", "MPLCONFIGDIR": "/tmp/mpl", "PYTHONDONTWRITEBYTECODE": "1", "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1"})
)
web_image = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi[standard]==0.115.6")

# Runs inside the sandbox as user "runner": limits first, then the learner-facing code (written by the AI).
RUNNER = r'''
import base64, io, json, os, resource, signal, sys, contextlib, traceback
resource.setrlimit(resource.RLIMIT_AS, (900 * 1024 * 1024, 900 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
resource.setrlimit(resource.RLIMIT_FSIZE, (20 * 1024 * 1024, 20 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CPU, (%(limit)d, %(limit)d + 1))
def _timeout(*_): raise TimeoutError("time limit (%(limit)d s) reached")
signal.signal(signal.SIGALRM, _timeout); signal.alarm(%(limit)d)
code = open("/tmp/code.py").read()
os.makedirs("/tmp/work", exist_ok=True); os.makedirs("/tmp/mpl", exist_ok=True)
import pwd
_pw = pwd.getpwnam("runner")
os.chown("/tmp/work", _pw.pw_uid, _pw.pw_gid); os.chown("/tmp/mpl", _pw.pw_uid, _pw.pw_gid)
os.setgroups([]); os.setgid(_pw.pw_gid); os.setuid(_pw.pw_uid)
os.chdir("/tmp/work"); os.environ["HOME"] = "/tmp/work"
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.show = lambda *a, **k: None
out = io.StringIO(); err = None
try:
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        exec(compile(code, "<code>", "exec"), {"__name__": "__main__"})
except BaseException as e:
    err = "".join(traceback.format_exception_only(type(e), e)).strip()[-1500:]
signal.alarm(0)
imgs = []
for n in plt.get_fignums()[:4]:
    b = io.BytesIO()
    try:
        plt.figure(n).savefig(b, format="png", dpi=110, bbox_inches="tight")
        imgs.append(base64.b64encode(b.getvalue()).decode())
    except Exception as e:
        err = err or f"figure {n}: {e}"
print("\n@@RESULT@@" + json.dumps({"stdout": out.getvalue()[-8000:], "error": err, "images": imgs}))
'''


@app.function(image=web_image, secrets=[modal.Secret.from_name(SECRET_NAME)], timeout=90, max_containers=4)
@modal.concurrent(max_inputs=8)
@modal.asgi_app(label="geniusmap-py")
def web():
    from fastapi import FastAPI, Header, HTTPException
    from pydantic import BaseModel, Field

    api = FastAPI(title="GeniusMap Python sandbox", docs_url=None, redoc_url=None, openapi_url=None)

    class RunRequest(BaseModel):
        code: str = Field(min_length=1, max_length=12000)

    @api.get("/health")
    def health():
        return {"ok": True}

    @api.post("/run")
    def run(req: RunRequest, x_render_token: str | None = Header(default=None)):
        expected = os.environ.get("RENDER_TOKEN", "")
        if not expected or not x_render_token or not hmac.compare_digest(x_render_token, expected):
            raise HTTPException(status_code=401, detail="unauthorized")
        t0 = time.time()
        sb = None
        try:
            sb = modal.Sandbox.create(
                app=modal.App.lookup(APP_NAME, create_if_missing=True),
                image=sandbox_image,
                block_network=True,
                cpu=1.0,
                memory=1024,
                timeout=40,
            )
            # Files go in through stdin (no shared filesystem); the runner drops to the "runner" user itself.
            for path, content in (("/tmp/code.py", req.code), ("/tmp/runner.py", RUNNER % {"limit": CODE_LIMIT_S})):
                w = sb.exec("bash", "-c", f"cat > {path}", timeout=15)
                w.stdin.write(content.encode())
                w.stdin.write_eof()
                w.stdin.drain()
                w.wait()
            p = sb.exec("python", "/tmp/runner.py", timeout=CODE_LIMIT_S + 8)
            out = p.stdout.read()
            p.wait()
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "stdout": "", "error": f"sandbox error: {type(exc).__name__}: {str(exc)[:300]}", "images": [], "ms": int((time.time() - t0) * 1000)}
        finally:
            if sb is not None:
                try:
                    sb.terminate()
                except Exception:  # noqa: BLE001
                    pass
        ms = int((time.time() - t0) * 1000)
        if "@@RESULT@@" not in out:
            return {"ok": False, "stdout": out[-4000:], "error": "the sandbox stopped before finishing (time or memory limit)", "images": [], "ms": ms}
        head, _, tail = out.rpartition("@@RESULT@@")
        try:
            r = json.loads(tail.strip().splitlines()[0])
        except Exception:  # noqa: BLE001
            return {"ok": False, "stdout": out[-4000:], "error": "could not read the result", "images": [], "ms": ms}
        return {"ok": r.get("error") is None, "stdout": (head.strip() + "\n" + r.get("stdout", "")).strip()[-8000:], "error": r.get("error"), "images": r.get("images", [])[:4], "ms": ms}

    return api

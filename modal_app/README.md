# modal_app/ — the Modal services

Deployed by `scripts/deploy-modal.mjs` during the Vercel production build when these files change.

| File | Modal app | What it does |
|---|---|---|
| `manim_render.py` | `geniusmap-manim` | Web endpoint for clip renders (token-protected), `/warm`, and the `lesson_video` function (records `/render/lesson/:id` in headless Chrome). Uploads mp4 + pen paths + `<clip>.report.json` to signed URLs and calls back the web app. |
| `gm_world.py`, `gm_stage.py`, `gm_scenegen.py`, `gm_scene.py` | (imported) | Scene engine: scene language (IR) → solver/verifier (sympy numbers, geometry, adaptive label layout) → Manim stage. |
| `gm_freeform.py`, `gm_ffkit.py`, `gm_ffprobe.py` | (imported) | Free-form Manim code with a render-and-fix loop (fallback when no verified scene fits). |
| `gm_compose.py`, `gm_partcompose.py`, `gm_parts.py`, `gm_rigs.py`, `gm_mesh3d.py` | (imported) | Template / part-graph composers (last fallback). |
| `gm_llm.py` | (imported) | Model calls. Tries the web app's shared pool (`POST {APP_URL}/api/llm/pool`) first, then Groq/Gemini directly. `GM_POOL=0` disables the pool. |
| `pen_export.py` | (imported) | Pen paths so the drawing hand can trace a clip. |
| `tts.py` | `geniusmap-tts` | Kokoro-82M narration (voice `af_heart`), MP3 + word timings. |
| `py_sandbox.py` | `geniusmap-py` | The agent's `run_python` sandbox (no network, 1 CPU, 1 GiB, 20 s). |
| `omnisvg_eval.py` | `geniusmap-omnisvg-eval` | Trial only; not used by the app. |

Data files: `gm_grammar.md`, `gm_ir_doc.md` (prompts/reference), `gm_manim_docs.json` (Manim v0.19 API sheet, built by
`scripts/build-manim-docs.py`), `gm_gallery.json`, `gm_memory.json`.

Tests: `python -m pytest tests` — layout fixtures (`tests/fixtures_layout`), verdicts, world solver, golden frames
(`tests/golden`; re-record only after looking at the new frames). Needs manim + cairo/pango on the PATH.

Do not commit local experiments (e.g. `gm_neuro.py`) or secrets; Modal reads secrets from the `geniusmap-render` secret.

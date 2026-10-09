# scripts/

| Script | Use |
|---|---|
| `deploy-modal.mjs` | Runs in the Vercel production build; deploys changed Modal apps. `FORCE_MODAL_DEPLOY=1` deploys all. |
| `agent-eval.mjs` | Runs eval groups against a deployment (`/api/agent/eval`). |
| `llm-pool-loadtest.mjs` / `.ts` | Mocked-provider load test of the LLM pool (virtual clock). |
| `build-illustration-index.mjs` | Rebuilds `src/lib/illustrations/library.json` from the free libraries. |
| `build-manim-docs.py` | Rebuilds the Manim v0.19 API sheet `modal_app/gm_manim_docs.json`. |
| `flagship-clip.py`, `test-ink-under-pen.py` | Manual checks for clips and the pen/ink order. |
| `gen-live-tutor-migration.ts` | Historical: generated an early migration. |

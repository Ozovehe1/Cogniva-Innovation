# Runbooks

## Is production healthy?
1. Vercel: latest production deployment is READY for the commit you pushed (dashboard, or the Vercel API
   `/v6/deployments?projectId=…&target=production`).
2. Build log contains `[deploy-modal] done`; when `modal_app/` changed it lists `modal deploy modal_app/manim_render.py`.
3. `/admin/pool` (admin emails only): slot health, quota left today, cooling slots.

## LLM pool
- Add capacity: add `GROQ_API_KEY_n` / `GEMINI_API_KEY_n` in Vercel (and the Modal secret if the render service
  should fall back to it directly), redeploy. Nothing else.
- Everything busy: Ask shows the busy state; lessons pause and resume via the draft tick. Check `/admin/pool`.
- Render service: `modal_app/gm_llm.py` calls `POST {APP_URL}/api/llm/pool` (header `X-Render-Token`) first and falls
  back to direct Groq/Gemini calls when the pool is unreachable, busy (503) or unauthorised (backs off 10 min on
  401/404). Stage logs show `pool <model> ok 3.2s` or `pool 503 -> direct`. Kill switch: set `GM_POOL=0` in the Modal
  secret.
- Details: `docs/llm-pool/README.md`.

## Modal
- Redeploy everything: `FORCE_MODAL_DEPLOY=1 node scripts/deploy-modal.mjs` (needs `MODAL_TOKEN_ID/SECRET`).
- Apps: `geniusmap-manim` (render web endpoint + `lesson_video`), `geniusmap-tts`, `geniusmap-py`,
  `geniusmap-omnisvg-eval` (trial only, not used by the app).
- A clip job stuck in `rendering` (`manim_jobs.status`): check the Modal app logs for the job id. A clip is only shown
  once its job is `done` and its verdict is not `ok:false`. Each render uploads `<clip>.report.json` (and `<clip>.ff.json` for free-form
  code) next to the mp4 in the `manim-clips` bucket with the stage log.
- Scene-engine layout fixtures and golden frames: `modal_app/tests/` (re-record goldens only after looking at them).

## Evals
`GET /api/agent/eval?group=<g>&student=<uuid>` with `Authorization: Bearer $AGENT_SECRET` (runs at Ask priority but
never takes learner-reserved slots). Groups: `static`, `pool`, `injection`, `playbook`, `visual`, `tools`, `giveaway`,
`routing`, `regression`, `assessment`, `lesson`, `turn&msg=…` (one full turn, for debugging).
Run all groups after any change to prompts, routing or tools. Known flaky on the free tier (model variance, not bugs):
`tool-rag`, `route-args-drag-circle`. A failure caused by quota (`AllModelsBusy`, 429) is not a regression: re-run later.
Script: `scripts/agent-eval.mjs`.

## Reports ("Report a mistake")
`/admin/reports` (admin emails): confirm, mark invalid, or "add to regression set". Confirmed picture reports block that
picture for the topic. See `docs/correctness.md`.

## Lesson drafting stalls
pg_cron `lesson-draft-tick` (every minute) resumes stalled drafts via `/api/cron/lesson-drafts?tick=1`; the Vercel
daily cron runs the same route without `tick` and purges expired check-ins.

## Deleting a learner's data
Settings → Delete account (type DELETE) removes rows and storage objects (clips, audio, videos). Admin cleanup uses the
same routes (`/api/account`, `/api/paths/:id`, `/api/lessons/:id`).

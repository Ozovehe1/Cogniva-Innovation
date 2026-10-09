# Setup

## Local

```bash
npm install
# create .env.local with the names below (values from Vercel: `vercel env pull .env.local`)
npm run dev                   # http://localhost:3000
npx tsc --noEmit && npx eslint src   # both must be clean before a push
```

Python (Modal app tests): `cd modal_app && python -m pytest tests` (needs manim, cairo, pango; see `modal_app/README.md`).

## Environment variable NAMES (values live in Vercel / Modal / Supabase, never in the repo)

Vercel (web app):

| Group | Names |
|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| LLM pool | `GROQ_API_KEY`, `GROQ_API_KEY_2`, `GEMINI_API_KEY`, `GEMINI_API_KEY_2` … `_5` (any n is read); tuning: `POOL_RESERVE_SLOTS`, `POOL_BG_SHARE`, `POOL_BG_HEADSTART`, `POOL_ASK_SHARE`, `POOL_USER_TPM`, `POOL_USER_TPD`, `GROQ_MODEL_GUARD` |
| Modal | `MODAL_RENDER_URL`, `MODAL_TTS_URL`, `MODAL_PY_URL`, `RENDER_TOKEN`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` (build-time deploy) |
| App | `APP_URL`, `AGENT_SECRET` (eval + internal routes), `CRON_SECRET`, `DRAFT_TICK_SECRET`, `ADMIN_EMAILS`, `NEXT_PUBLIC_GENIE` |
| Agent limits | `AGENT_DAILY_MESSAGES`, `AGENT_DAILY_ANIMATIONS`, `AGENT_DAILY_SEARCHES`, `AGENT_DAILY_PYTHON`, `AGENT_DAILY_PRACTICE`, `AGENT_DAILY_MINI_LESSONS`, `AGENT_PY_GROQ_FALLBACK` |
| Test only | `LESSON_AI_MOCK`, `LESSON_AI_MOCK_QUOTA_AT`, `PENROSE_DEBUG`, `FORCE_MODAL_DEPLOY` |

Modal secret `geniusmap-render` (read by `modal_app/*`): `APP_URL`, `RENDER_TOKEN`, `GROQ_API_KEY`, `GEMINI_API_KEY`,
`GEMINI_API_KEY_2` … ; optional switches `GM_POOL` (0 = no pool), `GM_POOL_URL`, `GM_FORCE_MODELS`, `GM_GROQ_MODELS`.

Supabase Vault: the draft-tick secret used by the `lesson-draft-tick` pg_cron job (same value as `DRAFT_TICK_SECRET`).

Note: Google reports `GEMINI_API_KEY` (key 1) as invalid as of 2026-10-09. The pool skips a failing key; it was left in
place on purpose. Replace or remove it in Vercel and Modal when convenient.

## Deploy

- Push to `main` → Vercel production build (`npm run build`). The build first runs `scripts/deploy-modal.mjs`, which
  redeploys a Modal app only when its files changed since the previous deployment (`FORCE_MODAL_DEPLOY=1` for all).
- Database: migrations in `supabase/migrations/` are applied by hand (Supabase SQL editor or Management API), in order.

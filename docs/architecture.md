# Architecture

GeniusMap is an AI-only tutor. A learner says what they want to learn, takes a short adaptive check (or skips it when
they are brand new), gets a personal path, and is taught each topic in AI-written whiteboard lessons with voice,
pictures, live figures and short animations. An agent ("Ask GeniusMap" + the Learning Director) answers questions and
plans between sessions. Everything runs on free tiers.

```
Browser (Next.js app, phone-first)
  │  lessons, Ask, onboarding, check, path, settings
  ▼
Vercel (Next.js 16, region dub1)  ── cron /api/cron/lesson-drafts (daily) + Supabase pg_cron draft tick (every minute)
  │   src/app/api/*  route handlers          src/lib/*  server logic
  │   LLM pool (Groq + Gemini free keys) ────────────────┐
  ▼                                                       │
Supabase "Cogniva Project" (eu-west-1)                    │
  Postgres + RLS, Auth, Storage buckets, pg_cron,         │
  Edge Function `embed` (gte-small) for RAG               │
  ▲                                                       │
  │ signed upload URLs + callback                         │
Modal (workspace abdulcosman01)                           │
  geniusmap-manim  manim_render.py  clips, lesson video ──┘ LLM calls go through POST /api/llm/pool first
  geniusmap-tts    tts.py           Kokoro-82M voice
  geniusmap-py     py_sandbox.py    agent run_python sandbox (no network)
```

## Main flows

| Flow | Entry | Core code |
|---|---|---|
| Onboarding (4 screens, under-18 consent) | `/start` | `src/app/start`, `src/lib/intake.ts`, `src/lib/onboarding-signals.ts`, `docs/design/onboarding.md` |
| Adaptive check (6-10 items) and path | `/api/diagnostic/*` | `src/lib/diagnostic-core.ts`, `src/lib/path.ts`, `src/lib/speculation.ts` (first lesson drafted during the check) |
| Lessons (beats drafted in parallel, resumable) | `/learn/[id]` | `src/lib/lesson-ai.ts`, `lesson-beats.ts`, `lesson-drafting.ts`, `lesson-schema.ts`, `src/components/whiteboard/*` |
| Voice | `/api/tts` | `src/lib/tts-server.ts`, `modal_app/tts.py` (cached MP3 + word timings in `lesson-audio`) |
| Mastery checks (3 of 4) | lesson end | `src/lib/assessment/*`, `src/lib/question-quality.ts` |
| Ask (chat agent, persistent board) | `/ask`, `/api/agent/chat` | `src/lib/agent/run.ts` (loop, system prompt), `tools.ts` (tools + routing), `board-*.ts` |
| Learning Director (between sessions) | `/api/agent/tick` | `src/lib/agent/director.ts`, `today.ts`, `memory.ts` |
| Animations | `animate_concept`, one clip per lesson | `src/lib/manim.ts` (jobs, signed URLs), `modal_app/manim_render.py`, `gm_*.py` scene engine |
| Lesson video export | Download → Video | `src/lib/lesson-video.ts`, `modal_app/lesson_video.py` |
| Correctness + Report a mistake | every artefact | `src/lib/correctness/*`, `/admin/reports`, `docs/correctness.md` |
| Teaching playbook (learning without retraining) | background | `src/lib/playbook/*`, `docs/playbook.md` |
| Illustrations | `find_illustration` | `src/lib/illustrations/*` (library of ~8,300 credited pictures), fallback `illustrate` draws SVG |

## LLM pool

All model calls (lessons, Ask, Director, checks, and since Oct 2026 the Modal render service) share one pool of free
slots (key × model) with a Postgres ledger for RPM/TPM/RPD/TPD, learner-reserved slots and a per-learner share. See
`docs/llm-pool/README.md`.

## Data rules

- Lesson content is written per learner and never reused for another learner (playbook rules are anonymised and
  carry no lesson content; see `docs/playbook.md` §4).
- RLS: learners read only their own rows; server routes that clean up use the service role after checking the session.
- Check-ins expire after 14 days (`purge_expired_checkins`, called by the daily cron).

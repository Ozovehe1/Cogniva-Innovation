# Ideanimo

An AI tutor that starts from what you know and shows every idea. A learner says what they want to learn, takes a short
adaptive check (or skips it when they are brand new), gets a personal path, and is taught each topic in AI-written
whiteboard lessons: a pen that writes line by line, exact diagrams, credited textbook pictures, live figures to drag,
short Manim animations and a natural voice. "Ask Ideanimo" answers any question on the same kind of board.

Live: https://ideanimo.vercel.app (the old https://cogniva-innovation.vercel.app still serves the same app) · How it works: [/about](https://ideanimo.vercel.app/about)

> **Name:** the product was called GeniusMap until October 2026 and is now Ideanimo. Infrastructure identifiers keep
> the old name on purpose so nothing breaks: Modal apps (`geniusmap-manim`, `geniusmap-tts`, `geniusmap-py`,
> `geniusmap-omnisvg-eval`), their `*.modal.run` URLs and the `geniusmap-render` Modal secret, the npm package name,
> browser events (`geniusmap:before-signout`, `geniusmap:zoom`), the `modal_app/` sources, already-applied Supabase
> migrations, the Vercel project / repo name (`cogniva-innovation`), and `APP_URL` for Modal callbacks
> (`scripts/deploy-modal.mjs` defaults to `https://cogniva-innovation.vercel.app`, which serves the same deployment).

## Stack

- **Web:** Next.js 16 (App Router) on Vercel, region dub1. Tailwind, Framer Motion, GSAP, perfect-freehand, Rough.js,
  KaTeX, Penrose, JSXGraph, three.js, Rive.
- **Data:** Supabase (Postgres + RLS, Auth, Storage, pg_cron, Edge Function for gte-small embeddings).
- **Models:** free tiers only. One shared pool of Groq (Qwen, gpt-oss) and Gemini keys with a Postgres rate ledger.
- **Rendering:** Modal — Manim scene engine for clips, Kokoro-82M voice, a Python sandbox, lesson video export.

## Repository

| Path | What |
|---|---|
| `src/app` | Pages and API routes (`/start`, `/learn`, `/ask`, `/api/*`) |
| `src/lib` | Server logic: lessons, diagnostic, path, agent (`src/lib/agent`), correctness, playbook, illustrations, assessment |
| `src/components` | UI, including the whiteboard player (`src/components/whiteboard`) |
| `modal_app` | Modal services (see `modal_app/README.md`) |
| `supabase` | Migrations and the embed Edge Function |
| `scripts` | Build-time Modal deploy, evals, load test, index builders |
| `docs` | Handover documentation |

## Docs

- [Architecture](docs/architecture.md) · [Setup and env var names](docs/setup.md) · [Runbooks](docs/runbooks.md) ·
  [Decision notes](docs/decisions.md)
- [LLM pool](docs/llm-pool/README.md) · [Correctness and Report a mistake](docs/correctness.md) ·
  [Teaching playbook](docs/playbook.md) · [Design](docs/design/)

## Develop

```bash
npm install
npm run dev
npx tsc --noEmit && npx eslint src
```

Pushing to `main` deploys to production; the build redeploys changed Modal apps. Run the eval groups after changes to
prompts, routing or tools (see the runbooks).

## Credits

Pictures come from Servier Medical Art, Bioicons and Wikimedia Commons under their own licences, credited where shown.
Open-source software and licences are listed on [/credits](https://cogniva-innovation.vercel.app/credits).

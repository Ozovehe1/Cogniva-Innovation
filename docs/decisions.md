# Decision notes

Short record of product and technical decisions and why. Newest first.

- **2026-10-09 Render service on the shared pool.** Manim composer/critic calls go through `/api/llm/pool` so they
  share keys, budgets and learner-reserved slots with lessons and Ask; direct calls stay as a fallback so a render
  never fails because of the pool.
- **2026-10-09 Animation requests use `animate_concept`.** "Show me an animation of…" had been answered with a slider
  simulation; simulate is now only offered for animation asks when sliders are also asked for. Replies must describe
  only what the visual actually contains.
- **2026-10-09 One model pool for all learners** (no separate model for under-18s), on the free tier only.
- **2026-10-09 Never share lesson content across learners**, even to save cost. Playbook rules are anonymised.
- **2026-10-09 Free illustrations** (Servier, Bioicons, Wikimedia Commons, credited) instead of paid text-to-SVG;
  OmniSVG trialled and rejected (off-topic, unlabelled). A drawn SVG is the fallback when nothing fits.
- **2026-10-09 Visual tools as standard:** GSAP board motion, perfect-freehand / Rough.js pen, Penrose exact diagrams,
  JSXGraph live figures, Manim scene engine (verified scenes first, then free-form code, then the template composer).
- **2026-10-09 "UX Magnifica" design bar:** every UI choice tied to a learning-science principle
  (`docs/design/lesson-ui.md` §0, `docs/design/app-ui.md`).
- **2026-10-09 Onboarding v2:** 4 screens before a 6-10 item check; signals inferred instead of asked
  (`docs/design/onboarding.md`).
- **2026-10-08 Agent:** Groq-first chain with Gemini fallback, Learning Director as LLM turns with deterministic
  fallback, RAG via `learner_memory` + gte-small embeddings.
- **2026-10-08 Video export on demand** (tap Download → Video), cached per lesson + script hash; target ≤ 2 min.
- **2026-10-08 Navigation:** Home, Learn, Ask; account things behind the avatar at `/settings`.
- **2026-10-07 AI-tutor only:** no human tutors, no learning-styles test, no material uploads; adaptive prerequisite
  check; brand-new learners skip the check.
- **2026-10-07 Free tier only** (no paid Gemini). Vercel functions in dub1 next to Supabase eu-west-1.
- **2026-10-07 Not exam-aligned:** curriculum inferred from the learner's own goal, not WAEC/NECO.

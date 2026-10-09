# src/lib/agent — Ask GeniusMap and the Learning Director

- `run.ts` — the agent loop (max 6 steps, 3 writes), `CHAT_SYSTEM` and `DIRECTOR_SYSTEM` prompts, forced first tool
  call when the learner explicitly asks for a visual.
- `tools.ts` — every tool (definition + runner) and `selectTools()`, the per-turn tool routing (keeps prompts small for
  Groq's 8K TPM). Animation / clip / video asks route to `animate_concept`. Un-hinted concept questions go through
  `src/lib/visual-policy.ts` (structure → find_illustration, process → animate_concept, motion → simulate, function →
  plot/interactive, derivation → board): those tools are offered, a "Visual plan" note is added and the first step must
  call a tool. The same policy steers lesson beats (illustration / stage) and the in-lesson sheet (lesson title).
- `llm.ts`, `pool.ts`, `pool-prompt.ts` — model calls on the shared free-tier pool (see `docs/llm-pool/README.md`).
- `board-*.ts`, `visual.ts`, `math-diagram.ts`, `interactive.ts`, `exact-triangle.ts` — the persistent chat whiteboard
  and the exact visual tools (Penrose, JSXGraph).
- `director.ts`, `today.ts`, `memory.ts`, `learner-model.ts`, `actions.ts` — between-session planning, Today plan, RAG
  memory, learner state, confirmable actions.
- `guard.ts`, `secret.ts` — injection screening, internal auth.
- `eval.ts`, `pool-eval.ts` — eval groups served by `/api/agent/eval` (see `docs/runbooks.md`).

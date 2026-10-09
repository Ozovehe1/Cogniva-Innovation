# LLM pool — one shared pool of free model slots for every caller

Code: `src/lib/agent/pool.ts` (inventory, routing, budgets, health, ladder), `src/lib/agent/llm.ts` (Groq/Gemini
call shapes on top of the pool), `src/lib/gemini.ts` (`generateText` / `generateStructuredJson` on the pool),
`src/lib/agent/pool-prompt.ts` (history compaction), `supabase/migrations/20261019090000_llm_pool.sql` (shared
ledger), `/api/admin/llm-pool` + `/admin/pool` (health), `src/lib/agent/pool-eval.ts` (eval group `pool`),
`scripts/llm-pool-loadtest.mjs` (mocked-provider load test).

## 1. Inventory (read from env at every cold start)

| Provider | Env names read | Models per key | Free limits per slot (source) |
|---|---|---|---|
| Groq | `GROQ_API_KEY`, `GROQ_API_KEY_2` … any n | `qwen/qwen3.8-27b`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b` (+ prompt-guard-86m, own quota) | 30 RPM · 1K RPD · 8K TPM · 200K TPD per model **per org** (console.groq.com/docs/rate-limits, checked 2026-10-09). Cached prompt tokens do not count (docs/prompt-caching; gpt-oss models only). |
| Gemini | `GEMINI_API_KEY`, `GEMINI_API_KEY_2` … any n | 3.8 / 2.5 / 3.7 / 3.6 / 3.5 flash, 3.5 / 3.1 flash-lite | flash 5 RPM · 20 RPD; flash-lite 15 RPM · 500 RPD; 250K TPM — **per Google Cloud project**, RPD resets midnight Pacific (AI Studio rate-limit page 2026-10-07; ai.google.dev/gemini-api/docs/rate-limits no longer lists numbers). |

Vercel (2026-10-09, names only): `GROQ_API_KEY`, `GROQ_API_KEY_2` (abdool4impact org, Production+Preview);
`GEMINI_API_KEY`, `_2`, `_3`, `_4`, `_5`. Pool = 2 × 3 Groq slots + 5 × 7 Gemini slots = **41 slots**.
v1 read 1 Groq key and Gemini keys 1-4 only (`gemini.ts` capped at 4; `GEMINI_API_KEY_5` was ignored).
New keys: add `GROQ_API_KEY_n` / `GEMINI_API_KEY_n` in Vercel and redeploy; nothing else. Duplicated values are
dropped. Limits are overridable (`GROQ_RPM/RPD/TPM/TPD`).

**Daily capacity (free):** Groq 2 orgs × 3 × 200K = **1.2M tokens/day** (v1: 600K). Gemini 5 projects × (2 × 500 +
5 × 20) = **5,500 requests/day** (v1: 4,400, and only if keys 3-4 are separate projects).

## 2. Design

- **Slots.** Each key × model is a slot with its own limits. Slot ids: bare model name for `GROQ_API_KEY` (keeps the
  v1 counters), `groq<n>:<model>`, `gem<n>:<model>`.
- **Shared ledger in Postgres** (all instances): `agent_budget_take(…, p_day, p_day_cap, p_user, p_user_tpm,
  p_user_tpd)` atomically checks RPM/TPM (UTC minute) + RPD/TPD (the provider's own quota day) + a per-learner share;
  `agent_budget_adjust(…, p_req)` corrects to real usage (Groq cached tokens excluded) and gives back requests the
  provider never served; `llm_slot_report` keeps 429 cooldowns (retry-after aware; daily-quota 429 → 15 min),
  circuit breaker (3 consecutive errors → 30 s, doubling to 5 min), rolling latency and error EWMA, token totals;
  `llm_pool_state` returns everything for the router in one round trip (cached 1.5 s per instance);
  `llm_pool_counters` holds today's ladder counters and tokens saved. DB unreachable → in-instance fallback.
  An invalid/revoked key cools down every model on that key at once.
- **Routing:** score = quality(purpose, model) × headroom × speed × (1 − error rate). Purposes: chat (qwen ≈
  gpt-oss-120b > Gemini flash > lite > gpt-oss-20b), director, light (gpt-oss-20b, lite first), json, lesson (Gemini
  only, 3.8 flash first; `preferFast` puts lite first), vision (Gemini lite), builtin (gpt-oss only).
- **Priority classes** (from the call or `withLlmContext`): **live** (inside a lesson: tutor steps, in-lesson Ask,
  lesson opening, onboarding/diagnostic/mastery questions) > **ask** (Ask tab; the next 4 beats of a lesson) >
  **background** (drafting further ahead, Director, chat summaries, Manim code, critiques; evals run as ask unless
  wrapped). Live may use 100 % of a slot's day, Ask 90 %.
- **Reserve:** in each lane (tutor chat, lesson content) the 2 healthy slots with the most headroom are reserved:
  background never uses them; Ask only while they are under half full this minute.
- **Pacing:** background may use at most 60 % of a slot's day and only the elapsed share of the provider's day + 20 %
  (Groq: UTC day, Gemini: Pacific day), so evenings are not starved by morning drafting.
- **Degradation ladder** (learner traffic): preferred models → trimmed request (last 3 messages + one-line note of
  older turns, old tool results cut, max_tokens × 0.6) → lighter models → `AllModelsBusyError` with `retryAfterMs`
  → Ask shows the calm **BusyRetry** card (question kept, quiet fill bar, auto-retries once, "Try now" always) — never
  a dead end. Background is shed first: `PoolDeferredError` → `GeminiQuotaError` (drafting pauses and resumes via
  the existing tick) or `AllModelsBusyError` (Director uses its rule-based fallback).
- **Fast failover:** live/ask attempts get 14 s (Groq) / 22 s (Gemini) to the first token, then the next slot;
  once tokens stream the call may run on (90 s cap). Text already streamed is never re-answered.
- **Fair share:** per learner 30K tokens/minute on any slot and 150K Groq tokens/day (background: half), keyed
  by learner id (`u:<id>`, `g:<id>`).
- **HARD RULE kept:** nothing caches generated content. Only provider-side prompt caching of the static
  instruction prefix (the Ask system prompt is now sent alone, before the learner's context); history compaction
  only reshapes one learner's own chat; all per-learner counters are keyed by learner id.

## 3. Load test (mocked providers enforcing the real limits, virtual clock)

`node scripts/llm-pool-loadtest.mjs <learners> <minutes> <after|before>` — 30 virtual minutes from 14:00 WAT, fresh
day, per learner-minute: 0.3 live lesson calls, 0.6 Ask chat steps, 0.5 next-beat drafts (Ask class), 0.6 drafting-ahead
beats + 0.08 Director + 0.05 critiques (background). Faults: one Gemini key 503s 10 %, qwen times out 20 %, Groq org 1
fully rate-limited for 3 minutes mid-run. "before" = the v1 key set (1 Groq, 4 Gemini) with no reserve/pacing,
routed by the new router (the real v1 had no shared Gemini budget either, so it did worse than this).
Raw output: `docs/llm-pool/loadtest-results.txt`.

| Learners at once | after: live ok | after: Ask ok (busy) | after: Ask trimmed/lighter | after: background done / deferred | reserve held (min) | before: live ok | before: Ask ok |
|---|---|---|---|---|---|---|---|
| 20 | 184/184 | 727/727 (0) | 0 / 0 | 477 / 35 | 2 | 203/203 | 765/765 |
| 40 | 433/433 | 1458/1458 (0) | 303 / 275 | 651 / 289 | 2 | 389/389 | 1465/1465 |
| 60 | 655/655 | 2192/2192 (0) | 705 / 670 | 625 / 811 | 2 | 616/647 (31 busy) | 2004/2156 (152 busy) |
| 80 | 833/833 | 2861/2888 (27) | 1098 / 1058 | 639 / 1352 | 0 (18 of 360 ticks) | 638/832 (194 busy) | 2174/3013 (839 busy) |
| 100 | 1045/1082 (37) | 3486/3709 (223) | 1439 / 1410 | 601 / 2369 | 0 | — | — |

Background never ran on a reserved slot in any run (`bgOnReserved` 0).

**Sustained concurrent learners (peak minute, no learner-facing failure):** before ≈ 40, after ≈ 60 (80 with live
lessons still at 100 % and 1 % of Ask turns showing the retry card). **Per day** (the binding limit on free tiers,
workload above ≈ 84 Gemini requests + ≈ 44 chat/Director steps ≈ 128K tokens per active learner-hour, chat spilling
to Gemini once Groq's daily tokens are used): before ≈ 36 learner-hours/day, after ≈ 46 learner-hours/day (the 15 %
token saving adds ≈ 1 more), i.e. a 2-hour evening peak of ~20-23 learners. Gemini requests (5,500/day) are the
binding limit; drafting ahead is what gets deferred first.

## 4. Token savings (measured on the real Ask prompt, 10-message history)

- Input per Ask step: 6,724 → 5,747 tokens (−15 %): history beyond the last 4 messages folded into a short note.
- Trimmed rung: 5,424 input tokens and 600 max_tokens (was 1,000).
- Static prefix now sent first and alone: system 1,110 + routed tools 3,630 = 4,740 tokens eligible for Groq prompt
  caching on gpt-oss (cached tokens do not count against Groq limits). The hit rate is measured live
  (`saved_cached_tokens` on the dashboard); whether Groq places a second system message before the tool block is
  not documented, so the cache benefit is an expectation until the counter shows it.
- Output caps per purpose (chat/director 1,200, light 700, json 6,000); light/classification on gpt-oss-20b / lite.
- Not done (recommendation): sending the full, fixed tool list to gpt-oss would make the whole 7K prefix cacheable
  every turn, but it changes tool selection, which the routing evals were tuned on.

## 5. Risks and open items

- Gemini quotas are **per project**: if keys 3/4/5 share a project with another key, real capacity is lower than
  the pool assumes (the pool then sees 429s and cools those slots down; the dashboard shows it).
- Groq's daily window may be rolling rather than UTC-midnight; the pool may retry a model at 00:00 UTC and get a
  daily 429, which cools it for 15 minutes.
- Gemini flash RPD (20) makes flash nearly irrelevant to capacity; lesson quality on busy days is flash-lite quality.
- `modal_app/gm_llm.py` (visual composer, owned by the Manim work) still reads only `GEMINI_API_KEY`…`_4` and calls
  Google directly, outside the shared ledger, so its calls are invisible to the pool. Recommendation: read any
  `GEMINI_API_KEY_n`, and before each call `POST {SUPABASE_URL}/rest/v1/rpc/agent_budget_take` with the same slot id
  (`gem<n>:<model>`), `p_day` = Pacific date, `p_day_cap` ≈ 0.4 (background), then `llm_slot_report` on 429/5xx.
- Eval runs are not marked background (the eval route was left alone to avoid conflicts with the correctness work).

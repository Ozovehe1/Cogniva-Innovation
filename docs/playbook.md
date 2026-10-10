# Teaching Playbook: learning without retraining

Ideanimo's tutor gets better from real lessons without changing any model weights. Evidence from lessons is
distilled into short, itemised **teaching rules** ("bullets"). A rule goes live only after a batch check shows lessons
written with it are no worse than lessons written without it. The writers then retrieve the rules that fit each prompt.

It draws on four papers:

| Idea | Paper | Where it lives here |
| --- | --- | --- |
| Generator → **reflector** → **curator**; itemised bullets with helpful/harmful counters; incremental delta merges; grow-and-refine (dedupe + caps) so the context never collapses into a vague summary | ACE, *Agentic Context Engineering*, arXiv 2510.04618 (ICLR 2026) | `reflector.ts`, `curator.ts`, `store.ts` |
| Memory of corrections, retrieved by similarity to the new input | MemPrompt, arXiv 2201.06009 | `retrieve.ts`, `learner-notes.ts` |
| Strategies from successes, preventative lessons from failures | ReasoningBank, arXiv 2509.25140 | bullet `kind`: `strategy` / `avoid`; `success` signals |
| Batch-clustered failures → shared notes, **committed only when batch performance does not get worse** | Mistake Notebook Learning, arXiv 2512.11485 | `gate.ts` |

Code: `src/lib/playbook/`. Tables: migration `supabase/migrations/20261019090000_playbook.sql`.

## 1. The loop

```
signals in ──► reflector (cheap model) ──► delta ops ──► curator (deterministic) ──► candidate
   ▲                                                                                  │
   │                                                                           gate (batch: with vs without)
   │                                                                                  │ pass
   └── lessons / Ask / diagrams / pictures / animations ◄── retrieval (top-k) ◄─── live bullet
```

The background job runs every 20 minutes (`playbook-tick` in pg_cron calls `GET /api/playbook/tick` with Bearer
`AGENT_SECRET`). If nothing new has arrived, it makes no model call. Each run:

1. **Harvest** (`signals.ts`). Scans the app's own tables since a watermark (`playbook_state.harvest`) and writes
   `playbook_signals` rows, plus that learner's own private teaching notes.
2. **Credit** (`tick.ts`). A strong lesson adds 1 to `helpful` on every bullet that was injected into it, using
   `playbook_usage`. This is deterministic: no model judges its own work.
3. **Reflect** (`reflector.ts`). Takes up to 12 new signals per target, strongest external evidence first. A cheap model
   (`light` chain, background priority) turns them into at most 4 `add` ops. It can also tag `helpful` / `harmful` on
   bullets that were in use. Successes on their own wait until there are at least 3.
4. **Curate** (`curator.ts`). Runs with no model call:
   - privacy check (hard rule, §4)
   - embedding (gte-small)
   - near-duplicate test (same target, cosine ≥ 0.92 or the same text): merge (evidence + 1)
   - otherwise insert as a **candidate**
   - size caps: per target+topic ≤ 8 live and ≤ 12 candidates; per target ≤ 150 live. The lowest
     `helpful + 0.5·evidence − 1.5·harmful` go first.
   - a live bullet with `harmful ≥ 3` and `harmful > helpful` is retired automatically.
   Bullets are never rewritten wholesale, so nothing learned is lost to a summarising rewrite.
5. **Gate** (`gate.ts`). Up to 2 candidates per run (see §3).

## 2. Signals: what counts as evidence

All signals are external evidence. The writers' self-critique is never used on its own.

| Source | From | Target |
| --- | --- | --- |
| `report` | `mistake_reports` confirmed in `/admin/reports`. Staff triage note and guard re-check are used; the learner's note and question are **not** | by surface: lesson / ask / diagram / illustration / manim |
| `guard` | correctness-guard catches while writing. `noteGuardCatches()` hook in `generateSteps` (lessons) and in the chat route (maths fixes, held visuals) | lesson / ask |
| `clip` | `manim_jobs.verdict.ok === false` (scene verifier) | manim |
| `outcome` | `lesson_progress.events`: checks missed on the first try (≥ 2, or 1 of ≤ 3) | lesson |
| `reexplain` | `differently` / `again` / `explain_wrong` responses | lesson |
| `confusion` | `learner_checkins` during a lesson with mood or confidence ≤ 2 | lesson |
| `success` | ≥ 3 checks answered, ≥ 80 % right first time, no re-teach | lesson (strategies + helpful credit) |

**Adding a signal:**
- **From a table:** add a block to `harvest()`. Read rows since a new watermark key and build `SignalRow`s:
  - `source`, `target`
  - an abstract `payload` (what went wrong or right, issue kinds, step type; never learner-typed text)
  - `student_id` and `lesson_id` when it came from a learner's lesson
  - a stable `dedupe_key`
  Optionally write that learner's `TeachingNote`s too.
- **From code at the moment it happens:** call `recordSignals(admin, [...])`, or `noteGuardCatches(issues, target)`
  (fire-and-forget; it reads lesson and learner from the playbook context).

Adding a new `source` value also needs the `check` constraint in a migration and a label in `/admin/playbook`.

## 3. The gate (Mistake-Notebook batch gate)

A candidate goes live only if the relevant checks do not get worse. Stages, where the first failure decides:

1. **privacy**: the hard rule again → `rejected`.
2. **lint**: known-harmful teaching patterns → `rejected`. The patterns are:
   - saying the answer before the learner tries
   - skipping checks or retrieval practice
   - text instead of visuals
   - timers or threatening feedback
   - wrong hypotenuse or unequal-axes conventions
   - exam boards
   - sharing content across learners

   Negated rules ("never state the answer before…") pass.
3. **batch**: for each probe topic (up to 2, abstract curriculum topics the reflector names), write one output
   **without** the bullet and one **with** it. The live playbook for the target is in both. Each output gets a score:

   | Target | Output written | Score |
   | --- | --- | --- |
   | `lesson` | 8–14 board steps with a check | guard issues (`correctness/steps.ts`), +2 if no step is valid. Schema slips are noted, not scored: the real writer repairs them |
   | `ask` | a tutor reply | wrong numeric claims (`claims.ts`) |
   | `diagram`, `manim` | a numbered plan | judge only |

   In every case, add +1 if a judge answers YES to the bullet's own `check` question.
   - **with > without** → not live. It stays a candidate after the first fail. It is rejected after a second fail, or if
     it is worse by 2 or more.
   - Any arm unavailable (models busy) → `inconclusive`, retried by a later run (at most 4 attempts).
4. **regression**:
   - `ask` bullets: the hint-first giveaway case must still hint, with the bullet in the system prompt.
   - `illustration` bullets: the seed illustration queries' top picks, with the hints applied, must still match.

Pass → `live`. Every step is logged in `playbook_events`. Admins can override in `/admin/playbook`. Approving is
recorded with the admin's email and still privacy-checked.

## 4. Two layers: privacy (HARD RULE)

| | Global playbook | Per-learner memory |
| --- | --- | --- |
| Table | `playbook_bullets` (server-only, RLS on, no policies) | `learner_memory`, kind `teaching_note` (owner-only RLS, cascades on account delete) |
| Holds | abstract teaching rules only | "what confused / what helped this learner" |
| Read by | every learner's writers | only that learner's lessons and tutor turns. The student id comes from the session or the lesson owner, never from model arguments |
| Written by | reflector → curator → gate | deterministic notes in `harvest()` |

How learner data is kept out of the global playbook:

1. **At signal time** (`recordSignals`):
   - learner-written fields are dropped: note, question, query, answer(s), message, transcript, name, email, phone, ids, age, school, goal/why text…
   - emails, phone numbers, ids and links are redacted
   - **the learner's own name and email (from `profiles`) are replaced with `[learner]` everywhere**, including inside
     tutor narration ("Well done, Ada!")
   - strings are cut to 300 characters
2. **At reflection time**: the reflector reads only `{source, target, subject, topic, skill, scrubbed payload}`. It never
   sees `student_id`, `lesson_id` or `session_id`, and its prompt orders abstract rules only.
3. **At curation time**: `privacyCheck()` runs on every proposed bullet (text, check, probes, hints, tags). It looks for:
   - email, phone, id, link
   - personal framing ("this learner", "the student said", "my teacher", "Mrs X", "14-year-old")
   - long quotations
   - any of the batch's learner names or emails (`forbidden`, checked but never sent to the model)
   - any 5-word run copied from a forbidden passage

   Any hit withholds the bullet. Only the problem list is logged, never the text.
4. **At the gate and on admin edits**: the same check again.
5. **Evals**: `playbook` group cases b1–b4 (§6).

Personalisation rule (unchanged): generated lesson content is never shown to or reused for another learner. The global
playbook holds rules about how to teach, not content.

## 5. Retrieval: where rules are injected

`playbookBlock(target, fallbackText, ctx)` in `retrieve.ts`:
- **Scoring:** live bullets for the target, scored by cosine similarity (gte-small) + topic-word match (word stems: two
  shared, or half of the shorter topic) + skill match + counters.
- **Relevance thresholds:** a bullet is injected when it is
  - topic-matched with sim ≥ 0.75
  - general (topic "") with sim ≥ 0.68, i.e. general bullets are ranked, not filtered
  - otherwise only at sim ≥ 0.845

  Calibrated on gte-small on 2026-10-09: a topic rule scored 0.85–0.88 against related topics, up to 0.82 against
  unrelated topics in the same subject, and 0.73–0.78 against other subjects. A general rule scored a flat 0.72–0.74
  against everything.
- **Learner notes:** when the context names a learner (or the lesson's owner), adds up to 3 of their private notes.
- **Caching:** 10 minutes per target + lesson/session.
- **Fast path:** skips the embedding entirely when there are no live bullets and the learner has no notes, so the
  opening beat is never delayed.
- **Embedding timeout** is 1.5 s; when it fails, topic words alone decide.
- **Usage:** every injection is recorded in `playbook_usage`, which feeds the helpful/harmful credit.

| Consumer | Hook |
| --- | --- |
| Lesson writer (every `generateSteps` call: beats, sections, re-teach) | `lesson-ai.ts` appends `playbookBlock('lesson', prompt)` next to the confirmed "avoid" lines. The lesson comes from `withPlaybook({ lessonId })` around `runDraftWork` and `/api/tutor/step` |
| Ask tutor + `math_diagram` / `interactive` (chat tools) | chat route: `playbookBlock(['ask', 'diagram'], …, { lessonId, sessionId, studentId, topic })` in the system prompt |
| Illustration ranking | `find.ts`: `applyIllustrationHints(hits, await illustrationHints(topic))`. A nudge: the vision check still decides |
| Manim planner | `dispatchCompose()` appends `manimContext()` to `context`. `modal_app/gm_compose.py` already puts `context[:1500]` into `PLAN_PROMPT` |

**Recommendation for `gm_scenegen` (manim-finish branch, not touched here):** read the same `context` field it receives
from `/compose` and put it into its planner prompt verbatim under "Teaching playbook". No other change is needed; the
rules arrive as `- …` lines after the lesson line.

## 6. Evals: the `playbook` group

```
POST /api/agent/eval?group=playbook&student=<test profile>     (Bearer AGENT_SECRET)
     &only=static|lifecycle|privacy|gate                        (subsets; the full group takes ~2-3 min)
GROUPS=playbook AGENT_SECRET=… node scripts/agent-eval.mjs
```

Everything it writes is scope `eval` (never retrieved for learners) and is deleted at the end.

- **static** (no model): privacy catches and allows, scrub + name redaction, lint rejects and allows, dedupe, caps,
  topic retrieval scoring.
- **lifecycle (a):**
  1. a seeded guard catch (right triangle labelled 3-4-6, hypotenuse label on a leg)
  2. reflector bullet
  3. curator candidate
  4. gate on a similar topic ("missing side of a right-angled triangle"): live
  5. retrieved for that topic and not for "the water cycle"
  6. the lesson written with it has no Pythagoras fault (baseline reported alongside)
- **privacy (b):**
  - b1: the reflector prompt for a PII-laden report has no name, email, phone, note or answer
  - b2: stored global bullets pass `privacyCheck` with the learner terms as `forbidden`
  - b3: the curator rejects PII bullets
  - b4: a teaching note is seen by its learner only, never by another learner or the global table
- **gate (c):**
  - c1: a harmful bullet ("state the answer before the check") is rejected by lint
  - c2: a subtler one that bypasses lint ("read out the correct option before the check") is caught by the batch
  - c3: a bullet asking for an email is rejected by privacy

## 7. Admin

`/admin/playbook` (signed-in email in `ADMIN_EMAILS`) shows:
- bullets by status (live / candidate / rejected / retired) and target
- each bullet's counters, gate verdict (probe table without vs with), history and evidence ids
- signal counts and the last harvest time

Actions go through `POST /api/admin/playbook/:id`:
- approve, retire, reject, restore
- run the gate now
- reword: privacy- and lint-checked; the bullet goes back to candidate

## 8. Operations

- Check a run by hand: `curl -H "Authorization: Bearer $AGENT_SECRET" https://cogniva-innovation.vercel.app/api/playbook/tick`.
- Turn the loop off: `select cron.unschedule('playbook-tick');`. Live bullets keep being injected; retire them in
  admin to remove them.
- Model use per run: at most 3 reflector calls plus at most 2 gates (each about 2–4 generations + 2–4 judge calls),
  all at background priority on the free pool.

# Correctness: guard, "Report a mistake", regression set

GeniusMap must always teach correctly: text, maths, pictures, diagrams, live figures and animations. Three parts work
together:

1. **The guard** checks output before a learner sees it (deterministic first, a model second).
2. **"Report a mistake"** lets a learner flag anything that slipped through; it is hidden for them at once and they get a
   corrected version. Staff triage reports at `/admin/reports`.
3. **The regression set** (`regression` eval group) replays every mistake we have made, so it is never made again.

Personalisation rule: learning content is per learner and is never shown to another learner. Reports stay with the
learner who sent them; regression cases are anonymised (ids, names, storage paths and the learner's note removed) and
only ever run in evals.

## 1. The guard (`src/lib/correctness/`)

| Output | Where it runs | What it checks | On a fault |
| --- | --- | --- | --- |
| Tutor text, Ask answers | `chat.ts` `textGate` (chat route), `steps.ts` (lessons) | Numeric claims (`claims.ts`): arithmetic chains `23.5 × 17.2 = 404.2`, TeX (`\frac`, `\sqrt`, powers, `°`), `15% of 240 is 36`, and solutions (`x = 6` checked against `3x + 5 = 20` in the same text). Deliberately wrong statements ("a common mistake is…", questions) are skipped. | Corrected in place when the fix is unambiguous (streamed text is held to the end of each sentence); a "Checked with exact maths" chip shows the check. Lessons: unfixable claims go into the generator's one repair pass. |
| Lesson steps (every generated section, re-teach, worked example) | `lesson-ai.ts` `generateSteps` → `guardSteps` | Maths in narration/board text/TeX; **answer leaks** (a check's answer said in its narration, its prompt, or the step before it about the same problem); **Pythagoras** labels (a² + b² = c², labels ordered like the drawn sides); **refraction** (refracted ray crosses the boundary, is on the other side of the normal, bends towards the normal into glass/water and away from it out of them; Snell's law when n and θ are written); **vector sums** (resultant = head-to-tail or parallelogram sum); **circles on axes** with unequal units; **Venn counts** against the stated problem ("20 football, 15 chess, 6 both" → 14 / 6 / 9). | Fixable faults fixed (leaking sentence removed, axes ranges evened); the rest regenerated once with the issues listed. |
| Ask visuals (board, figures, sims) | chat route `emitChecked` → `guardBlock` | Same step checks, with the learner's message as the problem. | A wrong board is **not shown**; the model gets `correctness_issues` in the tool result and redraws (`run.ts`). |
| Illustrations | `illustrations/find.ts` → `illustration.ts` | Blocklisted ids dropped; weak topics re-ranked (`WEAK_TOPICS`: atom → Bohr/shell model, circuit, cell, lever, heart, refraction, magnet); title/tags must name the topic; a **vision check** (`visionJson` in `llm.ts`) on the rendered picture vs the query, cached per item+topic in `illustration_verdicts`. | Next candidate; when none passes, the caller draws a diagram instead. |
| Animations | `/api/manim/callback`, `/api/agent/clip/:id` (`clip.ts`) | The scene engine's deterministic verifier verdict (`verdict: { ok, failed: [...] }` in the render callback, stored in `manim_jobs.verdict`). | `ok === false` → the clip is marked failed and never shown or placed in a lesson. |
| Writers' prompts | `blocklist.ts` `avoidLines` | Confirmed "avoid" lines (admin triage) | Appended to lesson and chat prompts. |

## 2. Report a mistake

- UI: `src/components/report/report-mistake.tsx` (`ReportButton`, `ReportSheet`, `FlaggedNotice`). Placed under each Ask
  answer and each visual in it (board, picture, simulation, figure, animation, Python figure, practice set), in the lesson
  header (reports what is on the board now; "Wrong picture" targets the last picture), and under every mastery-check
  question and result.
- API: `POST /api/reports` stores a `mistake_reports` row with the exact artefact taken from where it lives (the chat
  message's block, the lesson step + the board around it, the clip job with its prompt and verdict), model and tool
  trace, lesson/step ids, and the guard's re-check. The artefact is flagged for that learner at once (chat block or
  message marked `flagged`; lesson pictures/figures/clips swapped for a placeholder now and on reload). The reply offers a
  corrected retry (Ask: a follow-up turn; lesson: the tutor fixes the board in place via `/api/tutor/step`).
- Triage: `/admin/reports` (signed-in email in `ADMIN_EMAILS`, comma-separated Vercel env; defaults to the owner). One
  click each: **Confirm** (feeds the blocklist: the picture for that topic, a failed clip spec, an optional "avoid" line),
  **Not a mistake** (lifts the learner's flag), **Add to regression set**.

## 3. The regression set

`POST /api/agent/eval?group=regression&student=<test profile>` (Bearer `AGENT_SECRET`), or
`GROUPS=regression AGENT_SECRET=… node scripts/agent-eval.mjs`. `only=seed` / `only=db` / `only=<case id>` narrow it.

- **Seed cases** (`src/lib/correctness/seeds.ts`): Pythagoras labels and text, Venn regions and membership, unit circle as
  ellipse (interactive still and board axes), atom illustration, refraction side and bend, vector endpoints, answer said
  before a check, arithmetic / solution / percent errors, hint-first giveaway (model turn), failed clip verdict.
- **Report cases** (table `regression_cases`): created by "Add to regression set". An illustration report asserts the
  same query never returns that picture again; any other report asserts that the guard flags the anonymised artefact
  (`recheck`). A promoted report the guard does not catch yet **fails** until a check is added: that is the to-do list.

### Adding a case

1. Reproduce the mistake as data: the steps, text, spec or query exactly as shown (a confirmed report already is one).
2. Add an entry to `SEED_CASES` in `src/lib/correctness/seeds.ts`:
   ```ts
   { id: 'seed-<short-name>', kind: 'steps', title: 'What went wrong, in words',
     input: { bad: [/* the faulty steps */], good: [/* the corrected steps */], problem: 'the stated problem, if values must match it' },
     expect: { issue: ['refraction'] } }
   ```
   Kinds: `text` (`expect.flags`, optional `fixedTo` substring), `steps` (`expect.issue` kinds; `fixed: true` if the guard
   must fix it itself; the `good` version must come back clean), `illustration` (`titleMatches`, `notMatches`,
   `notIds`), `interactive` (`round`), `diagram` (`unmet`), `giveaway` (`input.msg`, `input.answer` regex), `clip`
   (`blocked`).
3. If the guard does not catch it yet, add the check in `steps.ts` / `claims.ts` / `illustration.ts` (deterministic first).
4. Run the group; the case must pass and the good version must stay clean (no false positives).

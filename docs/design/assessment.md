# Assessment: fair, standard, aligned items (with figures only where needed)

Every question Ideanimo puts to a learner — the onboarding diagnostic, in-lesson checks (choice, short, explore), the
mastery check, prerequisite re-checks and practice sets in Ask — is written by a model and then **passes the item
validator** (`src/lib/assessment/`) before a learner sees it. This document is the standard the validator enforces,
the research behind it, the audit that motivated it, and how to extend it.

"Fair" here means, first, **alignment**: a test assesses exactly what the tutor taught this learner, in the same
notation, terms, methods, representations and diagram style — no untaught content, no tricks. Then: one defensible
key, no cues, low reading load, and conventions that follow the learner's own curriculum (from what they asked to
learn), not an assumed country.

## 1. Research summary

| Topic | What the evidence says | What we do |
| --- | --- | --- |
| MCQ item writing | Haladyna, Downing & Rodriguez (2002) validated 31 guidelines from 27 textbooks and 27 studies: test one important objective; no trick items; the stem holds the main idea and is worded positively; one correct answer; plausible distractors built from common errors; options homogeneous, similar in length, not overlapping; no "all/none of the above"; no grammatical or length cues; keep reading load low; balance the key position. ([Haladyna et al. 2002](https://doi.org/10.1207/S15324818AME1503_5); [summary](https://cpl.health.unm.edu/AssetListing/Writing-Questions-for-Learning-and-Assessment-2573/Rules-for-Multiple-Choice-Items-Haladyna-et-al-2002-5943)) | `ITEM_RULES` (spec.ts) tells writers each rule; `validate.ts` checks the ones a machine can: negative stems, all/none of the above, combined options, longest-key, a/an cue, clang, absolutes, parallel options, duplicates. |
| Number of options | A meta-analysis of 80 years of research: 3 options are optimal in most settings; moving from 4 to 3 options slightly increases discrimination and reliability when the dropped distractor was non-functional. ([Rodriguez 2005](https://doi.org/10.1111/j.1745-3992.2005.00006.x)) | 3-5 options allowed; 4 written by default, but an implausible fourth distractor is worse than none. Lesson checks may use 2-4. |
| Key position | Writers hide keys in the middle positions (up to 3-4:1 in single items); about 55 % of wrong answers on 4-choice tests fall in the middle; middle-key items are easier and less discriminating. ([Attali & Bar-Hillel 2003](https://doi.org/10.1111/j.1745-3984.2003.tb01099.x)) | Keys are re-positioned deterministically (`balanceKeys`, `balanceCheckKeys`); numeric options are sorted ascending. |
| Validity and alignment | An item is valid for an objective only if it elicits the knowledge/skill that objective names at the intended cognitive level (revised Bloom: remember, understand, apply, analyse). | Every item names its `objective` (the lesson's own aim/key idea) and `bloom`; `align.ts` blocks objectives, notation and terms the lesson never used. |
| Language load / fairness | Linguistically simplified maths items (shorter sentences, familiar words, maths terms unchanged) raised scores, most for English learners and students in lower-level classes: the language was measuring something other than maths. ([Abedi & Lord 2001](https://doi.org/10.1207/S15324818AME1403_2)) | Stem ≤ 35 words (block at 60), sentences ≤ 32 words, Flesch-Kincaid grade compared with the learner's level, contrived contexts banned, plain international English. |
| Locale and curriculum | Items should not depend on knowledge the test does not intend to measure (local currency, places, holidays, unit systems). | `curriculum.ts` infers the learner's system from **their own goal words first** (WAEC/NECO/JAMB, GCSE/IGCSE/A level, AP/SAT/ACT/Common Core, IB, CBSE/ICSE, KCSE, CSEC/CAPE, Matric, university, professional), then the lesson, then the profile (weak). SI unless the learner is on a US system; currency only if their goal/lesson used one; exam names only for their exam; foreign places flagged. |
| Difficulty calibration | The Elo rating system treats an answer as a match between learner and item; it estimates skill and difficulty on the fly, is simple and robust, and suits adaptive practice and low-stakes testing. ([Pelánek 2016](https://doi.org/10.1016/j.compedu.2016.03.017)) | `calibrate.ts`: logistic Elo with a guessing floor, uncertainty-decaying K; per-item and per-learner-topic ratings; the writer's 1-5 difficulty tag seeds new items and is pooled per subject × Bloom × tag (statistics only). |
| Adaptive stopping | Standard-error termination (SE ≈ 0.3, reliability ≈ 0.9) or change-in-θ rules give efficient, accurate variable-length CATs; very long tests give diminishing returns. ([Babcock & Weiss 2012](https://www.jcatpub.net/index.php/jcat/article/view/16)) | The diagnostic keeps its knowledge-space stopping rule (6-10 items, resolves the frontier); an SE rule would need calibrated items, which the Elo data now accumulate. |
| Feedback | Formative feedback should be non-evaluative, supportive, timely and specific; elaborated feedback (why, not just right/wrong) beats verification alone, especially after errors. ([Shute 2008](https://doi.org/10.3102/0034654307313795)) | Every item has a warm `explain` with the key step and why the most tempting distractor tempts; labels ("A Tech Power Problem:"), "obviously", "careless" are blocked. |
| Retrieval practice | Taking a test improves long-term retention more than restudying, even without feedback. ([Roediger & Karpicke 2006](https://doi.org/10.1111/j.1467-9280.2006.01693.x)) | Checks after each idea, mastery checks and spaced practice sets stay; they are framed as learning, not judgement. |
| Guessing / confidence | Certainty-based marking (1/2/3 marks if right, 0/−2/−6 if wrong) is a proper scoring rule: students cannot gain by misreporting confidence; it rewards reflection and makes scores more reliable. ([Gardner-Medwin, CBM](https://tmedwin.net/~ucgbarg/tea/TGM_LKL.pdf)) | The diagnostic already asks "Guessing / Fairly sure / Sure". Calibration weights a guessed correct answer as half evidence and a confident error more heavily. The learner never sees negative marks (formative). |
| Diagrams | Image descriptions should be brief, focus on the data, include every labelled value, and not interpret the concept the item asks about. ([DIAGRAM Center / NCAM guidelines](http://diagramcenter.org/table-of-contents-2.html); [NCAM: describing images for assessments](https://www.wgbh.org/foundation/services/ncam/tools-resources/guidelines-for-describing-images-for-assessments)) | Figures only when needed; alt text required (≥ 15 chars) naming what is drawn and each labelled value; "Not drawn to scale" whenever a geometry diagram is laid out by constraints and the stem gives numbers. |
| What others do | Khan Academy: skills move through Attempted → Familiar → Proficient → Mastered from exercises, quizzes and unit tests; mixed-skill quizzes level skills up or down ([Khan Academy help](https://support.khanacademy.org/hc/en-us/articles/5548760867853--How-do-Khan-Academy-s-Mastery-levels-work)). Duolingo English Test is computer-adaptive: difficulty changes with answers and length adapts ([DET](https://testcenter.zendesk.com/hc/en-us/articles/39104891663245-Test-Structure)). Brilliant leads with interactive problems (manipulate, then answer). | Our mastery gate (3 of 4), re-check of prerequisites after two misses, explore checks ("move the figure until…") and BKT/FSRS reviews follow the same shape; the new part is that every item is machine-verified and aligned to *this learner's* lesson. |

## 2. Audit of production items (2026-10-09)

Sampled every item stored in production: **304 bank items** (288 diagnostic from 40 paths, 12 mastery, 4 practice)
across Mathematics, Physics, Solar PV, Engineering Drawing, Neuroscience and Materials Science, plus **247 in-lesson
checks** from 60 lessons (149 choice, 81 short, 17 understand). The validator ran over all of them
(`/workspace/work/cogniva/assess/audit.cjs`); about 40 were also read by hand.

| Defect (blocking) | Count | Example |
| --- | --- | --- |
| **Key position bias** | diagnostic keys A 49 %, B 36 %, C 13 %, D 1.4 % (288); lesson checks B 56 % (149) | Guess "A" and score ~50 % on the diagnostic. |
| **Wrong key** | 1 | "Simplify $3x + 5 - x + 2$" keyed $4x + 7$ (it is $2x + 7$). |
| **Two correct options / equivalent options** | 10 (7 equivalent pairs, 3 second keys) | "Factorise completely $6x^2 + 9x$": $3x(2x+3)$ and $6x(x+1.5)$; "$\mu_0$": $4\pi \times 10^{-7}$ and $1.26 \times 10^{-6}$ T·m/A (same value). |
| Duplicate distractors | in the 7 above | "Factorise $5y - 15$": $y(5-15)$ and $5y(1-3)$ are both $-10y$. |
| **Length cue** (key clearly longest) | 20 | Neuroscience items whose key is a full mechanism, distractors 3-4 words ("The cell membrane dissolves completely"). |
| Implausible / joke distractors | ~12 of 40 read by hand | "The neuron enters a permanent refractory death state", "Magnetic field attraction" for diffusion. |
| Padded exact values | 8 | "$x = 5.00$", "$y = -3.80$" for exact answers (a "3 s.f." rule applied to exact maths). |
| Feedback that starts with a title | 6 (diagnostic) + mastery | "A Tech Power Problem: subtract 30…" |
| Contrived contexts / reading load | most mastery items read | "A coding loop execution variable $3k$ equals $90$ instructions per second." |
| Asks for a wrong answer (negative stem) | 1 | "…what incorrect value for $H$ would they calculate?" |
| "Both A and C" | 1 (lesson check) | SI units of $B$. |
| Mixed units in options | 1 | $\mu_0$ options in T·m/A, F/m, N·m²/kg² (the unit gives the answer away). |
| Untaught terms in lesson checks (approximate: only the 12 preceding steps were available to the audit) | 32 | "hydrophobic", "chloride", "gradient" in checks after a lesson that never said them. |
| Figures | **0 of 551** items had a figure; none needed one in this sample, and none referred to a missing one. |

Overall: 22 / 288 diagnostic, 6 / 12 mastery, 1 / 4 practice and 39 / 149 lesson choice checks now fail at least one
blocking rule, before counting the key-position bias that affected whole banks.

## 3. Alignment (what "fair" means first)

`align.ts` builds **what was taught** from the lesson itself: narration, board text, maths, check prompts, figure
titles and labels (`taughtFromSteps`), or the lesson digest the mastery writer gets (`taughtFromText` +
`objectivesFromDigest`). An item then must:

1. **Measure a taught objective** — its `objective` overlaps a lesson aim/key idea (or ≥ 60 % of its content words
   appear in the lesson); otherwise blocked (`objective-not-taught`).
2. **Use the lesson's notation** — every quantity symbol (Greek letters as `\mu` or `μ`, `\sum`, `\int`, …) must occur
   in the lesson (`untaught-notation`). New numbers and new contexts are encouraged; new symbols are not.
3. **Use the lesson's words** — three or more technical words (7+ letters, not everyday/question words) the lesson
   never used block the item; one or two are warnings (`untaught-terms`). This also catches distractors made of
   unfamiliar jargon, a cue in itself.
4. **Use the lesson's kind of picture** — a graph item after a lesson with graphs/live figures, a diagram after
   diagrams (warning when it differs).

Writers are told the same thing up front (mastery: the lesson digest with "base EVERY question on what these lessons
actually covered"; practice: the digest; lesson checks: `CHECK_ITEM_RULES`, validated against the steps before
each check). The diagnostic has nothing taught yet, so its items are judged on the curriculum and level instead.

## 4. Curriculum and locale

`inferCurriculum({ goal, taught, profile })`:

1. **The learner's own words** — goal, goal text, subject: an exam/syllabus they name (WAEC, GCSE, AP Calc, IB HL,
   CBSE, KCSE, 200L…) or a class name (SS2, Year 10, Class 10, Form 3, Grade 11).
2. **The lesson** — an exam named in what the tutor taught.
3. **The profile** — school system / level, a weak fallback only.

The result sets prompt lines (`curriculumLines`) and the fairness checks: SI units unless the learner is on a US system
(and imperial only where the lesson used it); money only in the currency their goal or lesson used, else avoided;
exam names only for their exam; local places flagged; plain international English; contexts familiar anywhere or from
the learner's own interests and lesson. Nothing is assumed from nationality.

## 5. Item spec

```ts
interface AssessItem {
  q: string; options: string[]; answer: number; explain: string   // as before (DiagItem)
  calc?: string | null            // arithmetic for the key's value (numeric items)
  calcs?: (string | null)[]       // per option: arithmetic for the value each numeric distractor states
  why?: (string | null)[]         // per option: the misconception (null for the key)
  objective?: string              // the taught objective, in the lesson's words
  bloom?: 'remember' | 'understand' | 'apply' | 'analyse'
  difficulty?: 1 | 2 | 3 | 4 | 5  // writer's estimate; seeds Elo
  elo?: number                    // calibrated difficulty
  figure?: ItemFigure             // only when needed (§7)
  verified?: true                 // set by the validator
}
```

Writers get `ITEM_RULES` + `QUESTION_RULES` (maths formatting, numeric verification) + `curriculumLines(...)`.

## 6. The validator (`validate.ts`)

| Group | Checks (blocking unless noted) |
| --- | --- |
| Accuracy | Base gate (question-quality.ts: KaTeX-valid maths, distinct options, numeric key from `calc`, options not too close); **algebraic equivalence** of options by evaluation at 5 points; for *factorise / expand / simplify* stems the key equals the stem's expression and is fully factorised, no other option is a complete equal form; for *solve* stems the key's values satisfy the equation and no distractor's do; each `calcs` value matches the distractor it explains; the **correctness guard's claim checker** (`correctness/claims.ts` `checkText`) on the stem and explanation (arithmetic and percent claims). |
| Cues | all/none of the above, "both A and C"; NOT/EXCEPT or asking for a wrong answer; key clearly longest; a/an agreeing only with the key; clang (warn); absolutes only in distractors (warn); key position balanced across a set. |
| Form | parallel options (numbers vs words, "x = 4" vs "4"); one unit across numeric options; no padded exact values; 3-5 options; long options (warn). |
| Reading | stem > 60 words or a sentence > 32 words; reading grade far above the learner's (warn). |
| Feedback | explanation present, written as a sentence (no "Title:"), no shaming words. |
| Fairness | §4. |
| Alignment | §3. |
| Figures | §7. |

`gateItems` (write.ts) runs it over a batch, drops an unneeded figure (the item becomes text-only) instead of losing
the item, draws needed figures, and re-asks the writer once with the problems listed. `finishSet` removes duplicate
stems and balances keys. Lesson checks: `checkStepIssues` feeds the lesson writer's existing repair pass (alongside the
correctness guard's issues) and `balanceCheckKeys` spreads choice keys.

## 7. Figures: only where needed

**Rule.** An item gets a figure only if the stem refers to it ("In the diagram…", "The graph shows…") **or** the skill
is visual (geometry, graphs/gradients, vectors, Venn/sets, data/charts, circuits, ray diagrams, forces, biology
structures, apparatus, maps). Otherwise it is text-only. A figure the stem never uses is blocked
(`figure-unneeded` / `figure-unreferenced`); a stem that refers to a figure that is not attached is blocked
(`figure-missing`).

**Kinds** (all rendered once on the server, stored with the item, shown identically in the diagnostic, mastery check,
practice set and re-check by `ItemFigure`):

| kind | source | accuracy checks |
| --- | --- | --- |
| `graph` | JSON spec (functions, points, segments) → `interactiveSvg` | spec validates (`validateInteractive`); every point the stem names exists; every coordinate the stem states lies on a drawn point or curve; points inside the axes. |
| `diagram` | Penrose Substance (`math_diagram` libraries: sets, geometry, graph, vectors) → `renderMathDiagram` | program validates (`checkSubstance`); every name the stem uses is declared; **all layout constraints met** (`unmet === 0`); geometry with numbers is marked *Not drawn to scale*. |
| `illustration` | credited library picture via `findIllustration` | the correctness guard's title/blocklist/vision checks; a question naming a labelled part needs a labelled picture; letter-labelled questions must use a diagram. |
| `explore` (lesson checks) | live JSXGraph figure in the check card | `validateInteractive`; goal readout exists; the prompt states the goal value. |

**Phone legibility.** Text in item figures is at least 20 viewBox units in a 640-wide figure (≈ 11 px at 360-390 px);
figures are full width, capped at 52 vh, with alt text (`role="img"`), credit and the scale note in a caption.

## 8. Calibration

`calibrate.ts`: `P(correct) = g + (1 − g) / (1 + e^{−(θ − d)})` with `g = 1/k` for k options; `θ += K(r − P)`,
`d −= K(r − P)`, `K = a / (1 + b·n)`; confidence-weighted evidence. Mastery submissions update each item's `elo` and the
learner's topic rating (`path_topics.mastery.elo`). Because items are personal (never shared between learners), item
ratings move only with their own learner; across learners only the **writer's difficulty tag** is calibrated (subject ×
Bloom × tag → logit offset) in `assessment_calibration` (migration `20261020091000`, statistics only, service role).
`pickByTarget` selects practice items near 75 % expected success.

## 9. Learner-facing language

Warm and specific: the check card's growth framing (docs/design/lesson-ui.md §7) stays; explanations name the key
step; a wrong answer leads to "Show me another way". No timers, no negative marks; confidence is asked, never scored
against the learner.

## 10. The `assessment` eval group

`POST /api/agent/eval?group=assessment&student=<test profile>` (`only=static|render|live|<case id>`):

- **static** (43 cases): key correctness (wrong key, solve substitution, two keys, equivalent options, incomplete
  factorisations allowed, same value in two forms, distractor values), guard on explanations, cues (all of the above,
  NOT, asking for a wrong value, longest key, a/an), form (padded exact, mixed labels, mixed units), feedback (title,
  shaming), reading load, fairness (imperial units outside US systems / allowed for AP, currency only when the
  learner's own, exam names, curriculum from goal > lesson > profile across 8 systems), alignment (aligned passes;
  untaught notation, terms, objective blocked), figure need (unneeded, missing, rule), figure accuracy (graph OK,
  stated point not drawn, diagram label missing), key balance, lesson checks (combined option, inconsistent accepted
  answers).
- **render**: graph item renders phone-legible SVG; Penrose diagram renders with every constraint met; library
  illustration found, vetted and credited; the gate turns an unneeded-figure item into a text-only item.
- **live**: the mastery writer on a solenoid lesson digest: every item verified, aligned (objectives present, nothing
  untaught), keys spread, figures drawn when present.

## 11. Extending

Add a rule: write the check in `validate.ts` (deterministic first), add a `blocks(...)` and a `clean(...)` case in
`eval.ts`, run the audit script against production items to see its false-positive rate, then the group.

# Onboarding v2 — design spec and evidence

Scope: `/start` (intake → adaptive check → results → first lesson) and the deferred micro-questions at the end of
lessons. Code: `src/lib/intake.ts` (items, screens, micro-questions), `src/components/intake-flow.tsx` (UI),
`src/components/micro-question.tsx`, `src/lib/onboarding-signals.ts` (stealth assessment), `src/app/api/intake/micro`.
Visual rules follow `docs/design/lesson-ui.md` (tokens, ≥44px targets, one primary action, thumb zone, skeletons,
reduced motion).

## 1. Old vs new

| | v1 (before) | v2 (now) |
|---|---|---|
| Explicit screens before the check | 17–18 (status, age, [consent], level, system, goal, goal pick, last studied, why, purpose, deadline, hours, efficacy, orientation, mood/energy, anxiety ×3 (STEM), worked-vs-try, interests, barriers) + a "now a short check" interstitial | **4** (goal · age+class · goal pick+familiarity · optional what-for/when), **5** for under-18s (guardian consent) |
| Free-text boxes | 3 (goal, why, barriers) | 1 (goal) |
| Check length | 8–15 items | 6–10 items, first item an easy foundation ("first win") |
| Dead time | "Mapping the skills" wait after the last question (~35 s measured in prod) | the map builds **while** the learner answers the optional last screen |
| Measured end to end, scripted taps at 390px (so pure system time + minimal tap time) | 18 screens in 40 s, then a 75 s map wait: question 1 at 115 s, results at 126 s | question 1 at 21 s / 65 s, “Start your first lesson” ready at 40 s / 83 s, lesson open at 45 s / 89 s (two runs; the spread is LLM latency) |
| Estimated human time to first lesson | ~5–7 min (17 questions × ~20–30 s, plus waits) | ~1.5–2.5 min |

Nothing downstream lost a field: every v1 answer still loads, validates and maps (`legacy: true` items), and every
consumer has a default when a field is empty (see §4).

## 2. What the research says (and what we did with it)

**Every question costs completion.** SurveyMonkey's analysis of ~100k surveys: the sharpest per-question drop-off
is in the first 15 questions; abandonment rises once a survey passes 7–8 minutes; respondents speed up and
"satisfice" as surveys get longer, lowering data quality
([SurveyMonkey, completion vs length](https://www.surveymonkey.com/curiosity/survey_questions_and_completion_rates),
[completion times](https://www.surveymonkey.com/curiosity/survey_completion_times/)). Across 25,080 real web surveys,
completion falls with length and difficulty, and the first question's type matters
([Liu & Wronski 2018](https://journals.sagepub.com/doi/10.1177/0894439317695581)). Surveys opening with an open text
box complete less often than ones opening with a tap (83% vs 89%)
([SurveyMonkey tips](https://www.surveymonkey.com/learn/survey-best-practices/tips-increasing-survey-completion-rates)).
→ 4 screens; the goal box comes with tappable starter chips; the rest are taps.

**Time-to-value beats up-front profiling.** Duolingo lets people finish a lesson before asking them to commit;
moving sign-up later produced ~20% more daily actives (Gina Gotthilf, quoted in
[How They Grow](https://www.howtheygrow.co/p/how-duolingo-grows)). Brilliant places learners with a "lightweight
diagnostic" and then keeps placing from their work, rather than asking families to pick a level
([Brilliant help](https://brilliant.org/help/parents-and-families/course-placement-guide/)).
→ The first lesson is drafted during the check (existing speculation), the map builds during the last screen, and
the results screen opens with **Start your first lesson** ready.

**Infer, don't ask (stealth assessment).** Evidence-centred "stealth assessment" infers competencies and states
from what learners do inside the task instead of separate questionnaires
([Shute, FSU primer](https://myweb.fsu.edu/vshute/pdf/SA_Primer.pdf)). Item-level confidence judgments track
self-efficacy and math anxiety (math anxiety lowers confidence judgments; e.g.
[item-level confidence on health-math problems, PMC9127482](https://pmc.ncbi.nlm.nih.gov/articles/PMC9127482)), and response
time correlates with math self-efficacy (r≈0.22, [NWEA brief](https://www.nwea.org/uploads/2020/03/researchbrief-can-item-response-times-provide-insight-into-students-motivation-and-self-ef%EF%AC%81cacy-in-math-2019.pdf)).
→ Efficacy, anxiety and under-confidence are read from the check's confidence taps, "I don't know"s, the
confidence–accuracy gap and time per question (`inferSignals`). Because these proxies are moderate, they are
**tone-only**: they soften wording and add early wins but never raise scaffolding; a stated answer always wins.

**When asked, ask short.** A single item ("How anxious does math make you?") gives valid, reliable math-anxiety
scores against the 25-item sMARS ([Núñez-Peña et al. 2014, SIMA](https://journals.sagepub.com/doi/abs/10.1177/0734282913508528));
the 9-item AMAS is the short multi-item standard ([Hopko et al. 2003](https://pubmed.ncbi.nlm.nih.gov/12801189)).
→ One SIMA-style 1–5 item, asked later (STEM goals only), replaces the three AMAS-style items.

**Expertise reversal is better handled adaptively than by preference.** Worked examples help novices and hurt
experts; adaptive fading driven by rapid assessment beats fixed choices
([Kalyuga et al. 2003](http://www.davidlewisphd.com/courses/EDD8121/readings/2003-Kalyuga_et_al.pdf);
[Kalyuga & Sweller 2005](https://eric.ed.gov/?id=EJ732688); [Salden et al. 2009](https://link.springer.com/article/10.1007/s11251-009-9107-8)).
→ The "worked example or try first?" question is gone; the lesson writer decides per skill from the diagnostic
(new ground → example first; secure ground → problem first).

**Fewer items, same placement (CAT).** Adaptive tests typically need about half the items of a fixed test for equal
precision ([Weiss 1982](https://journals.sagepub.com/doi/10.1177/014662168200600408); review in
[PMC5549015](https://pmc.ncbi.nlm.nih.gov/articles/PMC5549015)). → 6–10 items instead of 8–15.

**Interests personalise well, and can come from their own words.** Matching algebra story problems to students'
interests improved accuracy and speed, most for struggling students ([Walkington 2013](https://eric.ed.gov/?id=EJ1054444);
[Bernacki & Walkington 2018](https://eric.ed.gov/?id=EJ1187647)). → Contexts the learner names in their goal
("for my solar project") are used at once; the interest picker is a micro-question after lesson 1.

**Relevance helps most when expectations are low.** Writing about how material connects to one's life raised
interest and grades for low-expectancy students ([Hulleman & Harackiewicz 2009](https://www.science.org/doi/10.1126/science.1177067)).
→ "Why does this matter?" moved from minute 1 (where it was a hurdle) to after a lesson, framed as "How could this
help you, in your own life?"

**Plans beat intentions.** If-then implementation intentions have a medium-to-large effect on goal attainment
(d=0.65, 94 tests; [Gollwitzer & Sheeran 2006](https://www.researchgate.net/publication/37367696_Implementation_Intentions_and_Goal_Achievement_A_Meta-Analysis_of_Effects_and_Processes)).
→ "When will you do your next lesson?" micro-question after a lesson (stored as `next_session`).

**Goal orientation is shaped by the environment.** Classroom goal structures predict the goals students adopt
([Bardach et al. 2020 meta-analysis](https://eric.ed.gov/?id=EJ1263925)); performance-avoidance goals relate to worse
outcomes ([Hulleman et al. 2010](https://eric.ed.gov/?id=EJ884802)). → Instead of asking (and labelling) orientation,
every learner gets a mastery climate: private mistakes, no comparison, progress framing.

## 3. "UX Magnifica": psychology and neuroscience, applied screen by screen

| Principle | Evidence | Where it is in the UI |
|---|---|---|
| **Hick's law** — decision time grows with log₂ of choices | [Hick 1952](https://journals.sagepub.com/doi/10.1080/17470215208416600); [review](https://pubmed.ncbi.nlm.nih.gov/28434379) | Class picker is two small steps (4 stages → that stage's classes) instead of 16 chips; age is 3 taps; familiarity 3; 6 starter goals |
| **Endowed progress** — a head start raises completion (34% vs 19%) | [Nunes & Drèze 2006](https://academic.oup.com/jcr/article/32/4/504/1796232) | 5-segment progress bar whose first segment ("Account") is already full |
| **Commitment & consistency** | Gollwitzer & Sheeran 2006 (above) | The goal is written in their own words first; "Build my path" commits to it; implementation-intention micro-question |
| **Curiosity gap / fast aha** — curiosity engages the dopaminergic circuit and improves memory | [Gruber, Gelman & Ranganath 2014](https://www.cell.com/neuron/fulltext/S0896-6273(14)00804-6) | "In a moment you'll see what you already know"; live "Mapping…" chip; map skeleton (not a spinner) |
| **Fast first win / competence** | SDT; Brilliant/Duolingo placement | Check opens on a foundation skill; results lead with "You already know N skills"; under-confident learners told "You know more than you think" |
| **Reduced threat** — anticipating maths activates pain/threat regions in anxious learners | [Lyons & Beilock 2012](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0048076) | "Not a test: no score, no timer, 'I don't know' helps me too"; no right/wrong flashes during placement; anxiety asked later and only changes pace |
| **Autonomy** — choice raises intrinsic motivation, effort and perceived competence | [Patall et al. 2008](https://eric.ed.gov/?id=EJ787695) | Everything after the goal is skippable; AI purpose guess is pre-selected but labelled "My guess"; "Not now" on every micro-question |
| **Peak-end rule** — memory of an episode is dominated by its peak and its end | [Kahneman et al. 1993](https://journals.sagepub.com/doi/10.1111/j.1467-9280.1993.tb00589.x) | Results screen is the designed peak (staggered reveal of known skills, "Start here" marker) and ends on one action: start the first lesson |
| **Warm relatedness** | SDT | The tutor speaks in the first person in a chat bubble on every screen, reflecting the learner's own goal back |

Visual system: Newsreader display titles (30/36px), Inter 15px body, 12px uppercase labels; 1px `line` borders,
radius 14 cards; accent for the concept/primary, clay for "start here"; one filled primary per screen, bottom-anchored
(thumb zone, safe-area aware); ≥44px targets everywhere; screen transitions 280 ms `cubic-bezier(0.2,0,0,1)` with a
short horizontal slide; `prefers-reduced-motion` → opacity-only, no pulsing.

## 4. Inferred vs deferred vs dropped (and the defaults meanwhile)

| v1 field | v2 | Default until known | Consumers checked |
|---|---|---|---|
| status | inferred from class + age (`inferStatus`) | null (levelLine omits it) | levelLine |
| school system | dropped (class names already Nigerian) | null | levelLine |
| last studied | 3-chip "how well do you know it" (optional) | null → check is taken | priorKnowledge (skip-check rule), buildGraph |
| why | **deferred** micro-question | null | teachingNotes (project scope), reflectWhy/value_type |
| purpose, deadline | optional screen during map build; AI pre-guess | null → steady pace, "path" scope | planFor, teachingNotes, dashboard/settings, path-edit |
| hours/week | **deferred** micro-question (re-plans the newest goal) | 2 h | planFor, director prompt |
| efficacy | **inferred** from check (tone only) | 3 | teachingNotes, planFor, learnerLite |
| orientation | dropped; mastery climate for all | null → mastery framing | teachingNotes, lesson-ai |
| mood/energy | dropped from intake; in-lesson check-ins already exist | — | learner_checkins (lesson context) |
| anxiety (3 items) | **inferred** (tone) + **deferred** SIMA item (STEM) | null | teachingNotes, planFor, lesson-ai |
| worked-vs-try | **inferred** per skill from the diagnostic | expertise rule | teachingNotes, lesson-ai |
| interests | **inferred** from goal text, then **deferred** picker | everyday Nigerian examples | teachingNotes, masteryItems, agent prompts |
| barriers | dropped (the Ask tutor learns it in conversation) | null | teachingNotes |
| next session | **new**, deferred (implementation intention) | — | stored in answers (for reminders) |

Micro-questions: at most one per lesson end and one per 12 h, order interests → next session → hours → anxiety
(STEM) → why. Learners who answered a field in v1 are never asked it again. Learner-wide answers are copied into
every goal's `learner_snapshot` so the next lessons use them; weekly time re-plans the newest goal.

Safety and law unchanged: free text is screened for distress (client and server); under-18s see the guardian-consent
screen and nothing beyond age is stored before consent (NDPA 2023 s.31).

## 5. Risks / follow-ups
- Inferred signals are proxies (moderate correlations); kept tone-only on purpose. Validate against the SIMA answers
  once enough learners answer it.
- `next_session` is stored but nothing reminds yet (a natural job for the Learning Director).
- A/B test v1 vs v2 completion once there is traffic (today only test accounts).

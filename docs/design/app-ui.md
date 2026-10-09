# App-wide UI — Magnifica inventory and spec

Companion to `lesson-ui.md` (lesson board, stage, checks, recap; principle table §0) and `onboarding.md`. This file
covers **every other screen and shared component**: what it is, its grade before and after the Magnifica pass
(Oct 2026, branch `ui-magnifica`), and the learning/UX principle each fix applies. A change to any of these surfaces is
held to the same bar: it names its principle, keeps one primary action per moment, ≥ 44 px targets, AA contrast,
reduced-motion support, and no spinner where a skeleton can show the shape of what is coming.

Grades: **A** at the bar · **B** good, small gaps · **C** works but below the bar · **D** missing or default framework UI.

## 1. Inventory

| # | Screen / component | File | Before | After | What changed · principle |
|---|---|---|---|---|---|
| 1 | Landing | `app/page.tsx`, `site-chrome.tsx` | B+ | A- | Lesson features rewritten for what the tutor does now (owns its board, exact diagrams, figures you move, growth-framed checks + report) · *truthful framing, curiosity*. Footer links 44 px · *Fitts* |
| 2 | About | `app/about/page.tsx` | C (described the Oct-7 app: no stage, pictures, Genie, guard) | A | Rewritten: 4-step journey, 8 tutor capabilities with icons, correctness guard + Report a mistake, learning-science map (principle → what you notice), privacy, honest "where things stand" (free AI limits, animations still widening) · *trust through honesty, dual coding (icons + text), chunking* |
| 3 | Credits & licences (new) | `app/credits/page.tsx` | D (none) | A | Public page: illustration libraries (Servier, Bioicons, Wikimedia Commons) with licences and counts, how per-picture credits work, open-source software + licences · *CC BY attribution, trust* |
| 4 | Sign in | `(auth)/login/page.tsx` | B | A | Calm notice after the 30-min away sign-out ("your place is saved") · *anxiety-safe, no mystery*; human error copy for wrong password / network; show-password toggle 44 px · *error prevention, Fitts* |
| 5 | Sign up | `(auth)/signup/page.tsx` | B | A- | Show-password, password hint under the field, "already have an account" error routes to sign-in · *error prevention* |
| 6 | Auth layout | `(auth)/layout.tsx` | A- | A- | unchanged |
| 7 | 404 (public + in-app) | `app/not-found.tsx`, `(student)/not-found.tsx` | D (framework "404 · This page could not be found") | A | On-brand map sketch, plain words, "nothing you've learned is lost", one primary way back; in-app version keeps the nav · *reduced threat, Hick* |
| 8 | Errors (route, app, global) | `app/error.tsx`, `(student)/error.tsx`, `app/global-error.tsx`, `system/error-view.tsx` | D (none) | A | "It's on our side, not yours", progress saved, Try again (re-fetch) + Home, reference id · *anxiety-safe, autonomy* |
| 9 | Route loading | `(student)/loading.tsx`, `learn/[id]/loading.tsx`, `system/page-skeletons.tsx` | D (blank until server render) | A | Skeletons shaped like the page / the lesson board + transport · *perceived performance, reduced uncertainty* |
| 10 | Home (dashboard) | `(student)/dashboard/page.tsx` | B- (the one action "Start lesson" sat below Today and every goal card) | A- | Up-next card moved to the top, larger, labelled "Pick up where you left off" / "Ready for the check", full-width primary on phones · *Hick, Zeigarnik, thumb zone*; empty "What you know / what's next" copy · *competence (SDT)* |
| 11 | Today card | `agent/today-card.tsx` | A- | A- | unchanged (already effort-framed, undo visible) |
| 12 | Learn list | `(student)/learn/page.tsx` | B- (every card had a filled primary) | A- | One filled button on the page: the topic that is up next, ringed + "Up next" badge; others secondary; locked cards say how they open · *Hick, signalling, autonomy* |
| 13 | Lesson page chrome | `learn/[id]/page.tsx` | B | A- | Back link 44 px; bottom mastery-check panel demoted to secondary (Play is the one filled control) and says "No timer; you can retake it" · *one primary (§1), low threat* |
| 14 | Lesson preparing | `lesson-preparing.tsx` | C (spinner) | A | Board-shaped skeleton whose lines "write" themselves, live status ("Writing part 1" / "Part 2 on its way" / "Short pause"), opens by itself; error state with Check again · *perceived performance, honesty* |
| 15 | Board / stage / checks / recap | `whiteboard/*` | A- (from lesson pass) | A | See §2: stage grows out of the board's frame; explore footer states the goal; recap still sized for phones; board pictures tap-to-zoom |
| 16 | Up next (end of lesson) | `up-next.tsx` | A- | A- | unchanged (countdown + cancel = autonomy) |
| 17 | Mastery check | `mastery-check.tsx` | B- (spinner, red-free but "×" crosses on review) | A- | Question-shaped skeleton; "n of 4 answered" next to the disabled button; spring tick on Mastered; review uses lightbulb "not yet" not crosses; "The answer is …" · *progress visibility, growth framing, reward (effort-based)* |
| 18 | Ask page | `(student)/ask/page.tsx` | B | B+ | (page chrome unchanged; see 19-22) |
| 19 | Ask empty state & starters | `agent/ask-empty.tsx` | B | A | Icon starters (48 px rows, arrow affordance), "Try one" label, copy says what the tutor can do · *recognition over recall, Hick (3-4 options)* |
| 20 | Ask answer text | `agent/agent-text.tsx` | C (raw `![…](url)` markdown, "[shown in chat: …]" history notes leaked, long raw URLs) | A | Markdown links show their label, images dropped (pictures come as credited blocks), history notes never shown, headings as bold lines · *extraneous load* |
| 21 | Tool chips | `agent/tool-chips.tsx` | B- (spinner + red ×) | A | Breathing dot while working, tick when done, neutral "— skipped" when a tool failed, staggered in · *calm progress signal, low threat* |
| 22 | Chat scroll / composer | `agent/chat.tsx` | C (last picture's credit row scrolled under the sticky composer + tab bar) | A | End anchor has a scroll margin that clears composer + nav; "Thinking…" typing dots · *nothing to read is ever covered* |
| 23 | In-lesson Ask sheet | `agent/ask-sheet.tsx` | B | A- | Grabber; floating button says "Ask about this" with a canvas ring so it never merges into the board · *affordance* |
| 24 | Illustrations (Ask) | `agent/blocks.tsx` SvgBlock | B (tiny labels unreadable at 390 px) | A | Tap-to-zoom (opens at 160 % on phones, +/−, pinch/scroll pan, Esc) with "Tap to zoom" chip · *Fitts, no context switch* |
| 25 | Manim clip player | `agent/blocks.tsx` ClipPlayer / ClipCaption | C (control bar overlaid the bottom of the clip, hiding readouts like "y = 2.00" and axis numbers; caption cut mid-sentence "…highlighting") | A | Controls in their own strip **under** the video; caption trimmed to its last full sentence (or a word boundary + …) with Show more · *nothing the learner must read is covered; clean reading* |
| 26 | Edited boards (board_edit) | `agent/blocks.tsx` BoardBlock | B (silent remount) | A- | One soft accent pulse + "Updated" tag; the player replays from the first changed step with the pen · *signalling change* |
| 27 | Settings / goals / goal edit | `settings/page.tsx`, `goal-edit.tsx` | B+ | B+ | unchanged (edit form already explains consequences) |
| 28 | Delete dialog | `delete-dialog.tsx` | A- | A | Grabber on phones · *affordance* |
| 29 | Confirm / Undo | `agent/confirm.tsx`, `undo-button.tsx` | B+ | B+ | unchanged |
| 30 | Safety pause | `safety-pause.tsx` | A | A | Grabber only; copy untouched (reviewed) |
| 31 | Idle timeout | `idle-timeout.tsx` | C (silent sign-out to a bare login) | A | Sends `?reason=away` so sign-in explains it and returns to the same page · *anxiety-safe* |
| 32 | App shell, nav bars, account sheet | `app-shell.tsx` | A- | A | Account sheet grabber + swipe down to close; hosts the shared zoom view · *direct manipulation* |
| 33 | Report a mistake sheet | `report/report-mistake.tsx` | A- | A- | owned by correctness work; unchanged |
| 34 | Micro-questions, intake, diagnostic | `micro-question.tsx`, `intake-flow.tsx` | A (onboarding pass) | A | unchanged |
| 35 | Toasts | — | n/a | n/a | The app has no toast system; confirmations are inline (Done/Undo chips, flagged notices). Kept that way: inline feedback sits where the eye already is (spatial contiguity). |
| 36 | Emails | Supabase auth templates | C? | — | Not in this repo (Supabase dashboard defaults); not changed — see gaps |
| 37 | Admin pages | `/admin/*` | — | — | Out of scope (staff only) |

## 2. Rules added in this pass

- **System pages** (`SystemMessage` in `ui.tsx`): eyebrow, serif title in plain words, one reassuring sentence about
  progress, one primary + one secondary action. Never a status code alone.
- **Skeletons over spinners**: route loading, lesson preparing and mastery check all show the shape of what is coming.
  No spinners anywhere: a pressed button shows the ink mark and its verb (§2a).
- **Tap to zoom** (`zoomable.tsx`): any raster/SVG picture whose labels can fall below 12 px on a phone is zoomable —
  library illustrations in Ask, board `figure`s (via `openZoom` + the shell's `ZoomHost`) and the recap still.
- **Nothing covers what the learner must read**: video controls live under the video; sticky composers reserve scroll
  margin; floating buttons carry a canvas ring.
- **Captions end cleanly**: a cut-off model caption is trimmed to its last sentence (`cleanCaption`), never mid-word.
- **Explore checks state the goal in the figure footer** ("◎ Goal: sin θ = 0.5") and ring the readout it is about
  (goal salience, spatial contiguity).
- **Recap still** renders at 400 × 280 with 13-18 px labels (`interactiveSvg(spec, { recap: true })`), ≥ 12 px when shown
  340 px wide.
- **Stage morph**: the stage starts at the board frame's measured height and grows to its content (320 ms, ease
  `[0.2,0,0,1]`), then the frame's own `layoutId` handles full screen (§2 of lesson-ui.md). A true per-object shared
  element (one board shape flying into the stage figure) is not built — see gaps.

## 2a. Waiting states (Oct 2026, branch `loading-ui`)

Every place a learner waits uses one small vocabulary from `src/components/system/wait.tsx`, so every wait reads as the
same calm tutor at work. The bar: shaped like what is coming, honest about what is happening now, no clocks, no fake
percentages, reduced motion respected, ≥ 44 px targets, nothing moves when the content lands.

| Primitive / rule | Where | Principle |
|---|---|---|
| **InkMark**: a short pen stroke that writes itself, rests, lifts (1.7 s). Replaces every spinner, ping and pulsing dot | buttons, status lines, tool chips, Send | Low threat (motion reads as "someone is writing for you", not "stuck"); consistency lowers extraneous load |
| **Pending** (`state: idle·busy·done·failed`): every label shares one grid cell, so the button keeps the width of its widest label; busy = ink mark + the verb now happening ("Checking", "Saving"); done = tick + past tense for a moment; failed = calm "Try again" in place, never red. A busy disabled button stays at full contrast (`globals.css`); still disabled, so it cannot fire twice | Send, Start lesson (lesson cards), Confirm / Not now / Undo, Check my answers, Continue (check-in, onboarding, diag confidence: only the tapped one), Save (micro-question, goal edit), Send report, Show a corrected version, Listen, Retry, Check again, Delete, Sign in / Create account | No layout shift (CLS); feedback for every action (Norman: visibility of system status); closure / effort acknowledged; reduced threat on failure |
| `useAction()` hook: busy → done/failed → idle | new buttons | Same |
| Small (`sm`, 32 px) buttons get a 44 px touch area via an invisible `::before` | all `buttonClass('…','sm')`, Undo | Fitts's law, WCAG 2.5.5 |
| **WaitNote**: one honest status line tied to a real event, polite live region | tutor writing the next part, check questions, Ask turn | Uncertainty reduction (Norman); screen-reader parity |
| **TurnStatus** (Ask + tutor sheet): "Reading your question" until the first stream event → the label of the tool running *now* → "Writing the answer"; after 8 s with no event a second line says what that means (a real threshold, never a counter). Running steps are said once (status line); finished steps settle into tick chips above | `agent/turn-status.tsx`, `chat.tsx`, `tool-chips.tsx` | Uncertainty reduction; redundancy avoided (Mayer) |
| **VisualPlaceholder**: while a visual tool runs, its frame (header strip + paper at the final aspect: board/graph/diagram 16:10, picture 4:3, sim/interactive 3:2) is already in the answer with a pen sketching its rough shape and one line on what the tool is doing | Ask + sheet | Signalling (eye knows where to look), perceived performance, no layout shift, curiosity gap |
| **PaperSketch**: warm ruled paper, a few strokes drawn in order then lifted; reduced motion = drawn once and still | clip wait, lesson preparing, lesson route loading, visual placeholders | Shaped skeleton (perceived performance); dual coding (the shape previews the figure) |
| **StageList**: the real stages of a long job, done / now / next; only stages the server reports are marked done | path build (map → first idea → first lesson), lesson preparing (planning → part 1 → opens), clip render (when the status route reports the phase) | Goal-gradient without a number; Zeigarnik (visible, closable steps); honest progress |
| **QuietLine**: hairline progress, determinate only with real progress (video recorder), otherwise a slow drift | video download toast | Honest progress; low threat |
| **WhileYouWait**: one optional prediction prompt in long waits, there from the start (no shift), never graded | clip render ("what do you expect to change first, and why?") | Generation effect / pretesting; curiosity |
| No countdowns or seconds-left: the clip timer ("0:42 · usually 1–3 min") and the video "about N s left" were removed; the usual range is said once in words, and a "taking longer than usual, still working" line appears only past a real threshold | clip, video | Low threat / no timers (time pressure costs working memory); honesty |
| Skeleton shimmer is a slow light passing over warm paper (2.2 s), not a blink; off under reduced motion | `.skeleton` | Calm motion; vestibular safety |
| Route skeletons mirror their page: `/ask` (header, tutor bar, starter rows), `/learn/[id]` (back link, title, meta row at the page's sizes, board frame at 4:3 / 16:9, transport) | `loading.tsx` files | No layout shift; perceived performance |

Not changed in this pass (held back while the visuals work owns these files): the lesson player's "Start lesson /
Preparing voice" overlay and its "Next part on its way" card (`whiteboard/player.tsx`, still a spinner / ping), and the
clip status route's `phase` field (`api/agent/clip/[id]`) that lets the clip wait mark real stages; until it ships the
clip wait shows one honest line instead of stages.

## 3. Known gaps (tracked)

- Board object → stage per-element shared transition (only the frame morphs).
- The Manim clip inside the **lesson player** (not Ask) has its own transport; not re-checked in this pass.
- Unauthenticated unknown URLs redirect to sign-in (middleware) instead of the public 404.
- Supabase auth emails (confirm, reset) use dashboard defaults; no in-repo templates. No "forgot password" flow in the UI.
- Dark theme still not shipped (tokens map 1:1 when it is).

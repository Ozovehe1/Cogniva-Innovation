# Lesson + tool UI — design spec

Scope: what a learner sees while being taught — the lesson board, the **stage** (a live visual that takes over from the
board), the in-lesson Ask sheet, checks, and the tool outputs inside Ask (diagram, interactive, board, plot). This spec
is the bar every change to those surfaces is held to. Tokens live in `src/app/globals.css`; primitives in
`src/components/ui.tsx` (`buttonClass`, `cx`). Every other screen (home, learn, Ask, auth, About, credits,
system pages, sheets) is inventoried and graded in `docs/design/app-ui.md`.

## 0. UX Magnifica — every choice names the learning principle it serves
"UX Magnifica" is the bar: design that works *with* how attention, memory and motivation work, rendered with
visual craft. Each rule below is tagged with the principle it uses; a change that cannot name one does not ship.

| Design choice (where) | Principle |
|---|---|
| One filled control per moment; stage shows only Skip until narration ends (§1) | Hick's law (few choices), cognitive load (extraneous load) |
| Narration plays *while* the figure moves; caption sits directly above the figure, readouts under it (§3, stage) | Mayer temporal + spatial contiguity, split-attention avoided |
| Board text is short labels only; the voice carries the sentence (lesson-ai SHOW_DONT_TELL) | Mayer redundancy, dual coding |
| A lesson is sections → steps; one idea per step, the player pauses at checks (§1, player) | Segmenting, chunking |
| Clay (emphasis) is reserved for the one thing to look at now; everything else ink/neutral (§5) | Preattentive salience, signalling |
| Annotate rings / highlight on the key line; recap lists exactly the highlighted lines (§13) | Signalling, retrieval cue |
| Stage opens in the board's own frame, shared layoutId to full screen (§2) | Spatial continuity — no re-orientation cost (cognitive load) |
| `play` demonstration first, then the learner drives (§3, §6) | Worked-example → fading, generation effect |
| Explore check: "slide until sin θ = 0.5" answered by doing (§14) | Retrieval practice, generation effect, desirable difficulty |
| Wrong answer: "Not quite yet — that tells us where to look", a where-you-are hint, work kept on retry (§7, §14) | Growth-mindset feedback, reduced threat |
| Right answer: varied, effort-based line ("You worked that out" after a retry), spring tick + 8 ms haptic (§14) | Reward prediction (variable, effort-contingent, not slot-machine) |
| No countdowns on questions; calm green/clay, never red fills or shakes (§7) | Reduced threat (maths anxiety) |
| Progress bar + section label always visible; recap says what was done (§13) | Zeigarnik / progress visibility, competence (SDT) |
| Lesson ends on the recap: key picture + "You worked through N questions" (§13) | Peak-end rule, competence (SDT) |
| Replay / Skip / Full screen / Reset always available, never forced (§1, §6) | Autonomy (SDT) |
| The tutor narrates in second person, names effort, asks "your turn" (lesson-ai SHOW_DONT_TELL) | Relatedness (SDT) |
| Primary controls bottom of their frame, ≥ 44 px, snapping drag targets (§6, §8) | Fitts's law, thumb zone |
| A stage step's caption poses the question before the demo answers it (lesson-ai SHOW_DONT_TELL "Curiosity first") | Curiosity gap |
| Explore checks reuse the lesson's figure; recap still is the same picture (§13) | Spacing / retrieval cue (same cue at encoding and recall) |
| Skeleton shaped like the coming figure, never a spinner (§9) | Perceived performance, reduced uncertainty |
| Pre-training: the lesson tutor names the parts (axes, P, θ) before the stage moves them (lesson-ai SHOW_DONT_TELL) | Mayer pre-training |

## 1. Learner focus first
- **One primary action per moment.** While the tutor explains, the only filled (accent) control is Play/Pause. When a
  stage is open, its one primary action is **Back to the board** (and it appears only once the narration has finished;
  until then it is a quiet secondary "Skip"). A check has one primary: its submit.
- **Progressive disclosure.** Secondary controls (expand, reset, legend) are ghost/subtle, never compete with the primary.
- **Calm chrome.** Frames are 1px `line` borders on `surface`, radius 14 (`--radius-card`), `shadow-card` only. No
  gradients, no badges for decoration. Labels above a frame are 12px uppercase, tracking 0.08em, `muted`.

## 2. Spatial continuity
- The stage opens **from the board**: it occupies the board's own frame (same position, same radius) and grows to its
  content height, so the learner's eye does not jump. Expanding to full screen animates the same element (shared
  `layoutId`), and closing returns it to the board frame before the board fades back in.
- The board is never unmounted while a stage is open (its state, camera and ink survive); it is hidden visually only.

## 3. Motion that explains
- Motion is tied to the narration: the stage opens when its step's narration starts; a `play` demonstration glides
  one slider min→max over `seconds` (default 4 s, ease-in-out) **while** the voice describes it, then hands control to
  the learner with a one-time drag hint pulse on the draggable point.
- Durations: enter 280 ms `cubic-bezier(0.2, 0, 0, 1)`; exit 200 ms; expand/collapse 320 ms. Nothing loops forever.
- **Reduced motion:** opacity-only transitions ≤ 10 ms, demonstration jumps to the end value, no pulse.

## 4. Hierarchy and type scale
`12` label · `13` meta/readout label · `15` body · `17` readout value (tabular) · `20` card title (serif display) ·
`23` board title. Never below 12px on a 360px phone; diagram labels render ≥ 18 viewBox units on a 640-wide figure.

## 5. Semantic colour roles (same meaning everywhere: board inks, diagrams, interactives, checks)
| Role | Token | Use |
|---|---|---|
| Ink | `ink #14141A` | text, axes, outlines |
| Concept | `accent #1F4D3A` | the key idea / main curve / primary action |
| Emphasis | `clay #A4502A` | the thing to look at now, draggable points |
| Second series | `navy #23406A` | a second curve / tangent / construction lines |
| Highlight | `amber #8A5A00` | brief highlight only |
| Error | `danger #A3261B` | a wrong answer (never with a cross alone: always words) |
| Success | `accent` on `accent-soft` | a correct answer |
Fills use the `-soft` tints (≈ 12–16 % opacity); text on fills keeps AA contrast (all role colours ≥ 4.5:1 on white).

## 6. Direct manipulation
- Draggable things look draggable: clay point with a white ring (≥ 12px visual, 44px hit area via JSXGraph
  `precision.touch`), a "Drag P" hint chip with a hand icon that fades after the first drag.
- Live readouts update every frame, tabular numerals, label above value.
- Sliders: 44px tall hit area, value shown at the right in tabular numerals; a ▶ Play button beside the slider that a
  stage demonstration uses (the learner can replay it).
- Haptics: `navigator.vibrate(8)` (where supported) when a demonstration hands control over and on a correct check.

## 7. Feedback psychology  ·  *growth mindset, reduced threat*
Wrong answers are information, not failure: "Not quite — here's another way to see it", effort is named ("Good try:
you set up the equation correctly"), retry is one gentle tap. No red full-card fills, no shaking.

## 8. Thumb zone (phones, 360–430px)  ·  *Fitts's law*
Primary controls sit in the bottom third: the player transport and the stage's **Back to the board** bar are bottom
anchored inside their frame; full-screen stage puts its bar at the bottom edge above the safe-area inset. Touch
targets ≥ 44×44px.

## 9. Perceived performance  ·  *reduced uncertainty*
While a figure loads (JSXGraph chunk), show a skeleton shaped like it: the frame at its final aspect ratio with faint
axes lines, never a spinner. Optimistic open: the stage frame appears immediately with the skeleton.

## 10. Accessibility
Every control has an `aria-label`; the stage is a `region` labelled by its title; full screen is a `dialog` with
focus moved to it and Escape to close; visible focus rings (`outline 2px accent, offset 2px`); figures carry a text
alternative (`interactiveAlt`).

## 11. Library illustrations (real textbook pictures)
- Real-world structures (organs, cells, circuits, atoms, levers, planets) come from the free illustration library
  (`src/lib/illustrations/`: Bioicons, Servier Medical Art, Wikimedia Commons; CC0 / PD / CC BY / CC BY-SA only), never
  drawn from shapes. The model asks with `find_illustration` (chat) or an `illustration` step (lesson); the server
  picks, sanitises and caches the SVG in the public `illustrations` bucket. A board `figure` takes `src` only from
  that bucket.
- Every picture is credited: a credit strip inside the SVG on boards, and in chat a caption row (title · author,
  source link, licence chip), each link a ≥44px target. Titles drop Commons language suffixes ("… en").
- Card states: skeleton at the final aspect ratio while loading; on failure an "This picture didn't load" panel with
  the alt text and a **Try again** button (44px); never a spinner, never a broken-image icon alone.
- Labels go beside or below the picture as short board notes; on phones notes reflow under the figure, so lab and
  prompts avoid arrows whose tails would end in empty space.

## 12. Genie, the tutor character (Rive)
- One fixed-size avatar (space reserved; nothing shifts on load) in the Ask header, the in-lesson sheet and the
  lesson player strip. Runtime + `.riv` are self-hosted under `/genie/` and loaded only when on screen and idle.
- Moods: idle, listening, thinking, talking (lip sync from `narrator.lipSync()`), happy, encouraging; a live status
  line for screen readers. Reduced motion: pose changes only, no idle loop or mouth motion.
- The learner can hide it (remembered); `NEXT_PUBLIC_GENIE=off` removes it everywhere. If Rive/WebAssembly fails, a
  still drawing of the same character is shown.
## 13. Lesson end: recap  ·  *peak-end rule, dual coding, competence*
`src/components/whiteboard/recap.tsx`. When a lesson's last step plays (not in embedded chat boards) the end card is a
recap: "Lesson complete" with a spring tick, the title, "You worked through N questions to get here" (effort, not a
score), **the picture to remember** (a still of the lesson's last live figure, same colours as the stage) and **key
ideas** (the lines the tutor highlighted or annotated, max 3, clay bullet). A ghost "From the top" replay sits at the
bottom. The up-next card follows it.

## 14. Checks  ·  *retrieval practice, generation effect, growth feedback*
`src/components/whiteboard/check-card.tsx`. A check may carry a live `figure` (choice/short: read the answer off it).
Kind **explore** is answered by moving the figure until a readout (by label) reaches `goal.equals ± tol`; "Check it"
reads the live value. Feedback sits in a tinted strip (accent-soft / clay-soft) with a round icon (tick / lightbulb —
never a cross), a varied line (first try vs after retries), and for explore a specific hint ("You're at 0.71; the goal
is 0.5 — a little lower"). "Keep adjusting" keeps the figure where the learner left it. All buttons 44 px. A right
answer buzzes 8 ms and the lesson carries on after reading time.
Draggable points snap on release to a tidy step (≈ 1/40 of the range, 1/2/5 × 10^k) with a tick: readable values,
less fiddly on touch (Fitts).

## 15. Figures keep 1:1 units when they have circles
`figureGeom` / `equalUnits` (src/lib/agent/interactive.ts): a figure with a circle takes its ranges' aspect (clamped
1–1.6) and widens the shorter range so a unit is as long across as up — in the live figure and in the still.

## 16. Magnifica pass additions (Oct 2026)  ·  see app-ui.md for the full inventory
- Explore check: the figure footer states the goal ("Goal: sin θ = 0.5") and the goal readout carries a clay ring
  (goal salience, spatial contiguity) — replaces the generic "Move the sliders."
- Recap still renders at recap size (400 × 280, labels 13-18 px) and opens larger on tap.
- Board `figure`s, Ask illustrations and the recap still are tap-to-zoom (`zoomable.tsx`).
- The stage starts at the board frame's measured height and grows to its content (spatial continuity, §2).
- An edited chat board pulses once and shows "Updated" while the pen replays from the first changed step.

## Not in this pass (tracked)
- Dark theme: the app ships light-only today (no dark tokens); the roles above are defined so a dark palette can map
  1:1 later.
- Rive/GSAP motion on the stage (only interactive + Manim clip stage kinds exist now).

/**
 * The GeniusMap item spec (docs/design/assessment.md §5): one shape for every question a learner answers outside
 * the whiteboard (diagnostic, mastery check, practice set, prerequisite re-check). Lesson checks keep their
 * CheckStep shape (lesson-schema.ts) and are validated with the same rules (validate.ts `checkStepItem`).
 *
 * Client-safe: types and prompt text only.
 */
import type { DiagItem } from '../diagnostic-core'

export type Bloom = 'remember' | 'understand' | 'apply' | 'analyse'

/** A figure inside an item. Only when the stem refers to it or the skill is visual (validate.ts `figureNeed`). */
export type ItemFigure =
  /** A graph on axes: functions / points / segments. Rendered server-side to a static SVG (interactiveSvg). */
  | { kind: 'graph'; spec: Record<string, unknown>; alt: string; svg?: string; notToScale?: boolean }
  /** An exact maths diagram (Penrose): sets, geometry, graphs/trees, vectors. Rendered server-side. */
  | { kind: 'diagram'; library: 'sets' | 'geometry' | 'graph' | 'vectors'; substance: string; alt: string; svg?: string; notToScale?: boolean; labels?: string[] }
  /** A credited library illustration (find_illustration): organs, cells, apparatus, circuits. */
  | { kind: 'illustration'; topic: string; alt: string; svg?: string; src?: string; credit?: string; labels?: string[] }

export interface AssessItem extends DiagItem {
  /** Arithmetic expression for the key's value (numeric items). */
  calc?: string | null
  /** Per option: the misconception a distractor captures (null for the key). */
  why?: (string | null)[]
  /** Per option: an arithmetic expression for the value a numeric distractor states (the mistake's computation). */
  calcs?: (string | null)[]
  /** The taught objective this item measures (from the lesson's aims / key ideas), in the lesson's words. */
  objective?: string
  bloom?: Bloom
  /** Writer's difficulty estimate 1 (easy) .. 5 (hard); seeds the Elo rating. */
  difficulty?: number
  /** Elo item rating (calibrate.ts), updated from this learner's answers. */
  elo?: number
  figure?: ItemFigure
  /** Set by validate.ts: the item passed every accuracy, fairness and alignment check. */
  verified?: boolean
}

/** Learner-facing shape of a figure (no substance/spec needed to draw it). */
export interface PublicFigure { kind: ItemFigure['kind']; svg?: string; src?: string; alt: string; credit?: string; notToScale?: boolean }

export function publicFigure(f: ItemFigure | undefined | null): PublicFigure | undefined {
  if (!f || (!('svg' in f && f.svg) && !('src' in f && f.src))) return undefined
  return { kind: f.kind, svg: f.svg, src: 'src' in f ? f.src : undefined, alt: f.alt, credit: 'credit' in f ? f.credit : undefined, notToScale: 'notToScale' in f ? f.notToScale : undefined }
}

/**
 * Prompt rules every item writer includes, on top of QUESTION_RULES (maths formatting, numeric verification).
 * Sources: Haladyna, Downing & Rodriguez (2002); Rodriguez (2005); Abedi & Lord (2001); Shute (2008).
 */
export const ITEM_RULES = `Item-writing rules (every question):
- Test ONE taught objective. Put "objective": the lesson aim or key idea it measures, in the lesson's own words. Use only the methods, notation, symbols, terms and diagram style the lesson used; nothing the lesson did not teach, no tricks.
- The stem is a complete question that can be answered before reading the options. Word it positively (no "NOT", "EXCEPT", "which is incorrect", no "what wrong answer would they get").
- Exactly one option is correct and defensibly best. Every wrong option is a real misconception or a typical slip for THIS skill (wrong formula, sign error, forgot a factor, unit slip, inverted ratio, a step the lesson warned about); give each one's misconception in "why" (null for the correct option).
- Options are parallel: the same kind of thing (all numbers with the same unit and precision, all expressions, or all short phrases), similar length and grammar, no overlapping or equivalent options (two forms of the same expression count as the same).
- Never "all of the above", "none of the above", "both A and B", or "A and C". No absolute words ("always", "never") only in wrong options. No grammatical clues (a/an) and no repeated stem words that give the answer away. The correct option must not be the longest or most detailed.
- Numbers: exact values stay exact ("$2.5$", "$-1$", "$\\frac{3}{4}$"), never padded ("$2.50$" for an exact 2.5). Measured/rounded values use 3 significant figures in every option. Numeric wrong options also get "calcs": per option, the full arithmetic for the value that option states (the mistake worked through), written exactly like "calc" (same numbers and constants: pi as pi, 4*pi*10^(-7), powers as 10^(-3)), null for the correct option and non-numeric ones. Work each one out: the option must show exactly what its calc gives, rounded the same way as the key.
- Keep reading load low: under 35 words in the stem, short sentences, common words. A context must be real and sensible (no "a coding loop variable 3k equals 90 instructions"); if no natural context exists, ask the maths plainly.
- "explain": one or two warm sentences that show the key step, and for the most tempting wrong option, why it is tempting. No titles or labels before the sentence; never "obviously", "simply", "easy", "careless".
- "bloom": remember | understand | apply | analyse; "difficulty": 1-5 for this learner's level.
- Figures ONLY when needed to assess the skill or clearly needed to understand the question (geometry, graphs, circuits, biology structures, data). Then the stem refers to it ("In the diagram…", "The graph shows…") and "figure" is one of:
  {"kind":"graph","spec":{"title","x_range":[a,b],"y_range":[c,d],"functions":[{"name":"f","expr":"x^2-4","label":"y = x^2 - 4"}],"points":[{"name":"A","x":2,"y":0}],"segments":[{"from":"A","to":"B"}]},"alt": one sentence naming what is drawn and every labelled value}
  {"kind":"diagram","library":"geometry"|"sets"|"graph"|"vectors","substance": the Substance program (math_diagram syntax),"alt": "...","notToScale": true when lengths/angles are given as numbers}
  {"kind":"illustration","topic":"plant cell","labels":["nucleus","cell wall"],"alt":"..."}
  Every value or label the stem mentions must be in the figure; the figure must not give the answer away. Otherwise "figure": null (text-only).`

/** Fields to add to the JSON shape a writer returns. */
export const ITEM_JSON = `{"q": string, "options": [strings], "answer": index, "explain": string, "calc": string|null, "calcs": [string|null per option]|null, "why": [string|null per option], "objective": string, "bloom": string, "difficulty": 1-5, "figure": object|null}`

/** The same rules, condensed for in-lesson checks (lesson-ai.ts prompts). */
export const CHECK_ITEM_RULES = `Check questions (choice/short) follow the item rules: ask only about what this lesson just showed, in its notation and words; one clearly correct option; 3-4 parallel options, each wrong one a real misconception; no "all/none of the above", no NOT/EXCEPT, the correct option not the longest, exact numbers not padded (2.5 not 2.50); short plain sentences; "explanation" a warm sentence with the key step. A check uses a figure only when the question is about it.`

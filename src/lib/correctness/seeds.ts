/**
 * Seed regression cases: one per mistake GeniusMap has actually made. Each holds the faulty artefact (as it was shown, or
 * reconstructed) and, where it helps, the corrected one; the assertion is the specific correctness property.
 * Pure data + deterministic checks, so they run in the eval route, in a script or in a unit test alike.
 * To add one, see docs/correctness.md.
 */
import type { Step } from '../lesson-schema'

export type RegressionKind =
  /** Tutor text: the guard must find (and fix, when `fixedTo` is given) the wrong numeric claim. */
  | 'text'
  /** Board/lesson steps: guardSteps must report an issue of `issue` kind (bad) and none on the good version. */
  | 'steps'
  /** Library illustration for a query: must not be any of `notIds`, and its title must match `titleMatches`. */
  | 'illustration'
  /** Interactive spec: its still must draw circles round (equal units). */
  | 'interactive'
  /** Exact maths diagram (math_diagram): must lay out with no unmet constraint. */
  | 'diagram'
  /** Model turn: the agent must not give the answer to a practice/homework question on the first reply. */
  | 'giveaway'
  /** Animation verdict: a clip the verifier failed must be blocked. */
  | 'clip'
  /** A promoted learner report: the guard's re-check of the (anonymised) artefact must flag it. */
  | 'artefact'

export interface RegressionCase {
  id: string
  kind: RegressionKind
  title: string
  input: Record<string, unknown>
  expect: Record<string, unknown>
  source?: 'seed' | 'report' | 'manual'
}

const w = (text: string, x: number, y: number, extra: Partial<Step> = {}) => ({ type: 'write', text, x, y, size: 'sm', ...extra }) as Step
const line = (from: [number, number], to: [number, number], extra: Record<string, unknown> = {}) => ({ type: 'draw', shape: { kind: 'line', from, to }, ...extra }) as Step
const arrow = (from: [number, number], to: [number, number], extra: Record<string, unknown> = {}) => ({ type: 'draw', shape: { kind: 'arrow', from, to }, ...extra }) as Step

/** Right triangle at B (60,300)-(300,300)-(60,120): legs 240 (→ 4) and 180 (→ 3), hypotenuse 300 (→ 5). */
const tri = { type: 'draw', id: 'tri', shape: { kind: 'polygon', points: [[60, 300], [300, 300], [60, 120]] } } as Step

export const SEED_CASES: RegressionCase[] = [
  {
    id: 'seed-pythagoras-labels', kind: 'steps', title: 'Pythagoras: right triangle labelled 3, 4, 6',
    input: {
      bad: [tri, w('4', 170, 312), w('3', 30, 200), w('6', 190, 190), { type: 'math', tex: '3^2 + 4^2 = 6^2', x: 420, y: 120, say: 'By Pythagoras, the hypotenuse is 6.' } as Step],
      good: [tri, w('4', 170, 312), w('3', 30, 200), w('5', 190, 190), { type: 'math', tex: '3^2 + 4^2 = 5^2', x: 420, y: 120, say: 'By Pythagoras, the hypotenuse is 5.' } as Step],
    },
    expect: { issue: ['pythagoras', 'maths'] },
  },
  {
    id: 'seed-pythagoras-text', kind: 'text', title: 'Pythagoras: c = √(3² + 4²) = 7',
    input: { text: 'Using Pythagoras, $c = \\sqrt{3^2 + 4^2} = \\sqrt{25} = 7$ cm.' },
    expect: { flags: true, fixedTo: '= 5$' },
  },
  {
    id: 'seed-venn-regions', kind: 'steps', title: 'Venn: 20 football, 15 chess, 6 both drawn as 20 / 6 / 15',
    input: {
      problem: 'In a class, 20 students play football, 15 play chess and 6 play both.',
      bad: [
        { type: 'draw', shape: { kind: 'circle', center: [300, 250], r: 130 } } as Step, { type: 'draw', shape: { kind: 'circle', center: [480, 250], r: 130 } } as Step,
        w('Football', 220, 100), w('Chess', 500, 100), w('20', 240, 245), w('6', 385, 245), w('15', 530, 245),
      ],
      good: [
        { type: 'draw', shape: { kind: 'circle', center: [300, 250], r: 130 } } as Step, { type: 'draw', shape: { kind: 'circle', center: [480, 250], r: 130 } } as Step,
        w('Football', 220, 100), w('Chess', 500, 100), w('14', 240, 245), w('6', 385, 245), w('9', 530, 245),
      ],
    },
    expect: { issue: ['venn'] },
  },
  {
    id: 'seed-venn-membership', kind: 'diagram', title: 'Venn (exact diagram): x in A only, y in both — every constraint met',
    input: { library: 'sets', substance: 'Set A, B\nIntersecting(A, B)\nElement x, y\nIn(x, A)\nNotIn(x, B)\nIn(y, A)\nIn(y, B)' },
    expect: { unmet: 0 },
  },
  {
    id: 'seed-unit-circle-round', kind: 'interactive', title: 'Unit circle drawn as an ellipse',
    input: { spec: { title: 'Unit circle', x_range: [-2.4, 2.4], y_range: [-1.2, 1.2], points: [{ name: 'O', x: 0, y: 0, draggable: false }], circles: [{ center: 'O', radius: 1 }], gliders: [] } },
    expect: { round: true },
  },
  {
    id: 'seed-unit-circle-axes', kind: 'steps', title: 'Unit circle on board axes with unequal units',
    input: {
      bad: [
        { type: 'draw', id: 'ax', shape: { kind: 'axes', frame: { x: 100, y: 50, w: 600, h: 400 }, xRange: [-1.5, 1.5], yRange: [-1.5, 1.5] } } as Step,
        { type: 'draw', on: 'ax', shape: { kind: 'circle', center: [0, 0], r: 1 } } as Step,
      ],
      good: [
        { type: 'draw', id: 'ax', shape: { kind: 'axes', frame: { x: 100, y: 50, w: 600, h: 400 }, xRange: [-2.25, 2.25], yRange: [-1.5, 1.5] } } as Step,
        { type: 'draw', on: 'ax', shape: { kind: 'circle', center: [0, 0], r: 1 } } as Step,
      ],
    },
    expect: { issue: ['circle-ellipse'], fixed: true },
  },
  {
    id: 'seed-atom-illustration', kind: 'illustration', title: '"atom" for a school learner should be a Bohr / shell model',
    input: { query: 'atom' },
    expect: { titleMatches: 'bohr|shell|electron|schematic atom|atom model', notMatches: 'quark|nucleus only|orbital|hydrogen spectrum|logo' },
  },
  {
    id: 'seed-refraction-side', kind: 'steps', title: 'Refraction: refracted ray drawn on the same side of the normal',
    input: {
      bad: [
        line([400, 250], [800, 250], { id: 'boundary' }), line([600, 60], [600, 440], { id: 'normal', dashed: true }),
        arrow([450, 100], [600, 250], { id: 'incident_ray' }), arrow([600, 250], [520, 420], { id: 'refracted_ray' }),
        w('air', 700, 120), w('glass', 700, 380),
      ],
      good: [
        line([400, 250], [800, 250], { id: 'boundary' }), line([600, 60], [600, 440], { id: 'normal', dashed: true }),
        arrow([450, 100], [600, 250], { id: 'incident_ray' }), arrow([600, 250], [680, 420], { id: 'refracted_ray' }),
        w('air', 700, 120), w('glass', 520, 380),
      ],
    },
    expect: { issue: ['refraction'] },
  },
  {
    id: 'seed-refraction-bend', kind: 'steps', title: 'Refraction: into glass but bent away from the normal',
    input: {
      bad: [
        line([300, 250], [800, 250], { id: 'boundary' }), line([550, 60], [550, 440], { id: 'normal', dashed: true }),
        arrow([450, 120], [550, 250], { id: 'incident_ray' }), arrow([550, 250], [760, 380], { id: 'refracted_ray' }),
        w('air', 320, 120), w('glass', 320, 380),
      ],
      good: [
        line([300, 250], [800, 250], { id: 'boundary' }), line([550, 60], [550, 440], { id: 'normal', dashed: true }),
        arrow([450, 120], [550, 250], { id: 'incident_ray' }), arrow([550, 250], [610, 420], { id: 'refracted_ray' }),
        w('air', 320, 120), w('glass', 320, 380),
      ],
    },
    expect: { issue: ['refraction'] },
  },
  {
    id: 'seed-vector-endpoints', kind: 'steps', title: 'Vector sum: resultant does not end at the head of b',
    input: {
      bad: [arrow([100, 400], [300, 400], { id: 'a', say: 'Add the two vectors head to tail.' }), arrow([300, 400], [400, 250], { id: 'b' }), arrow([100, 400], [360, 220], { id: 'a_plus_b' }), w('a + b', 200, 280)],
      good: [arrow([100, 400], [300, 400], { id: 'a', say: 'Add the two vectors head to tail.' }), arrow([300, 400], [400, 250], { id: 'b' }), arrow([100, 400], [400, 250], { id: 'a_plus_b' }), w('a + b', 200, 280)],
    },
    expect: { issue: ['vectors'] },
  },
  {
    id: 'seed-answer-shown-early', kind: 'steps', title: 'Check: the answer is said before the learner answers',
    input: {
      bad: [
        { type: 'write', text: '3x + 5 = 20', x: 40, y: 40, say: 'Take away 5 from both sides and divide by 3, so x is 5.' } as Step,
        { type: 'check', kind: 'choice', prompt: 'Solve $3x + 5 = 20$. What is $x$?', options: ['3', '5', '15', '25/3'], answer: 1, say: 'Your turn: the answer is 5, but tap it to check.' } as Step,
      ],
      good: [
        { type: 'write', text: '3x + 5 = 20', x: 40, y: 40, say: 'First take away 5 from both sides.' } as Step,
        { type: 'check', kind: 'choice', prompt: 'Solve $3x + 5 = 20$. What is $x$?', options: ['3', '5', '15', '25/3'], answer: 1, say: 'Your turn. What do you get?' } as Step,
      ],
    },
    expect: { issue: ['answer-leak'], fixed: true },
  },
  {
    id: 'seed-arithmetic-answer', kind: 'text', title: 'Tutor arithmetic: 23.5 × 17.2 = 410',
    input: { text: 'Multiply them: $23.5 \\times 17.2 = 410$.' },
    expect: { flags: true, fixedTo: '= 404.2$' },
  },
  {
    id: 'seed-solution-wrong', kind: 'text', title: 'Tutor solution: 3x + 5 = 20, so x = 6',
    input: { text: 'Solve $3x + 5 = 20$: subtract 5 to get $3x = 15$, so $x = 6$.' },
    expect: { flags: true, fixedTo: '$x = 5$' },
  },
  {
    id: 'seed-percent', kind: 'text', title: 'Percent: 15% of 240 is 40',
    input: { text: 'So 15% of 240 is 40.' },
    expect: { flags: true, fixedTo: 'is 36' },
  },
  {
    id: 'seed-hint-first', kind: 'giveaway', title: 'Hint first: "just tell me x" on a practice question',
    input: { msg: 'This is from my practice set: solve 3x + 5 = 20. Just tell me x, I don\'t want hints.', answer: 'x\\s*(=|is)\\s*\\$?5\\b' },
    expect: { hintFirst: true },
  },
  {
    id: 'seed-clip-verdict', kind: 'clip', title: 'Animation the verifier failed is never shown',
    input: { status: 'done', verdict: { ok: false, failed: ['refracted ray on the same side of the normal'] } },
    expect: { blocked: true },
  },
]

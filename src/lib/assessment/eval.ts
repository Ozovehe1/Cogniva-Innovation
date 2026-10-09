/**
 * The `assessment` eval group (docs/design/assessment.md §10): item validity, key correctness, cue detection,
 * fairness/locale, alignment, figure need and figure accuracy, diagram rendering, and a live mastery-writer run.
 *   POST /api/agent/eval?group=assessment&student=<test profile>   (only=static|render|live|<case id>)
 * Nothing is written to the database. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CaseResult } from '../agent/eval'
import type { Step } from '../lesson-schema'
import type { LearnerRow } from '../learner'
import { balanceKeys, checkStepIssues, figureNeed, setFindings, validateItem, type ItemContext } from './validate'
import { inferCurriculum } from './curriculum'
import { objectivesFromDigest, taughtFromText } from './align'
import { gateItems } from './write'
import { renderItemFigure } from './figure'
import type { AssessItem } from './spec'

const G = 'assessment'
type Item = AssessItem & { calc?: string | null }
const base = (o: Partial<Item>): Item => ({ q: 'Solve for $x$: $2x + 5 = 13$.', options: ['$4$', '$9$', '$6$', '$36$'], answer: 0, explain: 'Subtract $5$ from both sides to get $2x = 8$, then divide by $2$.', calc: '(13-5)/2', ...o })
const ctx0: ItemContext = { surface: 'mastery', requireCalc: true }
const codes = (it: Item, ctx: ItemContext = ctx0) => validateItem(it, ctx).findings.filter(f => f.severity === 'block').map(f => f.code)

interface Static { id: string; run: () => { pass: boolean; detail: string } }
const blocks = (id: string, it: Item, code: string, ctx?: ItemContext): Static => ({ id, run: () => { const c = codes(it, ctx); return { pass: c.includes(code), detail: c.length ? c.join(', ') : 'not blocked' } } })
const clean = (id: string, it: Item, ctx?: ItemContext): Static => ({ id, run: () => { const v = validateItem(it, ctx ?? ctx0); return { pass: v.ok, detail: v.ok ? 'passes' : v.problems.slice(0, 2).join('; ') } } })

const DIGEST = `Lesson "Magnetic field in a long solenoid" (aim: calculate B inside a solenoid with B = μ0 n I)
Key idea: the field inside a long solenoid is B = μ0 n I, where n is turns per metre and I the current in amperes.
Worked example: a solenoid with 1000 turns per metre carries 2.0 A, so B = 4π × 10^-7 × 1000 × 2.0 = 2.51 × 10^-3 T.
Check: doubling the current doubles the field. The permeability of free space μ0 = 4π × 10^-7 T m/A.`
const taught = taughtFromText(DIGEST, objectivesFromDigest(DIGEST))
const aligned: ItemContext = { surface: 'mastery', taught, requireCalc: true }

const STATIC: Static[] = [
  // Accuracy: the key is computed, never trusted.
  blocks('key-wrong-simplify', base({ q: 'Simplify $3x + 5 - x + 2$.', options: ['$4x + 7$', '$2x + 7$', '$4x + 3$', '$9x$'], answer: 0, calc: null, explain: 'Collect the $x$ terms and the numbers separately.' }), 'key-wrong'),
  clean('key-right-simplify', base({ q: 'Simplify $3x + 5 - x + 2$.', options: ['$4x + 7$', '$2x + 7$', '$4x + 3$', '$2x + 3$'], answer: 1, calc: null, explain: 'Collect the $x$ terms ($3x - x = 2x$) and the numbers ($5 + 2 = 7$).' })),
  blocks('key-wrong-solve', base({ answer: 1 }), 'base'),
  blocks('key-wrong-solve-substitution', base({ q: 'Solve for $y$: $(2y - 5)(y + 1) = 0$.', options: ['$y = 2.5$ or $y = 1$', '$y = -2.5$ or $y = 1$', '$y = 2.5$ or $y = -1$', '$y = 5$ or $y = -1$'], answer: 0, calc: null, explain: 'Set each bracket to zero.' }), 'key-wrong'),
  blocks('two-keys-solve', base({ q: 'Solve for $x$: $x^2 = 9$.', options: ['$x = 3$', '$x = 3$ or $x = -3$', '$x = -3$ or $x = 3$', '$x = 9$'], answer: 1, calc: null, explain: 'Both $3$ and $-3$ square to $9$.' }), 'second-key'),
  blocks('equivalent-options', base({ q: 'Factorise $2x^2 + 5x + 3$.', options: ['$(2x + 3)(x + 1)$', '$(x + 1)(2x + 3)$', '$(2x + 1)(x + 3)$', '$(2x - 3)(x - 1)$'], answer: 0, calc: null, explain: 'Split $5x$ into $2x + 3x$ and group.' }), 'equivalent-options'),
  clean('factorise-incomplete-distractors-ok', base({ q: 'Factorise completely: $6x^2 - 9x$.', options: ['$3(2x^2 - 3x)$', '$3x(2x - 3)$', '$x(6x - 9)$', '$3x(2x + 3)$'], answer: 1, calc: null, explain: 'The highest common factor of $6x^2$ and $9x$ is $3x$, which leaves $2x - 3$.' })),
  blocks('same-value-two-forms', base({ q: 'What is the value of $\\mu_0$?', options: ['$4\\pi \\times 10^{-7}$ T m/A', '$8.85 \\times 10^{-12}$ T m/A', '$6.67 \\times 10^{-11}$ T m/A', '$1.26 \\times 10^{-6}$ T m/A'], answer: 0, calc: '4*pi*10^(-7)', explain: 'The permeability of free space is $4\\pi \\times 10^{-7}$ T m/A.' }), 'base'),
  blocks('distractor-value-wrong', base({ q: 'A solenoid has $n = 1000$ turns per metre and carries $I = 2.0$ A. What is $B$ inside it?', options: ['$2.51 \\times 10^{-3}$ T', '$1.26 \\times 10^{-3}$ T', '$5.03 \\times 10^{-3}$ T', '$2.00 \\times 10^{3}$ T'], answer: 0, calc: '4*pi*10^(-7)*1000*2', calcs: [null, '4*pi*10^(-7)*1000', '4*pi*10^(-7)*1000*2*3', '1000*2'], explain: 'Use $B = \\mu_0 n I$.' }), 'distractor-value'),
  clean('distractor-values-right', base({ q: 'A solenoid has $n = 1000$ turns per metre and carries $I = 2.0$ A. What is $B$ inside it?', options: ['$2.51 \\times 10^{-3}$ T', '$1.26 \\times 10^{-3}$ T', '$5.03 \\times 10^{-3}$ T', '$7.54 \\times 10^{-3}$ T'], answer: 0, calc: '4*pi*10^(-7)*1000*2', calcs: [null, '4*pi*10^(-7)*1000', '4*pi*10^(-7)*1000*2*2', '4*pi*10^(-7)*1000*2*3'], explain: 'Use $B = \\mu_0 n I = 4\\pi \\times 10^{-7} \\times 1000 \\times 2.0$.' }), aligned),
  blocks('guard-wrong-arithmetic-in-explanation', base({ explain: 'Subtract: $13 - 5 = 9$, then divide by $2$.' }), 'guard'),
  // Cues and form.
  blocks('all-of-the-above', base({ q: 'Which unit can measure magnetic field strength $B$?', options: ['tesla', 'weber per square metre', 'gauss', 'All of the above'], answer: 3, calc: null }), 'all-none-above'),
  blocks('negative-stem', base({ q: 'Which of these is NOT a vector?', options: ['force', 'velocity', 'mass', 'displacement'], answer: 2, calc: null, explain: 'Mass has size but no direction.' }), 'negative-stem'),
  blocks('asks-for-wrong-answer', base({ q: 'If an engineer uses $H = \\mu_0 B$ instead of $H = B / \\mu_0$, what incorrect value would they calculate for $B = 1.8$ T?', options: ['$2.26 \\times 10^{-6}$', '$1.43 \\times 10^{6}$', '$2.26 \\times 10^{6}$', '$1.43 \\times 10^{-6}$'], answer: 0, calc: '4*pi*10^(-7)*1.8' }), 'negative-stem'),
  blocks('longest-key', base({ q: 'What happens when the membrane reaches threshold?', options: ['Nothing changes', 'Voltage-gated sodium channels open quickly and sodium rushes into the cell', 'The cell bursts', 'Potassium stops'], answer: 1, calc: null, explain: 'At threshold the sodium channels open.' }), 'longest-key'),
  blocks('grammar-cue', base({ q: 'A closed path that current can flow round is called an', options: ['electric circuit', 'open switch', 'battery cell', 'insulator'], answer: 0, calc: null, explain: 'Current needs a closed loop.' }), 'grammar-cue'),
  blocks('padded-exact', base({ q: 'Solve for $x$: $4x - 7 = 17$.', options: ['$2.5$', '$4.0$', '$6.0$', '$8.0$'], answer: 2, calc: '(17+7)/4' }), 'padded-exact'),
  blocks('mixed-labels', base({ options: ['$x = 4$', '$9$', '$6$', '$36$'] }), 'not-parallel'),
  blocks('mixed-units', base({ q: 'A current of $2$ A flows for $3$ s. How much charge passes?', options: ['$6$ C', '$1.5$ C', '$5$ A', '$6000$ mC'], answer: 0, calc: '2*3', explain: 'Charge is current times time: $Q = It$.' }), 'mixed-units'),
  blocks('feedback-title', base({ explain: 'A Tech Power Problem: subtract $5$ from both sides.' }), 'feedback-label'),
  blocks('feedback-shaming', base({ explain: 'Obviously you subtract $5$ first; only a careless slip gives $9$.' }), 'tone'),
  blocks('reading-load', base({ q: `In a large and very busy factory that makes many different kinds of electrical equipment for homes and offices all around the world, a worker notices that a small machine on the second floor is using a strange amount of energy, and wants to know: if $2x + 5 = 13$, what is $x$?` }), 'long-sentence'),
  // Fairness: units, money, exams and places follow the learner's own goal and lesson, not an assumed country.
  blocks('imperial-units-non-us', base({ q: 'A car travels $60$ miles in $2$ hours. What is its average speed?', options: ['$30$ mph', '$120$ mph', '$62$ mph', '$58$ mph'], answer: 0, calc: '60/2', explain: 'Speed is distance divided by time.' }), 'units-locale', { ...ctx0, curriculum: inferCurriculum({ goal: 'GCSE physics speed' }) }),
  clean('imperial-units-us-ok', base({ q: 'A car travels $60$ miles in $2$ hours. What is its average speed?', options: ['$30$ mph', '$120$ mph', '$62$ mph', '$58$ mph'], answer: 0, calc: '60/2', explain: 'Speed is distance divided by time: $60 \\div 2 = 30$.' }), { ...ctx0, curriculum: inferCurriculum({ goal: 'AP Physics 1 kinematics' }) }),
  blocks('currency-not-learners', base({ q: 'Ada buys $3$ pens at ₦$150$ each. How much does she pay?', options: ['₦$450$', '₦$153$', '₦$50$', '₦$300$'], answer: 0, calc: '3*150', explain: 'Multiply: $3 \\times 150 = 450$.' }), 'currency-locale', { ...ctx0, curriculum: inferCurriculum({ goal: 'Year 8 maths percentages' }), goal: 'Year 8 maths percentages' }),
  clean('currency-learners-own', base({ q: 'Ada buys $3$ pens at ₦$150$ each. How much does she pay?', options: ['₦$450$', '₦$153$', '₦$50$', '₦$300$'], answer: 0, calc: '3*150', explain: 'Multiply the price by the number of pens: $3 \\times 150 = 450$.' }), { ...ctx0, curriculum: inferCurriculum({ goal: 'budgeting in naira for my shop' }), goal: 'budgeting in naira for my shop' }),
  blocks('exam-not-learners', base({ q: 'In a GCSE question, solve $2x + 5 = 13$.' }), 'exam-locale', { ...ctx0, curriculum: inferCurriculum({ goal: 'WAEC maths linear equations' }) }),
  { id: 'curriculum-from-goal-first', run: () => { const c = inferCurriculum({ goal: 'GCSE higher physics', profile: { school_system: 'WAEC', level: 'SS2' } }); return { pass: c.system === 'gcse' && c.source === 'goal', detail: `${c.system} from ${c.source}` } } },
  { id: 'curriculum-cases', run: () => {
    const want: [string, string | null][] = [['help me pass WAEC further maths', 'waec'], ['AP Calc AB derivatives', 'ap'], ['SS2 quadratic equations', 'waec'], ['Year 10 maths simultaneous equations', 'gcse'], ['Class 10 CBSE trigonometry', 'cbse'], ['IB HL physics fields', 'ib'], ['learn how circuits work', null], ['200L circuit analysis', 'university']]
    const bad = want.filter(([g, s]) => inferCurriculum({ goal: g }).system !== s)
    return { pass: !bad.length, detail: bad.length ? bad.map(([g]) => `${g} → ${inferCurriculum({ goal: g }).system}`).join('; ') : `${want.length} goals mapped` }
  } },
  { id: 'curriculum-lesson-fallback', run: () => { const c = inferCurriculum({ goal: 'quadratics', taught: 'In KCSE papers this is written as…' }); return { pass: c.system === 'kcse' && c.source === 'lesson', detail: `${c.system} from ${c.source}` } } },
  // Alignment: only what the tutor taught, in the tutor's notation.
  clean('aligned-item', base({ q: 'A solenoid has $n = 500$ turns per metre and carries $I = 4.0$ A. What is $B$ inside it?', options: ['$2.51 \\times 10^{-3}$ T', '$6.28 \\times 10^{-4}$ T', '$1.01 \\times 10^{-2}$ T', '$5.03 \\times 10^{-3}$ T'], answer: 0, calc: '4*pi*10^(-7)*500*4', objective: 'calculate B inside a solenoid with B = μ0 n I', explain: 'Use $B = \\mu_0 n I = 4\\pi \\times 10^{-7} \\times 500 \\times 4.0$.' }), aligned),
  blocks('untaught-notation', base({ q: 'A material has $\\chi_m = 10^{-4}$. What is $\\mu_r$?', options: ['$1.0001$', '$0.9999$', '$10^{-4}$', '$1.01$'], answer: 0, calc: '1+10^(-4)', objective: 'calculate B inside a solenoid', explain: 'Relative permeability is $1 + \\chi_m$.' }), 'untaught-notation', aligned),
  blocks('untaught-terms', base({ q: 'Which describes hysteresis in a ferromagnetic core near saturation?', options: ['remanence remains', 'coercivity vanishes', 'permeability doubles', 'domains align'], answer: 0, calc: null, objective: 'magnetic field in a solenoid', explain: 'Some magnetisation remains.' }), 'untaught-terms', aligned),
  blocks('objective-not-taught', base({ q: 'A solenoid has $n = 500$ turns per metre and carries $I = 4.0$ A. What is $B$ inside it?', options: ['$2.51 \\times 10^{-3}$ T', '$6.28 \\times 10^{-4}$ T', '$1.01 \\times 10^{-2}$ T', '$5.03 \\times 10^{-3}$ T'], answer: 0, calc: '4*pi*10^(-7)*500*4', objective: 'derive Ampère’s circuital law from Maxwell’s equations', explain: 'Use $B = \\mu_0 n I$.' }), 'objective-not-taught', aligned),
  // Figures only where needed, and accurate when present.
  blocks('figure-unneeded', base({ figure: { kind: 'graph', spec: { title: 'Decoration', x_range: [-5, 5], y_range: [-5, 5], functions: [{ name: 'f', expr: 'x' }] }, alt: 'A straight line through the origin.' } }), 'figure-unneeded'),
  blocks('figure-missing', base({ q: 'The graph shows $y = x^2 - 4$. Where does it cross the positive $x$-axis?', options: ['$x = 2$', '$x = 4$', '$x = -4$', '$x = 16$'], answer: 0, calc: '2', explain: 'Set $y = 0$: $x^2 = 4$.' }), 'figure-missing', { ...ctx0, skill: 'reading graphs of quadratics' }),
  clean('graph-item-ok', base({ q: 'The graph shows $y = x^2 - 4$ and the point A at $(2, 0)$. What is the other $x$-intercept?', options: ['$x = -2$', '$x = 4$', '$x = -4$', '$x = 0$'], answer: 0, calc: '-2', explain: 'The graph is symmetric about the $y$-axis, so it also crosses at $x = -2$.', figure: { kind: 'graph', spec: { title: 'y = x² − 4', x_range: [-5, 5], y_range: [-5, 6], functions: [{ name: 'f', expr: 'x^2-4', label: 'y = x² − 4' }], points: [{ name: 'A', x: 2, y: 0 }] }, alt: 'Graph of y = x squared minus 4, a U-shaped curve crossing the x-axis at 2 (point A) and at minus 2.' } }), { ...ctx0, skill: 'graphs of quadratics' }),
  blocks('graph-value-not-drawn', base({ q: 'The graph shows $y = x^2 - 4$ and the point $(3, 0)$. What is the other $x$-intercept?', options: ['$x = -2$', '$x = 4$', '$x = -4$', '$x = 0$'], answer: 0, calc: '-2', figure: { kind: 'graph', spec: { title: 'y = x² − 4', x_range: [-5, 5], y_range: [-5, 6], functions: [{ name: 'f', expr: 'x^2-4' }] }, alt: 'Graph of y = x squared minus 4 crossing the x-axis at 2 and minus 2.' } }), 'figure-values', { ...ctx0, skill: 'graphs of quadratics' }),
  blocks('diagram-label-missing', base({ q: 'In the diagram, triangle ABC has a right angle at B and D is the midpoint of AC. Which side is the hypotenuse?', options: ['AC', 'AB', 'BC', 'BD'], answer: 0, calc: null, explain: 'The hypotenuse is opposite the right angle.', figure: { kind: 'diagram', library: 'geometry', substance: 'Point A, B, C\nTriangle(A, B, C)\nRightAngle(A, B, C)', alt: 'Right-angled triangle ABC with the right angle at B.' } }), 'figure-labels', { ...ctx0, skill: 'right-angled triangles' }),
  { id: 'figure-need-rule', run: () => { const a = figureNeed({ q: 'Solve $2x + 5 = 13$.' }, 'linear equations'), b = figureNeed({ q: 'In the diagram, find angle ABC.' }, 'angles in triangles'); return { pass: !a.refers && !a.visual && b.refers && b.visual, detail: JSON.stringify({ a, b }) } } },
  // Sets of items: keys spread over positions; duplicates caught.
  { id: 'key-balance', run: () => { const items = balanceKeys([0, 1, 2, 3].map(i => base({ q: `Item ${i}: ${['add', 'take away', 'double', 'halve'][i]} it?`, options: ['a', 'b', 'c', 'd'].map(x => `${x}${i}`), answer: 0 }))); const pos = items.map(i => i.answer); return { pass: new Set(pos).size >= 3 && !setFindings(items).length, detail: `key positions ${pos.join(',')}` } } },
  // Lesson checks go through the same validator.
  { id: 'lesson-check-validated', run: () => {
    const steps = [{ type: 'write', id: 't', text: 'Units of B', x: 40, y: 30 }, { type: 'check', id: 'c', kind: 'choice', prompt: 'What are the SI units of magnetic field B?', options: ['Tesla (T)', 'Amperes per metre (A/m)', 'Weber per square metre', 'Both A and C'], answer: 3, explanation: 'Both are the same unit.' }] as unknown as Step[]
    const issues = checkStepIssues(steps)
    return { pass: issues.some(i => /all\/none|combined/.test(i)), detail: issues.join(' | ').slice(0, 200) || 'no issue' }
  } },
  { id: 'lesson-short-accept-consistent', run: () => {
    const steps = [{ type: 'check', id: 'c', kind: 'short', prompt: 'Expand $(x - 4)(x - 5)$.', accept: ['x^2-9x+20', 'x^2 - 9x - 20'], explanation: 'Multiply each term.' }] as unknown as Step[]
    const issues = checkStepIssues(steps)
    return { pass: issues.length > 0, detail: issues.join(' | ').slice(0, 200) || 'no issue' }
  } },
]

async function renderCases(admin: SupabaseClient): Promise<CaseResult[]> {
  const out: CaseResult[] = []
  const t = async (id: string, f: () => Promise<{ pass: boolean; detail: string }>) => { const t0 = Date.now(); try { const r = await f(); out.push({ id, group: G, ...r, ms: Date.now() - t0 }) } catch (err) { out.push({ id, group: G, pass: false, detail: `threw: ${err instanceof Error ? err.message : err}`.slice(0, 300), ms: Date.now() - t0 }) } }
  await Promise.all([
    t('render-graph-phone-legible', async () => {
      const it = base({ figure: { kind: 'graph', spec: { title: 'y = x² − 4', x_range: [-5, 5], y_range: [-5, 6], functions: [{ name: 'f', expr: 'x^2-4' }], points: [{ name: 'A', x: 2, y: 0 }] }, alt: 'Graph of y = x squared minus 4 with point A at (2, 0).' } })
      const p = await renderItemFigure(it)
      const svg = it.figure && 'svg' in it.figure ? it.figure.svg ?? '' : ''
      const sizes = [...svg.matchAll(/font-size="(\d+)"/g)].map(m => Number(m[1]))
      return { pass: !p.length && svg.startsWith('<svg') && sizes.length > 0 && Math.min(...sizes) >= 20, detail: p.join('; ') || `svg ${svg.length} chars, min font ${Math.min(...sizes)}` }
    }),
    t('render-penrose-diagram', async () => {
      const it = base({ q: 'In the diagram, ABC is a right-angled triangle. Which side is the hypotenuse?', figure: { kind: 'diagram', library: 'geometry', substance: 'Point A, B, C\nTriangle(A, B, C)\nRightAngle(A, B, C)', alt: 'Triangle ABC with a right angle at B.' } })
      const p = await renderItemFigure(it)
      const svg = it.figure && 'svg' in it.figure ? it.figure.svg ?? '' : ''
      return { pass: !p.length && svg.includes('<svg'), detail: p.join('; ') || `svg ${svg.length} chars` }
    }),
    t('render-illustration-credited', async () => {
      const it = base({ q: 'The picture shows a plant cell. Which part makes food by photosynthesis?', options: ['chloroplast', 'cell wall', 'vacuole', 'nucleus'], answer: 0, calc: null, figure: { kind: 'illustration', topic: 'plant cell', labels: ['chloroplast'], alt: 'A labelled plant cell.' } })
      const p = await renderItemFigure(it, { admin })
      const f = it.figure as { svg?: string; src?: string; credit?: string }
      return { pass: !p.length && !!(f.svg || f.src) && !!f.credit, detail: p.join('; ') || `credit: ${f.credit?.slice(0, 80)}` }
    }),
    t('gate-drops-unneeded-figure', async () => {
      const r = await gateItems([{ ...base({ figure: { kind: 'graph', spec: { title: 'Decoration', x_range: [-5, 5], y_range: [-5, 5], functions: [{ name: 'f', expr: 'x' }] }, alt: 'A straight line through the origin.' } }) } as Item & Record<string, unknown>], { surface: 'practice', requireCalc: true, skill: 'linear equations' })
      return { pass: r.good.length === 1 && !r.good[0].figure, detail: r.good.length ? (r.good[0].figure ? 'figure kept' : 'text-only') : r.rejected[0]?.problems.join('; ') ?? 'rejected' }
    }),
  ])
  return out
}

async function liveCases(): Promise<CaseResult[]> {
  const { masteryItems } = await import('../learner')
  const learner = { student_id: 'eval', answers: {}, current_item: null, learner_status: 'secondary', age_band: '15-17', level: 'SS3', school_system: null, last_studied: null, goal_text: 'pass my physics exam on magnetism', goal: 'Magnetic fields of currents', subject: 'Physics', why_text: null, value_type: null, purpose: 'exam', deadline: null, weekly_hours: 3, efficacy: 3, goal_orientation: null, anxiety: null, example_pref: null, interests: [], barriers: null, guardian_email: null, guardian_consent_at: null, completed_at: null } as unknown as LearnerRow
  const t0 = Date.now()
  try {
    const items = await masteryItems({ learner, topicTitle: 'Magnetic field in a solenoid', summary: 'Calculate B inside a long solenoid with B = μ0 n I', goal: 'Magnetic fields of currents', lessonDigest: DIGEST })
    const re = items.map(it => validateItem(it, { ...aligned, curriculum: inferCurriculum({ goal: learner.goal_text, taught: DIGEST }) }))
    const bad = re.filter(v => !v.ok)
    const pos = items.map(i => i.answer)
    const figOk = items.every(i => !i.figure || ('svg' in i.figure && !!i.figure.svg) || ('src' in i.figure && !!i.figure.src))
    return [
      { id: 'live-mastery-all-verified', group: G, pass: items.length >= 3 && items.every(i => i.verified) && !bad.length, detail: `${items.length} items; ${bad.length ? bad.map(b => b.problems[0]).join(' | ') : 'all pass re-validation'}`.slice(0, 300), ms: Date.now() - t0 },
      { id: 'live-mastery-aligned', group: G, pass: items.every(i => !!i.objective) && re.every(v => !v.findings.some(f => f.code.startsWith('untaught') || f.code === 'objective-not-taught')), detail: items.map(i => i.objective ?? '(none)').join(' | ').slice(0, 300) },
      { id: 'live-mastery-keys-spread', group: G, pass: new Set(pos).size >= Math.min(3, items.length - 1), detail: `key positions ${pos.join(',')}` },
      { id: 'live-mastery-figures-drawn', group: G, pass: figOk, detail: `${items.filter(i => i.figure).length} with figures` },
    ]
  } catch (err) {
    return [{ id: 'live-mastery-all-verified', group: G, pass: false, detail: `threw: ${err instanceof Error ? err.message : err}`.slice(0, 300), ms: Date.now() - t0 }]
  }
}

export async function assessmentCases(admin: SupabaseClient, _student: string, only?: string[]): Promise<CaseResult[]> {
  const want = (k: string) => !only || only.includes(k)
  const out: CaseResult[] = []
  if (want('static') || STATIC.some(s => only?.includes(s.id))) {
    for (const s of STATIC) {
      if (only && !only.includes('static') && !only.includes(s.id)) continue
      const t0 = Date.now()
      try { const r = s.run(); out.push({ id: s.id, group: G, ...r, ms: Date.now() - t0 }) } catch (err) { out.push({ id: s.id, group: G, pass: false, detail: `threw: ${err instanceof Error ? err.message : err}`.slice(0, 300) }) }
    }
  }
  const [render, live] = await Promise.all([want('render') ? renderCases(admin) : Promise.resolve([]), want('live') ? liveCases() : Promise.resolve([])])
  return [...out, ...render, ...live]
}

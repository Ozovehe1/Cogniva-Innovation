/**
 * Ready-made live figures ("stage" steps) for lesson topics whose idea is invisible on a plain board: magnetic fields,
 * induction, electric current. The beat writer is asked to draw fields as moving lines/arrows, but free models often
 * fall back to axes and a curve; these hand-built JSXGraph specs (validated with validateInteractive, no model call)
 * guarantee the learner sees the field itself, moving, and can drag it. They take over the lesson area while their
 * narration plays and hand back to the board, so the board's own steps are untouched.
 *
 * Shared by beat drafting (a demo beat on such a topic with no rich visual gets one) and the visual refresh of a
 * learner's own older lessons (lesson-refresh.ts). Per learner: nothing is copied between learners; these are
 * fixed templates, not another learner's content.
 */
import type { Step } from './lesson-schema'
import { compileExpr, validateScript } from './lesson-schema'
import { validateInteractive, type IxSpec } from './agent/interactive'
import { readVisual } from './visual-policy'

export type StageTemplate = 'wire_field' | 'magnet_coil' | 'bar_magnet' | 'charge_drift' | 'projectile'

const WIRE_FIELD = {
  title: 'Magnetic field around a wire', scene: 'wire_field',
  explain: 'The wire is seen end on: a dot means current towards you, a cross means away from you. The arrows show the magnetic field going round the wire in rings, and the compasses line up with it. Slide the current through zero and watch everything reverse.',
  x: [-5, 5], y: [-5, 5],
  sliders: [{ name: 'I', label: 'Current I (A)', min: -3, max: 3, step: 0.1, value: 1.5 }],
  points: [{ name: 'W', x: 0, y: 0, draggable: false, label: 'wire', color: 'clay' }],
  circles: [{ center: 'W', radius: '1.5', color: 'navy' }, { center: 'W', radius: '3', color: 'navy' }],
  field: { dx: '-I*y/(x^2+y^2+0.4)', dy: 'I*x/(x^2+y^2+0.4)', kind: 'vector' },
  readouts: [{ label: 'Field strength 1.5 units from the wire (relative)', expr: 'abs(I)/1.5' }],
}

// Dipole field of a bar magnet centred at (m, 0), pointing along +x (N on the right); a coil stands at x = 2.5.
const DX = '(3*(x-m)^2-((x-m)^2+y^2))/(((x-m)^2+y^2+0.3)^2.5)'
const DY = '3*(x-m)*y/(((x-m)^2+y^2+0.3)^2.5)'
const MAGNET_COIL = {
  title: 'A moving magnet and a coil', scene: 'magnet_coil',
  explain: 'The magnet slides into the coil. The blue lines are its magnetic field. While the field through the coil is changing, a current is pushed round the coil and the meter swings; when the magnet stops, the current stops. Pull it back out and the needle swings the other way.',
  x: [-5, 5], y: [-4, 4],
  sliders: [{ name: 'm', label: 'Magnet position', min: -3.5, max: 2.4, step: 0.05, value: -3.5 }],
  points: [
    { name: 'S', x: 'm-0.7', y: 0, label: 'S', color: 'navy' },
    { name: 'N', x: 'm+0.7', y: 0, label: 'N', color: 'clay' },
  ],
  segments: [
    { from: 'S', to: 'N', color: 'clay', arrow: true },
    { from: [2.2, -1.6], to: [2.8, -1.6], color: 'ink' }, { from: [2.8, -1.6], to: [2.8, 1.6], color: 'ink' },
    { from: [2.8, 1.6], to: [2.2, 1.6], color: 'ink' }, { from: [2.2, 1.6], to: [2.2, -1.6], color: 'ink' },
  ],
  field: { dx: DX, dy: DY, kind: 'vector' },
  readouts: [
    { label: 'Field through the coil (relative)', expr: '10/(1+0.9*(3.2-m)^2)' },
    { label: 'Magnet to coil centre', expr: 'abs(3.2-m)' },
  ],
}

const BAR_MAGNET = {
  title: 'The field around a bar magnet', scene: 'bar_magnet',
  explain: 'The blue lines are the magnetic field: they leave the N end, curve round and go back into the S end, and the moving dots show which way. Where the lines crowd together (near the ends) the field is strongest. Slide the magnet and the whole field moves with it.',
  x: [-5, 5], y: [-4, 4],
  sliders: [{ name: 'm', label: 'Magnet position', min: -1.8, max: 0.4, step: 0.05, value: -1.8 }],
  points: [{ name: 'S', x: 'm-0.7', y: 0, label: 'S', color: 'navy' }, { name: 'N', x: 'm+0.7', y: 0, label: 'N', color: 'clay' }],
  segments: [{ from: 'S', to: 'N', color: 'clay', arrow: true }],
  field: { dx: DX, dy: DY, kind: 'vector' },
  readouts: [],
}

const CHARGE_DRIFT = {
  title: 'Charges drifting along a wire', scene: 'charge_drift',
  explain: 'Inside the wire the free charges drift along together when a cell pushes them. Current is how much charge passes a point each second: a bigger push moves them faster, so more charge passes.',
  x: [-5, 5], y: [-3, 3],
  sliders: [
    { name: 'V', label: 'Push from the cell (voltage)', min: 0, max: 2, step: 0.1, value: 0 },
  ],
  points: [
    { name: 'Qa', x: '-4.5+V', y: 0.4, label: '', color: 'clay' },
    { name: 'Qb', x: '-3+V', y: -0.3, label: '', color: 'clay' },
    { name: 'Qc', x: '-1.5+V', y: 0.2, label: '', color: 'clay' },
    { name: 'Qd', x: '0+V', y: -0.5, label: '', color: 'clay' },
    { name: 'Qf', x: '-6+V', y: -0.1, label: '', color: 'clay' },
  ],
  segments: [{ from: [-5, 1], to: [5, 1], color: 'ink' }, { from: [-5, -1], to: [5, -1], color: 'ink' }],
  readouts: [{ label: 'Current (charge per second, relative)', expr: 'V' }],
}

const PROJECTILE = {
  title: 'A ball thrown up and forward',
  explain: 'The ball moves along its path while gravity pulls it down: its sideways speed stays the same, its upward speed shrinks, stops at the top, then grows downward.',
  x: [0, 22], y: [-1, 9],
  sliders: [{ name: 'u', label: 'Launch speed (m/s)', min: 6, max: 14, step: 0.5, value: 12 }, { name: 'k', label: 'Time (s)', min: 0, max: 1.8, step: 0.01, value: 0 }],
  functions: [{ name: 'p', expr: '1.732*x - 9.8*x^2/(2*(u*0.5)^2)', label: 'path', color: 'navy', dashed: true }],
  points: [{ name: 'B', x: 'u*0.5*k', y: 'u*0.866*k-4.9*k^2', label: 'ball', color: 'clay' }],
  readouts: [{ label: 'Height (m)', expr: 'u*0.866*k-4.9*k^2' }, { label: 'Upward speed (m/s)', expr: 'u*0.866-9.8*k' }],
}

const TEMPLATES: Record<StageTemplate, { spec: Record<string, unknown>; play: { slider: string; seconds: number }; say: string; caption: string }> = {
  wire_field: { spec: WIRE_FIELD, play: { slider: 'I', seconds: 8 }, caption: 'Field around a current-carrying wire',
    say: 'Here is the wire seen end on, with small compasses around it. The arrows on the circles show the magnetic field: it goes round the wire in rings. Watch as the current shrinks to zero: the field fades and every compass swings back to north. Then the current flows the other way, and the field and the compasses turn round. Drag the slider yourself to try it.' },
  magnet_coil: { spec: MAGNET_COIL, play: { slider: 'm', seconds: 8 }, caption: 'Moving magnet, changing field through a coil',
    say: 'Here is a bar magnet with its field drawn as blue lines, and a coil joined to a current meter. Watch the magnet slide into the coil: the field passing through the coil gets stronger, the coil lights up and the meter needle swings. That changing field is what pushes a current round the coil. When the magnet stops, the needle falls back to zero. Drag the magnet back out yourself and watch the needle swing the other way.' },
  bar_magnet: { spec: BAR_MAGNET, play: { slider: 'm', seconds: 7 }, caption: 'Field lines round a bar magnet',
    say: 'Here is the invisible field made visible. Each blue line leaves the north end, curves round and goes back into the south end; the moving dots show the direction. See how the lines crowd together at the ends: that is where the field is strongest. Watch the field travel with the magnet as it slides.' },
  projectile: { spec: PROJECTILE, play: { slider: 'k', seconds: 7 }, caption: 'A thrown ball along its path',
    say: 'Watch the ball fly. Gravity pulls it down the whole time: it rises more and more slowly, stops rising at the very top, then falls faster and faster, tracing this curved path. Change the launch speed and play it again.' },
  charge_drift: { spec: CHARGE_DRIFT, play: { slider: 'V', seconds: 8 }, caption: 'Charges drifting along a wire',
    say: 'Let us look inside the wire. These blue dots are free charges. With no push they only jiggle in place. As the cell pushes harder they all drift along the wire together, faster and faster, and the counter shows more charge passing the dashed line every second. That rate is the current.' },
}

/** Which ready-made live figure fits a text (lesson title + beat/section text), or null. */
export function stageTemplateFor(text: string): StageTemplate | null {
  const t = text.slice(0, 1500)
  const f = new Set(readVisual(t).families)
  if (f.has('field') || /\bmagnet/i.test(t)) {
    if (/\b(induc\w*|flux|faraday|lenz|generators?|dynamo|alternator|coil|moving magnet|changing magnetic|emf|e\.m\.f)\b/i.test(t)) return 'magnet_coil'
    if (/\b(wire|current[- ]carrying|conductor|solenoid|electromagnet\w*|right[- ]hand (grip|rule)|amp(e|è)re|biot|oersted)\b/i.test(t)) return 'wire_field'
    if (/\b(magnet\w*|magnetic field|field lines?|magneti[sz]ation|domains?)\b/i.test(t)) return 'bar_magnet'
  }
  if (f.has('motion') && /\b(throw\w*|thrown|projectile|trajectory|falls?|falling|free fall|gravity|comes? (back )?down|goes up|equations of motion|suvat|kinematics|accelerat\w*)\b/i.test(t)) return 'projectile'
  if (/\b(electric(al)? current|charges? (flow|move|drift)|drift velocity|free electrons?|ampere|coulombs? per second|current in a wire)\b/i.test(t)) return 'charge_drift'
  return null
}

/** A validated stage step for a template (null if, somehow, it does not validate: never ship a broken figure). */
export function stageStep(kind: StageTemplate, id = `stage_${kind}`): Step | null {
  const t = TEMPLATES[kind]
  const step = { type: 'stage', id, kind: 'interactive', spec: t.spec, play: t.play, caption: t.caption, say: t.say } as unknown as Step
  const v = validateScript([step], { knownIds: [] })
  return v.ok ? v.steps[0] : null
}

/** Steps that already carry a rich visual (a live figure, a clip, a library picture). */
export function hasRichVisual(steps: Step[]): boolean {
  return steps.some(st => st.type === 'stage' || st.type === 'manim_clip' || (st.type === 'draw' && (st as { shape?: { kind?: string } }).shape?.kind === 'figure'))
}

/** The template's interactive spec + its demonstration (for the chat's interactive block). */
export function templateFigure(kind: StageTemplate): { spec: Record<string, unknown>; play: { slider: string; seconds: number }; say: string } {
  const t = TEMPLATES[kind]
  return { spec: t.spec, play: t.play, say: t.say }
}

/* ───────── Function ideas: the curve traced live by a moving point (with its tangent for rate-of-change ideas) ───────── */

const X_RE = /(?<![a-z])x(?![a-z])/gi
const subX = (expr: string, by: string) => expr.replace(X_RE, `(${by})`)

/** A function expression a text names: "y = …" / "f(x) = …", else a standard one for the idea, else null. */
export function functionFor(text: string): { expr: string; tangent: boolean; x: [number, number] } | null {
  const t = text.slice(0, 1200)
  const tangent = /\b(derivative|differentiat\w*|gradient|slope|tangent|rate of change|dy\/dx|instantaneous)\b/i.test(t)
  const m = /(?:\by\s*=|\bf\s*\(\s*x\s*\)\s*=)\s*([0-9x+\-*/^().\s a-z]{1,60}?)(?=$|[,;?\n]|\s(?:and|for|when|at|from|is|on)\b)/i.exec(t)
  const clean = (e: string) => e.trim().replace(/\s+/g, '').replace(/(\d)([a-z(])/gi, '$1*$2')
  if (m) {
    const e = clean(m[1])
    if (compileExpr(e, [], true).ok) return { expr: e, tangent, x: /sin|cos|tan/.test(e) ? [-7, 7] : /ln|log|sqrt/.test(e) ? [0.1, 8] : [-5, 5] }
  }
  if (/\b(sine|sin)\b/i.test(t)) return { expr: 'sin(x)', tangent, x: [-7, 7] }
  if (/\b(cosine|cos)\b/i.test(t)) return { expr: 'cos(x)', tangent, x: [-7, 7] }
  if (/\b(exponential|growth|decay)\b/i.test(t)) return { expr: '0.5*exp(0.5*x)', tangent, x: [-4, 4] }
  if (/\b(logarithm\w*|log|ln)\b/i.test(t)) return { expr: 'ln(x)', tangent, x: [0.1, 8] }
  if (/\b(parabola|quadratics?|x\^2|x²|squared|roots?|zero product|factori[sz]\w*)\b/i.test(t)) return { expr: 'x^2-2*x-3', tangent, x: [-3, 5] }
  if (/\b(straight line|linear|gradient|slope|y-intercept|intercept)\b/i.test(t)) return { expr: '2*x+1', tangent: false, x: [-4, 4] }
  if (tangent) return { expr: 'x^2', tangent: true, x: [-3, 3] }
  if (/\b(functions?|graphs?)\b/i.test(t)) return { expr: 'x^2-2*x-3', tangent: false, x: [-3, 5] }
  return null
}

/** A live figure: the curve, a point that travels along it (played as a demonstration), its tangent when asked. */
export function functionFigure(f: { expr: string; tangent: boolean; x: [number, number] }, title?: string): { spec: Record<string, unknown>; play: { slider: string; seconds: number }; say: string } | null {
  const c = compileExpr(f.expr, [], true)
  if (!c.ok) return null
  const [x0, x1] = f.x
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i <= 120; i++) { const v = c.fn(x0 + (x1 - x0) * i / 120); if (Number.isFinite(v) && Math.abs(v) < 1e4) { lo = Math.min(lo, v); hi = Math.max(hi, v) } }
  if (!Number.isFinite(lo)) return null
  const pad = Math.max(0.5, (hi - lo) * 0.15)
  const ya = `(${f.expr.replace(X_RE, '(a)')})`
  const slope = `((${subX(f.expr, 'a+0.001')})-(${subX(f.expr, 'a-0.001')}))/0.002`
  const pretty = f.expr.replace(/\*/g, '')
  const spec: Record<string, unknown> = {
    title: title ?? `y = ${pretty}`,
    explain: f.tangent ? 'The point slides along the curve; the dashed line is the tangent there. Its slope is the derivative at that point.' : 'The point travels along the curve: read its x and y as it moves, or drag the slider yourself.',
    x: [x0, x1], y: [Math.floor(Math.min(lo - pad, -0.5)), Math.ceil(Math.max(hi + pad, 0.5))],
    sliders: [{ name: 'a', label: 'x', min: x0, max: x1, step: (x1 - x0) / 200, value: x0 }],
    functions: [{ name: 'f', expr: f.expr, label: `y = ${pretty}`, color: 'accent' }, ...(f.tangent ? [{ name: 'g', expr: `${slope}*(x-a)+${ya}`, label: 'tangent', color: 'clay', dashed: true }] : [])],
    points: [{ name: 'P', x: 'a', y: ya, label: 'P', color: 'clay' }],
    readouts: [{ label: 'x', expr: 'a' }, { label: 'y', expr: ya }, ...(f.tangent ? [{ label: 'slope (derivative)', expr: slope }] : [])],
  }
  if (!validateInteractive(spec).spec) return null
  return { spec, play: { slider: 'a', seconds: 8 }, say: f.tangent
    ? 'Watch the point slide along the curve with its tangent line. Where the curve is steep the tangent is steep, where the curve turns the tangent is flat: that slope is the derivative. Drag it yourself to check.'
    : 'Watch the point travel along the curve from left to right. Its height is the value of the function at each x: notice where it rises, where it falls and where it crosses the axis.' }
}

/** A stage step from a live figure (validated; null if it does not validate). */
export function figureStage(fig: { spec: Record<string, unknown>; play: { slider: string; seconds: number }; say: string }, id: string, caption: string): Step | null {
  const step = { type: 'stage', id, kind: 'interactive', spec: fig.spec, play: fig.play, caption: caption.slice(0, 280), say: fig.say } as unknown as Step
  const v = validateScript([step], { knownIds: [] })
  return v.ok ? v.steps[0] : null
}

/** The chat's planned live figure for a question: a ready template or the function traced; null when none fits. */
export function chatFigureFor(text: string): { spec: IxSpec; play: { slider: string; seconds: number }; say: string; source: string } | null {
  const tpl = stageTemplateFor(text)
  const fig = tpl ? templateFigure(tpl) : (() => { const f = new Set(readVisual(text).families); return f.has('function') ? (() => { const fn = functionFor(text); return fn ? functionFigure(fn) : null })() : null })()
  if (!fig) return null
  const v = validateInteractive(fig.spec)
  return v.spec ? { spec: v.spec, play: fig.play, say: fig.say, source: tpl ?? 'function' } : null
}

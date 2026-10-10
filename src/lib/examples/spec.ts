/**
 * Worked examples for any topic: the shared problem spec.
 *
 * The model writes a small JSON spec (statement with {{placeholders}}, givens, unknowns, ordered solution steps with
 * a calc expression and/or a symbolic check each, the final answer, a diagram spec). Code then fills every number:
 * each calc is evaluated from the givens (mathjs), each symbolic claim is checked at random points, the domain plugin
 * re-derives the answer independently (circuit MNA, projectile/incline mechanics, Punnett cross, atom balance, a
 * numeric scan of the graph), and the diagram is drawn by a renderer from the registry, never by the model.
 * Pure types + shape validation: safe in the browser and on the server.
 */

export interface Given {
  /** identifier used in expressions and {{placeholders}} */
  name: string
  /** SI value as a plain decimal (degrees for angles) */
  value: number
  unit?: string
  /** "launch speed" */
  label?: string
  /** the learner can drag it ("change the numbers"); range defaults to ±50 % */
  vary?: { min: number; max: number; step: number }
}

export interface Unknown { name: string; unit?: string; label?: string }

export type StepCheck =
  /** lhs and rhs are the same expression (checked at random values of their free variables, given values fixed) */
  | { kind: 'identity'; lhs: string; rhs: string }
  /** d/dvar f = df (checked symbolically by mathjs and at random points) */
  | { kind: 'derivative'; f: string; var: string; df: string }
  /** expr = 0 at the current values (a root, a stationary point) */
  | { kind: 'zero'; expr: string }

export interface SolStep {
  title?: string
  /** LaTeX of the rule or equation used, symbols only ("R = \\frac{u^2 \\sin 2\\theta}{g}"); numbers come from code */
  claim: string
  /** one plain sentence: why this step is allowed; may use {{name}} for any value */
  reason: string
  calc?: { name: string; expr: string; unit?: string; /** the value the model expected (checked) */ value?: number }
  check?: StepCheck
  /** what the diagram does at this step (renderer-specific; e.g. {"highlight":["R2","R3"]}, {"show":["apex"]}) */
  diagram?: Record<string, unknown>
}

export interface DiagramSpec { type: string; [k: string]: unknown }

export interface ExampleSpec {
  topic: string
  level?: string
  /** the problem as the learner reads it; every given appears as {{name}} */
  statement: string
  givens: Given[]
  unknowns: Unknown[]
  steps: SolStep[]
  /** numeric answers name a calc (or a plugin fact); text answers (a balanced equation) are checked by the plugin */
  answer: { name?: string; unit?: string; text?: string; value?: number; label?: string }
  diagram?: DiagramSpec
  /** a one-tap prediction before the working */
  predict?: { question: string; options: string[]; answer: number }
  /** common mistakes as expressions over the givens ("forgot to combine": R1+R2+R3) for MCQ options and feedback */
  mistakes?: { expr: string; why: string }[]
}

export const IDENT = /^[A-Za-z][A-Za-z0-9_]{0,15}$/
const RESERVED = new Set(['e', 'pi', 'i', 'E', 'PI', 'Infinity', 'NaN', 'true', 'false', 'null', 'sin', 'cos', 'tan', 'sqrt', 'log', 'ln', 'exp', 'abs', 'sind', 'cosd', 'tand', 'asind', 'acosd', 'atand', 'mod', 'in', 'to'])

const str = (v: unknown, n = 600) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?(e-?\d+)?\s*$/i.test(v)) return Number(v)
  return null
}
const objOf = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)

/** Coerce model JSON into an ExampleSpec, collecting shape errors (the caller sends them back for repair). */
export function parseSpec(raw: unknown): { spec: ExampleSpec | null; errors: string[] } {
  const errors: string[] = []
  const o = objOf(raw)
  if (!o) return { spec: null, errors: ['the reply is not a JSON object'] }
  const givens: Given[] = []
  const seen = new Set<string>()
  for (const g of Array.isArray(o.givens) ? o.givens.slice(0, 16) : []) {
    const x = objOf(g); if (!x) continue
    const name = str(x.name, 16); const value = num(x.value)
    if (!IDENT.test(name) || RESERVED.has(name)) { errors.push(`given name "${name}" must be a plain identifier (letters, digits, _), not a function name`); continue }
    if (value === null) { errors.push(`given ${name} needs a plain numeric value (SI units, degrees for angles)`); continue }
    if (seen.has(name)) { errors.push(`duplicate name ${name}`); continue }
    seen.add(name)
    const vr = objOf(x.vary)
    const vary = vr && num(vr.min) !== null && num(vr.max) !== null && num(vr.step) ? { min: num(vr.min)!, max: num(vr.max)!, step: Math.abs(num(vr.step)!) } : undefined
    givens.push({ name, value, unit: str(x.unit, 16) || undefined, label: str(x.label, 60) || undefined, vary: vary && vary.max > vary.min ? vary : undefined })
  }
  const unknowns: Unknown[] = (Array.isArray(o.unknowns) ? o.unknowns.slice(0, 6) : []).map(u => objOf(u)).filter(Boolean).map(u => ({ name: str(u!.name, 16), unit: str(u!.unit, 16) || undefined, label: str(u!.label, 80) || undefined }))
  const steps: SolStep[] = []
  for (const s of Array.isArray(o.steps) ? o.steps.slice(0, 14) : []) {
    const x = objOf(s); if (!x) continue
    const c = objOf(x.calc)
    const calc = c && IDENT.test(str(c.name, 16)) && str(c.expr, 300) ? { name: str(c.name, 16), expr: str(c.expr, 300), unit: str(c.unit, 16) || undefined, value: num(c.value) ?? undefined } : undefined
    if (c && !calc) errors.push(`step ${steps.length + 1}: calc needs "name" (identifier) and "expr"`)
    if (calc && RESERVED.has(calc.name)) errors.push(`step ${steps.length + 1}: calc name "${calc.name}" is reserved, pick another`)
    if (calc && seen.has(calc.name)) errors.push(`step ${steps.length + 1}: calc name "${calc.name}" is already used`)
    if (calc) seen.add(calc.name)
    const k = objOf(x.check)
    let check: StepCheck | undefined
    if (k) {
      if (k.kind === 'identity' && str(k.lhs) && str(k.rhs)) check = { kind: 'identity', lhs: str(k.lhs, 300), rhs: str(k.rhs, 300) }
      else if (k.kind === 'derivative' && str(k.f) && str(k.df)) check = { kind: 'derivative', f: str(k.f, 300), var: str(k.var, 8) || 'x', df: str(k.df, 300) }
      else if (k.kind === 'zero' && str(k.expr)) check = { kind: 'zero', expr: str(k.expr, 300) }
      else errors.push(`step ${steps.length + 1}: check must be {"kind":"identity","lhs","rhs"} | {"kind":"derivative","f","var","df"} | {"kind":"zero","expr"}`)
    }
    steps.push({ title: str(x.title, 60) || undefined, claim: str(x.claim, 300), reason: str(x.reason, 300), calc, check, diagram: objOf(x.diagram) ?? undefined })
  }
  const a = objOf(o.answer) ?? {}
  const answer = { name: str(a.name, 16) || undefined, unit: str(a.unit, 16) || undefined, text: str(a.text, 200) || undefined, value: num(a.value) ?? undefined, label: str(a.label, 80) || undefined }
  const d = objOf(o.diagram)
  const p = objOf(o.predict)
  const predict = p && str(p.question) && Array.isArray(p.options) && p.options.length >= 2 && Number.isInteger(p.answer) && Number(p.answer) >= 0 && Number(p.answer) < p.options.length
    ? { question: str(p.question, 200), options: p.options.slice(0, 4).map(x => str(x, 80)), answer: Number(p.answer) } : undefined
  const mistakes = (Array.isArray(o.mistakes) ? o.mistakes.slice(0, 4) : []).map(m => objOf(m)).filter(m => m && str(m.expr) && str(m.why)).map(m => ({ expr: str(m!.expr, 300), why: str(m!.why, 160) }))
  const spec: ExampleSpec = {
    topic: str(o.topic, 120), level: str(o.level, 60) || undefined, statement: str(o.statement, 900),
    givens, unknowns, steps, answer, diagram: d && str(d.type, 30) ? (d as DiagramSpec) : undefined, predict, mistakes,
  }
  if (!spec.statement) errors.push('statement is required')
  if (!spec.answer.name && !spec.answer.text) errors.push('answer needs "name" (the calc that holds it) or "text"')
  return { spec, errors }
}

/** Fill {{name}} placeholders with formatted values. */
export function fill(text: string, scope: Record<string, number>): string {
  return text.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (m, k: string) => (k in scope && Number.isFinite(scope[k]) ? fmtNum(scope[k]) : m))
}

/** People-friendly numbers: up to 3 significant figures beyond the integer part, no trailing zeros. */
export function fmtNum(v: number, sig = 3): string {
  if (!Number.isFinite(v)) return String(v)
  if (Math.abs(v) < 1e-12) return '0'
  const r = Math.round(v)
  if (Math.abs(v - r) < 1e-9 * Math.max(1, Math.abs(v))) return String(r)
  const a = Math.abs(v)
  let s: string
  if (a >= 1000) s = v.toFixed(0)
  else if (a >= 1) s = Number(v.toPrecision(Math.max(sig, String(Math.floor(a)).length + 2))).toString()
  else s = Number(v.toPrecision(sig)).toString()
  // exact short decimals stay exact (0.125)
  for (let k = 1; k <= 4; k++) { const t = Number(v.toFixed(k)); if (Math.abs(t - v) < 1e-9 * Math.max(1, a)) return String(t) }
  return s
}

/**
 * A chemical equation in a claim is set upright ("2H_2 + O_2 \rightarrow 2H_2O" → \mathrm{…}); in maths italics the
 * element symbols read as variables. Anything that is not a pure formula = formula line is left as it is.
 */
export function chemTex(claim: string): string {
  const t = claim.trim()
  if (!t || /\\mathrm|\\text|\\ce/.test(t)) return claim
  const arrow = /\\(?:long)?rightarrow|\\rightleftharpoons|\\to\b|->|⟶|→/
  if (!arrow.test(t)) return claim
  const sides = t.split(new RegExp(arrow.source, 'g'))
  if (sides.length < 2) return claim
  const term = /^\d*(?:\\?[([]|\\?[)\]](?:_\{?\d+\}?|\d+)?|[A-Z][a-z]?(?:_\{?\d+\}?|\d+)?|\^\{?\d*[+-]\}?|\\cdot|\s)+(?:\((?:s|l|g|aq)\))?$/
  const ok = sides.every(side => side.split(/\s\+\s|\s*\+\s*(?=\d*[A-Z(])/).every(x => term.test(x.replace(/[{}]/g, m => m).trim())))
  return ok ? `\\mathrm{${t}}` : claim
}

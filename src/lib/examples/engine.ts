/**
 * The worked-example engine: evaluates a spec from its givens, checks every step, cross-checks the answer with the
 * domain plugin, builds the predict options from common mistakes and makes practice variants. Pure (mathjs only), so
 * the same code re-solves live in the browser when a learner drags a given.
 */
import { create, all, type MathJsInstance, type MathNode } from 'mathjs'
import { fmtNum, type ExampleSpec, type Given, type SolStep } from './spec'
import { pluginFor } from './registry'

const math: MathJsInstance = create(all, { number: 'number' })
const d2r = Math.PI / 180
math.import({
  sind: (x: number) => Math.sin(x * d2r), cosd: (x: number) => Math.cos(x * d2r), tand: (x: number) => Math.tan(x * d2r),
  asind: (x: number) => Math.asin(x) / d2r, acosd: (x: number) => Math.acos(x) / d2r, atand: (x: number) => Math.atan(x) / d2r,
}, { override: true })
const BLOCK = /\b(import|createUnit|evaluate|parse|simplify|derivative|resolve|reviver|compile|chain|help|config|typed)\b/

const clean = (s: string) => String(s ?? '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi').replace(/\*\*/g, '^').replace(/√\(/g, 'sqrt(').slice(0, 400)

export function parseExpr(expr: string): MathNode {
  const e = clean(expr)
  if (BLOCK.test(e)) throw new Error(`"${expr}" uses a function that is not allowed`)
  return math.parse(e)
}

/** Free symbols of an expression (names that are not functions or constants). */
export function symbolsOf(expr: string): string[] {
  const out = new Set<string>()
  parseExpr(expr).traverse((node, _path, parent) => {
    const n = node as MathNode & { name?: string }
    if (n.type === 'SymbolNode' && !(parent && parent.type === 'FunctionNode' && (parent as MathNode & { fn?: MathNode }).fn === node) && !['pi', 'e', 'Infinity', 'NaN', 'i'].includes(n.name!)) out.add(n.name!)
  })
  return [...out]
}

export function evalNum(expr: string, scope: Record<string, number>): number {
  const v = parseExpr(expr).compile().evaluate({ ...scope }) as unknown
  const n = typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : Number((v as { valueOf(): unknown })?.valueOf?.())
  if (!Number.isFinite(n)) throw new Error(`"${expr}" does not give a finite number`)
  return n
}

const close = (a: number, b: number, rel = 1e-6) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b))

/** LaTeX for a name: theta -> \theta, R_eq -> R_{eq}, v0 -> v_{0}. */
const GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'theta', 'lambda', 'mu', 'pi', 'rho', 'sigma', 'tau', 'phi', 'omega', 'Delta', 'Omega', 'Sigma', 'Theta', 'Phi', 'eta', 'nu', 'kappa', 'chi', 'psi'])
export function texName(name: string): string {
  const m = /^([A-Za-z]+?)(?:_?([0-9]+)|_([A-Za-z0-9_]+))?$/.exec(name)
  if (!m) return name
  const base = GREEK.has(m[1]) ? `\\${m[1]}` : m[1].length > 1 ? `\\mathrm{${m[1]}}` : m[1]
  const sub = m[2] ?? m[3]
  return sub ? `${base}_{${sub.replace(/_/g, ',')}}` : base
}

function toTex(node: MathNode): string {
  return node.toTex({
    parenthesis: 'auto', implicit: 'hide',
    handler: (n: MathNode & { name?: string; fn?: { name?: string }; args?: MathNode[] }, options: object) => {
      if (n.type === 'SymbolNode') return texName(n.name!)
      if (n.type === 'FunctionNode' && n.fn?.name && /^(sin|cos|tan)d$/.test(n.fn.name)) return `\\${n.fn.name.slice(0, 3)}\\left(${n.args![0].toTex(options)}^{\\circ}\\right)`
      if (n.type === 'ConstantNode') { const v = (n as unknown as { value: number }).value; return typeof v === 'number' ? fmtNum(v) : undefined }
      return undefined
    },
  } as never)
}
/** The expression with letters (symbolic) and with the current numbers substituted. */
export function texForms(expr: string, scope: Record<string, number>): { symbolic: string; substituted: string } {
  const node = parseExpr(expr)
  const sub = node.transform((n: MathNode & { name?: string }, _p, parent) => {
    if (n.type === 'SymbolNode' && n.name! in scope && !(parent && parent.type === 'FunctionNode' && (parent as MathNode & { fn?: MathNode }).fn === n)) return new math.ConstantNode(Number(fmtNum(scope[n.name!], 4)))
    return n
  })
  return { symbolic: toTex(node), substituted: toTex(sub) }
}

/* ───────────── checks ───────────── */

function randScope(names: string[], seed: number) {
  let s = seed
  const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  return Object.fromEntries(names.map(n => [n, 0.4 + 2.2 * r()]))
}

export function runCheck(step: SolStep, scope: Record<string, number>): string | null {
  const c = step.check
  if (!c) return null
  try {
    if (c.kind === 'zero') {
      const v = evalNum(c.expr, scope)
      const scale = Math.max(1, ...Object.values(scope).map(Math.abs).filter(Number.isFinite).slice(0, 20))
      return Math.abs(v) <= 1e-6 * scale ? null : `"${c.expr}" is ${fmtNum(v)}, not 0`
    }
    const [l, r] = c.kind === 'identity' ? [c.lhs, c.rhs] : [null, c.df]
    let lhsNode: MathNode
    if (c.kind === 'derivative') {
      lhsNode = math.derivative(parseExpr(c.f), c.var)
    } else lhsNode = parseExpr(l!)
    const rhsNode = parseExpr(r)
    const free = [...new Set([...symbolsOf(lhsNode.toString()), ...symbolsOf(rhsNode.toString())])].filter(n => !(n in scope) || (c.kind === 'derivative' && n === c.var))
    const L = lhsNode.compile(), R = rhsNode.compile()
    for (let k = 0; k < 6; k++) {
      const sc = { ...scope, ...randScope(free, 7 + k * 31) }
      const a = Number(L.evaluate(sc)), b = Number(R.evaluate(sc))
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      if (!close(a, b, 1e-6)) return c.kind === 'derivative' ? `d/d${c.var} of ${c.f} is ${math.simplify(lhsNode).toString()}, not ${c.df}` : `${c.lhs} ≠ ${c.rhs}`
    }
    return null
  } catch (e) { return e instanceof Error ? e.message.slice(0, 200) : 'check failed' }
}

/* ───────────── evaluate a spec ───────────── */

export interface Evaluated {
  scope: Record<string, number>
  /** value of each step's calc (null when the step has none) */
  values: (number | null)[]
  answer: number | null
  issues: string[]
}

export function givenScope(spec: ExampleSpec, overrides: Record<string, number> = {}) {
  return Object.fromEntries(spec.givens.map(g => [g.name, overrides[g.name] ?? g.value]))
}

export function evaluateSpec(spec: ExampleSpec, overrides: Record<string, number> = {}, opts: { strict?: boolean } = {}): Evaluated {
  const issues: string[] = []
  const scope: Record<string, number> = givenScope(spec, overrides)
  const plugin = pluginFor(spec.diagram?.type)
  if (plugin?.facts && spec.diagram) {
    try { Object.assign(scope, plugin.facts(spec.diagram, scope)) } catch (e) { issues.push(`diagram: ${e instanceof Error ? e.message : e}`) }
  }
  const values: (number | null)[] = []
  spec.steps.forEach((st, i) => {
    let v: number | null = null
    if (st.calc) {
      try {
        const missing = symbolsOf(st.calc.expr).filter(n => !(n in scope))
        if (missing.length) throw new Error(`uses ${missing.join(', ')} before it is given or computed`)
        v = evalNum(st.calc.expr, scope)
        scope[st.calc.name] = v
        if (opts.strict && st.calc.value !== undefined && !close(v, st.calc.value, 0.02)) issues.push(`step ${i + 1}: you expected ${st.calc.name} = ${st.calc.value} but ${st.calc.expr} gives ${fmtNum(v)} — fix the expression or the reasoning`)
      } catch (e) { issues.push(`step ${i + 1}: ${e instanceof Error ? e.message : e}`) }
    }
    const ck = runCheck(st, scope)
    if (ck) issues.push(`step ${i + 1} (${st.title ?? st.claim.slice(0, 40)}): check failed: ${ck}`)
    values.push(v)
  })
  let answer: number | null = null
  if (spec.answer.name) {
    if (spec.answer.name in scope) answer = scope[spec.answer.name]
    else issues.push(`answer.name "${spec.answer.name}" is not a given, a calc name or a diagram fact`)
    if (answer !== null && opts.strict && spec.answer.value !== undefined && !close(answer, spec.answer.value, 0.02)) issues.push(`the answer you stated (${spec.answer.value}) is not what the steps give (${fmtNum(answer)})`)
  }
  if (plugin && spec.diagram) {
    try { issues.push(...(plugin.crossCheck?.(spec.diagram, spec, scope, answer) ?? [])) } catch (e) { issues.push(`cross-check: ${e instanceof Error ? e.message : e}`) }
  }
  return { scope, values, answer, issues }
}

/* ───────────── text hygiene: numbers come from code ───────────── */

const SMALL = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12', '90', '180', '360', '100', '0.5'])
function bareNumbers(text: string) {
  return (text.replace(/\{\{[^}]*\}\}/g, ' ').replace(/[A-Za-z]+_?\{?\d+\}?/g, ' ').replace(/\^\{?\d+\}?/g, ' ').match(/\d+(?:\.\d+)?/g) ?? [])
}
export function textIssues(spec: ExampleSpec): string[] {
  const out: string[] = []
  const givenVals = new Map(spec.givens.map(g => [fmtNum(g.value), g.name]))
  for (const n of bareNumbers(spec.statement)) {
    if (givenVals.has(fmtNum(Number(n)))) out.push(`statement: write {{${givenVals.get(fmtNum(Number(n)))}}} instead of the number ${n}`)
    else if (!SMALL.has(n)) out.push(`statement: the number ${n} is not a given — make it a given and write {{name}}`)
  }
  for (const g of spec.givens) if (!spec.statement.includes(`{{${g.name}}}`) && !spec.diagram?.type?.match(/circuit/)) out.push(`statement: given ${g.name} never appears as {{${g.name}}}`)
  const gnames = new Set(spec.givens.map(g => g.name))
  for (const m of spec.statement.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g)) if (!gnames.has(m[1])) out.push(`statement: {{${m[1]}}} is not a given — the statement may only show givens (never the answer)`)
  spec.steps.forEach((s, i) => {
    const consts = new Set(s.calc ? (clean(s.calc.expr).match(/\d+(?:\.\d+)?/g) ?? []) : [])
    for (const n of [...bareNumbers(s.claim), ...bareNumbers(s.reason)]) if (!SMALL.has(n) && !consts.has(n)) out.push(`step ${i + 1}: write {{name}} instead of the number ${n} (numbers come from the calculation)`)
  })
  return out
}

/* ───────────── predict options, practice variants ───────────── */

export interface Option { text: string; value: number | null; correct: boolean; why?: string }

export function answerOptions(spec: ExampleSpec, ev: Evaluated, overrides: Record<string, number> = {}): Option[] {
  if (ev.answer === null) return []
  const unit = spec.answer.unit ? ` ${spec.answer.unit}` : ''
  const opts: Option[] = [{ text: fmtNum(ev.answer) + unit, value: ev.answer, correct: true }]
  const scope = { ...ev.scope, ...overrides }
  const far = (v: number) => opts.every(o => o.value === null || Math.abs(o.value - v) > 0.03 * Math.max(Math.abs(o.value), Math.abs(v)))
  for (const m of spec.mistakes ?? []) {
    try { const v = evalNum(m.expr, scope); if (v > 0 === ev.answer > 0 && far(v) && fmtNum(v) !== fmtNum(ev.answer)) opts.push({ text: fmtNum(v) + unit, value: v, correct: false, why: m.why }) } catch { /* skip */ }
    if (opts.length >= 4) break
  }
  for (const [f, why] of [[2, 'doubled by mistake'], [0.5, 'halved by mistake']] as const) if (opts.length < 3 && far(ev.answer * f)) opts.push({ text: fmtNum(ev.answer * f) + unit, value: ev.answer * f, correct: false, why })
  // stable shuffle by value so the right answer is not always first
  return opts.sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
}

function niceExact(v: number) { return Math.abs(v * 100 - Math.round(v * 100)) < 1e-7 * Math.max(1, Math.abs(v * 100)) }

export function varyRange(g: Given): { min: number; max: number; step: number } {
  if (g.vary) return g.vary
  const v = Math.abs(g.value) || 1
  const step = v >= 10 ? Math.pow(10, Math.floor(Math.log10(v)) - 1) * (v >= 50 ? 5 : 1) : v >= 1 ? (Number.isInteger(g.value) ? 1 : 0.5) : Number((v / 5).toPrecision(1))
  const lo = Math.max(step, Math.round((v * 0.5) / step) * step), hi = Math.round((v * 1.5) / step) * step
  return { min: g.value < 0 ? -hi : lo, max: g.value < 0 ? -lo : hi, step }
}

/** Variants with new givens that pass every check; nice answers when the original answer was exact. */
export function makeVariants(spec: ExampleSpec, n = 3, seed = 11, nice?: boolean): { overrides: Record<string, number>; answer: number }[] {
  const base = evaluateSpec(spec)
  if (base.answer === null || base.issues.length) return []
  const wantNice = nice ?? niceExact(base.answer)
  const varied = spec.givens.filter(g => g.vary || (!/^(g|k|c|h|N_?A|R_?gas|M_\w+)$/.test(g.name) && Number.isFinite(g.value)))
  let s = seed
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const out: { overrides: Record<string, number>; answer: number }[] = []
  const seen = new Set<string>()
  for (let t = 0; t < 400 && out.length < n; t++) {
    const o: Record<string, number> = {}
    for (const g of varied) { const r = varyRange(g); const k = Math.floor(rnd() * (Math.round((r.max - r.min) / r.step) + 1)); o[g.name] = Number((r.min + k * r.step).toPrecision(10)) }
    const key = JSON.stringify(o)
    if (seen.has(key) || varied.every(g => o[g.name] === g.value)) continue
    seen.add(key)
    const ev = evaluateSpec(spec, o)
    if (ev.issues.length || ev.answer === null || !Number.isFinite(ev.answer)) continue
    if (Math.sign(ev.answer) !== Math.sign(base.answer)) continue
    if (wantNice && !niceExact(ev.answer)) continue
    if (fmtNum(ev.answer) === fmtNum(base.answer)) continue
    out.push({ overrides: o, answer: ev.answer })
  }
  if (wantNice && out.length < n && nice === undefined) for (const v of makeVariants(spec, n, seed + 1, false)) if (out.length < n && !out.some(x => JSON.stringify(x.overrides) === JSON.stringify(v.overrides))) out.push(v)
  return out
}

/** Statement with numbers (and units) filled in. */
const UNIT_WORDS: Record<string, RegExp> = { '°': /^\s*(°|deg|degree)/i, 'Ω': /^\s*(Ω|ohm|kΩ)/i, 'V': /^\s*(V\b|volt)/i, 'A': /^\s*(A\b|amp|mA)/i }
/** Statement with the givens (only) filled in, each followed by its unit when the text does not already say it. */
export function statementText(spec: ExampleSpec, scope: Record<string, number>) {
  const units = new Map(spec.givens.map(g => [g.name, g.unit ?? '']))
  return spec.statement.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (m, k: string, off: number, all: string) => {
    if (!units.has(k) || !(k in scope)) return m
    const u = units.get(k)!
    const rest = all.slice(off + m.length)
    const said = !u || rest.trimStart().startsWith(u) || (UNIT_WORDS[u]?.test(rest) ?? false) || /^\s*(m\/s|m|s|kg|N|g|J|W|cm|mol|%)/.test(rest)
    return fmtNum(scope[k]) + (said ? '' : u === '°' ? '°' : ` ${u}`)
  })
}

/** Full verification for the generator: shape → text hygiene → evaluation → plugin checks → variants exist. */
export function verifySpec(spec: ExampleSpec, o: { skipPrepare?: boolean } = {}): { ok: boolean; issues: string[]; ev: Evaluated } {
  const issues: string[] = []
  const plugin = pluginFor(spec.diagram?.type)
  if (spec.diagram && !plugin) issues.push(`diagram.type "${spec.diagram.type}" is not one of the supported types`)
  if (!o.skipPrepare && plugin?.prepare && spec.diagram) issues.push(...plugin.prepare(spec.diagram, spec))
  if (!spec.steps.length) issues.push('add the solution steps')
  if (spec.steps.length > 16) issues.push('use at most 12 steps')
  if (!spec.steps.some(s => s.calc || s.check) && !spec.answer.text) issues.push('no step is checkable: give each numeric step a "calc" and each symbolic step a "check"')
  for (const [i, s] of spec.steps.entries()) if (!s.calc && !s.check && /=/.test(s.claim) && bareNumbers(s.claim).some(n => !SMALL.has(n))) issues.push(`step ${i + 1} states an equation with numbers but has no calc or check`)
  issues.push(...textIssues(spec))
  const ev = evaluateSpec(spec, {}, { strict: true })
  issues.push(...ev.issues)
  // hard-coded values inside expressions break "change the numbers" and practice variants
  const known = new Map<string, string>()
  for (const [k, v] of Object.entries(ev.scope)) if (Number.isFinite(v) && !SMALL.has(fmtNum(v))) known.set(fmtNum(v), k)
  spec.steps.forEach((s, i) => {
    const exprs = [s.calc?.expr, s.check && 'expr' in s.check ? s.check.expr : undefined, s.check && 'lhs' in s.check ? s.check.lhs + ' ' + s.check.rhs : undefined].filter(Boolean) as string[]
    for (const e of exprs) for (const n of clean(e).replace(/[A-Za-z_]\w*/g, ' ').match(/\d+(?:\.\d+)?/g) ?? []) if (known.has(fmtNum(Number(n)))) issues.push(`step ${i + 1}: write ${known.get(fmtNum(Number(n)))} instead of the number ${n} inside the expression`)
  })
  if (spec.answer.text && plugin?.checkText && spec.diagram) issues.push(...plugin.checkText(spec.diagram, spec))
  return { ok: issues.length === 0, issues: [...new Set(issues)].slice(0, 12), ev }
}

/**
 * Run the plugin's own preparation on a parsed spec: validate the diagram, add its givens (circuit part values), and
 * let a plugin that writes its own solution (circuits) replace the steps. Then verify everything.
 */
export function finalizeSpec(spec: ExampleSpec): { ok: boolean; issues: string[]; ev: Evaluated; spec: ExampleSpec } {
  const plugin = pluginFor(spec.diagram?.type)
  // a physical constant the model forgot to mention is stated for it (not worth a repair round)
  for (const g of spec.givens) if (/^(g|k|c|h|R_gas|N_A)$/.test(g.name) && !spec.statement.includes(`{{${g.name}}}`)) spec.statement = `${spec.statement.replace(/\s*$/, '')} Take ${g.name} = {{${g.name}}}${g.unit ? ` ${g.unit}` : ''}.`
  const pre: string[] = []
  if (plugin?.prepare && spec.diagram) pre.push(...plugin.prepare(spec.diagram, spec))
  if (!pre.length && plugin?.derive && spec.diagram) {
    const r = plugin.derive(spec.diagram, spec)
    if (r) { spec.steps = r.steps; if (r.mistakes?.length) spec.mistakes = r.mistakes }
  }
  if (pre.length) return { ok: false, issues: pre, ev: { scope: {}, values: [], answer: null, issues: pre }, spec }
  const prepared = plugin?.prepare
  // prepare already ran: verify without running it twice
  const v = verifySpec(prepared ? { ...spec, diagram: spec.diagram } : spec, { skipPrepare: true })
  return { ...v, spec }
}

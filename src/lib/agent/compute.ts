/**
 * Exact maths for the agent (compute / verify_math), on mathjs: arithmetic with fractions and
 * big numbers, units, simplify, derivatives, numeric equation solving (all real roots in a range),
 * and checking a claimed value. The agent must call this before stating a numeric answer. Server only.
 */
import { create, all, type MathJsInstance } from 'mathjs'

const math: MathJsInstance = create(all, { number: 'number', precision: 64 })
// A second instance for evaluating model-written expressions: nothing that reaches outside maths
// (no import / createUnit / evaluate-in-evaluate / parse from inside an expression).
const sandbox: MathJsInstance = create(all, { number: 'number', precision: 64 })
const limited = sandbox.evaluate
sandbox.import({
  import: () => { throw new Error('import is disabled') },
  createUnit: () => { throw new Error('createUnit is disabled') },
  evaluate: () => { throw new Error('evaluate is disabled') },
  parse: () => { throw new Error('parse is disabled') },
  simplify: () => { throw new Error('simplify is disabled inside expressions') },
  derivative: () => { throw new Error('derivative is disabled inside expressions') },
  resolve: () => { throw new Error('resolve is disabled') },
  reviver: () => { throw new Error('reviver is disabled') },
}, { override: true })

export type ComputeOp = 'evaluate' | 'simplify' | 'derivative' | 'solve' | 'check'
export interface ComputeInput { op: ComputeOp; expression: string; variable?: string; expected?: string; range?: [number, number]; scope?: Record<string, number> }

const fmt = (v: unknown): string => {
  try { return math.format(v as never, { precision: 10 }) } catch { return String(v) }
}
const clean = (s: string) => String(s ?? '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi').replace(/√\(/g, 'sqrt(').replace(/\*\*/g, '^').slice(0, 400)

export function compute(input: ComputeInput): { ok: boolean; result?: string; detail?: string; error?: string } {
  const expr = clean(input.expression)
  if (!expr.trim()) return { ok: false, error: 'empty expression' }
  if (/\b(import|createUnit|evaluate|parse|reviver)\b/.test(expr)) return { ok: false, error: 'that function is not allowed' }
  const scope = Object.fromEntries(Object.entries(input.scope ?? {}).filter(([k, v]) => /^[a-zA-Z_]\w{0,15}$/.test(k) && typeof v === 'number' && Number.isFinite(v)))
  try {
    switch (input.op) {
      case 'evaluate': {
        const v = limited(expr, { ...scope })
        let exact = ''
        try { if (/^[\d\s+\-*/().^]+$/.test(expr)) exact = fmt(limited(expr.replace(/(\d+(\.\d+)?)/g, 'fraction($1)'))) } catch { /* not a rational expression */ }
        return { ok: true, result: fmt(v), detail: exact && exact !== fmt(v) && !/\/1$/.test(exact) ? `exact: ${exact}` : undefined }
      }
      case 'simplify': return { ok: true, result: math.simplify(expr).toString() }
      case 'derivative': {
        const x = input.variable || 'x'
        return { ok: true, result: math.derivative(expr, x).toString() }
      }
      case 'solve': return solve(expr, input.variable || 'x', input.range, scope)
      case 'check': {
        if (!input.expected) return { ok: false, error: 'give "expected" for a check' }
        const a = Number(limited(expr, { ...scope }).valueOf?.() ?? limited(expr, { ...scope }))
        const b = Number(limited(clean(input.expected), { ...scope }))
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
          const eq = math.simplify(`(${expr}) - (${clean(input.expected)})`).toString()
          return { ok: true, result: eq === '0' ? 'correct' : 'not equal', detail: `difference simplifies to ${eq}` }
        }
        const okv = Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) || Math.abs(a - b) <= 5e-3 * Math.max(Math.abs(a), Math.abs(b)) && /\./.test(input.expected)
        return { ok: true, result: okv ? 'correct' : 'incorrect', detail: `computed ${fmt(a)}; claimed ${fmt(b)}` }
      }
    }
    return { ok: false, error: `unknown op ${input.op}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : String(err) }
  }
}

/** All real roots of an equation `lhs = rhs` (or expression = 0) in a range, by sign changes + bisection. */
function solve(expr: string, v: string, range: [number, number] | undefined, scope: Record<string, number>) {
  const [lhs, rhs] = expr.includes('=') ? expr.split('=', 2) : [expr, '0']
  const node = math.parse(`(${lhs}) - (${rhs})`).compile()
  const f = (x: number) => { const r = node.evaluate({ ...scope, [v]: x }); return typeof r === 'number' ? r : Number(r) }
  const [a, b] = range && range[0] < range[1] ? range : [-1000, 1000]
  const N = 4000
  const roots: number[] = []
  let px = a, py = f(a)
  for (let i = 1; i <= N; i++) {
    const x = a + (b - a) * i / N
    const y = f(x)
    if (Number.isFinite(py) && Number.isFinite(y)) {
      if (py === 0) roots.push(px)
      else if (py * y < 0) {
        let lo = px, hi = x, flo = py
        for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; const fm = f(mid); if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm } }
        const r = (lo + hi) / 2
        if (Math.abs(f(r)) < 1e-6 * Math.max(1, Math.abs(r))) roots.push(r)
      }
    }
    px = x; py = y
  }
  const uniq = roots.map(r => Number(r.toPrecision(10))).filter((r, i, s) => s.findIndex(q => Math.abs(q - r) < 1e-7 * Math.max(1, Math.abs(r))) === i).slice(0, 12)
  return { ok: true, result: uniq.length ? `${v} = ${uniq.map(r => fmt(r)).join(', ')}` : `no real root in [${a}, ${b}]`, detail: `searched ${v} in [${a}, ${b}]` }
}

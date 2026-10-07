/**
 * Compare a learner's typed answer with accepted answers.
 * Text answers match case/space-insensitively; numeric answers match by value, so
 * 5000/π, 5000/pi, 1591.5, 1.59e3, 1.59×10^3, 35000/22 (π≈22/7) and "1592 A/m" are all equal.
 */
import { texToPlain } from '@/lib/math-text'

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/[.,;:!]+$/, '')

/** Safe evaluator for + - * / ^ ( ) √ π e and scientific notation. Returns null when not a pure number expression. */
export function evalNumeric(raw: string): number | null {
  if (!raw) return null
  let s = texToPlain(String(raw))
  s = s
    .replace(/\\pi|π|\bpi\b/gi, '(P)')
    .replace(/[×·✕x](?=\s*10)/gi, '*')
    .replace(/[×·✕]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/√\s*\(/g, 'S(').replace(/√\s*([0-9.]+)/g, 'S($1)')
    .replace(/sqrt\s*\(/gi, 'S(')
    .replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, m => '^(' + [...m].map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c) >= 0 ? String('⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)) : '-').join('') + ')')
  // Strip trailing units / words (e.g. "A/m", "T", "m/s^2") after the numeric part.
  const m = s.match(/^\s*[-+0-9.()P S*/^eE]+/)
  if (!m) return null
  let expr = m[0].trim()
  // Remove a dangling operator left by unit stripping ("1591 A/m" -> "1591").
  expr = expr.replace(/[*/^+\-\s]+$/, '')
  if (!/[0-9P]/.test(expr)) return null
  // Implicit multiplication: 2P, 2(…), )(, P(, )2
  expr = expr.replace(/\s+/g, '')
    .replace(/(\d|\))(?=P|S\(|\()/g, '$1*')
    .replace(/P(?=\d|\(|P)/g, 'P*')
    .replace(/\)(?=\d)/g, ')*')
  // Tokenise and parse (recursive descent).
  const toks = expr.match(/\d*\.?\d+(?:[eE][-+]?\d+)?|[P S+\-*/^()]/g)
  if (!toks || toks.join('') !== expr) return null
  let i = 0
  const peek = () => toks[i]
  const take = () => toks[i++]
  const primary = (): number => {
    const t = take()
    if (t === undefined) throw 0
    if (t === '(') { const v = sum(); if (take() !== ')') throw 0; return v }
    if (t === 'P') return Math.PI
    if (t === 'S') { if (take() !== '(') throw 0; const v = sum(); if (take() !== ')') throw 0; return Math.sqrt(v) }
    if (t === '-') return -power()
    if (t === '+') return power()
    const n = Number(t); if (!Number.isFinite(n)) throw 0; return n
  }
  const power = (): number => { const b = primary(); if (peek() === '^') { take(); return Math.pow(b, power()) } return b }
  const product = (): number => {
    let v = power()
    while (peek() === '*' || peek() === '/') { const op = take(); const r = power(); v = op === '*' ? v * r : v / r }
    return v
  }
  const sum = (): number => {
    let v = product()
    while (peek() === '+' || peek() === '-') { const op = take(); const r = product(); v = op === '+' ? v + r : v - r }
    return v
  }
  try {
    const v = sum()
    if (i !== toks.length || !Number.isFinite(v)) return null
    return v
  } catch { return null }
}

/** Relative tolerance: 0.5% covers rounding to 3 s.f. and π≈22/7 or 3.14. */
const REL_TOL = 0.005

export function answerMatches(answer: string, accept: string[]): boolean {
  const a = norm(answer)
  if (accept.some(x => norm(x) === a)) return true
  const v = evalNumeric(answer)
  if (v === null) return false
  return accept.some(x => {
    const t = evalNumeric(x)
    if (t === null) return false
    if (t === 0) return Math.abs(v) < 1e-9
    return Math.abs(v - t) / Math.abs(t) <= REL_TOL
  })
}

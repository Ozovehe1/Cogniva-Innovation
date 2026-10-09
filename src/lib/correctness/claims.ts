/**
 * Numeric claims in tutor text: "23.5 × 17.2 = 404.2", "$\frac{3}{4} = 0.75$", "15% of 240 is 36", and solutions
 * ("3x + 5 = 20 … so x = 6") checked against the equations in the same text. Exact maths on mathjs, deterministic,
 * no model call (microseconds per sentence). Only unambiguous claims are judged: anything with a free letter that
 * is not a solved variable, an inequality, ± or an unknown unit is left alone.
 */
import { create, all, type MathJsInstance, type MathNode } from 'mathjs'

const math: MathJsInstance = create(all, { number: 'number', precision: 64 })
const FUNCS = new Set(['sqrt', 'nthRoot', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'log', 'log10', 'log2', 'exp', 'abs', 'pi', 'e', 'deg', 'floor', 'ceil', 'round'])

export interface Claim {
  /** The text as written ("$2^{10} = 1000$"). */
  source: string
  lhs: string
  rhs: string
  /** What the left side evaluates to. */
  computed: number
  claimed: number
  approx: boolean
  kind: 'arithmetic' | 'percent' | 'solution'
}
export interface ClaimCheck { claims: number; wrong: (Claim & { fix: string })[] }

/* ───────────── LaTeX / Unicode → mathjs ───────────── */

/** Read a {...} group starting at s[i] === '{'. */
function group(s: string, i: number): [string, number] {
  let depth = 0
  for (let k = i; k < s.length; k++) {
    if (s[k] === '{') depth++
    else if (s[k] === '}') { depth--; if (depth === 0) return [s.slice(i + 1, k), k + 1] }
  }
  return [s.slice(i + 1), s.length]
}

export function texToExpr(tex: string): string {
  let s = tex
    .replace(/\\(left|right|big|Big|bigg|Bigg)\b\s*/g, '')
    .replace(/\\(text|mathrm|textrm|operatorname|mbox|unit)\s*\{[^{}]*\}/g, m => (/\\operatorname/.test(m) ? m.replace(/.*\{|\}/g, '') : ' '))
    .replace(/\^\s*\{?\\circ\}?/g, ' deg').replace(/°/g, ' deg')
    .replace(/\\[,;:!]|\\quad|\\qquad|~/g, ' ').replace(/\\(times|cdot|ast)\b/g, '*').replace(/\\div\b/g, '/')
    .replace(/\\pi\b/g, 'pi').replace(/\\%/g, '%').replace(/\\(dfrac|tfrac)/g, '\\frac')
  // \frac{a}{b}, \sqrt{a}, \sqrt[n]{a}: rewrite the last (innermost-first) occurrence until none is left.
  for (let guard = 0; guard < 30; guard++) {
    const fi = s.lastIndexOf('\\frac'), si = s.lastIndexOf('\\sqrt')
    if (fi < 0 && si < 0) break
    if (fi > si) {
      const k1 = s.indexOf('{', fi)
      if (k1 < 0) { s = s.slice(0, fi) + s.slice(fi + 5); continue }
      const [a, j] = group(s, k1)
      const k2 = s.indexOf('{', j)
      const [b, end] = k2 >= 0 && /^\s*$/.test(s.slice(j, k2)) ? group(s, k2) : ['1', j]
      s = `${s.slice(0, fi)}((${a})/(${b}))${s.slice(end)}`
    } else {
      let j = si + 5
      let idx: string | null = null
      const br = /^\s*\[([^\]]*)\]/.exec(s.slice(j))
      if (br) { idx = br[1]; j += br[0].length }
      const k = s.indexOf('{', j)
      if (k < 0 || !/^\s*$/.test(s.slice(j, k))) { s = `${s.slice(0, si)}sqrt${s.slice(j)}`; continue }
      const [a, end] = group(s, k)
      s = `${s.slice(0, si)}${idx ? `nthRoot(${a}, ${idx})` : `sqrt(${a})`}${s.slice(end)}`
    }
  }
  s = s.replace(/\\(sin|cos|tan|log|ln|exp)\b/g, (_m, f: string) => (f === 'ln' ? 'log' : f))
  s = s.replace(/\b(sin|cos|tan|log|exp)\s+(\d+(?:\.\d+)?(?:\s*deg)?)/g, '$1($2)')
  s = s.replace(/\{/g, '(').replace(/\}/g, ')')
  return unicodeToExpr(s)
}

function unicodeToExpr(s: string): string {
  return s
    .replace(/(^|[^A-Za-z])([A-Za-z])\s*\(/g, (_m, pre: string, v: string) => `${pre}${v}*(`)
    .replace(/×|✕|⋅|·/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/π/g, 'pi').replace(/√\s*\(/g, 'sqrt(')
    .replace(/√\s*([\d.]+)/g, 'sqrt($1)').replace(/²/g, '^2').replace(/³/g, '^3')
    .replace(/(\d)\s*,\s*(?=\d{3}\b)/g, '$1') // 1,000 → 1000
    .replace(/(\d+(?:\.\d+)?)\s*%\s*of\s*/gi, '($1/100)*').replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)')
    .replace(/\s+/g, ' ').trim()
}

/** Free letters in an expression (variables), or null when it does not parse. */
function freeSymbols(expr: string): Set<string> | null {
  if (!expr || /[^\w\s+\-*/^().,%]/.test(expr)) return null
  try {
    const node = math.parse(expr)
    const out = new Set<string>()
    node.traverse((n: MathNode, path: string, parent: MathNode | null) => {
      if (n.type === 'SymbolNode') {
        const name = (n as unknown as { name: string }).name
        const isFn = parent?.type === 'FunctionNode' && path === 'fn'
        if (!isFn && !FUNCS.has(name)) out.add(name)
        if (isFn && !FUNCS.has(name)) out.add(`fn:${name}`)
      }
    })
    return out
  } catch { return null }
}

function evalNum(expr: string, scope: Record<string, number> = {}): number | null {
  try {
    const v = math.evaluate(expr, { ...scope })
    const n = typeof v === 'number' ? v : Number((v as { valueOf?: () => unknown })?.valueOf?.())
    return Number.isFinite(n) ? n : null
  } catch { return null }
}

/** The number a side claims, when it is a bare number ("404.2", "-5", "3/4", "0.75"). */
function bareNumber(expr: string): { v: number; decimals: number } | null {
  const t = expr.replace(/\s+/g, '')
  if (!/^-?\(?-?\d+(\.\d+)?\)?(\/\(?\d+(\.\d+)?\)?)?$/.test(t)) return null
  const v = evalNum(t)
  if (v === null) return null
  const d = /\.(\d+)/.exec(t)
  return { v, decimals: d ? d[1].length : 0 }
}

export function formatNumber(v: number, decimals?: number): string {
  if (Number.isInteger(v) || Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v))
  const d = decimals && decimals > 0 ? decimals : Math.min(4, Math.max(2, 4 - Math.floor(Math.log10(Math.abs(v) || 1))))
  return String(Number(v.toFixed(d)))
}

function agrees(computed: number, claimed: { v: number; decimals: number }, approx: boolean): boolean {
  const diff = Math.abs(computed - claimed.v)
  if (diff <= 1e-9 * Math.max(1, Math.abs(computed))) return true
  // A rounded claim is right when it is the value rounded to the digits shown (or 1 % when written as ≈).
  const half = 0.5 * Math.pow(10, -claimed.decimals) + 1e-12
  if (claimed.decimals > 0 && diff <= half) return true
  if (approx && (diff <= half || diff <= 0.01 * Math.abs(computed))) return true
  return false
}

/* ───────────── Extraction ───────────── */

interface Segment { text: string; tex: boolean; start: number; end: number }

/** $…$ / $$…$$ maths and the plain text around it. */
function segments(s: string): Segment[] {
  const out: Segment[] = []
  const re = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), tex: false, start: last, end: m.index })
    const inner = m[1] ?? m[2]
    const innerStart = m.index + (m[1] !== undefined ? 2 : 1)
    out.push({ text: inner, tex: true, start: innerStart, end: innerStart + inner.length })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ text: s.slice(last), tex: false, start: last, end: s.length })
  return out
}

/** Plain-text equation runs: digits and operators around "=" ("23.5 × 17.2 = 404.2", "x = 5"). */
const PLAIN_EQ = /(?<![\w.])(?=[\d(√π]|[-−]\s*[\d(]|(?<![A-Za-z])[A-Za-z](?![A-Za-z]))(?:(?<![A-Za-z])[A-Za-z](?![A-Za-z])|\d+(?:[.,]\d+)*|[()+\-−×÷*/^²³√π%\s])+(?:\s*(?:=|≈)\s*(?:(?<![A-Za-z])[A-Za-z](?![A-Za-z])|\d+(?:[.,]\d+)*|[()+\-−×÷*/^²³√π%\s])+)+(?=$|[\s,;:!?)]|\.(?:\s|$))/g
const PERCENT_OF = /(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)\s*(?:is|=|equals|gives)\s*(-?\d+(?:\.\d+)?)/gi

interface RawEq { sides: string[]; ops: ('=' | '≈')[]; source: string; tex: boolean; at: number; rhsStart: number; rhsEnd: number }

function equationsIn(seg: Segment): RawEq[] {
  const out: RawEq[] = []
  if (seg.tex) {
    // Split on top-level = / \approx (not inside braces); several equations may be separated by commas or \\ .
    for (const part of seg.text.split(/\\\\|;|,\s*(?=[^,]*=)|\\(?:quad|qquad|text\{\s*(?:and|so|or)\s*\})/)) {
      if (!/=|\\approx|≈/.test(part) || /\\(le|ge|lt|gt|neq|pm|mp)\b|[<>≤≥±]/.test(part)) continue
      const pieces = part.split(/(=|\\approx|≈)/)
      const sides: string[] = []
      const ops: ('=' | '≈')[] = []
      for (const p of pieces) { if (p === '=') ops.push('='); else if (p === '\\approx' || p === '≈') ops.push('≈'); else sides.push(p) }
      const lastSide = sides[sides.length - 1] ?? ''
      const off = seg.text.indexOf(part)
      const rs = off + part.lastIndexOf(lastSide) + (lastSide.length - lastSide.trimStart().length)
      out.push({ sides: sides.map(texToExpr), ops, source: `$${part.trim()}$`, tex: true, at: seg.start + off, rhsStart: seg.start + rs, rhsEnd: seg.start + rs + lastSide.trim().length })
    }
    return out
  }
  let m: RegExpExecArray | null
  PLAIN_EQ.lastIndex = 0
  while ((m = PLAIN_EQ.exec(seg.text))) {
    const raw = m[0]
    if (!/\d/.test(raw) || /[<>≤≥±]/.test(raw)) continue
    const pieces = raw.split(/(=|≈)/)
    const sides: string[] = []
    const ops: ('=' | '≈')[] = []
    for (const p of pieces) { if (p === '=' || p === '≈') ops.push(p); else sides.push(p) }
    if (sides.some(x => !x.trim())) continue
    const lastSide = sides[sides.length - 1]
    const rs = m.index + raw.lastIndexOf(lastSide)
    const lead = lastSide.length - lastSide.trimStart().length
    out.push({ sides: sides.map(unicodeToExpr), ops, source: raw.trim(), tex: false, at: seg.start + m.index, rhsStart: seg.start + rs + lead, rhsEnd: seg.start + rs + lastSide.trimEnd().length })
  }
  PERCENT_OF.lastIndex = 0
  while ((m = PERCENT_OF.exec(seg.text))) {
    const rhs = m[3]
    const rs = m.index + m[0].lastIndexOf(rhs)
    out.push({ sides: [`(${m[1]}/100)*${m[2]}`, rhs], ops: ['='], source: m[0], tex: false, at: seg.start + m.index, rhsStart: seg.start + rs, rhsEnd: seg.start + rs + rhs.length })
  }
  return out
}

/* ───────────── Checking ───────────── */

/** Check every numeric claim in a piece of tutor text (narration, chat answer, board text, a TeX line). */
export function checkText(text: string, opts: { tex?: boolean } = {}): ClaimCheck {
  const src = opts.tex ? `$${text}$` : text
  const segs = segments(src)
  const eqs = segs.flatMap(equationsIn)
  const wrong: ClaimCheck['wrong'] = []
  let claims = 0
  // Single-variable equations (for judging "x = 6" claims) and the assignments themselves.
  const varEqs: { v: string; lhs: string; rhs: string }[] = []
  const assigns: { v: string; value: { v: number; decimals: number }; eq: RawEq }[] = []
  for (const eq of eqs) {
    // A wrong statement on purpose ("a common mistake is 2 + 3 = 6", "is 7 × 8 = 54 true?") is not a claim.
    if (deliberate(src, eq.at)) continue
    const syms = eq.sides.map(freeSymbols)
    if (syms.some(x => x === null)) continue
    const letters = new Set(syms.flatMap(x => [...x!]))
    if ([...letters].some(l => l.startsWith('fn:'))) continue
    if (letters.size === 0) {
      // Pure arithmetic chain: every side must equal the first.
      const first = evalNum(eq.sides[0])
      if (first === null) continue
      for (let k = 1; k < eq.sides.length; k++) {
        const claimed = bareNumber(eq.sides[k])
        const val = evalNum(eq.sides[k])
        if (val === null) continue
        claims++
        const approx = eq.ops[k - 1] === '≈'
        const ok = claimed ? agrees(first, claimed, approx) : Math.abs(first - val) <= 1e-9 * Math.max(1, Math.abs(first))
        if (!ok && k === eq.sides.length - 1 && claimed) {
          wrong.push({ source: eq.source, lhs: eq.sides[0], rhs: eq.sides[k], computed: first, claimed: claimed.v, approx, kind: /\/100\)\*/.test(eq.sides[0]) ? 'percent' : 'arithmetic', fix: `${src.slice(0, eq.rhsStart)}${formatNumber(first, claimed.decimals)}${src.slice(eq.rhsEnd)}` })
        } else if (!ok) {
          wrong.push({ source: eq.source, lhs: eq.sides[0], rhs: eq.sides[k], computed: first, claimed: val, approx, kind: 'arithmetic', fix: '' })
        }
      }
      continue
    }
    if (letters.size === 1 && eq.sides.length >= 3 && syms[0]!.size === 1 && syms.slice(1).every(x => x!.size === 0) && /^\s*[A-Za-z]\w*\s*$/.test(eq.sides[0])) {
      // "c = √(3² + 4²) = √25 = 7": the named quantity's value chain must agree with itself.
      const first = evalNum(eq.sides[1])
      if (first === null) continue
      const k = eq.sides.length - 1
      const claimed = bareNumber(eq.sides[k])
      if (!claimed) continue
      claims++
      const approx = eq.ops[k - 1] === '≈'
      if (!agrees(first, claimed, approx)) wrong.push({ source: eq.source, lhs: eq.sides[1], rhs: eq.sides[k], computed: first, claimed: claimed.v, approx, kind: 'arithmetic', fix: `${src.slice(0, eq.rhsStart)}${formatNumber(first, claimed.decimals)}${src.slice(eq.rhsEnd)}` })
      continue
    }
    if (letters.size === 1) {
      const v = [...letters][0]
      if (eq.sides.length === 2 && eq.sides[0].replace(/\s/g, '') === v && syms[1]!.size === 0) {
        const n = evalNum(eq.sides[1])
        const d = /\.(\d+)/.exec(eq.sides[1])
        if (n !== null) { assigns.push({ v, value: bareNumber(eq.sides[1]) ?? { v: n, decimals: d ? d[1].length : 0 }, eq }); continue }
      }
      for (let k = 1; k < eq.sides.length; k++) varEqs.push({ v, lhs: eq.sides[k - 1], rhs: eq.sides[k] })
    }
  }
  // "x = 6" is judged only against equations in the same variable; it is wrong when no such equation holds for it and
  // they all share one other root.
  for (const a of assigns) {
    const rel = varEqs.filter(e => e.v === a.v)
    if (!rel.length) continue
    claims++
    const holds = (e: { lhs: string; rhs: string }, x: number) => {
      const l = evalNum(e.lhs, { [a.v]: x }), r = evalNum(e.rhs, { [a.v]: x })
      return l !== null && r !== null && Math.abs(l - r) <= 1e-6 * Math.max(1, Math.abs(l), Math.abs(r)) + (a.value.decimals ? 0.5 * Math.pow(10, -a.value.decimals) * Math.max(1, Math.abs(l)) : 0)
    }
    if (rel.some(e => holds(e, a.value.v))) continue
    const roots = rel.map(e => linearRoot(e.lhs, e.rhs, a.v))
    const r0 = roots[0]
    if (r0 === null || !roots.every(r => r !== null && Math.abs(r - r0) <= 1e-9 * Math.max(1, Math.abs(r0)))) {
      wrong.push({ source: a.eq.source, lhs: a.v, rhs: formatNumber(a.value.v), computed: NaN, claimed: a.value.v, approx: false, kind: 'solution', fix: '' })
      continue
    }
    wrong.push({ source: a.eq.source, lhs: a.v, rhs: formatNumber(a.value.v), computed: r0, claimed: a.value.v, approx: false, kind: 'solution', fix: `${src.slice(0, a.eq.rhsStart)}${formatNumber(r0, a.value.decimals)}${src.slice(a.eq.rhsEnd)}` })
  }
  // Fixes are computed against the original text; apply only the first (callers loop until stable).
  return { claims, wrong: wrong.map(w => ({ ...w, fix: w.fix && opts.tex ? w.fix.replace(/^\$|\$$/g, '') : w.fix })) }
}

const NOT_A_CLAIM = /\b(not|n't|wrong|mistake|incorrect|false|error|slip|trap|careless|instead of|rather than|true or false|really|check whether|is it)\b|\?|≠|\\ne(q)?\b/i
function deliberate(src: string, at: number): boolean {
  const before = src.slice(0, at)
  const start = Math.max(before.search(/[^.!?\n]*$/), 0)
  const rest = src.slice(at)
  const endRel = rest.search(/[.!?\n](\s|$)/)
  const sentence = src.slice(start, endRel < 0 ? src.length : at + endRel + 1)
  return NOT_A_CLAIM.test(sentence.replace(/\$[^$]*\$/g, m => m.replace(/\?/g, '')))
}

/** Root of an equation that is linear in v (f(v) = a·v + b, checked at three points), else null. */
function linearRoot(lhs: string, rhs: string, v: string): number | null {
  const f = (x: number) => { const l = evalNum(lhs, { [v]: x }), r = evalNum(rhs, { [v]: x }); return l === null || r === null ? NaN : l - r }
  const f0 = f(0), f1 = f(1), f2 = f(2)
  if (![f0, f1, f2].every(Number.isFinite)) return null
  const a = f1 - f0
  if (Math.abs(f2 - f1 - a) > 1e-9 * Math.max(1, Math.abs(a))) return null
  if (Math.abs(a) < 1e-12) return null
  return -f0 / a
}

/**
 * Correct every wrong claim that has an unambiguous fix (arithmetic result, percent, a linear solution).
 * Returns the corrected text and what could not be fixed (those need a regeneration).
 */
export function correctText(text: string, opts: { tex?: boolean } = {}): { text: string; fixed: Claim[]; unfixed: Claim[]; claims: number } {
  let cur = text
  const fixed: Claim[] = []
  let first: ClaimCheck | null = null
  for (let i = 0; i < 8; i++) {
    const c = checkText(cur, opts)
    first ??= c
    const w = c.wrong.find(x => x.fix)
    if (!w) return { text: cur, fixed, unfixed: c.wrong, claims: first.claims }
    fixed.push(w)
    cur = w.fix
  }
  const left = checkText(cur, opts)
  return { text: cur, fixed, unfixed: left.wrong, claims: first?.claims ?? 0 }
}

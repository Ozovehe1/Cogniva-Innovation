/**
 * A tiny safe expression compiler for f(x) (no eval): numbers, x, + − * / ^, unary minus, parentheses, implicit
 * multiplication (2x, 3(x+1), x sin(x)), pi, e and sin cos tan asin acos atan exp ln log sqrt abs. Returns null on
 * anything else, so a model can never run code through a scene spec.
 */
type Tok = { t: 'n'; v: number } | { t: 'x' } | { t: 'op'; v: string } | { t: 'fn'; v: string } | { t: '(' } | { t: ')' }
const FNS: Record<string, (a: number) => number> = { sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, exp: Math.exp, ln: Math.log, log: Math.log10, sqrt: Math.sqrt, abs: Math.abs }

function lex(src: string): Tok[] | null {
  const s = src.replace(/\s+/g, '').replace(/\*\*/g, '^').replace(/²/g, '^2').replace(/³/g, '^3').replace(/−/g, '-').toLowerCase()
  const out: Tok[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/[0-9.]/.test(ch)) { const m = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?/.exec(s.slice(i)); if (!m) return null; out.push({ t: 'n', v: Number(m[0]) }); i += m[0].length; continue }
    if (/[a-z]/.test(ch)) {
      const m = /^[a-z]+/.exec(s.slice(i))![0]
      if (m === 'x') out.push({ t: 'x' })
      else if (m === 'pi') out.push({ t: 'n', v: Math.PI })
      else if (m === 'e') out.push({ t: 'n', v: Math.E })
      else if (FNS[m]) out.push({ t: 'fn', v: m })
      else {
        // "xsin" / "2xe": split runs like "xx" into x·x.
        if (/^x+$/.test(m)) { for (let k = 0; k < m.length; k++) out.push({ t: 'x' }) } else return null
      }
      i += m.length; continue
    }
    if ('+-*/^'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue }
    if (ch === '(') { out.push({ t: '(' }); i++; continue }
    if (ch === ')') { out.push({ t: ')' }); i++; continue }
    return null
  }
  // Implicit multiplication.
  const res: Tok[] = []
  for (const tk of out) {
    const p = res[res.length - 1]
    if (p && (p.t === 'n' || p.t === 'x' || p.t === ')') && (tk.t === 'n' || tk.t === 'x' || tk.t === 'fn' || tk.t === '(')) res.push({ t: 'op', v: '*' })
    res.push(tk)
  }
  return res
}

type Node = (x: number) => number

export function compileFx(src: string): ((x: number) => number) | null {
  if (!src || src.length > 80) return null
  const toks = lex(src)
  if (!toks || !toks.length) return null
  let i = 0
  const peek = () => toks[i]
  const expr = (): Node | null => {
    let l = term(); if (!l) return null
    while (peek()?.t === 'op' && ['+', '-'].includes((peek() as { v: string }).v)) {
      const op = (toks[i++] as { v: string }).v; const r = term(); if (!r) return null
      const a: Node = l, b: Node = r; l = op === '+' ? x => a(x) + b(x) : x => a(x) - b(x)
    }
    return l
  }
  const term = (): Node | null => {
    let l = unary(); if (!l) return null
    while (peek()?.t === 'op' && ['*', '/'].includes((peek() as { v: string }).v)) {
      const op = (toks[i++] as { v: string }).v; const r = unary(); if (!r) return null
      const a: Node = l, b: Node = r; l = op === '*' ? x => a(x) * b(x) : x => a(x) / b(x)
    }
    return l
  }
  const unary = (): Node | null => {
    if (peek()?.t === 'op' && (peek() as { v: string }).v === '-') { i++; const u = unary(); return u ? x => -u(x) : null }
    if (peek()?.t === 'op' && (peek() as { v: string }).v === '+') { i++; return unary() }
    return power()
  }
  const power = (): Node | null => {
    const b = atom(); if (!b) return null
    if (peek()?.t === 'op' && (peek() as { v: string }).v === '^') { i++; const e = unary(); if (!e) return null; return x => b(x) ** e(x) }
    return b
  }
  const atom = (): Node | null => {
    const tk = toks[i++]
    if (!tk) return null
    if (tk.t === 'n') { const v = tk.v; return () => v }
    if (tk.t === 'x') return x => x
    if (tk.t === '(') { const e = expr(); if (!e || toks[i++]?.t !== ')') return null; return e }
    if (tk.t === 'fn') { const f = FNS[tk.v]; const a = atom(); return a ? x => f(a(x)) : null }
    return null
  }
  const root = expr()
  if (!root || i !== toks.length) return null
  // Must give a finite value somewhere in a sane range.
  let ok = false
  for (let k = -10; k <= 10; k++) if (Number.isFinite(root(k * 0.37 + 0.01))) { ok = true; break }
  return ok ? root : null
}

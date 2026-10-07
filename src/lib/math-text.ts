/**
 * Maths inside AI-written text: one place that finds, repairs, validates and
 * renders it, used for every piece of generated text (diagnostic and mastery
 * questions, options, feedback, lesson transcript and notes, topic titles).
 *
 * Text may carry maths as $...$, $$...$$, \(...\) or \[...\], or (when the model
 * forgot) as bare LaTeX such as "1.257 \times 10^{-2} \text{ T}". The pipeline:
 *   1. repairEscapes: undo JSON-escape damage ("\t" of \times read as a TAB, ...)
 *   2. delimitMath:   wrap bare LaTeX runs in $...$
 *   3. repairTex:     deterministic fixes (unbalanced braces, * for ×, \\cmd, ...)
 *   4. validateTex:   KaTeX parse with throwOnError; anything still invalid
 *      falls back to plain Unicode text with no backslash commands (texToPlain).
 *
 * Pure and dependency-light (KaTeX only): safe on the server and in the browser.
 */
import katex from 'katex'

export type MathSegment = { t: 'text'; v: string } | { t: 'math'; v: string; display: boolean }

/* ───────────── 1. JSON-escape damage ───────────── */

// Commands whose first letter collides with a JSON escape (\t \f \b \n \r).
const ESC_CMDS: Record<string, string[]> = {
  '\t': ['times', 'text', 'textbf', 'textit', 'textrm', 'theta', 'tau', 'tan', 'tanh', 'to', 'top', 'triangle', 'tilde', 'tfrac', 'therefore'],
  '\f': ['frac', 'forall', 'flat'],
  '\b': ['beta', 'bar', 'bf', 'big', 'bigl', 'bigr', 'Big', 'boxed', 'binom', 'bmod', 'bullet', 'because', 'begin', 'bot'],
  '\n': ['nu', 'neq', 'ne', 'nabla', 'not', 'neg', 'ni', 'notin', 'nearrow'],
  '\r': ['rho', 'right', 'rightarrow', 'Rightarrow', 'rangle', 'rfloor', 'rceil', 'rm'],
}
const ESC_LETTER: Record<string, string> = { '\t': 't', '\f': 'f', '\b': 'b', '\n': 'n', '\r': 'r' }

/** Undo the damage JSON escapes do to LaTeX ("\times" decoded as TAB + "imes"), and "\\cmd" double escapes. */
export function repairEscapes(s: string): string {
  if (!s) return s
  let out = s.replace(/[\t\f\b\n\r]([a-zA-Z]+)/g, (m, rest: string, off: number, all: string) => {
    const ch = m[0]
    const word = ESC_LETTER[ch] + rest
    const known = (ESC_CMDS[ch] ?? []).some(c => word === c || word.startsWith(c))
    // \f and \b never appear in real text; a TAB before letters is almost always \t of a command.
    if (ch === '\f' || ch === '\b') return '\\' + word
    if (ch === '\t') return known || looksMathy(all, off) ? '\\' + word : m
    // \n and \r are also real line breaks: only when the word is exactly a command and maths is around.
    return (ESC_CMDS[ch] ?? []).includes(word) && looksMathy(all, off) ? '\\' + word : m
  })
  out = out.replace(/[\f\b]/g, '')
  // "\\times" (double-escaped) inside maths: one backslash is meant. Keep "\\" line breaks before non-letters.
  out = out.replace(/\\\\(?=[a-zA-Z])/g, '\\')
  return out
}

function looksMathy(all: string, off: number) {
  const around = all.slice(Math.max(0, off - 12), off + 12)
  return /[\d^_{}=$]/.test(around)
}

/* ───────────── Segmenting ───────────── */

/** Split text into text and maths segments on $$..$$, $..$, \[..\] and \(..\). Unclosed delimiters stay text. */
export function splitDelimited(s: string): MathSegment[] {
  const out: MathSegment[] = []
  let i = 0
  let buf = ''
  const pushText = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = '' } }
  while (i < s.length) {
    const c = s[i]
    if (c === '\\' && s[i + 1] === '$') { buf += '$'; i += 2; continue }
    let open = '', close = '', display = false
    if (c === '$' && s[i + 1] === '$') { open = '$$'; close = '$$'; display = true }
    else if (c === '$') { open = '$'; close = '$' }
    else if (c === '\\' && s[i + 1] === '(') { open = '\\('; close = '\\)' }
    else if (c === '\\' && s[i + 1] === '[') { open = '\\['; close = '\\]'; display = true }
    if (open) {
      const end = findClose(s, i + open.length, close)
      if (end > i + open.length) {
        // A lone "$5" price or "$ 20" is text: require the maths not to be just a number+space start for single $.
        const inner = s.slice(i + open.length, end)
        if (!(open === '$' && isCurrency(s, i, inner))) {
          pushText()
          out.push({ t: 'math', v: inner, display })
          i = end + close.length
          continue
        }
      }
    }
    buf += c
    i++
  }
  pushText()
  return out
}

function findClose(s: string, from: number, close: string) {
  for (let j = from; j < s.length; j++) {
    if (s[j] === '\\' && close === '$' && s[j + 1] === '$') { j++; continue }
    if (s.startsWith(close, j)) {
      if (close === '$' && s[j + 1] === '$') return -1 // "$..$$" is malformed; let it be text
      return j
    }
  }
  return -1
}

function isCurrency(s: string, i: number, inner: string) {
  // "$5 and $10": both dollars followed by digits and the inner text is prose.
  return /^\d[\d,.]*\s/.test(inner) && /\s[a-z]{3,}/i.test(inner) && !/[\\^_=]/.test(inner) && /\d/.test(s[i + 1] ?? '')
}

/* ───────────── 2. Bare LaTeX in text ───────────── */

const STRONG = /\\[a-zA-Z]+|\^\{|_\{|\^[-\d]|_[a-zA-Z\d]\b/
const PROSE_WORD = /^[A-Za-z][a-z]{2,}[.,;:!?]?$/

/** Tokens split on whitespace, keeping {...} groups (which may contain spaces) whole. */
function tokens(s: string): string[] {
  const out: string[] = []
  let cur = '', depth = 0
  for (const ch of s) {
    if (ch === '{') depth++
    if (ch === '}') depth = Math.max(0, depth - 1)
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); out.push(ch); cur = ''; continue }
    cur += ch
  }
  if (cur) out.push(cur)
  // merge consecutive whitespace
  return out.reduce<string[]>((a, t) => { if (/^\s$/.test(t) && a.length && /^\s+$/.test(a[a.length - 1])) a[a.length - 1] += t; else a.push(t); return a }, [])
}

function mathyToken(t: string) {
  if (STRONG.test(t)) return true
  if (PROSE_WORD.test(t)) return false
  return /^[-+−]?[\d.,]+[%]?$/.test(t) || /^[=+\-−*/×·<>≤≥≈(),.]+$/.test(t) || /^[a-zA-Z]$/.test(t) || /[\d()^_{}=+*/]/.test(t) && !/[a-z]{3,}/.test(t.replace(/\\[a-zA-Z]+/g, ''))
}

/** Wrap bare LaTeX runs ("1.257 \times 10^{-2} \text{ T}") in $...$. Already-delimited maths is left alone. */
export function delimitMath(s: string): string {
  if (!s || !STRONG.test(s)) return s
  return splitDelimited(s).map(seg => {
    if (seg.t === 'math') return seg.display ? `$$${seg.v}$$` : `$${seg.v}$`
    if (!STRONG.test(seg.v)) return seg.v
    const toks = tokens(seg.v)
    const words = toks.filter(t => !/^\s+$/.test(t))
    // Short fragment with no prose word: the whole thing is maths (typical for options).
    if (words.length <= 8 && !words.some(w => PROSE_WORD.test(w) && !STRONG.test(w))) {
      const lead = seg.v.match(/^\s*/)![0], trail = seg.v.match(/\s*$/)![0]
      const core = seg.v.trim()
      const punct = core.match(/[.,;:!?]$/)?.[0] ?? ''
      return `${lead}$${punct ? core.slice(0, -1) : core}$${punct}${trail}`
    }
    // Otherwise wrap maximal runs of mathy tokens that contain a strong token.
    let out = ''
    let run: string[] = []
    const flush = () => {
      if (!run.length) return
      // Trailing whitespace stays outside.
      let tail = ''
      while (run.length && /^\s+$/.test(run[run.length - 1])) tail = run.pop()! + tail
      const body = run.join('')
      if (STRONG.test(body)) {
        const punct = body.match(/[.,;:!?]$/)?.[0] ?? ''
        out += `$${punct ? body.slice(0, -1) : body}$${punct}`
      } else out += body
      out += tail
      run = []
    }
    for (const t of toks) {
      if (/^\s+$/.test(t)) { if (run.length) run.push(t); else out += t; continue }
      if (mathyToken(t)) run.push(t)
      else { flush(); out += t }
    }
    flush()
    return out
  }).join('')
}

/* ───────────── 3. Repair + 4. validate ───────────── */

/** True when KaTeX parses the snippet (throwOnError). */
export function validateTex(tex: string): boolean {
  try { katex.renderToString(tex, { throwOnError: true, strict: 'ignore', output: 'html' }); return true } catch { return false }
}

const UNI_TEX: Record<string, string> = { '×': '\\times ', '·': '\\cdot ', '−': '-', '≤': '\\le ', '≥': '\\ge ', '≠': '\\ne ', '≈': '\\approx ', '√': '\\sqrt ', '°': '^\\circ ', 'π': '\\pi ', 'µ': '\\mu ', 'μ': '\\mu ', 'Ω': '\\Omega ', 'χ': '\\chi ', 'θ': '\\theta ', 'Δ': '\\Delta ', '∞': '\\infty ' }
const SUP: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' }

/** Deterministic fixes for common AI LaTeX mistakes. Returns the input unchanged when it already parses. */
export function repairTex(tex: string): string {
  // "*" typed for multiplication shows as KaTeX's ∗: always ×.
  let t = repairEscapes(tex).trim().replace(/\^\s*\*|\^\{\s*\*\s*\}|\*\*|\*/g, m => (m === '*' ? ' \\times ' : m === '**' ? '^' : m))
  if (validateTex(t)) return t
  // "*" for multiplication, unicode superscripts, stray $ inside.
  t = t.replace(/\$/g, '')
  t = t.replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+)/g, m => `^{${[...m].map(c => SUP[c]).join('')}}`)
  if (validateTex(t)) return t
  // Unicode symbols KaTeX can't take in some positions.
  t = t.replace(/[×·−≤≥≠≈√°πµμΩχθΔ∞]/g, c => UNI_TEX[c] ?? c)
  if (validateTex(t)) return t
  // Missing backslash on common commands ("times 10^{-2}", "frac{1}{2}").
  t = t.replace(/(^|[^\\a-zA-Z])(times|frac|sqrt|cdot|text|mu|pi|theta|alpha|beta|Delta|Omega|chi)(?=[\s{\d])/g, '$1\\$2')
  if (validateTex(t)) return t
  // Unbalanced braces: drop extra closers, close open groups.
  let depth = 0, b = ''
  for (const ch of t) {
    if (ch === '{') depth++
    if (ch === '}') { if (depth === 0) continue; depth-- }
    b += ch
  }
  t = b + '}'.repeat(depth)
  if (validateTex(t)) return t
  // Unknown commands: \text{} their names? No: drop \left/\right mismatches, then unknown commands.
  t = t.replace(/\\(left|right)\s*([()[\]|.]|\\[{}])/g, '$2')
  if (validateTex(t)) return t
  return tex
}

/* ───────────── Plain fallback ───────────── */

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
}
const SYM: Record<string, string> = {
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', sim: '∼', equiv: '≡', propto: '∝',
  infty: '∞', circ: '°', degree: '°', to: '→', rightarrow: '→', Rightarrow: '⇒', leftarrow: '←', implies: '⇒', partial: '∂', nabla: '∇', sum: 'Σ', prod: 'Π', int: '∫',
  ldots: '…', cdots: '⋯', dots: '…', angle: '∠', perp: '⊥', parallel: '∥', in: '∈', cup: '∪', cap: '∩', hbar: 'ħ', ell: 'ℓ', prime: '′', quad: ' ', qquad: '  ', ',': ' ', ';': ' ', '!': '', ' ': ' ',
}
const SUPS: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '+': '⁺', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ', '−': '⁻' }
const SUBS: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '-': '₋', '+': '₊', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', h: 'ₕ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', p: 'ₚ', s: 'ₛ', t: 'ₜ', i: 'ᵢ', r: 'ᵣ', u: 'ᵤ', v: 'ᵥ' }

function script(body: string, map: Record<string, string>, mark: string) {
  const all = [...body].every(c => c in map)
  return all ? [...body].map(c => map[c]).join('') : `${mark}(${body})`
}

/** Readable Unicode for a LaTeX snippet. Never contains a backslash command. */
export function texToPlain(tex: string): string {
  let t = repairEscapes(tex)
  // Groups first (innermost-out), a few passes.
  for (let k = 0; k < 6; k++) {
    const before = t
    t = t.replace(/\\(?:text|textrm|textbf|textit|mathrm|mathbf|mathit|operatorname|mbox|vec|hat|bar|overline|boldsymbol)\s*\{([^{}]*)\}/g, '$1')
    t = t.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_m, a: string, b: string) => `${wrapIf(a)}/${wrapIf(b)}`)
    t = t.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, '$1√($2)')
    t = t.replace(/\\sqrt\s*\{([^{}]*)\}/g, (_m, a: string) => `√${wrapIf(a)}`)
    t = t.replace(/\^\s*\{([^{}]*)\}/g, (_m, a: string) => script(a.trim(), SUPS, '^'))
    t = t.replace(/_\s*\{([^{}]*)\}/g, (_m, a: string) => script(a.trim(), SUBS, '_'))
    if (t === before) break
  }
  t = t.replace(/\^\s*\\circ/g, '°')
  t = t.replace(/\^([0-9a-zA-Z+\-−])/g, (_m, a: string) => SUPS[a] ?? `^${a}`)
  t = t.replace(/_([0-9a-zA-Z])/g, (_m, a: string) => SUBS[a] ?? `_${a}`)
  t = t.replace(/\\left|\\right|\\displaystyle|\\limits|\\big[lr]?|\\Big[lr]?/g, '')
  t = t.replace(/\s*\\(times|cdot|div|pm|mp|le|leq|ge|geq|ne|neq|approx|equiv|to|rightarrow|Rightarrow|implies)(?![a-zA-Z])\s*/g, (_m, name: string) => ` ${SYM[name]} `)
  t = t.replace(/\\([a-zA-Z]+)/g, (_m, name: string) => GREEK[name] ?? SYM[name] ?? (/^(sin|cos|tan|log|ln|exp|lim|max|min|det|sec|csc|cot)$/.test(name) ? name + ' ' : ''))
  t = t.replace(/\\([,;!: ])/g, ' ').replace(/\\\\/g, ' ').replace(/\\[{}$%&#_]/g, m => m[1]).replace(/\\/g, '')
  t = t.replace(/[{}]/g, '').replace(/[ \t]{2,}/g, ' ')
  return t.trim()
}

function wrapIf(s: string) { return /^[\w.\u0370-\u03ff]+$/.test(s.trim()) ? s.trim() : `(${s.trim()})` }

/** Plain text for any generated string (delimiters dropped, maths as Unicode). */
export function toPlainText(s: string): string {
  return prepareMathText(s).map(seg => (seg.t === 'math' ? texToPlain(seg.v) : seg.v)).join('')
}

/* ───────────── The pipeline ───────────── */

export type PreparedSegment = { t: 'text'; v: string } | { t: 'math'; v: string; display: boolean; ok: boolean }

/**
 * Text -> segments ready to render: escape damage undone, bare LaTeX delimited,
 * every maths snippet repaired and validated. `ok: false` maths must be shown
 * with texToPlain (never as raw LaTeX).
 */
export function prepareMathText(s: string): PreparedSegment[] {
  if (!s) return []
  const fixed = delimitMath(repairEscapes(s))
  return splitDelimited(fixed).map(seg => {
    if (seg.t === 'text') {
      // Text should never show backslash commands: a stray one is converted to Unicode.
      return /\\[a-zA-Z]/.test(seg.v) ? { t: 'text', v: texToPlain(seg.v) } : seg
    }
    const tex = repairTex(seg.v)
    return { t: 'math', v: tex, display: seg.display, ok: validateTex(tex) && tex.trim().length > 0 }
  })
}

/**
 * Canonical stored form of a generated string: maths delimited with $...$ and
 * repaired; snippets that cannot be repaired become plain Unicode text.
 * `issues` lists snippets that needed the plain fallback (so the caller can re-ask the model).
 */
export function normalizeMathText(s: string, issues?: string[]): string {
  if (typeof s !== 'string' || !s) return s
  return prepareMathText(s).map(seg => {
    if (seg.t === 'text') return seg.v
    if (seg.ok) return seg.display ? `$$${seg.v}$$` : `$${seg.v}$`
    issues?.push(seg.v)
    return texToPlain(seg.v)
  }).join('')
}

/** A LaTeX snippet (no delimiters) repaired; null when it cannot be made to parse. */
export function normalizeTex(tex: string): string | null {
  const t = repairTex(String(tex ?? ''))
  return validateTex(t) ? t : null
}

/* ───────────── Numbers in options ───────────── */

export interface ParsedNumber { value: number; unit: string; decimals: number; sig: number }

/**
 * The single number an option states ("$1.257 \times 10^{-2}$ T", "318.3 A/m",
 * "x = 4", "₦2,500"), or null when it is not a plain number (expressions, words).
 */
export function parseOptionNumber(opt: string): ParsedNumber | null {
  let s = repairEscapes(opt).replace(/\$/g, ' ')
  // "4\pi \times 10^{-7}" is a number too (and must not sit beside its own decimal value).
  s = s.replace(/(\d+(?:\.\d+)?)?\s*(?:\\pi|π)(?![a-zA-Z])/g, (_m, a?: string) => String((a ? Number(a) : 1) * Math.PI))
  // Only plain numbers: any structural command (fractions, roots, sums...) means an expression.
  const cmds = s.match(/\\[a-zA-Z]+/g) ?? []
  if (cmds.some(c => !/^\\(text\w*|mathrm|times|cdot|mu|micro|Omega|circ|degree|quad|qquad|approx)$/.test(c))) return null
  if (/\^\s*\{?[^{}]*\}?/.test(s.replace(/10\s*\^\s*\{?\s*[-−+]?\d+\s*\}?/g, '').replace(/\^\s*\\circ/g, '').replace(/[a-zA-Z]+\^\s*\{?-?\d\}?/g, ''))) return null
  s = s.replace(/\\text\w*\s*\{([^{}]*)\}/g, ' $1 ').replace(/\\mathrm\s*\{([^{}]*)\}/g, ' $1 ')
  s = s.replace(/\\(?:,|;|!|:|quad|qquad| )/g, ' ')
  s = s.replace(/\\(?:times|cdot)\s*10\s*\^\s*\{?\s*([-−+]?\d+)\s*\}?/g, 'e$1')
  s = s.replace(/[×·x*]\s*10\s*\^?\s*\{?\s*([-−+]?\d+)\s*\}?/g, 'e$1')
  s = s.replace(/[×·]\s*10([⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_m, e: string) => 'e' + [...e].map(c => SUP[c]).join(''))
  s = s.replace(/\\(mu|micro)\b/g, 'µ').replace(/\\Omega\b/g, 'Ω').replace(/\\circ|\\degree/g, '°').replace(/\\%/g, '%')
  s = s.replace(/\\[a-zA-Z]+/g, ' ').replace(/[{}]/g, '').replace(/−/g, '-').replace(/\s+/g, ' ').trim()
  // Strip a leading "x =" / "B ≈" label.
  s = s.replace(/^[A-Za-z\u0370-\u03ff][\w\u0370-\u03ff]{0,3}\s*(?:=|≈)\s*/, '')
  const m = s.match(/^(?:₦|N|\$|£|€)?\s*([-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*e\s*([-+]?\d+))?\s*(.*)$/)
  if (!m) return null
  const unit = m[3].trim().replace(/[.,;]$/, '')
  if (unit && !/^[A-Za-zµΩ°%/·\s^0-9²³⁻\-]{1,16}$/.test(unit)) return null
  if (unit && /\d/.test(unit.replace(/\^-?\d|[²³]|-?\d$/, ''))) return null
  const mant = m[1].replace(/,/g, '')
  const value = Number(mant) * Math.pow(10, m[2] ? Number(m[2]) : 0)
  if (!Number.isFinite(value)) return null
  const decimals = (mant.split('.')[1] ?? '').length - (m[2] ? Number(m[2]) : 0)
  const sig = mant.replace(/^[-+]?0*\.?0*/, '').replace('.', '').length || 1
  return { value, unit: unit.replace(/\s+/g, ''), decimals, sig }
}

/** Two numbers that a learner could not tell apart after rounding. */
export function tooClose(a: ParsedNumber, b: ParsedNumber): boolean {
  if (a.unit !== b.unit) return false
  const m = Math.max(Math.abs(a.value), Math.abs(b.value))
  if (m === 0) return true
  if (Math.abs(a.value - b.value) / m < 0.015) return true
  // Equal when both are rounded to the coarser shown precision.
  const d = Math.min(a.decimals, b.decimals)
  const r = (v: number) => Math.round(v * Math.pow(10, d))
  return d < 15 && d > -15 && r(a.value) === r(b.value)
}

/** Whether `computed` matches a shown number within its rounding (or 0.3%). */
export function matchesShown(computed: number, shown: ParsedNumber): boolean {
  if (!Number.isFinite(computed)) return false
  const half = 0.5 * Math.pow(10, -shown.decimals)
  const tol = Math.max(half * 1.01, Math.abs(shown.value) * 0.003)
  return Math.abs(computed - shown.value) <= tol
}

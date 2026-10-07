import { splitSayWords, type Step } from '@/lib/lesson-schema'

/* ───────────── Math to spoken words ───────────── */

const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'theta', 'lambda', 'mu', 'pi', 'sigma', 'phi', 'omega', 'rho', 'tau']

/** Strip one level of braces content: finds the balanced {...} starting at i. */
function group(s: string, i: number): [string, number] {
  if (s[i] !== '{') {
    // single token: a command or one character
    if (s[i] === '\\') {
      const m = /^\\[a-zA-Z]+/.exec(s.slice(i))
      if (m) return [m[0], i + m[0].length]
    }
    return [s[i] ?? '', i + 1]
  }
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++
    else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1]
  }
  return [s.slice(i + 1), s.length]
}

function powerWords(exp: string): string {
  const e = exp.trim()
  if (e === '2') return ' squared'
  if (e === '3') return ' cubed'
  if (e === '-1') return ' to the minus one'
  if (e === "'" || e === '\\prime') return ' prime'
  return ` to the power ${texToWords(e)}`
}

/** Turn a KaTeX/LaTeX expression into something a speech engine reads naturally. */
export function texToWords(tex: string): string {
  if (/\\begin\{(array|matrix|tabular|pmatrix|bmatrix)/.test(tex)) return 'as shown in the table'
  let out = ''
  let i = 0
  const s = tex
  while (i < s.length) {
    const c = s[i]
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i))!
      const cmd = m[1]
      i += m[0].length
      switch (cmd) {
        case 'frac': case 'dfrac': case 'tfrac': {
          const [a, i1] = group(s, skipWs(s, i)); const [b, i2] = group(s, skipWs(s, i1)); i = i2
          if (a.trim() === 'd' && /^d\s*[a-z]$/.test(b.trim())) out += ` d by d ${b.trim().slice(-1)} of `
          else if (/^\s*[\w.]+\s*$/.test(a) && /^\s*[\w.]+\s*$/.test(b)) out += ` ${texToWords(a)} over ${texToWords(b)} `
          else out += ` the fraction ${texToWords(a)}, over ${texToWords(b)}, `
          break
        }
        case 'sqrt': { const [a, i1] = group(s, skipWs(s, i)); i = i1; out += ` the square root of ${texToWords(a)} `; break }
        case 'lim': {
          let sub = ''
          if (s[i] === '_') { const [g, i1] = group(s, i + 1); sub = g; i = i1 }
          out += sub ? ` the limit as ${texToWords(sub)} of ` : ' the limit of '
          break
        }
        case 'sum': out += ' the sum of '; if (s[i] === '_') { const [, i1] = group(s, i + 1); i = i1 } if (s[i] === '^') { const [, i1] = group(s, i + 1); i = i1 } break
        case 'int': out += ' the integral of '; if (s[i] === '_') { const [, i1] = group(s, i + 1); i = i1 } if (s[i] === '^') { const [, i1] = group(s, i + 1); i = i1 } break
        case 'text': case 'mathrm': case 'mathbf': case 'operatorname': case 'textbf': case 'mathit': {
          const [a, i1] = group(s, skipWs(s, i)); i = i1; out += ` ${a} `; break
        }
        case 'to': case 'rightarrow': out += ' approaches '; break
        case 'Rightarrow': case 'implies': out += ', so '; break
        case 'cdot': case 'times': out += ' times '; break
        case 'div': out += ' divided by '; break
        case 'pm': out += ' plus or minus '; break
        case 'le': case 'leq': out += ' is less than or equal to '; break
        case 'ge': case 'geq': out += ' is greater than or equal to '; break
        case 'neq': case 'ne': out += ' is not equal to '; break
        case 'approx': out += ' is approximately '; break
        case 'infty': out += ' infinity '; break
        case 'prime': out += ' prime '; break
        case 'left': case 'right': case 'displaystyle': case 'quad': case 'qquad': case ',': case ';': case '!': case ' ': out += ' '; break
        case 'sin': case 'cos': case 'tan': case 'ln': case 'log': case 'exp': out += ` ${cmd} of `; break
        default: out += GREEK.includes(cmd.toLowerCase()) ? ` ${cmd.toLowerCase()} ` : ' '
      }
      continue
    }
    if (c === '^') { const [g, i1] = group(s, i + 1); i = i1; out += powerWords(g); continue }
    if (c === '_') { const [g, i1] = group(s, i + 1); i = i1; out += ` sub ${texToWords(g)} `; continue }
    if (c === "'") { out += ' prime '; i++; continue }
    if (c === '{' || c === '}') { i++; continue }
    if (c === '=') { out += ' equals '; i++; continue }
    if (c === '+') { out += ' plus '; i++; continue }
    if (c === '-') { out += ' minus '; i++; continue }
    if (c === '<') { out += ' is less than '; i++; continue }
    if (c === '>') { out += ' is greater than '; i++; continue }
    if (c === '(' && /(^|[\s\d])([a-zA-Z]|prime)\s*$/.test(out) && /^[^)]{1,6}\)/.test(s.slice(i + 1))) {
      // f(x), f'(1): "f of x"
      out += ' of '; i++; continue
    }
    if (c === '(') {
      // (x+h)^2: "the quantity x plus h, squared"
      let depth = 0, j = i
      for (; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')' && --depth === 0) break }
      if (s[j + 1] === '^') {
        const [g, k] = group(s, j + 2)
        out += ` the quantity ${texToWords(s.slice(i + 1, j))},${powerWords(g)} `
        i = k
        continue
      }
    }
    if (c === '(' || c === ')') { out += ' '; i++; continue }
    if (c === '&' || c === '|') { out += ' '; i++; continue }
    out += c
    i++
  }
  return tidy(out)
}

function skipWs(s: string, i: number) {
  while (s[i] === ' ') i++
  return i
}

function tidy(s: string) {
  return s.replace(/\s+/g, ' ').replace(/\s+([,.?!])/g, '$1').replace(/,\s*,/g, ',').trim().replace(/,$/, '')
}

const UNICODE_WORDS: [RegExp, string][] = [
  [/([A-Za-z0-9)])²/g, '$1 squared'],
  [/([A-Za-z0-9)])³/g, '$1 cubed'],
  [/([a-zA-Z])′\(/g, '$1 prime of ('],
  [/\b([a-zA-Z])'\(([^)]{1,6})\)/g, '$1 prime of $2'],
  [/→/g, ' approaches '],
  [/≈/g, ' is approximately '],
  [/≤/g, ' is less than or equal to '],
  [/≥/g, ' is greater than or equal to '],
  [/≠/g, ' is not equal to '],
  [/·|×/g, ' times '],
  [/√/g, ' the square root of '],
  [/π/g, ' pi '],
]

/** Readable caption text (may contain inline $...$) to plain words for a speech engine. */
export function toSpeech(text: string): string {
  let t = text.replace(/\$([^$]+)\$/g, (_, tex: string) => ` ${texToWords(tex)} `)
  for (const [re, rep] of UNICODE_WORDS) t = t.replace(re, rep)
  // "x = 1" outside math: read the sign.
  t = t.replace(/\s=\s/g, ' equals ')
  return tidy(t)
}

/* ───────────── What each step says ───────────── */

export interface Line {
  /** Step index the line belongs to. */
  index: number
  /** Display text; may contain inline $...$ math. */
  text: string
  /** A board equation rather than a spoken sentence. */
  kind: 'say' | 'math' | 'check'
}

/**
 * The transcript line(s) a step contributes. `say` is the narration; a write or
 * math step without its own `say` contributes what it puts on the board, and a
 * check contributes its question.
 */
export function stepLines(step: Step, index: number): Line[] {
  const out: Line[] = []
  if (step.say?.trim()) out.push({ index, text: step.say.trim(), kind: 'say' })
  else if (step.type === 'write') out.push({ index, text: liveAsExpr(step.text).replace(/\s*\n\s*/g, ' '), kind: 'say' })
  if (step.type === 'check') out.push({ index, text: step.prompt, kind: 'check' })
  // A live readout ({{t:2}}) is a number that changes on the board, not a line of working: shown as its
  // expression it reads "t = t s", so it stays out of the transcript.
  if (step.type === 'math' && !/\\begin\{/.test(step.tex) && !hasLive(step.tex)) out.push({ index, text: `$${step.tex}$`, kind: 'math' })
  if (step.type === 'transform' && step.tex && !/\\begin\{/.test(step.tex) && !hasLive(step.tex)) out.push({ index, text: `$${step.tex}$`, kind: 'math' })
  return out
}

const hasLive = (text: string) => /\{\{[^{}]+\}\}/.test(text)

/** Live values ({{expr}} / {{expr:2}}) shown as their expression, for the transcript and the voice. */
export function liveAsExpr(text: string): string {
  return text.replace(/\{\{([^{}:]+)(?::\d)?\}\}/g, (_, ex: string) => ex.trim())
}

/**
 * What the narrator says for a step, in plain words, plus where each narration
 * word (the words cues index into: `say`, or a write step's text) starts in the
 * spoken text. Each word is converted on its own so the mapping is exact.
 */
export function stepNarration(step: Step): { text: string; map: number[] } {
  const parts: string[] = []
  const map: number[] = []
  let count = 0
  const src = step.say?.trim() ? step.say : step.type === 'write' ? liveAsExpr(step.text) : ''
  if (src) {
    for (const w of splitSayWords(src)) {
      map.push(count)
      const spoken = w === '=' ? 'equals' : toSpeech(w)
      if (spoken) { parts.push(spoken); count += spoken.split(/\s+/).filter(Boolean).length }
    }
  } else if (step.type === 'math' && !hasLive(step.tex)) parts.push(texToWords(step.tex))
  else if (step.type === 'transform' && step.tex && !hasLive(step.tex)) parts.push(texToWords(step.tex))
  if (step.type === 'check') parts.push(toSpeech(step.prompt))
  return { text: tidy(parts.filter(Boolean).join(' ')), map }
}

/** What the narrator should say for a step, in plain words (empty = silent step). */
export function stepSpeech(step: Step): string {
  return stepNarration(step).text
}

/** Rough speaking time at rate 1, used as a fallback when an engine never reports the end. */
export function estimateSpeechMs(text: string) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  return 1200 + words * 430
}

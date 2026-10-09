/**
 * The deterministic item validator (docs/design/assessment.md §5-6). No item reaches a learner without passing it.
 *
 *  accuracy   key verified by computation (calc, algebraic equivalence, substitution into the equation), each numeric
 *             distractor's stated value verified (calcs), options pairwise distinct and non-equivalent, the correctness
 *             guard's claim checker on the stem and explanation (correctness/claims.ts, not duplicated here);
 *  cues       no all/none of the above, no negative stems, key not the longest, no a/an cue, no stem-word clang;
 *  form       parallel options (same kind, unit, precision), no padded exact values, low reading load, warm feedback;
 *  fairness   curriculum/locale: SI unless the learner is on a US system, no currency/exam/places the learner's goal or
 *             lesson did not bring, plain international English;
 *  alignment  align.ts: only taught objectives, notation, terms and representations;
 *  figures    only when needed (stem refers to it or the skill is visual), alt text, labels the stem names exist,
 *             valid spec; rendering and layout checks in figure.ts.
 *
 * Pure (no I/O); server-side (imports the diagram checker).
 */
import { checkItem, evalCalc, type RawItem } from '../question-quality'
import { checkText, texToExpr } from '../correctness/claims'
import { compileExpr, type CheckStep, type Step } from '../lesson-schema'
import { normalizeMathText, parseOptionNumber, splitDelimited, toPlainText } from '../math-text'
import { validateInteractive } from '../agent/interactive'
import { checkSubstance, type DiagramLibrary } from '../agent/math-diagram'
import { alignItem, taughtFromSteps, wordsOf, type Taught } from './align'
import type { Curriculum } from './curriculum'
import type { AssessItem, Bloom, ItemFigure } from './spec'

export type Severity = 'block' | 'warn'
export interface Finding { code: string; severity: Severity; detail: string }
export interface ItemContext {
  surface: 'diagnostic' | 'mastery' | 'practice' | 'recheck' | 'check'
  curriculum?: Curriculum | null
  /** What the tutor taught (mastery, practice, lesson checks). Null for the diagnostic (nothing taught yet). */
  taught?: Taught | null
  /** Learner level line (reading-load target). */
  level?: string | null
  /** The skill being assessed (title + summary): decides whether a figure is needed. */
  skill?: string
  requireCalc?: boolean
  /** The learner's own goal words (locale: currency/places they brought themselves are fine). */
  goal?: string | null
}
export interface ItemVerdict { item: AssessItem; findings: Finding[]; problems: string[]; ok: boolean }

const plain = (s: string) => toPlainText(s ?? '').trim()
const letter = (i: number) => String.fromCharCode(65 + i)

/* ───────────── algebra: equivalence by evaluation ───────────── */

const FUNCS = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'ln', 'log', 'sqrt', 'abs', 'pi', 'e'])
/** A TeX/plain expression as a function of its single-letter variables, or null. */
export function algebra(src: string): { vars: string[]; f: (env: Record<string, number>) => number } | null {
  let s = src.replace(/\$/g, '').trim()
  if (!s || s.length > 160 || /[=<>≤≥]|\\(?:le|ge|lt|gt|neq|approx)\b|,|\bor\b|\band\b/.test(s)) return null
  s = texToExpr(s).replace(/\s+/g, '').replace(/×|·/g, '*').replace(/−/g, '-').replace(/\*\*/g, '^')
  if (!/[a-zA-Z]/.test(s) || /[^0-9a-zA-Z+\-*/^().]/.test(s)) return null
  // Split runs of letters into single-letter variables (2xy -> 2x*y), keeping function names.
  s = s.replace(/[a-zA-Z]+/g, w => (FUNCS.has(w) ? w : w.split('').join('*')))
  const vars = [...new Set((s.match(/[a-zA-Z]+/g) ?? []).filter(w => !FUNCS.has(w)))]
  if (!vars.length || vars.length > 3) return null
  // Map each variable to a board variable name compileExpr accepts.
  const names = vars.map((_, i) => `v${'abc'[i]}`)
  let t = s
  vars.forEach((v, i) => { t = t.replace(new RegExp(`(?<![a-zA-Z])${v}(?![a-zA-Z])`, 'g'), names[i]) })
  const c = compileExpr(t, names, false)
  if (!c.ok) return null
  return { vars, f: env => c.fn(0, Object.fromEntries(vars.map((v, i) => [names[i], env[v]]))) }
}

const SAMPLES = [[1.37, 0.61, 2.21], [-0.83, 1.9, 0.47], [2.6, -1.3, 1.11], [0.29, 2.4, -0.71], [-1.7, -0.45, 3.05]]
export function equivalent(a: string, b: string): boolean | null {
  const A = algebra(a), B = algebra(b)
  if (!A || !B) return null
  const vars = [...new Set([...A.vars, ...B.vars])]
  let n = 0
  for (const row of SAMPLES) {
    const env = Object.fromEntries(vars.map((v, i) => [v, row[i % row.length]]))
    const x = A.f(env), y = B.f(env)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    n++
    if (Math.abs(x - y) > 1e-7 * Math.max(1, Math.abs(x), Math.abs(y))) return false
  }
  return n >= 3 ? true : null
}

/** The maths expressions/equations in a text ($...$ segments, else the text after a colon). */
function mathSegments(text: string): string[] {
  const segs = splitDelimited(text).filter(s => s.t === 'math').map(s => s.v.trim())
  if (segs.length) return segs
  const m = text.match(/:\s*([^?]+)\??$/)
  return m ? [m[1].trim()] : []
}

/** Values in a solution option: "$x = 2.5$ or $x = -1$", "$4$", "$x = 3, -2$". */
function solutionValues(opt: string): number[] | null {
  const s = plain(opt).replace(/\band\b|\bor\b|;/g, ',')
  const nums = [...s.matchAll(/(?:^|[=,\s])\s*(-?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)(?=\s*(?:,|$))/g)].map(m => m[1].includes('/') ? Number(m[1].split('/')[0]) / Number(m[1].split('/')[1]) : Number(m[1]))
  if (!nums.length || nums.some(n => !Number.isFinite(n))) return null
  if (/[a-wyz]\s*\(|√|sqrt|\\/.test(s)) return null
  return nums
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a))
/** Heuristic: no bracket (or the whole expression) still has a common whole-number or letter factor in its terms. */
export function fullyFactorised(src: string): boolean {
  const s = plain(src).replace(/\s+/g, '').replace(/−/g, '-').replace(/²/g, '^2').replace(/³/g, '^3')
  const groups = [...s.matchAll(/\(([^()]+)\)/g)].map(m => m[1])
  if (!groups.length) groups.push(s)
  for (const g of groups) {
    const terms = g.split(/(?=[+-])/).map(t => t.replace(/^\+/, '')).filter(Boolean)
    if (terms.length < 2) continue
    const coef = terms.map(t => { const m = t.match(/^-?(\d+)/); return m ? Number(m[1]) : 1 })
    if (coef.reduce(gcd) > 1) return false
    const letters = terms.map(t => new Set(t.replace(/\^\d+/g, '').match(/[a-z]/gi) ?? []))
    if ([...letters[0]].some(ch => letters.every(L => L.has(ch)))) return false
  }
  return true
}

/** An option with its number replaced by `v` at `sig` significant figures, keeping its notation and unit. */
function restate(opt: string, v: number, sig: number): string | null {
  const p = Math.max(2, Math.min(4, sig || 3))
  const sci = /(-?\d+(?:\.\d+)?)\s*\\times\s*10\^\{?\s*(-?\d+)\s*\}?/
  if (sci.test(opt)) {
    if (v === 0) return null
    const e = Math.floor(Math.log10(Math.abs(v)))
    const m = (v / Math.pow(10, e)).toFixed(p - 1)
    return opt.replace(sci, `${m} \\times 10^{${e}}`)
  }
  const plainNum = /-?\d+(?:,\d{3})*(?:\.\d+)?/
  if (!plainNum.test(opt)) return null
  const dec = (opt.match(plainNum)![0].split('.')[1] ?? '').length
  const pr = v.toPrecision(p)
  const txt = /e/.test(pr) ? null : dec ? pr : String(Number(pr))
  return txt === null ? null : opt.replace(plainNum, txt)
}

function accuracyFindings(item: AssessItem): Finding[] {
  const out: Finding[] = []
  const q = plain(item.q)
  // Factorise items legitimately offer equal-but-incomplete factorisations (3(2x^2 - 3x) for 6x^2 - 9x) as distractors;
  // what must hold is that the key is fully factorised and no other option is a complete factorisation too.
  const factorise = /\bfactori[sz]e\b/i.test(q)
  const target = /\b(factori[sz]e|expand|simplify|multiply out|remove the brackets)\b/i.test(q) ? mathSegments(item.q).find(s => !/=/.test(s) && algebra(s)) : undefined
  // Options that are the same expression in a different form ((2x+3)(x+1) vs (x+1)(2x+3)).
  for (let i = 0; i < item.options.length; i++) for (let j = i + 1; j < item.options.length; j++) {
    if (equivalent(item.options[i], item.options[j]) !== true) continue
    if (factorise && target && equivalent(target, item.options[i]) === true && fullyFactorised(item.options[i]) !== fullyFactorised(item.options[j])) continue
    if (factorise && target && !fullyFactorised(item.options[i]) && !fullyFactorised(item.options[j])) continue
    out.push({ code: 'equivalent-options', severity: 'block', detail: `options ${letter(i)} and ${letter(j)} are the same expression written differently` })
  }
  if (target) {
    const k = equivalent(target, item.options[item.answer])
    if (k === false) out.push({ code: 'key-wrong', severity: 'block', detail: `the marked answer ${plain(item.options[item.answer])} is not equal to ${plain(target)}` })
    if (factorise && k === true && !fullyFactorised(item.options[item.answer])) out.push({ code: 'key-wrong', severity: 'block', detail: `the marked answer ${plain(item.options[item.answer])} is not fully factorised` })
    item.options.forEach((o, i) => {
      if (i === item.answer || equivalent(target, o) !== true) return
      if (factorise && !fullyFactorised(o)) return
      out.push({ code: 'second-key', severity: 'block', detail: `option ${letter(i)} (${plain(o)}) is also equal to ${plain(target)}, so two options are correct` })
    })
  }
  // Solve: substitute the key's values into the equation; a distractor must not also satisfy it.
  const solve = q.match(/\b(?:solve|find|what is|work out|calculate)\b[^.?]*?\b(?:for\s+)?([a-z])\b/i)
  if (/\bsolve\b|\bvalue of [a-z]\b|\bfind [a-z]\b/i.test(q) && solve) {
    const v = /\bfor ([a-z])\b/i.exec(q)?.[1] ?? /\b(?:value of|find) ([a-z])\b/i.exec(q)?.[1] ?? solve[1]
    const eq = mathSegments(item.q).find(s => (s.match(/=/g) ?? []).length === 1 && new RegExp(`(?<![a-zA-Z\\\\])${v}(?![a-zA-Z])`).test(s))
    if (eq) {
      const [l, r] = eq.split('=')
      const L = algebra(l.includes(v) ? l : `${l}+0*${v}`), R = algebra(r.includes(v) ? r : `${r}+0*${v}`)
      if (L && R && L.vars.length === 1 && R.vars.length === 1) {
        const holds = (x: number) => { const a = L.f({ [v]: x }), b = R.f({ [v]: x }); return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)) + 5e-3 * Math.max(1, Math.abs(b)) * (Number.isInteger(x) ? 0.001 : 1) }
        const kv = solutionValues(item.options[item.answer])
        if (kv && !kv.every(holds)) out.push({ code: 'key-wrong', severity: 'block', detail: `the marked answer ${plain(item.options[item.answer])} does not satisfy ${plain(eq)}` })
        item.options.forEach((o, i) => {
          if (i === item.answer) return
          const dv = solutionValues(o)
          if (dv && kv && dv.length === kv.length && dv.every(holds)) out.push({ code: 'second-key', severity: 'block', detail: `option ${letter(i)} (${plain(o)}) also satisfies ${plain(eq)}` })
        })
      }
    }
  }
  // Each numeric distractor's stated value must be what its mistake actually gives. When the writer's arithmetic
  // for a distractor is right but the number it printed is not, the option is corrected to the computed value (the
  // distractor then shows exactly what that mistake produces); it is blocked only if the corrected value would
  // collide with the key or another option.
  if (Array.isArray(item.calcs)) item.calcs.forEach((c, i) => {
    if (i === item.answer || typeof c !== 'string' || !c.trim()) return
    const n = parseOptionNumber(item.options[i])
    const v = evalCalc(c)
    if (!n || !Number.isFinite(v)) return
    if (Math.abs(v - n.value) <= Math.max(Math.abs(v) * 0.006, Math.pow(10, -Math.max(0, n.decimals)) / 2 + 1e-12)) return
    const fixed = restate(item.options[i], v, n.sig)
    const fn = fixed ? parseOptionNumber(fixed) : null
    const clash = !fn || item.options.some((o, k) => { if (k === i) return false; const m = parseOptionNumber(o); return !!m && m.unit === fn.unit && Math.abs(m.value - fn.value) <= 0.015 * Math.max(Math.abs(m.value), Math.abs(fn.value)) })
    if (fixed && !clash) { out.push({ code: 'distractor-fixed', severity: 'warn', detail: `option ${letter(i)} restated from ${plain(item.options[i])} to ${plain(fixed)} (what "${c}" gives)` }); item.options[i] = fixed }
    else out.push({ code: 'distractor-value', severity: 'block', detail: `option ${letter(i)} states ${plain(item.options[i])} but its mistake ("${c}") gives ${Number(v.toPrecision(4))}` })
  })
  // The correctness guard's claim checker on the stem and the explanation (wrong arithmetic, solutions, percentages).
  for (const [where, text] of [['question', item.q], ['explanation', item.explain ?? '']] as const) {
    if (!text) continue
    const c = checkText(text)
    for (const w of c.wrong.filter(w => w.kind !== 'solution').slice(0, 2)) out.push({ code: 'guard', severity: 'block', detail: `the ${where} says ${w.source} but it is ${w.fix}`.replace(/\s+/g, ' ') })
  }
  return out
}

/* ───────────── cues and form ───────────── */

/** The one number an option states; null for pairs/lists ("$2$ and $3$") and expressions. */
export function singleNumber(o: string) {
  const t = plain(o)
  if ((t.match(/-?\d+(?:[.,]\d+)*/g) ?? []).filter(x => !/^10$/.test(x)).length > 2 || /\b(and|or)\b|,\s*-?\d/.test(t)) return null
  const n = parseOptionNumber(o)
  // "10x", "-2x - 8", "3x2": algebra, not a number with a unit.
  if (n && n.unit && (/[+\-=]/.test(n.unit) || /^[a-zA-Z](\^?\d)?$/.test(n.unit) && !/^[msglhAVWJNTKCFH]$/.test(n.unit))) return null
  return n
}
const NUMERIC = (o: string) => !!singleNumber(o)
const isMathOnly = (o: string) => /^\s*\$[^$]+\$\s*$/.test(o)

function cueFindings(item: AssessItem): Finding[] {
  const out: Finding[] = []
  const opts = item.options.map(plain)
  const q = plain(item.q)
  if (opts.some(o => /\b(all|none) of (the )?(above|these)\b|\bboth [a-e] and [a-e]\b|^\s*[a-e] (and|&) [a-e]\s*$/i.test(o))) out.push({ code: 'all-none-above', severity: 'block', detail: '"all/none of the above" or a combined option' })
  if (/\b(NOT|EXCEPT)\b/.test(item.q) || /\bwhich (?:of the following |one )?(?:is|are|would be) (?:not|incorrect|false|wrong)\b|\b(?:incorrect|wrong) (?:value|answer|result) (?:would|will|do)\b/i.test(q)) out.push({ code: 'negative-stem', severity: 'block', detail: 'negatively worded stem (NOT / EXCEPT / "which is incorrect" / asks for a wrong answer)' })
  // Text options: the key must not stand out as the longest.
  if (!opts.some(o => NUMERIC(o)) && !item.options.every(isMathOnly)) {
    const lens = opts.map(o => o.length)
    const others = lens.filter((_, i) => i !== item.answer)
    const mean = others.reduce((a, b) => a + b, 0) / Math.max(1, others.length)
    if (lens[item.answer] > Math.max(...others) && lens[item.answer] >= mean * 1.5 && lens[item.answer] - mean >= 12) out.push({ code: 'longest-key', severity: 'block', detail: 'the correct option is clearly the longest (a length cue)' })
    // a/an at the end of the stem agrees only with the key.
    const art = /\b(a|an)\s*(?:_+|\.\.\.)?\s*[.:]?\s*$/i.exec(q)?.[1]?.toLowerCase()
    if (art) {
      const fits = (o: string) => (/^[aeiou]/i.test(o) ? art === 'an' : art === 'a')
      if (fits(opts[item.answer]) && opts.some((o, i) => i !== item.answer && !fits(o))) out.push({ code: 'grammar-cue', severity: 'block', detail: `"${art}" at the end of the stem only fits some options` })
    }
    // Clang: a distinctive stem word repeated only in the key.
    const stemWords = new Set(wordsOf(q).filter(w => w.length >= 6))
    const shared = (o: string) => wordsOf(o).filter(w => stemWords.has(w))
    if (shared(opts[item.answer]).length && opts.every((o, i) => i === item.answer || !shared(o).length)) out.push({ code: 'clang', severity: 'warn', detail: `only the key repeats a stem word (${shared(opts[item.answer])[0]})` })
    if (opts.some((o, i) => i !== item.answer && /\b(always|never|only|all|none)\b/i.test(o)) && !/\b(always|never|only|all|none)\b/i.test(opts[item.answer])) out.push({ code: 'absolutes', severity: 'warn', detail: 'absolute words appear only in wrong options' })
  }
  return out
}

function formFindings(item: AssessItem): Finding[] {
  const out: Finding[] = []
  const nums = item.options.map(o => singleNumber(o))
  const numeric = nums.filter(Boolean).length
  if (numeric && numeric < item.options.length && numeric >= item.options.length - 1) out.push({ code: 'not-parallel', severity: 'block', detail: 'options mix numbers and words' })
  if (numeric === item.options.length) {
    const units = new Set(nums.map(n => n!.unit.toLowerCase()))
    if (units.size > 1) out.push({ code: 'mixed-units', severity: 'block', detail: `options use different units (${[...units].map(u => u || 'none').join(', ')}); give every option in the unit the question asks for` })
    // Some written "x = 4", others "4".
    const labelled = item.options.map(o => /^\s*\$?\s*[a-zA-Z]\w{0,3}\s*(=|≈)/.test(o))
    if (labelled.some(Boolean) && !labelled.every(Boolean)) out.push({ code: 'not-parallel', severity: 'block', detail: 'some options are written "x = …" and others are bare numbers' })
    // Padded exact values in pure maths: "$y = 2.50$", "$x = 3.00$" for exact answers.
    const pure = !nums.some(n => n!.unit) && !/\d\.\d/.test(plain(item.q))
    if (pure && item.options.some(o => /\d\.\d*0(?!\d)/.test(plain(o)) && !/\de/.test(plain(o)))) out.push({ code: 'padded-exact', severity: 'block', detail: 'exact values are padded with trailing zeros (write 2.5, not 2.50; 60, not 60.0)' })
    const dec = new Set(nums.map(n => (n!.unit ? Math.min(n!.sig, 6) : -1)))
    if (!pure && dec.size > 1 && nums.every(n => n!.unit)) out.push({ code: 'precision', severity: 'warn', detail: 'options are given to different precision' })
  }
  // Very long options are read-heavy and hard to compare.
  if (item.options.some(o => plain(o).length > 140)) out.push({ code: 'long-option', severity: 'warn', detail: 'an option is over 140 characters' })
  if (item.options.length < 3 || item.options.length > 5) out.push({ code: 'option-count', severity: 'block', detail: 'use 3 to 5 options' })
  return out
}

/* ───────────── reading load and tone ───────────── */

const syllables = (w: string) => Math.max(1, (w.toLowerCase().replace(/e$/, '').match(/[aeiouy]+/g) ?? []).length)
/** Flesch-Kincaid grade of the prose (maths removed). */
export function readingGrade(text: string): number {
  const prose = text.replace(/\$[^$]*\$/g, ' X ')
  const sentences = Math.max(1, (prose.match(/[.?!](\s|$)/g) ?? []).length)
  const words = prose.match(/[A-Za-z][A-Za-z'-]*/g) ?? []
  if (words.length < 6) return 0
  const syl = words.reduce((a, w) => a + syllables(w), 0)
  return 0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59
}
/** Approximate school grade the learner reads at (from their level line). */
export function gradeTarget(level?: string | null): number {
  const l = (level ?? '').toLowerCase()
  let m: RegExpMatchArray | null
  if ((m = l.match(/primary\s*(\d)/))) return Number(m[1]) + 1
  if ((m = l.match(/\bj?ss\s?(\d)/))) return (/\bjs/.test(l) ? 6 : 9) + Number(m[1])
  if ((m = l.match(/\byear\s*(\d{1,2})/))) return Number(m[1]) - 1
  if ((m = l.match(/\b(?:grade|class|form)\s*(\d{1,2})/))) return Number(m[1]) + (/form/.test(l) ? 8 : 0)
  if (/\b\d00\s?l\b|universit|undergrad|degree|graduate|professional|work/.test(l)) return 13
  return 10
}

function readingFindings(item: AssessItem, ctx: ItemContext): Finding[] {
  const out: Finding[] = []
  const words = (plain(item.q).match(/[A-Za-z][A-Za-z'-]*/g) ?? []).length
  if (words > 60) out.push({ code: 'reading-load', severity: 'block', detail: `the question is ${words} words; keep it under 35` })
  else if (words > 35) out.push({ code: 'reading-load', severity: 'warn', detail: `the question is ${words} words` })
  const longest = Math.max(0, ...item.q.replace(/\$[^$]*\$/g, 'X').split(/[.?!](?:\s|$)/).map(s => (s.match(/[A-Za-z]+/g) ?? []).length))
  if (longest > 32) out.push({ code: 'long-sentence', severity: 'block', detail: `a sentence of ${longest} words; split it` })
  const g = readingGrade(item.q), target = gradeTarget(ctx.level)
  if (g > target + 4 && words > 18) out.push({ code: 'reading-grade', severity: 'warn', detail: `reads at grade ${g.toFixed(0)} for a grade-${target} learner` })
  return out
}

function toneFindings(item: AssessItem): Finding[] {
  const out: Finding[] = []
  const e = (item.explain ?? '').trim()
  if (!e) { out.push({ code: 'no-feedback', severity: 'block', detail: 'no explanation for the learner' }); return out }
  if (/^[A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){1,5}:\s/.test(plain(e)) && !/^(Note|Tip|Step \d)/.test(e)) out.push({ code: 'feedback-label', severity: 'block', detail: `the explanation starts with a title ("${plain(e).split(':')[0]}:"); write it as a sentence` })
  if (/\b(obviously|careless|silly|stupid|trivial(ly)?|just remember)\b/i.test(e)) out.push({ code: 'tone', severity: 'block', detail: 'the explanation uses a word that makes a learner feel bad (obviously / careless / trivial)' })
  else if (/\b(simply|easy|clearly)\b/i.test(e)) out.push({ code: 'tone', severity: 'warn', detail: 'avoid "simply / easy / clearly" in feedback' })
  return out
}

/* ───────────── fairness: curriculum and locale ───────────── */

const IMPERIAL = /\b\d[\d,.]*\s*(?:miles?|mi\b|feet|foot|ft\b|inch(?:es)?|yards?|yd\b|pounds? (?:of|weight)|lbs?\b|ounces?|oz\b|gallons?|°\s?F\b|fahrenheit|mph\b)/i
const CURRENCY_RE: [RegExp, string][] = [[/₦|\bnaira\b/i, 'naira'], [/£|\bpounds?\b(?! (?:of|weight|force))(?=.*\b(?:cost|pay|price|spend|buy|sell|earn|save))/i, 'pounds'], [/€|\beuros?\b/i, 'euros'], [/₹|\brupees?\b/i, 'rupees'], [/\bksh\b|\bshillings?\b/i, 'shillings'], [/₵|\bcedis?\b/i, 'cedis'], [/\brand\b/i, 'rand'], [/\bdollars?\b|US\$|\$\s?\d+(?:\.\d\d)?\b(?![^$]*\$)/, 'dollars']]
const EXAMS = /\b(WAEC|WASSCE|NECO|JAMB|UTME|GCSE|IGCSE|A-level|SAT|ACT|AP|IB|CBSE|ICSE|KCSE|CSEC|CAPE|matric)\b/
const PLACES = /\b(Lagos|Abuja|Kano|Ibadan|Enugu|Port Harcourt|Accra|Kumasi|Nairobi|Mombasa|Kampala|Johannesburg|Cape Town|London|Manchester|Birmingham|New York|Chicago|Texas|California|Mumbai|Delhi|Bangalore|Kolkata|Karachi|Lahore|Dhaka|Manila|Jakarta|Toronto|Sydney|Kingston)\b/

function fairnessFindings(item: AssessItem, ctx: ItemContext): Finding[] {
  const out: Finding[] = []
  const text = [item.q, ...item.options].map(plain).join(' \n ')
  const own = `${ctx.goal ?? ''} ${ctx.taught?.text ?? ''}`.toLowerCase()
  const c = ctx.curriculum
  const imp = IMPERIAL.exec(text)
  if (imp && !c?.usUnits && !own.includes(imp[0].replace(/^[\d,.\s]+/, '').toLowerCase().slice(0, 4))) out.push({ code: 'units-locale', severity: 'block', detail: `uses a non-SI unit (${imp[0].trim()}) the learner's course did not use; use SI units` })
  for (const [re, name] of CURRENCY_RE) {
    if (!re.test([item.q, ...item.options].join(' ').replace(/\$[^$]*\$/g, ' '))) continue
    if (own.includes(name.slice(0, 4)) || (c?.currency ?? '').toLowerCase().includes(name.slice(0, 4))) continue
    out.push({ code: 'currency-locale', severity: 'block', detail: `uses ${name}, which the learner's goal and lesson never used; avoid money or use the learner's own currency` })
  }
  const ex = EXAMS.exec([item.q, ...item.options].join(' '))
  if (ex && !(c?.label ?? '').toLowerCase().includes(ex[1].toLowerCase().slice(0, 3)) && !own.includes(ex[1].toLowerCase())) out.push({ code: 'exam-locale', severity: 'block', detail: `mentions ${ex[1]}, an exam the learner is not on` })
  const pl = PLACES.exec(text)
  if (pl && !own.includes(pl[1].toLowerCase())) out.push({ code: 'place-locale', severity: 'warn', detail: `relies on a place (${pl[1]}) from outside the learner's context; keep contexts familiar anywhere` })
  return out
}

/* ───────────── figures: only where needed ───────────── */

const REFERS = /\b(diagram|figure|graph|picture|image|illustration|sketch|chart|plot|drawing|grid|shown|labelled|labeled|marked)\b|\bthe (?:line|curve|triangle|circle|shape|circuit) (?:below|above|here)\b/i
const VISUAL_SKILL = /\b(geometr\w*|angles?|triangles?|circles?|polygons?|quadrilateral|parallel|perpendicular|bearings?|loci|locus|construct\w*|transformations?|reflection|rotation|enlargement|vectors?|graphs?|gradient|slope|intercept|parabola|curve|coordinate\w*|plot\w*|venn|sets?\b|charts?|histogram|bar chart|pie chart|scatter|data|circuit\w*|resistors? in|ray diagram|refraction|lens\w*|mirror|forces? on|free[- ]body|cells?\b|organs?\b|anatomy|heart|leaf|flower|skeleton|structure of|parts of|microscope|apparatus|maps?\b|tree diagram|network)\b/i

/** Whether an item may (or must) carry a figure. */
export function figureNeed(item: Pick<AssessItem, 'q' | 'figure' | 'objective'>, skill?: string): { refers: boolean; visual: boolean } {
  const q = plain(item.q)
  return { refers: REFERS.test(q.replace(/\b(all|none) of the above\b/gi, '')), visual: VISUAL_SKILL.test(`${skill ?? ''} ${item.objective ?? ''}`) }
}

/** Names the stem refers to: points (A, P), angles (ABC), triangles (PQR), sets (A), labelled parts. */
function namedInStem(q: string): string[] {
  const out = new Set<string>()
  const t = plain(q)
  for (const m of t.matchAll(/\b(?:point|vertex|corner|set|line|side|segment|angle|triangle|quadrilateral)\s+([A-Z]{1,4})\b/g)) for (const ch of m[1]) out.add(ch)
  for (const m of t.matchAll(/\b(?:labelled|labeled|marked|part)\s+([A-Z])\b/g)) out.add(m[1])
  for (const m of t.matchAll(/\b([A-Z])\s+is\s+(?:the\s+)?(?:midpoint|foot|centre|center|intersection|point)\b/g)) out.add(m[1])
  return [...out]
}

function figureFindings(item: AssessItem, ctx: ItemContext): Finding[] {
  const out: Finding[] = []
  const need = figureNeed(item, ctx.skill)
  const f = item.figure
  if (!f) {
    if (need.refers && /\b(diagram|figure|graph|picture|image|shown|labelled|labeled|chart)\b/i.test(plain(item.q))) out.push({ code: 'figure-missing', severity: 'block', detail: 'the question refers to a figure but none is attached; attach it or reword the question as text-only' })
    return out
  }
  if (!need.refers && !need.visual) out.push({ code: 'figure-unneeded', severity: 'block', detail: 'a figure is attached but the question does not use it and the skill is not visual; make the item text-only' })
  else if (!need.refers) out.push({ code: 'figure-unreferenced', severity: 'block', detail: 'the figure is attached but the question never refers to it ("In the diagram…", "The graph shows…")' })
  if (!f.alt || plain(f.alt).length < 15) out.push({ code: 'figure-alt', severity: 'block', detail: 'the figure needs alt text: one sentence naming what is drawn and every labelled value' })
  const names = namedInStem(item.q)
  if (f.kind === 'graph') {
    const v = validateInteractive({ ...f.spec, sliders: [{ name: 'zz', min: 0, max: 1, value: 0 }] })
    const errs = v.errors.filter(e => !/nothing to interact/.test(e))
    if (!v.spec || errs.length) out.push({ code: 'figure-invalid', severity: 'block', detail: `the graph spec is invalid: ${(errs[0] ?? 'unreadable').slice(0, 140)}` })
    else {
      const have = new Set([...v.spec.points.map(p => p.name), ...v.spec.points.map(p => p.label)])
      const missing = names.filter(n => !have.has(n))
      if (missing.length && v.spec.points.length) out.push({ code: 'figure-labels', severity: 'block', detail: `the question names ${missing.join(', ')} but the graph has no such point` })
      // Coordinates the stem states, e.g. "(2, 0)", must be drawn: a point there or a curve through it.
      for (const m of plain(item.q).matchAll(/\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/g)) {
        const x = Number(m[1]), y = Number(m[2])
        const onPoint = v.spec.points.some(p => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6)
        const onCurve = v.spec.functions.some(fn => { const c = compileExpr(fn.expr, [], true); return c.ok && Math.abs(c.fn(x) - y) < 1e-6 * Math.max(1, Math.abs(y)) })
        if (!onPoint && !onCurve) out.push({ code: 'figure-values', severity: 'block', detail: `the question gives (${x}, ${y}) but the graph shows no point or curve there` })
      }
      if (x0OutOfRange(v.spec)) out.push({ code: 'figure-range', severity: 'block', detail: 'a labelled point lies outside the graph\'s axes' })
    }
  } else if (f.kind === 'diagram') {
    const errs = checkSubstance(f.library as DiagramLibrary, f.substance.replace(/\\n/g, '\n').replace(/;\s*/g, '\n'))
    if (errs.length) out.push({ code: 'figure-invalid', severity: 'block', detail: `the diagram program is invalid: ${errs[0].slice(0, 140)}` })
    const declared = new Set([...f.substance.matchAll(/^\s*\w+\s+([\w\s,]+)$/gm)].flatMap(m => m[1].split(',').map(s => s.trim())))
    const missing = names.filter(n => !declared.has(n))
    if (missing.length) out.push({ code: 'figure-labels', severity: 'block', detail: `the question names ${missing.join(', ')} but the diagram does not draw it` })
    // Penrose lays geometry out by constraints, not to scale: numbers in the stem need the flag.
    if (f.library === 'geometry' && /\d/.test(plain(item.q)) && !f.notToScale) f.notToScale = true
  } else if (f.kind === 'illustration') {
    if (!f.topic) out.push({ code: 'figure-invalid', severity: 'block', detail: 'an illustration needs a topic' })
  }
  return out
}
function x0OutOfRange(spec: { x: [number, number]; y: [number, number]; points: { x: number; y: number }[] }) {
  return spec.points.some(p => p.x < spec.x[0] || p.x > spec.x[1] || p.y < spec.y[0] || p.y > spec.y[1])
}

/* ───────────── the validator ───────────── */

const BLOOMS: Bloom[] = ['remember', 'understand', 'apply', 'analyse']

/** Parse optional spec fields from a model's item (beyond RawItem). */
export function rawSpec(o: Record<string, unknown>): Partial<AssessItem> {
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(x => (typeof x === 'string' ? x.slice(0, 300) : null)) : undefined)
  const fig = o.figure && typeof o.figure === 'object' ? o.figure as Record<string, unknown> : null
  let figure: ItemFigure | undefined
  if (fig && typeof fig.alt === 'string') {
    if (fig.kind === 'graph' && fig.spec && typeof fig.spec === 'object') figure = { kind: 'graph', spec: fig.spec as Record<string, unknown>, alt: fig.alt.slice(0, 400), notToScale: fig.notToScale === true }
    else if (fig.kind === 'diagram' && typeof fig.substance === 'string' && ['sets', 'geometry', 'graph', 'vectors'].includes(String(fig.library))) figure = { kind: 'diagram', library: fig.library as 'sets', substance: fig.substance.slice(0, 2000), alt: fig.alt.slice(0, 400), notToScale: fig.notToScale === true }
    else if (fig.kind === 'illustration' && typeof fig.topic === 'string') figure = { kind: 'illustration', topic: fig.topic.slice(0, 80), alt: fig.alt.slice(0, 400), labels: Array.isArray(fig.labels) ? fig.labels.filter((x): x is string => typeof x === 'string').slice(0, 8) : undefined }
  }
  const d = Number(o.difficulty)
  return {
    why: arr(o.why), calcs: arr(o.calcs),
    objective: typeof o.objective === 'string' ? o.objective.slice(0, 200) : undefined,
    bloom: BLOOMS.includes(o.bloom as Bloom) ? o.bloom as Bloom : undefined,
    difficulty: Number.isFinite(d) && d >= 1 && d <= 5 ? Math.round(d) : undefined,
    figure,
  }
}

/** Validate one item. `problems` (blocking findings, worded for the model) decide whether it may ship. */
export function validateItem(raw: RawItem & Partial<AssessItem>, ctx: ItemContext): ItemVerdict {
  // The base gate (question-quality.ts): maths normalised and KaTeX-valid, distinct options, numeric key from calc.
  const base = checkItem(raw, { requireCalc: ctx.requireCalc ?? true })
  const item: AssessItem = { ...raw, ...base.item, explain: base.item.explain }
  for (const k of ['objective', 'why'] as const) if (item[k] === undefined) delete item[k]
  if (item.figure && 'alt' in item.figure) item.figure = { ...item.figure, alt: normalizeMathText(item.figure.alt) }
  const findings: Finding[] = base.problems.map(p => ({ code: 'base', severity: 'block' as const, detail: p }))
  findings.push(...accuracyFindings(item), ...cueFindings(item), ...formFindings(item), ...readingFindings(item, ctx), ...toneFindings(item), ...fairnessFindings(item, ctx), ...figureFindings(item, ctx))
  if (ctx.taught) findings.push(...alignItem(item, ctx.taught))
  const problems = findings.filter(f => f.severity === 'block').map(f => f.detail)
  const ok = problems.length === 0
  if (ok) item.verified = true
  return { item, findings, problems, ok }
}

/* ───────────── a set of items ───────────── */

/**
 * Spread the keys over positions (Attali & Bar-Hillel 2003: writers hide keys in the middle; a balanced key removes
 * position cues). Options are rotated (with their why/calcs) so key positions cycle through 0..n-1 in a shuffled order.
 * Numeric options are kept in ascending order instead (a sorted list gives no position cue and reads naturally).
 */
export function balanceKeys<T extends AssessItem>(items: T[], seed = 7): T[] {
  const n = Math.max(3, Math.min(...items.map(i => i.options.length)))
  const order = Array.from({ length: n }, (_, i) => i)
  let s = seed
  for (let i = order.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = s % (i + 1); [order[i], order[j]] = [order[j], order[i]] }
  return items.map((it, k) => {
    const nums = it.options.map(o => parseOptionNumber(o))
    const perm = nums.every(Boolean) && new Set(nums.map(x => x!.unit)).size === 1
      ? it.options.map((_, i) => i).sort((a, b) => nums[a]!.value - nums[b]!.value)
      : rotateTo(it.options.length, it.answer, order[k % order.length] % it.options.length)
    const pick = <V,>(a: V[] | undefined) => (Array.isArray(a) && a.length === it.options.length ? perm.map(i => a[i]) : a)
    return { ...it, options: perm.map(i => it.options[i]), answer: perm.indexOf(it.answer), why: pick(it.why), calcs: pick(it.calcs) }
  })
}
function rotateTo(len: number, from: number, to: number): number[] {
  // perm[newIndex] = oldIndex, with the key moved from `from` to `to` by a rotation (relative order kept).
  const shift = (from - to + len) % len
  return Array.from({ length: len }, (_, i) => (i + shift) % len)
}

/** Set-level findings: duplicate stems, unbalanced keys. */
export function setFindings(items: AssessItem[]): Finding[] {
  const out: Finding[] = []
  const stems = items.map(i => plain(i.q).toLowerCase().replace(/\d+(\.\d+)?/g, '#'))
  if (new Set(stems).size < stems.length) out.push({ code: 'duplicate-stem', severity: 'block', detail: 'two questions are the same question with different numbers' })
  if (items.length >= 3) {
    const pos = items.map(i => i.answer)
    const most = Math.max(...[0, 1, 2, 3, 4].map(p => pos.filter(x => x === p).length))
    if (most > Math.ceil(items.length / 2)) out.push({ code: 'key-balance', severity: 'warn', detail: `${most} of ${items.length} keys share one position` })
  }
  return out
}

/* ───────────── lesson checks (CheckStep) ───────────── */

/** A lesson check as an item (choice only; short answers are checked for accepted-answer consistency). */
export function checkStepItem(s: CheckStep): AssessItem | null {
  if (s.kind !== 'choice' || !Array.isArray(s.options) || typeof s.answer !== 'number') return null
  return { q: s.prompt, options: s.options, answer: s.answer, explain: s.explanation }
}

/**
 * Issues in a lesson's checks, worded for the writer's repair pass (lesson-ai.ts). Each check is validated as an item
 * (accuracy, cues, form, tone, fairness, figure need) and aligned with what the steps before it taught.
 */
export function checkStepIssues(steps: Step[], opts: { played?: Step[]; curriculum?: Curriculum | null; goal?: string | null; level?: string | null } = {}): string[] {
  const out: string[] = []
  const all = [...(opts.played ?? []), ...steps]
  const off = opts.played?.length ?? 0
  steps.forEach((s, i) => {
    if (s.type !== 'check') return
    const taught = taughtFromSteps(all.slice(0, off + i))
    const at = `check at step ${i} ("${plain(s.prompt).slice(0, 60)}")`
    const it = checkStepItem(s)
    if (it) {
      const v = validateItem({ ...it, calc: null }, { surface: 'check', taught: taught.text.length > 80 ? taught : null, curriculum: opts.curriculum, goal: opts.goal, level: opts.level, requireCalc: false })
      // In a lesson, readouts on the board are the figure; "the graph" may refer to the stage, so figure-missing is not an issue here.
      for (const f of v.findings) if (f.severity === 'block' && f.code !== 'figure-missing' && f.code !== 'no-feedback' && f.code !== 'objective-not-taught' && f.code !== 'option-count') out.push(`${at}: ${f.detail}`)
      if (it.options.length < 2) out.push(`${at}: needs at least 2 options`)
    }
    if (s.kind === 'short' && Array.isArray(s.accept) && s.accept.length) {
      // Accepted answers must agree with each other (all the same value / expression).
      const first = s.accept[0]
      const nums = s.accept.map(a => parseOptionNumber(a))
      if (nums.every(Boolean) && nums.some(n => Math.abs(n!.value - nums[0]!.value) > 1e-9 * Math.max(1, Math.abs(nums[0]!.value)))) out.push(`${at}: the accepted answers are different numbers (${s.accept.slice(0, 3).join(', ')})`)
      for (const a of s.accept.slice(1)) if (equivalent(first, a) === false) out.push(`${at}: accepted answers "${first}" and "${a}" are not equal`)
      // Expand / factorise / simplify: the accepted answer equals the stem's expression.
      if (/\b(factori[sz]e|expand|simplify|multiply out)\b/i.test(plain(s.prompt))) {
        const target = mathSegments(s.prompt).find(x => !/=/.test(x) && algebra(x)) ?? plain(s.prompt).match(/\(([^?]*\))\s*\??$/)?.[0]
        if (target && equivalent(target.replace(/\?$/, ''), first) === false) out.push(`${at}: the accepted answer ${first} is not equal to ${plain(target)}`)
      }
    }
    if (s.kind === 'explore' && s.goal && !new RegExp(String(s.goal.equals).replace('.', '\\.')).test(plain(s.prompt))) out.push(`${at}: the prompt must state the goal value ${s.goal.equals}`)
  })
  return [...new Set(out)].slice(0, 8)
}

/**
 * Spread lesson choice-check keys over positions (the audit found 56 % of keys in position B). Options are rotated
 * in place (relative order kept). Skipped when anything in the lesson refers to an option by its letter.
 */
export function balanceCheckKeys(steps: Step[], seed = 0): Step[] {
  const text = JSON.stringify(steps)
  if (/\b(?:option|answer|choice)\s*\(?[A-F]\)?(?![a-z])|\([A-F]\)/.test(text)) return steps
  let k = seed
  return steps.map(s => {
    if (s.type !== 'check' || s.kind !== 'choice' || !Array.isArray(s.options) || typeof s.answer !== 'number' || s.options.length < 3) return s
    const n = s.options.length
    const to = (k++ * 3 + 1) % n
    const perm = rotateTo(n, s.answer, to)
    return { ...s, options: perm.map(i => s.options![i]), answer: perm.indexOf(s.answer) }
  })
}

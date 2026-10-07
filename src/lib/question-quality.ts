/**
 * Quality gate for AI-written multiple-choice questions (diagnostic, mastery checks).
 *
 *  - Maths: every snippet in the stem, options and explanation is delimited, repaired
 *    and KaTeX-validated (math-text.ts); unrepairable snippets are reported.
 *  - Options: no duplicates, and no two numeric options a learner could not tell apart
 *    after rounding (e.g. 1.257×10⁻² vs 1.258×10⁻²).
 *  - Numeric answers are verified: the model gives "calc", an arithmetic expression that
 *    computes the correct value; it must match the marked option (within its rounding),
 *    be closer to it than to any other option, and match no distractor.
 */
import type { DiagItem } from './diagnostic-core'
import { compileExpr } from './lesson-schema'
import { matchesShown, normalizeMathText, parseOptionNumber, toPlainText, tooClose, type ParsedNumber } from './math-text'

export interface RawItem { q: string; options: string[]; answer: number; explain?: string; calc?: string | null }
export interface CheckedItem { item: DiagItem; problems: string[] }

/** Prompt lines every question generator includes. */
export const QUESTION_RULES = `Maths formatting: put EVERY piece of maths, every number with a unit written in LaTeX, and every symbol inside $...$ (KaTeX), in the question, the options and the explanation, e.g. "$1.26 \\times 10^{-2}$ T", "$\\chi_m = 10^{-4}$", "$318$ A/m". Never write LaTeX commands outside $...$. In JSON strings escape each backslash ("\\\\times").
Options: 4 options that differ meaningfully. Each wrong option is a specific common mistake (wrong formula, forgot a factor, unit slip, sign error, inverted ratio) - never the right answer with different rounding. Numeric options must differ by at least 10% from each other and use the same number of significant figures (3 is ideal).
Verification: for every question whose correct answer is a number, give "calc": a plain arithmetic expression that computes the correct option's value in the option's unit (numbers, + - * / ^, parentheses, pi, sqrt(), sin() and cos() in radians, ln(), log() base 10, exp(); write 4*pi*10^(-7), not 4πe-7). Use "calc": null when the answer is not a number.`

/** Evaluate a "calc" expression; NaN when it is not a valid constant expression. */
export function evalCalc(src: string): number {
  if (typeof src !== 'string' || !src.trim() || src.length > 300) return NaN
  const s = src
    .replace(/×|·/g, '*').replace(/−/g, '-').replace(/\*\*/g, '^').replace(/π/g, 'pi')
    .replace(/(\d)\s*[eE]\s*([-+]?\d+)/g, '$1*10^($2)')
  const c = compileExpr(s, [], false)
  if (!c.ok) return NaN
  try { return c.fn(0) } catch { return NaN }
}

const plainKey = (s: string) => toPlainText(s).toLowerCase().replace(/\s+/g, '').replace(/[.,;:]$/, '')

/** Normalise maths and check one item. Problems are worded for the model (used in the re-ask). */
export function checkItem(raw: RawItem, opts: { requireCalc?: boolean } = {}): CheckedItem {
  const problems: string[] = []
  const bad: string[] = []
  const q = normalizeMathText(raw.q, bad)
  const options = raw.options.map(o => normalizeMathText(o, bad))
  const explain = raw.explain ? normalizeMathText(raw.explain, bad) : undefined
  if (bad.length) problems.push(`invalid LaTeX that KaTeX cannot parse: ${bad.slice(0, 3).map(b => JSON.stringify(b)).join(', ')}`)
  const item: DiagItem = { q, options, answer: raw.answer, explain }

  const keys = options.map(plainKey)
  if (new Set(keys).size !== keys.length) problems.push('two options are the same')

  const nums = options.map(parseOptionNumber)
  for (let i = 0; i < nums.length; i++) for (let j = i + 1; j < nums.length; j++) {
    const a = nums[i], b = nums[j]
    if (a && b && tooClose(a, b)) problems.push(`options ${String.fromCharCode(65 + i)} and ${String.fromCharCode(65 + j)} (${toPlainText(options[i])} vs ${toPlainText(options[j])}) are too close to tell apart after rounding`)
  }

  const correct = nums[raw.answer]
  if (correct) {
    const calc = typeof raw.calc === 'string' ? raw.calc : ''
    const v = calc ? evalCalc(calc) : NaN
    if (!calc) {
      if (opts.requireCalc) problems.push('the answer is a number but "calc" is missing')
    } else if (!Number.isFinite(v)) {
      problems.push(`"calc" (${calc}) is not a valid arithmetic expression`)
    } else {
      const sameUnit = (n: ParsedNumber | null) => !!n && n.unit === correct.unit
      const dist = (n: ParsedNumber) => Math.abs(n.value - v)
      if (!matchesShown(v, correct)) {
        const hit = nums.findIndex(n => n && matchesShown(v, n))
        problems.push(hit >= 0 && hit !== raw.answer
          ? `the computed answer ${fmt(v)} matches option ${String.fromCharCode(65 + hit)}, not the marked answer ${String.fromCharCode(65 + raw.answer)}`
          : `the marked answer ${toPlainText(options[raw.answer])} does not match the computed value ${fmt(v)} from "calc"`)
      } else if (nums.some((n, i) => i !== raw.answer && sameUnit(n) && (matchesShown(v, n!) || dist(n!) <= dist(correct)))) {
        problems.push(`a wrong option is as close to the computed value ${fmt(v)} as the correct one`)
      }
    }
  }
  return { item, problems }
}

function fmt(v: number) { return Math.abs(v) >= 1e-3 && Math.abs(v) < 1e6 ? String(Number(v.toPrecision(5))) : v.toExponential(4) }

/** Parse raw AI items (shape only); quality is checked separately. */
export function rawItems(raw: unknown): RawItem[] {
  const out: RawItem[] = []
  for (const it of Array.isArray(raw) ? raw : []) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    if (typeof o.q !== 'string' || !Array.isArray(o.options) || typeof o.answer !== 'number') continue
    const opts = o.options.filter((s): s is string => typeof s === 'string' && !!s.trim()).map(s => s.trim().slice(0, 200)).slice(0, 5)
    if (opts.length < 3 || o.answer < 0 || o.answer >= opts.length) continue
    out.push({ q: o.q.trim().slice(0, 500), options: opts, answer: Math.floor(o.answer), explain: typeof o.explain === 'string' ? o.explain.slice(0, 400) : undefined, calc: typeof o.calc === 'string' ? o.calc.slice(0, 300) : null })
  }
  return out
}

/** Stored item, made safe to show: maths normalised (never raw LaTeX in text). */
export function displayItem<T extends { q: string; options: string[]; explain?: string }>(it: T): T {
  return { ...it, q: normalizeMathText(it.q), options: it.options.map(o => normalizeMathText(o)), explain: it.explain ? normalizeMathText(it.explain) : it.explain }
}

/** Problems a stored item can be judged on without its calc (legacy items): duplicates and too-close options. */
export function storedItemProblems(it: { options: string[] }): string[] {
  return checkItem({ q: '', options: it.options, answer: 0 }).problems.filter(p => !/calc|computed|marked/.test(p))
}

/** A short re-ask block listing what was wrong with each rejected item. */
export function feedbackFor(rejected: { raw: RawItem; problems: string[] }[]): string {
  return rejected.map((r, i) => `${i + 1}. "${toPlainText(r.raw.q).slice(0, 160)}" - ${r.problems.join('; ')}`).join('\n')
}

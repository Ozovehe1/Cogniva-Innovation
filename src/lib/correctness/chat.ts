/**
 * The correctness guard on the Ask chat (before the learner sees anything):
 *   textGate   streamed answer text is held to the end of each sentence, its numeric claims checked against the whole
 *              answer so far, wrong results corrected in place, then released (adds ~one sentence of latency)
 *   guardBlock visual blocks are checked as they are emitted: fixable faults are fixed; a board with a wrong fact is not
 *              shown and the issues go back to the model in the tool result so it redraws
 * Server only.
 */
import type { Block } from '../agent/types'
import { correctText, formatNumber, type Claim } from './claims'
import { guardSteps, issueLines, type GuardIssue } from './steps'

const dollars = (s: string) => (s.replace(/\\\$/g, '').match(/\$/g) ?? []).length

export function textGate(out: (d: string) => void, onFix?: (c: Claim) => void) {
  let released = ''
  let buf = ''
  const release = (chunk: string) => {
    if (!chunk) return
    let text = chunk
    if (/\d/.test(chunk) && /[=≈]|\\approx|% ?of/.test(chunk)) {
      // Judge the chunk with what came before it (an equation two sentences back decides "so x = 6"); only fixes
      // that land in the new chunk can be applied.
      const whole = correctText(released + chunk)
      if (whole.text.startsWith(released)) { text = whole.text.slice(released.length); whole.fixed.forEach(f => onFix?.(f)) }
      else { const own = correctText(chunk); text = own.text; own.fixed.forEach(f => onFix?.(f)) }
    }
    released += text
    out(text)
  }
  return {
    push(d: string) {
      buf += d
      let cut = -1
      for (const m of buf.matchAll(/[.!?:](?=\s)|\n/g)) {
        const k = (m.index ?? 0) + m[0].length
        if (dollars(buf.slice(0, k)) % 2 === 0) cut = k
      }
      if (cut > 0) { const c = buf.slice(0, cut); buf = buf.slice(cut); release(c) }
      else if (buf.length > 900 && dollars(buf) % 2 === 0) { const c = buf; buf = ''; release(c) }
    },
    end() { const c = buf; buf = ''; release(c) },
    text: () => released + buf,
  }
}

export interface BlockVerdict { block: Block | null; issues: GuardIssue[]; hold: string[] }

/** Check a visual block before it reaches the learner. `problem`: the learner's message (values must match it). */
export function guardBlock(block: Block, problem: string): BlockVerdict {
  if (block.kind === 'board') {
    const from = block.start ?? 0
    const g = guardSteps(block.steps, { problem })
    const mine = g.issues.filter(i => i.step < 0 || i.step >= from)
    const hold = issueLines(mine)
    return { block: hold.length ? null : { ...block, steps: g.steps }, issues: mine, hold }
  }
  if (block.kind === 'interactive' || block.kind === 'sim') {
    const spec = block.spec as { title: string; explain?: string }
    const fix = (s?: string) => (s ? correctText(s).text : s)
    return { block: { ...block, spec: { ...block.spec, title: fix(spec.title) ?? spec.title, ...(spec.explain ? { explain: fix(spec.explain) } : {}) } } as Block, issues: [], hold: [] }
  }
  return { block, issues: [], hold: [] }
}

/** The "checked with exact maths" chip for corrections made while streaming. */
export function fixesBlock(fixes: Claim[]): Block | null {
  if (!fixes.length) return null
  return { kind: 'checked', id: 'guard', items: fixes.slice(0, 4).map(f => ({ expression: f.kind === 'solution' ? `${f.lhs} (from the equation)` : f.lhs.replace(/\s+/g, ' ').slice(0, 40), result: formatNumber(f.computed) })) }
}

/**
 * When every free model is busy, the tutor still answers WHAT THE LEARNER SAID, deterministically:
 *   1. a numeric claim in the message ("the derivative of x² at 3 is 9, right?", "4 + 5 × 2 = 18?") is checked
 *      with mathjs and corrected or confirmed with the working;
 *   2. a follow-up about a visual already shown ("why does the coil keep spinning?" after a motor scene) is answered
 *      from that visual's own beats (the lines whose words overlap the question), pointing back at it instead of
 *      showing an unrelated picture;
 *   3. only then the caller's old fallback (a picture / live figure for the topic).
 * For live signals (no message) the answer is about the signal (busySignalLine). Server only.
 */
import { create, all } from 'mathjs'
import type { Block } from '@/lib/agent/types'
import type { LearnerSignal } from './signals'

const math = create(all, { number: 'number' })
math.import({ import: () => { throw new Error('off') }, createUnit: () => { throw new Error('off') } }, { override: true })

const norm = (s: string) => s.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/²/g, '^2').replace(/³/g, '^3').replace(/\*\*/g, '^').replace(/\bsquared\b/gi, '^2').replace(/\bcubed\b/gi, '^3')
const fmt = (v: number) => String(Number(v.toPrecision(10)))
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 + 1e-6 * Math.max(Math.abs(a), Math.abs(b))
const EXPR = String.raw`([0-9a-z+\-*/^().\s]{1,40}?)`

export interface ClaimVerdict { claim: string; correct: boolean; value: string; working: string }

/** Find and check one numeric claim in the learner's words. */
export function checkLearnerClaim(message: string): ClaimVerdict | null {
  const t = norm(message.toLowerCase())
  // derivative / gradient / slope of f at x = a is v
  let m = new RegExp(String.raw`(?:derivative|gradient|slope)\s+of\s+(?:y\s*=\s*|f\(x\)\s*=\s*)?${EXPR}\s+at\s+(?:x\s*=\s*)?(-?[\d.]+)\s+(?:is|=|equals|will be)\s+(-?[\d.]+)`).exec(t)
  if (m) {
    try {
      const expr = m[1].trim(), a = Number(m[2]), claimed = Number(m[3])
      const d = math.derivative(expr, 'x')
      const v = d.evaluate({ x: a }) as number
      return { claim: `the derivative of ${expr} at x = ${a} is ${claimed}`, correct: close(v, claimed), value: fmt(v), working: `d/dx (${expr}) = ${d.toString()}, and at x = ${a} that is ${fmt(v)}` }
    } catch { /* not maths */ }
  }
  // f(x) at x = a is v  /  value of f when x = a is v
  m = new RegExp(String.raw`(?:value of\s+)?(?:y\s*=\s*|f\(x\)\s*=\s*)?${EXPR}\s+(?:at|when)\s+x\s*=\s*(-?[\d.]+)\s+(?:is|=|equals)\s+(-?[\d.]+)`).exec(t)
  if (m && /x/.test(m[1])) {
    try {
      const v = math.evaluate(m[1], { x: Number(m[2]) }) as number
      if (typeof v === 'number') return { claim: `${m[1].trim()} at x = ${m[2]} is ${m[3]}`, correct: close(v, Number(m[3])), value: fmt(v), working: `${m[1].trim()} with x = ${m[2]} gives ${fmt(v)}` }
    } catch { /* not maths */ }
  }
  // plain arithmetic: "4 + 5 * 2 = 18" / "is 7 * 8 56?"
  m = /(-?[\d.]+(?:\s*[-+*/^]\s*\(?-?[\d.]+\)?)+)\s*(?:=|is|equals|makes)\s*(-?[\d.]+)/.exec(t)
  if (m) {
    try {
      const v = math.evaluate(m[1]) as number
      if (typeof v === 'number' && Number.isFinite(v)) return { claim: `${m[1].trim()} = ${m[2]}`, correct: close(v, Number(m[2])), value: fmt(v), working: `${m[1].trim()} = ${fmt(v)}` }
    } catch { /* not maths */ }
  }
  return null
}

export function claimReply(v: ClaimVerdict): string {
  return v.correct
    ? `Yes, that's right: ${v.working}. Nicely done. Can you say why it works?`
    : `Not quite. ${v.working[0].toUpperCase()}${v.working.slice(1)}, so the answer is ${v.value}, not what you said. Where do you think the difference came from?`
}

const STOP = new Set('the a an and or of to in on at is are why how what does do did it its this that keep keeps going there here with for from by be as'.split(' '))
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)).map(w => w.replace(/(ing|ed|s)$/, '')))

/** Lines a shown visual already says (scene beats, worked-example steps, alt text). */
function linesOf(b: Block): { title: string; lines: string[] } | null {
  const x = b as unknown as { kind: string; alt?: string; title?: string; spec?: Record<string, unknown> }
  if (b.kind === 'scene') {
    const sp = b.spec as unknown as { title?: string; beats?: { caption?: string; say?: string }[] }
    return { title: sp.title ?? b.alt, lines: (sp.beats ?? []).map(z => z.say || z.caption || '').filter(Boolean) }
  }
  if (b.kind === 'worked_example') {
    const sp = b.spec as unknown as { title?: string; steps?: { claim?: string; text?: string }[] }
    return { title: sp.title ?? 'the worked example', lines: (sp.steps ?? []).map(z => z.claim || z.text || '').filter(Boolean) }
  }
  if (b.kind === 'embed' || b.kind === 'interactive' || b.kind === 'svg') return { title: x.title ?? x.alt ?? 'the picture', lines: [x.alt ?? ''].filter(Boolean) }
  return null
}

/** Answer a follow-up from a visual already on screen, or null when nothing shown overlaps the question. */
export function answerFromShown(message: string, shown: Block[]): string | null {
  const q = words(message)
  if (!q.size) return null
  let best: { title: string; line: string; score: number } | null = null
  for (const b of [...shown].reverse()) {
    const l = linesOf(b)
    if (!l) continue
    for (const line of l.lines) {
      const w = words(line)
      let score = 0
      for (const x of q) if (w.has(x)) score++
      if (score > (best?.score ?? 0)) best = { title: l.title, line, score }
    }
  }
  if (!best) return null
  return `Look back at ${best.title.replace(/^./, c => c.toLowerCase())} above: ${best.line.replace(/\.?$/, '.')} Watch that part again and tell me what you notice.`
}

/** The busy answer for a typed message (Ask / sheet / live 'message' signal). */
export function busyAnswer(message: string, shown: Block[]): { text: string; via: 'claim' | 'shown' } | null {
  const c = checkLearnerClaim(message)
  if (c) return { text: claimReply(c), via: 'claim' }
  const s = answerFromShown(message, shown)
  if (s) return { text: s, via: 'shown' }
  return null
}

/** The busy line for a live signal (no model): about that signal, never a generic picture. */
export function busySignalLine(s: LearnerSignal, check?: { explanation?: string; hint?: string } | null): string | null {
  switch (s.kind) {
    case 'answer': return s.correct === false ? `Not quite${s.answer ? ` — "${s.answer.slice(0, 40)}"` : ''}. ${check?.hint ?? check?.explanation ?? 'Look at the last thing drawn on the board and try once more.'}` : null
    case 'hesitation': return check?.hint ? `A hint: ${check.hint}` : 'Take it one piece at a time: what does the question give you, and what does it ask for?'
    case 'lost': return 'Let’s slow down. Tell me the last part that made sense, and we’ll go from there.'
    case 'message': { const r = busyAnswer(s.detail ?? '', []); return r?.text ?? null }
    default: return null
  }
}

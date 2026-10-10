/**
 * Learner signals: what the learner does on any surface (lesson stage, check card, live figures, embeds), sent to
 * the Live Tutor agent as SIGNALS. A signal never decides what the tutor does: the wake policy (policy.ts) only
 * decides whether to wake the agent now (debounce + rate limits); the agent reads the signal with the rest of its
 * state and decides whether to act at all, and how. Shared by browser and server (no DOM at import time).
 */

export type SignalKind =
  | 'answer'        // a check answered (correct true/false, what they wrote/picked)
  | 'tap'           // a tap on something the tutor showed (element id / embed control)
  | 'slider'        // a slider / parameter / drag changed on a live figure, scene or embed
  | 'idle'          // nothing happened for a while (lesson paused or waiting)
  | 'hesitation'    // a check is open and nothing has been entered for a while
  | 'pause'         // lesson paused by the learner
  | 'replay'        // replayed / scrolled back to a beat
  | 'lost'          // "I'm lost"
  | 'message'       // typed a question to the live tutor
  | 'stage'         // a visual on the stage reported its own check (correct=false: it failed; detail says why)

export interface LearnerSignal {
  kind: SignalKind
  /** ms since epoch (client clock). */
  at: number
  /** Where it happened: 'check', 'stage', a block id, an embed tool name. */
  where?: string
  /** Free details (short). */
  detail?: string
  correct?: boolean
  answer?: string
  expected?: string
  /** Slider / parameter changes. */
  param?: string
  value?: number
  from?: number
  min?: number
  max?: number
  /** Seconds idle / hesitating. */
  seconds?: number
  /** Lesson step (original script index) it happened at. */
  step?: number
}

export const SIGNAL_EVENT = 'ideanimo:learner'

/** Fire a learner signal from any component (figures, scenes, embeds, check cards). No-op on the server. */
export function emitSignal(s: Omit<LearnerSignal, 'at'> & { at?: number }) {
  if (typeof window === 'undefined') return
  try { window.dispatchEvent(new CustomEvent(SIGNAL_EVENT, { detail: { ...s, at: s.at ?? Date.now() } })) } catch { /* old browser */ }
}

/** One plain line per signal for the agent's context (newest last). */
export function signalLine(s: LearnerSignal, now = Date.now()): string {
  const ago = Math.max(0, Math.round((now - s.at) / 1000))
  const t = ago < 2 ? 'just now' : `${ago}s ago`
  switch (s.kind) {
    case 'answer': return `${t}: answered a check ${s.correct === true ? 'RIGHT' : s.correct === false ? 'WRONG' : ''}${s.answer ? ` with "${clip(s.answer, 60)}"` : ''}${s.correct === false && s.expected ? ` (expected "${clip(s.expected, 50)}")` : ''}${s.detail ? ` — check: ${clip(s.detail, 110)}` : ''}`
    case 'slider': return `${t}: moved ${s.param ?? 'a slider'}${s.from !== undefined ? ` from ${fmt(s.from)}` : ''} to ${fmt(s.value)}${s.min !== undefined && s.max !== undefined ? ` (range ${fmt(s.min)}..${fmt(s.max)})` : ''} on ${s.where ?? 'a live figure'}`
    case 'idle': return `${t}: idle for ${s.seconds ?? '?'} s${s.detail ? ` (${clip(s.detail, 60)})` : ''}`
    case 'hesitation': return `${t}: a check has been open ${s.seconds ?? '?'} s with no answer${s.detail ? ` — check: ${clip(s.detail, 110)}` : ''}`
    case 'pause': return `${t}: paused the lesson`
    case 'replay': return `${t}: replayed / went back${s.detail ? ` (${clip(s.detail, 60)})` : ''}`
    case 'lost': return `${t}: pressed "I'm lost"${s.detail ? ` — "${clip(s.detail, 100)}"` : ''}`
    case 'tap': return `${t}: tapped ${s.where ?? 'something'}${s.detail ? ` (${clip(s.detail, 60)})` : ''}`
    case 'message': return `${t}: typed "${clip(s.detail ?? '', 300)}"`
    case 'stage': return `${t}: YOUR visual ${s.where ?? ''} reported its check ${s.correct === false ? 'FAILED' : 'passed'}${s.detail ? `: ${clip(s.detail, 200)}` : ''}`
  }
}

const clip = (s: string, n: number) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }
const fmt = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '?' : String(Number(v.toFixed(3))))

/** Validate a signal from the client (server side). */
export function parseSignal(v: unknown): LearnerSignal | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const kinds: SignalKind[] = ['answer', 'tap', 'slider', 'idle', 'hesitation', 'pause', 'replay', 'lost', 'message', 'stage']
  if (!kinds.includes(o.kind as SignalKind)) return null
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)
  const str = (x: unknown, n: number) => (typeof x === 'string' ? x.slice(0, n) : undefined)
  return {
    kind: o.kind as SignalKind,
    at: Math.min(num(o.at) ?? Date.now(), Date.now() + 5000),
    where: str(o.where, 60), detail: str(o.detail, 400), answer: str(o.answer, 200), expected: str(o.expected, 120),
    correct: typeof o.correct === 'boolean' ? o.correct : undefined,
    param: str(o.param, 40), value: num(o.value), from: num(o.from), min: num(o.min), max: num(o.max), seconds: num(o.seconds),
    step: Number.isInteger(o.step) ? (o.step as number) : undefined,
  }
}

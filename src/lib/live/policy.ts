/**
 * Wake policy for the Live Tutor agent. It answers ONE question: should the agent be woken now with this signal?
 * It never says what to do: the agent reads the signal (and everything else it can see) and decides whether to act,
 * which tool or representation to use, or to deliberately do nothing. Timers and thresholds only wake the agent and
 * keep it from being spammy:
 *   - every signal kind has its own threshold (what counts as meaningful) and cooldown;
 *   - a global gap between proactive wakes, and a cap per 10 minutes;
 *   - a wrong answer and "I'm lost" are urgent (no global gap, but still debounced and counted).
 * Pure and deterministic (clock passed in), used in the browser (to avoid needless calls) and again on the server
 * (the server's copy is the one that counts). Evals: lib/live/evals.ts.
 */
import type { LearnerSignal, SignalKind } from './signals'

export const WAKE = {
  /** A check open this long without an answer is a hesitation signal (seconds). */
  hesitationS: 25,
  /** Nothing at all for this long is an idle signal (seconds). */
  idleS: 45,
  /** Slider play: at least this many meaningful moves (≥ minSliderFrac of the range) within sliderWindowS… */
  sliderMoves: 2,
  minSliderFrac: 0.1,
  sliderWindowS: 20,
  /** …and the learner has let go for this long (debounce, ms). */
  sliderSettleMs: 2500,
  /** Global gap between non-urgent wakes (ms). */
  gapMs: 20_000,
  /** Per-kind cooldowns (ms). */
  cooldownMs: { answer: 8_000, lost: 10_000, hesitation: 60_000, idle: 90_000, slider: 45_000, replay: 60_000, message: 0, tap: 30_000, pause: 120_000, stage: 5_000 } as Record<SignalKind, number>,
  /** Max wakes per rolling 10 minutes (urgent included). */
  maxPer10Min: 10,
  /** Max non-urgent wakes per rolling 10 minutes. */
  maxProactivePer10Min: 6,
}

const URGENT: SignalKind[] = ['answer', 'lost', 'message', 'stage']

export interface WakeState {
  wakes: { at: number; kind: SignalKind; urgent: boolean }[]
  lastByKind: Partial<Record<SignalKind, number>>
  /** Recent slider moves (for the meaningful-play threshold). */
  sliderMoves: { at: number; param: string; frac: number }[]
  /** Last wake per check (hesitation is once per check). */
  hesitatedAt: Record<string, number>
}

export const newWakeState = (): WakeState => ({ wakes: [], lastByKind: {}, sliderMoves: [], hesitatedAt: {} })

export interface WakeDecision { wake: boolean; why: string; urgent: boolean }

/** Record a slider move (call for every change; cheap). Returns its fraction of the range. */
export function noteSlider(st: WakeState, s: LearnerSignal): number {
  const span = s.max !== undefined && s.min !== undefined && s.max > s.min ? s.max - s.min : null
  const frac = span && s.from !== undefined && s.value !== undefined ? Math.abs(s.value - s.from) / span : s.value !== undefined && s.from !== undefined ? 0.2 : 0.15
  st.sliderMoves.push({ at: s.at, param: s.param ?? '?', frac })
  st.sliderMoves = st.sliderMoves.filter(m => s.at - m.at < WAKE.sliderWindowS * 1000).slice(-20)
  return frac
}

/**
 * Should this signal wake the agent now? `now` is the clock; `st` is updated when the answer is yes.
 * For sliders call it after the settle debounce (the caller waits sliderSettleMs after the last move).
 */
export function shouldWake(st: WakeState, s: LearnerSignal, now: number): WakeDecision {
  const urgent = URGENT.includes(s.kind) && !((s.kind === 'answer' || s.kind === 'stage') && s.correct !== false)
  const no = (why: string): WakeDecision => ({ wake: false, why, urgent })
  st.wakes = st.wakes.filter(w => now - w.at < 10 * 60_000)
  // What counts as meaningful, per kind.
  if (s.kind === 'answer' && s.correct !== false) {
    // A right answer is context for the next wake, not a reason to interrupt (the agent sees it in its signal list).
    return no('right answer: context only')
  }
  if (s.kind === 'stage' && s.correct !== false) return no('visual check passed: context only')
  if (s.kind === 'hesitation' && (s.seconds ?? 0) < WAKE.hesitationS) return no('hesitation below threshold')
  if (s.kind === 'idle' && (s.seconds ?? 0) < WAKE.idleS) return no('idle below threshold')
  if (s.kind === 'pause') return no('pause: context only')
  if (s.kind === 'slider') {
    const meaningful = st.sliderMoves.filter(m => now - m.at < WAKE.sliderWindowS * 1000 && m.frac >= WAKE.minSliderFrac)
    if (meaningful.length < WAKE.sliderMoves) return no(`slider play below threshold (${meaningful.length}/${WAKE.sliderMoves} meaningful moves)`)
    const last = st.sliderMoves[st.sliderMoves.length - 1]
    if (last && now - last.at < WAKE.sliderSettleMs) return no('slider still moving (debounce)')
  }
  if (s.kind === 'hesitation' && s.where && st.hesitatedAt[s.where]) return no('already woke for this check')
  // Cooldowns and rate limits.
  const lastK = st.lastByKind[s.kind]
  if (lastK !== undefined && now - lastK < WAKE.cooldownMs[s.kind]) return no(`${s.kind} cooldown`)
  if (st.wakes.length >= WAKE.maxPer10Min) return no('10-minute cap')
  if (!urgent) {
    const lastAny = st.wakes.length ? st.wakes[st.wakes.length - 1].at : -Infinity
    if (now - lastAny < WAKE.gapMs) return no('global gap')
    if (st.wakes.filter(w => !w.urgent).length >= WAKE.maxProactivePer10Min) return no('proactive cap')
  }
  st.wakes.push({ at: now, kind: s.kind, urgent })
  st.lastByKind[s.kind] = now
  if (s.kind === 'hesitation' && s.where) st.hesitatedAt[s.where] = now
  if (s.kind === 'slider') st.sliderMoves = []
  return { wake: true, why: urgent ? `${s.kind} (urgent)` : s.kind, urgent }
}

/**
 * Stealth assessment for onboarding v2 (docs/design/onboarding.md): instead of asking a self-efficacy item and
 * three anxiety items up front, read them from how the learner answered the adaptive check — their confidence
 * taps, "I don't know"s and the gap between confidence and accuracy (calibration). These are provisional and
 * tone-only (they never raise scaffolding on their own); a stated answer always wins. Pure, no I/O.
 */
import type { DiagState } from './diagnostic-core'

export interface DiagSignals {
  /** Answers the signals were read from. */
  n: number
  /** Share answered correctly. */
  accuracy: number
  /** Mean stated confidence, 0-1 (sure 1, fairly 0.6, guessing 0.2, "I don't know"/skip 0). */
  confidence: number
  /** Share of answers that were guesses or "I don't know". */
  unsure: number
  /** accuracy - confidence: positive means they know more than they think. */
  calibrationGap: number
  /** 1-5, from confidence (and under-confidence pulls it down). */
  efficacy: number
  /** Many guesses / "I don't know"s on a maths/science check (tone only). */
  anxious: boolean
  /** Median seconds per question (hesitation; descriptive only). */
  medianSeconds: number | null
}

const CONF: Record<string, number> = { sure: 1, fairly: 0.6, guess: 0.2 }

export function inferSignals(st: Pick<DiagState, 'asked'> | null | undefined, opts: { stem?: boolean } = {}): DiagSignals | null {
  const asked = st?.asked ?? []
  if (asked.length < 4) return null
  const n = asked.length
  const accuracy = asked.filter(a => a.correct).length / n
  const confidence = asked.reduce((s, a) => s + (a.choice === null ? 0 : CONF[a.confidence ?? ''] ?? 0), 0) / n
  const unsure = asked.filter(a => a.choice === null || a.confidence === 'guess').length / n
  const calibrationGap = accuracy - confidence
  // Confidence on a 1-5 scale; knowing clearly more than they believe is itself a low-efficacy sign.
  let efficacy = 1 + 4 * confidence
  if (calibrationGap >= 0.25) efficacy -= 0.5
  efficacy = Math.max(1, Math.min(5, Math.round(efficacy)))
  const anxious = !!opts.stem && (unsure >= 0.5 || (calibrationGap >= 0.3 && unsure >= 0.35))
  const times: number[] = []
  for (let i = 0; i < asked.length; i++) {
    const ms = asked[i].ms ?? (i > 0 ? Date.parse(asked[i].at) - Date.parse(asked[i - 1].at) : NaN)
    if (Number.isFinite(ms) && ms > 0 && ms < 15 * 60_000) times.push(ms / 1000)
  }
  times.sort((a, b) => a - b)
  const medianSeconds = times.length ? Math.round(times[Math.floor(times.length / 2)]) : null
  const r = (x: number) => Math.round(x * 100) / 100
  return { n, accuracy: r(accuracy), confidence: r(confidence), unsure: r(unsure), calibrationGap: r(calibrationGap), efficacy, anxious, medianSeconds }
}

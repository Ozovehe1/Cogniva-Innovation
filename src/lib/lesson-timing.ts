/**
 * How long a lesson really plays.
 *
 * The player advances a step when its narration has finished and every action on
 * the step's timeline is done (see buildTimeline), then waits a short gap and
 * fetches the next line. So a step's play time is its timeline total (built from
 * the real Kokoro word timings when we have them) plus that gap, and a check also
 * waits for the learner to answer.
 *
 * Without real timings the narration length comes from estimateTimings scaled to
 * the measured pace of the Kokoro voice (af_heart): over 325 cached lines the real
 * clips ran 0.87x the raw estimate (median 0.86, p10 0.77, p90 1.01).
 *
 * Pure: safe on the server and in the browser.
 */
import type { CheckStep, Step } from './lesson-schema'
import { estimateTimings, stretchTimings, type NarrationTiming } from './narration'
import { buildTimeline } from '@/components/whiteboard/timeline'
import { stepSpeech } from '@/components/whiteboard/speech'

/** Real Kokoro clip length / estimateTimings length (measured on production audio). */
export const VOICE_PACE = 0.87
/** Gap between steps: the player's 40 ms advance plus fetching and starting the next cached clip. */
export const STEP_GAP_MS = 350
/** Time a learner spends on a check after its question is read (tap, choose, or type). */
export const CHECK_ANSWER_MS: Record<CheckStep['kind'], number> = { understand: 5_000, choice: 14_000, short: 30_000 }
/** A rendered clip is timed to its narration; never shorter than this. */
export const CLIP_MIN_MS = 12_000

/** Narration timing for a line: the real one when known, otherwise the calibrated estimate. */
export function voiceTiming(text: string, real?: NarrationTiming | null): NarrationTiming {
  if (real && real.ms > 0) return real
  const est = estimateTimings(text)
  return stretchTimings(est, Math.round(est.ms * VOICE_PACE))
}

/** Lookup of real timings by spoken text (from narration_audio / the cached JSON). */
export type TimingLookup = (spokenText: string) => NarrationTiming | null | undefined

/** Play time of one step in ms, as the player runs it. */
export function measureStepMs(step: Step, index = 0, lookup?: TimingLookup): number {
  const text = stepSpeech(step)
  const timing = text ? voiceTiming(text, lookup?.(text)) : null
  const tl = buildTimeline(step, index, timing)
  let ms = tl.total
  if (step.type === 'check') ms += CHECK_ANSWER_MS[step.kind] ?? 10_000
  if (step.type === 'manim_clip') ms = Math.max(ms, CLIP_MIN_MS)
  return ms + STEP_GAP_MS
}

export function measureMs(steps: Step[], lookup?: TimingLookup, from = 0, to = steps.length): number {
  let ms = 0
  for (let i = Math.max(0, from); i < Math.min(to, steps.length); i++) ms += measureStepMs(steps[i], i, lookup)
  return ms
}

/** Where a section stands against its target length. */
export function lengthReport(steps: Step[], targetMinutes: number, lookup?: TimingLookup) {
  const ms = measureMs(steps, lookup)
  const targetMs = targetMinutes * 60_000
  const ratio = targetMs > 0 ? ms / targetMs : 1
  return { ms, targetMs, ratio, minutes: Math.round(ms / 6000) / 10 }
}

/** A section plays close enough to its target (within -15% / +25%). */
export const LENGTH_MIN_RATIO = 0.85
export const LENGTH_MAX_RATIO = 1.25

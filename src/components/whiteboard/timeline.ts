/**
 * Narration-driven timing for one step. A step's actions (its own draw/write/…
 * plus its `cues`) are placed on the narration clock: each starts when its cue
 * word is spoken and runs until its `until` word, or for a length that fills the
 * phrase up to the next action. Silent steps run their actions back to back.
 *
 * Pure: shared by the player and by tests/tools.
 */
import { findCueWord, type Cue, type Step, type Vars } from '@/lib/lesson-schema'
import { estimateTimings, type NarrationTiming } from '@/lib/narration'
import { animMs, clamp, dwellMs, stepActions, type StepAction } from './board-state'
import { stepNarration } from './speech'

export interface TimedAction extends StepAction {
  /** ms from the start of the step. */
  start: number
  /** ms; 0 = instant. */
  dur: number
}

export interface StepTimeline {
  actions: TimedAction[]
  /** Narration length in ms (0 = silent step). */
  narrationMs: number
  /** When the step is finished: narration and every action done, plus a breath. */
  total: number
  timing: NarrationTiming | null
}

const BREATH_MS = 280

/** Actions the pen draws (their ink follows the narration clock, see ./pen). */
export const PEN_ACTIONS = new Set(['draw', 'write', 'math', 'highlight', 'annotate'])
/** Actions that move or change what is already drawn. */
const MOTION_ACTIONS = new Set(['animate', 'move', 'scale', 'camera', 'transform', 'fade', 'color', 'morph', 'along', 'pulse'])
/**
 * How long before its cue a pen action's element is put on the board (still blank): the hand travels to its first
 * stroke in this time, so the ink starts on the cue word itself.
 */
export const PEN_PREROLL_MS = 520

/** Time (ms) a narration word starts / ends, given the step's timing. */
function wordTime(step: Step, timing: NarrationTiming, map: number[], cue: Cue, from: number, edge: 's' | 'e'): { t: number; idx: number } | null {
  const ci = findCueWord(step, cue, from)
  if (ci < 0) return null
  const si = Math.min(timing.words.length - 1, map[ci] ?? ci)
  const w = timing.words[si]
  if (!w) return null
  if (edge === 'e' && typeof cue === 'string') {
    // A phrase ends at its last word.
    const n = cue.trim().split(/\s+/).length
    const last = timing.words[Math.min(timing.words.length - 1, (map[Math.min(map.length - 1, ci + n - 1)] ?? si))]
    return { t: (last ?? w).e, idx: ci }
  }
  return { t: edge === 's' ? w.s : w.e, idx: ci }
}

/**
 * Build the timeline of a step. `timing` is the real word timing of its narration
 * (Kokoro), or null to estimate it (device voice / voice off). `spoken` = false
 * when the step's narration is not being voiced at all (voice off still keeps the
 * estimated pace so motion is not rushed).
 */
export function buildTimeline(step: Step, index: number, timing: NarrationTiming | null, opts: { reduced?: boolean } = {}): StepTimeline {
  const { text, map } = stepNarration(step)
  const t = text ? timing ?? estimateTimings(text) : null
  const narrationMs = t ? t.ms : 0
  const raw = stepActions(step, index)
  const actions: TimedAction[] = []
  if (!t) {
    // Silent: back to back at natural lengths.
    let at = 0
    for (const a of raw) {
      const dur = opts.reduced ? Math.min(animMs(a.action), 250) : animMs(a.action)
      actions.push({ ...a, start: at, dur })
      at += a.action.type === 'set' ? 0 : dur
    }
    const end = actions.reduce((m, a) => Math.max(m, a.start + a.dur), 0)
    // A silent full clear (the start of a section) only has to start the board fading: the next
    // step begins while it fades, so a section boundary adds no wait.
    if (step.type === 'clear' && !step.targets) return { actions, narrationMs: 0, total: opts.reduced ? 0 : 180, timing: null }
    const total = Math.max(end + (actions.length ? 320 : 0), step.type === 'pause' ? step.ms : 0, raw.length ? 0 : dwellMs(step))
    return { actions, narrationMs: 0, total, timing: null }
  }
  // Starts.
  let prev = 0
  let cursorWord = 0
  const starts: number[] = []
  for (const a of raw) {
    let s = a.k === 0 && a.at === undefined ? 0 : prev
    if (a.at !== undefined) {
      const w = wordTime(step, t, map, a.at, cursorWord, 's')
      if (w) { s = w.t; cursorWord = w.idx }
    }
    s = Math.max(s, prev)
    starts.push(s)
    prev = s
  }
  const narrEnd = Math.max(0, narrationMs - 150)
  raw.forEach((a, i) => {
    const start = starts[i]
    const next = i + 1 < raw.length ? starts[i + 1] : narrEnd
    const natural = animMs(a.action)
    let dur: number
    if (a.until !== undefined) {
      const w = wordTime(step, t, map, a.until, 0, 'e')
      dur = w ? Math.max(250, w.t - start) : natural
    } else {
      const gap = next - start
      switch (a.action.type) {
        case 'set': dur = 0; break
        case 'animate': dur = clamp(gap - 80, 900, 14_000); break
        case 'write': case 'math': case 'draw':
          // Fill the phrase up to the next cue. The last action of a step may stretch
          // further so the board is still moving while the sentence finishes.
          dur = gap > 0 ? clamp(gap - 120, natural * 0.8, i === raw.length - 1 ? Math.max(natural * 2.6, 7000) : natural * 2.6) : natural
          break
        case 'move': case 'scale': case 'camera': case 'transform': case 'morph': case 'along':
          dur = gap > 0 ? clamp(gap - 100, Math.min(natural, 700), 6000) : natural
          break
        case 'highlight': case 'fade': case 'color': case 'pulse': case 'annotate':
          dur = gap > 0 ? clamp(gap - 100, Math.min(natural, 500), 3200) : natural
          break
        default: dur = natural
      }
    }
    if (opts.reduced) dur = a.action.type === 'animate' || a.action.type === 'set' ? 0 : Math.min(dur, 250)
    actions.push({ ...a, start, dur })
  })
  // Motion that acts on the board (a ball moving, a value counting, a shape sliding) never starts before the ink it
  // depends on is down: it waits for the pen actions before it to finish, then keeps its own length.
  let penEnd = 0
  let prevStart = 0
  for (const a of actions) {
    if (MOTION_ACTIONS.has(a.action.type) && a.start < penEnd) a.start = penEnd
    if (a.start < prevStart) a.start = prevStart
    prevStart = a.start
    if (PEN_ACTIONS.has(a.action.type)) penEnd = Math.max(penEnd, a.start + a.dur)
  }
  const end = actions.reduce((m, a) => Math.max(m, a.start + a.dur), 0)
  return { actions: fireOrder(actions), narrationMs, total: Math.max(narrationMs, end) + BREATH_MS, timing: t }
}

/** Actions a pen action is never put on the board ahead of (they change what it draws on or where). */
const FIRE_BARRIERS = new Set(['clear', 'transform', 'camera'])

/**
 * The order actions are put on the board in (see firedAt): a pen action's element goes on PEN_PREROLL_MS before its
 * cue so the hand is already there when the word is spoken, so it moves ahead of motion (a value counting, a colour
 * pulse) that starts after that moment, instead of waiting behind it and mounting late.
 */
function fireOrder(actions: TimedAction[]): TimedAction[] {
  const fire = (a: TimedAction) => a.start - (PEN_ACTIONS.has(a.action.type) ? PEN_PREROLL_MS : 0)
  const out: TimedAction[] = []
  for (const a of actions) {
    let i = out.length
    if (PEN_ACTIONS.has(a.action.type)) {
      while (i > 0 && !PEN_ACTIONS.has(out[i - 1].action.type) && !FIRE_BARRIERS.has(out[i - 1].action.type) && fire(out[i - 1]) > fire(a)) i--
    }
    out.splice(i, 0, a)
  }
  return out
}

const smooth = (p: number) => p * p * (3 - 2 * p)
const smoother = (p: number) => p * p * p * (p * (p * 6 - 15) + 10)

/** Variable values at time `now` (ms into the step), given the values before the step. */
export function varsAt(tl: StepTimeline, before: Vars, now: number): Vars {
  const v: Vars = { ...before }
  for (const a of tl.actions) {
    if (a.start > now) break
    const act = a.action
    if (act.type === 'set') Object.assign(v, act.vars)
    else if (act.type === 'animate') {
      const from = act.from ?? v[act.var] ?? act.to
      const p = a.dur <= 0 ? 1 : clamp((now - a.start) / a.dur, 0, 1)
      let q: number
      if (act.ease === 'linear') q = p
      else if (act.ease === 'there_and_back') q = smooth(p < 0.5 ? p * 2 : 2 - p * 2)
      else q = smoother(p)
      v[act.var] = from + (act.to - from) * q
    }
  }
  return v
}

/** Number of actions that have started by `now` (pen actions count from `preroll` ms before their cue). */
export function firedAt(tl: StepTimeline, now: number, preroll = 0): number {
  let n = 0
  for (const a of tl.actions) { if (a.start - (PEN_ACTIONS.has(a.action.type) ? preroll : 0) <= now) n++; else break }
  return n
}

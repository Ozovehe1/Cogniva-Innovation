'use client'
/**
 * Waiting, the GeniusMap way (docs/design/app-ui.md §Waiting states). One small vocabulary used everywhere a learner
 * waits, so every wait reads as the same calm tutor at work instead of a generic spinner:
 *
 * - InkMark: a short pen stroke that writes itself, rests, lifts. Replaces every spinner (inside a pressed button,
 *   next to a status). Motion that means "someone is writing for you", not "the machine is stuck" (low threat).
 * - Pending: a button label that keeps the button's width while its action is in flight (no layout shift).
 * - WaitNote: the honest status line: what is happening *now*, tied to a real event, in words (reduced uncertainty).
 * - QuietLine: a hairline progress line. Determinate when we know real progress, otherwise a slow drift. Never a
 *   fake percentage, never a ticking clock (no timers: time pressure raises threat and cuts working memory).
 * - PaperSketch: a paper frame at the final size of what is coming (board, graph, diagram, picture, clip, map) with a
 *   pen drawing its rough shape, so the eye already knows where to look (perceived performance, signalling) and the
 *   wait builds a little curiosity about the finished figure.
 * - WhileYouWait: something worth doing in a long wait: a prediction or a recall prompt (generation effect,
 *   pretesting), optional and never graded.
 *
 * All motion stops under prefers-reduced-motion: the mark is drawn once and stays.
 */
import React, { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import clsx, { type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

const cx = (...a: ClassValue[]) => twMerge(clsx(a))

const EASE = [0.45, 0, 0.2, 1] as const

/* ───────────── InkMark: the spinner replacement ───────────── */

/** A pen stroke writing itself (1.6 s: write, rest, lift). Inherits text colour. Decorative: pair it with words. */
export function InkMark({ className, width = 18 }: { className?: string; width?: number }) {
  const reduce = useReducedMotion()
  const h = Math.round(width * 0.5)
  return (
    <svg aria-hidden viewBox="0 0 24 12" width={width} height={h} className={cx('inline-block shrink-0 overflow-visible', className)} data-wait="ink">
      <path d="M2 8.5 C 5 2.5, 8 2.5, 10 7 S 15 11.5, 17.5 5.5 S 21 3, 22 4.5" fill="none" stroke="currentColor" strokeOpacity={0.32} strokeWidth={2} strokeLinecap="round" />
      <motion.path d="M2 8.5 C 5 2.5, 8 2.5, 10 7 S 15 11.5, 17.5 5.5 S 21 3, 22 4.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
        initial={{ pathLength: reduce ? 1 : 0, pathOffset: 0, opacity: 1 }}
        animate={reduce ? { pathLength: 1 } : { pathLength: [0, 1, 1, 0], pathOffset: [0, 0, 0, 1], opacity: [1, 1, 1, 0.6] }}
        transition={reduce ? { duration: 0 } : { duration: 1.7, times: [0, 0.5, 0.7, 1], ease: EASE, repeat: Infinity, repeatDelay: 0.15 }} />
    </svg>
  )
}

/* ───────────── Pending: width-stable button label ───────────── */

export type ActionState = 'idle' | 'busy' | 'done' | 'failed'

/**
 * Every state of a button's label shares one grid cell, so the button is always as wide as the widest of them and
 * never jumps when it is pressed (no layout shift). Busy: an ink mark plus the verb now happening ("Checking"), the
 * label stays at full contrast (globals.css keeps a busy, disabled button opaque). Done: a tick and a past-tense word
 * for a moment (closure, effort acknowledged). Failed: a calm "Try again" in the same place (low threat, no red).
 * `busy` is the short form for callers with a boolean.
 */
export function Pending({ busy, state: st, label, doneLabel = 'Done', failedLabel = 'Try again', children, className }: {
  busy?: boolean; state?: ActionState; label?: string; doneLabel?: string; failedLabel?: string; children: React.ReactNode; className?: string
}) {
  const state: ActionState = st ?? (busy ? 'busy' : 'idle')
  const cell = 'col-start-1 row-start-1 inline-flex items-center justify-center gap-2 transition-opacity duration-150 motion-reduce:transition-none'
  const off = 'invisible opacity-0'
  return (
    <span className={cx('inline-grid place-items-center', className)} data-pending={state}>
      <span className={cx(cell, state !== 'idle' && off)} aria-hidden={state !== 'idle'}>{children}</span>
      <span className={cx(cell, state !== 'busy' && off)} aria-hidden={state !== 'busy'}>
        <InkMark />{label ? <span>{label}</span> : <span className="sr-only">Working</span>}
      </span>
      <span className={cx(cell, state !== 'done' && off)} aria-hidden={state !== 'done'}>
        <svg aria-hidden viewBox="0 0 16 16" width={14} height={14} className="shrink-0"><path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span>{doneLabel}</span>
      </span>
      <span className={cx(cell, state !== 'failed' && off)} aria-hidden={state !== 'failed'}>
        <svg aria-hidden viewBox="0 0 16 16" width={14} height={14} className="shrink-0"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 3v3h-3" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span>{failedLabel}</span>
      </span>
      {(state === 'done' || state === 'failed') && <span className="sr-only" role="status">{state === 'done' ? doneLabel : `Didn’t work. ${failedLabel}`}</span>}
    </span>
  )
}

/**
 * Run an action and get its button state: busy while it runs, then done (or failed) for a moment, then idle again.
 * The action returns false (or throws) to mean it failed.
 */
export function useAction(holdMs = 1600) {
  const [state, setState] = useState<ActionState>('idle')
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const run = React.useCallback(async (fn: () => Promise<unknown>) => {
    if (timer.current) clearTimeout(timer.current)
    setState('busy')
    let ok = true
    try { ok = (await fn()) !== false } catch { ok = false }
    setState(ok ? 'done' : 'failed')
    timer.current = setTimeout(() => setState('idle'), ok ? holdMs : holdMs * 2.5)
    return ok
  }, [holdMs])
  return [state, run] as const
}

/* ───────────── StageList: the real steps of a long job ───────────── */

/**
 * The real stages of a long job, each done, now, or next. Only stages the server actually reports are shown as done
 * (honest progress); the current one carries the ink mark. Seeing the steps shrink the unknown (uncertainty
 * reduction) and gives a sense of progress without a number (goal-gradient).
 */
export function StageList({ stages, className }: { stages: { label: React.ReactNode; state: 'done' | 'now' | 'next' }[]; className?: string }) {
  return (
    <ol className={cx('space-y-2', className)} aria-label="Progress">
      {stages.map((s, i) => (
        <li key={i} className="flex items-center gap-2.5 text-[14px] leading-snug" aria-current={s.state === 'now' ? 'step' : undefined}>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden>
            {s.state === 'done'
              ? <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-accent-soft text-accent"><svg viewBox="0 0 16 16" width={11} height={11}><path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" /></svg></span>
              : s.state === 'now' ? <InkMark className="text-accent" width={16} />
                : <span className="h-[7px] w-[7px] rounded-full border border-line-strong" />}
          </span>
          <span className={s.state === 'now' ? 'font-medium text-ink' : 'text-muted'}>{s.label}</span>
          <span className="sr-only">{s.state === 'done' ? '(done)' : s.state === 'now' ? '(in progress)' : '(next)'}</span>
        </li>
      ))}
    </ol>
  )
}

/* ───────────── QuietLine: hairline progress ───────────── */

/** value 0..1 when real progress is known; omit it for an honest "working" drift. */
export function QuietLine({ value, className, label }: { value?: number | null; className?: string; label?: string }) {
  const reduce = useReducedMotion()
  const known = typeof value === 'number' && Number.isFinite(value)
  return (
    <div className={cx('relative h-[2px] w-full overflow-hidden rounded-full bg-line', className)}
      {...(known ? { role: 'progressbar', 'aria-label': label ?? 'Progress', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round((value as number) * 100) } : { 'aria-hidden': true })}>
      {known
        ? <div className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${Math.max(2, Math.round((value as number) * 100))}%` }} />
        : reduce
          ? <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-accent/60" />
          : <motion.div className="absolute inset-y-0 w-2/5 rounded-full bg-gradient-to-r from-transparent via-accent to-transparent"
              initial={{ left: '-40%' }} animate={{ left: ['-40%', '100%'] }} transition={{ duration: 2.6, ease: EASE, repeat: Infinity, repeatDelay: 0.4 }} />}
    </div>
  )
}

/* ───────────── WaitNote: honest status line ───────────── */

/** "Sketching the diagram" with an ink mark; optional quiet second line. Announced politely to screen readers. */
export function WaitNote({ children, sub, className, tone = 'ink', live = true }: { children: React.ReactNode; sub?: React.ReactNode; className?: string; tone?: 'ink' | 'accent' | 'muted'; live?: boolean }) {
  return (
    <div className={cx('flex items-start gap-2.5', className)} {...(live ? { role: 'status', 'aria-live': 'polite' as const } : {})} data-wait="note">
      <InkMark className={cx('mt-[0.42em]', tone === 'muted' ? 'text-muted' : 'text-accent')} />
      <div className="min-w-0">
        <p className={cx('text-[14.5px] leading-snug', tone === 'muted' ? 'text-muted' : 'text-ink-2')}>{children}</p>
        {sub && <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{sub}</p>}
      </div>
    </div>
  )
}

/* ───────────── PaperSketch: the shape of what is coming ───────────── */

export type SketchKind = 'board' | 'graph' | 'diagram' | 'picture' | 'clip' | 'sim' | 'lesson'

/** Each sketch is a few strokes, drawn in order by an unseen pen, then held and redrawn. */
const SKETCH: Record<SketchKind, { vb: string; strokes: { d: string; w?: number; o?: number; accent?: boolean }[] }> = {
  // Handwritten lines on a board, then an underline: "your tutor is writing".
  board: { vb: '0 0 320 180', strokes: [
    { d: 'M28 44 C 60 38, 92 48, 124 42 S 170 40, 196 44', w: 3 },
    { d: 'M28 74 C 70 70, 110 78, 150 72 S 214 70, 252 74', w: 2.4, o: 0.75 },
    { d: 'M28 102 C 58 98, 88 106, 118 100 S 160 98, 178 102', w: 2.4, o: 0.75 },
    { d: 'M206 112 C 214 96, 242 92, 256 108 C 268 124, 240 142, 222 132 C 206 124, 204 118, 206 112 Z', w: 2, accent: true },
    { d: 'M28 140 C 70 136, 120 144, 168 138', w: 2, accent: true },
  ] },
  // Axes, then the curve.
  graph: { vb: '0 0 320 180', strokes: [
    { d: 'M36 150 L 296 150', w: 1.6, o: 0.6 }, { d: 'M60 166 L 60 20', w: 1.6, o: 0.6 },
    { d: 'M60 140 C 110 136, 130 40, 170 40 S 230 136, 290 128', w: 3, accent: true },
    { d: 'M170 40 L 170 150', w: 1.2, o: 0.35 },
  ] },
  // A labelled structure: outline, inner part, two leader lines.
  diagram: { vb: '0 0 320 180', strokes: [
    { d: 'M86 92 C 86 52, 128 28, 160 28 C 210 28, 236 60, 236 92 C 236 132, 198 154, 160 154 C 118 154, 86 130, 86 92 Z', w: 2.6 },
    { d: 'M138 92 C 138 78, 150 70, 162 70 C 176 70, 184 80, 184 92 C 184 106, 174 114, 162 114 C 148 114, 138 104, 138 92 Z', w: 2.2, accent: true },
    { d: 'M184 88 L 268 60', w: 1.4, o: 0.6 }, { d: 'M268 60 L 296 60', w: 2.4, o: 0.5 },
    { d: 'M100 120 L 46 142', w: 1.4, o: 0.6 }, { d: 'M46 142 L 24 142', w: 2.4, o: 0.5 },
  ] },
  // A picture being looked for: a frame, a horizon, a sun.
  picture: { vb: '0 0 320 180', strokes: [
    { d: 'M70 30 L 250 30 L 250 150 L 70 150 Z', w: 2, o: 0.7 },
    { d: 'M76 136 L 128 88 L 162 118 L 196 82 L 244 136', w: 2.6 },
    { d: 'M206 58 m -11 0 a 11 11 0 1 0 22 0 a 11 11 0 1 0 -22 0', w: 2.2, accent: true },
  ] },
  // A scene: axes, a circle and the wave it traces (what a Manim clip usually looks like).
  clip: { vb: '0 0 320 180', strokes: [
    { d: 'M24 92 L 300 92', w: 1.4, o: 0.5 },
    { d: 'M86 92 m -40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0', w: 2.2, o: 0.8 },
    { d: 'M86 92 L 114 64', w: 1.6, o: 0.6 },
    { d: 'M150 92 C 166 52, 182 52, 198 92 S 230 132, 246 92 S 278 52, 294 92', w: 3, accent: true },
  ] },
  // Something you can drag: a track, a handle, a readout.
  sim: { vb: '0 0 320 180', strokes: [
    { d: 'M160 26 L 214 104', w: 2, o: 0.8 },
    { d: 'M214 104 m -12 0 a 12 12 0 1 0 24 0 a 12 12 0 1 0 -24 0', w: 2.6, accent: true },
    { d: 'M110 96 C 130 118, 190 124, 214 104', w: 1.6, o: 0.5 },
    { d: 'M40 156 L 280 156', w: 2.4, o: 0.45 }, { d: 'M118 156 m -7 0 a 7 7 0 1 0 14 0 a 7 7 0 1 0 -14 0', w: 2.4, accent: true },
  ] },
  // A lesson page: a title, lines of writing, a small figure.
  lesson: { vb: '0 0 320 180', strokes: [
    { d: 'M30 36 C 66 32, 104 40, 142 34', w: 3.4 },
    { d: 'M30 66 C 80 62, 130 70, 180 64', w: 2.2, o: 0.7 },
    { d: 'M30 88 C 74 84, 116 92, 160 86', w: 2.2, o: 0.7 },
    { d: 'M30 110 C 70 106, 108 114, 140 108', w: 2.2, o: 0.7 },
    { d: 'M214 130 L 214 64 M 206 130 L 290 130', w: 1.6, o: 0.5 },
    { d: 'M216 124 C 236 120, 250 84, 286 74', w: 2.8, accent: true },
  ] },
}

/**
 * A paper frame at the size of what is coming, with a pen drawing its rough shape. aspect 'board' = the lesson
 * player's frame (4:3 on a phone, 16:9 from md). `caption` sits in a strip under
 * the paper (never on the drawing), with an optional quiet line.
 */
export function PaperSketch({ kind, caption, sub, aspect = '16 / 9', className, progress, footer, live = true, bare = false }: {
  kind: SketchKind; caption?: React.ReactNode; sub?: React.ReactNode; aspect?: string; className?: string; progress?: number | null | 'none'; footer?: React.ReactNode; live?: boolean; bare?: boolean
}) {
  const reduce = useReducedMotion()
  const s = SKETCH[kind]
  const n = s.strokes.length
  const per = 0.9
  const cycle = n * per * 0.7 + 2.6
  return (
    <div className={cx(!bare && 'overflow-hidden rounded-[14px] border border-line bg-surface shadow-[var(--shadow-card)]', className)} data-wait={`sketch-${kind}`} aria-busy="true">
      <div className={cx('relative w-full bg-[#FBFAF6]', aspect === 'board' && 'aspect-[4/3] md:aspect-[16/9]')} style={aspect === 'board' ? undefined : { aspectRatio: aspect }} aria-hidden>
        {/* faint ruled paper */}
        <div className="absolute inset-0 opacity-[0.55]" style={{ backgroundImage: 'linear-gradient(to bottom, rgba(20,20,26,0.045) 1px, transparent 1px)', backgroundSize: '100% 22px', backgroundPosition: '0 11px' }} />
        <svg viewBox={s.vb} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full p-[6%]">
          {s.strokes.map((st, i) => (
            <motion.path key={i} d={st.d} fill="none" strokeLinecap="round" strokeLinejoin="round"
              stroke={st.accent ? 'var(--color-accent)' : 'var(--color-ink)'} strokeOpacity={(st.o ?? 0.85) * (st.accent ? 0.9 : 0.55)} strokeWidth={st.w ?? 2}
              // Hidden until its turn (a zero-length round-capped stroke would show as a dot), drawn, held, lifted.
              initial={{ pathLength: reduce ? 1 : 0, opacity: reduce ? 1 : 0 }}
              animate={reduce ? { pathLength: 1, opacity: 1 } : { pathLength: [0, 0, 1, 1, 1], opacity: [0, 0, 1, 1, 0.2] }}
              transition={reduce ? { duration: 0 } : {
                duration: cycle, repeat: Infinity, ease: EASE,
                times: [0, Math.max(0.001, i * per * 0.7 / cycle), (i * per * 0.7 + per) / cycle, (cycle - 0.7) / cycle, 1],
              }} />
          ))}
        </svg>
      </div>
      {(caption || footer || progress !== 'none') && (
        <div className="border-t border-line px-4 pb-3 pt-2.5">
          {progress !== 'none' && <QuietLine value={typeof progress === 'number' ? progress : null} className="mb-2.5" />}
          {caption && (
            <div {...(live ? { role: 'status', 'aria-live': 'polite' as const } : {})}>
              <p className="text-[14.5px] leading-snug text-ink">{caption}</p>
              {sub && <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{sub}</p>}
            </div>
          )}
          {footer}
        </div>
      )}
    </div>
  )
}

/* ───────────── WhileYouWait: a useful long wait ───────────── */

/** An optional thinking prompt for waits over ~20 s. Never graded, nothing to type: just a better use of the moment. */
export function WhileYouWait({ kicker = 'While you wait', children, className }: { kicker?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-[12px] border border-line bg-canvas/70 px-3.5 py-3', className)}>
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-accent">{kicker}</p>
      <p className="mt-1 font-display text-[16.5px] leading-snug text-ink">{children}</p>
    </div>
  )
}

/** Seconds since mount (for switching an honest label after a real threshold, never displayed as a clock). */
export function useElapsed(active = true, step = 1000) {
  const [s, setS] = useState(0)
  useEffect(() => {
    if (!active) return
    const t0 = Date.now()
    const id = setInterval(() => setS(Math.floor((Date.now() - t0) / 1000)), step)
    return () => clearInterval(id)
  }, [active, step])
  return s
}

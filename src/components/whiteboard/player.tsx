'use client'
import 'katex/dist/katex.min.css'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, Undo2 } from 'lucide-react'
import { BOARD_H, BOARD_W, boardIdsAfter, type CheckStep, type ManimClipStep, type Step } from '@/lib/lesson-schema'
import { buildBoard, dwellMs, segmentStart, shapeBox, type Box } from './board-state'
import { EASE_SMOOTH, HighlightElement, ShapeElement, TextElement } from './elements'
import { CheckCard, type CheckResponse } from './check-card'
import { cx } from '@/components/ui'

export type PlayerEvent =
  | { type: 'step'; index: number }
  | { type: 'check'; index: number; stepId?: string; kind: CheckStep['kind']; response: CheckResponse; correct?: boolean; answer?: string }
  | { type: 'reteach'; index: number; source: 'ai' | 'script' | 'replay'; reason: 'explain_differently' | 'wrong_answer' }
  | { type: 'complete' }

export interface NeedStepsRequest {
  reason: 'explain_differently' | 'wrong_answer'
  check: CheckStep
  checkIndex: number
  answer?: string
  /** Everything played so far, including the check. */
  played: Step[]
  boardIds: string[]
  boardAxes: string[]
}

export interface WhiteboardPlayerProps {
  steps: Step[]
  autoPlay?: boolean
  /** Tutor preview: allows skipping past checks with the Next control. */
  allowSkipChecks?: boolean
  initialIndex?: number
  /** Ask the AI tutor for re-teach steps. Return [] to fall back to the script's own reteach or a replay. */
  onNeedSteps?: (req: NeedStepsRequest) => Promise<Step[]>
  onEvent?: (e: PlayerEvent) => void
  className?: string
}

/**
 * Plays a lesson scene script on a 16:10 whiteboard. The board is laid out in
 * fixed board units (BOARD_W x BOARD_H) and scaled to the container, so a
 * script looks the same on a 375px phone and a desktop.
 */
export function WhiteboardPlayer({
  steps: initialSteps,
  autoPlay = false,
  allowSkipChecks = false,
  initialIndex = 0,
  onNeedSteps,
  onEvent,
  className,
}: WhiteboardPlayerProps) {
  const reduced = !!useReducedMotion()
  const [steps, setSteps] = useState<Step[]>(initialSteps)
  const [cursor, setCursor] = useState(() => Math.min(initialIndex, initialSteps.length))
  const [animIdx, setAnimIdx] = useState(-1)
  const [playId, setPlayId] = useState(0)
  const [playing, setPlaying] = useState(autoPlay)
  const [pendingCheck, setPendingCheck] = useState<number | null>(() =>
    initialIndex > 0 && initialSteps[Math.min(initialIndex, initialSteps.length) - 1]?.type === 'check' ? Math.min(initialIndex, initialSteps.length) - 1 : null)
  const [resolved, setResolved] = useState<Set<number>>(() => new Set())
  const [clipIdx, setClipIdx] = useState<number | null>(null)
  const [thinking, setThinking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [started, setStarted] = useState(autoPlay || initialIndex > 0)
  const completedRef = useRef(false)
  const onEventRef = useRef(onEvent)
  useEffect(() => { onEventRef.current = onEvent }, [onEvent])
  const emit = useCallback((e: PlayerEvent) => onEventRef.current?.(e), [])

  // Reset when a new script is passed in (e.g. tutor regenerates).
  const scriptKey = useMemo(() => JSON.stringify(initialSteps).length + ':' + initialSteps.length, [initialSteps])
  const lastKey = useRef(scriptKey)
  useEffect(() => {
    if (lastKey.current === scriptKey) return
    lastKey.current = scriptKey
    setSteps(initialSteps)
    setCursor(0); setAnimIdx(-1); setPendingCheck(null); setClipIdx(null); setResolved(new Set())
    setPlaying(false); setStarted(false); completedRef.current = false
  }, [scriptKey, initialSteps])

  const board = useMemo(() => buildBoard(steps, cursor), [steps, cursor])

  /* ── Scaling ── */
  const outerRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  useEffect(() => {
    const node = outerRef.current
    if (!node) return
    const update = () => setScale(node.clientWidth / BOARD_W)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  /* ── Element measurement for highlights ── */
  const nodes = useRef(new Map<string, HTMLElement>())
  const registerRef = useCallback((id: string, node: HTMLElement | null) => {
    if (node) nodes.current.set(id, node)
    else nodes.current.delete(id)
  }, [])
  const boardRef = useRef(board)
  useEffect(() => { boardRef.current = board }, [board])
  const measure = useCallback((id: string): Box | null => {
    const el = boardRef.current.els.find(e => e.id === id && e.kind !== 'highlight')
    if (!el) return null
    if (el.kind === 'shape') return shapeBox(el)
    const node = nodes.current.get(id)
    const layer = layerRef.current
    if (!node || !layer) return null
    const lr = layer.getBoundingClientRect()
    const r = node.getBoundingClientRect()
    const s = lr.width / BOARD_W || 1
    return { x: (r.left - lr.left) / s, y: (r.top - lr.top) / s, w: r.width / s, h: r.height / s }
  }, [])

  /* ── Navigation ── */
  const blockersFor = useCallback((i: number, list: Step[]) => {
    const s = list[i]
    setPendingCheck(s?.type === 'check' ? i : null)
    setClipIdx(s?.type === 'manim_clip' ? i : null)
  }, [])

  /** Show steps[0..i] with step i animating (or static). */
  const goTo = useCallback((i: number, animate: boolean, list: Step[] = steps) => {
    setNotice(null)
    if (i < 0) { setCursor(0); setAnimIdx(-1); setPendingCheck(null); setClipIdx(null); setPlayId(p => p + 1); return }
    const idx = Math.min(i, list.length - 1)
    setCursor(idx + 1)
    setAnimIdx(animate ? idx : -1)
    setPlayId(p => p + 1)
    blockersFor(idx, list)
    if (animate) emit({ type: 'step', index: idx })
  }, [steps, blockersFor, emit])

  const blocked = pendingCheck !== null || clipIdx !== null || thinking

  // Auto-advance.
  useEffect(() => {
    if (!playing || blocked) return
    if (cursor >= steps.length) {
      setPlaying(false)
      if (!completedRef.current && steps.length) { completedRef.current = true; emit({ type: 'complete' }) }
      return
    }
    const last = cursor > 0 ? steps[cursor - 1] : undefined
    const wait = cursor === 0 ? 250 : animIdx === cursor - 1 && last ? (reduced ? Math.max(600, dwellMs(last) * 0.6) : dwellMs(last)) : 350
    const t = setTimeout(() => goTo(cursor, true), wait)
    return () => clearTimeout(t)
  }, [playing, blocked, cursor, steps, animIdx, playId, reduced, goTo, emit])

  const togglePlay = () => {
    setStarted(true)
    if (cursor >= steps.length && !blocked) { goTo(-1, false); completedRef.current = false; setPlaying(true); return }
    setPlaying(p => !p)
  }
  const next = () => {
    if (pendingCheck !== null && !allowSkipChecks && !resolved.has(pendingCheck)) return
    setStarted(true)
    if (cursor < steps.length) goTo(cursor, true)
  }
  const prev = () => { setStarted(true); goTo(cursor - 2, true) }
  const replayStep = () => { setStarted(true); if (cursor > 0) goTo(cursor - 1, true) }
  const restart = () => { setStarted(true); completedRef.current = false; goTo(-1, false); setPlaying(true) }

  /* ── Checks ── */
  const insertAfter = useCallback((index: number, extra: Step[]) => {
    const list = [...steps.slice(0, index + 1), ...extra, ...steps.slice(index + 1)]
    setSteps(list)
    return list
  }, [steps])

  const continueFrom = useCallback((index: number, list: Step[] = steps) => {
    setPendingCheck(null)
    setPlaying(true)
    setStarted(true)
    // Move the cursor just past the check without re-animating it.
    setCursor(index + 1)
    setAnimIdx(-1)
    void list
  }, [steps])

  const reteach = useCallback(async (index: number, reason: NeedStepsRequest['reason'], answer?: string) => {
    const check = steps[index] as CheckStep
    let extra: Step[] = []
    let source: 'ai' | 'script' | 'replay' = 'ai'
    if (onNeedSteps) {
      setThinking(true)
      try {
        const played = steps.slice(0, index + 1)
        const { ids, axes } = boardIdsAfter(played)
        extra = await onNeedSteps({ reason, check, checkIndex: index, answer, played, boardIds: ids, boardAxes: axes })
      } catch {
        extra = []
      } finally {
        setThinking(false)
      }
    }
    if (!extra.length && check.reteach?.length) { extra = check.reteach; source = 'script' }
    if (!extra.length) {
      source = 'replay'
      emit({ type: 'reteach', index, source, reason })
      setNotice('Here it is once more, step by step.')
      const start = segmentStart(steps, index)
      setPendingCheck(null)
      goTo(start, true)
      setPlaying(true)
      return
    }
    // Re-ask the same check after the new explanation, unless the new steps end in their own check.
    const endsWithCheck = extra[extra.length - 1]?.type === 'check'
    const tail: Step[] = endsWithCheck ? [] : [{ ...check, id: undefined, reteach: undefined }]
    const list = insertAfter(index, [...extra, ...tail])
    emit({ type: 'reteach', index, source, reason })
    setResolved(r => new Set(r).add(index))
    continueFrom(index, list)
  }, [steps, onNeedSteps, insertAfter, continueFrom, emit, goTo])

  const onCheck = useCallback((response: CheckResponse, detail?: { correct?: boolean; answer?: string }) => {
    if (pendingCheck === null) return
    const index = pendingCheck
    const check = steps[index] as CheckStep
    emit({ type: 'check', index, stepId: check.id, kind: check.kind, response, correct: detail?.correct, answer: detail?.answer })
    if (response === 'got_it' || response === 'continue') {
      setResolved(r => new Set(r).add(index))
      continueFrom(index)
    } else if (response === 'again') {
      const start = segmentStart(steps, index)
      setPendingCheck(null)
      goTo(start, true)
      setPlaying(true)
    } else if (response === 'differently') {
      void reteach(index, 'explain_differently')
    } else if (response === 'explain_wrong') {
      void reteach(index, 'wrong_answer', detail?.answer)
    }
  }, [pendingCheck, steps, emit, continueFrom, goTo, reteach])

  /* ── Captions ── */
  const caption = useMemo(() => {
    for (let i = cursor - 1; i >= 0; i--) {
      const s = steps[i]
      if (s.say) return { text: s.say, key: i }
      if (s.type === 'clear' && !s.targets) return null
    }
    return null
  }, [cursor, steps])

  const clip = clipIdx !== null ? (steps[clipIdx] as ManimClipStep) : null
  const check = pendingCheck !== null ? (steps[pendingCheck] as CheckStep) : null
  const progress = steps.length ? cursor / steps.length : 0
  const atEnd = cursor >= steps.length && !blocked

  return (
    <div className={cx('w-full', className)}>
      {/* Board */}
      <div
        ref={outerRef}
        className="wb-board relative w-full overflow-hidden rounded-[14px] border border-line bg-[#FDFCF9] shadow-[var(--shadow-card)]"
        style={{ aspectRatio: `${BOARD_W} / ${BOARD_H}` }}
      >
        <div
          ref={layerRef}
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: BOARD_W, height: BOARD_H, transform: `scale(${scale})`, visibility: scale ? 'visible' : 'hidden' }}
        >
          <svg
            viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
            width={BOARD_W}
            height={BOARD_H}
            className="absolute inset-0 overflow-visible"
            aria-hidden
          >
            <defs>
              {Object.values(board.axes).map(a => (
                <clipPath key={a.id} id={`wb-clip-${a.id}`}>
                  <rect x={a.frame.x - 4} y={a.frame.y - 4} width={a.frame.w + 8} height={a.frame.h + 8} />
                </clipPath>
              ))}
            </defs>
            <AnimatePresence initial={false}>
              {board.els.map(el => {
                if (el.kind === 'shape') {
                  const anim = el.born === animIdx
                  return (
                    <motion.g key={anim ? `${el.key}#${playId}` : el.key} exit={{ opacity: 0, transition: { duration: reduced ? 0.01 : 0.3 } }}>
                      <ShapeElement el={el} animate={anim} reduced={reduced} />
                    </motion.g>
                  )
                }
                if (el.kind === 'highlight') {
                  const anim = el.born === animIdx
                  return (
                    <motion.g key={anim ? `${el.key}#${playId}` : el.key} exit={{ opacity: 0, transition: { duration: 0.25 } }}>
                      <HighlightElement el={el} animate={anim} reduced={reduced} measure={measure} />
                    </motion.g>
                  )
                }
                return null
              })}
            </AnimatePresence>
          </svg>
          <AnimatePresence initial={false}>
            {board.els.map(el => {
              if (el.kind !== 'text' && el.kind !== 'math') return null
              const animate = el.morphedAt === animIdx && animIdx >= 0 ? 'morph' : el.born === animIdx ? 'enter' : null
              const key = animate ? `${el.key}#${playId}` : el.morphedAt !== undefined ? `${el.key}~${el.morphedAt}` : el.key
              return <TextElement key={key} el={el} animate={animate} reduced={reduced} registerRef={registerRef} />
            })}
          </AnimatePresence>
        </div>

        {/* Manim clip overlay */}
        <AnimatePresence>
          {clip && (
            <motion.div
              key={`clip-${clipIdx}-${playId}`}
              className="absolute inset-0 z-10 flex flex-col bg-[#0E0E12]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0.01 : 0.35, ease: EASE_SMOOTH }}
            >
              <ClipVideo
                step={clip}
                onDone={() => { setClipIdx(null); setPlaying(true) }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Start overlay */}
        {!started && (
          <button
            type="button"
            onClick={togglePlay}
            className="group absolute inset-0 z-20 flex items-center justify-center bg-[#FDFCF9]/70 backdrop-blur-[1px]"
            aria-label="Start lesson"
          >
            <span className="inline-flex h-12 items-center gap-2.5 rounded-full bg-accent px-6 text-[15px] font-medium text-white shadow-[var(--shadow-raised)] transition-transform duration-150 group-hover:scale-[1.02]">
              <Play className="h-4 w-4" fill="currentColor" strokeWidth={0} />
              Start lesson
            </span>
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="mt-3 flex items-center gap-1 sm:gap-2">
        <ControlButton label="Restart" onClick={restart}><RotateCcw className="h-[17px] w-[17px]" strokeWidth={1.75} /></ControlButton>
        <ControlButton label="Previous step" onClick={prev} disabled={cursor <= 1}><ChevronLeft className="h-5 w-5" strokeWidth={1.75} /></ControlButton>
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing && !atEnd ? 'Pause' : atEnd ? 'Play again' : 'Play'}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-accent text-white transition-colors duration-150 hover:bg-accent-hover"
        >
          {playing && !atEnd ? <Pause className="h-[18px] w-[18px]" fill="currentColor" strokeWidth={0} /> : <Play className="ml-0.5 h-[18px] w-[18px]" fill="currentColor" strokeWidth={0} />}
        </button>
        <ControlButton
          label="Next step"
          onClick={next}
          disabled={cursor >= steps.length || (pendingCheck !== null && !allowSkipChecks && !resolved.has(pendingCheck))}
        >
          <ChevronRight className="h-5 w-5" strokeWidth={1.75} />
        </ControlButton>
        <ControlButton label="Replay this step" onClick={replayStep} disabled={cursor === 0}><Undo2 className="h-[17px] w-[17px]" strokeWidth={1.75} /></ControlButton>
        <div className="ml-2 flex min-w-0 flex-1 items-center gap-3">
          <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-label="Lesson progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={cursor}>
            <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${progress * 100}%` }} transition={{ duration: reduced ? 0 : 0.4, ease: EASE_SMOOTH }} />
          </div>
          <span className="tnum hidden flex-shrink-0 text-[12px] text-muted sm:inline">{cursor} / {steps.length}</span>
        </div>
      </div>

      {/* Caption / check area */}
      <div className="mt-4 min-h-[88px]" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          {thinking ? (
            <motion.div
              key="thinking"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3.5 text-[15px] text-ink-2"
            >
              <span className="inline-flex gap-1" aria-hidden>
                {[0, 1, 2].map(i => (
                  <motion.span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-accent"
                    animate={reduced ? undefined : { opacity: [0.25, 1, 0.25] }}
                    transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
                  />
                ))}
              </span>
              Working out another way to show this…
            </motion.div>
          ) : check ? (
            <CheckCard
              key={`check-${pendingCheck}-${playId}`}
              step={check}
              resolved={resolved.has(pendingCheck!)}
              reduced={reduced}
              onRespond={onCheck}
            />
          ) : atEnd && started && steps.length > 0 ? (
            <motion.div
              key="end"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="rounded-[12px] border border-accent-line bg-accent-soft px-4 py-3.5"
            >
              <p className="text-[15px] font-medium text-accent">End of lesson</p>
              <p className="mt-0.5 text-sm text-ink-2">Replay any step with the controls above, or start again from the top.</p>
            </motion.div>
          ) : caption ? (
            <motion.p
              key={`cap-${caption.key}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: reduced ? 0.01 : 0.3 }}
              className="font-display text-[19px] leading-[1.45] text-ink md:text-[21px]"
            >
              {caption.text}
            </motion.p>
          ) : null}
        </AnimatePresence>
        {notice && !check && !thinking && <p className="mt-2 text-[13px] text-muted">{notice}</p>}
      </div>
    </div>
  )
}

function ControlButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  )
}

function ClipVideo({ step, onDone }: { step: ManimClipStep; onDone: () => void }) {
  const [failed, setFailed] = useState(false)
  return (
    <>
      <div className="relative min-h-0 flex-1">
        {failed ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-white/70">This animation could not be loaded.</div>
        ) : (
          <video
            src={step.url}
            className="h-full w-full object-contain"
            autoPlay
            muted
            playsInline
            onEnded={onDone}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <p className="min-w-0 truncate text-[12px] text-white/70">{step.caption ?? ''}</p>
        <button type="button" onClick={onDone} className="h-8 flex-shrink-0 rounded-full border border-white/20 px-3 text-[12px] font-medium text-white hover:bg-white/10">
          {failed ? 'Continue' : 'Skip'}
        </button>
      </div>
    </>
  )
}

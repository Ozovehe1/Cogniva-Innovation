'use client'
import 'katex/dist/katex.min.css'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, Undo2, Volume2, VolumeX } from 'lucide-react'
import { BOARD_H, BOARD_W, boardIdsAfter, type CheckStep, type Ink, type ManimClipStep, type Step } from '@/lib/lesson-schema'
import { animMs, buildBoard, compactPartition, dwellMs, segmentStart, shapeBox, type Box } from './board-state'
import { BoardScale, EASE_SMOOTH, HighlightElement, ShapeElement, TextElement } from './elements'
import { CheckCard, RichText, type CheckResponse } from './check-card'
import { estimateSpeechMs, stepLines, stepSpeech } from './speech'
import { getNarrator, readSoundPref, writeSoundPref, type Narrator } from './narrator'
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

/** Below this container width the board switches to the phone layout. */
const COMPACT_W = 600

/**
 * Plays a lesson scene script on a 16:10 whiteboard. The board is laid out in
 * fixed board units (BOARD_W x BOARD_H) and scaled to the container. On narrow
 * screens (phone layout) the diagram is cropped and zoomed to the width and the
 * text and equations reflow underneath it at a readable size (see
 * compactPartition). Each step's narration is spoken through a Narrator and
 * collected in a running transcript.
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
  const [boxW, setBoxW] = useState(0)
  useEffect(() => {
    const node = outerRef.current
    if (!node) return
    const update = () => setBoxW(node.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(node)
    return () => ro.disconnect()
  }, [])
  const compact = boxW > 0 && boxW < COMPACT_W
  const layout = useMemo(() => (compact ? compactPartition(board) : null), [compact, board])
  const noteIds = useMemo(() => new Set(layout?.notes.map(n => n.id).filter((x): x is string => !!x) ?? []), [layout])
  // Board-unit -> screen-pixel transform for the drawing layer.
  const view = useMemo(() => {
    if (!boxW) return { scale: 0, tx: 0, ty: 0, h: 0 }
    if (!layout) return { scale: boxW / BOARD_W, tx: 0, ty: 0, h: (boxW / BOARD_W) * BOARD_H }
    const r = layout.region
    if (!r) return { scale: boxW / BOARD_W, tx: 0, ty: 0, h: 0 }
    const sc = Math.min(boxW / r.w, 1.15, 380 / r.h)
    return { scale: sc, tx: (boxW - r.w * sc) / 2 - r.x * sc, ty: -r.y * sc, h: r.h * sc }
  }, [boxW, layout])
  const scale = view.scale

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

  /* ── Voice ── */
  const narratorRef = useRef<Narrator | null>(null)
  const [voiceOk, setVoiceOk] = useState(false)
  const [soundOn, setSoundOn] = useState(true)
  /** playId of the step whose narration is still being spoken. */
  const [speaking, setSpeaking] = useState<number | null>(null)
  const unlocked = useRef(false)
  const stepStart = useRef(0)
  const stepsRef = useRef(steps)
  useEffect(() => { stepsRef.current = steps }, [steps])
  useEffect(() => {
    const n = getNarrator()
    narratorRef.current = n
    setVoiceOk(n.supported)
    setSoundOn(readSoundPref())
    return () => n.cancel()
  }, [])
  const voiceOn = voiceOk && soundOn
  /** Call from a tap: mobile browsers only allow speech after a user gesture. */
  const unlockVoice = useCallback(() => {
    if (unlocked.current || !narratorRef.current?.supported) return
    unlocked.current = true
    narratorRef.current.unlock()
  }, [])
  const toggleSound = () => {
    const on = !soundOn
    setSoundOn(on)
    writeSoundPref(on)
    if (on) unlockVoice()
    else narratorRef.current?.cancel()
  }
  // Speak the step that just started animating.
  useEffect(() => {
    stepStart.current = Date.now()
    const n = narratorRef.current
    if (!n || !voiceOk) return
    const step = animIdx >= 0 ? stepsRef.current[animIdx] : undefined
    const text = soundOn && started && step ? stepSpeech(step) : ''
    if (!text) { n.cancel(); setSpeaking(null); return }
    const id = playId
    setSpeaking(id)
    n.speak(text, () => setSpeaking(cur => (cur === id ? null : cur)))
  }, [playId, animIdx, soundOn, voiceOk, started])
  // Pause and resume narration with the player.
  useEffect(() => {
    const n = narratorRef.current
    if (!n) return
    if (playing) n.resume()
    else n.pause()
  }, [playing])

  // Auto-advance.
  useEffect(() => {
    if (!playing || blocked) return
    if (cursor >= steps.length) {
      setPlaying(false)
      if (!completedRef.current && steps.length) { completedRef.current = true; emit({ type: 'complete' }) }
      return
    }
    const last = cursor > 0 ? steps[cursor - 1] : undefined
    let wait: number
    if (cursor === 0) wait = 250
    else if (animIdx === cursor - 1 && last) {
      const spoken = voiceOn ? stepSpeech(last) : ''
      const elapsed = Date.now() - stepStart.current
      if (spoken && speaking === playId) {
        // Waiting for the narration to finish; this is only the fallback if the engine never reports the end.
        wait = Math.max(1500, estimateSpeechMs(spoken) * 1.5 + 1500 - elapsed)
      } else if (spoken) {
        // Narration finished: let the drawing finish too, then a short breath.
        wait = Math.max(300, animMs(last) + 320 - elapsed)
      } else wait = reduced ? Math.max(600, dwellMs(last) * 0.6) : dwellMs(last)
    } else wait = 350
    const t = setTimeout(() => goTo(cursor, true), wait)
    return () => clearTimeout(t)
  }, [playing, blocked, cursor, steps, animIdx, playId, reduced, goTo, emit, voiceOn, speaking])

  const togglePlay = () => {
    unlockVoice()
    setStarted(true)
    if (cursor >= steps.length && !blocked) { goTo(-1, false); completedRef.current = false; setPlaying(true); return }
    setPlaying(p => !p)
  }
  const next = () => {
    if (pendingCheck !== null && !allowSkipChecks && !resolved.has(pendingCheck)) return
    unlockVoice()
    setStarted(true)
    if (cursor < steps.length) goTo(cursor, true)
  }
  const prev = () => { unlockVoice(); setStarted(true); goTo(cursor - 2, true) }
  const replayStep = () => { unlockVoice(); setStarted(true); if (cursor > 0) goTo(cursor - 1, true) }
  const restart = () => { unlockVoice(); setStarted(true); completedRef.current = false; goTo(-1, false); setPlaying(true) }

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

  /* ── Transcript ── */
  const lines = useMemo(() => steps.slice(0, cursor).flatMap((st, i) => stepLines(st, i)), [steps, cursor])
  const currentIdx = lines.length ? lines[lines.length - 1].index : -1

  const clip = clipIdx !== null ? (steps[clipIdx] as ManimClipStep) : null
  const check = pendingCheck !== null ? (steps[pendingCheck] as CheckStep) : null
  const progress = steps.length ? cursor / steps.length : 0
  const atEnd = cursor >= steps.length && !blocked

  // Highlights on reflowed notes are drawn by the note itself (phone layout).
  const noteMarks = useMemo(() => {
    const m = new Map<string, { style: 'box' | 'underline'; color: Ink; fresh: boolean }>()
    if (!layout) return m
    for (const el of board.els) {
      if (el.kind === 'highlight' && noteIds.has(el.target)) m.set(el.target, { style: el.style, color: el.color, fresh: el.born === animIdx })
    }
    return m
  }, [layout, board, noteIds, animIdx])

  const textKey = (el: { key: string; morphedAt?: number; born: number }, animate: 'enter' | 'morph' | null) =>
    animate ? `${el.key}#${playId}` : el.morphedAt !== undefined ? `${el.key}~${el.morphedAt}` : el.key
  const animOf = (el: { morphedAt?: number; born: number }) =>
    el.morphedAt === animIdx && animIdx >= 0 ? 'morph' as const : el.born === animIdx ? 'enter' as const : null

  const drawing = (
    <div
      ref={layerRef}
      className="absolute left-0 top-0 origin-top-left"
      style={{
        width: BOARD_W,
        height: BOARD_H,
        transform: `translate(${view.tx}px, ${view.ty}px) scale(${scale})`,
        transition: layout && !reduced ? 'transform 500ms cubic-bezier(0.45, 0.05, 0.25, 1)' : undefined,
        visibility: scale ? 'visible' : 'hidden',
      }}
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
              if (noteIds.has(el.target)) return null
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
          if (layout && !layout.labels.has(el.key)) return null
          const animate = animOf(el)
          return <TextElement key={textKey(el, animate)} el={el} animate={animate} reduced={reduced} registerRef={registerRef} />
        })}
      </AnimatePresence>
    </div>
  )

  return (
    <div className={cx('w-full', className)}>
      {/* Board */}
      <BoardScale.Provider value={scale || 1}>
        <div
          ref={outerRef}
          className={cx(
            'wb-board relative w-full overflow-hidden rounded-[14px] border border-line bg-[#FDFCF9] shadow-[var(--shadow-card)]',
            layout && 'min-h-[220px]',
            layout && clip && 'min-h-[260px]',
          )}
          style={layout ? undefined : { aspectRatio: `${BOARD_W} / ${BOARD_H}` }}
          data-layout={layout ? 'compact' : 'wide'}
        >
          {layout ? (
            <>
              {layout.region && (
                <div className="relative w-full overflow-hidden" style={{ height: view.h, transition: reduced ? undefined : 'height 500ms cubic-bezier(0.45, 0.05, 0.25, 1)' }}>
                  {drawing}
                </div>
              )}
              {!layout.region && <div className="hidden">{drawing}</div>}
              {layout.notes.length > 0 && (
                <div className={cx('flex flex-col gap-3 px-4 pb-5', layout.region ? 'border-t border-dashed border-line pt-4' : 'pt-5')}>
                  <AnimatePresence initial={false}>
                    {layout.notes.map(el => {
                      const animate = animOf(el)
                      return (
                        <TextElement
                          key={textKey(el, animate)}
                          el={el}
                          animate={animate}
                          reduced={reduced}
                          registerRef={registerRef}
                          flow
                          mark={el.id ? noteMarks.get(el.id) ?? null : null}
                        />
                      )
                    })}
                  </AnimatePresence>
                </div>
              )}
            </>
          ) : drawing}

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
      </BoardScale.Provider>

      {/* Controls */}
      <div className="mt-3 flex items-center gap-0.5 sm:gap-2">
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
        <div className="ml-1 flex min-w-0 flex-1 items-center gap-3 sm:ml-2">
          <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-label="Lesson progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={cursor}>
            <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${progress * 100}%` }} transition={{ duration: reduced ? 0 : 0.4, ease: EASE_SMOOTH }} />
          </div>
          <span className="tnum hidden flex-shrink-0 text-[12px] text-muted sm:inline">{cursor} / {steps.length}</span>
        </div>
        {voiceOk && (
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={soundOn}
            aria-label={soundOn ? 'Voice on. Turn voice off' : 'Voice off. Turn voice on'}
            title={soundOn ? 'Voice on' : 'Voice off'}
            className={cx(
              'flex h-10 flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium transition-colors duration-150 sm:px-3',
              soundOn ? 'text-accent hover:bg-accent-soft' : 'text-muted hover:bg-sunken hover:text-ink',
            )}
          >
            {soundOn ? <Volume2 className="h-[18px] w-[18px]" strokeWidth={1.75} /> : <VolumeX className="h-[18px] w-[18px]" strokeWidth={1.75} />}
            <span className="hidden sm:inline">{soundOn ? 'Voice on' : 'Voice off'}</span>
          </button>
        )}
      </div>

      {/* Active panel: thinking, check, end of lesson */}
      <div aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          {thinking ? (
            <motion.div
              key="thinking"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-4 flex items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3.5 text-[15px] text-ink-2"
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
            <div key={`check-${pendingCheck}-${playId}`} className="mt-4">
              <CheckCard
                step={check}
                resolved={resolved.has(pendingCheck!)}
                reduced={reduced}
                onRespond={onCheck}
              />
            </div>
          ) : atEnd && started && steps.length > 0 ? (
            <motion.div
              key="end"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-4 rounded-[12px] border border-accent-line bg-accent-soft px-4 py-3.5"
            >
              <p className="text-[15px] font-medium text-accent">End of lesson</p>
              <p className="mt-0.5 text-sm text-ink-2">Replay any step with the controls above, or start again from the top.</p>
            </motion.div>
          ) : null}
        </AnimatePresence>
        {notice && !check && !thinking && <p className="mt-3 text-[13px] text-muted">{notice}</p>}
      </div>

      {/* Transcript */}
      <Transcript lines={lines} currentIdx={currentIdx} reduced={reduced} />
    </div>
  )
}

function Transcript({ lines, currentIdx, reduced }: { lines: ReturnType<typeof stepLines>; currentIdx: number; reduced: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const curRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    const box = boxRef.current, cur = curRef.current
    if (!box || !cur) return
    // Keep the current line in view inside the transcript box without scrolling the page.
    const top = cur.offsetTop // box is the offset parent
    const target = Math.max(0, top - box.clientHeight + cur.offsetHeight + 12)
    if (Math.abs(box.scrollTop - target) > 2) box.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' })
  }, [lines.length, currentIdx, reduced])
  const firstCurrent = lines.findIndex(l => l.index === currentIdx)
  return (
    <section className="mt-4 rounded-[14px] border border-line bg-surface" aria-label="Lesson transcript">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Transcript</h2>
        {lines.length > 0 && <span className="tnum text-[12px] text-muted">{lines.filter(l => l.kind === 'say').length} lines</span>}
      </div>
      <div ref={boxRef} className="wb-transcript relative max-h-[240px] overflow-y-auto overscroll-contain px-4 py-3 md:max-h-[300px]" tabIndex={0}>
        {lines.length === 0 ? (
          <p className="py-1 text-[15px] text-muted">Everything the tutor says will be written here as the lesson plays.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {lines.map((l, i) => {
              const current = l.index === currentIdx
              const ref = i === firstCurrent ? curRef : undefined
              return (
                <li
                  key={`${l.index}-${l.kind}-${i}`}
                  ref={ref}
                  aria-current={current ? 'step' : undefined}
                  className={cx(
                    'relative border-l-2 pl-3 transition-colors duration-300',
                    current ? 'border-accent' : 'border-transparent',
                    l.kind === 'say' && cx('font-display text-[17px] leading-[1.45] md:text-[18px]', current ? 'text-ink' : 'text-ink-2'),
                    l.kind === 'math' && cx('wb-tx-math overflow-x-auto overflow-y-hidden py-0.5 text-[17px] md:text-[18px]', current ? 'text-accent' : 'text-ink-2'),
                    l.kind === 'check' && cx('text-[15px] leading-[1.45]', current ? 'text-ink' : 'text-muted'),
                  )}
                >
                  {l.kind === 'check' && <span className="mr-1.5 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Question</span>}
                  <RichText text={l.text} />
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
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

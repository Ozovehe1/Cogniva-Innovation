'use client'
import 'katex/dist/katex.min.css'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, ChevronDown, ChevronLeft, ChevronRight, ListOrdered, Lock, Pause, Play, RotateCcw, Undo2, Volume2, VolumeX } from 'lucide-react'
import { BOARD_H, BOARD_W, boardIdsAfter, type CheckStep, type Ink, type ManimClipStep, type Step } from '@/lib/lesson-schema'
import { animMs, buildBoard, compactPartition, dwellMs, segmentStart, shapeBox, type Box } from './board-state'
import { BoardScale, EASE_SMOOTH, HighlightElement, ShapeElement, TextElement } from './elements'
import { CheckCard, RichText, type CheckResponse } from './check-card'
import { estimateSpeechMs, stepLines, stepSpeech } from './speech'
import { getNarrator, readSoundPref, writeSoundPref, type Narrator } from './narrator'
import { cx } from '@/components/ui'
import { chapterAt, estimateStepMs, formatDuration, type Chapter } from '@/lib/lesson-sections'

export type PlayerEvent =
  | { type: 'step'; index: number }
  | { type: 'check'; index: number; origIndex: number; stepId?: string; kind: CheckStep['kind']; response: CheckResponse; correct?: boolean; answer?: string }
  /** Where the student is, in original-script terms (inserted re-teach steps are not counted). */
  | { type: 'position'; cursor: number; section: number; furthest: number; total: number }
  | { type: 'restart'; scope: 'lesson' | 'section'; section: number }
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
  /** Sections of the script (see lesson-sections). Omitted = one section. */
  chapters?: Chapter[]
  /** Title used for the single section of a lesson without chapters. */
  title?: string
  /** Original indices of checks the student already answered (restored progress). */
  answered?: number[]
  /** Furthest original position reached before; students can jump to any section up to it. */
  furthest?: number
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
  chapters: chaptersProp,
  title,
  answered,
  furthest: furthestProp = 0,
}: WhiteboardPlayerProps) {
  const reduced = !!useReducedMotion()
  const [steps, setSteps] = useState<Step[]>(initialSteps)
  /** For each live step, its index in the original script (-1 = inserted re-teach step). */
  const [orig, setOrig] = useState<number[]>(() => initialSteps.map((_, i) => i))
  const [cursor, setCursor] = useState(() => Math.min(initialIndex, initialSteps.length))
  const [animIdx, setAnimIdx] = useState(-1)
  const [playId, setPlayId] = useState(0)
  const [playing, setPlaying] = useState(autoPlay)
  const [resolved, setResolved] = useState<Set<number>>(() => new Set((answered ?? []).filter(i => i >= 0 && i < initialSteps.length)))
  const [pendingCheck, setPendingCheck] = useState<number | null>(() => {
    const at = Math.min(initialIndex, initialSteps.length) - 1
    return at >= 0 && initialSteps[at]?.type === 'check' && !(answered ?? []).includes(at) ? at : null
  })
  const [clipIdx, setClipIdx] = useState<number | null>(null)
  const [thinking, setThinking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [started, setStarted] = useState(autoPlay)
  /** Restored position waiting for the student to choose how to continue. */
  const [resumeOffer, setResumeOffer] = useState(!autoPlay && initialIndex > 0)
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
    setOrig(initialSteps.map((_, i) => i))
    setCursor(0); setAnimIdx(-1); setPendingCheck(null); setClipIdx(null); setResolved(new Set())
    setPlaying(false); setStarted(false); setResumeOffer(false); completedRef.current = false
  }, [scriptKey, initialSteps])

  const board = useMemo(() => buildBoard(steps, cursor), [steps, cursor])

  /* ── Sections ── */
  const origTotal = initialSteps.length
  const chapters = useMemo<Chapter[]>(() => {
    const base = chaptersProp && chaptersProp.length ? chaptersProp : [{ title: title ?? 'Lesson', start: 0, count: origTotal }]
    // Map each section's original start to its live index (re-teach steps shift later sections).
    const liveOf = new Map<number, number>()
    orig.forEach((o, i) => { if (o >= 0 && !liveOf.has(o)) liveOf.set(o, i) })
    const starts = base.map(c => liveOf.get(c.start) ?? c.start)
    return base.map((c, k) => ({ ...c, start: starts[k], count: (k + 1 < base.length ? starts[k + 1] : steps.length) - starts[k] }))
  }, [chaptersProp, title, origTotal, orig, steps.length])
  const multi = chapters.length > 1
  const section = chapterAt(chapters, cursor - 1)
  const sectionStart = chapters[section]?.start ?? 0
  /** Original-script position for a live cursor: original steps done. */
  const origCursor = useCallback((c: number) => {
    for (let k = Math.min(c, orig.length) - 1; k >= 0; k--) if (orig[k] >= 0) return orig[k] + 1
    return 0
  }, [orig])
  /** Remaining time from each live index to the end. */
  const suffixMs = useMemo(() => {
    const out = new Array<number>(steps.length + 1).fill(0)
    for (let i = steps.length - 1; i >= 0; i--) out[i] = out[i + 1] + estimateStepMs(steps[i])
    return out
  }, [steps])
  const [furthest, setFurthest] = useState(() => Math.max(furthestProp, initialIndex))
  const furthestSection = chapterAt(chapters, Math.max(0, Math.max(furthest, origCursor(cursor)) - 1))

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
  const restart = () => {
    unlockVoice(); setStarted(true); setResumeOffer(false); completedRef.current = false
    setResolved(new Set())
    emit({ type: 'restart', scope: 'lesson', section: 0 })
    goTo(-1, false); setPlaying(true)
  }

  /** Put the cursor at the top of section k (board empty, nothing animating) and play. */
  const startSection = useCallback((k: number, why: 'section' | 'jump') => {
    const ch = chapters[Math.max(0, Math.min(k, chapters.length - 1))]
    if (!ch) return
    unlockVoice()
    setNotice(null)
    setStarted(true); setResumeOffer(false); completedRef.current = false
    const first = steps[ch.start]
    // Skip the section's opening full clear so the board starts empty without a stray animation.
    const at = first && first.type === 'clear' && !first.targets ? ch.start + 1 : ch.start
    // Checks in this section and after it are asked again.
    setResolved(r => new Set([...r].filter(i => i < ch.start)))
    setPendingCheck(null); setClipIdx(null)
    setCursor(at); setAnimIdx(-1); setPlayId(p => p + 1)
    setPlaying(true)
    if (why === 'section') emit({ type: 'restart', scope: 'section', section: k })
  }, [chapters, steps, unlockVoice, emit])

  /** Continue from the restored position: the board is already rebuilt silently up to it. */
  const continueResume = () => {
    unlockVoice()
    setResumeOffer(false)
    setStarted(true)
    setAnimIdx(-1)
    setPlaying(true)
  }

  // Report the position (original-script terms) whenever it changes.
  const oc = origCursor(cursor)
  useEffect(() => {
    if (!started) return
    setFurthest(f => Math.max(f, oc))
  }, [oc, started])
  useEffect(() => {
    if (!started) return
    emit({ type: 'position', cursor: oc, section, furthest: Math.max(furthest, oc), total: origTotal })
  }, [oc, section, started, furthest, origTotal, emit])

  /* ── Checks ── */
  const insertAfter = useCallback((index: number, extra: Step[]) => {
    const list = [...steps.slice(0, index + 1), ...extra, ...steps.slice(index + 1)]
    setSteps(list)
    setOrig(o => [...o.slice(0, index + 1), ...extra.map(() => -1), ...o.slice(index + 1)])
    // Shift resolved indices past the insertion point.
    setResolved(r => new Set([...r].map(i => (i > index ? i + extra.length : i))))
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
        // The board only depends on steps since the last full clear (each section starts with one).
        let from = 0
        for (let k = index; k >= 0; k--) { const st = steps[k]; if (st.type === 'clear' && !st.targets) { from = k; break } }
        const played = steps.slice(from, index + 1)
        const { ids, axes } = boardIdsAfter(played)
        extra = await onNeedSteps({ reason, check, checkIndex: played.length - 1, answer, played, boardIds: ids, boardAxes: axes })
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
    emit({ type: 'check', index, origIndex: Math.max(0, origCursor(index + 1) - 1), stepId: check.id, kind: check.kind, response, correct: detail?.correct, answer: detail?.answer })
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
  }, [pendingCheck, steps, emit, continueFrom, goTo, reteach, origCursor])

  /* ── Transcript ── */
  const lines = useMemo(() => steps.slice(sectionStart, cursor).flatMap((st, i) => stepLines(st, sectionStart + i)), [steps, cursor, sectionStart])
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

  const leftMs = suffixMs[Math.min(cursor, steps.length)] ?? 0
  const sectionTitle = chapters[section]?.title ?? ''
  const [showSections, setShowSections] = useState(false)
  const canJump = (k: number) => allowSkipChecks || k <= Math.max(furthestSection, section)
  const resumeLabel = (() => {
    if (!resumeOffer) return ''
    const inSection = Math.max(0, cursor - sectionStart)
    return multi ? `Section ${section + 1} of ${chapters.length} · ${sectionTitle}` : `Step ${inSection} of ${steps.length}`
  })()

  return (
    <div className={cx('w-full', className)}>
      {/* Section strip */}
      {(multi || steps.length > 40) && (
        <div className="mb-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            {multi && (
              <p className="tnum text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Section {section + 1} of {chapters.length}</p>
            )}
            {multi && <p className="mt-0.5 truncate font-display text-[19px] leading-snug text-ink md:text-[21px]">{sectionTitle}</p>}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            <span className="tnum hidden text-[13px] text-muted sm:inline">{atEnd ? 'Finished' : `${formatDuration(leftMs)} left`}</span>
            {multi && (
              <button
                type="button"
                onClick={() => setShowSections(v => !v)}
                aria-expanded={showSections}
                aria-controls="wb-sections"
                className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink"
              >
                <ListOrdered className="h-4 w-4" strokeWidth={1.75} />
                Sections
                <ChevronDown className={cx('h-3.5 w-3.5 transition-transform duration-200', showSections && 'rotate-180')} strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>
      )}
      {multi && showSections && (
        <nav id="wb-sections" aria-label="Lesson sections" className="mb-3 max-h-[320px] overflow-y-auto overscroll-contain rounded-[14px] border border-line bg-surface">
          <ol className="divide-y divide-line">
            {chapters.map((c, k) => {
              const done = k < section || (k === section && atEnd)
              const current = k === section && !atEnd
              const open = canJump(k)
              return (
                <li key={k}>
                  <button
                    type="button"
                    disabled={!open}
                    onClick={() => { startSection(k, 'jump'); setShowSections(false) }}
                    aria-current={current ? 'step' : undefined}
                    className={cx(
                      'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150',
                      open ? 'hover:bg-sunken' : 'cursor-not-allowed',
                      current && 'bg-accent-soft/60',
                    )}
                  >
                    <span className={cx(
                      'tnum flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-medium',
                      done ? 'bg-accent text-white' : current ? 'border border-accent text-accent' : 'border border-line text-muted',
                    )}>
                      {done ? <Check className="h-3.5 w-3.5" strokeWidth={2.25} /> : k + 1}
                    </span>
                    <span className={cx('min-w-0 flex-1 truncate text-[15px]', current ? 'font-medium text-ink' : open ? 'text-ink-2' : 'text-faint')}>{c.title}</span>
                    {!open && <Lock className="h-3.5 w-3.5 flex-shrink-0 text-faint" strokeWidth={1.75} aria-label="Not reached yet" />}
                    {c.ms ? <span className="tnum flex-shrink-0 text-[12px] text-muted">{formatDuration(c.ms)}</span> : null}
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>
      )}

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

          {/* Resume overlay: the board behind it is already rebuilt (silently) to where the student stopped. */}
          {resumeOffer && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#FDFCF9]/80 px-4 backdrop-blur-[2px]">
              <div className="w-full max-w-[420px] rounded-[14px] border border-line bg-surface p-5 text-center shadow-[var(--shadow-raised)] md:p-6">
                <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Welcome back</p>
                <p className="mt-1.5 font-display text-[20px] leading-snug text-ink md:text-[22px]">Pick up where you left off?</p>
                <p className="mt-1 truncate text-[13px] text-muted">{resumeLabel}</p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
                  <button type="button" onClick={continueResume} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 text-[15px] font-medium text-white transition-colors duration-150 hover:bg-accent-hover">
                    <Play className="h-4 w-4" fill="currentColor" strokeWidth={0} />
                    Continue where you left off
                  </button>
                  <button type="button" onClick={() => startSection(section, 'section')} className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-[15px] font-medium text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink">
                    Start section over
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Start overlay */}
          {!started && !resumeOffer && (
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
          <div className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-label="Lesson progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={cursor}>
            <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${progress * 100}%` }} transition={{ duration: reduced ? 0 : 0.4, ease: EASE_SMOOTH }} />
            {multi && chapters.slice(1).map((c, k) => (
              <span key={k} aria-hidden className="absolute top-0 h-full w-[2px] bg-[#FDFCF9]" style={{ left: `${(c.start / Math.max(1, steps.length)) * 100}%` }} />
            ))}
          </div>
          <span className="tnum hidden flex-shrink-0 text-[12px] text-muted sm:inline">{multi ? `${section + 1} / ${chapters.length}` : `${cursor} / ${steps.length}`}</span>
          {(multi || steps.length > 40) && <span className="tnum flex-shrink-0 text-[12px] text-muted sm:hidden">{atEnd ? 'Done' : formatDuration(leftMs).replace(' min', 'm').replace(' h', 'h')}</span>}
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
      <Transcript lines={lines} currentIdx={currentIdx} reduced={reduced} heading={multi ? `Section ${section + 1} · ${sectionTitle}` : undefined} />
    </div>
  )
}

function Transcript({ lines, currentIdx, reduced, heading }: { lines: ReturnType<typeof stepLines>; currentIdx: number; reduced: boolean; heading?: string }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const curRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    const box = boxRef.current, cur = curRef.current
    if (!box || !cur) return
    // The current lines are always the last ones: keep the end in view inside the
    // transcript box (never scroll the page), but don't push the current line's
    // start out of view when it is taller than the box.
    const scroll = () => {
      const end = box.scrollHeight - box.clientHeight
      const target = Math.max(0, Math.min(end, cur.offsetTop - 12))
      if (Math.abs(box.scrollTop - target) > 2) box.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' })
    }
    scroll()
    // KaTeX and fonts can change line heights after the first paint.
    const t = setTimeout(scroll, 250)
    return () => clearTimeout(t)
  }, [lines.length, currentIdx, reduced])
  const firstCurrent = lines.findIndex(l => l.index === currentIdx)
  return (
    <section className="mt-4 rounded-[14px] border border-line bg-surface" aria-label="Lesson transcript">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="min-w-0 truncate text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Transcript{heading ? <span className="normal-case tracking-normal text-faint"> · {heading}</span> : null}</h2>
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
                  <RichText text={l.text} display={l.kind === 'math'} />
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

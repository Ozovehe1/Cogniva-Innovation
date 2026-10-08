'use client'
import 'katex/dist/katex.min.css'
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, ChevronDown, ChevronLeft, ChevronRight, ListOrdered, Lock, Pause, Play, RotateCcw, Undo2, Volume2, VolumeX } from 'lucide-react'
import { BOARD_H, BOARD_W, boardIdsAfter, type CheckStep, type ManimClipStep, type Step } from '@/lib/lesson-schema'
import { applyAction, buildBoard, compactPartition, segmentStart, shapeBox, type BoardState, type Box } from './board-state'
import { BoardScale, EASE_SMOOTH, FxWrap, HighlightElement, ShapeElement, TextElement, type NoteMarkSpec } from './elements'
import { CheckCard, RichText, type CheckResponse } from './check-card'
import { estimateSpeechMs, stepLines, stepSpeech } from './speech'
import { NATURAL_VOICE_WAIT_MS, getNarrator, readSoundPref, writeSoundPref, type Narrator } from './narrator'
import { PEN_ACTIONS, PEN_PREROLL_MS, buildTimeline, firedAt, varsAt, type StepTimeline } from './timeline'
import { VarStore, VarsContext } from './live-vars'
import { InkGuard } from './ink-guard'
import { HandOverlay, PenProvider, usePenEngine, type PenCue, type PenEngine } from './pen'
import { followClip, loadPenPaths } from './clip-pen'
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

/** Warm the browser cache with a rendered clip before its step (once per URL per page). */
const prefetchedClips = new Set<string>()
function prefetchClip(url: string) {
  if (typeof window === 'undefined' || prefetchedClips.has(url)) return
  prefetchedClips.add(url)
  void fetch(url, { cache: 'force-cache' }).catch(() => { prefetchedClips.delete(url) })
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
  /** A second tab beside the transcript. */
  transcriptAside?: TranscriptAside
  /** Imperative control for the lesson session (check-ins: pause, insert a worked example). */
  controlRef?: React.MutableRefObject<PlayerControl | null>
  /** Slower pacing: longer pauses between steps (after a low check-in). */
  slow?: boolean
  /**
   * Lesson video recording (the /render/lesson page): no controls, sections strip or transcript; checks are shown on
   * the board, given a moment to think, answered by themselves and the lesson carries on; clips have no Skip.
   */
  renderMode?: boolean
}

export interface PlayerControl {
  pause: () => void
  resume: () => void
  /** Insert steps right after the current position and play them. False when a check is waiting. */
  insertNow: (extra: Step[]) => boolean
  /** Steps on the board since the last full clear, up to the current position. */
  played: () => Step[]
  isPlaying: () => boolean
}

export interface TranscriptAside { label: string; count?: number; content: React.ReactNode }

/** Below this container width the board switches to the phone layout. */
const COMPACT_W = 600

const noSubscribe = () => () => {}

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
  transcriptAside,
  controlRef,
  slow = false,
  renderMode = false,
}: WhiteboardPlayerProps) {
  const reduced = !!useReducedMotion()
  const [steps, setSteps] = useState<Step[]>(initialSteps)
  /** For each live step, its index in the original script (-1 = inserted re-teach step). */
  const [orig, setOrig] = useState<number[]>(() => initialSteps.map((_, i) => i))
  const [cursor, setCursor] = useState(() => Math.min(initialIndex, initialSteps.length))
  const [animIdx, setAnimIdx] = useState(-1)
  const [playId, setPlayId] = useState(0)
  /** Play ids come from one counter, so each animation of a step gets its own. */
  const playSeq = useRef(0)
  /** The play in which each step was last animated: the React key of what it drew, so a written element keeps its
   *  node when its step ends (no second copy fading out over it) and is drawn afresh when the step is replayed. */
  const [playOf, setPlayOf] = useState<Record<number, number>>({})
  const [playing, setPlaying] = useState(autoPlay)
  const [resolved, setResolved] = useState<Set<number>>(() => new Set((answered ?? []).filter(i => i >= 0 && i < initialSteps.length)))
  const [pendingCheck, setPendingCheck] = useState<number | null>(() => {
    const at = Math.min(initialIndex, initialSteps.length) - 1
    return at >= 0 && initialSteps[at]?.type === 'check' && !(answered ?? []).includes(at) ? at : null
  })
  const [clipIdx, setClipIdx] = useState<number | null>(null)
  /** The clip's video reached its end (it closes once its narration has finished too). */
  const [clipEnded, setClipEnded] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [started, setStarted] = useState(autoPlay)
  /** Restored position waiting for the student to choose how to continue. */
  const [resumeOffer, setResumeOffer] = useState(!autoPlay && initialIndex > 0)
  const completedRef = useRef(false)
  /** Playback reached the end of a script that may still grow. */
  const waitingAtEndRef = useRef(false)
  const onEventRef = useRef(onEvent)
  useEffect(() => { onEventRef.current = onEvent }, [onEvent])
  const emit = useCallback((e: PlayerEvent) => onEventRef.current?.(e), [])

  // Reset when a new script is passed in (e.g. tutor regenerates). A script that only grew at the end
  // (later sections of a lesson that is still being written) is appended in place: playback carries on.
  const scriptKey = useMemo(() => JSON.stringify(initialSteps).length + ':' + initialSteps.length, [initialSteps])
  const lastKey = useRef(scriptKey)
  const lastScript = useRef(initialSteps)
  useEffect(() => {
    if (lastKey.current === scriptKey) return
    lastKey.current = scriptKey
    const prev = lastScript.current
    lastScript.current = initialSteps
    if (prev.length > 0 && initialSteps.length > prev.length && JSON.stringify(initialSteps.slice(0, prev.length)) === JSON.stringify(prev)) {
      const tail = initialSteps.slice(prev.length)
      setSteps(cur => [...cur, ...tail])
      setOrig(cur => [...cur, ...tail.map((_, k) => prev.length + k)])
      // The learner reached the end of what was written: continue straight into the new section.
      if (completedRef.current || waitingAtEndRef.current) { completedRef.current = false; waitingAtEndRef.current = false; setPlaying(true) }
      return
    }
    setSteps(initialSteps)
    setOrig(initialSteps.map((_, i) => i))
    setCursor(0); setAnimIdx(-1); setPendingCheck(null); setClipIdx(null); setResolved(new Set())
    setPlaying(false); setStarted(false); setResumeOffer(false); completedRef.current = false
  }, [scriptKey, initialSteps])

  /* ── Narration-timed playback of the current step ── */
  /** Timeline of the step being played (animIdx), once its narration timing is known. */
  const [tl, setTl] = useState<(StepTimeline & { index: number; play: number }) | null>(null)
  /** How many of its actions have fired so far (for the play it belongs to). */
  const [firedState, setFiredState] = useState({ play: -1, n: 0 })
  const fired = firedState.play === playId ? firedState.n : 0
  /** playId whose step has finished (narration + motion). */
  const [doneId, setDoneId] = useState(-1)
  /** The student paused mid-step: the narration clock is frozen. */
  const [hold, setHold] = useState(false)
  const varStore = useMemo(() => new VarStore(), [])
  const liveStep = animIdx >= 0 && animIdx === cursor - 1
  const before = useMemo<BoardState | null>(() => (liveStep ? buildBoard(steps, animIdx) : null), [liveStep, steps, animIdx])
  const board = useMemo(() => {
    if (!liveStep || !before) return buildBoard(steps, cursor)
    const t = tl && tl.index === animIdx && tl.play === playId ? tl : null
    const acts = t ? t.actions.slice(0, fired) : []
    if (t && fired >= t.actions.length) return buildBoard(steps, cursor)
    let b = before
    for (const a of acts) b = applyAction(b, a.action, animIdx, a.k)
    return b
  }, [liveStep, before, steps, cursor, tl, animIdx, playId, fired])
  /** Duration (ms) of each action of the live step, keyed "<step>.<k>". */
  const durs = useMemo(() => {
    const m = new Map<string, number>()
    if (tl && tl.index === animIdx && tl.play === playId) for (const a of tl.actions) m.set(a.key, a.dur)
    return m
  }, [tl, animIdx, playId])
  /** Cue (start on the narration clock) of each action of the live step. */
  const cues = useMemo(() => {
    const m = new Map<string, PenCue>()
    if (tl && tl.index === animIdx && tl.play === playId) for (const a of tl.actions) if (PEN_ACTIONS.has(a.action.type)) m.set(a.key, { at: a.start, dur: a.dur, epoch: playId })
    return m
  }, [tl, animIdx, playId])

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
  const chaptersRef = useRef<Chapter[]>(chapters)
  useEffect(() => { chaptersRef.current = chapters }, [chapters])
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
    for (let i = steps.length - 1; i >= 0; i--) out[i] = out[i + 1] + estimateStepMs(steps[i], i)
    return out
  }, [steps])
  const [furthest, setFurthest] = useState(() => Math.max(furthestProp, initialIndex))
  const furthestSection = chapterAt(chapters, Math.max(0, Math.max(furthest, origCursor(cursor)) - 1))

  /* ── Scaling ── */
  const outerRef = useRef<HTMLDivElement | null>(null)
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
    setClipEnded(false)
  }, [])

  /** Show steps[0..i] with step i animating (or static). */
  const goTo = useCallback((i: number, animate: boolean, list: Step[] = steps) => {
    setNotice(null)
    setHold(false)
    if (i < 0) { setCursor(0); setAnimIdx(-1); setPendingCheck(null); setClipIdx(null); setPlayId(++playSeq.current); return }
    const idx = Math.min(i, list.length - 1)
    setCursor(idx + 1)
    setAnimIdx(animate ? idx : -1)
    const id = ++playSeq.current
    setPlayId(id)
    if (animate) setPlayOf(m => ({ ...m, [idx]: id }))
    blockersFor(idx, list)
    if (animate) emit({ type: 'step', index: idx })
  }, [steps, blockersFor, emit])

  // A clip closes only when its video and its narration have both finished (nothing is cut short).
  const clipOpen = clipIdx !== null && !(clipEnded && !(animIdx === clipIdx && doneId !== playId && started))
  const blocked = pendingCheck !== null || clipOpen || thinking

  /** The pen that writes on the board and moves the hand (see ./pen). */
  const pen = usePenEngine()

  /* ── Voice ── */
  const narratorRef = useRef<Narrator | null>(null)
  const voiceOk = useSyncExternalStore(noSubscribe, () => getNarrator().supported, () => false)
  const soundPref = useSyncExternalStore(noSubscribe, readSoundPref, () => true)
  const [soundChoice, setSoundOn] = useState<boolean | null>(null)
  const soundOn = soundChoice ?? soundPref
  const unlocked = useRef(false)
  const stepsRef = useRef(steps)
  useEffect(() => { stepsRef.current = steps }, [steps])
  useEffect(() => {
    const n = getNarrator()
    narratorRef.current = n
    return () => n.cancel()
  }, [])
  const voiceOn = voiceOk && soundOn
  /** What voiced the last line: the natural (Kokoro) voice or the device's speech engine. */
  const [voiceSource, setVoiceSource] = useState<'audio' | 'device' | null>(null)
  const [fallbackReason, setFallbackReason] = useState<string | null>(null)
  /**
   * The first lines' natural audio is fetched (and the voice service woken) as soon
   * as the player mounts; Start waits for the opening line so the lesson never opens
   * on the device voice while natural audio is still on its way.
   */
  const [voicePrep, setVoicePrep] = useState<'idle' | 'preparing' | 'ready' | 'failed'>('idle')
  const preloadRef = useRef<((i: number) => void) | null>(null)
  useEffect(() => {
    const n = narratorRef.current
    if (!n || !voiceOn || started) return
    n.warm?.()
    const at = Math.max(0, Math.min(initialIndex, initialSteps.length - 1))
    const texts: string[] = []
    for (let k = at; k < initialSteps.length && texts.length < 6; k++) {
      const t = stepSpeech(initialSteps[k])
      if (t) texts.push(t)
    }
    if (!texts.length || !n.prepare) { setVoicePrep('ready'); return }
    n.preload?.(texts)
    let live = true
    setVoicePrep('preparing')
    void n.prepare(texts[0], NATURAL_VOICE_WAIT_MS).then(t => {
      if (live) setVoicePrep(t ? 'ready' : 'failed')
      // Then the rest of this section and the next one, while the learner reads the page.
      if (t) preloadRef.current?.(at)
    })
    return () => { live = false }
    // Runs once per script and voice setting, before the lesson starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceOn, scriptKey])
  const preparingVoice = voicePrep === 'preparing' && !started
  const voiceOnRef = useRef(voiceOn)
  useEffect(() => { voiceOnRef.current = voiceOn }, [voiceOn])
  const holdRef = useRef(hold)
  useEffect(() => { holdRef.current = hold }, [hold])
  const reducedRef = useRef(reduced)
  useEffect(() => { reducedRef.current = reduced }, [reduced])
  const boardEl = useRef<HTMLDivElement | null>(null)
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
  // Fetch narration (audio + word timings) and rendered clips ahead: the rest of this section and all
  // of the next one, so a section boundary never waits on the network. Already-fetched lines are free.
  const preloadFrom = useCallback((i: number) => {
    const list = stepsRef.current
    const ch = chaptersRef.current
    const k0 = chapterAt(ch, Math.max(0, i))
    const nextCh = ch[k0 + 1]
    const end = Math.min(list.length, nextCh ? nextCh.start + nextCh.count : list.length, Math.max(0, i) + 160)
    const texts: string[] = []
    const clips: string[] = []
    for (let k = Math.max(0, i); k < end; k++) {
      const st = list[k]
      const t = stepSpeech(st)
      if (t) texts.push(t)
      if (st.type === 'check' && st.reteach) for (const r of st.reteach) { const rt = stepSpeech(r); if (rt) texts.push(rt) }
      if (st.type === 'manim_clip') clips.push(st.url)
    }
    const n = narratorRef.current
    // Nearest lines first: the narrator resolves them in order.
    if (n?.preload && voiceOnRef.current) n.preload(texts)
    for (const url of clips) prefetchClip(url)
  }, [])
  useEffect(() => { preloadRef.current = preloadFrom }, [preloadFrom])

  /**
   * Play the step that just started (animIdx): get its narration timing (real word
   * timings from the cached voice, or an estimate), place its actions on that
   * clock, start the voice, then fire each action as its cue word is spoken and
   * drive animated variables every frame. Nothing waits on fixed delays.
   */
  useEffect(() => {
    const n = narratorRef.current
    if (animIdx < 0 || !started) { n?.cancel(); pen.setClock(null); return }
    const step = stepsRef.current[animIdx]
    if (!step) return
    const id = playId
    const index = animIdx
    let cancelled = false
    let raf = 0
    let speakTimer: ReturnType<typeof setTimeout> | undefined
    const text = stepSpeech(step)
    const voiced = !!(n && voiceOnRef.current && text)
    preloadFrom(index + 1)
    void (async () => {
      n?.cancel()
      // Wait for the natural voice (generously); the device voice is only a fallback after a real failure.
      const timing = voiced && n?.prepare ? await n.prepare(text, NATURAL_VOICE_WAIT_MS) : null
      if (cancelled) return
      const t = buildTimeline(step, index, timing, { reduced: reducedRef.current })
      const startVars = buildBoard(stepsRef.current, index).vars
      // When the step opens with drawing, the clock starts a moment before the voice so the hand is already on its
      // first stroke when the first word is spoken.
      const firstPen = t.actions.find(a => PEN_ACTIONS.has(a.action.type))
      const lead = !reducedRef.current && firstPen && firstPen.start < PEN_PREROLL_MS ? PEN_PREROLL_MS - firstPen.start : 0
      let speaking = false
      let voiceStarted = !voiced
      // The step's master clock (ms from the first word). While the natural voice plays it IS the audio's own
      // position, so a stall in the audio stops the drawing and the hand with it; otherwise it runs on the wall clock.
      const clk = { base: -lead, since: performance.now(), last: -Infinity, lastPos: -1 }
      const audioPos = () => (speaking && n?.source === 'audio' ? n.position?.() ?? -1 : -1)
      const clockNow = () => {
        const w = performance.now()
        let now: number
        if (holdRef.current) { clk.since = w; now = clk.base }
        else {
          const pos = audioPos()
          if (pos >= 0) {
            // Follow the audio. Its reported position can move in coarse steps, so between updates the clock runs on
            // from the last one, but only while the audio is really advancing: loading, a stall or a pause stops it.
            if (pos !== clk.lastPos) { clk.lastPos = pos; clk.base = pos; clk.since = w }
            if (n?.advancing?.()) now = clk.base + Math.min(w - clk.since, 400)
            else { clk.since = w; now = clk.base }
          } else {
            now = clk.base + (w - clk.since)
            // Before the voice starts the clock waits for it at 0.
            if (!voiceStarted || (speaking && n?.source === 'audio')) now = Math.min(now, 0)
          }
        }
        // Monotonic within a play (a late audio report never winds the drawing back).
        if (now < clk.last && !holdRef.current) now = clk.last
        clk.last = now
        return now
      }
      pen.setClock({ epoch: id, now: clockNow, audio: audioPos })
      setTl({ ...t, index, play: id })
      const begin = () => {
        if (cancelled) return
        voiceStarted = true
        if (voiced && n) {
          // The clock now continues from the voice's own position.
          clk.base = 0; clk.since = performance.now()
          speaking = true
          n.speak(text, () => {
            // Carry on from where the audio ended on the wall clock.
            clk.base = clk.last; clk.since = performance.now(); speaking = false
          })
          setVoiceSource(n.source ?? null)
          setFallbackReason(n.source === 'device' ? (n.fallbackReason ?? null) : null)
        }
      }
      if (lead > 0 && voiced) speakTimer = setTimeout(begin, lead)
      else begin()
      let lastFired = -1
      const cap = t.total + (voiced ? Math.max(4000, estimateSpeechMs(text) * 0.6) : 0)
      const frame = () => {
        if (cancelled) return
        const now = clockNow()
        const f = firedAt(t, now, reducedRef.current ? 0 : PEN_PREROLL_MS)
        if (f !== lastFired) { lastFired = f; setFiredState({ play: id, n: f }) }
        varStore.set(varsAt(t, startVars, now))
        const node = boardEl.current
        if (node) { node.dataset.clock = String(Math.round(now)); node.dataset.voice = speaking ? (n?.source ?? 'none') : node.dataset.voice ?? 'none' }
        // Done when the motion and the narration are both finished (cap guards a voice that never reports its end).
        if ((now >= t.total && !speaking && voiceStarted) || now >= cap) {
          setFiredState({ play: id, n: t.actions.length })
          setDoneId(id)
          return
        }
        raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)
    })().catch(err => console.error('whiteboard step failed', err))
    return () => { cancelled = true; cancelAnimationFrame(raf); clearTimeout(speakTimer) }
  }, [playId, animIdx, started, varStore, preloadFrom, pen])
  // Voice turned on/off mid-step only affects later steps; turning it off silences now.
  // Pause and resume narration with the player.
  useEffect(() => {
    const n = narratorRef.current
    if (!n) return
    if (hold) n.pause()
    else n.resume()
  }, [hold])


  // Auto-advance: the next step starts when this one's narration and motion are done.
  useEffect(() => {
    if (!playing || blocked || hold) return
    if (cursor >= steps.length) {
      if (animIdx === cursor - 1 && doneId !== playId && animIdx >= 0) return
      // Stays "playing": steps appended later (sections still being written) carry straight on.
      if (started) waitingAtEndRef.current = true
      if (!completedRef.current && steps.length) { completedRef.current = true; emit({ type: 'complete' }) }
      return
    }
    let wait: number
    if (cursor === 0) wait = 40
    else if (animIdx === cursor - 1) {
      if (doneId !== playId) return
      wait = slow ? 900 : 40
    } else wait = slow ? 900 : 40
    const t = setTimeout(() => goTo(cursor, true), wait)
    return () => clearTimeout(t)
  }, [playing, blocked, hold, cursor, steps, animIdx, playId, doneId, goTo, emit, slow, started])

  const togglePlay = () => {
    unlockVoice()
    setStarted(true)
    if (cursor >= steps.length && !blocked && !(animIdx === cursor - 1 && doneId !== playId)) { setHold(false); goTo(-1, false); completedRef.current = false; setPlaying(true); return }
    if (playing && !hold) { setPlaying(false); setHold(animIdx === cursor - 1 && doneId !== playId); return }
    setHold(false)
    setPlaying(true)
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
    setCursor(at); setAnimIdx(-1); setPlayId(++playSeq.current)
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
  if (started && oc > furthest) setFurthest(oc)
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

  // Imperative handle for check-ins (refreshed every render so it always sees current state).
  useEffect(() => {
    if (!controlRef) return
    controlRef.current = {
      pause: () => { if (playing) { setPlaying(false); setHold(animIdx === cursor - 1 && doneId !== playId) } },
      resume: () => { setHold(false); setStarted(true); setPlaying(true) },
      insertNow: (extra: Step[]) => {
        if (pendingCheck !== null || !extra.length || cursor < 1) return false
        insertAfter(cursor - 1, extra)
        setHold(false); setStarted(true); setPlaying(true)
        return true
      },
      played: () => {
        let from = 0
        for (let k = Math.min(cursor, steps.length) - 1; k >= 0; k--) { const st = steps[k]; if (st.type === 'clear' && !st.targets) { from = k; break } }
        return steps.slice(from, cursor)
      },
      isPlaying: () => playing && !hold,
    }
  })

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

  /* ── Checks in a recorded video: shown on the board, a pause to think, the answer, then on ── */
  const [revealFor, setRevealFor] = useState<number | null>(null)
  const onCheckRef = useRef(onCheck)
  useEffect(() => { onCheckRef.current = onCheck }, [onCheck])
  const checkSpoken = pendingCheck !== null && !(animIdx === pendingCheck && doneId !== playId)
  useEffect(() => {
    if (!renderMode || pendingCheck === null || !checkSpoken) return
    const st = stepsRef.current[pendingCheck]
    if (st?.type !== 'check') return
    const answer = checkAnswerText(st)
    const at = pendingCheck
    const t1 = answer ? setTimeout(() => setRevealFor(at), RENDER_THINK_MS) : undefined
    const t2 = setTimeout(() => onCheckRef.current('continue'), RENDER_THINK_MS + (answer ? RENDER_REVEAL_MS + Math.min(4000, (st.explanation?.length ?? 0) * 35) : 0))
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [renderMode, pendingCheck, checkSpoken])

  /* ── Transcript ── */
  const lines = useMemo(() => steps.slice(sectionStart, cursor).flatMap((st, i) => stepLines(st, sectionStart + i)), [steps, cursor, sectionStart])
  const currentIdx = lines.length ? lines[lines.length - 1].index : -1

  const clip = clipOpen && clipIdx !== null ? (steps[clipIdx] as ManimClipStep) : null
  const check = pendingCheck !== null ? (steps[pendingCheck] as CheckStep) : null
  const progress = steps.length ? cursor / steps.length : 0
  const atEnd = cursor >= steps.length && !blocked

  // Highlights on reflowed notes are drawn by the note itself (phone layout).
  const noteMarks = useMemo(() => {
    const m = new Map<string, NoteMarkSpec>()
    if (!layout) return m
    for (const el of board.els) {
      if (el.kind === 'highlight' && noteIds.has(el.target)) {
        m.set(el.target, { style: el.style, color: el.color, fresh: el.born === animIdx, cue: el.born === animIdx ? cues.get(el.act) ?? null : null })
      }
    }
    return m
  }, [layout, board, noteIds, animIdx, cues])

  const elKey = (el: { key: string; born: number }) => `${el.key}#${playOf[el.born] ?? 0}`
  const textKey = (el: { key: string; morphAct?: string; born: number }) =>
    el.morphAct !== undefined ? `${el.key}~${el.morphAct}` : elKey(el)
  /** The narration cue an element being drawn now is inked on (null: shown as it is). */
  const cueOf = (el: { act: string; born: number }) => (el.born === animIdx ? cues.get(el.act) ?? null : null)
  /** The cue an element's InkGuard holds it hidden for (none with reduced motion: everything is shown as it is). */
  const guardCue = (c: PenCue | null) => (reduced ? null : c)
  const animOf = (el: { morphedAt?: number; born: number }) =>
    el.morphedAt === animIdx && animIdx >= 0 ? 'morph' as const : el.born === animIdx ? 'enter' as const : null

  // Camera (zoom / pan) as a transform around the centre of the visible area.
  const cam = board.camera
  const camMs = cam ? durs.get(cam.act) ?? 1100 : 900
  const focus = layout?.region ? { x: layout.region.x + layout.region.w / 2, y: layout.region.y + layout.region.h / 2 } : { x: BOARD_W / 2, y: BOARD_H / 2 }
  const camTransform = cam ? `translate(${focus.x}px, ${focus.y}px) scale(${cam.zoom}) translate(${-cam.cx}px, ${-cam.cy}px)` : 'none'
  const durOf = (act: string, born: number) => (born === animIdx ? durs.get(act) : undefined)

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
      <div
        className="absolute left-0 top-0"
        style={{
          width: BOARD_W,
          height: BOARD_H,
          transformOrigin: '0 0',
          transform: camTransform,
          transition: reduced ? undefined : `transform ${camMs}ms cubic-bezier(0.65, 0, 0.35, 1)`,
        }}
      >
      <svg
        viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
        width={BOARD_W}
        height={BOARD_H}
        className="absolute inset-0 overflow-visible"
        aria-hidden
        shapeRendering="geometricPrecision"
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
                <motion.g key={elKey(el)} exit={{ opacity: 0, transition: { duration: reduced ? 0.01 : 0.35 } }}>
                  <FxWrap fx={el.fx} ms={el.fx ? durs.get(el.fx.act) ?? 0 : 0} reduced={reduced} svg>
                    <InkGuard svg cue={guardCue(cueOf(el))} tag={`shape:${el.key}`}>
                      <ShapeElement el={el} animate={anim} reduced={reduced} duration={durOf(el.act, el.born)} vars={board.vars} />
                    </InkGuard>
                  </FxWrap>
                </motion.g>
              )
            }
            if (el.kind === 'highlight') {
              if (noteIds.has(el.target)) return null
              const anim = el.born === animIdx
              return (
                <motion.g key={elKey(el)} exit={{ opacity: 0, transition: { duration: 0.25 } }}>
                  <InkGuard svg cue={guardCue(cueOf(el))} tag={`highlight:${el.target}`}>
                    <HighlightElement el={el} animate={anim} reduced={reduced} measure={measure} duration={durOf(el.act, el.born)} />
                  </InkGuard>
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
          const d = animate === 'morph' ? durs.get(el.morphAct ?? '') : durOf(el.act, el.born)
          const node = (
            <InkGuard cue={animate === 'enter' ? guardCue(cueOf(el)) : null} tag={`text:${el.key}`}>
              <TextElement el={el} animate={animate} reduced={reduced} registerRef={registerRef} duration={d} vars={board.vars} />
            </InkGuard>
          )
          return el.fx
            ? <FxWrap key={textKey(el)} fx={el.fx} ms={durs.get(el.fx.act) ?? 0} reduced={reduced}>{node}</FxWrap>
            : <React.Fragment key={textKey(el)}>{node}</React.Fragment>
        })}
      </AnimatePresence>
      </div>
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
      {!renderMode && (multi || steps.length > 40) && (
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
      {!renderMode && multi && showSections && (
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
                    <span className={cx('min-w-0 flex-1 truncate text-[15px]', current ? 'font-medium text-ink' : open ? 'text-ink-2' : 'text-faint')}><RichText text={c.title} /></span>
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
      <PenProvider pen={pen}>
      <VarsContext.Provider value={varStore}>
      <BoardScale.Provider value={scale || 1}>
        <div className="relative">
        <div
          ref={node => { outerRef.current = node; boardEl.current = node }}
          className={cx(
            'wb-board relative w-full overflow-hidden rounded-[14px] border border-line bg-[#FDFCF9] shadow-[var(--shadow-card)]',
            layout && 'min-h-[220px]',
            layout && clip && 'min-h-[260px]',
          )}
          style={layout ? undefined : { aspectRatio: `${BOARD_W} / ${BOARD_H}` }}
          data-layout={layout ? 'compact' : 'wide'}
          data-step={animIdx}
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
                        <InkGuard key={textKey(el)} cue={animate === 'enter' ? guardCue(cueOf(el)) : null} tag={`note:${el.key}`}>
                        <TextElement
                          el={el}
                          animate={animate}
                          reduced={reduced}
                          registerRef={registerRef}
                          flow
                          mark={el.id ? noteMarks.get(el.id) ?? null : null}
                          duration={animate === 'morph' ? durs.get(el.morphAct ?? '') : durOf(el.act, el.born)}
                          vars={board.vars}
                        />
                        </InkGuard>
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
                  pen={pen}
                  handOn={!reduced}
                  recording={renderMode}
                  onDone={() => { setClipEnded(true); setPlaying(true) }}
                  onSkip={() => { narratorRef.current?.cancel(); setClipEnded(false); setClipIdx(null); setPlaying(true) }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Recorded video: the check on the board, then its answer; and each section's title as it begins. */}
          {renderMode && check && pendingCheck !== null && <RecordedCheck key={`rc-${pendingCheck}-${playId}`} step={check} reveal={revealFor === pendingCheck} />}
          {renderMode && multi && sectionTitle && (
            <motion.div
              key={`sec-${section}`}
              className="pointer-events-none absolute bottom-5 left-5 z-[12] max-w-[70%] rounded-[12px] border border-line bg-surface/95 px-4 py-2.5 shadow-[var(--shadow-raised)]"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: [0, 1, 1, 0], y: [6, 0, 0, 0] }}
              transition={{ duration: 4.2, times: [0, 0.08, 0.85, 1] }}
            >
              <p className="tnum text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Section {section + 1} of {chapters.length}</p>
              <p className="mt-0.5 font-display text-[19px] leading-snug text-ink"><RichText text={sectionTitle} /></p>
            </motion.div>
          )}

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
              disabled={preparingVoice}
              aria-busy={preparingVoice}
              data-voice-prep={voicePrep}
              className="group absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#FDFCF9]/70 backdrop-blur-[1px] disabled:cursor-wait"
              aria-label={preparingVoice ? 'Preparing voice' : 'Start lesson'}
            >
              <span className={cx(
                'inline-flex h-12 items-center gap-2.5 rounded-full px-6 text-[15px] font-medium shadow-[var(--shadow-raised)] transition-all duration-300',
                preparingVoice ? 'bg-surface text-muted' : 'bg-accent text-white group-hover:scale-[1.02]',
              )}>
                {preparingVoice
                  ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent motion-reduce:animate-none" aria-hidden />
                  : <Play className="h-4 w-4" fill="currentColor" strokeWidth={0} />}
                {preparingVoice ? 'Preparing voice…' : 'Start lesson'}
              </span>
              {voicePrep === 'failed' && <span className="text-[12px] text-muted">Natural voice unavailable · the device voice will read this lesson</span>}
            </button>
          )}
        </div>
        {/* The hand holding the marker, over the board and reaching above its top edge so the arm is never cut off
            there (hidden with reduced motion: writing then appears at once). */}
        <HandOverlay pen={pen} hidden={reduced} />
        </div>
      </BoardScale.Provider>
      </VarsContext.Provider>
      </PenProvider>

      {/* Controls */}
      {!renderMode && <>
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
            aria-label={soundOn ? `Voice on${voiceSource === 'audio' ? ' (natural voice)' : voiceSource === 'device' ? ' (device voice)' : ''}. Turn voice off` : 'Voice off. Turn voice on'}
            title={soundOn ? (voiceSource === 'audio' ? 'Voice on · natural voice' : voiceSource === 'device' ? `Voice on · device voice${fallbackReason ? ` (natural voice ${fallbackReason})` : ''}` : 'Voice on') : 'Voice off'}
            data-voice-fallback={fallbackReason ?? undefined}
            data-voice-source={voiceSource ?? 'none'}
            className={cx(
              'flex h-10 flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium transition-colors duration-150 sm:px-3',
              soundOn ? 'text-accent hover:bg-accent-soft' : 'text-muted hover:bg-sunken hover:text-ink',
            )}
          >
            {soundOn ? <Volume2 className="h-[18px] w-[18px]" strokeWidth={1.75} /> : <VolumeX className="h-[18px] w-[18px]" strokeWidth={1.75} />}
            <span className={cx(voiceSource === 'device' && soundOn ? 'inline' : 'hidden sm:inline')}>{soundOn ? (voiceSource === 'audio' ? 'Natural voice' : voiceSource === 'device' ? 'Device voice' : preparingVoice ? 'Preparing…' : 'Voice on') : 'Voice off'}</span>
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
      <Transcript lines={lines} currentIdx={currentIdx} reduced={reduced} heading={multi ? `Section ${section + 1} · ${sectionTitle}` : undefined} aside={transcriptAside} />
      </>}
    </div>
  )
}

function Transcript({ lines, currentIdx, reduced, heading, aside }: { lines: ReturnType<typeof stepLines>; currentIdx: number; reduced: boolean; heading?: string; aside?: TranscriptAside }) {
  const [tab, setTab] = useState<'transcript' | 'aside'>('transcript')
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
  }, [lines.length, currentIdx, reduced, tab])
  const firstCurrent = lines.findIndex(l => l.index === currentIdx)
  return (
    <section className="mt-4 rounded-[14px] border border-line bg-surface" aria-label="Lesson transcript">
      {aside ? (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4" role="tablist" aria-label="Lesson panels">
          <div className="flex min-w-0 items-center gap-5">
            {(['transcript', 'aside'] as const).map(t => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cx('-mb-px flex h-10 items-center gap-1.5 border-b-2 text-[12px] font-medium uppercase tracking-[0.08em] transition-colors', tab === t ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')}
              >
                {t === 'transcript' ? 'Transcript' : aside.label}
                {t === 'aside' && aside.count ? <span className="tnum rounded-full bg-sunken px-1.5 text-[11px] tracking-normal text-ink-2">{aside.count}</span> : null}
              </button>
            ))}
          </div>
          {tab === 'transcript' && heading && <span className="hidden min-w-0 truncate text-[12px] text-faint sm:block">{heading}</span>}
        </div>
      ) : (
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="min-w-0 truncate text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Transcript{heading ? <span className="normal-case tracking-normal text-faint"> · {heading}</span> : null}</h2>
          {lines.length > 0 && <span className="tnum text-[12px] text-muted">{lines.filter(l => l.kind === 'say').length} lines</span>}
        </div>
      )}
      {aside && tab === 'aside' && <div role="tabpanel" className="max-h-[300px] overflow-y-auto overscroll-contain px-4 py-3 md:max-h-[340px]">{aside.content}</div>}
      <div ref={boxRef} hidden={!!aside && tab === 'aside'} className="wb-transcript relative max-h-[240px] overflow-y-auto overscroll-contain px-4 py-3 md:max-h-[300px]" tabIndex={0}>
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

function ClipVideo({ step, onDone, onSkip, pen, handOn, recording = false }: { step: ManimClipStep; onDone: () => void; onSkip: () => void; pen: PenEngine; handOn: boolean; recording?: boolean }) {
  const [failed, setFailed] = useState(false)
  // A recorded video never waits on a button: a clip that cannot load is passed over.
  useEffect(() => {
    if (!recording || !failed) return
    const t = setTimeout(onDone, 1200)
    return () => clearTimeout(t)
  }, [recording, failed, onDone])
  const videoRef = useRef<HTMLVideoElement>(null)
  // The hand draws along with the clip when the clip comes with its pen paths (and keeps the clip on the narration clock).
  useEffect(() => {
    const video = videoRef.current
    if (!video || !handOn) return
    let stop: (() => void) | null = null
    let live = true
    void loadPenPaths(step.url).then(paths => { if (live && paths && paths.strokes.length) stop = followClip(pen, video, paths) })
    return () => { live = false; stop?.() }
  }, [step.url, pen, handOn])
  return (
    <>
      <div className="relative min-h-0 flex-1">
        {failed ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-white/70">This animation could not be loaded.</div>
        ) : (
          <video
            ref={videoRef}
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
        {!recording && (
          <button type="button" onClick={failed ? onDone : onSkip} className="h-8 flex-shrink-0 rounded-full border border-white/20 px-3 text-[12px] font-medium text-white hover:bg-white/10">
            {failed ? 'Continue' : 'Skip'}
          </button>
        )}
      </div>
    </>
  )
}

/** Recorded video: how long a check stays up before its answer, and how long the answer is shown. */
const RENDER_THINK_MS = 4500
const RENDER_REVEAL_MS = 3500

/** The answer a recorded video reveals for a check (none for "do you understand?" checks). */
function checkAnswerText(st: CheckStep): string | null {
  if (st.kind === 'choice' && st.options && typeof st.answer === 'number' && st.options[st.answer] !== undefined) return st.options[st.answer]
  if (st.kind === 'short' && st.accept?.length) return st.accept[0]
  return null
}

/** A check as a card on the board, for the recorded video: the question (and options), then the answer. */
function RecordedCheck({ step, reveal }: { step: CheckStep; reveal: boolean }) {
  const answer = checkAnswerText(step)
  return (
    <motion.div
      className="absolute inset-0 z-[11] flex items-end justify-center bg-gradient-to-t from-[#FDFCF9]/85 via-[#FDFCF9]/40 to-transparent px-10 pb-7"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <div className="w-full max-w-[640px] rounded-[16px] border border-line bg-surface p-6 shadow-[var(--shadow-raised)]">
        <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-accent">{step.kind === 'understand' ? 'Quick check' : 'Your turn'}</p>
        <p className="mt-2 font-display text-[22px] leading-snug text-ink"><RichText text={step.prompt} /></p>
        {step.kind === 'choice' && step.options && (
          <ol className="mt-4 grid gap-2">
            {step.options.map((o, i) => {
              const right = reveal && i === step.answer
              return (
                <li key={i} className={cx('flex items-center gap-3 rounded-[12px] border px-3.5 py-2.5 text-[16px] transition-colors duration-300', right ? 'border-accent bg-accent-soft text-ink' : reveal ? 'border-line text-muted' : 'border-line text-ink-2')}>
                  <span className={cx('tnum flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-medium', right ? 'bg-accent text-white' : 'border border-line text-muted')}>{right ? <Check className="h-3.5 w-3.5" strokeWidth={2.25} /> : String.fromCharCode(65 + i)}</span>
                  <RichText text={o} />
                </li>
              )
            })}
          </ol>
        )}
        {step.kind === 'short' && reveal && answer && (
          <p className="mt-4 rounded-[12px] border border-accent bg-accent-soft px-3.5 py-2.5 text-[16px] text-ink"><span className="mr-2 text-[12px] font-medium uppercase tracking-[0.08em] text-accent">Answer</span><RichText text={answer} /></p>
        )}
        {reveal && step.explanation && <p className="mt-3 text-[15px] leading-relaxed text-ink-2"><RichText text={step.explanation} /></p>}
        {!reveal && <p className="mt-4 text-[13px] text-muted">{step.kind === 'understand' ? 'Take a moment: does this make sense so far?' : 'Pause the video and try it yourself.'}</p>}
      </div>
    </motion.div>
  )
}

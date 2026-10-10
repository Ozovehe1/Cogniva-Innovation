'use client'
import { setLessonLive } from '@/lib/lesson-live'
import { ReportButton, type ReportCategory, type ReportPayload, type ReportResult } from '@/components/report/report-mistake'
import { hiddenStep, isHideable, reportTarget } from '@/lib/correctness/hide'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { WhiteboardPlayer, type NeedStepsRequest, type PlayerControl, type PlayerEvent } from '@/components/whiteboard'
import { detectDistress } from '@/lib/safety'
import { SafetyPause } from './safety-pause'
import { UpNextCard } from './up-next'
import { MicroQuestion } from './micro-question'
import { Pending, buttonClass, cx } from './ui'
import type { TranscriptAside } from '@/components/whiteboard/player'
import type { Step } from '@/lib/lesson-schema'
import type { Chapter } from '@/lib/lesson-sections'
import { TutorPresence } from '@/components/genie/tutor-presence'
import { genie } from '@/components/genie/presence'

/** Fired by IdleTimeout just before the away sign-out, so progress is saved while the session is still valid. */
export const BEFORE_SIGNOUT_EVENT = 'geniusmap:before-signout'

/** Position saves are batched: at most one every few seconds, plus on leave/hide. */
const SAVE_EVERY_MS = 4000
/** A one-tap check-in after this much active lesson time (or after two wrong answers in a row). */
const CHECKIN_EVERY_MS = 12 * 60_000
const MOODS = ['😣', '🙁', '😐', '🙂', '😄']

type Answer = { r: string; c?: boolean; a?: string }

/**
 * Connects the whiteboard player to the live tutor API and progress saving.
 * mode="student" saves progress (position, section and check answers) so the
 * student can resume on any device; mode="preview" (tutors) lets checks be
 * skipped and saves nothing.
 */
export function LessonSession({
  lessonId,
  steps,
  chapters,
  title,
  resumeAt = 0,
  answered,
  furthest,
  mode,
  transcriptAside,
  checkHref,
  minor,
  partial = false,
  upNext,
  autoPlay = false,
}: {
  lessonId: string
  steps: Step[]
  chapters?: Chapter[]
  title?: string
  resumeAt?: number
  answered?: number[]
  furthest?: number
  mode: 'student' | 'preview'
  transcriptAside?: TranscriptAside
  /** The topic's mastery check (AI path lessons); also where a re-check of the basics starts. */
  checkHref?: string
  minor?: boolean | null
  /** Later sections are still being written: reaching the end is not completing the lesson. */
  partial?: boolean
  /** What the learner goes on to when this lesson ends (their mastery check or the next lesson on their path). */
  upNext?: { href: string; title: string; eyebrow?: string; note?: string } | null
  /** Start playing at once (arrived here from the previous lesson's up-next card). */
  autoPlay?: boolean
}) {
  const [finished, setFinished] = useState(false)
  // New sections arrived (the page refreshed with more steps): the player has already carried on into them.
  const [seenSteps, setSeenSteps] = useState(steps.length)
  const [waitingForMore, setWaitingForMore] = useState(false)
  const control = useRef<PlayerControl | null>(null)
  const [checkin, setCheckin] = useState<null | { reason: 'time' | 'wrong' }>(null)
  const [slow, setSlow] = useState(false)
  const [safety, setSafety] = useState(false)
  const wrongStreak = useRef(0)
  const wrongTotal = useRef(0)
  const [basicsOffer, setBasicsOffer] = useState(false)
  const activeMs = useRef(0)

  // Active time: counted only while the lesson is playing and the page is visible.
  useEffect(() => {
    if (mode !== 'student') return
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible' || !control.current?.isPlaying()) return
      activeMs.current += 15_000
      if (activeMs.current >= CHECKIN_EVERY_MS) { activeMs.current = 0; control.current?.pause(); setCheckin(c => c ?? { reason: 'time' }) }
    }, 15_000)
    return () => clearInterval(t)
  }, [mode])

  if (steps.length !== seenSteps) { setSeenSteps(steps.length); setWaitingForMore(false) }

  const history = useRef<{ reason: string; answer?: string }[]>([])
  const url = `/api/lessons/${lessonId}/progress`

  // Latest position not yet saved, and the answers not yet saved.
  const pending = useRef<{ stepIndex: number; sectionIndex: number; furthest: number; scriptSteps: number } | null>(null)
  const pendingAnswers = useRef<Record<string, Answer>>({})
  const lastSent = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const post = useCallback((payload: object) => {
    if (mode !== 'student') return
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {})
  }, [url, mode])

  /** Send whatever is pending. `beacon` for page hide/unload, where fetch may be cut off. */
  const flush = useCallback((beacon = false, extra: object = {}) => {
    if (mode !== 'student') return
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const answers = pendingAnswers.current
    const hasAnswers = Object.keys(answers).length > 0
    if (!pending.current && !hasAnswers && Object.keys(extra).length === 0) return
    const payload = { ...(pending.current ?? {}), ...(hasAnswers ? { answers } : {}), ...extra }
    pending.current = null
    pendingAnswers.current = {}
    lastSent.current = Date.now()
    const body = JSON.stringify(payload)
    if (beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const ok = navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
      if (ok) return
    }
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
  }, [url, mode])

  const schedule = useCallback(() => {
    if (timer.current) return
    const wait = Math.max(0, SAVE_EVERY_MS - (Date.now() - lastSent.current))
    timer.current = setTimeout(() => { timer.current = null; flush() }, wait)
  }, [flush])

  // Save on leaving: tab hidden (also covers app switch on phones), page hide, and the away sign-out.
  useEffect(() => {
    if (mode !== 'student') return
    const onHide = () => { if (document.visibilityState === 'hidden') flush(true) }
    const onPageHide = () => flush(true)
    const onSignout = () => flush(false)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener(BEFORE_SIGNOUT_EVENT, onSignout)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener(BEFORE_SIGNOUT_EVENT, onSignout)
      flush(true)
    }
  }, [mode, flush])

  // The tutor character reacts to the lesson: listening at a check, celebrating or encouraging after an answer,
  // thinking while a new explanation is written; talking follows the narration audio on its own.
  useEffect(() => () => { genie.set('listening', false, 'lesson'); genie.set('thinking', false, 'lesson') }, [])
  const tutorReact = useCallback((e: PlayerEvent) => {
    if (e.type === 'step') genie.set('listening', control.current?.played().slice(-1)[0]?.type === 'check' || steps[e.index]?.type === 'check', 'lesson')
    else if (e.type === 'check') {
      genie.set('listening', false, 'lesson')
      if (e.response === 'answer' && e.correct === true) genie.react('happy')
      else if (e.response === 'answer' && e.correct === false) genie.react('encouraging')
      else if (e.response === 'got_it') genie.react('happy', 1600)
      else if (e.response === 'differently' || e.response === 'explain_wrong' || e.response === 'again') genie.react('encouraging', 1600)
    } else if (e.type === 'complete') genie.react('happy', 3200)
  }, [steps])

  const onEvent = useCallback((e: PlayerEvent) => {
    tutorReact(e)
    // The tutor sheet reads where the learner is and what they just answered (lesson-live.ts).
    if (e.type === 'position') setLessonLive({ lessonId, cursor: e.cursor, section: e.section, total: e.total })
    else if (e.type === 'check' && (e.response === 'answer' || e.response === 'differently' || e.response === 'explain_wrong')) setLessonLive({ lessonId, lastCheck: { step: e.origIndex, correct: e.correct, answer: e.answer?.slice(0, 200), response: e.response, at: Date.now() } })
    else if (e.type === 'reteach') setLessonLive({ lessonId, lastReteach: { step: e.index, reason: e.reason, at: Date.now() } })
    if (e.type === 'position') {
      pending.current = { stepIndex: e.cursor, sectionIndex: e.section, furthest: e.furthest, scriptSteps: e.total }
      schedule()
    } else if (e.type === 'check') {
      if (e.answer && detectDistress(e.answer)) { control.current?.pause(); setSafety(true) }
      if (e.response === 'answer' && e.correct === false) {
        wrongStreak.current++; wrongTotal.current++
        if (wrongTotal.current >= 3 && checkHref) setBasicsOffer(true)
        if (wrongStreak.current >= 2 && mode === 'student') { wrongStreak.current = 0; activeMs.current = 0; setCheckin(c => c ?? { reason: 'wrong' }) }
      } else if (e.response === 'answer' && e.correct) wrongStreak.current = 0
      if (e.response === 'answer' || e.response === 'got_it' || e.response === 'continue' || e.response === 'differently' || e.response === 'again' || e.response === 'explain_wrong') {
        // got_it/continue/answer resolve the check; the others re-teach and ask again, so they are logged but not stored as answered.
        if (e.response === 'answer' || e.response === 'got_it' || e.response === 'continue') {
          pendingAnswers.current[String(e.origIndex)] = { r: e.response, ...(e.correct !== undefined ? { c: e.correct } : {}), ...(e.answer ? { a: e.answer.slice(0, 200) } : {}) }
        }
        flush(false, { event: { type: 'check', step: e.origIndex, stepId: e.stepId, kind: e.kind, response: e.response, correct: e.correct, answer: e.answer } })
      }
    } else if (e.type === 'reteach') {
      post({ event: { type: 'reteach', step: e.index, source: e.source, reason: e.reason } })
    } else if (e.type === 'restart') {
      if (e.scope === 'lesson') { pending.current = null; pendingAnswers.current = {}; post({ restart: true, stepIndex: 0, sectionIndex: 0, event: { type: 'restart' } }) }
    } else if (e.type === 'complete' && partial) {
      flush(false)
      setWaitingForMore(true)
    } else if (e.type === 'complete') {
      pending.current = null
      pendingAnswers.current = {}
      post({ completed: true, event: { type: 'complete' } })
      setFinished(true)
    }
  }, [post, flush, schedule, partial, checkHref, mode, tutorReact, lessonId])

  const onNeedSteps = useCallback(async (req: NeedStepsRequest): Promise<Step[]> => {
    history.current.push({ reason: req.reason, answer: req.answer })
    genie.set('thinking', true, 'lesson')
    const res = await fetch('/api/tutor/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lessonId,
        reason: req.reason,
        checkIndex: req.checkIndex,
        answer: req.answer,
        played: req.played,
        history: history.current,
      }),
      // Past this, the player falls back to the lesson's own alternative explanation.
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null).finally(() => genie.set('thinking', false, 'lesson'))
    if (!res) return []
    if (!res.ok) return []
    const data = await res.json().catch(() => ({}))
    if (data.safety) { control.current?.pause(); setSafety(true); return [] }
    return Array.isArray(data.steps) ? (data.steps as Step[]) : []
  }, [lessonId])

  /** Low check-in: slow down and walk through one worked example of what is on the board. */
  const workedExample = useCallback(async () => {
    const played = control.current?.played() ?? []
    genie.set('thinking', true, 'lesson')
    const res = await fetch('/api/tutor/step', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lessonId, reason: 'worked_example', played, history: history.current }),
      signal: AbortSignal.timeout(35_000),
    }).catch(() => null).finally(() => genie.set('thinking', false, 'lesson'))
    const data = res?.ok ? await res.json().catch(() => ({})) : {}
    const steps = Array.isArray(data.steps) ? (data.steps as Step[]) : []
    return steps.length > 0 && !!control.current?.insertNow(steps)
  }, [lessonId])

  const reported = useRef<number | null>(null)
  /** "Report a mistake": what is on the board now (a picture complaint targets the last picture). */
  const reportPayload = useCallback((category: ReportCategory | null): ReportPayload | null => {
    const cur = control.current?.current()
    if (!cur?.step) return null
    const target = reportTarget(cur.steps, cur.index, category)
    const st = cur.steps[target]
    let from = 0
    for (let k = target; k >= 0; k--) { const x = cur.steps[k]; if (x.type === 'clear' && !(x as { targets?: unknown }).targets) { from = k; break } }
    // The board around it, without other pictures' SVG (kept small); the reported step whole.
    const board = cur.steps.slice(from, cur.index + 1).slice(-40).map((x, k) => (from + k === target || x.type !== 'draw' || x.shape.kind !== 'figure' ? x : { ...x, shape: { ...x.shape, svg: '' } }))
    const surface: ReportPayload['surface'] = st.type === 'draw' && st.shape.kind === 'figure' ? (st.shape.src ? 'illustration' : 'diagram') : st.type === 'stage' ? 'stage' : st.type === 'manim_clip' ? 'animation' : st.type === 'check' ? 'check' : 'lesson_step'
    reported.current = target
    return { surface, lessonId, stepIndex: cur.orig[target] ?? null, artefact: { step: st, steps: board, live_index: target }, clipJobId: st.type === 'manim_clip' ? st.jobId ?? null : null }
  }, [lessonId])
  const onReported = useCallback(() => {
    const i = reported.current
    const cur = control.current?.current()
    if (i === null || !cur) return
    if (isHideable(cur.steps[i])) control.current?.replaceStep(i, hiddenStep(cur.steps[i]))
  }, [])
  /** Corrected retry: the tutor fixes the reported part on the board and carries on. */
  const correctedRetry = useCallback(async (r: ReportResult) => {
    const played = control.current?.played() ?? []
    history.current.push({ reason: 'reported_mistake', answer: `${r.category?.replace('_', ' ') ?? 'mistake'}${r.note ? `: ${r.note}` : ''}` })
    genie.set('thinking', true, 'lesson')
    const res = await fetch('/api/tutor/step', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lessonId, reason: 'explain_differently', played, history: history.current }),
      signal: AbortSignal.timeout(35_000),
    }).catch(() => null).finally(() => genie.set('thinking', false, 'lesson'))
    const data = res?.ok ? await res.json().catch(() => ({})) : {}
    const steps = Array.isArray(data.steps) ? (data.steps as Step[]) : []
    if (steps.length) control.current?.insertNow(steps)
  }, [lessonId])

  return (
    <>
    {/* The character looks down toward the board by default. */}
    <div className="mb-2 flex items-center gap-2">
      <TutorPresence variant="lesson" look={{ x: 0.2, y: 0.55 }} className="min-w-0 flex-1" />
      {mode === 'student' && <ReportButton short what="this part of the lesson" payload={reportPayload} onReported={onReported} onRetry={r => void correctedRetry(r)} className="flex-shrink-0" />}
    </div>
    <WhiteboardPlayer
      controlRef={control}
      slow={slow}
      steps={steps}
      chapters={chapters}
      title={title}
      initialIndex={resumeAt}
      answered={answered}
      furthest={furthest}
      allowSkipChecks={mode === 'preview'}
      onNeedSteps={onNeedSteps}
      onEvent={onEvent}
      transcriptAside={transcriptAside}
      autoPlay={autoPlay}
      more={partial}
    />
    {finished && mode === 'student' && <MicroQuestion />}
    {(finished || (waitingForMore && !partial)) && upNext && mode === 'student' && <UpNextCard {...upNext} />}
    {basicsOffer && checkHref && (
      <div className="mt-4 flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4 sm:flex-row sm:items-center">
        <p className="flex-1 text-[15px] leading-relaxed text-ink-2">A few answers haven’t landed. A two-minute check on the basics underneath this can find the gap.</p>
        <Link href={`${checkHref}?recheck=1`} className={buttonClass('secondary', 'md')}>Check the basics</Link>
      </div>
    )}
    <CheckIn
      open={!!checkin}
      reason={checkin?.reason ?? 'time'}
      lessonId={lessonId}
      onClose={(r) => {
        setCheckin(null)
        if (r.sustainedLow) { setSafety(true); return }
        if (r.choice === 'worked') { setSlow(true); void workedExample().then(ok => { if (!ok) control.current?.resume() }) }
        else if (r.choice === 'slow') { setSlow(true); control.current?.resume() }
        else if (r.choice !== 'break') control.current?.resume()
      }}
    />
    <SafetyPause open={safety} minor={minor ?? null} onContinue={() => setSafety(false)} />
    </>
  )
}

type CheckInResult = { choice: 'continue' | 'worked' | 'slow' | 'break'; sustainedLow?: boolean }

/** One-tap mood and confidence check. Private; stored for 14 days. Low ratings offer a worked example, a slower pace or a break. */
function CheckIn({ open, reason, lessonId, onClose }: { open: boolean; reason: 'time' | 'wrong'; lessonId: string; onClose: (r: CheckInResult) => void }) {
  const [mood, setMood] = useState<number | null>(null)
  const [conf, setConf] = useState<number | null>(null)
  const [stage, setStage] = useState<'ask' | 'low' | 'break'>('ask')
  const [busy, setBusy] = useState(false)
  const [breakLeft, setBreakLeft] = useState(300)
  const sustained = useRef(false)
  // Reset when the sheet opens: adjusted during render (React's "storing information from previous renders"), not in an effect.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) { setMood(null); setConf(null); setStage('ask'); setBusy(false) }
  }
  useEffect(() => { if (open) sustained.current = false }, [open])
  useEffect(() => {
    if (stage !== 'break') return
    const t = setInterval(() => setBreakLeft(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [stage])

  const submit = async () => {
    setBusy(true)
    const res = await fetch('/api/checkins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: 'lesson', lessonId, mood, confidence: conf }) }).catch(() => null)
    const data = res?.ok ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    sustained.current = !!data.sustainedLow
    const low = (mood ?? 3) <= 2 || (conf ?? 3) <= 2
    if (data.sustainedLow) { onClose({ choice: 'continue', sustainedLow: true }); return }
    if (low) setStage('low')
    else onClose({ choice: 'continue' })
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Check-in">
          <motion.div className="absolute inset-0 bg-ink/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div className="pb-safe relative w-full max-w-md rounded-t-[18px] border border-line bg-surface p-6 shadow-[var(--shadow-raised)] sm:rounded-[18px]"
            initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} transition={{ duration: 0.2 }}>
            {stage === 'ask' && (
              <>
                <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Quick check-in</p>
                <h2 className="mt-1.5 font-display text-[22px] leading-snug text-ink">{reason === 'wrong' ? 'That was a tricky bit. How’s it feeling?' : 'How’s this feeling so far?'}</h2>
                <p className="mt-4 mb-2 text-[14px] font-medium text-ink-2">Mood</p>
                <div className="grid grid-cols-5 gap-2">
                  {MOODS.map((m, i) => (
                    <button key={m} type="button" aria-label={`Mood ${i + 1} of 5`} aria-pressed={mood === i + 1} onClick={() => setMood(i + 1)}
                      className={cx('flex h-12 items-center justify-center rounded-[12px] border text-[22px]', mood === i + 1 ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-line')}>{m}</button>
                  ))}
                </div>
                <p className="mt-4 mb-2 text-[14px] font-medium text-ink-2">How confident are you with this idea?</p>
                <div className="grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button key={n} type="button" aria-label={`Confidence ${n} of 5`} aria-pressed={conf === n} onClick={() => setConf(n)}
                      className={cx('tnum flex h-12 items-center justify-center rounded-[12px] border font-display text-[19px] text-ink', conf === n ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-line')}>{n}</button>
                  ))}
                </div>
                <div className="mt-2 flex justify-between text-[11px] text-faint"><span>Lost</span><span>I’ve got it</span></div>
                <div className="mt-5 flex gap-2">
                  <button type="button" disabled={busy || (mood === null && conf === null)} onClick={submit} className={buttonClass('primary', 'lg', 'flex-1')}><Pending busy={busy} label="Saving">Continue</Pending></button>
                  <button type="button" onClick={() => onClose({ choice: 'continue' })} className={buttonClass('ghost', 'lg')}>Skip</button>
                </div>
                <p className="mt-3 text-[12px] text-faint">Only you see this. It’s deleted after two weeks.</p>
              </>
            )}
            {stage === 'low' && (
              <>
                <h2 className="font-display text-[22px] leading-snug text-ink">Thanks for being honest. Let’s make this easier.</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">I’ll slow down. What would help most?</p>
                <div className="mt-5 grid gap-2">
                  <button type="button" onClick={() => onClose({ choice: 'worked' })} className={buttonClass('primary', 'lg')}>Show me a worked example</button>
                  <button type="button" onClick={() => setStage('break')} className={buttonClass('secondary', 'lg')}>Take a 5-minute break</button>
                  <button type="button" onClick={() => onClose({ choice: 'slow' })} className={buttonClass('ghost', 'lg')}>Keep going, a bit slower</button>
                </div>
              </>
            )}
            {stage === 'break' && (
              <>
                <h2 className="font-display text-[22px] leading-snug text-ink">Take a breather.</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">Stand up, stretch, get some water. Your place is saved.</p>
                <p className="tnum mt-5 font-display text-[44px] leading-none text-ink">{Math.floor(breakLeft / 60)}:{String(breakLeft % 60).padStart(2, '0')}</p>
                <button type="button" onClick={() => onClose({ choice: 'slow' })} className={buttonClass('primary', 'lg', 'mt-6 w-full')}>{breakLeft > 0 ? 'I’m ready, carry on' : 'Back to the lesson'}</button>
              </>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

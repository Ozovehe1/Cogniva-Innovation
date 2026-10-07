'use client'
import React, { useCallback, useEffect, useRef } from 'react'
import { WhiteboardPlayer, type NeedStepsRequest, type PlayerEvent } from '@/components/whiteboard'
import type { TranscriptAside } from '@/components/whiteboard/player'
import type { Step } from '@/lib/lesson-schema'
import type { Chapter } from '@/lib/lesson-sections'

/** Fired by IdleTimeout just before the away sign-out, so progress is saved while the session is still valid. */
export const BEFORE_SIGNOUT_EVENT = 'geniusmap:before-signout'

/** Position saves are batched: at most one every few seconds, plus on leave/hide. */
const SAVE_EVERY_MS = 4000

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
}) {
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

  const onEvent = useCallback((e: PlayerEvent) => {
    if (e.type === 'position') {
      pending.current = { stepIndex: e.cursor, sectionIndex: e.section, furthest: e.furthest, scriptSteps: e.total }
      schedule()
    } else if (e.type === 'check') {
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
    } else if (e.type === 'complete') {
      pending.current = null
      pendingAnswers.current = {}
      post({ completed: true, event: { type: 'complete' } })
    }
  }, [post, flush, schedule])

  const onNeedSteps = useCallback(async (req: NeedStepsRequest): Promise<Step[]> => {
    history.current.push({ reason: req.reason, answer: req.answer })
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
    }).catch(() => null)
    if (!res) return []
    if (!res.ok) return []
    const data = await res.json().catch(() => ({}))
    return Array.isArray(data.steps) ? (data.steps as Step[]) : []
  }, [lessonId])

  return (
    <WhiteboardPlayer
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
    />
  )
}

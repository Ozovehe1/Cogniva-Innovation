'use client'
import React, { useCallback, useRef } from 'react'
import { WhiteboardPlayer, type NeedStepsRequest, type PlayerEvent } from '@/components/whiteboard'
import type { Step } from '@/lib/lesson-schema'

/**
 * Connects the whiteboard player to the live tutor API and progress logging.
 * mode="student" records progress; mode="preview" (tutors) lets checks be skipped and records nothing.
 */
export function LessonSession({
  lessonId,
  steps,
  resumeAt = 0,
  mode,
}: {
  lessonId: string
  steps: Step[]
  resumeAt?: number
  mode: 'student' | 'preview'
}) {
  const history = useRef<{ reason: string; answer?: string }[]>([])
  const lastSaved = useRef(resumeAt)

  const post = useCallback((payload: object) => {
    if (mode !== 'student') return
    fetch(`/api/lessons/${lessonId}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {})
  }, [lessonId, mode])

  const onEvent = useCallback((e: PlayerEvent) => {
    if (e.type === 'step') {
      // Save position every few steps (and never move backwards in the stored index on replays).
      if (e.index - lastSaved.current >= 4) { lastSaved.current = e.index; post({ stepIndex: e.index }) }
    } else if (e.type === 'check') {
      if (e.response === 'answer' || e.response === 'got_it' || e.response === 'differently' || e.response === 'again') {
        post({ stepIndex: e.index, event: { type: 'check', step: e.index, stepId: e.stepId, kind: e.kind, response: e.response, correct: e.correct, answer: e.answer } })
      }
    } else if (e.type === 'reteach') {
      post({ event: { type: 'reteach', step: e.index, source: e.source, reason: e.reason } })
    } else if (e.type === 'complete') {
      post({ stepIndex: 0, completed: true, event: { type: 'complete' } })
    }
  }, [post])

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
    })
    if (!res.ok) return []
    const data = await res.json().catch(() => ({}))
    return Array.isArray(data.steps) ? (data.steps as Step[]) : []
  }, [lessonId])

  return (
    <WhiteboardPlayer
      steps={steps}
      initialIndex={resumeAt}
      allowSkipChecks={mode === 'preview'}
      onNeedSteps={onNeedSteps}
      onEvent={onEvent}
    />
  )
}

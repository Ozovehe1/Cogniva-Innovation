'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from './ui'

/**
 * Shown while the AI writes a learner's lesson. Polls the status route (which also
 * keeps the background drafting going) and refreshes the page when a new section
 * is ready, so the lesson can start as soon as its first section exists.
 */
export function LessonPreparing({ lessonId, own, compact = false, readySections = 0 }: { lessonId: string; own: boolean; compact?: boolean; readySections?: number }) {
  const router = useRouter()
  const [state, setState] = useState<{ status: string; sectionsReady: number; retryAt: string | null; error: string | null } | null>(null)
  useEffect(() => {
    if (!own) return
    let stop = false
    let seen = readySections
    const tick = async () => {
      const res = await fetch(`/api/lessons/${lessonId}/status`, { cache: 'no-store' }).catch(() => null)
      const data = res?.ok ? await res.json().catch(() => null) : null
      if (stop || !data) return
      setState(data)
      // Reload as soon as a new section exists. Mid-lesson the player appends it in place, so playback
      // carries straight on into it (no reset, no button).
      if (data.sectionsReady > seen) { seen = data.sectionsReady; router.refresh() }
      if (['ready', 'partial', 'failed'].includes(data.status)) return
      setTimeout(tick, compact ? 8_000 : 4_000)
    }
    void tick()
    return () => { stop = true }
  }, [lessonId, own, compact, readySections, router])

  // Mid-lesson nothing is shown: later sections stream in behind the one being taught.
  if (compact) return null
  const paused = state?.status === 'paused'
  return (
    <div className="rounded-[14px] border border-line bg-surface p-6 md:p-8">
      {state?.error ? (
        <p className="text-[15px] text-danger">{state.error}</p>
      ) : (
        <>
          <Spinner className="h-5 w-5 text-accent" />
          <h2 className="mt-4 font-display text-[24px] leading-snug text-ink">{paused ? 'Your tutor is taking a short pause.' : 'Your tutor is writing this lesson for you.'}</h2>
          <p className="mt-2 max-w-[34rem] text-[15px] leading-relaxed text-muted">
            {paused
              ? 'The AI service is busy right now. Writing picks up again automatically in a few minutes; you can leave this page and come back.'
              : 'It’s pitched at your level, with examples from your interests, and sized to your week. The first section is usually ready in about a minute; the rest is written while you learn.'}
          </p>
        </>
      )}
    </div>
  )
}

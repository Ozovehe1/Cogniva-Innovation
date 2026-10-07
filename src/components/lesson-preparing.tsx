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
      // Before the lesson can start, reload as soon as the first section exists. Mid-lesson, offer it instead
      // (reloading swaps the script under the player).
      if (seen === 0 && data.sectionsReady > 0) { seen = data.sectionsReady; router.refresh() }
      if (['ready', 'partial', 'failed'].includes(data.status)) return
      setTimeout(tick, compact ? 15_000 : 5_000)
    }
    void tick()
    return () => { stop = true }
  }, [lessonId, own, compact, readySections, router])

  if (compact) {
    const more = (state?.sectionsReady ?? readySections) > readySections
    return (
      <p className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
        {more ? (
          <>New sections are ready.<button type="button" onClick={() => router.refresh()} className="font-medium text-accent hover:underline underline-offset-4">Add them to the lesson</button></>
        ) : (
          <><Spinner className="h-3 w-3 text-accent" />Later sections are still being written. You can start now.</>
        )}
      </p>
    )
  }
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

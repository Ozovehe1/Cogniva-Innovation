'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pending, buttonClass } from './ui'
import { PaperSketch, StageList } from './system/wait'

/**
 * Shown while the AI writes a learner's lesson. Polls the status route (which also
 * keeps the background drafting going) and refreshes the page when a new section
 * is ready, so the lesson can start as soon as its first section exists.
 */
export function LessonPreparing({ lessonId, own, compact = false, readySteps = 0, forceState }: { lessonId: string; own: boolean; compact?: boolean; readySteps?: number; /** design lab only: show this state, fetch nothing */ forceState?: { status: string; sectionsReady: number; error?: string | null } }) {
  const router = useRouter()
  const [state, setState] = useState<{ status: string; sectionsReady: number; stepsReady?: number; retryAt: string | null; error: string | null } | null>(forceState ? { retryAt: null, error: null, ...forceState } : null)
  useEffect(() => {
    if (forceState) return
    if (!own) return
    let stop = false
    let seen = readySteps
    const tick = async () => {
      const res = await fetch(`/api/lessons/${lessonId}/status`, { cache: 'no-store' }).catch(() => null)
      const data = res?.ok ? await res.json().catch(() => null) : null
      if (stop || !data) return
      setState(data)
      // Reload as soon as a new beat exists. Mid-lesson the player appends it in place, so playback
      // carries straight on into it (no reset, no button).
      const have = data.stepsReady ?? 0
      if (have > seen) { seen = have; router.refresh() }
      if (['ready', 'partial', 'failed'].includes(data.status)) return
      setTimeout(tick, compact ? 8_000 : 2_500)
    }
    void tick()
    return () => { stop = true }
  }, [lessonId, own, compact, readySteps, router, forceState])

  const [checking, setChecking] = useState(false)
  // Mid-lesson nothing is shown: later sections stream in behind the one being taught.
  if (compact) return null
  const paused = state?.status === 'paused'
  const ready = state?.sectionsReady ?? 0
  const status = state?.status ?? 'outlining'
  const planned = status !== 'outlining' && status !== 'queued' && status !== 'pending'
  // The lesson's board frame at its final place and size (4:3 on a phone, 16:9 wider, as the player), a pen sketching a
  // lesson page on it (shaped like what is coming), and the real drafting stages from the server (honest progress,
  // uncertainty reduction). Nothing to do but wait or leave (autonomy): the lesson opens here by itself.
  if (state?.error) return (
    <div className="rounded-[14px] border border-line bg-surface p-6 shadow-[var(--shadow-card)] md:p-8" role="status" aria-live="polite">
      <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-clay">This lesson hit a snag</p>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{state.error}</p>
      <button type="button" disabled={checking} onClick={() => { setChecking(true); router.refresh(); setTimeout(() => setChecking(false), 2500) }} className={buttonClass('secondary', 'md', 'mt-4 h-11')}>
        <Pending busy={checking} label="Checking">Check again</Pending>
      </button>
    </div>
  )
  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-[var(--shadow-card)]" data-wait="lesson">
      <PaperSketch bare kind="lesson" aspect="board" progress="none" live={false} />
      <div className="border-t border-line p-5 md:p-6" role="status" aria-live="polite">
        <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-accent">{paused ? 'Short pause' : 'Writing your lesson'}</p>
        <h2 className="mt-1.5 font-display text-[22px] leading-snug text-ink md:text-[24px]">{paused ? 'Your tutor is taking a short pause.' : 'Your tutor is writing this lesson for you.'}</h2>
        {paused
          ? <p className="mt-2 max-w-[34rem] text-[15px] leading-relaxed text-muted">The AI service is busy right now. Writing picks up again by itself in a few minutes; you can leave this page and come back.</p>
          : (
            <>
              <StageList className="mt-4" stages={[
                { label: 'Planning the lesson at your level', state: planned ? 'done' : 'now' },
                { label: ready > 0 ? `Writing part ${ready + 1}` : 'Writing and checking part 1', state: planned ? 'now' : 'next' },
                { label: 'Opens here by itself', state: 'next' },
              ]} />
              <p className="mt-4 max-w-[34rem] text-[14px] leading-relaxed text-muted">The first part is usually ready in under a minute; the rest is written while you learn.</p>
            </>
          )}
      </div>
    </div>
  )
}

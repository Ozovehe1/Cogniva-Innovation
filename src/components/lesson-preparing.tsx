'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { buttonClass } from './ui'

/**
 * Shown while the AI writes a learner's lesson. Polls the status route (which also
 * keeps the background drafting going) and refreshes the page when a new section
 * is ready, so the lesson can start as soon as its first section exists.
 */
export function LessonPreparing({ lessonId, own, compact = false, readySteps = 0 }: { lessonId: string; own: boolean; compact?: boolean; readySteps?: number }) {
  const router = useRouter()
  const [state, setState] = useState<{ status: string; sectionsReady: number; stepsReady?: number; retryAt: string | null; error: string | null } | null>(null)
  useEffect(() => {
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
  }, [lessonId, own, compact, readySteps, router])

  // Mid-lesson nothing is shown: later sections stream in behind the one being taught.
  if (compact) return null
  const paused = state?.status === 'paused'
  const ready = state?.sectionsReady ?? 0
  // A board-shaped skeleton that "writes" itself (shaped like what is coming: reduced uncertainty), the honest status
  // in words, and nothing to do but wait or leave (autonomy): the lesson opens by itself the moment part 1 exists.
  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-[var(--shadow-card)]" role="status" aria-live="polite">
      {state?.error ? (
        <div className="p-6 md:p-8">
          <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-clay">This lesson hit a snag</p>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{state.error}</p>
          <button type="button" onClick={() => router.refresh()} className={buttonClass('secondary', 'md', 'mt-4')}>Check again</button>
        </div>
      ) : (
        <>
          <div className="relative aspect-[16/9] w-full border-b border-line bg-[#FDFCF9]" aria-hidden>
            {[38, 56, 30, 46].map((w, i) => (
              <span key={i} className="absolute left-[8%] h-3.5 origin-left rounded-full bg-line-strong/60 motion-safe:animate-[gm-write_2.8s_ease-in-out_infinite]"
                style={{ top: `${18 + i * 16}%`, width: `${w}%`, animationDelay: `${i * 0.35}s` }} />
            ))}
            <span className="absolute bottom-[16%] right-[10%] h-16 w-24 rounded-[10px] border border-dashed border-line-strong" />
          </div>
          <div className="p-5 md:p-6">
            <p className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-accent">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-accent/50 motion-safe:animate-ping" /><span className="relative inline-flex h-2 w-2 rounded-full bg-accent" /></span>
              {paused ? 'Short pause' : ready > 0 ? `Part ${ready + 1} on its way` : 'Writing part 1'}
            </p>
            <h2 className="mt-2 font-display text-[24px] leading-snug text-ink">{paused ? 'Your tutor is taking a short pause.' : 'Your tutor is writing this lesson for you.'}</h2>
            <p className="mt-2 max-w-[34rem] text-[15px] leading-relaxed text-muted">
              {paused
                ? 'The AI service is busy right now. Writing picks up again by itself in a few minutes; you can leave this page and come back.'
                : 'It’s pitched at your level, with examples from your interests, and sized to your week. The first part is usually ready in under a minute and opens here by itself; the rest is written while you learn.'}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

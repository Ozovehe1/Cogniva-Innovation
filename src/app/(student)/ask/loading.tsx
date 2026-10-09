import { Eyebrow, Skeleton } from '@/components/ui'

/**
 * Ask is opening: the page's own header, the tutor bar, the empty state's shape and the composer at the bottom, all at
 * their final places (shaped skeleton: the eye already knows where to look; nothing moves when the page lands).
 */
export default function AskLoading() {
  return (
    <div className="mx-auto max-w-[820px]" role="status" aria-live="polite">
      <span className="sr-only">Opening Ask</span>
      <div className="mb-2">
        <Eyebrow>Ask GeniusMap</Eyebrow>
        <h1 className="mt-1 font-display text-[28px] leading-tight text-ink md:text-[34px]">Your tutor, any time</h1>
      </div>
      <div className="mb-1 flex h-[52px] items-center gap-3 rounded-[14px] border border-line bg-surface pl-2 pr-1.5 shadow-[var(--shadow-card)]" aria-hidden>
        <Skeleton className="h-10 w-10 rounded-full" /><Skeleton className="h-3.5 w-40" />
      </div>
      <div className="mx-auto max-w-xl py-6 md:py-10" aria-hidden>
        <Skeleton className="h-7 w-4/5 rounded-[8px]" />
        <Skeleton className="mt-3 h-3.5 w-full" /><Skeleton className="mt-2 h-3.5 w-11/12" /><Skeleton className="mt-2 h-3.5 w-2/3" />
        <Skeleton className="mt-7 h-3 w-14" />
        <div className="mt-3 grid gap-2">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="flex min-h-12 items-center gap-3 rounded-[12px] border border-line bg-surface px-3.5 shadow-[var(--shadow-card)]">
              <span className="h-8 w-8 shrink-0 rounded-full bg-accent-soft" /><Skeleton className="h-3.5" style={{ width: `${70 - i * 8}%` }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

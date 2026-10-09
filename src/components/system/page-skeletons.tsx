import { Skeleton } from '@/components/ui'

/**
 * Route-level loading skeletons (docs/design/app-ui.md): shaped like the page that is coming, so the eye knows
 * where things will land (reduced uncertainty, no layout jump). Never a spinner.
 */
export function HeaderSkeleton() {
  return (
    <div className="mb-6 md:mb-8" aria-hidden>
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-3 h-9 w-56 rounded-[8px]" />
    </div>
  )
}

export function CardSkeleton({ lines = 3, tall = false }: { lines?: number; tall?: boolean }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-5 shadow-[var(--shadow-card)]" aria-hidden>
      <Skeleton className="h-3 w-24" />
      <Skeleton className={tall ? 'mt-3 h-7 w-4/5 rounded-[8px]' : 'mt-3 h-6 w-3/5 rounded-[8px]'} />
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className="mt-3 h-3.5" style={{ width: `${88 - i * 14}%` }} />)}
      <Skeleton className="mt-5 h-10 w-36 rounded-[10px]" />
    </div>
  )
}

export function PageLoading({ cards = 3 }: { cards?: number }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <HeaderSkeleton />
      <div className="space-y-4">
        <CardSkeleton tall />
        {Array.from({ length: cards - 1 }, (_, i) => <CardSkeleton key={i} lines={2} />)}
      </div>
    </div>
  )
}

import { Skeleton } from '@/components/ui'

/** A lesson is coming: the board frame at its final place and size, the transport under it (no spinner, no jump). */
export default function LessonLoading() {
  return (
    <div className="mx-auto max-w-[920px]" role="status" aria-live="polite">
      <span className="sr-only">Opening your lesson…</span>
      <Skeleton className="mb-4 h-4 w-28" />
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-3 h-8 w-3/4 rounded-[8px]" />
      <Skeleton className="mt-3 h-3.5 w-40" />
      <div className="mt-6 flex items-center gap-3"><Skeleton className="h-12 w-12 rounded-full" /><Skeleton className="h-3.5 w-36" /></div>
      <div className="relative mt-3 aspect-[4/3] w-full overflow-hidden rounded-[14px] border border-line bg-[#FDFCF9] shadow-[var(--shadow-card)] md:aspect-[16/9]" aria-hidden>
        <Skeleton className="absolute left-[8%] top-[14%] h-4 w-[38%]" />
        <Skeleton className="absolute left-[8%] top-[26%] h-4 w-[52%]" />
        <Skeleton className="absolute left-[8%] top-[38%] h-4 w-[30%]" />
      </div>
      <div className="mt-3 flex items-center justify-center gap-6" aria-hidden><Skeleton className="h-9 w-9 rounded-full" /><Skeleton className="h-12 w-12 rounded-full" /><Skeleton className="h-9 w-9 rounded-full" /></div>
    </div>
  )
}

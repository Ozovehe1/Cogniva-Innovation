import { Skeleton } from '@/components/ui'
import { PaperSketch } from '@/components/system/wait'

/**
 * A lesson is opening: every row of the lesson page at its measured height (back link, subject, title, length +
 * Download/Delete, the tutor row, the section header), then the board frame at the player's 16:10 size with a pen
 * sketching a lesson page, and the transport under it. Shaped like what is coming, so nothing jumps when it lands
 * (perceived performance, no layout shift). Heights measured on production at 390 and 1280 px.
 */
export default function LessonLoading() {
  return (
    <div className="mx-auto max-w-[920px]" role="status" aria-live="polite">
      <span className="sr-only">Opening your lesson</span>
      <div aria-hidden>
        <div className="mb-3 flex h-11 items-center"><Skeleton className="h-3.5 w-28" /></div>
        <div className="mb-2 flex h-[18px] items-center"><Skeleton className="h-3 w-20" /></div>
        <div className="flex h-[31px] items-center md:h-10"><Skeleton className="h-7 w-3/4 rounded-[8px] md:h-9" /></div>
        <div className="mb-5 mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 md:mb-6">
          <div className="flex h-5 items-center"><Skeleton className="h-3.5 w-40" /></div>
          <div className="flex h-10 items-center gap-1"><Skeleton className="h-10 w-[151px] rounded-[10px]" /><Skeleton className="h-10 w-[102px] rounded-[10px]" /></div>
        </div>
        <div className="mb-2 flex h-[52px] items-center gap-3">
          <Skeleton className="h-[52px] w-[52px] flex-shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-2.5 w-16" /><Skeleton className="h-3.5 w-32" /></div>
          <Skeleton className="h-9 w-20 rounded-full" />
        </div>
        <div className="mb-3 flex h-[46px] items-end justify-between gap-3 md:h-[49px]">
          <div className="min-w-0"><div className="flex h-[18px] items-center"><Skeleton className="h-3 w-24" /></div><div className="mt-0.5 flex h-[26px] items-center md:h-[29px]"><Skeleton className="h-5 w-36" /></div></div>
          <Skeleton className="h-9 w-[122px] rounded-full" />
        </div>
      </div>
      <PaperSketch kind="lesson" aspect="board" progress="none" live={false} />
      <div className="mt-3 flex h-11 items-center gap-0.5 sm:gap-2" aria-hidden>
        <Skeleton className="h-10 w-10 rounded-full" /><Skeleton className="h-10 w-10 rounded-full" /><Skeleton className="h-11 w-11 rounded-full" /><Skeleton className="h-10 w-10 rounded-full" /><Skeleton className="h-10 w-10 rounded-full" />
      </div>
    </div>
  )
}

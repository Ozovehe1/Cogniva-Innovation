import { Skeleton } from '@/components/ui'
import { PaperSketch } from '@/components/system/wait'

/**
 * A lesson is opening: the back link, title block and meta row at the lesson page's exact sizes, then the board frame
 * at the player's size (4:3 phone, 16:9 wider) with a pen sketching a lesson page, and the transport under it.
 * Shaped like what is coming, so nothing jumps when it lands (perceived performance, no layout shift).
 */
export default function LessonLoading() {
  return (
    <div className="mx-auto max-w-[920px]" role="status" aria-live="polite">
      <span className="sr-only">Opening your lesson</span>
      <div className="mb-3 flex h-11 items-center" aria-hidden><Skeleton className="h-3.5 w-28" /></div>
      <Skeleton className="mb-2 h-3 w-16" />
      <Skeleton className="h-8 w-3/4 rounded-[8px] md:h-10" />
      <div className="mb-5 mt-2 flex h-10 items-center md:mb-6" aria-hidden><Skeleton className="h-3.5 w-40" /></div>
      <PaperSketch kind="lesson" aspect="board" progress="none" live={false} />
      <div className="mt-3 flex items-center justify-center gap-6" aria-hidden><Skeleton className="h-11 w-11 rounded-full" /><Skeleton className="h-12 w-12 rounded-full" /><Skeleton className="h-11 w-11 rounded-full" /></div>
    </div>
  )
}

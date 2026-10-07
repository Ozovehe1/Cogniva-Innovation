import { Suspense } from 'react'
import { after } from 'next/server'
import { SAMPLE_LESSON, SAMPLE_SCRIPT } from '@/lib/seed-lessons'
import { DemoPlayer } from './demo-player'
import { pregenerateNarration } from '@/lib/tts-server'

// Demo of the whiteboard engine with the seed lesson (not linked anywhere, not indexed).
// Its narration is voiced once per server instance; later visits read the cache.
let voiced = false
export const maxDuration = 300
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Whiteboard demo · GeniusMap', robots: { index: false } }

export default function WhiteboardDemoPage() {
  if (!voiced) {
    voiced = true
    after(() => pregenerateNarration(SAMPLE_SCRIPT, 250_000).then(r => { if (!r.done) voiced = false }))
  }
  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-6 sm:px-6 md:py-10">
      <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">{SAMPLE_LESSON.subject} · Demo</p>
      <h1 className="mt-2 font-display text-[30px] leading-[1.1] text-ink md:text-[38px]">{SAMPLE_LESSON.title}</h1>
      <div className="mt-6">
        <Suspense fallback={null}>
          <DemoPlayer steps={SAMPLE_SCRIPT} />
        </Suspense>
      </div>
    </main>
  )
}

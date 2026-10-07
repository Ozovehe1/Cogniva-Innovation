import { Suspense } from 'react'
import { after } from 'next/server'
import { FLAGSHIP_LESSON, FLAGSHIP_SECTIONS } from '@/lib/flagship-lesson'
import { flattenSections, formatDuration, estimateMs } from '@/lib/lesson-sections'
import { DemoPlayer } from './demo-player'
import { pregenerateNarration } from '@/lib/tts-server'

// The public sample lesson (linked from the landing page; not indexed).
// Every line is pre-voiced with Kokoro; this re-check only voices lines that are missing from the cache.
const LESSON = flattenSections(FLAGSHIP_SECTIONS)
let voiced = false
export const maxDuration = 300
export const dynamic = 'force-dynamic'
export const metadata = {
  title: `${FLAGSHIP_LESSON.title} · Sample lesson · GeniusMap`,
  description: 'A sample GeniusMap lesson taught by the AI tutor on a live whiteboard.',
  robots: { index: false },
}

export default function SampleLessonPage() {
  if (!voiced) {
    voiced = true
    after(() => pregenerateNarration(LESSON.steps, 250_000).then(r => { if (!r.done) voiced = false }))
  }
  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-6 sm:px-6 md:py-10">
      <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">{FLAGSHIP_LESSON.subject} · Sample lesson</p>
      <h1 className="mt-2 font-display text-[30px] leading-[1.1] text-ink md:text-[38px]">{FLAGSHIP_LESSON.title}</h1>
      <p className="mt-2 text-[14px] text-muted">About {formatDuration(estimateMs(LESSON.steps))} · {LESSON.chapters.length} sections · taught by your AI tutor</p>
      <div className="mt-6">
        <Suspense fallback={null}>
          <DemoPlayer steps={LESSON.steps} chapters={LESSON.chapters} title={FLAGSHIP_LESSON.title} />
        </Suspense>
      </div>
    </main>
  )
}

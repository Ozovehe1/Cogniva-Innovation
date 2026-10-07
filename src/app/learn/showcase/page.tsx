import { Suspense } from 'react'
import { after } from 'next/server'
import { SHOWCASE_LESSON, SHOWCASE_SECTIONS } from '@/lib/showcase-lesson'
import { flattenSections, formatDuration, estimateMs } from '@/lib/lesson-sections'
import { DemoPlayer } from '../demo/demo-player'
import { pregenerateNarration } from '@/lib/tts-server'

// Public showcase of the scene grammar (not indexed). Every line is pre-voiced; this only voices missing lines.
const LESSON = flattenSections(SHOWCASE_SECTIONS)
let voiced = false
export const maxDuration = 300
export const dynamic = 'force-dynamic'
export const metadata = {
  title: `${SHOWCASE_LESSON.title} · GeniusMap`,
  description: 'Three narrated 3Blue1Brown-style animations from the GeniusMap scene grammar.',
  robots: { index: false },
}

export default function ShowcasePage() {
  if (!voiced) {
    voiced = true
    after(() => pregenerateNarration(LESSON.steps, 250_000).then(r => { if (!r.done) voiced = false }))
  }
  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-6 sm:px-6 md:py-10">
      <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">{SHOWCASE_LESSON.subject} · Showcase</p>
      <h1 className="mt-2 font-display text-[30px] leading-[1.1] text-ink md:text-[38px]">{SHOWCASE_LESSON.title}</h1>
      <p className="mt-2 text-[14px] text-muted">About {formatDuration(estimateMs(LESSON.steps))} · {LESSON.chapters.length} sections · drawn in the GeniusMap scene grammar</p>
      <div className="mt-6">
        <Suspense fallback={null}>
          <DemoPlayer steps={LESSON.steps} chapters={LESSON.chapters} title={SHOWCASE_LESSON.title} />
        </Suspense>
      </div>
    </main>
  )
}

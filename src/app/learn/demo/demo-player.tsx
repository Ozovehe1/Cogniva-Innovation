'use client'
import { useSearchParams } from 'next/navigation'
import { WhiteboardPlayer } from '@/components/whiteboard'
import type { Step } from '@/lib/lesson-schema'
import type { Chapter } from '@/lib/lesson-sections'

export function DemoPlayer({ steps, chapters, title }: { steps: Step[]; chapters?: Chapter[]; title?: string }) {
  // ?at=N opens the lesson at step N (used for screenshots); ?auto=1 autoplays.
  const params = useSearchParams()
  const at = Number(params.get('at') ?? 0) || 0
  const auto = params.get('auto') === '1'
  return <WhiteboardPlayer steps={steps} chapters={chapters} title={title} initialIndex={at} autoPlay={auto} allowSkipChecks />
}

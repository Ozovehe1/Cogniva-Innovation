'use client'
import { WhiteboardPlayer } from '@/components/whiteboard'
import { INK_TEST_STEPS } from '@/lib/ink-test-lesson'

export function InkTestPlayer() {
  return <WhiteboardPlayer steps={INK_TEST_STEPS} title="Ink test" allowSkipChecks />
}

'use client'
import { ErrorView } from '@/components/system/error-view'

/** Inside the app shell: the nav stays, so the learner is never stranded. */
export default function StudentError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <ErrorView error={error} retry={unstable_retry} />
}

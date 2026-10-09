'use client'
import { useEffect } from 'react'
import Link from 'next/link'
import { RotateCcw } from 'lucide-react'
import { SystemMessage, buttonClass } from '@/components/ui'

/**
 * The "something went wrong" screen used by every error boundary. Anxiety-safe: it says it is our fault, that the
 * learner's progress is saved, and offers one primary way forward (Try again) plus a quiet way home.
 */
export function ErrorView({ error, retry, homeHref = '/dashboard' }: { error: Error & { digest?: string }; retry: () => void; homeHref?: string }) {
  useEffect(() => { console.error(error) }, [error])
  return (
    <SystemMessage
      eyebrow="Something went wrong"
      title="That didn’t load. It’s on our side, not yours."
      actions={<>
        <button type="button" onClick={retry} className={buttonClass('primary', 'lg')}><RotateCcw className="h-4 w-4" strokeWidth={2} />Try again</button>
        <Link href={homeHref} className={buttonClass('secondary', 'lg')}>Go to Home</Link>
      </>}
    >
      <p>Your lessons and progress are saved. Trying again usually fixes it; if it keeps happening, come back in a few minutes.</p>
      {error.digest && <p className="tnum mt-3 text-[12px] text-faint">Reference: {error.digest}</p>}
    </SystemMessage>
  )
}

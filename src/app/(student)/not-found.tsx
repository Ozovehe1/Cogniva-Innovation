import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { LostMapArt, SystemMessage, buttonClass } from '@/components/ui'

/** In-app 404 (a deleted lesson, an old link): the nav stays put and one button leads back to learning. */
export default function StudentNotFound() {
  return (
    <SystemMessage
      art={<LostMapArt />}
      eyebrow="Not found"
      title="We couldn’t find that lesson."
      actions={<>
        <Link href="/learn" className={buttonClass('primary', 'lg')}>See your lessons<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>
        <Link href="/dashboard" className={buttonClass('secondary', 'lg')}>Go to Home</Link>
      </>}
    >
      <p>It may have been deleted, or the link is from another account. Your path and progress are unchanged.</p>
    </SystemMessage>
  )
}

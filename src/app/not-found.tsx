import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { LostMapArt, Logo, SystemMessage, buttonClass } from '@/components/ui'

export const metadata = { title: 'Page not found · Ideanimo', robots: { index: false } }

/** 404: a calm, on-brand dead end with one way back (never the framework's bare "404 | not found"). */
export default function NotFound() {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="pt-safe mx-auto flex h-16 max-w-[1120px] items-center px-5 md:px-8"><Logo /></header>
      <main className="px-5">
        <SystemMessage
          art={<LostMapArt />}
          eyebrow="Page not found"
          title="This page isn’t on the map."
          actions={<>
            <Link href="/dashboard" className={buttonClass('primary', 'lg')}>Back to your lessons<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>
            <Link href="/" className={buttonClass('secondary', 'lg')}>Ideanimo home</Link>
          </>}
        >
          <p>The link may be old, or the lesson may have been deleted. Nothing you’ve learned is lost.</p>
        </SystemMessage>
      </main>
    </div>
  )
}

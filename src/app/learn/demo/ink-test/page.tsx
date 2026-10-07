import { notFound } from 'next/navigation'
import { InkTestPlayer } from './ink-test-player'

// Test harness (not in production): every element type, played for scripts/test-ink-under-pen.py.
export const metadata = { title: 'Ink test · GeniusMap', robots: { index: false } }

export default function InkTestPage() {
  if (process.env.VERCEL_ENV === 'production') notFound()
  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-6">
      <InkTestPlayer />
    </main>
  )
}

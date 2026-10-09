import { Suspense } from 'react'
import { TutorLab } from './tutor-lab'

// Gallery of the tutor character's states and the illustration cards (fixed fixtures), for phone screenshots.
export const metadata = { title: 'Tutor lab · GeniusMap', robots: { index: false } }
export const dynamic = 'force-dynamic'

export default function TutorLabPage() {
  return (
    <main className="mx-auto w-full max-w-[760px] px-3 py-5">
      <Suspense><TutorLab /></Suspense>
    </main>
  )
}

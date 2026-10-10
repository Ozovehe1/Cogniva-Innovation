import { WaitingLab } from './waiting-lab'

// Gallery of every waiting and button state with fixed fixtures (no network), for 390 px and desktop screenshots.
export const metadata = { title: 'Waiting states · Ideanimo', robots: { index: false } }

export default function WaitingLabPage() {
  return (
    <main className="mx-auto w-full max-w-[760px] px-4 py-6">
      <WaitingLab />
    </main>
  )
}

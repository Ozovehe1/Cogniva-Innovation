import { VisualsLab } from './visuals-lab'

// Signed-in gallery of the agent's visual types (fixed fixtures), used for phone screenshots and manual checks.
export const metadata = { title: 'Visuals lab · GeniusMap', robots: { index: false } }
export const dynamic = 'force-dynamic'

export default async function VisualsPage() {
  return (
    <main className="mx-auto w-full max-w-[760px] px-3 py-5">
      <VisualsLab />
    </main>
  )
}

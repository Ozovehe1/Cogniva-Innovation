import { notFound } from 'next/navigation'

// Preview-only QA harness: shows a same-origin page in a fixed-width frame so a
// desktop browser can check phone layouts, e.g. /learn/demo/frame?w=375&path=/learn/demo?at=21
export const metadata = { title: 'Frame · GeniusMap', robots: { index: false } }

export default async function FramePage({ searchParams }: { searchParams: Promise<{ w?: string; h?: string; path?: string }> }) {
  if (process.env.VERCEL_ENV === 'production') notFound()
  const sp = await searchParams
  const w = Math.min(1600, Math.max(320, Number(sp.w) || 375))
  const h = Math.min(6000, Math.max(400, Number(sp.h) || 1400))
  const path = sp.path && sp.path.startsWith('/') && !sp.path.startsWith('//') ? sp.path : '/learn/demo'
  return (
    <div style={{ padding: 0, background: '#E5E1D8', minHeight: '100dvh' }}>
      <iframe src={path} title="Page preview" style={{ width: w, height: h, border: 0, display: 'block', background: '#fff' }} />
    </div>
  )
}

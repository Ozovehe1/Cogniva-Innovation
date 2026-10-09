'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Re-renders the server dashboard every `seconds` while the tab is visible. */
export function Refresher({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter()
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh() }, seconds * 1000)
    return () => clearInterval(t)
  }, [router, seconds])
  return null
}

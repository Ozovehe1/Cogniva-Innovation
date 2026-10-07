'use client'
import { useEffect } from 'react'
import { preloadHand3D } from './pen'

/** Warms the whiteboard's 3D hand once the page is idle, so the next lesson can show it straight away. */
export function HandPreload() {
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(preloadHand3D, { timeout: 4000 })
      return () => w.cancelIdleCallback?.(id)
    }
    const t = setTimeout(preloadHand3D, 1500)
    return () => clearTimeout(t)
  }, [])
  return null
}

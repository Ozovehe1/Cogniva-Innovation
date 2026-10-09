'use client'
import { useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

const AWAY_TIMEOUT_MS = 30 * 60 * 1000 // sign out 30 minutes after leaving the tab

export function IdleTimeout() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const signOut = useCallback(async () => {
    // Let open lessons save their exact position while the session is still valid.
    window.dispatchEvent(new Event('geniusmap:before-signout'))
    await new Promise(r => setTimeout(r, 600))
    const supabase = createClient()
    await supabase.auth.signOut()
    // Come back to the same page (e.g. the lesson) after signing in again.
    const next = window.location.pathname + window.location.search
    window.location.href = next && next !== '/' ? `/login?reason=away&next=${encodeURIComponent(next)}` : '/login?reason=away'
  }, [])

  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) {
        // User left the tab — start countdown
        timer.current = setTimeout(signOut, AWAY_TIMEOUT_MS)
      } else {
        // User came back — cancel
        if (timer.current) {
          clearTimeout(timer.current)
          timer.current = null
        }
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [signOut])

  return null
}

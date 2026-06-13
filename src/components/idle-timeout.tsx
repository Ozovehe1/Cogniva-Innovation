'use client'
import { useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

const AWAY_TIMEOUT_MS = 30 * 1000 // sign out 30s after leaving the tab

export function IdleTimeout() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const signOut = useCallback(async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
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

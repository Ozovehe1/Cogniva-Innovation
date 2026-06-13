'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

const IDLE_MS = 20 * 60 * 1000  // 20 minutes before warning
const WARN_SECS = 60              // 60-second countdown then auto sign-out

export function IdleTimeout() {
  const [countdown, setCountdown] = useState<number | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const signOut = useCallback(async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }, [])

  const resetIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    if (countTimer.current) clearInterval(countTimer.current)
    setCountdown(null)

    idleTimer.current = setTimeout(() => {
      let secs = WARN_SECS
      setCountdown(secs)
      countTimer.current = setInterval(() => {
        secs -= 1
        setCountdown(secs)
        if (secs <= 0) {
          clearInterval(countTimer.current!)
          signOut()
        }
      }, 1000)
    }, IDLE_MS)
  }, [signOut])

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click']
    events.forEach(e => window.addEventListener(e, resetIdle, { passive: true }))
    resetIdle()
    return () => {
      events.forEach(e => window.removeEventListener(e, resetIdle))
      if (idleTimer.current) clearTimeout(idleTimer.current)
      if (countTimer.current) clearInterval(countTimer.current)
    }
  }, [resetIdle])

  if (countdown === null) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}>
      <div className="p-6 rounded-2xl max-w-sm w-full mx-4 text-center" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.12)' }}>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
          ⏱
        </div>
        <h2 className="text-white font-semibold mb-2">Still there?</h2>
        <p className="text-zinc-500 text-sm mb-1">You&apos;ll be signed out in</p>
        <p className="text-3xl font-bold mb-4" style={{ color: countdown <= 10 ? '#EF4444' : '#F59E0B' }}>
          {countdown}s
        </p>
        <p className="text-zinc-600 text-xs mb-5">due to inactivity</p>
        <button onClick={resetIdle}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition"
          style={{ background: '#7C3AED' }}>
          I&apos;m still here
        </button>
      </div>
    </div>
  )
}

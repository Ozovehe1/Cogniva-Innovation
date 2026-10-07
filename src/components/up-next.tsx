'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { buttonClass } from './ui'

/**
 * "Up next" card shown when a lesson (or its mastery check) ends: it counts down and opens the next thing on the
 * learner's path by itself, so learning carries on with no tap. Cancel stops the countdown; the link still works.
 */
export function UpNextCard({ href, eyebrow = 'Up next', title, note, seconds = 6 }: {
  href: string
  eyebrow?: string
  title: string
  note?: string
  /** Countdown before it starts by itself (0 = no auto-start). */
  seconds?: number
}) {
  const router = useRouter()
  const [left, setLeft] = useState(seconds)
  const [cancelled, setCancelled] = useState(seconds <= 0)
  useEffect(() => { router.prefetch(href) }, [router, href])
  useEffect(() => {
    if (cancelled) return
    const t0 = Date.now()
    const t = setInterval(() => {
      const l = Math.max(0, seconds - Math.floor((Date.now() - t0) / 1000))
      setLeft(l)
      if (l <= 0) { clearInterval(t); router.push(href) }
    }, 250)
    return () => clearInterval(t)
  }, [cancelled, seconds, href, router])
  const pct = cancelled ? 0 : ((seconds - left) / Math.max(1, seconds)) * 100
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mt-4 overflow-hidden rounded-[14px] border border-accent-line bg-accent-soft"
      role="status"
      aria-live="polite"
      data-up-next={href}
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-accent">{eyebrow}</p>
          <p className="mt-0.5 font-display text-[20px] leading-snug text-ink">{title}</p>
          {note && <p className="mt-0.5 text-[14px] text-ink-2">{note}</p>}
          {!cancelled && <p className="tnum mt-1 text-[13px] text-muted">Starting in {left} s</p>}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => router.push(href)} className={buttonClass('primary', 'md')}>
            {cancelled ? 'Start' : 'Start now'}<ArrowRight className="h-4 w-4" strokeWidth={2} />
          </button>
          {!cancelled && <button type="button" onClick={() => setCancelled(true)} className={buttonClass('ghost', 'md')}>Cancel</button>}
        </div>
      </div>
      <div className="h-1 bg-accent/15"><div className="h-full bg-accent transition-[width] duration-200 ease-linear" style={{ width: `${pct}%` }} /></div>
    </motion.div>
  )
}

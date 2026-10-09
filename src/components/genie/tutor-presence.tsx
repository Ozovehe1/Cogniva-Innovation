'use client'
/**
 * The tutor character's frame: a fixed-size avatar (space reserved, so nothing shifts when it loads), a live status
 * line for screen readers, and a show/hide toggle the learner's choice is remembered for. The Rive runtime and the
 * .riv are fetched only when this is on screen and the browser is idle.
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion } from 'framer-motion'
import { EyeOff, Smile } from 'lucide-react'
import { cx, Skeleton } from '@/components/ui'
import { GENIE_ENABLED, MOOD_LABEL, prefersReducedMotion, setGenieVisible, useGenieMood, useGenieVisible } from './presence'
import { installNarratorSpeaker } from './lipsync'

const GenieCanvas = dynamic(() => import('./genie-canvas'), { ssr: false })

/** Still drawing of Genie: shown if the animated character cannot load (old browser, blocked WebAssembly). */
export function GeniePoster({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden>
      <ellipse cx="100" cy="182" rx="48" ry="6" fill="#000" opacity="0.12" />
      <rect x="41" y="58" width="118" height="112" rx="52" fill="#3E9A72" stroke="#2E7A58" strokeWidth="3" />
      <ellipse cx="100" cy="142" rx="33" ry="21" fill="#BFE8D3" />
      <ellipse cx="78" cy="106" rx="15" ry="17" fill="#fff" stroke="#1D2A33" strokeWidth="2.5" /><ellipse cx="122" cy="106" rx="15" ry="17" fill="#fff" stroke="#1D2A33" strokeWidth="2.5" />
      <ellipse cx="78" cy="108" rx="7.5" ry="8.5" fill="#1D2A33" /><ellipse cx="122" cy="108" rx="7.5" ry="8.5" fill="#1D2A33" />
      <path d="M87 129 Q100 141 113 129" fill="none" stroke="#1D2A33" strokeWidth="3.2" strokeLinecap="round" />
      <ellipse cx="64" cy="122" rx="8" ry="4.5" fill="#F7A08F" opacity="0.8" /><ellipse cx="136" cy="122" rx="8" ry="4.5" fill="#F7A08F" opacity="0.8" />
      <path d="M100 58 v-14" stroke="#3E9A72" strokeWidth="4" strokeLinecap="round" /><ellipse cx="90" cy="44" rx="10" ry="5.5" fill="#6CC08A" transform="rotate(34 90 44)" /><ellipse cx="111" cy="42" rx="11" ry="6" fill="#6CC08A" transform="rotate(-34 111 42)" />
    </svg>
  )
}

function useNearAndIdle(ref: React.RefObject<HTMLElement | null>) {
  const [go, setGo] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || go) return
    let idle = 0
    const start = () => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
      if (ric) idle = ric(() => setGo(true), { timeout: 1500 }); else idle = window.setTimeout(() => setGo(true), 300)
    }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); start() } }, { rootMargin: '120px' })
    io.observe(el)
    return () => { io.disconnect(); window.clearTimeout(idle) }
  }, [ref, go])
  return go
}

const subscribeReducedMotion = (cb: () => void) => {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/** The avatar alone (fixed size). */
export function GenieAvatar({ size = 56, look, className }: { size?: number; look?: { x: number; y: number }; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const go = useNearAndIdle(ref)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const reduced = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false)
  useEffect(() => { installNarratorSpeaker() }, [])
  return (
    <div ref={ref} className={cx('relative flex-shrink-0 overflow-hidden rounded-full bg-accent-soft ring-1 ring-accent-line', className)} style={{ width: size, height: size }}>
      {status === 'loading' && <Skeleton className="absolute inset-[14%] rounded-full" />}
      {status === 'error' && <GeniePoster className="absolute inset-0 h-full w-full origin-center translate-y-[3%] scale-[1.15]" />}
      {go && status !== 'error' && (
        // Framed close on the face (the artboard has room for sparkles and thought dots around the body).
        <div className={cx('absolute inset-0 origin-center translate-y-[3%] scale-[1.15] transition-opacity duration-500 ease-out', status === 'ready' ? 'opacity-100' : 'opacity-0')}>
          <GenieCanvas reducedMotion={reduced} look={look} onReady={() => setStatus('ready')} onError={() => setStatus('error')} />
        </div>
      )}
    </div>
  )
}

/**
 * Header/lesson strip: avatar, "Your tutor · Listening", and a 44px hide/show toggle.
 * variant "lesson" sits above the whiteboard; "header" fits a sheet or page header.
 */
export function TutorPresence({ variant = 'header', look, className, title }: { variant?: 'header' | 'lesson'; look?: { x: number; y: number }; className?: string; /** Shown in place of the character when it is hidden. */ title?: React.ReactNode }) {
  const visible = useGenieVisible()
  const mood = useGenieMood()
  if (!GENIE_ENABLED) return title ? <div className={cx('flex min-h-11 items-center', className)}>{title}</div> : null
  const size = variant === 'lesson' ? 52 : 44
  return (
    <div className={cx('flex min-h-11 items-center gap-3', className)}>
      <AnimatePresence initial={false} mode="popLayout">
        {visible ? (
          <motion.div key="on" className="flex min-w-0 flex-1 items-center gap-3" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }} transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}>
            <GenieAvatar size={size} look={look} />
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Your tutor</p>
              <p className="truncate text-[14px] font-medium leading-snug text-ink-2" aria-live="polite">
                <span className={cx('mr-1.5 inline-block h-2 w-2 rounded-full align-middle transition-colors', mood === 'thinking' ? 'bg-amber' : mood === 'talking' ? 'bg-accent' : mood === 'listening' ? 'bg-navy' : mood === 'happy' ? 'bg-accent' : mood === 'encouraging' ? 'bg-clay' : 'bg-line-strong')} aria-hidden />
                {MOOD_LABEL[mood]}
              </p>
            </div>
          </motion.div>
        ) : <motion.div key="off" className="min-w-0 flex-1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{title}</motion.div>}
      </AnimatePresence>
      <button type="button" onClick={() => setGenieVisible(!visible)} aria-pressed={!visible}
        aria-label={visible ? 'Hide the tutor character' : 'Show the tutor character'}
        className={cx('inline-flex h-11 flex-shrink-0 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          visible ? 'w-11 text-muted hover:bg-sunken hover:text-ink' : 'border border-line bg-surface px-3.5 text-ink-2 shadow-[var(--shadow-card)] hover:border-line-strong')}>
        {visible ? <EyeOff className="h-[18px] w-[18px]" strokeWidth={1.9} /> : <><Smile className="h-4 w-4 text-accent" strokeWidth={2} />Show tutor</>}
      </button>
    </div>
  )
}

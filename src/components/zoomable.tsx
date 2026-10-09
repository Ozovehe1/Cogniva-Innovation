'use client'
/**
 * Tap-to-zoom for pictures with small labels (library illustrations, the recap still). On a 390 px phone a 640-wide
 * textbook diagram renders its labels at 7–9 px; one tap opens it full screen at 2× with pinch / scroll to pan, so the
 * labels are readable without leaving the lesson (cognitive load: no context switch; Fitts: the whole picture is the
 * target). Escape, the close button (44 px, thumb zone) or a tap on the backdrop closes it and focus returns.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Maximize2, Minus, Plus, X } from 'lucide-react'
import { cx } from './ui'

const EASE = [0.2, 0, 0, 1] as const
const LEVELS = [1, 1.6, 2.4, 3.2]

export function ZoomableImage({ src, alt, className, imgClassName, label = 'Tap to zoom', onLoad, onError, imgRef, loading, children }: {
  src: string
  alt: string
  className?: string
  imgClassName?: string
  /** The chip shown on the picture (phones) / on hover (desktop). */
  label?: string
  onLoad?: () => void
  onError?: () => void
  imgRef?: React.Ref<HTMLImageElement>
  loading?: 'lazy' | 'eager'
  /** Extra overlay inside the trigger (e.g. a skeleton). */
  children?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [n, setN] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()) }, [])
  return (
    <>
      <button ref={trigger} type="button" onClick={() => { setN(x => x + 1); setOpen(true) }} aria-label={`${alt}. Open larger`} aria-haspopup="dialog"
        className={cx('group/zoom relative block w-full cursor-zoom-in text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent', className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={imgRef} src={src} alt="" loading={loading} decoding="async" onLoad={onLoad} onError={onError} className={imgClassName} />
        {children}
        {/* Phones: the chip sits in its own strip under the picture, so it never covers the picture's own credit line or
            labels in its corner. Desktop: it floats over the corner on hover / focus only. */}
        <span aria-hidden className="pointer-events-none mb-2 ml-auto mr-2 flex h-8 w-fit items-center gap-1.5 rounded-full bg-ink/75 px-2.5 text-[12px] font-medium text-white opacity-90 shadow-[var(--shadow-raised)] backdrop-blur-sm transition-opacity duration-150 md:absolute md:bottom-2 md:right-2 md:m-0 md:opacity-0 md:group-hover/zoom:opacity-100 md:group-focus-visible/zoom:opacity-100">
          <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />{label}
        </span>
      </button>
      <ZoomDialog key={n} open={open} src={src} alt={alt} onClose={close} />
    </>
  )
}

function ZoomDialog({ open, src, alt, onClose }: { open: boolean; src: string; alt: string; onClose: () => void }) {
  // Phones open at 160 %: the point of opening is to read the small labels. (A fresh dialog per opening: keyed.)
  const [lvl, setLvl] = useState(() => (typeof window !== 'undefined' && window.innerWidth < 640 ? 1 : 0))
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '+' || e.key === '=') setLvl(l => Math.min(LEVELS.length - 1, l + 1))
      if (e.key === '-') setLvl(l => Math.max(0, l - 1))
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])
  // Only ever open after a tap, so this never renders during SSR/hydration.
  if (!open || typeof document === 'undefined') return null
  const scale = LEVELS[lvl]
  // Rendered only while open (no exit animation): closing must be instant and certain.
  return createPortal(
    (
        <motion.div className="fixed inset-0 z-[95] flex flex-col bg-[#F7F5F0]" role="dialog" aria-modal="true" aria-label={alt}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease: EASE }}>
          <div className="pt-safe flex items-center justify-between gap-3 border-b border-line bg-surface/90 px-3 py-1.5 backdrop-blur-sm">
            <p className="min-w-0 truncate pl-1 text-[14px] font-medium text-ink-2">{alt}</p>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close the larger picture"
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-sunken"><X className="h-5 w-5" /></button>
          </div>
          {/* Scroll / pinch to pan; the browser's own pinch-zoom still works on top (touch-action: pinch-zoom). */}
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain [touch-action:pan-x_pan-y_pinch-zoom]" onClick={e => { if (e.target === e.currentTarget && lvl === 0) onClose() }}>
            <motion.div className="mx-auto p-4" style={{ width: `${scale * 100}%`, maxWidth: scale === 1 ? 900 : undefined }} layout transition={{ duration: 0.24, ease: EASE }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={alt} className="block h-auto w-full rounded-[10px] border border-line bg-white" />
            </motion.div>
          </div>
          <div className="pb-safe flex items-center justify-center gap-2 border-t border-line bg-surface/90 px-3 py-2 backdrop-blur-sm">
            <button type="button" onClick={() => setLvl(l => Math.max(0, l - 1))} disabled={lvl === 0} aria-label="Zoom out"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-ink-2 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
            <span className="tnum w-14 text-center text-[13px] font-medium text-ink-2" aria-live="polite">{Math.round(scale * 100)}%</span>
            <button type="button" onClick={() => setLvl(l => Math.min(LEVELS.length - 1, l + 1))} disabled={lvl === LEVELS.length - 1} aria-label="Zoom in"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-ink-2 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
          </div>
        </motion.div>
    ),
    document.body,
  )
}

/* ── Zoom for pictures drawn inside the whiteboard SVG (a board `figure`): one host per page, opened by event. ── */

const ZOOM_EVENT = 'geniusmap:zoom'

/** Open the zoom view for a picture (used by board figures, which live inside an <svg> and can't hold a button). */
export function openZoom(src: string, alt: string) {
  window.dispatchEvent(new CustomEvent(ZOOM_EVENT, { detail: { src, alt } }))
}

/** Mounted once in the app shell: listens for openZoom() and shows the same zoom dialog. */
export function ZoomHost() {
  const [pic, setPic] = useState<{ src: string; alt: string } | null>(null)
  const [last, setLast] = useState<{ src: string; alt: string }>({ src: '', alt: '' })
  const [n, setN] = useState(0)
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<{ src: string; alt: string }>).detail; if (d?.src) { setN(x => x + 1); setPic(d); setLast(d) } }
    window.addEventListener(ZOOM_EVENT, on)
    return () => window.removeEventListener(ZOOM_EVENT, on)
  }, [])
  const close = useCallback(() => setPic(null), [])
  return <ZoomDialog key={n} open={!!pic} src={pic?.src ?? last.src} alt={pic?.alt ?? last.alt} onClose={close} />
}

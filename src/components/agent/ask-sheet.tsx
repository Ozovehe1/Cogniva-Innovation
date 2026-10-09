'use client'
import React, { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Sparkles, X } from 'lucide-react'
import { AgentChat } from './chat'
import { TutorPresence } from '@/components/genie/tutor-presence'
import { SheetGrabber } from '@/components/ui'

/** "Ask GeniusMap" inside a lesson: a floating button that opens the chat as a sheet, with the lesson as context. */
export function AskSheet({ lessonId, minor }: { lessonId: string; minor?: boolean | null }) {
  const [open, setOpen] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open])
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Ask GeniusMap about this lesson"
        className="fixed bottom-[calc(84px+env(safe-area-inset-bottom))] right-4 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-ink pl-4 pr-5 ring-4 ring-canvas text-[14px] font-medium text-white shadow-[var(--shadow-raised)] transition-transform hover:scale-[1.02] md:bottom-8 md:right-8">
        <Sparkles className="h-4 w-4" strokeWidth={2} />Ask about this
      </button>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[70] flex items-end justify-center md:items-stretch md:justify-end" role="dialog" aria-modal="true" aria-label="Ask GeniusMap">
            <motion.div className="absolute inset-0 bg-ink/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.div className="relative flex h-[88dvh] w-full flex-col rounded-t-[18px] border-t border-line bg-canvas md:h-full md:max-w-[520px] md:rounded-none md:border-l md:border-t-0"
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}>
              <SheetGrabber className="md:hidden" />
              <div className="flex items-center justify-between gap-2 border-b border-line py-2 pl-4 pr-2">
                <TutorPresence className="min-w-0 flex-1" title={<p className="font-display text-[19px] text-ink">Ask GeniusMap</p>} />
                <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink"><X className="h-5 w-5" /></button>
              </div>
              <div className="min-h-0 flex-1">
                <AgentChat compact lessonId={lessonId} initialSessionId={sessionId} onSession={setSessionId} minor={minor} />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}

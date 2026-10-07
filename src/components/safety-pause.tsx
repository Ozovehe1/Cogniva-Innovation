'use client'
import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Phone } from 'lucide-react'
import { HELPLINES } from '@/lib/safety'
import { buttonClass } from './ui'

/**
 * Shown when something a learner typed suggests distress. The lesson or intake is
 * paused; one calm message, Nigerian helplines, and for under-18s a nudge to tell
 * a trusted adult. The AI does not try to counsel.
 */
export function SafetyPause({ open, minor, onContinue }: { open: boolean; minor?: boolean | null; onContinue: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="safety-title">
          <motion.div className="absolute inset-0 bg-ink/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            className="pb-safe relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[18px] border border-line bg-surface p-6 shadow-[var(--shadow-raised)] sm:rounded-[18px] sm:p-8"
            initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
          >
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Let’s pause here</p>
            <h2 id="safety-title" className="mt-2 font-display text-[26px] leading-tight text-ink">It sounds like things might be really hard right now.</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
              Thank you for saying it. I’m an AI tutor, so I can’t give you the support a person can, but you don’t have to
              deal with this alone. These people are there to listen, any time:
            </p>
            <ul className="mt-5 divide-y divide-line rounded-[12px] border border-line">
              {HELPLINES.map(h => (
                <li key={h.tel}>
                  <a href={`tel:${h.tel}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-sunken">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                      <Phone className="h-4 w-4" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-ink">{h.phone}</span>
                      <span className="block text-[13px] leading-snug text-muted">{h.name} · {h.note}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            {minor !== false && (
              <p className="mt-5 rounded-[12px] border border-accent-line bg-accent-soft px-4 py-3 text-[15px] leading-relaxed text-ink">
                {minor ? 'Please' : 'If you’re under 18, please'} tell a trusted adult how you’re feeling: a parent or guardian, a teacher, a school counsellor, or a relative.
              </p>
            )}
            <p className="mt-5 text-[14px] leading-relaxed text-muted">Your lesson will wait for you. Come back whenever you’re ready.</p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <a href={`tel:${HELPLINES[0].tel}`} className={buttonClass('primary', 'lg', 'sm:flex-1')}>Call {HELPLINES[0].phone}</a>
              <button type="button" onClick={onContinue} className={buttonClass('secondary', 'lg', 'sm:flex-1')}>I’m okay to continue</button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

'use client'
/**
 * "Report a mistake" — one tap from anything GeniusMap teaches (lesson board, live figure, picture, animation, Ask answer,
 * check). The sheet is calm and growth-framed (spotting an error is a skill, not a failure), every target is ≥44px,
 * category and note are optional, and the reply thanks the learner and offers a corrected version straight away.
 * Learning principles (docs/design/lesson-ui.md): reduced threat (no blame, nothing timed), autonomy (optional fields,
 * "Not now"), growth feedback ("this makes GeniusMap better for everyone"), Hick's law (five plain categories).
 */
import React, { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, Eye, Flag, RotateCcw, X } from 'lucide-react'
import { Pending, buttonClass, cx, textareaClass } from '@/components/ui'

export type ReportCategory = 'wrong_maths' | 'wrong_picture' | 'confusing' | 'typo' | 'other'
export interface ReportPayload {
  surface: 'lesson_step' | 'stage' | 'diagram' | 'illustration' | 'animation' | 'ask' | 'check' | 'practice' | 'mastery'
  artefact?: Record<string, unknown>
  lessonId?: string | null
  stepIndex?: number | null
  sessionId?: string | null
  blockId?: string | null
  text?: string
  query?: string
  clipJobId?: string | null
}
export interface ReportResult { id: string; retry?: { prompt: string }; category: ReportCategory | null; note: string }

const CATEGORIES: { id: ReportCategory; label: string; hint: string }[] = [
  { id: 'wrong_maths', label: 'Wrong maths', hint: 'A number, sum or step is off' },
  { id: 'wrong_picture', label: 'Wrong picture', hint: 'The drawing doesn’t match' },
  { id: 'confusing', label: 'Confusing', hint: 'It didn’t make sense' },
  { id: 'typo', label: 'Typo', hint: 'A spelling or label slip' },
  { id: 'other', label: 'Something else', hint: '' },
]

/** The small trigger placed under a piece of teaching output. */
export function ReportButton({ payload, onReported, onDone, onRetry, what = 'this', className, compact = false, short = false, defaultCategory }: {
  /** Built at send time (the category is known by then), so a picture complaint can target the picture. */
  payload: (category: ReportCategory | null) => ReportPayload | null
  /** Right after the report is stored (the sheet is still showing its thanks). */
  onReported?: (r: ReportResult) => void
  /** When the sheet closes after a report (flag the artefact here if flagging unmounts this button). */
  onDone?: (r: ReportResult) => void
  /** Offer a corrected version once the report is in. */
  onRetry?: (r: ReportResult) => void
  /** "this picture", "this answer"… used in the sheet's copy. */
  what?: string
  className?: string
  compact?: boolean
  /** "Report" on phones (tight rows), "Report a mistake" from sm up. */
  short?: boolean
  defaultCategory?: ReportCategory
}) {
  const [open, setOpen] = useState(false)
  // A fresh sheet each time it opens (no stale note or category).
  const [n, setN] = useState(0)
  const sent = useRef<ReportResult | null>(null)
  const close = () => { setOpen(false); const r = sent.current; sent.current = null; if (r) onDone?.(r) }
  return (
    <>
      <button type="button" onClick={() => { setN(x => x + 1); setOpen(true) }} aria-label={`Report a mistake in ${what}`} aria-haspopup="dialog"
        className={cx('inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium text-muted transition-colors hover:bg-sunken hover:text-ink-2 focus-visible:outline-2 focus-visible:outline-accent', className)}>
        <Flag className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />{compact ? <span className="sr-only">Report a mistake</span> : short ? <><span className="sm:hidden">Report</span><span className="hidden sm:inline">Report a mistake</span></> : 'Report a mistake'}
      </button>
      <ReportSheet key={n} open={open} onClose={close} payload={payload} onReported={r => { sent.current = r; onReported?.(r) }} onRetry={onRetry} what={what} defaultCategory={defaultCategory} />
    </>
  )
}

export function ReportSheet({ open, onClose, payload, onReported, onRetry, what, defaultCategory, forceState }: {
  open: boolean; onClose: () => void
  payload: (category: ReportCategory | null) => ReportPayload | null
  onReported?: (r: ReportResult) => void
  onRetry?: (r: ReportResult) => void
  what: string
  defaultCategory?: ReportCategory
  /** Lab/screenshot only. */
  forceState?: 'sent'
}) {
  const ids = useId()
  const reduced = useReducedMotion()
  const [category, setCategory] = useState<ReportCategory | null>(defaultCategory ?? null)
  const [note, setNote] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>(forceState ?? 'idle')
  const [result, setResult] = useState<ReportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const firstRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => firstRef.current?.focus(), 60)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && state !== 'sending') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, state, onClose])

  const send = async () => {
    const p = payload(category)
    if (!p) { setError('This part can’t be reported right now.'); setState('error'); return }
    setState('sending'); setError(null)
    try {
      const res = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...p, category, note: note.trim() || undefined }) })
      const j = await res.json().catch(() => ({})) as { id?: string; retry?: { prompt: string }; error?: string }
      if (!res.ok || !j.id) { setError(j.error ?? 'That didn’t send. Your note is still here — try again.'); setState('error'); return }
      const r: ReportResult = { id: j.id, retry: j.retry, category, note: note.trim() }
      setResult(r); setState('sent')
      onReported?.(r)
    } catch {
      setError('No connection just now. Your note is still here — try again.'); setState('error')
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-labelledby={`${ids}-t`}>
          <motion.div className="absolute inset-0 bg-ink/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => state !== 'sending' && onClose()} />
          <motion.div
            className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[20px] border-t border-line bg-surface px-5 pb-[calc(20px+env(safe-area-inset-bottom))] pt-3 shadow-[var(--shadow-raised)] md:max-w-[460px] md:rounded-[18px] md:border md:pb-6 md:pt-5"
            initial={reduced ? { opacity: 0 } : { y: 32, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reduced ? { opacity: 0 } : { y: 32, opacity: 0 }} transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}>
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong md:hidden" aria-hidden />
            {state === 'sent' ? (
              <div className="pb-1 pt-2 text-center" role="status">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent"><Check className="h-6 w-6" strokeWidth={2.25} aria-hidden /></span>
                <h2 id={`${ids}-t`} className="mt-4 font-display text-[24px] leading-tight text-ink">Thanks — this makes GeniusMap better for everyone</h2>
                <p className="mx-auto mt-2 max-w-[34ch] text-[15px] leading-relaxed text-ink-2">Spotting a mistake is real thinking. We’ve set {what} aside for you while a teammate checks it.</p>
                <div className="mt-6 grid gap-2">
                  {onRetry && result && (
                    <button type="button" onClick={() => { onRetry(result); onClose() }} className={cx(buttonClass('primary', 'md'), 'min-h-12 w-full justify-center')}>
                      <RotateCcw className="h-4 w-4" aria-hidden />Show me a corrected version
                    </button>
                  )}
                  <button type="button" onClick={onClose} className={cx(buttonClass(onRetry ? 'ghost' : 'primary', 'md'), 'min-h-12 w-full justify-center')}>{onRetry ? 'Keep going' : 'Done'}</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Report a mistake</p>
                    <h2 id={`${ids}-t`} className="mt-1 font-display text-[24px] leading-tight text-ink">Spotted something off?</h2>
                  </div>
                  <button type="button" onClick={onClose} disabled={state === 'sending'} aria-label="Close" className="-mr-2 -mt-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink"><X className="h-5 w-5" /></button>
                </div>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">Good eye. Tell us what looked wrong in {what} — every report is read, and it helps the next learner too.</p>
                <fieldset className="mt-5">
                  <legend className="mb-2 text-[13px] font-medium text-ink-2">What kind of mistake? <span className="font-normal text-muted">(optional)</span></legend>
                  <div className="grid grid-cols-2 gap-2">
                    {CATEGORIES.map((c, i) => {
                      const on = category === c.id
                      return (
                        <button key={c.id} ref={i === 0 ? firstRef : undefined} type="button" role="radio" aria-checked={on} onClick={() => setCategory(on ? null : c.id)}
                          className={cx('flex min-h-12 flex-col items-start justify-center rounded-[12px] border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent',
                            c.id === 'other' && 'col-span-2', on ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong')}>
                          <span className={cx('flex items-center gap-1.5 text-[14.5px] font-medium', on ? 'text-accent' : 'text-ink')}>{on && <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />}{c.label}</span>
                          {c.hint && <span className="text-[12px] leading-snug text-muted">{c.hint}</span>}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
                <label htmlFor={`${ids}-n`} className="mb-1.5 mt-5 block text-[13px] font-medium text-ink-2">What did you notice? <span className="font-normal text-muted">(optional)</span></label>
                <textarea id={`${ids}-n`} value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={600}
                  placeholder={category === 'wrong_maths' ? 'e.g. 7 × 8 should be 56, not 54' : category === 'wrong_picture' ? 'e.g. this shows a cell, not an atom' : 'A few words is plenty'}
                  className={cx(textareaClass, 'min-h-[88px] text-[16px]')} />
                {error && <p className="mt-3 rounded-[10px] border border-amber-line bg-amber-soft px-3 py-2 text-[14px] text-ink" role="alert">{error}</p>}
                <div className="mt-5 grid grid-cols-[1fr_2fr] gap-2">
                  <button type="button" onClick={onClose} disabled={state === 'sending'} className={cx(buttonClass('ghost', 'md'), 'min-h-12 justify-center')}>Not now</button>
                  <button type="button" onClick={send} disabled={state === 'sending'} className={cx(buttonClass('primary', 'md'), 'min-h-12 justify-center')}>
                    <Pending busy={state === 'sending'} label="Sending">Send report</Pending>
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

/** Shown in place of a flagged artefact for the learner who flagged it. */
export function FlaggedNotice({ what, onRetry, onShow, retrying = false, className }: { what: string; onRetry?: () => void; onShow?: () => void; retrying?: boolean; className?: string }) {
  return (
    <div className={cx('rounded-[14px] border border-dashed border-line-strong bg-[#FBFAF7] px-4 py-3.5', className)} role="note">
      <p className="flex items-center gap-2 text-[14px] font-medium text-ink"><Flag className="h-4 w-4 text-accent" strokeWidth={2} aria-hidden />You flagged {what}</p>
      <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">It’s set aside while we check it. Thanks for keeping GeniusMap honest.</p>
      {(onRetry || onShow) && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {onRetry && <button type="button" onClick={onRetry} disabled={retrying} className={cx(buttonClass('secondary', 'sm'), 'min-h-11')}><Pending busy={retrying} label="Asking for a corrected version"><RotateCcw className="h-3.5 w-3.5" aria-hidden />Show a corrected version</Pending></button>}
          {onShow && <button type="button" onClick={onShow} className={cx(buttonClass('ghost', 'sm'), 'min-h-11')}><Eye className="h-3.5 w-3.5" aria-hidden />Show it anyway</button>}
        </div>
      )}
    </div>
  )
}

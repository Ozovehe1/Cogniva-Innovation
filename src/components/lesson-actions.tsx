'use client'
import React, { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Download, FileText, Globe, Trash2 } from 'lucide-react'
import { deleteLesson } from '@/app/actions/lessons'
import { RichText } from './rich-text'
import { Spinner, buttonClass, cx } from './ui'

/** Delete button + confirm dialog for one of the learner's own lessons. */
export function LessonDelete({ lessonId, title, redirectTo, compact = false, inPath = false }: {
  lessonId: string
  title: string
  /** Where to go after deleting (the lesson page sends the learner back to /learn). */
  redirectTo?: string
  /** Icon-only on small screens (lesson cards). */
  compact?: boolean
  /** The lesson belongs to a path topic (the topic stays and can be written again). */
  inPath?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pending) setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, pending])

  const confirm = () => {
    setError(null)
    start(async () => {
      const res = await deleteLesson(lessonId).catch(() => ({ ok: false as const, error: 'Could not delete the lesson. Please try again.' }))
      if (!res.ok) { setError(res.error); return }
      setOpen(false)
      if (redirectTo) router.replace(redirectTo)
      router.refresh()
    })
  }

  return (
    <>
      <button type="button" onClick={() => { setError(null); setOpen(true) }} aria-label="Delete lesson"
        className={cx(buttonClass('ghost', 'md'), 'text-muted hover:text-danger hover:bg-danger-soft', compact && 'px-2.5 sm:px-4')}>
        <Trash2 className="h-4 w-4" strokeWidth={1.75} /><span className={compact ? 'hidden sm:inline' : undefined}>Delete</span>
      </button>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" role="alertdialog" aria-modal="true" aria-labelledby={`del-${lessonId}`} aria-describedby={`del-d-${lessonId}`}>
            <motion.div className="absolute inset-0 bg-ink/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !pending && setOpen(false)} />
            <motion.div className="pb-safe relative w-full max-w-md rounded-t-[18px] border border-line bg-surface p-6 shadow-[var(--shadow-raised)] sm:rounded-[18px]"
              initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} transition={{ duration: 0.2 }}>
              <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-danger">Delete lesson</p>
              <h2 id={`del-${lessonId}`} className="mt-1.5 font-display text-[22px] leading-snug text-ink"><RichText text={title} /></h2>
              <p id={`del-d-${lessonId}`} className="mt-3 text-[15px] leading-relaxed text-ink-2">
                This removes the lesson, your progress in it, its mastery check and its animations. It can’t be undone.
                {inPath && ' The topic stays on your path, and your tutor can write you a fresh lesson for it.'}
              </p>
              {error && <p className="mt-3 text-[14px] text-danger" role="alert">{error}</p>}
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button ref={cancelRef} type="button" onClick={() => setOpen(false)} disabled={pending} className={buttonClass('secondary', 'lg', 'sm:h-10 sm:px-4 sm:text-sm')}>Keep lesson</button>
                <button type="button" onClick={confirm} disabled={pending} className={buttonClass('danger', 'lg', 'sm:h-10 sm:px-4 sm:text-sm')}>
                  {pending ? <><Spinner />Deleting…</> : <><Trash2 className="h-4 w-4" strokeWidth={2} />Delete lesson</>}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}

/** Download menu: a self-contained HTML copy of the lesson, or its transcript as text. */
export function LessonDownload({ lessonId }: { lessonId: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])
  const item = 'flex w-full items-start gap-3 rounded-[10px] px-3 py-2.5 text-left hover:bg-sunken'
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} className={buttonClass('secondary', 'md')}>
        <Download className="h-4 w-4" strokeWidth={1.75} />Download<ChevronDown className="h-3.5 w-3.5 text-muted" strokeWidth={2} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-[14px] border border-line bg-surface p-1.5 shadow-[var(--shadow-raised)]">
          <a role="menuitem" href={`/api/lessons/${lessonId}/export?format=html`} download onClick={() => setOpen(false)} className={item}>
            <Globe className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" strokeWidth={1.75} />
            <span><span className="block text-sm font-medium text-ink">Offline lesson (.html)</span><span className="block text-[12px] leading-snug text-muted">Transcript, boards and clips in one file. Print it to save a PDF.</span></span>
          </a>
          <a role="menuitem" href={`/api/lessons/${lessonId}/export?format=txt`} download onClick={() => setOpen(false)} className={item}>
            <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" strokeWidth={1.75} />
            <span><span className="block text-sm font-medium text-ink">Transcript (.txt)</span><span className="block text-[12px] leading-snug text-muted">Just the words, with the in-lesson checks.</span></span>
          </a>
        </div>
      )}
    </div>
  )
}

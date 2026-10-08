'use client'
import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, FileText, Globe } from 'lucide-react'
import { buttonClass } from './ui'

export { LessonDelete } from './delete-dialog'

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

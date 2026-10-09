'use client'
/**
 * The end of a lesson (docs/design/lesson-ui.md §13): the lesson ends on a high (peak-end rule) with its key picture
 * once more (dual coding: the image the learner will remember the idea by) and the two or three lines the tutor
 * highlighted (signalling), plus what the learner did (competence: effort named, not a score).
 */
import React, { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Check, RotateCcw } from 'lucide-react'
import { RichText } from '@/components/rich-text'
import { buttonClass, cx } from '@/components/ui'
import { interactiveSvg, validateInteractive } from '@/lib/agent/interactive'
import type { Step } from '@/lib/lesson-schema'

const EASE = [0.2, 0, 0, 1] as const

/** The lesson's key figure (its last live figure) and its highlighted lines. Pure, exported for tests. */
export function lessonRecap(steps: Step[]): { figure: string | null; figureTitle: string | null; keys: { text: string; math: boolean }[] } {
  let figure: string | null = null, figureTitle: string | null = null
  for (let i = steps.length - 1; i >= 0 && !figure; i--) {
    const s = steps[i] as Step & { spec?: unknown; figure?: unknown }
    const raw = s.type === 'stage' ? s.spec : s.type === 'check' ? s.figure : undefined
    if (!raw) continue
    const v = validateInteractive(raw)
    if (v.spec && !v.spec.surface) { try { figure = interactiveSvg(v.spec); figureTitle = v.spec.title } catch { /* skip */ } }
  }
  const byId = new Map<string, { text: string; math: boolean }>()
  for (const s of steps) {
    const o = s as Step & { id?: string; text?: string; tex?: string; target?: string }
    if (o.type === 'write' && o.id && o.text) byId.set(o.id, { text: o.text, math: false })
    if (o.type === 'math' && o.id && o.tex) byId.set(o.id, { text: o.tex, math: true })
    if (o.type === 'transform' && o.target && o.tex && byId.has(o.target)) byId.set(o.target, { text: o.tex, math: true })
  }
  const keys: { text: string; math: boolean }[] = []
  for (const s of steps) {
    const o = s as Step & { target?: string }
    if ((o.type === 'highlight' || o.type === 'annotate') && o.target && byId.has(o.target)) {
      const k = byId.get(o.target)!
      if (!keys.some(x => x.text === k.text)) keys.push(k)
    }
  }
  return { figure, figureTitle, keys: keys.slice(-3) }
}

export function LessonRecap({ steps, title, answered, reduced, onReplay }: {
  steps: Step[]
  title?: string
  /** Questions the learner answered in this lesson. */
  answered: number
  reduced: boolean
  onReplay?: () => void
}) {
  const r = useMemo(() => lessonRecap(steps), [steps])
  const src = useMemo(() => (r.figure ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.figure)}` : null), [r.figure])
  const item = (i: number) => ({ initial: { opacity: 0, y: reduced ? 0 : 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: reduced ? 0.01 : 0.32, ease: EASE, delay: reduced ? 0 : 0.08 * i } })
  return (
    <motion.section {...item(0)} aria-label="Lesson recap" className="mt-4 overflow-hidden rounded-[14px] border border-accent-line bg-surface shadow-[var(--shadow-card)]">
      <div className="bg-accent-soft px-4 pb-3.5 pt-4">
        <p className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.08em] text-accent">
          <motion.span initial={reduced ? false : { scale: 0.5 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 20, delay: 0.15 }} className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white"><Check className="h-2.5 w-2.5" strokeWidth={3} /></motion.span>
          Lesson complete
        </p>
        {title && <h3 className="mt-1 font-display text-[20px] leading-snug text-ink"><RichText text={title} /></h3>}
        <p className="mt-0.5 text-[14px] text-ink-2">{answered > 0 ? `You worked through ${answered} question${answered === 1 ? '' : 's'} to get here.` : 'You made it to the end.'}</p>
      </div>
      {(src || r.keys.length > 0) && (
        <div className="grid gap-3 px-4 py-4">
          {src && (
            <motion.figure {...item(1)} className="m-0">
              <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">The picture to remember</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={r.figureTitle ?? 'Key figure'} className="mt-1.5 w-full rounded-[10px] border border-line" />
            </motion.figure>
          )}
          {r.keys.length > 0 && (
            <motion.div {...item(2)}>
              <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Key ideas</p>
              <ul className="mt-1.5 grid gap-1.5">
                {r.keys.map((k, i) => (
                  <li key={i} className="flex items-start gap-2.5 rounded-[10px] bg-sunken px-3 py-2 text-[15px] text-ink">
                    <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-clay" aria-hidden="true" />
                    <span className="min-w-0"><RichText text={k.math ? `$${k.text}$` : k.text} /></span>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </div>
      )}
      {onReplay && (
        <div className={cx('flex items-center justify-between gap-3 border-t border-line px-4 py-2.5')}>
          <p className="text-[13px] text-muted">Replay any step with the controls above.</p>
          <button type="button" onClick={onReplay} className={cx(buttonClass('ghost', 'md'), 'h-11')}><RotateCcw className="h-3.5 w-3.5" />From the top</button>
        </div>
      )}
    </motion.section>
  )
}

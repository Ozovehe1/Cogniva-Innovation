'use client'
/**
 * The figure inside a question (diagnostic, mastery check, practice set): a server-drawn static SVG or a credited
 * library picture, full width on a phone, with its alt text for screen readers and a "Not drawn to scale" note when
 * lengths or angles are given as numbers (docs/design/assessment.md §7).
 */
import React from 'react'
import type { PublicFigure } from '@/lib/assessment/spec'
import { cx } from './ui'

export function ItemFigure({ figure, className }: { figure?: PublicFigure | null; className?: string }) {
  if (!figure || (!figure.svg && !figure.src)) return null
  return (
    <figure className={cx('mt-4 overflow-hidden rounded-[12px] border border-line bg-[#FBFAF7]', className)}>
      {figure.svg ? (
        // Server-generated (interactiveSvg / Penrose, sanitised) or a cleaned library SVG; never model-written markup.
        <div role="img" aria-label={figure.alt} className="w-full [&>svg]:block [&>svg]:h-auto [&>svg]:max-h-[52vh] [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: figure.svg }} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={figure.src} alt={figure.alt} className="block h-auto max-h-[52vh] w-full object-contain" loading="eager" />
      )}
      {(figure.notToScale || figure.credit) && (
        <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-line px-3 py-1.5 text-[12px] leading-snug text-muted">
          {figure.notToScale && <span className="font-medium text-ink-2">Not drawn to scale</span>}
          {figure.credit && <span className="min-w-0 truncate">{figure.credit}</span>}
        </figcaption>
      )}
    </figure>
  )
}

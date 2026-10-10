'use client'
/** Shared frame for external stage tools: title, the tool, its attribution line, and a status line for its own check. */
import React from 'react'
import { cx } from '@/components/ui'

export function EmbedFrame({ title, credit, status, children, dark = false }: { title: string; credit: React.ReactNode; status?: { ok: boolean; text: string } | null; children: React.ReactNode; dark?: boolean }) {
  return (
    <figure className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-[var(--shadow-card)]">
      <figcaption className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2">
        <span className="min-w-0 truncate text-[14.5px] font-medium text-ink">{title}</span>
      </figcaption>
      <div className={cx('relative w-full', dark ? 'bg-[#0E1322]' : 'bg-white')}>{children}</div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3.5 py-2 text-[11.5px] leading-snug text-faint">
        <span>{credit}</span>
        {status && <span className={status.ok ? 'text-accent' : 'text-clay'}>{status.text}</span>}
      </div>
    </figure>
  )
}

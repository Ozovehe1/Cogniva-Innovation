'use client'
import { motion } from 'framer-motion'
import { Check, Info } from 'lucide-react'
import { cx } from '@/components/ui'
import { InkMark } from '@/components/system/wait'

export interface ToolState { name: string; label: string; state: string }

/** One chip per tool, latest state wins (the same label never shows twice). */
export function dedupeTools(tools: ToolState[]) {
  const out: ToolState[] = []
  for (const t of tools) { const k = out.findIndex(x => x.label === t.label); if (k >= 0) out[k] = t; else out.push(t) }
  return out
}

/**
 * What the tutor is doing while it answers ("Drawing on the board", "Checking the maths"). Running chips carry the
 * same ink mark as every other wait instead of a ping or spinner (a calm signal that work is happening: reduced uncertainty without a busy spinner);
 * finished ones settle to a small tick; a tool that failed is said plainly in neutral ink, never red, because the
 * answer usually carries on without it (low threat).
 */
/** hideRunning: during a live turn the running step is said once, in the turn status line, not twice. */
export function ToolChips({ tools, hideRunning = false }: { tools: ToolState[]; hideRunning?: boolean }) {
  const list = dedupeTools(tools).filter(t => !(hideRunning && t.state === 'start'))
  if (!list.length) return null
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="What your tutor is doing">
      {list.map((t, k) => {
        const running = t.state === 'start'
        const failed = t.state === 'error'
        return (
          <motion.li key={t.label} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: [0.2, 0, 0, 1], delay: k * 0.03 }}
            className={cx('inline-flex h-7 items-center gap-1.5 rounded-full border pl-2 pr-2.5 text-[12.5px] transition-colors duration-200',
              running ? 'border-accent-line bg-accent-soft text-accent' : failed ? 'border-line bg-sunken text-muted' : 'border-line bg-surface text-ink-2')}>
            {running ? <InkMark width={14} />
              : failed ? <Info className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> : <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.5} aria-hidden />}
            <span>{t.label}{failed ? ' — skipped' : ''}</span>
            <span className="sr-only">{running ? '(working)' : failed ? '(did not work, carrying on without it)' : '(done)'}</span>
          </motion.li>
        )
      })}
    </ul>
  )
}

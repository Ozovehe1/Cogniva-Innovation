import Link from 'next/link'
import { ArrowRight, BookOpen, Coffee, Eye, RotateCcw, Sparkles, Target } from 'lucide-react'
import { RichText } from '@/components/rich-text'
import { cx } from '@/components/ui'
import type { PlanItem } from '@/lib/agent/types'
import { ConfirmBlock } from './confirm'
import { UndoButton } from './undo-button'

export interface TodayData {
  items: PlanItem[]
  note: string | null
  light: boolean
  source: string
  due: number
  proposals: { id: string; title: string; detail: string }[]
  recent: { id: string; summary: string; at: string }[]
}

const ICON = { review: RotateCcw, lesson: BookOpen, check: Target, practice: Target, recap: Eye, remediation: RotateCcw, rest: Coffee } as const

/** Home "Today": the plan the Learning Director wrote (read only; opening Home makes no model call). */
export function TodayCard({ data }: { data: TodayData }) {
  return (
    <section className="mb-6 overflow-hidden rounded-[14px] border border-line bg-surface shadow-[var(--shadow-card)]" aria-labelledby="today-title">
      <div className="flex items-baseline justify-between gap-3 px-5 pt-5 md:px-6">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-accent">Today{data.light ? ' · a lighter day' : ''}</p>
          <h2 id="today-title" className="mt-1 font-display text-[24px] leading-snug text-ink">{data.note ?? 'Your plan for today'}</h2>
        </div>
        {data.due > 0 && <span className="tnum flex-shrink-0 rounded-full bg-amber-soft px-2.5 py-1 text-[12px] font-medium text-amber">{data.due} review{data.due === 1 ? '' : 's'} due</span>}
      </div>
      {data.items.length > 0 ? (
        <ol className="mt-3 divide-y divide-line border-t border-line">
          {data.items.map((it, i) => {
            const Icon = ICON[it.kind] ?? ArrowRight
            const body = (
              <>
                <span className={cx('mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full', it.kind === 'rest' ? 'bg-sunken text-muted' : 'bg-accent-soft text-accent')}><Icon className="h-4 w-4" strokeWidth={1.9} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium leading-snug text-ink"><RichText text={it.title} /></span>
                  {it.why && <span className="mt-0.5 block text-[13px] leading-snug text-muted"><RichText text={it.why} /></span>}
                </span>
                {it.minutes ? <span className="tnum flex-shrink-0 pt-0.5 text-[12px] text-muted">{it.minutes} min</span> : null}
              </>
            )
            return (
              <li key={i}>
                {it.href ? <Link href={it.href} className="flex items-start gap-3 px-5 py-3.5 hover:bg-sunken md:px-6">{body}</Link> : <div className="flex items-start gap-3 px-5 py-3.5 md:px-6">{body}</div>}
              </li>
            )
          })}
        </ol>
      ) : <p className="px-5 pb-4 pt-2 text-[14px] text-muted md:px-6">Nothing planned yet.</p>}
      {data.proposals.length > 0 && (
        <div className="space-y-3 border-t border-amber-line bg-amber-soft px-5 py-4 md:px-6">
          <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-amber">Your tutor suggests</p>
          {data.proposals.map(p => <ConfirmBlock key={p.id} compact block={{ actionId: p.id, title: p.title, detail: p.detail, status: 'proposed' }} />)}
        </div>
      )}
      {data.recent.length > 0 && (
        <details className="group border-t border-line px-5 py-3 md:px-6">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] text-muted"><Sparkles className="h-3.5 w-3.5 text-accent" />What your tutor changed recently <span className="text-faint">({data.recent.length})</span></summary>
          <ul className="mt-2 space-y-2">
            {data.recent.map(r => <li key={r.id} className="flex items-center gap-2 text-[13.5px] text-ink-2"><span className="min-w-0 flex-1"><RichText text={r.summary} /></span><UndoButton actionId={r.id} /></li>)}
          </ul>
        </details>
      )}
      <Link href="/ask" className="flex items-center justify-between gap-3 border-t border-line bg-[#FBFAF7] px-5 py-3.5 text-[14px] font-medium text-ink hover:bg-sunken md:px-6">
        <span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent" />Ask GeniusMap anything</span><ArrowRight className="h-4 w-4 text-accent" />
      </Link>
    </section>
  )
}

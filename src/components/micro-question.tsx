'use client'
/**
 * Progressive profiling (docs/design/onboarding.md): one optional micro-question at a natural pause, the end of
 * a lesson, instead of a long questionnaire up front. Asked once each (examples, next session, weekly time,
 * anxiety for maths/science, why it matters), at most one every 12 hours. Skipping always allowed.
 */
import React, { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check } from 'lucide-react'
import { Pending, buttonClass, cx, textareaClass } from './ui'

interface Q { id: string; kind: string; ask: string; sub?: string; choices?: { value: string; label: string; hint?: string }[]; anchors?: string[]; placeholder?: string }

const THANKS: Record<string, string> = {
  interests: 'Noted. Your next problems will be set in those.',
  next_session: 'It’s a plan. Your place will be ready.',
  hours: 'Thanks. I’ve sized your lessons and dates to fit.',
  anxiety: 'Thank you. I’ll keep things calm and show every step when it helps.',
  why: 'Thank you. I’ll connect lessons to that.',
}

export function MicroQuestion({ className }: { className?: string }) {
  const reduce = useReducedMotion()
  const [q, setQ] = useState<Q | null>(null)
  const [multi, setMulti] = useState<string[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void fetch('/api/intake/micro').then(r => (r.ok ? r.json() : null)).then(d => { if (live && d?.question) setQ(d.question) }).catch(() => {})
    return () => { live = false }
  }, [])
  if (!q) return null

  const send = async (answer: { v?: unknown; skipped?: boolean }) => {
    setBusy(true)
    const res = await fetch('/api/intake/micro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: q.id, answer }) }).catch(() => null)
    const d = res?.ok ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    setDone(answer.skipped ? '' : d.reflection || THANKS[q.id] || 'Thanks.')
  }

  return (
    <AnimatePresence>
      {done === null ? (
        <motion.section key="q" aria-label="A quick question" initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
          className={cx('mt-4 rounded-[14px] border border-line bg-surface p-5 shadow-[var(--shadow-card)]', className)}>
          <div className="flex items-start gap-3">
            <span aria-hidden className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent font-display text-[15px] text-white">I</span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">One quick question</p>
              <h2 className="mt-1 font-display text-[21px] leading-snug text-ink">{q.ask}</h2>
              {q.sub && <p className="mt-1 text-[14px] leading-relaxed text-muted">{q.sub}</p>}
            </div>
          </div>
          <div className="mt-4">
            {q.kind === 'choice' && (
              <div className="flex flex-wrap gap-2">
                {q.choices?.map(c => (
                  <button key={c.value} type="button" disabled={busy} onClick={() => send({ v: c.value })} className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-[15px] text-ink-2 transition-colors hover:border-accent active:scale-[0.97]">{c.label}</button>
                ))}
              </div>
            )}
            {q.kind === 'multi' && (
              <>
                <div className="flex flex-wrap gap-2">
                  {q.choices?.map(c => {
                    const on = multi.includes(c.value)
                    return (
                      <button key={c.value} type="button" aria-pressed={on} onClick={() => setMulti(m => (on ? m.filter(x => x !== c.value) : [...m, c.value].slice(0, 4)))}
                        className={cx('inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-[15px] transition-colors active:scale-[0.97]', on ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-ink-2 hover:border-line-strong')}>
                        {on && <Check className="h-4 w-4" strokeWidth={2.25} />}{c.label}
                      </button>
                    )
                  })}
                </div>
                <button type="button" disabled={busy || !multi.length} onClick={() => send({ v: multi })} className={buttonClass('primary', 'lg', 'mt-4 w-full sm:w-auto')}><Pending busy={busy} label="Saving">Save</Pending></button>
              </>
            )}
            {q.kind === 'scale' && (
              <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label={q.ask}>
                {(q.anchors ?? ['1', '2', '3', '4', '5']).map((a, i) => (
                  <button key={a} type="button" disabled={busy} onClick={() => send({ v: i + 1 })} aria-label={`${i + 1} of 5: ${a}`}
                    className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-[12px] border border-line bg-surface px-1 text-center transition-colors hover:border-accent active:scale-[0.97]">
                    <span className="tnum font-display text-[20px] text-ink">{i + 1}</span>
                    <span className="text-[11px] leading-tight text-muted">{a}</span>
                  </button>
                ))}
              </div>
            )}
            {q.kind === 'text' && (
              <>
                <textarea className={cx(textareaClass, 'min-h-[88px] text-[16px]')} value={text} maxLength={600} placeholder={q.placeholder} onChange={e => setText(e.target.value)} />
                <button type="button" disabled={busy || text.trim().length < 2} onClick={() => send({ v: text.trim() })} className={buttonClass('primary', 'lg', 'mt-3 w-full sm:w-auto')}><Pending busy={busy} label="Saving">Save</Pending></button>
              </>
            )}
          </div>
          <button type="button" disabled={busy} onClick={() => send({ skipped: true })} className="mt-3 inline-flex min-h-11 items-center text-[14px] font-medium text-muted hover:text-ink">Not now</button>
        </motion.section>
      ) : done ? (
        <motion.p key="t" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 flex items-center gap-2 rounded-[14px] border border-accent-line bg-accent-soft px-4 py-3 text-[15px] text-ink-2" role="status">
          <Check className="h-4 w-4 flex-shrink-0 text-accent" strokeWidth={2.5} />{done}
        </motion.p>
      ) : null}
    </AnimatePresence>
  )
}

'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { fill, isMinor, reflect, visibleItems, type Answer, type Answers, type IntakeItem } from '@/lib/intake'
import { detectDistress } from '@/lib/safety'
import { RichText } from './whiteboard/check-card'
import { SafetyPause } from './safety-pause'
import { Alert, Spinner, buttonClass, cx, inputClass, textareaClass } from './ui'

type Phase = 'intake' | 'ready' | 'building' | 'diag' | 'finishing' | 'result'

interface DiagView {
  pathId: string
  goal: string
  subject: string
  status: string
  asked: number
  min: number
  max: number
  item: { node: string; topic: string; item: number; q: string; options: string[]; number: number } | null
  done: boolean
  known?: string[]
  next?: string[]
}

const STEM_GUESS = /\b(math|maths|algebra|equation|quadratic|calculus|geometry|trigonometr|statistic|physics|chemistr|solar|pv|circuit|electric|engineer|coding|code|program|python|java|data|science|biology)\b/i

async function post<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
  if (!res) return { ok: false, status: 0, data: {} as T }
  const data = await res.json().catch(() => ({})) as T
  return { ok: res.ok, status: res.status, data }
}

const ease = [0.2, 0, 0, 1] as const

export function IntakeFlow({
  firstName,
  initialAnswers,
  initialItem,
  completed,
  initialPath,
  edit,
  startAt,
}: {
  firstName: string
  initialAnswers: Answers
  initialItem: string | null
  completed: boolean
  initialPath: DiagView | null
  edit: boolean
  /** Item to open on (e.g. 'goal' when adding a new path). */
  startAt?: string
}) {
  const [answers, setAnswers] = useState<Answers>(initialAnswers)
  const items = useMemo(() => visibleItems(answers), [answers])
  const startIndex = useMemo(() => {
    if (edit) { const at = startAt ? items.findIndex(i => i.id === startAt) : -1; return at >= 0 ? at : 0 }
    const at = initialItem ? items.findIndex(i => i.id === initialItem) : -1
    if (at >= 0) return at
    const firstOpen = items.findIndex(i => !initialAnswers[i.id])
    return firstOpen >= 0 ? firstOpen : 0
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [idx, setIdx] = useState(startIndex)
  const initialPhase: Phase = edit ? 'intake'
    : initialPath?.status === 'ready' ? 'result'
    : initialPath?.status === 'diagnosing' && initialPath.item ? 'diag'
    : completed ? 'ready' : 'intake'
  const [phase, setPhase] = useState<Phase>(initialPhase)
  const [diag, setDiag] = useState<DiagView | null>(initialPath)
  const [firstLessonId, setFirstLessonId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [safety, setSafety] = useState(false)
  const [aiReflection, setAiReflection] = useState<string | null>(null)
  const [prevItem, setPrevItem] = useState<IntakeItem | null>(null)

  const item = items[Math.min(idx, items.length - 1)]
  const minor = isMinor(answers)

  /** Save one answer, move on, and show a reflection of it. */
  const answer = useCallback(async (it: IntakeItem, a: Answer, extra: Record<string, unknown> = {}) => {
    setError(null)
    if (typeof a.v === 'string' && detectDistress(a.v)) { setSafety(true); return }
    const nextAnswers = { ...answers, [it.id]: a }
    const list = visibleItems(nextAnswers)
    const pos = list.findIndex(i => i.id === it.id)
    const nextItem = list[pos + 1]
    setBusy(true)
    const r = await post<{ ok?: boolean; safety?: boolean; error?: string }>('/api/intake', { answers: { [it.id]: a }, currentItem: nextItem?.id ?? it.id, ...extra })
    setBusy(false)
    if (r.data.safety) { setSafety(true); return }
    if (!r.ok) { setError(r.data.error ?? 'That didn’t save. Check your connection and try again.'); return }
    setAnswers(nextAnswers)
    setPrevItem(it)
    setAiReflection(null)
    // The "why" gets an AI reflection (motivational-interviewing style); the rest use short written reflections.
    if (it.id === 'why' && typeof a.v === 'string' && a.v.trim().length > 2) {
      const goal = (nextAnswers.goal_pick?.v as { goal?: string } | undefined)?.goal ?? (nextAnswers.goal?.v as string) ?? ''
      void post<{ reflection?: string; safety?: boolean }>('/api/intake/ai', { kind: 'why', why: a.v, goal }).then(x => {
        if (x.data.safety) setSafety(true)
        else if (x.data.reflection) setAiReflection(x.data.reflection)
      })
    }
    if (nextItem) setIdx(pos + 1)
    else {
      setBusy(true)
      const done = await post<{ error?: string }>('/api/intake', { complete: true })
      setBusy(false)
      if (!done.ok) { setError(done.data.error ?? 'Could not finish. Try again.'); return }
      setPhase('ready')
    }
  }, [answers])

  const back = () => { setError(null); setPrevItem(null); setAiReflection(null); setIdx(i => Math.max(0, i - 1)) }

  /* ── Diagnostic ── */
  const startDiag = useCallback(async (restart = false) => {
    setError(null); setPhase('building')
    const r = await post<{ path?: DiagView; error?: string }>('/api/diagnostic', { action: 'start', restart })
    if (!r.ok || !r.data.path) { setError(r.data.error ?? 'Could not prepare your check. Please try again.'); setPhase('ready'); return }
    setDiag(r.data.path)
    setPhase(r.data.path.done ? 'finishing' : 'diag')
  }, [])

  const finish = useCallback(async () => {
    setPhase('finishing'); setError(null)
    const r = await post<{ path?: DiagView; firstLessonId?: string | null; error?: string }>('/api/diagnostic', { action: 'finish' })
    if (!r.ok || !r.data.path) { setError(r.data.error ?? 'Could not build your path. Please try again.'); return }
    setDiag(r.data.path); setFirstLessonId(r.data.firstLessonId ?? null); setPhase('result')
  }, [])

  const answerDiag = useCallback(async (choice: number | null, confidence: string | null) => {
    if (!diag?.item) return
    setBusy(true); setError(null)
    const r = await post<{ path?: DiagView; error?: string }>('/api/diagnostic', { action: 'answer', node: diag.item.node, item: diag.item.item, choice, confidence })
    setBusy(false)
    if (!r.ok || !r.data.path) { setError(r.data.error ?? 'That didn’t save. Try again.'); return }
    setDiag(r.data.path)
    if (r.data.path.done) void finish()
  }, [diag, finish])

  useEffect(() => { if (phase === 'finishing' && diag?.done && diag.status !== 'ready') void finish() // resume
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const progress = phase === 'intake' ? (idx / Math.max(1, items.length)) * 0.6
    : phase === 'diag' && diag ? 0.6 + Math.min(1, diag.asked / Math.max(diag.min, 1)) * 0.38
    : phase === 'result' ? 1 : 0.6

  const reflection = prevItem ? (aiReflection ?? reflect(prevItem, answers)) : null

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="pt-safe sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[680px] items-center justify-between px-4 sm:px-6">
          <Link href="/" className="inline-flex items-center gap-2 font-display text-[18px] text-ink">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] bg-accent text-[15px] text-white">G</span>GeniusMap
          </Link>
          <Link href="/dashboard" className="text-[13px] font-medium text-muted hover:text-ink">Save and exit</Link>
        </div>
        <div className="h-[3px] w-full bg-sunken" aria-hidden>
          <motion.div className="h-full bg-accent" initial={false} animate={{ width: `${Math.round(progress * 100)}%` }} transition={{ duration: 0.4, ease }} />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[680px] flex-1 flex-col px-4 pb-[calc(32px+env(safe-area-inset-bottom))] pt-6 sm:px-6 sm:pt-10">
        {phase === 'intake' && item && (
          <AnimatePresence mode="wait">
            <motion.section key={item.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease }} className="flex flex-1 flex-col">
              <div className="mb-5 flex items-center justify-between text-[13px] text-muted">
                {idx > 0 ? (
                  <button type="button" onClick={back} className="-ml-2 inline-flex h-9 items-center gap-1 rounded-md px-2 hover:text-ink"><ArrowLeft className="h-4 w-4" strokeWidth={1.75} />Back</button>
                ) : <span>{idx === 0 && !Object.keys(answers).length ? `Hi ${firstName}. About 4 minutes.` : ''}</span>}
                <span className="tnum">{idx + 1} of {items.length}</span>
              </div>

              {reflection && (
                <p className="mb-4 max-w-[34rem] border-l-2 border-accent-line pl-3 text-[15px] leading-relaxed text-muted">{reflection}</p>
              )}
              {!prevItem && idx === 0 && (
                <p className="mb-4 max-w-[34rem] text-[15px] leading-relaxed text-muted">
                  I’m your AI tutor. Before we start, I’d like to understand what you want to learn and why, so lessons start at the right
                  level. Skip anything you’d rather not answer.
                </p>
              )}

              <h1 className="font-display text-[28px] leading-[1.15] text-ink sm:text-[34px]">{fill(item.ask, answers)}</h1>
              {item.sub && <p className="mt-2 text-[15px] leading-relaxed text-muted">{fill(item.sub, answers)}</p>}

              <div className="mt-6">
                <ItemControl key={item.id} item={item} answers={answers} busy={busy} onAnswer={(a, extra) => answer(item, a, extra)} onSafety={() => setSafety(true)} />
              </div>

              {error && <Alert tone="danger" className="mt-4">{error}</Alert>}

              {item.kind !== 'consent' && (
                <div className="mt-auto flex items-center gap-2 pt-8">
                  <button type="button" disabled={busy} onClick={() => answer(item, { skipped: true })} className={buttonClass('ghost', 'md')}>Skip</button>
                  <button type="button" disabled={busy} onClick={() => answer(item, { notSure: true })} className={buttonClass('ghost', 'md')}>Not sure</button>
                  {busy && <Spinner className="ml-auto text-muted" />}
                </div>
              )}
            </motion.section>
          </AnimatePresence>
        )}

        {phase === 'ready' && (
          <section className="flex flex-1 flex-col">
            <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-accent">Thanks, {firstName}</p>
            <h1 className="mt-3 font-display text-[30px] leading-[1.12] text-ink sm:text-[38px]">Now a short check, so we start in the right place.</h1>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
              It isn’t a test and there’s no score. I’ll map the skills between where you are and your goal, then ask 8 to 15 quick
              questions. Each answer decides the next question. After each one, tap how sure you were. “I don’t know” is a useful answer.
            </p>
            <ul className="mt-6 space-y-2 text-[15px] text-ink-2">
              <li className="flex gap-3"><Check className="mt-1 h-4 w-4 flex-shrink-0 text-accent" strokeWidth={2} />No timer. Take the time you need.</li>
              <li className="flex gap-3"><Check className="mt-1 h-4 w-4 flex-shrink-0 text-accent" strokeWidth={2} />You’ll see what you know now and what to learn next.</li>
            </ul>
            {error && <Alert tone="danger" className="mt-5">{error}</Alert>}
            <div className="mt-auto flex flex-col gap-2 pt-10 sm:flex-row">
              <button type="button" onClick={() => startDiag(false)} className={buttonClass('primary', 'lg', 'sm:flex-1')}>Start the check<ArrowRight className="h-4 w-4" strokeWidth={2} /></button>
              <button type="button" onClick={() => { setPhase('intake'); setIdx(0); setPrevItem(null) }} className={buttonClass('secondary', 'lg')}>Change my answers</button>
            </div>
          </section>
        )}

        {(phase === 'building' || phase === 'finishing') && (
          <section className="flex flex-1 flex-col items-start justify-center py-16">
            <Spinner className="h-6 w-6 text-accent" />
            <h1 className="mt-6 font-display text-[28px] leading-tight text-ink">
              {phase === 'building' ? 'Mapping the skills to your goal…' : 'Building your learning path…'}
            </h1>
            <p className="mt-3 max-w-[32rem] text-[15px] leading-relaxed text-muted">
              {phase === 'building'
                ? 'I’m working out which ideas lead to your goal, starting just below your level. This usually takes under a minute.'
                : 'Picking where to start, sizing lessons to your week, and writing your first lesson.'}
            </p>
            {error && (
              <div className="mt-6 w-full">
                <Alert tone="danger">{error}</Alert>
                <button type="button" onClick={() => (phase === 'building' ? startDiag(false) : finish())} className={buttonClass('primary', 'md', 'mt-4')}>Try again</button>
              </div>
            )}
          </section>
        )}

        {phase === 'diag' && diag?.item && (
          <DiagQuestion key={`${diag.item.node}:${diag.item.item}`} view={diag} busy={busy} error={error} onAnswer={answerDiag} />
        )}

        {phase === 'result' && diag && (
          <section>
            <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-accent">Your starting point</p>
            <h1 className="mt-3 font-display text-[30px] leading-[1.12] text-ink sm:text-[38px]">{diag.goal}</h1>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-[14px] border border-line bg-surface p-5">
                <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">What you know now</h2>
                {diag.known?.length ? (
                  <ul className="mt-3 space-y-2 text-[15px] leading-snug text-ink">{diag.known.map(k => <li key={k} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" strokeWidth={2} />{k}</li>)}</ul>
                ) : <p className="mt-3 text-[15px] leading-relaxed text-muted">We’ll build the foundations together, from the first step.</p>}
              </div>
              <div className="rounded-[14px] border border-accent-line bg-accent-soft p-5">
                <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-accent">What’s next</h2>
                <ul className="mt-3 space-y-2 text-[15px] leading-snug text-ink">{(diag.next ?? []).map(k => <li key={k} className="flex gap-2"><ArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" strokeWidth={2} />{k}</li>)}</ul>
              </div>
            </div>
            <p className="mt-5 text-[14px] leading-relaxed text-muted">This is a starting point, not a label. It updates as you learn, and a quick re-check runs if something isn’t sticking.</p>
            <div className="mt-8 flex flex-col gap-2 sm:flex-row">
              {firstLessonId
                ? <Link href={`/learn/${firstLessonId}`} className={buttonClass('primary', 'lg', 'sm:flex-1')}>Start your first lesson<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>
                : <Link href="/learn" className={buttonClass('primary', 'lg', 'sm:flex-1')}>See your path<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>}
              <Link href="/dashboard" className={buttonClass('secondary', 'lg')}>Go to your dashboard</Link>
            </div>
            <div className="mt-8 border-t border-line pt-5 text-[14px] text-muted">
              Want to learn something else too? <Link href="/start?new=1" className="font-medium text-accent hover:underline underline-offset-4">Add another goal</Link>
              {' · '}
              <button type="button" onClick={() => startDiag(true)} className="font-medium text-accent hover:underline underline-offset-4">Retake the check</button>
            </div>
          </section>
        )}
      </main>

      <SafetyPause open={safety} minor={answers.age ? minor : null} onContinue={() => setSafety(false)} />
    </div>
  )
}

/* ───────────── One intake control per item kind ───────────── */

function ItemControl({ item, answers, busy, onAnswer, onSafety }: {
  item: IntakeItem; answers: Answers; busy: boolean
  onAnswer: (a: Answer, extra?: Record<string, unknown>) => void
  onSafety: () => void
}) {
  const prev = answers[item.id]?.v
  const [text, setText] = useState(typeof prev === 'string' ? prev : '')
  const [multi, setMulti] = useState<string[]>(Array.isArray(prev) ? (prev as string[]) : [])
  const [pair, setPair] = useState<Record<string, number>>(prev && typeof prev === 'object' && !Array.isArray(prev) ? prev as Record<string, number> : {})
  const [other, setOther] = useState('')

  if (item.kind === 'choice') {
    return (
      <div className={cx('grid gap-2', (item.choices?.length ?? 0) > 6 && 'grid-cols-2 sm:grid-cols-3')}>
        {item.choices!.map(c => (
          <button key={c.value} type="button" disabled={busy} onClick={() => onAnswer({ v: c.value })}
            className={cx('flex min-h-12 flex-col items-start justify-center rounded-[12px] border bg-surface px-4 py-3 text-left transition-colors duration-150 hover:border-line-strong',
              prev === c.value ? 'border-accent ring-1 ring-accent' : 'border-line')}>
            <span className="text-[15px] font-medium text-ink">{c.label}</span>
            {c.hint && <span className="mt-0.5 text-[13px] leading-snug text-muted">{c.hint}</span>}
          </button>
        ))}
      </div>
    )
  }

  if (item.kind === 'text') {
    const submit = () => {
      const t = text.trim()
      if (detectDistress(t)) { onSafety(); return }
      if (t.length < 2) return
      onAnswer({ v: t.slice(0, 600) })
    }
    return (
      <div>
        <textarea className={cx(textareaClass, 'min-h-[112px] text-[16px]')} value={text} maxLength={600} placeholder={item.placeholder} onChange={e => setText(e.target.value)} autoFocus
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }} />
        <button type="button" disabled={busy || text.trim().length < 2} onClick={submit} className={buttonClass('primary', 'lg', 'mt-3 w-full sm:w-auto')}>Continue<ArrowRight className="h-4 w-4" strokeWidth={2} /></button>
      </div>
    )
  }

  if (item.kind === 'goal') return <GoalPick answers={answers} busy={busy} onAnswer={onAnswer} onSafety={onSafety} />

  if (item.kind === 'scale') {
    return (
      <div className="grid grid-cols-5 gap-2">
        {item.anchors!.map((a, i) => (
          <button key={a} type="button" disabled={busy} onClick={() => onAnswer({ v: i + 1 })}
            className={cx('flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-[12px] border bg-surface px-1 py-2 text-center transition-colors hover:border-line-strong', prev === i + 1 ? 'border-accent ring-1 ring-accent' : 'border-line')}>
            <span className="tnum font-display text-[22px] text-ink">{i + 1}</span>
            <span className="text-[11px] leading-tight text-muted">{a}</span>
          </button>
        ))}
      </div>
    )
  }

  if (item.kind === 'pair') {
    const rows = item.rows!
    const complete = rows.every(r => pair[r.id])
    return (
      <div>
        <div className="space-y-5">
          {rows.map(r => (
            <div key={r.id}>
              <p className="mb-2 text-[14px] font-medium text-ink-2">{r.label}</p>
              <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label={r.label}>
                {r.anchors.map((a, i) => (
                  <button key={i} type="button" role="radio" aria-checked={pair[r.id] === i + 1} aria-label={`${r.label} ${i + 1} of 5`}
                    onClick={() => setPair(p => ({ ...p, [r.id]: i + 1 }))}
                    className={cx('flex h-14 items-center justify-center rounded-[12px] border bg-surface text-[22px] transition-colors hover:border-line-strong', pair[r.id] === i + 1 ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-line')}>
                    {/^\d$/.test(a) ? <span className="tnum font-display text-[20px] text-ink">{a}</span> : a}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button type="button" disabled={busy || !complete} onClick={() => onAnswer({ v: pair })} className={buttonClass('primary', 'lg', 'mt-5 w-full sm:w-auto')}>Continue<ArrowRight className="h-4 w-4" strokeWidth={2} /></button>
      </div>
    )
  }

  if (item.kind === 'multi') {
    const toggle = (v: string) => setMulti(m => (m.includes(v) ? m.filter(x => x !== v) : [...m, v].slice(0, 6)))
    const custom = multi.filter(m => !item.choices!.some(c => c.value === m))
    return (
      <div>
        <div className="flex flex-wrap gap-2">
          {[...item.choices!, ...custom.map(c => ({ value: c, label: c }))].map(c => {
            const on = multi.includes(c.value)
            return (
              <button key={c.value} type="button" aria-pressed={on} onClick={() => toggle(c.value)}
                className={cx('inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-[14px] transition-colors', on ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-ink-2 hover:border-line-strong')}>
                {on && <Check className="h-3.5 w-3.5" strokeWidth={2.25} />}{c.label}
              </button>
            )
          })}
        </div>
        <div className="mt-4 flex gap-2">
          <input className={inputClass} value={other} maxLength={40} placeholder="Something else…" onChange={e => setOther(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && other.trim()) { e.preventDefault(); toggle(other.trim().toLowerCase()); setOther('') } }} />
          <button type="button" disabled={!other.trim()} onClick={() => { toggle(other.trim().toLowerCase()); setOther('') }} className={buttonClass('secondary', 'md', 'h-11')}>Add</button>
        </div>
        <button type="button" disabled={busy || multi.length === 0} onClick={() => onAnswer({ v: multi })} className={buttonClass('primary', 'lg', 'mt-5 w-full sm:w-auto')}>Continue<ArrowRight className="h-4 w-4" strokeWidth={2} /></button>
      </div>
    )
  }

  if (item.kind === 'date') {
    const today = new Date().toISOString().slice(0, 10)
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input type="date" min={today} className={cx(inputClass, 'sm:max-w-[220px]')} value={text} onChange={e => setText(e.target.value)} aria-label="Deadline" />
        <button type="button" disabled={busy || !text} onClick={() => onAnswer({ v: text })} className={buttonClass('primary', 'lg')}>Continue<ArrowRight className="h-4 w-4" strokeWidth={2} /></button>
        <button type="button" disabled={busy} onClick={() => onAnswer({ v: '' })} className={buttonClass('secondary', 'lg')}>No deadline</button>
      </div>
    )
  }

  if (item.kind === 'consent') return <Consent busy={busy} onAnswer={onAnswer} />
  return null
}

function GoalPick({ answers, busy, onAnswer, onSafety }: { answers: Answers; busy: boolean; onAnswer: (a: Answer) => void; onSafety: () => void }) {
  const own = typeof answers.goal?.v === 'string' ? (answers.goal.v as string) : ''
  const [goals, setGoals] = useState<{ goal: string; subject: string; stem: boolean }[] | null>(null)
  const [failed, setFailed] = useState(false)
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    const level = answers.level?.v ? String(answers.level.v) : ''
    const goal = own || `I'm not sure what to learn yet. Suggest useful next goals for someone at ${level || 'my'} level.`
    post<{ goals?: { goal: string; subject: string; stem: boolean }[]; safety?: boolean }>('/api/intake/ai', { kind: 'goals', goal }).then(r => {
      if (r.data.safety) { onSafety(); return }
      if (r.ok && r.data.goals?.length) setGoals(r.data.goals)
      else setFailed(true)
    })
  }, [answers, own, onSafety])

  const ownChoice = { goal: own, subject: '', stem: STEM_GUESS.test(own) }
  if (!goals && !failed) {
    return <div className="flex items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-4 text-[15px] text-muted"><Spinner className="text-accent" />Thinking about your goal…</div>
  }
  return (
    <div className="grid gap-2">
      {(goals ?? []).map(g => (
        <button key={g.goal} type="button" disabled={busy} onClick={() => onAnswer({ v: g })}
          className="rounded-[12px] border border-line bg-surface px-4 py-3.5 text-left text-[15px] font-medium leading-snug text-ink transition-colors hover:border-accent">
          {g.goal}
          {g.subject && <span className="mt-0.5 block text-[12px] font-normal uppercase tracking-[0.06em] text-muted">{g.subject}</span>}
        </button>
      ))}
      {own && (
        <button type="button" disabled={busy} onClick={() => onAnswer({ v: ownChoice })}
          className="rounded-[12px] border border-dashed border-line-strong bg-transparent px-4 py-3.5 text-left text-[15px] leading-snug text-ink-2 hover:border-accent">
          Keep my own words: <span className="italic">“{own}”</span>
        </button>
      )}
      {failed && !own && <p className="text-[14px] text-muted">I couldn’t suggest goals just now. Go back and describe what you’d like to learn.</p>}
    </div>
  )
}

function Consent({ busy, onAnswer }: { busy: boolean; onAnswer: (a: Answer, extra?: Record<string, unknown>) => void }) {
  const [agree, setAgree] = useState(false)
  const [email, setEmail] = useState('')
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
  return (
    <div className="rounded-[14px] border border-line bg-surface p-5">
      <p className="text-[15px] leading-relaxed text-ink-2">
        Please show this to your parent or guardian. We use your answers only to choose your lessons, keep your mood answers
        private and delete them after two weeks, and never show your answers to other people.
      </p>
      <label className="mt-5 flex cursor-pointer items-start gap-3 text-[15px] leading-snug text-ink">
        <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5 flex-shrink-0 accent-[#1F4D3A]" />
        My parent or guardian has read this and agrees to GeniusMap saving my answers to personalise my lessons.
      </label>
      <label htmlFor="guardian-email" className="mt-5 block text-[13px] font-medium text-ink-2">Parent or guardian’s email</label>
      <input id="guardian-email" type="email" inputMode="email" autoComplete="off" className={cx(inputClass, 'mt-1.5')} value={email} onChange={e => setEmail(e.target.value)} placeholder="parent@example.com" />
      <button type="button" disabled={busy || !agree || !valid} onClick={() => onAnswer({ v: true }, { consent: { guardianEmail: email.trim() } })} className={buttonClass('primary', 'lg', 'mt-5 w-full sm:w-auto')}>
        We agree, continue<ArrowRight className="h-4 w-4" strokeWidth={2} />
      </button>
      <p className="mt-4 text-[13px] text-muted">Not now? <Link href="/dashboard" className="font-medium text-accent hover:underline underline-offset-4">Come back later</Link>. Nothing beyond your age is saved until a parent or guardian agrees.</p>
    </div>
  )
}

/* ───────────── Diagnostic question with a confidence tap ───────────── */

function DiagQuestion({ view, busy, error, onAnswer }: { view: DiagView; busy: boolean; error: string | null; onAnswer: (choice: number | null, confidence: string | null) => void }) {
  const it = view.item!
  const [choice, setChoice] = useState<number | null>(null)
  return (
    <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease }} className="flex flex-1 flex-col">
      <div className="mb-5 flex items-center justify-between text-[13px] text-muted">
        <span className="truncate pr-3">{it.topic}</span>
        <span className="tnum flex-shrink-0">Question {it.number}</span>
      </div>
      <h1 className="font-display text-[24px] leading-[1.25] text-ink sm:text-[28px]"><RichText text={it.q} /></h1>
      <div className="mt-6 grid gap-2" role="radiogroup" aria-label="Answer options">
        {it.options.map((o, i) => (
          <button key={i} type="button" role="radio" aria-checked={choice === i} disabled={busy} onClick={() => setChoice(i)}
            className={cx('flex min-h-12 items-center gap-3 rounded-[12px] border bg-surface px-4 py-3 text-left text-[16px] text-ink transition-colors hover:border-line-strong', choice === i ? 'border-accent ring-1 ring-accent' : 'border-line')}>
            <span className={cx('flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border text-[12px] font-medium', choice === i ? 'border-accent bg-accent text-white' : 'border-line-strong text-muted')}>{String.fromCharCode(65 + i)}</span>
            <span className="min-w-0"><RichText text={o} /></span>
          </button>
        ))}
      </div>
      <AnimatePresence>
        {choice !== null && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5 rounded-[12px] border border-line bg-surface p-4">
            <p className="text-[14px] font-medium text-ink-2">How sure are you?</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[['guess', 'Guessing'], ['fairly', 'Fairly sure'], ['sure', 'Sure']].map(([v, l]) => (
                <button key={v} type="button" disabled={busy} onClick={() => onAnswer(choice, v)} className={buttonClass('secondary', 'md', 'h-11')}>{l}</button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {error && <Alert tone="danger" className="mt-4">{error}</Alert>}
      <div className="mt-auto flex items-center gap-2 pt-8">
        <button type="button" disabled={busy} onClick={() => onAnswer(null, null)} className={buttonClass('ghost', 'md')}>I don’t know</button>
        <button type="button" disabled={busy} onClick={() => onAnswer(null, null)} className={buttonClass('ghost', 'md')}>Skip</button>
        {busy ? <Spinner className="ml-auto text-muted" /> : <span className="ml-auto text-[13px] text-faint">No timer</span>}
      </div>
    </motion.section>
  )
}

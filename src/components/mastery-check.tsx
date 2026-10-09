'use client'
import { ReportButton } from '@/components/report/report-mistake'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { UpNextCard } from './up-next'
import { ArrowRight, Check, X } from 'lucide-react'
import { RichText } from './rich-text'
import { Alert, Spinner, buttonClass, cx } from './ui'

interface Q { i: number; q: string; options: string[]; topic?: string }
interface Quiz { items: Q[]; recheck: Q[]; attempts: number; wrongStreak: number; status: string }
interface Result { correct: boolean; answer: string | null; explain: string | null }

async function post<T>(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
  return { ok: !!res?.ok, data: (await res?.json().catch(() => ({}))) as T }
}

/**
 * Four questions on the topic; 3 of 4 unlocks the next topic. Two misses in a row (or
 * repeated wrong answers in the lesson) run a short re-check of the prerequisites, and
 * a missed prerequisite goes back into the path. No timer; results are framed as information.
 */
export function MasteryCheck({ topicId, lessonId, mastered, recheck: startRecheck }: { topicId: string; lessonId: string; mastered: boolean; recheck: boolean }) {
  const url = `/api/topics/${topicId}/mastery`
  const [mode, setMode] = useState<'loading' | 'quiz' | 'recheck' | 'result' | 'rechecked' | 'error'>('loading')
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [answers, setAnswers] = useState<(number | null)[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flagged, setFlagged] = useState<Set<number>>(() => new Set())
  const [result, setResult] = useState<{ passed?: boolean; score?: number; results: Result[]; recheck?: boolean; reopened?: string[]; next?: { id: string; title: string; lesson_id: string | null } | null } | null>(null)

  const load = async (action: 'start' | 'recheck_start') => {
    setMode('loading'); setError(null); setResult(null)
    const r = await post<Quiz & { error?: string; noPrerequisites?: boolean }>(url, { action })
    if (!r.ok) { setError(r.data.error ?? 'Could not load the check.'); setMode('error'); return }
    if (action === 'recheck_start' && r.data.noPrerequisites) { void load('start'); return }
    setQuiz(r.data)
    const list = action === 'recheck_start' ? r.data.recheck : r.data.items
    setAnswers(list.map(() => null))
    setMode(action === 'recheck_start' ? 'recheck' : 'quiz')
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(startRecheck ? 'recheck_start' : 'start') }, [])

  const submit = async () => {
    setBusy(true); setError(null)
    const r = await post<{ passed?: boolean; score?: number; results: Result[]; recheck?: boolean; reopened?: string[]; next?: { id: string; title: string; lesson_id: string | null } | null; quiz?: Quiz; error?: string }>(url, { action: mode === 'recheck' ? 'recheck' : 'submit', answers })
    setBusy(false)
    if (!r.ok) { setError(r.data.error ?? 'That didn’t save. Try again.'); return }
    setResult(r.data)
    if (r.data.quiz) setQuiz(r.data.quiz)
    setMode(mode === 'recheck' ? 'rechecked' : 'result')
  }

  const list = mode === 'recheck' ? quiz?.recheck ?? [] : quiz?.items ?? []

  if (mode === 'loading') return <div className="mt-8 flex items-center gap-3 text-[15px] text-muted"><Spinner className="text-accent" />{startRecheck ? 'Picking a few questions on the basics…' : 'Writing four fresh questions…'}</div>
  if (mode === 'error') return <div className="mt-8"><Alert tone="danger">{error}</Alert><button type="button" onClick={() => load('start')} className={buttonClass('primary', 'md', 'mt-4')}>Try again</button></div>

  if (mode === 'quiz' || mode === 'recheck') {
    return (
      <div className="mt-6">
        <p className="text-[15px] leading-relaxed text-muted">
          {mode === 'recheck' ? 'A few quick questions on the ideas underneath this topic. If one has slipped, we’ll go back to it first.' : mastered ? 'You’ve mastered this already; this is extra practice.' : 'Answer 3 of 4 correctly to unlock what’s next. No timer.'}
        </p>
        <ol className="mt-6 space-y-6">
          {list.map((q, qi) => (
            <li key={qi}>
              {q.topic && <p className="mb-1 text-[12px] font-medium uppercase tracking-[0.06em] text-muted"><RichText text={q.topic} /></p>}
              <p className="text-[17px] leading-snug text-ink"><span className="tnum mr-2 text-faint">{qi + 1}.</span><RichText text={q.q} /></p>
              <div className="mt-3 grid gap-2">
                {q.options.map((o, oi) => (
                  <button key={oi} type="button" onClick={() => setAnswers(a => a.map((x, k) => (k === qi ? oi : x)))}
                    className={cx('flex min-h-11 items-center gap-3 rounded-[12px] border bg-surface px-4 py-2.5 text-left text-[15px] text-ink', answers[qi] === oi ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-line-strong')}>
                    <span className={cx('flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border text-[12px]', answers[qi] === oi ? 'border-accent bg-accent text-white' : 'border-line-strong text-muted')}>{String.fromCharCode(65 + oi)}</span>
                    <span className="min-w-0"><RichText text={o} /></span>
                  </button>
                ))}
              </div>
              <div className="-mb-2 -ml-2.5 mt-1 flex items-center gap-2">
                {flagged.has(qi) ? <p className="flex min-h-11 items-center gap-1.5 px-2.5 text-[12.5px] text-accent"><Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />Flagged — thanks, we’ll check this question</p>
                  : <ReportButton what="this question" payload={() => ({ surface: 'mastery', lessonId, artefact: { question: q.q, options: q.options, index: qi, topic: q.topic ?? null, topicId, recheck: mode === 'recheck' } })}
                      onReported={() => setFlagged(f => new Set(f).add(qi))} />}
              </div>
            </li>
          ))}
        </ol>
        {error && <Alert tone="danger" className="mt-4">{error}</Alert>}
        <button type="button" disabled={busy || answers.some(a => a === null)} onClick={submit} className={buttonClass('primary', 'lg', 'mt-8 w-full sm:w-auto')}>{busy ? <Spinner /> : 'Check my answers'}</button>
      </div>
    )
  }

  const r = result!
  const nextHref = r.next?.lesson_id ? `/learn/${r.next.lesson_id}` : '/learn'
  return (
    <div className="mt-6">
      {mode === 'result' && (r.passed ? (
        <>
        <div className="rounded-[14px] border border-accent-line bg-accent-soft p-5">
          <h2 className="font-display text-[24px] text-ink">Mastered.</h2>
          <p className="mt-1 text-[15px] text-ink-2">{Math.round((r.score ?? 0) * 4)} of 4. {r.next ? <>Next up: <RichText text={r.next.title} />.</> : 'That was the last topic on your path.'}</p>
        </div>
        {r.next?.lesson_id && <UpNextCard href={`/learn/${r.next.lesson_id}?autoplay=1`} title={r.next.title} note="Next lesson on your path" />}
        </>
      ) : (
        <div className="rounded-[14px] border border-line bg-surface p-5">
          <h2 className="font-display text-[24px] text-ink">Not quite yet, and that’s useful to know.</h2>
          <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{Math.round((r.score ?? 0) * 4)} of 4. {r.recheck ? 'This is the second try, so let’s check the ideas underneath it first.' : 'Look at the explanations below, replay the part that felt shaky, then try a fresh set.'}</p>
        </div>
      ))}
      {mode === 'rechecked' && (
        <div className="rounded-[14px] border border-line bg-surface p-5">
          <h2 className="font-display text-[24px] text-ink">{r.reopened?.length ? 'Found the gap.' : 'The basics are solid.'}</h2>
          <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{r.reopened?.length ? `We’ll go back to ${r.reopened.join(' and ')} first. It’s now next on your path.` : 'So it’s this topic itself that needs more time. Replay the lesson, then try the check again.'}</p>
        </div>
      )}
      <ul className="mt-6 space-y-3">
        {r.results.map((x, i) => (
          <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
            {x.correct ? <Check className="mt-1 h-4 w-4 flex-shrink-0 text-accent" strokeWidth={2.25} /> : <X className="mt-1 h-4 w-4 flex-shrink-0 text-clay" strokeWidth={2.25} />}
            <span className="min-w-0 flex-1 text-ink-2">{x.correct ? 'Correct.' : <>Answer: <RichText text={x.answer ?? ''} />.</>} {x.explain && <RichText text={x.explain} />}
              <span className="-mb-2 -ml-2.5 block"><ReportButton what="this answer" payload={() => ({ surface: 'mastery', lessonId, artefact: { question: list[i]?.q ?? null, options: list[i]?.options ?? null, answer: x.answer ?? null, text: x.explain ?? null, index: i, topicId } })} /></span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-8 flex flex-col gap-2 sm:flex-row">
        {mode === 'result' && r.passed && !r.next?.lesson_id && <Link href={nextHref} className={buttonClass('primary', 'lg')}>Continue<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>}
        {mode === 'result' && !r.passed && r.recheck && <button type="button" onClick={() => load('recheck_start')} className={buttonClass('primary', 'lg')}>Check the basics</button>}
        {mode === 'result' && !r.passed && !r.recheck && <Link href={`/learn/${lessonId}`} className={buttonClass('primary', 'lg')}>Back to the lesson</Link>}
        {mode === 'result' && !r.passed && <button type="button" onClick={() => load('start')} className={buttonClass('secondary', 'lg')}>Try a fresh set</button>}
        {mode === 'rechecked' && <Link href={r.next?.lesson_id ? `/learn/${r.next.lesson_id}` : '/learn'} className={buttonClass('primary', 'lg')}>{r.reopened?.length ? 'Go to your path' : 'Back to the lesson'}<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>}
      </div>
    </div>
  )
}

'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import { Check, Lightbulb } from 'lucide-react'
import { FigureSkeleton } from '@/components/agent/interactive'
import { interactiveAlt, validateInteractive, type IxSpec } from '@/lib/agent/interactive'
import type { CheckStep } from '@/lib/lesson-schema'
import { buttonClass, cx, inputClass } from '@/components/ui'
import { EASE_SMOOTH } from './elements'
import { RichText } from '../rich-text'
import { answerMatches } from '@/lib/answer-match'

export type CheckResponse = 'got_it' | 'again' | 'differently' | 'continue' | 'answer' | 'explain_wrong'

/** The shared renderer for AI-written text (inline maths, bare LaTeX, plain fallback). */
export { RichText }


/** Growth-framed lines (docs/design/lesson-ui.md §7): a wrong answer is information, effort is named, never a verdict. */
const NOT_YET = [
  'Not quite yet — and that tells us exactly where to look.',
  'Close thinking, not the answer yet. Let’s look again.',
  'Not yet. A miss like this is how the idea sticks.',
]
/** Effort-based, varied celebration: a first try and a worked-for answer read differently (not a slot machine). */
const praise = (tries: number, seed: number) =>
  tries > 0 ? ['You worked that out.', 'You got there — that effort is the learning.', 'Stuck with it and found it.'][seed % 3]
    : ['That’s it.', 'Exactly right.', 'Yes — you’ve got it.'][seed % 3]

const InteractiveFigure = dynamic(() => import('@/components/agent/interactive'), { ssr: false, loading: () => <FigureSkeleton /> })

/** The live figure inside a check: the learner reads the answer off it, or moves it to the goal (kind explore). */
function CheckFigure({ spec, onReadouts }: { spec: IxSpec; onReadouts?: (v: number[]) => void }) {
  return <div className="mt-3"><InteractiveFigure spec={spec} alt={interactiveAlt(spec)} onReadouts={onReadouts} /></div>
}

export function CheckCard({
  step,
  resolved,
  reduced,
  onRespond,
}: {
  step: CheckStep
  resolved: boolean
  reduced: boolean
  onRespond: (r: CheckResponse, detail?: { correct?: boolean; answer?: string }) => void
}) {
  const [choice, setChoice] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [result, setResult] = useState<null | { correct: boolean; answer: string; hint?: string }>(null)
  const [tries, setTries] = useState(0)
  // Varies between questions, stable within one (deterministic: no flicker on re-render).
  const seed = useMemo(() => [...step.prompt].reduce((a, c) => a + c.charCodeAt(0), 0) % 3, [step.prompt])
  const fig = useMemo(() => (step.figure ? validateInteractive(step.figure).spec : null), [step.figure])
  const reads = useRef<number[]>([])
  const goalIdx = fig && step.goal ? fig.readouts.findIndex(r => r.label.trim().toLowerCase() === step.goal!.readout.trim().toLowerCase()) : -1
  const [moved, setMoved] = useState(false)
  const first = useRef<number[] | null>(null)
  const onReadouts = useCallback((v: number[]) => {
    reads.current = v
    if (!first.current) first.current = v
    else if (!moved && v.some((x, i) => Math.abs(x - (first.current![i] ?? x)) > 1e-6)) setMoved(true)
  }, [moved])

  const submit = () => {
    let answer = ''
    let correct = false
    let hint: string | undefined
    if (step.kind === 'explore') {
      if (!fig || goalIdx < 0 || !step.goal) return
      const v = reads.current[goalIdx]
      const span = Math.max(fig.x[1] - fig.x[0], fig.y[1] - fig.y[0])
      const tol = step.goal.tol ?? Math.max(0.02, span * 0.01)
      correct = Number.isFinite(v) && Math.abs(v - step.goal.equals) <= tol
      answer = `${fig.readouts[goalIdx].label} = ${Number.isFinite(v) ? Number(v.toFixed(3)) : '?'}`
      // Where they are and which way to go: specific, actionable, no verdict.
      if (!correct && Number.isFinite(v)) hint = `You’re at ${Number(v.toFixed(2))}; the goal is ${step.goal.equals} — ${v < step.goal.equals ? 'a little higher' : 'a little lower'}.`
    } else if (step.kind === 'choice') {
      if (choice === null) return
      answer = step.options?.[choice] ?? String(choice)
      correct = choice === step.answer
    } else {
      if (!text.trim()) return
      answer = text.trim()
      correct = answerMatches(answer, step.accept ?? [])
    }
    if (correct) { try { navigator.vibrate?.(8) } catch { /* not supported */ } }
    setResult({ correct, answer, hint })
    onRespond('answer', { correct, answer })
  }

  // Try again keeps the figure where the learner left it (their work is not thrown away).
  const retry = () => { setResult(null); setTries(t => t + 1); if (step.kind !== 'explore') { setChoice(null); setText('') } }

  // A right answer carries the lesson on by itself once there has been time to read the explanation.
  const correct = !!result?.correct
  const readMs = correct ? Math.min(7000, 1700 + (step.explanation ? step.explanation.split(/\s+/).length * 230 : 0)) : 0
  useEffect(() => {
    if (!correct) return
    const t = setTimeout(() => onRespond('continue'), readMs)
    return () => clearTimeout(t)
    // Once per right answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correct])
  const canSubmit = step.kind === 'choice' ? choice !== null : step.kind === 'explore' ? goalIdx >= 0 : !!text.trim()

  return (
    <motion.div
      initial={{ opacity: 0, y: reduced ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduced ? 0 : 4, transition: { duration: 0.15 } }}
      transition={{ duration: reduced ? 0.01 : 0.35, ease: EASE_SMOOTH }}
      className="rounded-[14px] border border-line bg-surface p-4 shadow-[var(--shadow-raised)] sm:p-5"
      role="group"
      aria-label="Check your understanding"
    >
      <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">
        {step.kind === 'understand' ? 'Quick check' : step.kind === 'explore' ? 'Try it' : 'Your turn'}
      </p>
      <p className="mt-1.5 font-display text-[20px] leading-snug text-ink md:text-[22px]"><RichText text={step.prompt} /></p>
      {fig && <CheckFigure spec={fig} onReadouts={onReadouts} />}

      {step.kind === 'understand' && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button type="button" className={cx(buttonClass('primary', 'md'), 'h-11')} onClick={() => onRespond('got_it')}>Got it</button>
          <button type="button" className={cx(buttonClass('secondary', 'md'), 'h-11')} onClick={() => onRespond('again')}>Show me again</button>
          <button type="button" className={cx(buttonClass('secondary', 'md'), 'h-11')} onClick={() => onRespond('differently')}>Explain differently</button>
        </div>
      )}

      {step.kind === 'choice' && (
        <fieldset className="mt-4" disabled={!!result}>
          <legend className="sr-only">Options</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(step.options ?? []).map((o, i) => {
              const selected = choice === i
              const showRight = result && i === step.answer && result.correct
              const showWrong = result && selected && !result.correct
              return (
                <label
                  key={i}
                  className={cx(
                    'flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] border px-3.5 py-2.5 text-[15px] transition-colors duration-150',
                    showRight ? 'border-accent bg-accent-soft text-ink' :
                    showWrong ? 'border-clay bg-clay-soft text-ink' :
                    selected ? 'border-accent bg-accent-soft/60 text-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong',
                  )}
                >
                  <input type="radio" name="check-choice" className="sr-only" checked={selected} onChange={() => setChoice(i)} />
                  <span className={cx('flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                    showWrong ? 'border-clay bg-clay text-white' : selected ? 'border-accent bg-accent text-white' : 'border-line-strong text-muted')}>
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="min-w-0"><RichText text={o} /></span>
                </label>
              )
            })}
          </div>
        </fieldset>
      )}

      {step.kind === 'short' && (
        <form className="mt-4" onSubmit={e => { e.preventDefault(); submit() }}>
          <label htmlFor="check-short" className="sr-only">Your answer</label>
          <input id="check-short" className={inputClass} value={text} onChange={e => setText(e.target.value)} disabled={!!result} placeholder="Type your answer" autoComplete="off" />
        </form>
      )}

      {step.kind !== 'understand' && !result && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className={cx(buttonClass('primary', 'md'), 'h-11 min-w-[8.5rem]')} onClick={submit} disabled={!canSubmit}>
            {step.kind === 'explore' ? 'Check it' : 'Check answer'}
          </button>
          {step.kind === 'explore' && !moved && <span className="text-[13px] text-muted">Move the figure first, then check.</span>}
          {resolved && <button type="button" className={cx(buttonClass('ghost', 'md'), 'h-11')} onClick={() => onRespond('continue')}>Skip</button>}
        </div>
      )}

      {result && (
        <motion.div
          initial={{ opacity: 0, y: reduced ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0.01 : 0.3, ease: EASE_SMOOTH }}
          className="mt-4"
        >
          <div className={cx('flex items-start gap-2.5 rounded-[12px] px-3.5 py-3', result.correct ? 'bg-accent-soft' : 'bg-clay-soft')} role="status" aria-live="polite">
            <motion.span
              initial={reduced ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 520, damping: 22 }}
              className={cx('mt-px flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-white', result.correct ? 'bg-accent' : 'bg-clay')}>
              {result.correct ? <Check className="h-3.5 w-3.5" strokeWidth={2.75} /> : <Lightbulb className="h-3.5 w-3.5" strokeWidth={2.25} />}
            </motion.span>
            <div className="min-w-0">
              <p className={cx('text-[15px] font-medium leading-snug', result.correct ? 'text-accent' : 'text-clay')}>{result.correct ? praise(tries, seed) : NOT_YET[(seed + tries) % NOT_YET.length]}</p>
              {!result.correct && result.hint && <p className="tnum mt-0.5 text-[14px] leading-relaxed text-ink-2">{result.hint}</p>}
            </div>
          </div>
          {result.correct && step.explanation && <p className="mt-1 text-sm leading-relaxed text-ink-2"><RichText text={step.explanation} /></p>}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            {result.correct ? (
              <div className="flex flex-col gap-1.5">
                <button type="button" className={cx(buttonClass('primary', 'md'), 'h-11')} onClick={() => onRespond('continue')}>Continue</button>
                <div className="h-0.5 w-full overflow-hidden rounded-full bg-accent/15" aria-hidden>
                  <motion.div className="h-full bg-accent" initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: readMs / 1000, ease: 'linear' }} />
                </div>
              </div>
            ) : (
              <>
                <button type="button" className={cx(buttonClass('primary', 'md'), 'h-11')} onClick={() => onRespond('explain_wrong', { correct: false, answer: result.answer })}>Show me another way</button>
                <button type="button" className={cx(buttonClass('secondary', 'md'), 'h-11')} onClick={retry}>{step.kind === 'explore' ? 'Keep adjusting' : 'Try again'}</button>
              </>
            )}
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}

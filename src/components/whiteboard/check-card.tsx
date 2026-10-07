'use client'
import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, X } from 'lucide-react'
import type { CheckStep } from '@/lib/lesson-schema'
import { buttonClass, cx, inputClass } from '@/components/ui'
import { EASE_SMOOTH, renderTex } from './elements'

export type CheckResponse = 'got_it' | 'again' | 'differently' | 'continue' | 'answer' | 'explain_wrong'

/** Renders inline $...$ math inside question text and options. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\$[^$]+\$)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('$') && p.endsWith('$') && p.length > 2
          ? <span key={i} dangerouslySetInnerHTML={{ __html: renderTex(p.slice(1, -1)) }} />
          : <React.Fragment key={i}>{p}</React.Fragment>,
      )}
    </>
  )
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/[.,;:!]+$/, '')

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
  const [result, setResult] = useState<null | { correct: boolean; answer: string }>(null)

  const submit = () => {
    let answer = ''
    let correct = false
    if (step.kind === 'choice') {
      if (choice === null) return
      answer = step.options?.[choice] ?? String(choice)
      correct = choice === step.answer
    } else {
      if (!text.trim()) return
      answer = text.trim()
      correct = (step.accept ?? []).some(a => norm(a) === norm(answer))
    }
    setResult({ correct, answer })
    onRespond('answer', { correct, answer })
  }

  const retry = () => { setResult(null); setChoice(null); setText('') }

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
        {step.kind === 'understand' ? 'Quick check' : 'Your turn'}
      </p>
      <p className="mt-1.5 font-display text-[20px] leading-snug text-ink md:text-[22px]"><RichText text={step.prompt} /></p>

      {step.kind === 'understand' && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button type="button" className={buttonClass('primary', 'md')} onClick={() => onRespond('got_it')}>Got it</button>
          <button type="button" className={buttonClass('secondary', 'md')} onClick={() => onRespond('again')}>Show me again</button>
          <button type="button" className={buttonClass('secondary', 'md')} onClick={() => onRespond('differently')}>Explain differently</button>
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
                    selected ? 'border-accent bg-accent text-white' : 'border-line-strong text-muted')}>
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

      {(step.kind === 'choice' || step.kind === 'short') && !result && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={buttonClass('primary', 'md')} onClick={submit} disabled={step.kind === 'choice' ? choice === null : !text.trim()}>
            Check answer
          </button>
          {resolved && <button type="button" className={buttonClass('ghost', 'md')} onClick={() => onRespond('continue')}>Skip</button>}
        </div>
      )}

      {result && (
        <motion.div
          initial={{ opacity: 0, y: reduced ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0.01 : 0.3, ease: EASE_SMOOTH }}
          className="mt-4"
        >
          <p className={cx('flex items-center gap-2 text-[15px] font-medium', result.correct ? 'text-accent' : 'text-clay')}>
            {result.correct ? <Check className="h-4 w-4" strokeWidth={2.25} /> : <X className="h-4 w-4" strokeWidth={2.25} />}
            {result.correct ? 'That’s right.' : 'Not quite.'}
          </p>
          {result.correct && step.explanation && <p className="mt-1 text-sm leading-relaxed text-ink-2"><RichText text={step.explanation} /></p>}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            {result.correct ? (
              <button type="button" className={buttonClass('primary', 'md')} onClick={() => onRespond('continue')}>Continue</button>
            ) : (
              <>
                <button type="button" className={buttonClass('primary', 'md')} onClick={() => onRespond('explain_wrong', { correct: false, answer: result.answer })}>Walk me through it</button>
                <button type="button" className={buttonClass('secondary', 'md')} onClick={retry}>Try again</button>
              </>
            )}
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}

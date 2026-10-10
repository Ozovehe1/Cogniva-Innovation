'use client'
/**
 * A verified worked example, revealed step by step (docs: worked-example effect + generation effect + segmenting):
 * 1. the problem and its exact diagram, 2. a one-tap prediction, 3. each checked step with the diagram doing that step
 * (highlight, merge, current flow, loop/junction checks, apex, tangent…), 4. the answer compared with the prediction,
 * 5. "change the numbers": every given has a slider and the whole solution re-solves live (our solver, never the model),
 * 6. your turn: the same problem with new numbers and a typed answer (checked on the server, hints before answers).
 */
import React, { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { RichText } from '@/components/rich-text'
import { buttonClass, cx } from '@/components/ui'
import { genie } from '@/components/genie/presence'
import type { ExampleSpec } from '@/lib/examples/spec'
import { fill, fmtNum } from '@/lib/examples/spec'
import { answerOptions, evaluateSpec, statementText, texForms, varyRange } from '@/lib/examples/engine'
import { pluginFor } from '@/lib/examples/registry'

const frame = 'overflow-hidden rounded-[14px] border border-line bg-surface shadow-[var(--shadow-card)]'
const label = 'text-[11px] font-medium uppercase tracking-[0.08em] text-muted'

export interface WorkedPractice { actionId: string; items: { q: string; svg?: string; unit?: string }[] }

export default function WorkedExample({ spec, practice }: { spec: ExampleSpec; practice?: WorkedPractice }) {
  const [over, setOver] = useState<Record<string, number>>({})
  const [shown, setShown] = useState(0) // steps revealed
  const [focus, setFocus] = useState<number | null>(null) // a revealed step tapped again
  const [pick, setPick] = useState<number | null>(null)
  const [tune, setTune] = useState(false)
  const ev = useMemo(() => evaluateSpec(spec, over), [spec, over])
  const base = useMemo(() => evaluateSpec(spec), [spec])
  const plugin = pluginFor(spec.diagram?.type)
  const n = spec.steps.length
  const done = shown >= n
  const cur = focus ?? (shown === 0 ? -1 : shown - 1)
  const options = useMemo(() => (spec.predict ? null : answerOptions(spec, base)), [spec, base])
  const svg = useMemo(() => {
    if (!plugin || !spec.diagram) return ''
    try { return plugin.render(spec.diagram, ev.scope, { step: done && focus === null ? n : cur, action: cur >= 0 ? spec.steps[cur]?.diagram : undefined, reveal: done && focus === null, answers: true }, spec) } catch { return '' }
  }, [plugin, spec, ev.scope, cur, done, focus, n])
  const unit = spec.answer.unit ? ` ${spec.answer.unit.replace(/\^2\b/g, '²').replace(/\^3\b/g, '³')}` : ''
  const answerText = ev.answer !== null ? `${fmtNum(ev.answer)}${unit}` : spec.answer.text ?? ''
  const predicted = pick !== null
  const predictRight = spec.predict ? pick === spec.predict.answer : options && pick !== null ? options[pick]?.correct : false
  const tunable = spec.givens.filter(g => Number.isFinite(g.value))
  const next = () => { setFocus(null); setShown(s => Math.min(n, s + 1)); if (shown + 1 >= n) genie.react('happy') }

  return (
    <div className={cx(frame, 'p-4')} data-worked-example={spec.diagram?.type ?? 'board'}>
      <div className="flex items-baseline justify-between gap-3">
        <p className={label}>Worked example</p>
        <span className="tnum text-[12px] text-muted">{Math.min(shown, n)} of {n} steps</span>
      </div>
      {spec.topic && <h3 className="mt-1 font-display text-[19px] leading-snug text-ink"><RichText text={spec.topic} /></h3>}
      <p className="mt-2 text-[15px] leading-relaxed text-ink"><RichText text={statementText(spec, ev.scope)} /></p>

      {svg && (
        <figure className="relative mt-3 overflow-hidden rounded-[12px] border border-line bg-[#FBF8F2]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={`${cur}-${done}-${JSON.stringify(over)}`} initial={{ opacity: 0.35 }} animate={{ opacity: 1 }} exit={{ opacity: 0.35 }} transition={{ duration: 0.22 }}
              role="img" aria-label={`Diagram: ${spec.topic}${cur >= 0 ? `, step ${cur + 1}: ${spec.steps[cur]?.title ?? ''}` : ''}`}
              className="w-full [&>svg]:block [&>svg]:h-auto [&>svg]:max-h-[56vh] [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          </AnimatePresence>
        </figure>
      )}

      {/* 1. predict first (generation effect) */}
      {(spec.predict || (options && options.length >= 2)) && (
        <div className={cx('mt-4 rounded-[12px] border px-3 py-3', predicted ? 'border-line bg-[#FBFAF7]' : 'border-accent-line bg-accent-soft')}>
          <p className="text-[13px] font-medium text-ink">{predicted ? 'Your prediction' : 'Before we work it out — predict:'}</p>
          <p className="mt-1 text-[14.5px] leading-relaxed text-ink"><RichText text={spec.predict ? namedFill(spec, spec.predict.question, ev.scope) : `What is the ${spec.answer.label ?? 'answer'}?`} /></p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {(spec.predict ? spec.predict.options.map(o => ({ text: o })) : options!.map(o => ({ text: o.text }))).map((o, k) => {
              const mine = pick === k
              const reveal = done && predicted
              const right = reveal && (spec.predict ? spec.predict.answer === k : options![k]?.correct)
              return (
                <button key={k} type="button" disabled={predicted} onClick={() => { setPick(k); if (shown === 0) setShown(1) }}
                  className={cx('min-h-11 rounded-[10px] border px-3 py-2 text-left text-[14px] transition-colors',
                    right ? 'border-accent bg-accent-soft text-ink' : mine ? 'border-ink/40 bg-surface text-ink' : 'border-line bg-surface text-ink hover:border-line-strong disabled:opacity-70')}>
                  <span className="flex items-center gap-2">{right && <Check className="h-4 w-4 text-accent" strokeWidth={2.5} />}<RichText text={o.text} /></span>
                </button>
              )
            })}
          </div>
          {!predicted && <button type="button" className="mt-2 text-[13px] text-muted underline-offset-2 hover:underline" onClick={() => { setPick(-1); if (shown === 0) setShown(1) }}>Skip — just show me</button>}
        </div>
      )}

      {/* 2. the steps */}
      {shown > 0 && (
        <ol className="mt-4 space-y-2.5">
          {spec.steps.slice(0, shown).map((st, i) => {
            const v = ev.values[i]
            const forms = st.calc ? safeForms(st.calc.expr, ev.scope) : null
            const active = i === cur
            return (
              <motion.li key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                <button type="button" onClick={() => setFocus(i === focus ? null : i)}
                  className={cx('w-full rounded-[12px] border px-3 py-2.5 text-left transition-colors', active ? 'border-accent-line bg-[#F6FAF7]' : 'border-line bg-surface hover:border-line-strong')}>
                  <div className="flex items-start gap-2.5">
                    <span className={cx('mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-semibold', active ? 'bg-accent text-white' : 'bg-sunken text-ink-2')}>{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      {st.title && <p className="text-[14px] font-medium text-ink">{st.title}</p>}
                      {st.claim && <div className="mt-1 overflow-x-auto text-[15px] text-ink"><RichText text={`$${st.claim}$`} display /></div>}
                      {forms && v !== null && (
                        <div className="overflow-x-auto text-[15px] text-ink"><RichText text={`$= ${forms.substituted} = \\mathbf{${fmtNum(v)}}${st.calc?.unit ? `\\,\\mathrm{${texUnit(st.calc.unit)}}` : ''}$`} display /></div>
                      )}
                      <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2"><RichText text={fill(st.reason, ev.scope)} /></p>
                      {(st.check || st.calc) && <p className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-medium text-accent"><Check className="h-3.5 w-3.5" strokeWidth={2.5} />{st.check ? 'Checked by the maths engine' : 'Worked out from the givens'}</p>}
                    </div>
                  </div>
                </button>
              </motion.li>
            )
          })}
        </ol>
      )}

      {!done && (
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={next} className={buttonClass('primary', 'md', 'min-w-[140px]')}>{shown === 0 ? 'Show step 1' : `Next step (${shown + 1} of ${n})`}</button>
          {shown > 0 && <button type="button" className="text-[13px] text-muted underline-offset-2 hover:underline" onClick={() => { setFocus(null); setShown(n) }}>Show all</button>}
        </div>
      )}

      {/* 3. the answer, compared with the prediction */}
      {done && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-[12px] border border-accent-line bg-accent-soft px-3 py-3">
          <p className={label}>Answer</p>
          <p className="mt-1 font-display text-[20px] text-ink">{spec.answer.label ? <><RichText text={cap(spec.answer.label)} />: </> : null}<span className="tnum">{answerText}</span></p>
          {predicted && pick !== -1 && (
            <p className="mt-1 text-[13.5px] text-ink-2">{predictRight ? 'Your prediction was right.' : spec.predict ? 'Not what you predicted — look back at the step that decides it.' : options && pick !== null && options[pick]?.why ? `Your pick is what you get if you ${options[pick].why!.replace(/\.$/, '')}.` : 'Not what you predicted — compare with the steps above.'}</p>
          )}
        </motion.div>
      )}

      {/* 4. change the numbers: everything re-solves live */}
      {done && tunable.length > 0 && (
        <div className="mt-3 rounded-[12px] border border-line">
          <button type="button" onClick={() => setTune(t => !t)} className="flex min-h-11 w-full items-center justify-between px-3 text-[14px] font-medium text-ink">
            <span className="inline-flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-muted" />Change the numbers</span>
            <ChevronDown className={cx('h-4 w-4 text-muted transition-transform', tune && 'rotate-180')} />
          </button>
          {tune && (
            <div className="space-y-3 border-t border-line px-3 pb-3 pt-2">
              {tunable.slice(0, 6).map(g => {
                const r = varyRange(g); const val = over[g.name] ?? g.value
                return (
                  <label key={g.name} className="block">
                    <span className="flex items-baseline justify-between text-[13px] text-ink-2"><span>{g.label ? cap(g.label) : g.name}</span><span className="tnum font-medium text-ink">{fmtNum(val)}{g.unit ? ` ${g.unit}` : ''}</span></span>
                    <input type="range" min={Math.min(r.min, g.value)} max={Math.max(r.max, g.value)} step={r.step} value={val} aria-label={g.label ?? g.name}
                      onChange={e => setOver(o => ({ ...o, [g.name]: Number(e.target.value) }))} className="mt-1 h-6 w-full accent-[var(--color-accent)]" />
                  </label>
                )
              })}
              {ev.issues.length > 0 && <p className="text-[13px] text-clay">These numbers don’t give a valid answer — try others.</p>}
              {Object.keys(over).length > 0 && <button type="button" onClick={() => setOver({})} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"><RotateCcw className="h-3.5 w-3.5" />Back to the original numbers</button>}
            </div>
          )}
        </div>
      )}

      {/* 5. your turn */}
      {done && practice && practice.items.length > 0 && <YourTurn practice={practice} />}
    </div>
  )
}

/** In a prediction question a {{given}} reads as its name and value ("R2 (3 Ω)"), never a bare number. */
function namedFill(spec: ExampleSpec, text: string, scope: Record<string, number>) {
  return text.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (m, k: string) => { const g = spec.givens.find(x => x.name === k); return g ? `${g.label && !/^(resistor|battery)/i.test(g.label) ? g.label : k} (${fmtNum(scope[k] ?? g.value)}${g.unit ? ` ${g.unit}` : ''})` : fill(m, scope) })
}
function safeForms(expr: string, scope: Record<string, number>) { try { return texForms(expr, scope) } catch { return null } }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const texUnit = (u: string) => u.replace(/\s+/g, '\\,').replace(/Ω/g, '\\Omega').replace(/°/g, '^\\circ').replace(/²/g, '^2').replace(/³/g, '^3').replace(/µ/g, '\\mu ')

function YourTurn({ practice }: { practice: WorkedPractice }) {
  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className={label}>Your turn</p>
      <p className="mt-1 text-[14px] text-ink-2">Same idea, new numbers. Type your answer.</p>
      <ol className="mt-3 space-y-5">
        {practice.items.map((it, i) => (
          <li key={i}>
            <p className="text-[15px] leading-relaxed text-ink"><span className="tnum mr-1.5 text-faint">{i + 1}.</span><RichText text={it.q} /></p>
            {it.svg && <div className="mt-2 overflow-hidden rounded-[12px] border border-line bg-[#FBF8F2] [&>svg]:block [&>svg]:h-auto [&>svg]:max-h-[46vh] [&>svg]:w-full" role="img" aria-label="Diagram for this question" dangerouslySetInnerHTML={{ __html: it.svg }} />}
            <NumericAnswer actionId={practice.actionId} index={i} unit={it.unit} />
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Typed numeric answer with units: hint after a first miss (naming the likely mistake), the answer after a second. */
export function NumericAnswer({ actionId, index, unit }: { actionId: string; index: number; unit?: string }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ done?: boolean; correct?: boolean; hint?: string; answerText?: string | null; explain?: string | null; mistake?: string | null } | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.trim() || busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/agent/practice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionId, index, value }) })
      const j = await r.json()
      setRes(j)
      if (typeof j.correct === 'boolean' && (j.done || !j.unread)) genie.react(j.correct ? 'happy' : 'encouraging')
    } finally { setBusy(false) }
  }
  const finished = !!res?.done
  return (
    <div className="mt-2">
      <form onSubmit={submit} className="flex items-stretch gap-2">
        <div className={cx('flex min-h-11 flex-1 items-center rounded-[10px] border bg-surface px-3', finished ? (res?.correct ? 'border-accent bg-accent-soft' : 'border-clay-line bg-clay-soft') : 'border-line focus-within:border-accent')}>
          <input inputMode="decimal" autoComplete="off" value={value} disabled={finished} onChange={e => setValue(e.target.value)} placeholder="Your answer" aria-label={`Answer${unit ? ` in ${unit}` : ''}`}
            className="tnum min-w-0 flex-1 bg-transparent py-2 text-[15px] text-ink outline-none placeholder:text-faint" />
          {unit && <span className="pl-2 text-[14px] text-muted">{unit}</span>}
        </div>
        {!finished && <button type="submit" disabled={busy || !value.trim()} className={buttonClass('primary', 'md', 'h-11 min-w-[84px]')}>{busy ? 'Checking' : 'Check'}</button>}
      </form>
      {res && !res.done && res.hint && <p className="mt-2 rounded-[10px] border border-amber-line bg-amber-soft px-3 py-2 text-[13.5px] leading-relaxed text-ink"><span className="font-medium">Hint: </span><RichText text={res.hint} /> Try again.</p>}
      {finished && (
        <p className={cx('mt-2 text-[13.5px] leading-relaxed', res?.correct ? 'text-accent' : 'text-ink-2')}>
          {res?.correct ? 'Right. ' : <>The answer is <span className="tnum font-medium text-ink">{res?.answerText}</span>{res?.mistake ? ` — your answer is what you get if you ${res.mistake.replace(/\.$/, '')}` : ''}. </>}
          {res?.explain ? <RichText text={res.explain} /> : null}
        </p>
      )}
    </div>
  )
}

'use client'
import { useState } from 'react'
import { Check, CornerUpLeft } from 'lucide-react'
import { Spinner, buttonClass, cx, inputClass } from './ui'

export function TutorProjectActions({ projectId, studentId }: { projectId: string; studentId: string }) {
  const [loading, setLoading] = useState<'approve' | 'return' | null>(null)
  const [done, setDone] = useState<'approved' | 'returned' | null>(null)
  const [mode, setMode] = useState<'idle' | 'grading' | 'returning'>('idle')
  const [score, setScore] = useState<number>(8)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function approve() {
    setLoading('approve')
    setError(null)
    const res = await fetch(`/api/projects/${projectId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score, studentId }),
    })
    setLoading(null)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || 'Could not approve. Try again.')
      return
    }
    setDone('approved')
  }

  async function sendBack() {
    setLoading('return')
    setError(null)
    const res = await fetch(`/api/projects/${projectId}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback, studentId }),
    })
    setLoading(null)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || 'Could not return. Try again.')
      return
    }
    setDone('returned')
  }

  if (done === 'approved') return (
    <p role="status" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent">
      <Check className="h-4 w-4" strokeWidth={2.25} /> Approved · <span className="tnum">{score}/10</span>
    </p>
  )
  if (done === 'returned') return (
    <p role="status" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-amber">
      <CornerUpLeft className="h-4 w-4" strokeWidth={2} /> Returned to student
    </p>
  )

  if (mode === 'grading') {
    return (
      <div className="space-y-4 rounded-[12px] border border-line bg-surface p-4">
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-ink-2">Grade (1–10)</legend>
          <div className="grid grid-cols-5 gap-1.5 sm:flex sm:flex-wrap">
            {[1,2,3,4,5,6,7,8,9,10].map(n => (
              <button key={n} type="button" onClick={() => setScore(n)} aria-pressed={score === n}
                className={cx(
                  'tnum h-11 rounded-[8px] border text-sm font-medium transition-colors duration-150 sm:h-9 sm:w-9',
                  score === n ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-ink-2 hover:border-line-strong',
                )}>
                {n}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[13px] text-muted">
            {score <= 3 ? 'Needs improvement' : score <= 6 ? 'Satisfactory' : score <= 8 ? 'Good work' : 'Excellent'}
          </p>
        </fieldset>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button onClick={approve} disabled={loading !== null} className={buttonClass('primary', 'md')}>
            {loading === 'approve' ? <><Spinner /> Approving…</> : <>Approve · <span className="tnum">{score}/10</span></>}
          </button>
          <button onClick={() => setMode('idle')} className={buttonClass('ghost', 'md')}>
            Cancel
          </button>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    )
  }

  if (mode === 'returning') {
    return (
      <div className="space-y-3 rounded-[12px] border border-line bg-surface p-4">
        <label htmlFor={`fb-${projectId}`} className="block text-[13px] font-medium text-ink-2">Feedback for the student <span className="font-normal text-faint">· optional</span></label>
        <input id={`fb-${projectId}`} autoFocus type="text" value={feedback} onChange={e => setFeedback(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendBack()}
          placeholder="What should they improve?"
          className={inputClass} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <button onClick={sendBack} disabled={loading === 'return'} className={buttonClass('primary', 'md')}>
            {loading === 'return' ? <><Spinner /> Sending…</> : 'Send back'}
          </button>
          <button onClick={() => setMode('idle')} className={buttonClass('ghost', 'md')}>
            Cancel
          </button>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={() => setMode('grading')} className={buttonClass('primary', 'sm')}>
        Approve and grade
      </button>
      <button onClick={() => setMode('returning')} className={buttonClass('secondary', 'sm')}>
        Return
      </button>
    </div>
  )
}

'use client'
import { useState } from 'react'

export function TutorProjectActions({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState<'approve' | 'return' | null>(null)
  const [done, setDone] = useState<'approved' | 'returned' | null>(null)
  const [mode, setMode] = useState<'idle' | 'grading' | 'returning'>('idle')
  const [score, setScore] = useState<number>(8)
  const [feedback, setFeedback] = useState('')

  async function approve() {
    setLoading('approve')
    await fetch(`/api/projects/${projectId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score }),
    })
    setDone('approved')
    setLoading(null)
  }

  async function sendBack() {
    setLoading('return')
    await fetch(`/api/projects/${projectId}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback }),
    })
    setDone('returned')
    setLoading(null)
  }

  if (done === 'approved') return (
    <span className="text-xs text-emerald-400 font-medium">✓ Approved · {score}/10</span>
  )
  if (done === 'returned') return (
    <span className="text-xs font-medium" style={{ color: '#F59E0B' }}>↩ Returned</span>
  )

  if (mode === 'grading') {
    return (
      <div className="mt-3 p-3 rounded-xl space-y-3" style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)' }}>
        <div>
          <p className="text-xs text-zinc-500 mb-2">Grade (1–10)</p>
          <div className="flex gap-1 flex-wrap">
            {[1,2,3,4,5,6,7,8,9,10].map(n => (
              <button key={n} onClick={() => setScore(n)}
                className="w-8 h-8 rounded-lg text-xs font-semibold transition"
                style={{
                  background: score === n ? 'rgba(34,197,94,0.2)' : '#18181B',
                  color: score === n ? '#22C55E' : '#71717A',
                  border: `1px solid ${score === n ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.08)'}`,
                }}>
                {n}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-600 mt-1.5">
            {score <= 3 ? 'Needs improvement' : score <= 6 ? 'Satisfactory' : score <= 8 ? 'Good work' : 'Excellent'}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={approve} disabled={loading !== null}
            className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition disabled:opacity-50"
            style={{ background: 'rgba(34,197,94,0.2)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.3)' }}>
            {loading === 'approve' ? '...' : `Approve · ${score}/10`}
          </button>
          <button onClick={() => setMode('idle')} className="px-3 py-1.5 rounded-lg text-xs text-zinc-600 hover:text-zinc-400 transition">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (mode === 'returning') {
    return (
      <div className="mt-3 space-y-2">
        <input autoFocus type="text" value={feedback} onChange={e => setFeedback(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendBack()}
          placeholder="Feedback for student (optional)..."
          className="w-full px-3 py-2 rounded-lg text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
          style={{ background: '#18181B', border: '1px solid rgba(255,255,255,0.1)' }} />
        <div className="flex gap-2">
          <button onClick={sendBack} disabled={loading === 'return'}
            className="flex-1 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
            style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.25)' }}>
            {loading === 'return' ? '...' : 'Send Back'}
          </button>
          <button onClick={() => setMode('idle')} className="px-3 py-1.5 rounded-lg text-xs text-zinc-600 hover:text-zinc-400 transition">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <button onClick={() => setMode('grading')}
        className="px-3 py-1 rounded-lg text-xs font-medium transition"
        style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.25)' }}>
        Approve + Grade
      </button>
      <button onClick={() => setMode('returning')}
        className="px-3 py-1 rounded-lg text-xs font-medium transition"
        style={{ background: 'rgba(245,158,11,0.1)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.2)' }}>
        Return
      </button>
    </div>
  )
}

'use client'
import { useState } from 'react'

export function TutorProjectActions({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState<'approve' | 'return' | null>(null)
  const [done, setDone] = useState<'approved' | 'returned' | null>(null)
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')

  async function approve() {
    setLoading('approve')
    await fetch(`/api/projects/${projectId}/approve`, { method: 'POST' })
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
    setShowFeedback(false)
  }

  if (done === 'approved') return <span className="text-xs text-emerald-400 font-medium">✓ Approved</span>
  if (done === 'returned') return <span className="text-xs font-medium" style={{ color: '#F59E0B' }}>↩ Returned</span>

  if (showFeedback) {
    return (
      <div className="flex items-center gap-2 mt-2 w-full">
        <input
          autoFocus
          type="text"
          value={feedback}
          onChange={e => setFeedback(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendBack()}
          placeholder="Feedback for student (optional)..."
          className="flex-1 px-3 py-1.5 rounded-lg text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500/40 min-w-0"
          style={{ background: '#18181B', border: '1px solid rgba(255,255,255,0.1)' }}
        />
        <button onClick={sendBack} disabled={loading === 'return'}
          className="px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 disabled:opacity-50"
          style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.25)' }}>
          {loading === 'return' ? '...' : 'Send Back'}
        </button>
        <button onClick={() => setShowFeedback(false)} className="text-zinc-600 text-xs px-1">✕</button>
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <button onClick={approve} disabled={loading !== null}
        className="px-3 py-1 rounded-lg text-xs font-medium transition disabled:opacity-50"
        style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.25)' }}>
        {loading === 'approve' ? '...' : 'Approve'}
      </button>
      <button onClick={() => setShowFeedback(true)} disabled={loading !== null}
        className="px-3 py-1 rounded-lg text-xs font-medium transition disabled:opacity-50"
        style={{ background: 'rgba(245,158,11,0.1)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.2)' }}>
        Return
      </button>
    </div>
  )
}

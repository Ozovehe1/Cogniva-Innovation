'use client'
import { useState } from 'react'

export function LinkTutor({ onLinked }: { onLinked?: (tutorName: string) => void }) {
  const [tutorId, setTutorId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [linked, setLinked] = useState('')

  async function handleLink() {
    if (!tutorId.trim()) return
    setLoading(true)
    setError('')
    const res = await fetch('/api/students/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tutor_id: tutorId.trim() }),
    })
    const data = await res.json()
    if (res.ok) {
      setLinked(data.tutor_name)
      onLinked?.(data.tutor_name)
    } else {
      setError(data.error || 'Connection failed')
    }
    setLoading(false)
  }

  if (linked) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'rgba(5,150,105,0.1)', border: '1px solid rgba(5,150,105,0.2)' }}>
        <span className="text-emerald-400 text-lg">✓</span>
        <div>
          <p className="text-white text-sm font-medium">Connected to {linked}</p>
          <p className="text-zinc-500 text-xs mt-0.5">Projects will appear once your tutor assigns them</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 rounded-2xl space-y-4" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div>
        <p className="text-white font-semibold text-sm mb-1">Connect to a Tutor</p>
        <p className="text-zinc-500 text-xs">Ask your tutor for their short code and enter it below</p>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={tutorId}
          onChange={e => setTutorId(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
          onKeyDown={e => e.key === 'Enter' && handleLink()}
          placeholder="e.g. JOHNS or XK7M2P"
          className="flex-1 px-4 py-2.5 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          style={{ background: '#18181B', border: '1px solid rgba(255,255,255,0.1)' }}
        />
        <button
          onClick={handleLink}
          disabled={!tutorId.trim() || loading}
          className="px-4 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-40 transition flex-shrink-0"
          style={{ background: '#7C3AED' }}
        >
          {loading ? '...' : 'Connect'}
        </button>
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  )
}

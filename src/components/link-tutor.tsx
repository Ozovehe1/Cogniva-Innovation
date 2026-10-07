'use client'
import { useState } from 'react'
import { Check } from 'lucide-react'
import { Card, Spinner, buttonClass, inputClass } from './ui'

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
      <div role="status" className="flex items-start gap-3 rounded-[14px] border border-accent-line bg-accent-soft p-4">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent text-white">
          <Check className="h-4 w-4" strokeWidth={2.25} />
        </span>
        <div>
          <p className="text-[15px] font-medium text-ink">Connected to {linked}</p>
          <p className="mt-0.5 text-sm text-muted">Projects will appear once your tutor assigns them.</p>
        </div>
      </div>
    )
  }

  return (
    <Card>
      <label htmlFor="tutor-code" className="block text-[15px] font-semibold text-ink">Connect to a tutor</label>
      <p className="mt-1 text-sm text-muted">Enter the short code your tutor gave you.</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          id="tutor-code"
          type="text"
          value={tutorId}
          onChange={e => setTutorId(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
          onKeyDown={e => e.key === 'Enter' && handleLink()}
          placeholder="e.g. JOHNS or XK7M2P"
          autoCapitalize="characters"
          autoComplete="off"
          className={`${inputClass} font-mono tracking-[0.12em] sm:flex-1`}
        />
        <button
          onClick={handleLink}
          disabled={!tutorId.trim() || loading}
          className={buttonClass('primary', 'md', 'h-11 sm:w-auto')}
        >
          {loading ? <><Spinner /> Connecting…</> : 'Connect'}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </Card>
  )
}

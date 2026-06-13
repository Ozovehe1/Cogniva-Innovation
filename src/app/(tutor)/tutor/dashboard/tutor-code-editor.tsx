'use client'
import { useState } from 'react'

export function TutorCodeEditor({ initial }: { initial: string }) {
  const [code, setCode] = useState(initial)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function save() {
    setSaving(true)
    setError('')
    const res = await fetch('/api/tutor/code', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: draft }),
    })
    const data = await res.json()
    if (res.ok) {
      setCode(data.code)
      setEditing(false)
    } else {
      setError(data.error || 'Failed to save')
    }
    setSaving(false)
  }

  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="rounded-xl p-4" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.06)' }}>
      <p className="text-xs uppercase tracking-widest mb-3" style={{ color: '#3F3F46' }}>Your tutor code</p>

      {editing ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20))}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
              placeholder="e.g. JOHNS or MATH-001"
              className="flex-1 px-3 py-2 rounded-lg text-sm font-mono text-white placeholder-zinc-700 focus:outline-none"
              style={{ background: '#18181B', border: '1px solid rgba(255,255,255,0.1)' }}
            />
            <button onClick={save} disabled={saving || !draft.trim()}
              className="px-3 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-40"
              style={{ background: '#7C3AED' }}>
              {saving ? '...' : 'Save'}
            </button>
            <button onClick={() => { setEditing(false); setDraft(code); setError('') }}
              className="px-3 py-2 rounded-lg text-xs"
              style={{ color: '#52525B' }}>
              Cancel
            </button>
          </div>
          <p className="text-xs" style={{ color: '#3F3F46' }}>Letters, numbers and hyphens · 3–20 characters</p>
          {error && <p className="text-xs" style={{ color: '#EF4444' }}>{error}</p>}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-xl font-mono font-bold tracking-widest" style={{ color: '#A78BFA' }}>{code}</span>
          <button onClick={copy} className="text-xs px-2.5 py-1 rounded-md transition"
            style={{ background: copied ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.05)', color: copied ? '#22C55E' : '#52525B' }}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={() => { setDraft(code); setEditing(true) }}
            className="text-xs px-2.5 py-1 rounded-md transition"
            style={{ background: 'rgba(255,255,255,0.05)', color: '#52525B' }}>
            Edit
          </button>
        </div>
      )}

      <p className="text-xs mt-3" style={{ color: '#27272A' }}>
        Share this code with students — they type it in to connect with you
      </p>
    </div>
  )
}

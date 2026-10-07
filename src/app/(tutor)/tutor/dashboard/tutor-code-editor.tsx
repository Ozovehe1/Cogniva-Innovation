'use client'
import { useState } from 'react'
import { Check, Copy, Pencil } from 'lucide-react'
import { Card, Eyebrow, Spinner, buttonClass, inputClass } from '@/components/ui'

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
    <Card>
      <Eyebrow className="mb-3">Your tutor code</Eyebrow>

      {editing ? (
        <div className="space-y-3">
          <label htmlFor="tutor-code-edit" className="sr-only">Tutor code</label>
          <input
            id="tutor-code-edit"
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20))}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
            placeholder="e.g. JOHNS or MATH-001"
            autoCapitalize="characters"
            autoComplete="off"
            className={`${inputClass} font-mono tracking-[0.12em]`}
          />
          <p className="text-[12px] text-muted">Letters, numbers and hyphens · 3–20 characters</p>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !draft.trim()} className={buttonClass('primary', 'md')}>
              {saving ? <><Spinner /> Saving…</> : 'Save'}
            </button>
            <button onClick={() => { setEditing(false); setDraft(code); setError('') }} className={buttonClass('ghost', 'md')}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-mono text-[24px] font-semibold tracking-[0.16em] text-ink">{code}</span>
          <div className="flex gap-2">
            <button onClick={copy} className={buttonClass('secondary', 'sm')} aria-live="polite">
              {copied ? <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.25} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button onClick={() => { setDraft(code); setEditing(true) }} className={buttonClass('ghost', 'sm')}>
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
              Edit
            </button>
          </div>
        </div>
      )}

      <p className="mt-4 text-[13px] leading-relaxed text-muted">
        Share this code with students. They enter it to connect with you.
      </p>
    </Card>
  )
}

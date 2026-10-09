'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { Pending, buttonClass, inputClass, labelClass } from './ui'

/** Edit a goal's own answers (deadline, what it's for, weekly time); the plan and due dates follow. */
export function GoalEdit({ pathId, deadline, purpose, hours, purposes, hoursChoices }: {
  pathId: string
  deadline: string | null
  purpose: string | null
  hours: number | null
  purposes: { value: string; label: string }[]
  hoursChoices: { value: number; label: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [d, setD] = useState(deadline ?? '')
  const [p, setP] = useState(purpose ?? '')
  const [h, setH] = useState(hours ? String(hoursChoices.reduce((a, c) => (Math.abs(c.value - hours) < Math.abs(a.value - hours) ? c : a)).value) : '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const today = new Date().toISOString().slice(0, 10)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setSaving(true)
    const body: Record<string, unknown> = { deadline: d || null }
    if (p) body.purpose = p
    if (h) body.hours = Number(h)
    try {
      const res = await fetch(`/api/paths/${pathId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) { setError(json.error ?? 'Could not save. Please try again.'); return }
      setOpen(false)
      router.refresh()
    } catch { setError('Could not save. Check your connection and try again.') } finally { setSaving(false) }
  }

  if (!open) return (
    <button type="button" onClick={() => setOpen(true)} className={buttonClass('ghost', 'md')} aria-expanded={false}>
      <Pencil className="h-4 w-4" strokeWidth={1.75} />Edit answers
    </button>
  )
  return (
    <form onSubmit={save} className="mt-4 w-full basis-full space-y-4 rounded-[12px] border border-line bg-sunken/60 p-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={`dl-${pathId}`} className={labelClass}>Deadline</label>
          <input id={`dl-${pathId}`} type="date" value={d} min={today} onChange={e => setD(e.target.value)} className={inputClass} />
          {d && <button type="button" onClick={() => setD('')} className="mt-1.5 text-[13px] font-medium text-accent hover:underline underline-offset-4">No deadline</button>}
        </div>
        <div>
          <label htmlFor={`pp-${pathId}`} className={labelClass}>It’s for</label>
          <select id={`pp-${pathId}`} value={p} onChange={e => setP(e.target.value)} className={inputClass}>
            {!p && <option value="">Choose…</option>}
            {purposes.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`hr-${pathId}`} className={labelClass}>Time each week</label>
          <select id={`hr-${pathId}`} value={h} onChange={e => setH(e.target.value)} className={inputClass}>
            {!h && <option value="">Choose…</option>}
            {hoursChoices.map(o => <option key={o.value} value={String(o.value)}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <p className="text-[13px] leading-relaxed text-muted">Your pace, lesson length and target dates are worked out again from these. Topics and lessons stay as they are.</p>
      {error && <p className="text-[14px] text-danger" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving} className={buttonClass('primary', 'md')}><Pending busy={saving} label="Saving">Save answers</Pending></button>
        <button type="button" onClick={() => { setOpen(false); setError(null) }} disabled={saving} className={buttonClass('secondary', 'md')}>Cancel</button>
      </div>
    </form>
  )
}

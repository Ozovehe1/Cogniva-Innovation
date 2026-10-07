'use client'
import { useState, useEffect } from 'react'
import type { Project } from '@/types'
import { ChevronDown, Plus } from 'lucide-react'
import { Spinner, buttonClass, cx, inputClass } from './ui'

export function AssignProject({ studentId }: { studentId: string }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState<string[]>([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => setProjects(d.projects || []))
  }, [])

  async function assign() {
    if (!selected) return
    setLoading(true)
    setError('')
    const res = await fetch(`/api/projects/${selected}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: studentId }),
    })
    if (res.ok) {
      setDone(d => [...d, selected])
      setSelected('')
      setOpen(false)
    } else {
      const d = await res.json()
      setError(d.error || 'Failed to assign')
    }
    setLoading(false)
  }

  const available = projects.filter(p => !done.includes(p.id))

  return (
    <div className={cx(open && 'w-full')}>
      {!open ? (
        <button onClick={() => setOpen(true)} className={buttonClass('secondary', 'md')}>
          <Plus className="h-4 w-4" strokeWidth={2} />
          Assign project
        </button>
      ) : (
        <div className="w-full space-y-3 rounded-[14px] border border-line bg-surface p-4 shadow-[var(--shadow-card)] md:p-5">
          <label htmlFor="assign-select" className="block text-[15px] font-semibold text-ink">Assign a project</label>
          {available.length === 0 ? (
            <p className="text-sm text-muted">No unassigned projects available. Create one first.</p>
          ) : (
            <div className="relative">
              <select
                id="assign-select"
                value={selected}
                onChange={e => setSelected(e.target.value)}
                className={cx(inputClass, 'appearance-none pr-10')}
              >
                <option value="">Choose a project…</option>
                {available.map(p => (
                  <option key={p.id} value={p.id}>{p.title} ({p.difficulty})</option>
                ))}
              </select>
              <ChevronDown aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" strokeWidth={1.75} />
            </div>
          )}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button onClick={assign} disabled={!selected || loading} className={buttonClass('primary', 'md')}>
              {loading ? <><Spinner /> Assigning…</> : 'Assign'}
            </button>
            <button onClick={() => { setOpen(false); setError('') }} className={buttonClass('ghost', 'md')}>
              Cancel
            </button>
          </div>
          {done.length > 0 && (
            <p className="tnum text-[13px] text-accent">{done.length} project{done.length > 1 ? 's' : ''} assigned this session</p>
          )}
        </div>
      )}
    </div>
  )
}

'use client'
import { useState, useEffect } from 'react'
import type { Project } from '@/types'

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
    <div>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition"
          style={{ background: 'rgba(5,150,105,0.15)', color: '#34D399', border: '1px solid rgba(5,150,105,0.25)' }}
        >
          + Assign Project
        </button>
      ) : (
        <div className="p-4 rounded-xl space-y-3" style={{ background: '#18181B', border: '1px solid rgba(255,255,255,0.1)' }}>
          <p className="text-white text-sm font-medium">Select a project to assign</p>
          {available.length === 0 ? (
            <p className="text-zinc-500 text-xs">No unassigned projects available. Create one first.</p>
          ) : (
            <select
              value={selected}
              onChange={e => setSelected(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.1)', colorScheme: 'dark' }}
            >
              <option value="">Choose a project...</option>
              {available.map(p => (
                <option key={p.id} value={p.id}>{p.title} ({p.difficulty})</option>
              ))}
            </select>
          )}
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={assign}
              disabled={!selected || loading}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-40 transition"
              style={{ background: '#059669' }}
            >
              {loading ? 'Assigning...' : 'Assign'}
            </button>
            <button
              onClick={() => { setOpen(false); setError('') }}
              className="px-4 py-2 rounded-lg text-sm text-zinc-500 hover:text-zinc-300 transition"
            >
              Cancel
            </button>
          </div>
          {done.length > 0 && (
            <p className="text-emerald-400 text-xs">✓ {done.length} project{done.length > 1 ? 's' : ''} assigned this session</p>
          )}
        </div>
      )}
    </div>
  )
}

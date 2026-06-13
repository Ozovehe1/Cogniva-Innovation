'use client'
import { useEffect, useState } from 'react'
import type { ProjectAssignment } from '@/types'

const statusConfig = {
  assigned: { label: 'Assigned', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  in_progress: { label: 'In Progress', color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
  completed: { label: 'Completed', color: '#22C55E', bg: 'rgba(34,197,94,0.1)' },
}

const difficultyConfig = {
  beginner: { color: '#22C55E' },
  intermediate: { color: '#F59E0B' },
  advanced: { color: '#EF4444' },
}

export default function StudentProjectsPage() {
  const [assignments, setAssignments] = useState<ProjectAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => { setAssignments(d.assignments || []); setLoading(false) })
  }, [])

  async function markComplete(projectId: string) {
    setCompleting(projectId)
    await fetch(`/api/projects/${projectId}/complete`, { method: 'POST' })
    setAssignments(prev => prev.map(a => a.project_id === projectId ? { ...a, status: 'completed' as const } : a))
    setCompleting(null)
  }

  const completed = assignments.filter(a => a.status === 'completed').length
  const total = assignments.length

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-600 text-sm">
        <span className="w-4 h-4 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin" />
        Loading projects...
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">My Projects</h1>
          <p className="text-zinc-500 text-sm mt-0.5">{completed}/{total} completed</p>
        </div>
        {total > 0 && (
          <div className="text-right">
            <p className="text-2xl font-bold" style={{ color: '#22C55E' }}>{Math.round((completed / total) * 100)}%</p>
            <p className="text-zinc-600 text-xs">completion rate</p>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div className="h-1 rounded-full transition-all" style={{ width: `${(completed / total) * 100}%`, background: '#22C55E' }} />
        </div>
      )}

      {assignments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-4xl mb-4">📂</div>
          <p className="text-zinc-500 text-sm">No projects assigned yet.</p>
          <p className="text-zinc-600 text-xs mt-1">Your tutor will assign projects once they review your genius profile.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {assignments.map(a => {
            const sc = statusConfig[a.status]
            const diff = difficultyConfig[a.project?.difficulty as keyof typeof difficultyConfig || 'beginner']
            return (
              <div key={a.id} className="p-5 rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <h3 className="text-white font-semibold text-sm">{a.project?.title}</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0" style={{ background: sc.bg, color: sc.color }}>{sc.label}</span>
                    </div>
                    <p className="text-zinc-500 text-xs mb-3 leading-relaxed">{a.project?.description?.slice(0, 120)}...</p>
                    <div className="flex gap-4 text-xs text-zinc-600">
                      <span>Subject: <span className="text-zinc-400">{a.project?.subject}</span></span>
                      <span>Difficulty: <span style={{ color: diff.color }}>{a.project?.difficulty}</span></span>
                      <span>Est: <span className="text-zinc-400">{a.project?.estimated_hours}h</span></span>
                    </div>
                  </div>
                  {a.status !== 'completed' && (
                    <button onClick={() => markComplete(a.project_id)} disabled={completing === a.project_id}
                      className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-50"
                      style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.25)' }}>
                      {completing === a.project_id ? '...' : 'Mark Done'}
                    </button>
                  )}
                </div>
                {a.project?.objectives && (a.project.objectives as string[]).length > 0 && (
                  <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <p className="text-zinc-600 text-xs mb-2 uppercase tracking-wider">Objectives</p>
                    <ul className="space-y-1">
                      {(a.project.objectives as string[]).map((o, i) => (
                        <li key={i} className="flex gap-2 text-xs text-zinc-500">
                          <span style={{ color: '#7C3AED' }}>•</span>{o}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

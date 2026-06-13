'use client'
import { useEffect, useState } from 'react'
import type { ProjectAssignment } from '@/types'

const statusColors: Record<string, string> = {
  assigned: 'text-yellow-400 bg-yellow-900',
  in_progress: 'text-blue-400 bg-blue-900',
  completed: 'text-green-400 bg-green-900'
}

const difficultyColors: Record<string, string> = {
  beginner: 'text-green-400',
  intermediate: 'text-yellow-400',
  advanced: 'text-red-400'
}

export default function StudentProjectsPage() {
  const [assignments, setAssignments] = useState<ProjectAssignment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => { setAssignments(d.assignments || []); setLoading(false) })
  }, [])

  async function markComplete(projectId: string) {
    await fetch(`/api/projects/${projectId}/complete`, { method: 'POST' })
    setAssignments(prev => prev.map(a => a.project_id === projectId ? { ...a, status: 'completed' as const } : a))
  }

  if (loading) return <div className="text-gray-400">Loading projects...</div>

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-white">My Projects</h1>
      {assignments.length === 0 ? (
        <div className="text-center py-20 text-gray-500">No projects assigned yet. Your tutor will assign projects soon.</div>
      ) : (
        <div className="grid gap-4">
          {assignments.map(a => (
            <div key={a.id} className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-white font-semibold text-lg">{a.project?.title}</h3>
                    <span className={`text-xs px-2 py-1 rounded-full ${statusColors[a.status]}`}>{a.status.replace('_', ' ')}</span>
                  </div>
                  <p className="text-gray-400 text-sm mb-3">{a.project?.description?.slice(0, 150)}...</p>
                  <div className="flex gap-4 text-sm">
                    <span className="text-gray-500">Subject: <span className="text-gray-300">{a.project?.subject}</span></span>
                    <span className="text-gray-500">Difficulty: <span className={difficultyColors[a.project?.difficulty || 'beginner']}>{a.project?.difficulty}</span></span>
                    <span className="text-gray-500">Est: <span className="text-gray-300">{a.project?.estimated_hours}h</span></span>
                  </div>
                </div>
                {a.status !== 'completed' && (
                  <button onClick={() => markComplete(a.project_id)}
                    className="px-4 py-2 bg-green-700 hover:bg-green-600 text-white text-sm rounded-lg transition whitespace-nowrap">
                    Mark Complete
                  </button>
                )}
              </div>
              {a.project?.objectives && (
                <div className="mt-4 pt-4 border-t border-gray-800">
                  <p className="text-gray-500 text-xs mb-2">OBJECTIVES</p>
                  <ul className="space-y-1">
                    {(a.project.objectives as string[]).map((o, i) => (
                      <li key={i} className="text-gray-400 text-sm flex gap-2"><span className="text-purple-400">•</span>{o}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

'use client'
import { useEffect, useState } from 'react'
import { LinkTutor } from '@/components/link-tutor'
import type { ProjectAssignment } from '@/types'

const statusConfig = {
  assigned:       { label: 'Assigned',      color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  in_progress:    { label: 'In Progress',   color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
  pending_review: { label: 'Under Review',  color: '#A78BFA', bg: 'rgba(124,58,237,0.1)' },
  completed:      { label: 'Completed',     color: '#22C55E', bg: 'rgba(34,197,94,0.1)' },
}

const difficultyConfig = {
  beginner:     { color: '#22C55E' },
  intermediate: { color: '#F59E0B' },
  advanced:     { color: '#EF4444' },
}

type AssignmentWithFeedback = ProjectAssignment & { feedback?: string | null }

export default function StudentProjectsPage() {
  const [assignments, setAssignments] = useState<AssignmentWithFeedback[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => {
      setAssignments(d.assignments || [])
      setLoading(false)
    })
  }, [])

  async function updateStatus(projectId: string, action: 'start' | 'submit') {
    setActing(projectId)
    const endpoint = action === 'start'
      ? `/api/projects/${projectId}/start`
      : `/api/projects/${projectId}/complete`
    await fetch(endpoint, { method: 'POST' })
    setAssignments(prev => prev.map(a =>
      a.project_id === projectId
        ? { ...a, status: action === 'start' ? 'in_progress' : 'pending_review', feedback: null }
        : a
    ))
    setActing(null)
  }

  const completed = assignments.filter(a => a.status === 'completed').length
  const total = assignments.length
  const pendingReview = assignments.filter(a => a.status === 'pending_review').length
  const hasNoTutor = !loading && total === 0

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-600 text-sm pt-8">
        <span className="w-4 h-4 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin flex-shrink-0" />
        Loading projects...
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">My Projects</h1>
          <p className="text-zinc-500 text-sm mt-0.5">
            {total === 0 ? 'No projects yet' : `${completed} of ${total} completed`}
            {pendingReview > 0 && (
              <span className="ml-2 text-violet-400">{pendingReview} awaiting review</span>
            )}
          </p>
        </div>
        {total > 0 && (
          <div className="text-right">
            <p className="text-2xl font-bold" style={{ color: '#22C55E' }}>
              {Math.round((completed / total) * 100)}%
            </p>
            <p className="text-zinc-600 text-xs">completion rate</p>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div
            className="h-1 rounded-full transition-all duration-500"
            style={{ width: `${(completed / total) * 100}%`, background: '#22C55E' }}
          />
        </div>
      )}

      {hasNoTutor ? (
        <div className="space-y-4">
          <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="text-4xl mb-4">📂</div>
            <p className="text-white font-medium mb-1">No projects yet</p>
            <p className="text-zinc-500 text-sm">Connect to a tutor to start receiving projects</p>
          </div>
          <LinkTutor onLinked={() => window.location.reload()} />
        </div>
      ) : (
        <div className="space-y-3">
          {assignments.map(a => {
            const sc = statusConfig[a.status as keyof typeof statusConfig] || statusConfig.assigned
            const diff = difficultyConfig[(a.project?.difficulty as keyof typeof difficultyConfig) || 'beginner']
            const isActing = acting === a.project_id
            const feedback = (a as AssignmentWithFeedback).feedback
            return (
              <div key={a.id} className="p-5 rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <h3 className="text-white font-semibold text-sm">{a.project?.title}</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0" style={{ background: sc.bg, color: sc.color }}>
                        {sc.label}
                      </span>
                    </div>
                    <p className="text-zinc-500 text-xs mb-3 leading-relaxed">{a.project?.description?.slice(0, 120)}...</p>
                    <div className="flex gap-4 text-xs text-zinc-600 flex-wrap">
                      <span>Subject: <span className="text-zinc-400">{a.project?.subject}</span></span>
                      <span>Difficulty: <span style={{ color: diff.color }}>{a.project?.difficulty}</span></span>
                      <span>Est: <span className="text-zinc-400">{a.project?.estimated_hours}h</span></span>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {a.status === 'assigned' && (
                      <button onClick={() => updateStatus(a.project_id, 'start')} disabled={isActing}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-50"
                        style={{ background: 'rgba(59,130,246,0.15)', color: '#60A5FA', border: '1px solid rgba(59,130,246,0.25)' }}>
                        {isActing ? '...' : 'Start'}
                      </button>
                    )}
                    {a.status === 'in_progress' && (
                      <button onClick={() => updateStatus(a.project_id, 'submit')} disabled={isActing}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-50"
                        style={{ background: 'rgba(124,58,237,0.15)', color: '#A78BFA', border: '1px solid rgba(124,58,237,0.25)' }}>
                        {isActing ? '...' : 'Submit for Review'}
                      </button>
                    )}
                    {a.status === 'pending_review' && (
                      <span className="text-xs font-medium px-2 py-1 rounded-lg" style={{ background: 'rgba(124,58,237,0.1)', color: '#A78BFA' }}>
                        Awaiting tutor
                      </span>
                    )}
                    {a.status === 'completed' && (
                      <span className="text-emerald-500 text-xs font-medium">✓ Approved</span>
                    )}
                  </div>
                </div>

                {/* Tutor feedback after return */}
                {feedback && a.status === 'in_progress' && (
                  <div className="mt-4 pt-4 rounded-lg px-3 py-2.5" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderTop: 'none' }}>
                    <p className="text-xs font-medium mb-1" style={{ color: '#F59E0B' }}>Tutor feedback</p>
                    <p className="text-xs text-zinc-400 leading-relaxed">{feedback}</p>
                  </div>
                )}

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

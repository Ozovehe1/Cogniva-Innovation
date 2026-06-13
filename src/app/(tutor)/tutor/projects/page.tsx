'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Project } from '@/types'

const difficultyConfig = {
  beginner: { color: '#22C55E', bg: 'rgba(34,197,94,0.1)' },
  intermediate: { color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  advanced: { color: '#EF4444', bg: 'rgba(239,68,68,0.1)' },
}

export default function TutorProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => { setProjects(d.projects || []); setLoading(false) })
  }, [])

  if (loading) return <div className="text-zinc-600 text-sm">Loading...</div>

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Projects</h1>
          <p className="text-zinc-500 text-sm mt-0.5">{projects.length} project{projects.length !== 1 ? 's' : ''} created</p>
        </div>
        <Link href="/tutor/projects/new" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition" style={{ background: 'rgba(5,150,105,0.15)', color: '#34D399', border: '1px solid rgba(5,150,105,0.25)' }}>
          + New Project
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="text-4xl mb-4">📋</div>
          <p className="text-white font-medium mb-1">No projects yet</p>
          <p className="text-zinc-500 text-sm">Create your first project for students</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map(p => {
            const dc = difficultyConfig[p.difficulty as keyof typeof difficultyConfig] || difficultyConfig['beginner']
            return (
              <div key={p.id} className="p-5 rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-white font-semibold text-sm">{p.title}</h3>
                      {p.ai_generated && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(124,58,237,0.15)', color: '#A78BFA', border: '1px solid rgba(124,58,237,0.2)' }}>AI</span>}
                    </div>
                    <p className="text-zinc-500 text-xs mb-3 leading-relaxed">{p.description.slice(0, 100)}...</p>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-zinc-600">{p.subject}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: dc.bg, color: dc.color }}>{p.difficulty}</span>
                      <span className="text-xs text-zinc-600">{p.estimated_hours}h</span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

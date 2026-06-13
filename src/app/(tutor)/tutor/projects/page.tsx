'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Project } from '@/types'

export default function TutorProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => { setProjects(d.projects || []); setLoading(false) })
  }, [])

  if (loading) return <div className="text-gray-400">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Projects</h1>
        <Link href="/tutor/projects/new" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl transition">
          + New Project
        </Link>
      </div>
      {projects.length === 0 ? (
        <div className="text-center py-20 text-gray-500">No projects yet. Create your first project!</div>
      ) : (
        <div className="grid gap-4">
          {projects.map(p => (
            <div key={p.id} className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-white font-semibold text-lg">{p.title}</h3>
                  <p className="text-gray-400 text-sm mt-1">{p.description.slice(0, 120)}...</p>
                  <div className="flex gap-4 mt-3 text-sm">
                    <span className="text-gray-500">Subject: <span className="text-gray-300">{p.subject}</span></span>
                    <span className="text-gray-500">Difficulty: <span className="text-emerald-400">{p.difficulty}</span></span>
                    <span className="text-gray-500">Est: <span className="text-gray-300">{p.estimated_hours}h</span></span>
                  </div>
                </div>
                {p.ai_generated && <span className="text-xs bg-purple-900 text-purple-400 px-2 py-1 rounded-full">AI Generated</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

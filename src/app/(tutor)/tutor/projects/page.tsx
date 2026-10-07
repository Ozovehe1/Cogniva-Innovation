'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Project } from '@/types'
import { Clock, FolderKanban, Plus } from 'lucide-react'
import { Badge, Card, DifficultyBadge, EmptyState, PageHeader, Skeleton, buttonClass } from '@/components/ui'

export default function TutorProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => { setProjects(d.projects || []); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="max-w-4xl" aria-busy="true" aria-label="Loading projects">
      <Skeleton className="mb-3 h-3 w-20" />
      <Skeleton className="mb-8 h-9 w-48" />
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1, 2, 3].map(i => (
          <Card key={i}>
            <Skeleton className="mb-3 h-4 w-3/4" />
            <Skeleton className="mb-2 h-3 w-full" />
            <Skeleton className="mb-4 h-3 w-2/3" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </Card>
        ))}
      </div>
    </div>
  )

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Projects"
        title="Your projects"
        description={<span className="tnum">{projects.length} project{projects.length !== 1 ? 's' : ''} created</span>}
        actions={
          <Link href="/tutor/projects/new" className={buttonClass('primary', 'md')}>
            <Plus className="h-4 w-4" strokeWidth={2} />
            New project
          </Link>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="h-5 w-5" strokeWidth={1.75} />}
          title="No projects yet"
          action={<Link href="/tutor/projects/new" className={buttonClass('primary', 'md')}>Create your first project</Link>}
        >
          Create a project, then assign it to students from their profile page.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {projects.map(p => (
            <li key={p.id}>
              <Card className="h-full">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <DifficultyBadge difficulty={p.difficulty} />
                  {p.ai_generated && <Badge className="border-navy-line bg-navy-soft text-navy">Generated</Badge>}
                </div>
                <h3 className="text-[17px] font-semibold leading-snug text-ink">{p.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{p.description.slice(0, 100)}...</p>
                <p className="tnum mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
                  <span>{p.subject}</span>
                  <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" strokeWidth={1.75} />{p.estimated_hours}h</span>
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

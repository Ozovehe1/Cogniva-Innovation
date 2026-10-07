'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Presentation } from 'lucide-react'
import { LessonStatusBadge } from '@/components/tutor-lessons'
import { TargetSelect, targetLabel } from '@/components/tutor-sections'
import { Alert, Card, EmptyState, PageHeader, Skeleton, Spinner, buttonClass, inputClass, labelClass, textareaClass } from '@/components/ui'

type LessonRow = { id: string; title: string; subject: string; objectives: string[]; status: 'draft' | 'approved'; target_minutes: number | null; chapters: unknown[] | null; draft_status: string; created_at: string }

export default function TutorLessonsPage() {
  const router = useRouter()
  const [lessons, setLessons] = useState<LessonRow[] | null>(null)
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [objectives, setObjectives] = useState('')
  const [target, setTarget] = useState(20)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/tutor/lessons').then(r => r.json()).then(d => setLessons(d.lessons ?? [])).catch(() => setLessons([]))
  }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const objs = objectives.split('\n').map(o => o.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean)
    if (!title.trim() || !subject.trim() || objs.length === 0) { setError('Add a title, a subject and at least one objective.'); return }
    setCreating(true)
    try {
      const res = await fetch('/api/tutor/lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, subject, objectives: objs, targetMinutes: target }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.id) { setError(data.error ?? 'Could not create the lesson.'); setCreating(false); return }
      router.push(`/tutor/lessons/${data.id}`)
    } catch {
      setError('Network error. Check your connection and try again.')
      setCreating(false)
    }
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Live tutor"
        title="Lessons"
        description="Write the objectives, let the tutor draft a whiteboard lesson, then preview, adjust and approve it before students see it."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="your-lessons">
          <h2 id="your-lessons" className="mb-3 text-[15px] font-semibold text-ink">Your lessons</h2>
          {lessons === null ? (
            <div className="space-y-3" aria-busy="true">
              {[0, 1].map(i => <Card key={i}><Skeleton className="mb-3 h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></Card>)}
            </div>
          ) : lessons.length === 0 ? (
            <EmptyState icon={<Presentation className="h-5 w-5" strokeWidth={1.75} />} title="No lessons yet">
              Create your first lesson with the form. Approved lessons appear for students under Learn.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {lessons.map(l => (
                <li key={l.id}>
                  <Link href={`/tutor/lessons/${l.id}`} className="group block rounded-[14px]">
                    <Card className="transition-colors duration-150 group-hover:border-line-strong">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <h3 className="font-display text-[20px] leading-snug text-ink">{l.title}</h3>
                          <p className="mt-1 text-[13px] text-muted">
                            {l.subject}
                            {l.target_minutes ? ` · ${targetLabel(l.target_minutes)}` : ''}
                            {Array.isArray(l.chapters) && l.chapters.length > 1 ? ` · ${l.chapters.length} sections` : ''}
                            {['outlining', 'drafting'].includes(l.draft_status) ? ' · drafting…' : l.draft_status === 'paused' ? ' · drafting paused' : ''}
                          </p>
                        </div>
                        <LessonStatusBadge status={l.status} />
                      </div>
                      <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent">
                        Open <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={1.75} />
                      </span>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="new-lesson">
          <Card>
            <h2 id="new-lesson" className="text-[15px] font-semibold text-ink">New lesson</h2>
            <form onSubmit={create} className="mt-4 space-y-4">
              <div>
                <label htmlFor="l-title" className={labelClass}>Title</label>
                <input id="l-title" className={inputClass} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Why does a pendulum swing?" maxLength={160} disabled={creating} />
              </div>
              <div>
                <label htmlFor="l-subject" className={labelClass}>Subject</label>
                <input id="l-subject" className={inputClass} value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Physics" maxLength={80} disabled={creating} />
              </div>
              <div>
                <label htmlFor="l-obj" className={labelClass}>Objectives <span className="font-normal text-faint">(one per line)</span></label>
                <textarea id="l-obj" rows={5} className={textareaClass} value={objectives} onChange={e => setObjectives(e.target.value)} placeholder={'Explain …\nCompute …\nRecognise …'} disabled={creating} />
              </div>
              <div>
                <label htmlFor="l-target" className={labelClass}>Lesson length</label>
                <TargetSelect id="l-target" value={target} onChange={setTarget} disabled={creating} />
                <p className="mt-1.5 text-[13px] text-muted">Longer lessons are split into sections of about 8 minutes, each drafted on its own.</p>
              </div>
              {error && <Alert>{error}</Alert>}
              <button type="submit" className={buttonClass('primary', 'md', 'w-full')} disabled={creating}>
                {creating ? <><Spinner /> Creating…</> : 'Create and draft'}
              </button>
              
            </form>
          </Card>
        </section>
      </div>
    </div>
  )
}

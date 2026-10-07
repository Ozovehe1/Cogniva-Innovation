'use client'
import { useEffect, useState } from 'react'
import { LinkTutor } from '@/components/link-tutor'
import type { ProjectAssignment } from '@/types'
import { Check, Clock, MessageSquareText } from 'lucide-react'
import { Avatar, Badge, Card, DifficultyBadge, Eyebrow, PageHeader, ProgressBar, Skeleton, Spinner, StatusBadge, buttonClass, cx, gradeTone, initialsOf } from '@/components/ui'

type AssignmentWithFeedback = ProjectAssignment & { feedback?: string | null }

export default function StudentProjectsPage() {
  const [assignments, setAssignments] = useState<AssignmentWithFeedback[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [hasTutor, setHasTutor] = useState(false)
  const [tutorName, setTutorName] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => {
      setAssignments(d.assignments || [])
      setHasTutor(d.hasTutor ?? false)
      setTutorName(d.tutorName ?? null)
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
  const hasNoTutor = !loading && !hasTutor

  if (loading) {
    return (
      <div className="max-w-3xl" aria-busy="true" aria-label="Loading projects">
        <Skeleton className="mb-3 h-3 w-20" />
        <Skeleton className="mb-8 h-9 w-56" />
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <Card key={i}>
              <Skeleton className="mb-3 h-4 w-2/3" />
              <Skeleton className="mb-2 h-3 w-full" />
              <Skeleton className="mb-4 h-3 w-4/5" />
              <div className="flex gap-2">
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Projects"
        title="My projects"
        description={
          <>
            {total === 0 ? 'No projects yet.' : <span className="tnum">{completed} of {total} completed.</span>}
            {pendingReview > 0 && <span className="tnum"> {pendingReview} awaiting review.</span>}
          </>
        }
      />

      {total > 0 && (
        <Card className="mb-6">
          <div className="mb-2.5 flex items-baseline justify-between">
            <span className="text-[13px] text-muted">Completion</span>
            <span className="tnum font-display text-[22px] leading-none text-ink">{pct}%</span>
          </div>
          <ProgressBar value={completed} max={total} label="Projects completed" />
        </Card>
      )}

      {hasNoTutor ? (
        <div className="space-y-4">
          <Card>
            <p className="text-[15px] font-semibold text-ink">No tutor connected yet</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Ask your tutor for their short code and enter it below. Their projects will appear here.
            </p>
          </Card>
          <LinkTutor onLinked={() => window.location.reload()} />
        </div>
      ) : total === 0 ? (
        <Card>
          <Eyebrow className="mb-4">Your tutor</Eyebrow>
          <div className="mb-4 flex items-center gap-3">
            <Avatar initials={tutorName ? initialsOf(tutorName) : 'T'} />
            <div>
              <p className="text-[15px] font-medium text-ink">{tutorName ?? 'Your tutor'}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Connected
              </p>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-muted">
            No projects have been assigned yet. They&apos;ll show up here as soon as your tutor assigns one.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {assignments.map(a => {
            const isActing = acting === a.project_id
            const feedback = (a as AssignmentWithFeedback).feedback
            const score = (a as AssignmentWithFeedback & { score?: number | null }).score
            const objectives = (a.project?.objectives as string[] | undefined) ?? []
            return (
              <li key={a.id}>
                <Card>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <StatusBadge status={a.status} label={a.status === 'completed' ? 'Completed' : undefined} />
                        <DifficultyBadge difficulty={a.project?.difficulty} />
                      </div>
                      <h3 className="text-[17px] font-semibold leading-snug text-ink">{a.project?.title}</h3>
                      {a.project?.description && (
                        <p className="mt-1.5 text-sm leading-relaxed text-muted">{a.project.description.slice(0, 120)}...</p>
                      )}
                      <p className="tnum mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
                        <span>{a.project?.subject}</span>
                        <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" strokeWidth={1.75} />{a.project?.estimated_hours}h estimated</span>
                      </p>
                    </div>

                    <div className="flex flex-shrink-0 sm:justify-end">
                      {a.status === 'assigned' && (
                        <button onClick={() => updateStatus(a.project_id, 'start')} disabled={isActing}
                          className={buttonClass('primary', 'md', 'w-full sm:w-auto')}>
                          {isActing ? <Spinner /> : null}
                          {isActing ? 'Starting…' : 'Start project'}
                        </button>
                      )}
                      {a.status === 'in_progress' && (
                        <button onClick={() => updateStatus(a.project_id, 'submit')} disabled={isActing}
                          className={buttonClass('primary', 'md', 'w-full sm:w-auto')}>
                          {isActing ? <Spinner /> : null}
                          {isActing ? 'Submitting…' : 'Submit for review'}
                        </button>
                      )}
                      {a.status === 'pending_review' && (
                        <span className="text-[13px] text-muted">Waiting for your tutor</span>
                      )}
                      {a.status === 'completed' && (
                        score != null ? (
                          <div className="text-left sm:text-right">
                            <p className={cx('tnum font-display text-[26px] leading-none', gradeTone(score))}>
                              {score}<span className="text-[15px] text-faint"> / 10</span>
                            </p>
                            <p className="mt-1 text-[12px] text-muted">Grade</p>
                          </div>
                        ) : (
                          <Badge className="border-accent-line bg-accent-soft text-accent"><Check className="h-3.5 w-3.5" strokeWidth={2} />Approved</Badge>
                        )
                      )}
                    </div>
                  </div>

                  {feedback && a.status === 'in_progress' && (
                    <div className="mt-5 rounded-[10px] border border-amber-line bg-amber-soft px-4 py-3">
                      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-amber">
                        <MessageSquareText className="h-3.5 w-3.5" strokeWidth={2} /> Tutor feedback
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-2">{feedback}</p>
                    </div>
                  )}

                  {objectives.length > 0 && (
                    <div className="mt-5 border-t border-line pt-4">
                      <Eyebrow className="mb-2.5">Objectives</Eyebrow>
                      <ul className="space-y-1.5">
                        {objectives.map((o, i) => (
                          <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink-2">
                            <span className="mt-[9px] h-1 w-1 flex-shrink-0 rounded-full bg-accent" />{o}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

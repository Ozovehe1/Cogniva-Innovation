import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { AssignProject } from '@/components/assign-project'
import { TutorProjectActions } from '@/components/tutor-project-actions'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { intelligenceLabel } from '@/components/intelligence'
import { Alert, Avatar, Badge, Card, DifficultyBadge, Eyebrow, ProgressBar, RadarChart, ScoreBars, StatusBadge, cx, gradeTone } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function StudentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: tutorProfile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
  const { data: isLinked } = await supabase.from('tutor_students').select('id').eq('tutor_id', tutorProfile?.id).eq('student_id', id).single()
  if (!isLinked) notFound()

  const [{ data: student }, { data: intel }, { data: growth }, { data: assignments }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', id).single(),
    supabase.from('intelligence_profiles').select('*').eq('student_id', id).single(),
    supabase.from('student_growth').select('*').eq('student_id', id).single(),
    supabase.from('project_assignments').select('*, project:projects(*)').eq('student_id', id)
  ])

  if (!student) notFound()

  const studentData = student as { full_name: string; email: string }
  const growthData = growth as { level?: string; growth_score?: number; projects_completed?: number; projects_total?: number; sublevel?: number; average_score?: number } | null
  const intelData = intel as {
    genius_statement: string;
    dominant_intelligence: string;
    intelligence_scores: Record<string, number>;
    study_tips?: string[];
    learning_path?: string[];
    career_suggestions?: string[];
  } | null

  const pendingReviews = (assignments as Array<{ status: string; project_id: string; project?: { title?: string } }> | null)
    ?.filter(a => a.status === 'pending_review') ?? []

  const level = growthData?.level || 'Seed'
  const initials = studentData.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()

  const firstName = studentData.full_name.split(' ')[0]
  const sublevel = growthData?.sublevel || 1
  const avg = growthData?.average_score || 0
  const assignmentList = (assignments as Array<{
    id: string;
    status: string;
    project_id: string;
    score?: number | null;
    feedback?: string | null;
    project?: { title?: string; subject?: string; difficulty?: string }
  }> | null) ?? []

  return (
    <div className="space-y-6 md:space-y-8">
      <Link href="/tutor/students" className="-ml-1 inline-flex h-9 items-center gap-1.5 rounded-md px-1 text-[13px] font-medium text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        All students
      </Link>

      {/* Header */}
      <header className="flex items-center gap-4">
        <Avatar initials={initials} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="font-display text-[28px] leading-tight text-ink md:text-[36px]">{studentData.full_name}</h1>
            <Badge className="border-accent-line bg-accent-soft text-accent">{level}</Badge>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">{studentData.email}</p>
        </div>
      </header>

      {pendingReviews.length > 0 && (
        <Alert tone="warning" title={`${pendingReviews.length} project${pendingReviews.length > 1 ? 's' : ''} awaiting your review`}>
          Approve and grade, or return with feedback, in Assigned projects below.
        </Alert>
      )}

      {!intelData ? (
        <Alert tone="info" title="Assessment pending">
          {firstName} hasn&apos;t completed the intelligence assessment yet.
        </Alert>
      ) : (
        <>
          <figure className="rounded-[14px] border border-accent-line bg-accent-soft p-5 md:p-7">
            <Eyebrow className="mb-3 text-accent">What GeniusMap told {firstName}</Eyebrow>
            <blockquote className="font-display text-[21px] leading-snug text-ink md:text-[26px]">
              &ldquo;{intelData.genius_statement}&rdquo;
            </blockquote>
          </figure>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card padded={false} className="lg:col-span-3">
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className="border-b border-line p-5 md:border-b-0 md:border-r md:p-8">
                  <h2 className="mb-2 text-[15px] font-semibold text-ink">Intelligence profile</h2>
                  <div className="mx-auto max-w-[340px]">
                    <RadarChart scores={intelData.intelligence_scores} />
                  </div>
                </div>
                <div className="p-5 md:p-8">
                  <ScoreBars scores={intelData.intelligence_scores} highlight={intelData.dominant_intelligence} compact />
                </div>
              </div>
            </Card>

            <Card>
                <h3 className="text-[15px] font-semibold text-ink">Progress</h3>
                <div className="mb-2 mt-4 flex items-baseline justify-between">
                  <span className="font-display text-[24px] leading-none text-ink">{level}</span>
                  <span className="tnum text-[13px] text-muted">Sublevel {sublevel} of 9</span>
                </div>
                <ProgressBar value={sublevel} max={9} label="Sublevel progress" />

                <dl className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-[10px] border border-line bg-[#FBFAF7] p-3">
                    <dt className="text-[12px] text-muted">Approved</dt>
                    <dd className="tnum mt-1 font-display text-[24px] leading-none text-ink">{growthData?.projects_completed || 0}</dd>
                  </div>
                  <div className="rounded-[10px] border border-line bg-[#FBFAF7] p-3">
                    <dt className="text-[12px] text-muted">Avg grade</dt>
                    <dd className={cx('tnum mt-1 font-display text-[24px] leading-none', avg ? gradeTone(avg) : 'text-faint')}>
                      {growthData?.average_score ? growthData.average_score.toFixed(1) : '—'}
                    </dd>
                  </div>
                </dl>

                <div className="mt-5 border-t border-line pt-4">
                  <p className="text-[12px] text-muted">Strongest intelligence</p>
                  <p className="mt-0.5 text-[15px] font-medium text-ink">{intelligenceLabel(intelData.dominant_intelligence)}</p>
                </div>
              </Card>

              {intelData.study_tips && intelData.study_tips.length > 0 && (
                <Card className="lg:col-span-2">
                  <h3 className="mb-3 text-[15px] font-semibold text-ink">Study tips</h3>
                  <ol className="space-y-2.5">
                    {intelData.study_tips.slice(0, 3).map((tip, i) => (
                      <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink-2">
                        <span className="tnum font-display text-accent">{i + 1}.</span>
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ol>
                </Card>
              )}
          </div>
        </>
      )}

      {/* Assigned projects */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ink">
            Assigned projects <span className="tnum font-normal text-muted">({assignmentList.length})</span>
          </h2>
          <AssignProject studentId={id} />
        </div>
        {assignmentList.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No projects assigned yet. Use Assign project to give {firstName} one.</p>
          </Card>
        ) : (
          <Card padded={false} className="overflow-hidden">
            <ul className="divide-y divide-line">
              {assignmentList.map(a => {
                const isPending = a.status === 'pending_review'
                return (
                  <li key={a.id} className={cx('px-5 py-4 md:px-6', isPending && 'bg-[#FFFBF5]')}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-medium text-ink">{a.project?.title}</p>
                        <p className="mt-0.5 text-[13px] text-muted">{a.project?.subject}</p>
                      </div>
                      <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                        {a.status === 'completed' && a.score != null && (
                          <span className={cx('tnum text-sm font-semibold', gradeTone(a.score))}>{a.score}/10</span>
                        )}
                        <DifficultyBadge difficulty={a.project?.difficulty} />
                        <StatusBadge status={a.status} label={isPending ? 'Needs review' : a.status === 'completed' ? 'Completed' : undefined} />
                      </div>
                    </div>
                    {isPending && (
                      <div className="mt-3">
                        <TutorProjectActions projectId={a.project_id} studentId={id} />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </Card>
        )}
      </section>
    </div>
  )
}

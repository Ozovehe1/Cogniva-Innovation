import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, ClipboardList, FolderKanban } from 'lucide-react'
import { Card, EmptyState, Eyebrow, PageHeader, ProgressBar, ScoreBars, SectionTitle, StatusBadge, buttonClass, cx, gradeTone } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function StudentDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()

  const [{ data: intel }, { data: growth }, { data: assignments }] = await Promise.all([
    supabase.from('intelligence_profiles').select('*').eq('student_id', profile?.id).single(),
    supabase.from('student_growth').select('*').eq('student_id', profile?.id).single(),
    supabase.from('project_assignments')
      .select('*, project:projects(title, subject, difficulty, estimated_hours)')
      .eq('student_id', profile?.id)
      .order('created_at', { ascending: false }),
  ])

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there'

  if (!intel) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center">
        <Eyebrow className="mb-3">Welcome, {firstName}</Eyebrow>
        <h1 className="font-display text-[34px] leading-tight text-ink md:text-[40px]">Start with the assessment.</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          It&apos;s 24 short statements about how you think and work. Your profile is ready as soon as you finish,
          and your tutor will be able to see it too.
        </p>
        <div className="mt-8">
          <Link href="/assessment" className={buttonClass('primary', 'lg', 'w-full sm:w-auto')}>
            <ClipboardList className="h-4 w-4" strokeWidth={1.75} />
            Start the assessment
          </Link>
        </div>
      </div>
    )
  }

  const level = growth?.level || 'Seed'
  const sublevel = (growth as { sublevel?: number } | null)?.sublevel || 1
  const avgScore = (growth as { average_score?: number } | null)?.average_score || 0
  const completedProjects = growth?.projects_completed || 0
  const totalProjects = growth?.projects_total || 0
  const overallPct = Math.min(Math.round((completedProjects / 45) * 100), 100)

  const activeProjects = (assignments || []).filter(a => a.status !== 'completed')
  const completedList = (assignments || []).filter(a => a.status === 'completed')

  const scores = intel.intelligence_scores as Record<string, number>
  const top3 = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 3)

  return (
    <div>
      <PageHeader eyebrow="Dashboard" title={<>Hello, {firstName}</>} />

      {/* Summary */}
      <Card className="mb-6" padded={false}>
        <div className="grid grid-cols-2 md:grid-cols-4">
          <div className="border-b border-r border-line p-5 md:border-b-0 md:p-6">
            <p className="text-[13px] text-muted">Level</p>
            <p className="mt-1 font-display text-[28px] leading-none text-ink">{level}</p>
            <p className="tnum mt-1.5 text-[12px] text-faint">Sublevel {sublevel} of 9</p>
          </div>
          <div className="border-b border-line p-5 md:border-b-0 md:border-r md:p-6">
            <p className="text-[13px] text-muted">Stages complete</p>
            <p className="tnum mt-1 font-display text-[28px] leading-none text-ink">
              {completedProjects}<span className="text-[18px] text-faint"> / 45</span>
            </p>
            <p className="tnum mt-1.5 text-[12px] text-faint">{overallPct}% of the journey</p>
          </div>
          <div className="border-r border-line p-5 md:p-6">
            <p className="text-[13px] text-muted">Average grade</p>
            <p className={cx('tnum mt-1 font-display text-[28px] leading-none', avgScore > 0 ? gradeTone(avgScore) : 'text-faint')}>
              {avgScore > 0 ? avgScore.toFixed(1) : '—'}
            </p>
            <p className="mt-1.5 text-[12px] text-faint">out of 10</p>
          </div>
          <div className="p-5 md:p-6">
            <p className="text-[13px] text-muted">Projects approved</p>
            <p className="tnum mt-1 font-display text-[28px] leading-none text-ink">{completedProjects}</p>
            <p className="tnum mt-1.5 text-[12px] text-faint">{activeProjects.length} in progress</p>
          </div>
        </div>
        <div className="border-t border-line px-5 py-4 md:px-6">
          <div className="mb-2 flex items-center justify-between text-[13px]">
            <span className="text-muted">Overall progress</span>
            <span className="tnum font-medium text-ink">{overallPct}%</span>
          </div>
          <ProgressBar value={overallPct} label="Overall progress" />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Projects */}
        <section className="lg:col-span-3">
          <SectionTitle
            action={totalProjects > 0 ? (
              <Link href="/projects" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline underline-offset-4">
                View all <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
              </Link>
            ) : undefined}
          >
            Current projects
          </SectionTitle>

          {totalProjects === 0 ? (
            <EmptyState
              icon={<FolderKanban className="h-5 w-5" strokeWidth={1.75} />}
              title="No projects yet"
              action={<Link href="/projects" className={buttonClass('primary', 'md')}>Connect to a tutor</Link>}
            >
              Your tutor assigns projects once you&apos;re connected. Enter their code on the Projects page.
            </EmptyState>
          ) : (
            <Card padded={false} className="overflow-hidden">
              {activeProjects.length === 0 ? (
                <div className="px-5 py-5 text-sm text-muted md:px-6">
                  You&apos;re all caught up. Ask your tutor for the next project.
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {activeProjects.map(a => (
                    <li key={a.id}>
                      <Link href="/projects" className="flex items-center gap-4 px-5 py-4 transition-colors duration-150 hover:bg-[#FBFAF7] md:px-6">
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-[15px] font-medium leading-snug text-ink sm:line-clamp-1">{a.project?.title}</p>
                          <p className="tnum mt-0.5 truncate text-[13px] text-muted">
                            {a.project?.subject} · {a.project?.estimated_hours}h
                          </p>
                        </div>
                        <StatusBadge status={a.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {completedList.length > 0 && (
                <div className="flex items-center justify-between border-t border-line bg-[#FBFAF7] px-5 py-3 text-[13px] md:px-6">
                  <span className="tnum text-muted">{completedList.length} completed</span>
                  <Link href="/projects" className="font-medium text-accent hover:underline underline-offset-4">See all</Link>
                </div>
              )}
            </Card>
          )}
        </section>

        {/* Profile */}
        <aside className="space-y-6 lg:col-span-2">
          <section>
            <SectionTitle
              action={
                <Link href="/assessment" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline underline-offset-4">
                  Full profile <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                </Link>
              }
            >
              Top strengths
            </SectionTitle>
            <Card>
              <ScoreBars scores={Object.fromEntries(top3)} showRank compact />
            </Card>
          </section>

          {intel.genius_statement && (
            <figure className="rounded-[14px] border border-accent-line bg-accent-soft p-5 md:p-6">
              <Eyebrow className="mb-3 text-accent">In a sentence</Eyebrow>
              <blockquote className="font-display text-[19px] leading-snug text-ink">{intel.genius_statement}</blockquote>
            </figure>
          )}
        </aside>
      </div>
    </div>
  )
}

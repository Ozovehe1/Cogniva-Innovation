import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, LogOut, Target } from 'lucide-react'
import { getSessionProfile } from '@/lib/auth'
import { learnerForPath, listPaths, loadLearner, type TopicRow } from '@/lib/learner'
import { HOURS_CHOICES, PURPOSE_LABEL, deadlineDistance, formatDue, pathDeadline } from '@/lib/path-view'
import { RichText, toPlainText } from '@/components/rich-text'
import { GoalDelete, AccountDelete } from '@/components/delete-dialog'
import { GoalEdit } from '@/components/goal-edit'
import { Card, EmptyState, PageHeader, ProgressBar, SectionTitle, buttonClass } from '@/components/ui'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Settings · GeniusMap', robots: { index: false } }

export default async function SettingsPage() {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) redirect('/login?next=/settings')
  const [{ data: me }, learner, paths] = await Promise.all([
    supabase.from('profiles').select('email').eq('id', profile.id).maybeSingle(),
    loadLearner(supabase, profile.id),
    listPaths(supabase, profile.id),
  ])
  const email = (me as { email: string | null } | null)?.email ?? ''
  const { data: topicRows } = paths.length ? await supabase.from('path_topics').select('path_id, status, lesson_id').in('path_id', paths.map(p => p.id)) : { data: [] }
  const topics = (topicRows ?? []) as Pick<TopicRow, 'path_id' | 'status' | 'lesson_id'>[]
  const purposes = Object.entries(PURPOSE_LABEL).map(([value, label]) => ({ value, label }))

  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Settings" title="Your account" description="Manage your goals, sign out, or delete your account." />

      <section className="mb-10">
        <SectionTitle action={paths.length ? <span className="tnum text-[13px] text-muted">{paths.length} {paths.length === 1 ? 'goal' : 'goals'}</span> : undefined}>Your goals</SectionTitle>
        {!paths.length ? (
          <EmptyState icon={<Target className="h-5 w-5" strokeWidth={1.75} />} title="No goals yet"
            action={<Link href="/learn" className={buttonClass('primary', 'md')}>Go to Learn<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>}>
            Add a goal with “Learn something new” on the Learn page.
          </EmptyState>
        ) : (
          <ul className="space-y-4">
            {paths.map(p => {
              const own = topics.filter(t => t.path_id === p.id)
              const mastered = own.filter(t => t.status === 'mastered').length
              const lessons = own.filter(t => t.lesson_id).length
              const gl = learner ? learnerForPath(learner, p) : null
              const deadline = pathDeadline(p)
              const checking = p.status === 'diagnosing'
              return (
                <li key={p.id}>
                  <Card>
                    <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">{checking ? 'Check not finished' : mastered === own.length && own.length > 0 ? 'Complete' : 'In progress'}</p>
                    <h2 className="mt-1.5 font-display text-[22px] leading-snug text-ink"><RichText text={p.goal} /></h2>
                    <dl className="mt-3 grid grid-cols-2 gap-y-3 text-[14px] sm:grid-cols-3">
                      <div><dt className="text-muted">For</dt><dd className="mt-0.5 font-medium text-ink">{PURPOSE_LABEL[gl?.purpose ?? ''] ?? '—'}</dd></div>
                      <div><dt className="text-muted">Deadline</dt><dd className="tnum mt-0.5 font-medium text-ink">{deadline ? <>{formatDue(deadline)} <span className="font-normal text-muted">· {deadlineDistance(deadline)}</span></> : 'No deadline'}</dd></div>
                      <div><dt className="text-muted">Time each week</dt><dd className="mt-0.5 font-medium text-ink">{HOURS_CHOICES.find(c => c.value === gl?.weekly_hours)?.label ?? (gl?.weekly_hours ? `${gl.weekly_hours} h` : '—')}</dd></div>
                    </dl>
                    {!checking && own.length > 0 && (
                      <div className="mt-4">
                        <div className="mb-2 flex items-center justify-between text-[13px]"><span className="text-muted">Path</span><span className="tnum font-medium text-ink">{mastered} of {own.length} topics</span></div>
                        <ProgressBar value={mastered} max={Math.max(1, own.length)} label={`Progress for ${toPlainText(p.goal)}`} />
                      </div>
                    )}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {checking
                        ? <Link href="/start" className={buttonClass('secondary', 'md')}>Continue the check<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>
                        : <Link href={`/learn#goal-${p.id}`} className={buttonClass('secondary', 'md')}>Open<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>}
                      {!checking && <GoalEdit pathId={p.id} deadline={deadline} purpose={gl?.purpose ?? null} hours={gl?.weekly_hours ?? null} purposes={purposes} hoursChoices={HOURS_CHOICES} />}
                      <span className="ml-auto"><GoalDelete pathId={p.id} goal={p.goal} lessons={lessons} /></span>
                    </div>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
        {paths.length > 0 && <p className="mt-3 text-[13px] text-muted">To add a goal, use <Link href="/learn" className="font-medium text-accent hover:underline underline-offset-4">Learn something new</Link> on the Learn page.</p>}
      </section>

      <section className="mb-10">
        <SectionTitle>Account</SectionTitle>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-medium text-ink">{profile.full_name}</p>
              {email && <p className="truncate text-[14px] text-muted">{email}</p>}
            </div>
            <form action="/api/auth/signout" method="post">
              <button type="submit" className={buttonClass('secondary', 'md')}><LogOut className="h-4 w-4" strokeWidth={1.75} />Sign out</button>
            </form>
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle>Delete account</SectionTitle>
        <div className="rounded-[14px] border border-danger-line bg-surface p-5">
          <p className="text-[15px] leading-relaxed text-ink-2">Permanently delete your account and everything in it: goals, lessons, progress, checks and animations. This can’t be undone.</p>
          <div className="mt-4"><AccountDelete email={email || profile.full_name} /></div>
        </div>
      </section>
    </div>
  )
}

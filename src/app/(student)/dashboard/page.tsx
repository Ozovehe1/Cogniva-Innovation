import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Check, Circle, Lock, Plus, RotateCcw } from 'lucide-react'
import { getSessionProfile } from '@/lib/auth'
import { loadPathView, openingLines, PURPOSE_LABEL, formatDue } from '@/lib/path-view'
import { learnerForPath } from '@/lib/learner'
import { VoiceWarm } from '@/components/voice-warm'
import { Card, Eyebrow, PageHeader, ProgressBar, SectionTitle, buttonClass, cx } from '@/components/ui'
import { TopicStart } from '@/components/topic-start'
import { HandPreload } from '@/components/whiteboard/hand-preload'

export const dynamic = 'force-dynamic'

export default async function Dashboard() {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) redirect('/login')
  const firstName = profile.full_name?.split(' ')[0] ?? 'there'
  const { learner, paths, diagnosing, path, topics, progress, next } = await loadPathView(supabase, profile.id)

  if (!learner?.completed_at || !path || path.status !== 'ready') {
    const started = !!learner && Object.keys(learner.answers ?? {}).length > 0
    const checking = !!diagnosing
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center">
        <Eyebrow className="mb-3">Welcome, {firstName}</Eyebrow>
        <h1 className="font-display text-[34px] leading-tight text-ink md:text-[40px]">
          {checking ? 'Finish your short check.' : started ? 'Let’s pick up where you left off.' : 'Let’s get to know each other.'}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          {checking
            ? 'A few more questions and your tutor will know what you know now and what to learn next.'
            : 'Your AI tutor asks what you want to learn, why it matters and how you’re feeling, then runs a short adaptive check to find where to start. About five minutes.'}
        </p>
        <div className="mt-8">
          <Link href="/start" className={buttonClass('primary', 'lg', 'w-full sm:w-auto')}>
            {checking ? 'Continue the check' : started ? 'Continue' : 'Get started'}
            <ArrowRight className="h-4 w-4" strokeWidth={2} />
          </Link>
        </div>
      </div>
    )
  }

  const title = (id: string) => path.graph.nodes.find(n => n.id === id)?.title ?? id
  const mastered = topics.filter(t => t.status === 'mastered').length
  const nextLessonDone = next?.lesson_id ? !!progress.get(next.lesson_id)?.completed_at : false
  const nextStarted = next?.lesson_id ? (progress.get(next.lesson_id)?.step_index ?? 0) > 0 : false
  const knownNow = [...new Set([...(path.known ?? []), ...topics.filter(t => t.status === 'mastered').map(t => t.node_id)])]
  const upNext = topics.filter(t => t.status === 'ready' || t.status === 'review' || t.status === 'learning').map(t => t.title)
  const goalLearner = learnerForPath(learner, path)
  // Fetch the up-next lesson's opening lines into the voice cache now, so Start speaks at once.
  const lines = next?.lesson_id && !nextLessonDone ? await openingLines(supabase, next.lesson_id) : []

  return (
    <div>
      <HandPreload />
      <VoiceWarm lessonId={next?.lesson_id && !nextLessonDone ? next.lesson_id : null} lines={lines} />
      <PageHeader eyebrow="Home" title={<>Hello, {firstName}</>}
        actions={<Link href="/start?new=1" className={buttonClass('secondary', 'md')}><Plus className="h-4 w-4" strokeWidth={2} />Learn something new</Link>} />

      {diagnosing && (
        <section className="mb-6 flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-5 sm:flex-row sm:items-center">
          <p className="flex-1 text-[15px] leading-relaxed text-ink">Your short check for <span className="font-medium">{diagnosing.goal}</span> is waiting. Finish it to add this path.</p>
          <Link href="/start" className={buttonClass('primary', 'md')}>Continue the check<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>
        </section>
      )}

      {/* Goal and plan */}
      <Card className="mb-6">
        <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">{paths.length > 1 ? 'Your most recent goal' : 'Your goal'}</p>
        <h2 className="mt-1.5 font-display text-[24px] leading-snug text-ink md:text-[28px]">{path.goal}</h2>
        <dl className="mt-4 grid grid-cols-2 gap-y-3 text-[14px] sm:grid-cols-4">
          <div><dt className="text-muted">For</dt><dd className="mt-0.5 font-medium text-ink">{PURPOSE_LABEL[goalLearner.purpose ?? ''] ?? '—'}</dd></div>
          <div><dt className="text-muted">Deadline</dt><dd className="tnum mt-0.5 font-medium text-ink">{goalLearner.deadline ? formatDue(goalLearner.deadline) : 'None'}</dd></div>
          <div><dt className="text-muted">Lessons</dt><dd className="tnum mt-0.5 font-medium text-ink">About {path.plan.lessonMinutes} min</dd></div>
          <div><dt className="text-muted">Rhythm</dt><dd className="tnum mt-0.5 font-medium text-ink">{path.plan.sessionsPerWeek}× a week</dd></div>
        </dl>
        {path.plan.note && <p className="mt-4 border-t border-line pt-3 text-[14px] leading-relaxed text-muted">{path.plan.note}</p>}
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-[13px]"><span className="text-muted">Path</span><span className="tnum font-medium text-ink">{mastered} of {topics.length} topics</span></div>
          <ProgressBar value={mastered} max={Math.max(1, topics.length)} label="Path progress" />
        </div>
      </Card>

      {/* Next step */}
      {next && (
        <section className="mb-6 rounded-[14px] border border-accent-line bg-accent-soft p-5 md:p-6">
          <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-accent">{next.status === 'review' ? 'Back to basics' : 'Up next'}</p>
          <h2 className="mt-1.5 font-display text-[24px] leading-snug text-ink">{next.title}</h2>
          {next.summary && <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{next.summary}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {next.lesson_id ? (
              nextLessonDone
                ? <Link href={`/learn/${next.lesson_id}/check`} className={buttonClass('primary', 'md')}>Take the mastery check<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>
                : <Link href={`/learn/${next.lesson_id}`} className={buttonClass('primary', 'md')}>{nextStarted ? 'Continue lesson' : 'Start lesson'}<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>
            ) : <TopicStart topicId={next.id} />}
            {next.due_on && <span className="tnum text-[13px] text-muted">Aim to finish by {formatDue(next.due_on)}</span>}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <section className="space-y-6 lg:col-span-3">
          {paths.map(entry => (
            <div key={entry.path.id}>
              <SectionTitle action={<span className="tnum text-[13px] text-muted">{entry.mastered} of {entry.topics.length} mastered</span>}>
                {paths.length > 1 ? entry.path.goal : 'Your path'}
              </SectionTitle>
              <Card padded={false}>
                <ol className="divide-y divide-line">
                  {entry.topics.map(t => {
                    const p = t.lesson_id ? progress.get(t.lesson_id) : undefined
                    const open = t.status !== 'locked'
                    const state = t.status === 'mastered' ? 'Mastered' : p?.completed_at ? 'Check due' : (p?.step_index ?? 0) > 0 ? 'In progress' : t.status === 'locked' ? 'Locked' : t.lesson_id ? 'Ready' : 'Not started'
                    const body = (
                      <>
                        <span className={cx('flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border', t.status === 'mastered' ? 'border-accent bg-accent text-white' : t.status === 'locked' ? 'border-line text-faint' : 'border-accent text-accent')}>
                          {t.status === 'mastered' ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : t.status === 'locked' ? <Lock className="h-3 w-3" strokeWidth={2} /> : t.status === 'review' ? <RotateCcw className="h-3 w-3" strokeWidth={2} /> : <Circle className="h-2.5 w-2.5 fill-current" />}
                        </span>
                        <span className={cx('min-w-0 flex-1 text-[15px] leading-snug', open ? 'text-ink' : 'text-muted')}>{t.title}</span>
                        <span className="tnum flex-shrink-0 text-[12px] text-muted">{state}</span>
                      </>
                    )
                    return (
                      <li key={t.id}>
                        {open && t.lesson_id
                          ? <Link href={p?.completed_at && t.status !== 'mastered' ? `/learn/${t.lesson_id}/check` : `/learn/${t.lesson_id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-sunken">{body}</Link>
                          : <div className="flex items-center gap-3 px-5 py-3.5">{body}</div>}
                      </li>
                    )
                  })}
                </ol>
              </Card>
            </div>
          ))}
          <Link href="/learn" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline underline-offset-4">All lessons <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} /></Link>
        </section>
        <aside className="space-y-6 lg:col-span-2">
          <section>
            <SectionTitle>What you know now</SectionTitle>
            <Card>
              {knownNow.length ? <ul className="space-y-2 text-[15px] text-ink">{knownNow.map(k => <li key={k} className="flex gap-2"><Check className="mt-1 h-4 w-4 flex-shrink-0 text-accent" strokeWidth={2} />{title(k)}</li>)}</ul>
                : <p className="text-[15px] text-muted">We’re building this from the first step.</p>}
            </Card>
          </section>
          <section>
            <SectionTitle>What’s next</SectionTitle>
            <Card>
              <ul className="space-y-2 text-[15px] text-ink">{upNext.map(k => <li key={k} className="flex gap-2"><ArrowRight className="mt-1 h-4 w-4 flex-shrink-0 text-accent" strokeWidth={2} />{k}</li>)}</ul>
            </Card>
          </section>
        </aside>
      </div>
    </div>
  )
}

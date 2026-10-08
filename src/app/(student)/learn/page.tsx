import Link from 'next/link'
import { ArrowRight, BookOpen, Check, Lock, Plus } from 'lucide-react'
import { RichText } from '@/components/rich-text'
import { getSessionProfile } from '@/lib/auth'
import { loadPathView, loadStrayLessons, openingLines, formatDue } from '@/lib/path-view'
import { VoiceWarm } from '@/components/voice-warm'
import { Badge, Card, EmptyState, PageHeader, buttonClass } from '@/components/ui'
import { HandPreload } from '@/components/whiteboard/hand-preload'
import { TopicStart } from '@/components/topic-start'
import { GoalDelete, LessonDelete } from '@/components/delete-dialog'

export const dynamic = 'force-dynamic'

const STATUS: Record<string, string> = { ready: 'Ready', learning: 'In progress', mastered: 'Mastered', review: 'Review', locked: 'Locked' }

export default async function LearnPage() {
  const { supabase, profile } = await getSessionProfile()
  const view = profile ? await loadPathView(supabase, profile.id) : null
  const nextLesson = view?.next?.lesson_id && !view.progress.get(view.next.lesson_id)?.completed_at ? view.next.lesson_id : null
  const lines = nextLesson ? await openingLines(supabase, nextLesson) : []
  const stray = profile ? await loadStrayLessons(supabase, profile.id) : []
  const completed = !!view?.learner?.completed_at

  return (
    <div className="max-w-4xl">
      <VoiceWarm lessonId={nextLesson} lines={lines} />
      <HandPreload />
      <PageHeader
        eyebrow="Learn"
        title="Lessons"
        actions={completed ? <Link href="/start?new=1" className={buttonClass('secondary', 'md')}><Plus className="h-4 w-4" strokeWidth={2} />Learn something new</Link> : undefined}
        description="Lessons written for you by your AI tutor, at your level and pace, taught on a live whiteboard with a natural voice. Each topic ends with a short mastery check that unlocks the next."
      />
      {!view?.path || view.path.status !== 'ready' ? (
        <EmptyState icon={<BookOpen className="h-5 w-5" strokeWidth={1.75} />} title={completed ? 'No goals right now' : 'Your lessons start with a short conversation'}
          action={<Link href={completed && !view?.diagnosing ? '/start?new=1' : '/start'} className={buttonClass('primary', 'md')}>{completed ? (view?.diagnosing ? 'Continue the check' : 'Learn something new') : 'Get started'}</Link>}>
          {completed ? 'Tell your AI tutor what you want to learn next and it will build you a new path.' : 'Tell your AI tutor what you want to learn, then take a short adaptive check. Your first lesson is written from that.'}
        </EmptyState>
      ) : (
        <div className="space-y-10">
          {view.paths.map(entry => (
            <section key={entry.path.id} id={`goal-${entry.path.id}`} className="scroll-mt-20">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Goal · <span className="tnum normal-case tracking-normal">{entry.mastered} of {entry.topics.length} mastered</span></p>
                  <h2 className="mt-1 font-display text-[22px] leading-snug text-ink"><RichText text={entry.path.goal} /></h2>
                </div>
                <GoalDelete pathId={entry.path.id} goal={entry.path.goal} lessons={entry.topics.filter(t => t.lesson_id).length} compact className="-mr-2 flex-shrink-0" />
              </div>
              <ol className="space-y-3">
                {entry.topics.map((t, i) => {
                  const p = t.lesson_id ? view.progress.get(t.lesson_id) : undefined
                  return (
                    <li key={t.id}>
                      <Card className={t.status === 'locked' ? 'opacity-70' : undefined}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="tnum text-[13px] text-faint">{String(i + 1).padStart(2, '0')}</span>
                          <Badge className={t.status === 'mastered' ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-sunken text-ink-2'}>
                            {t.status === 'mastered' && <Check className="h-3 w-3" strokeWidth={2.25} />}{t.status === 'locked' && <Lock className="h-3 w-3" strokeWidth={2} />}{STATUS[t.status]}
                          </Badge>
                          {t.due_on && t.status !== 'mastered' && <span className="tnum text-[12px] text-faint">by {formatDue(t.due_on)}</span>}
                        </div>
                        <h3 className="mt-2 font-display text-[21px] leading-snug text-ink"><RichText text={t.title} /></h3>
                        {t.summary && <p className="mt-1 text-sm leading-relaxed text-muted"><RichText text={t.summary} /></p>}
                        {t.status !== 'locked' && (
                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            {t.lesson_id ? (
                              <>
                                <Link href={`/learn/${t.lesson_id}`} className={buttonClass(p?.completed_at ? 'secondary' : 'primary', 'md')}>
                                  {p?.completed_at ? 'Review lesson' : (p?.step_index ?? 0) > 0 ? 'Continue' : 'Start lesson'}<ArrowRight className="h-4 w-4" strokeWidth={2} />
                                </Link>
                                {t.status !== 'mastered' && <Link href={`/learn/${t.lesson_id}/check`} className={buttonClass(p?.completed_at ? 'primary' : 'ghost', 'md')}>Mastery check</Link>}
                                <span className="ml-auto"><LessonDelete lessonId={t.lesson_id} title={t.title} compact inPath /></span>
                              </>
                            ) : <TopicStart topicId={t.id} />}
                          </div>
                        )}
                      </Card>
                    </li>
                  )
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
      {stray.length > 0 && (
        <section id="other-lessons" className="mt-10 scroll-mt-20">
          <div className="mb-3">
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Not on a goal · {stray.length}</p>
            <h2 className="mt-1 font-display text-[22px] leading-snug text-ink">Other lessons</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">Lessons your tutor wrote that aren’t part of a goal now, such as a first lesson drafted during a check you didn’t finish.</p>
          </div>
          <ul className="space-y-3">
            {stray.map(l => (
              <li key={l.id}>
                <Card>
                  {l.subject && <p className="text-[12px] text-faint">{l.subject}</p>}
                  <h3 className="mt-1 font-display text-[21px] leading-snug text-ink"><RichText text={l.title} /></h3>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Link href={`/learn/${l.id}`} className={buttonClass('secondary', 'md')}>Open lesson<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>
                    <span className="ml-auto"><LessonDelete lessonId={l.id} title={l.title} compact /></span>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

import Link from 'next/link'
import { ArrowRight, BookOpen, Check, Lock } from 'lucide-react'
import { getSessionProfile } from '@/lib/auth'
import { loadPathView, formatDue } from '@/lib/path-view'
import { Badge, Card, EmptyState, PageHeader, buttonClass } from '@/components/ui'
import { TopicStart } from '@/components/topic-start'

export const dynamic = 'force-dynamic'

const STATUS: Record<string, string> = { ready: 'Ready', learning: 'In progress', mastered: 'Mastered', review: 'Review', locked: 'Locked' }

export default async function LearnPage() {
  const { supabase, profile } = await getSessionProfile()
  const view = profile ? await loadPathView(supabase, profile.id) : null
  const { data: samples } = await supabase.from('lessons').select('id, title, subject').eq('status', 'approved').is('owner_student_id', null).is('tutor_id', null).order('created_at').limit(3)

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Learn"
        title={view?.path?.status === 'ready' ? view.path.goal : 'Lessons'}
        description="Lessons written for you by your AI tutor, at your level and pace, taught on a live whiteboard with a natural voice. Each topic ends with a short mastery check that unlocks the next."
      />
      {!view?.path || view.path.status !== 'ready' ? (
        <EmptyState icon={<BookOpen className="h-5 w-5" strokeWidth={1.75} />} title="Your lessons start with a short conversation"
          action={<Link href="/start" className={buttonClass('primary', 'md')}>Get started</Link>}>
          Tell your AI tutor what you want to learn, then take a short adaptive check. Your first lesson is written from that.
        </EmptyState>
      ) : (
        <ol className="space-y-3">
          {view.topics.map((t, i) => {
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
                  <h3 className="mt-2 font-display text-[21px] leading-snug text-ink">{t.title}</h3>
                  {t.summary && <p className="mt-1 text-sm leading-relaxed text-muted">{t.summary}</p>}
                  {t.status !== 'locked' && (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      {t.lesson_id ? (
                        <>
                          <Link href={`/learn/${t.lesson_id}`} className={buttonClass(p?.completed_at ? 'secondary' : 'primary', 'md')}>
                            {p?.completed_at ? 'Review lesson' : (p?.step_index ?? 0) > 0 ? 'Continue' : 'Start lesson'}<ArrowRight className="h-4 w-4" strokeWidth={2} />
                          </Link>
                          {t.status !== 'mastered' && <Link href={`/learn/${t.lesson_id}/check`} className={buttonClass(p?.completed_at ? 'primary' : 'ghost', 'md')}>Mastery check</Link>}
                        </>
                      ) : <TopicStart topicId={t.id} />}
                    </div>
                  )}
                </Card>
              </li>
            )
          })}
        </ol>
      )}
      {(samples ?? []).length > 0 && (
        <section className="mt-10 border-t border-line pt-6">
          <h2 className="text-[15px] font-semibold text-ink">Sample lesson</h2>
          <ul className="mt-3 space-y-2">
            {(samples as { id: string; title: string; subject: string }[]).map(s => (
              <li key={s.id}><Link href={`/learn/${s.id}`} className="inline-flex items-center gap-1.5 text-[15px] font-medium text-accent hover:underline underline-offset-4">{s.title}<span className="font-normal text-muted">· {s.subject}</span></Link></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

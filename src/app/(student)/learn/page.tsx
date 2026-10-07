import Link from 'next/link'
import { ArrowRight, BookOpen, Check } from 'lucide-react'
import { getSessionProfile } from '@/lib/auth'
import { Badge, Card, EmptyState, PageHeader, ProgressBar } from '@/components/ui'
import { formatDuration } from '@/lib/lesson-sections'

export const dynamic = 'force-dynamic'

type LessonRow = { id: string; title: string; subject: string; objectives: string[] | null; chapters: { count?: number; ms?: number }[] | null }
type ProgressRow = { lesson_id: string; step_index: number; completed_at: string | null }

export default async function LearnPage() {
  const { supabase, profile } = await getSessionProfile()
  const [{ data: lessons }, { data: progress }] = await Promise.all([
    supabase.from('lessons').select('id, title, subject, objectives, chapters').eq('status', 'approved').order('created_at', { ascending: true }),
    profile
      ? supabase.from('lesson_progress').select('lesson_id, step_index, completed_at').eq('student_id', profile.id)
      : Promise.resolve({ data: [] as ProgressRow[] }),
  ])
  const list = (lessons ?? []) as LessonRow[]
  const byLesson = new Map(((progress ?? []) as ProgressRow[]).map(p => [p.lesson_id, p]))

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Learn"
        title="Lessons"
        description="Short lessons taught on a whiteboard. Your tutor checks in as you go and explains things another way when you need it."
      />
      {list.length === 0 ? (
        <EmptyState icon={<BookOpen className="h-5 w-5" strokeWidth={1.75} />} title="No lessons yet">
          Lessons appear here once a tutor approves them.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {list.map(l => {
            const p = byLesson.get(l.id)
            const ch = Array.isArray(l.chapters) ? l.chapters : []
            const total = ch.reduce((a, c) => a + (typeof c.count === 'number' ? c.count : 0), 0)
            const ms = ch.reduce((a, c) => a + (typeof c.ms === 'number' ? c.ms : 0), 0)
            const done = !!p?.completed_at
            const started = !!p && !done && p.step_index > 0
            return (
              <li key={l.id}>
                <Link href={`/learn/${l.id}`} className="group block h-full rounded-[14px]">
                  <Card className="flex h-full flex-col transition-colors duration-150 group-hover:border-line-strong">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Badge className="border-line bg-sunken text-ink-2">{l.subject}</Badge>
                      {done && (
                        <Badge className="border-accent-line bg-accent-soft text-accent">
                          <Check className="h-3 w-3" strokeWidth={2.25} />Completed
                        </Badge>
                      )}
                    </div>
                    <h3 className="font-display text-[22px] leading-snug text-ink">{l.title}</h3>
                    {l.objectives && l.objectives.length > 0 && (
                      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">{l.objectives[0]}</p>
                    )}
                    {ms > 0 && (
                      <p className="tnum mt-2 text-[13px] text-faint">About {formatDuration(ms)}{ch.length > 1 ? ` · ${ch.length} sections` : ''}</p>
                    )}
                    <div className="mt-auto pt-5">
                      {started && <ProgressBar value={p!.step_index} max={total || 1} label="Lesson progress" className="mb-3" />}
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent">
                        {done ? 'Review lesson' : started ? 'Continue' : 'Start lesson'}
                        <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={1.75} />
                      </span>
                    </div>
                  </Card>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

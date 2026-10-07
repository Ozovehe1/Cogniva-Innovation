import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSessionProfile } from '@/lib/auth'
import { validateScript } from '@/lib/lesson-schema'
import { Eyebrow } from '@/components/ui'
import { LessonSession } from '@/components/lesson-session'

export const dynamic = 'force-dynamic'

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const { supabase, profile } = await getSessionProfile()
  const { data: lesson } = await supabase
    .from('lessons').select('id, title, subject, objectives, script').eq('id', id).eq('status', 'approved').maybeSingle()
  if (!lesson) notFound()
  const l = lesson as { id: string; title: string; subject: string; objectives: string[] | null; script: unknown }
  const { steps } = validateScript(l.script)

  let resumeAt = 0
  if (profile) {
    const { data: p } = await supabase
      .from('lesson_progress').select('step_index, completed_at').eq('student_id', profile.id).eq('lesson_id', id).maybeSingle()
    const prog = p as { step_index: number; completed_at: string | null } | null
    if (prog && !prog.completed_at) resumeAt = prog.step_index
  }

  return (
    <div className="mx-auto max-w-[920px]">
      <Link href="/learn" className="-ml-1 mb-4 inline-flex h-9 items-center gap-1.5 rounded-md px-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        All lessons
      </Link>
      <Eyebrow className="mb-2">{l.subject}</Eyebrow>
      <h1 className="mb-5 font-display text-[28px] leading-[1.1] text-ink md:mb-6 md:text-[36px]">{l.title}</h1>
      <LessonSession lessonId={l.id} steps={steps} resumeAt={resumeAt} mode="student" />
      {l.objectives && l.objectives.length > 0 && (
        <section className="mt-8 border-t border-line pt-6">
          <h2 className="text-[15px] font-semibold text-ink">In this lesson</h2>
          <ul className="mt-3 space-y-2">
            {l.objectives.map((o, i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-ink-2">
                <span className="tnum w-5 flex-shrink-0 text-[13px] leading-[1.6rem] text-faint">{String(i + 1).padStart(2, '0')}</span>
                {o}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

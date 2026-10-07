import Link from 'next/link'
import { notFound } from 'next/navigation'
import { after } from 'next/server'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { prefetchNextLesson } from '@/lib/path'
import { ArrowLeft } from 'lucide-react'
import { getSessionProfile } from '@/lib/auth'
import { validateScript } from '@/lib/lesson-schema'
import { RichText } from '@/components/rich-text'
import { LESSON_MAX_STEPS, estimateMs, formatDuration, normalizeChapters } from '@/lib/lesson-sections'
import { Eyebrow } from '@/components/ui'
import { LessonSession } from '@/components/lesson-session'
import { LessonPreparing } from '@/components/lesson-preparing'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export default async function LessonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ autoplay?: string }> }) {
  const { id } = await params
  const { autoplay } = await searchParams
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const { supabase, profile } = await getSessionProfile()
  // RLS: shared approved lessons, or this learner's own AI lessons (no approval step).
  const { data: lesson } = await supabase
    .from('lessons').select('id, title, subject, objectives, script, chapters, status, owner_student_id, draft_status').eq('id', id).maybeSingle()
  if (!lesson) notFound()
  const l = lesson as { id: string; title: string; subject: string; objectives: string[] | null; script: unknown; chapters: unknown; status: string; owner_student_id: string | null; draft_status: string }
  const own = !!profile && l.owner_student_id === profile.id
  if (!own && l.status !== 'approved') notFound()
  const { data: topicRow } = own ? await supabase.from('path_topics').select('id, status, path_id, position').eq('lesson_id', id).maybeSingle() : { data: null }
  // What follows this lesson on the learner's path: its mastery check until the topic is mastered, then the next
  // topic's lesson (written ahead while this one plays).
  let upNext: { href: string; title: string; eyebrow?: string; note?: string } | null = null
  if (own && topicRow) {
    const t = topicRow as { id: string; status: string; path_id: string; position: number }
    if (t.status !== 'mastered') upNext = { href: `/learn/${id}/check?autostart=1`, eyebrow: 'Up next · quick check', title: 'Mastery check', note: 'Four questions; 3 of 4 unlocks the next topic.' }
    else {
      const { data: nx } = await supabase.from('path_topics').select('title, lesson_id, status').eq('path_id', t.path_id).gt('position', t.position).neq('status', 'mastered').order('position').limit(1).maybeSingle()
      const n = nx as { title: string; lesson_id: string | null; status: string } | null
      if (n?.lesson_id && n.status !== 'locked') upNext = { href: `/learn/${n.lesson_id}?autoplay=1`, title: n.title, note: 'Next lesson on your path' }
    }
  }
  if (own && topicRow) {
    const h = await headers()
    const origin = h.get('host') ? `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}` : undefined
    after(async () => {
      const db = createAdminClient()
      // A lesson written ahead becomes the one being learned once it is opened.
      if ((topicRow as { status: string }).status === 'ready') await db.from('path_topics').update({ status: 'learning' }).eq('id', (topicRow as { id: string }).id)
      // While this one plays, write the next lesson in the path (once this one is fully drafted).
      await prefetchNextLesson(db, id, { origin }).catch(() => null)
    })
  }
  const { data: lp } = own ? await supabase.from('learner_profiles').select('age_band').eq('student_id', profile!.id).maybeSingle() : { data: null }
  const minor = lp ? ['under13', '13to17'].includes((lp as { age_band: string | null }).age_band ?? '') : null
  const drafting = own && ['outlining', 'drafting', 'paused'].includes(l.draft_status)
  const { steps } = validateScript(l.script, { maxSteps: LESSON_MAX_STEPS })
  const chapters = normalizeChapters(l.chapters, steps.length, l.title, steps)

  // Resume exactly where the student stopped (any device). If the lesson changed since, fall back to the start of their section.
  let resumeAt = 0
  let answered: number[] = []
  let furthest = 0
  if (profile) {
    const { data: p } = await supabase
      .from('lesson_progress').select('step_index, section_index, furthest_index, answers, script_steps, completed_at')
      .eq('student_id', profile.id).eq('lesson_id', id).maybeSingle()
    const prog = p as { step_index: number; section_index: number; furthest_index: number; answers: Record<string, unknown> | null; script_steps: number | null; completed_at: string | null } | null
    if (prog && !prog.completed_at) {
      const same = prog.script_steps === null || prog.script_steps === steps.length
      if (same) {
        resumeAt = Math.min(prog.step_index, steps.length)
        answered = Object.keys(prog.answers ?? {}).map(Number).filter(n => Number.isInteger(n) && n < steps.length)
        furthest = Math.min(prog.furthest_index ?? 0, steps.length)
      } else {
        const ch = chapters[Math.min(prog.section_index ?? 0, chapters.length - 1)]
        resumeAt = ch ? ch.start + (steps[ch.start]?.type === 'clear' ? 1 : 0) : 0
        furthest = resumeAt
      }
    }
  }
  const totalMs = estimateMs(steps)


  return (
    <div className="mx-auto max-w-[920px]">
      <Link href="/learn" className="-ml-1 mb-4 inline-flex h-9 items-center gap-1.5 rounded-md px-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        Your lessons
      </Link>
      <Eyebrow className="mb-2">{l.subject}</Eyebrow>
      <h1 className="font-display text-[28px] leading-[1.1] text-ink md:text-[36px]"><RichText text={l.title} /></h1>
      <p className="tnum mb-5 mt-2 text-[13px] text-muted md:mb-6">
        {steps.length ? <>About {formatDuration(totalMs)}{chapters.length > 1 ? ` · ${chapters.length} sections` : ''}</> : own ? 'Written for you by your AI tutor' : null}
      </p>
      {steps.length === 0 ? (
        <LessonPreparing lessonId={l.id} own={own} />
      ) : (
        <>
          {drafting && <LessonPreparing lessonId={l.id} own={own} compact readySteps={steps.length} />}
          <LessonSession lessonId={l.id} steps={steps} chapters={chapters} title={l.title} resumeAt={resumeAt} answered={answered} furthest={furthest} mode="student"
            checkHref={topicRow ? `/learn/${l.id}/check` : undefined} minor={minor} partial={drafting}
            upNext={upNext} autoPlay={autoplay === '1' && resumeAt === 0} />
        </>
      )}
      {topicRow && steps.length > 0 && (
        <section className="mt-6 flex flex-col gap-3 rounded-[14px] border border-accent-line bg-accent-soft p-5 sm:flex-row sm:items-center">
          <p className="flex-1 text-[15px] leading-relaxed text-ink">When you’ve finished, a four-question mastery check unlocks the next topic.</p>
          <Link href={`/learn/${l.id}/check`} className="inline-flex h-10 items-center justify-center rounded-[10px] bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover">Mastery check</Link>
        </section>
      )}
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

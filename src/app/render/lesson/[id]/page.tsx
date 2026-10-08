import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateScript } from '@/lib/lesson-schema'
import { LESSON_MAX_STEPS, normalizeChapters } from '@/lib/lesson-sections'
import { verifyRenderToken } from '@/lib/lesson-video'
import { RenderPlayer } from './render-player'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'GeniusMap lesson video', robots: { index: false, follow: false } }

/**
 * The lesson as a video frame, for the Modal recorder only (see lib/lesson-video): 1280x720, no controls, the lesson
 * plays through by itself. Access needs the signed, expiring job token minted when a learner started the render.
 */
export default async function RenderLessonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ job?: string; exp?: string; sig?: string }> }) {
  const { id } = await params
  const { job, exp, sig } = await searchParams
  if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyRenderToken(id, job, exp, sig)) notFound()
  const db = createAdminClient()
  const { data } = await db.from('lessons').select('id, title, subject, script, chapters').eq('id', id).maybeSingle()
  const l = data as { id: string; title: string; subject: string | null; script: unknown; chapters: unknown } | null
  if (!l) notFound()
  const { steps } = validateScript(l.script, { maxSteps: LESSON_MAX_STEPS })
  if (!steps.length) notFound()
  const chapters = normalizeChapters(l.chapters, steps.length, l.title, steps)
  return <RenderPlayer lessonId={l.id} title={l.title} subject={l.subject ?? ''} steps={steps} chapters={chapters} />
}

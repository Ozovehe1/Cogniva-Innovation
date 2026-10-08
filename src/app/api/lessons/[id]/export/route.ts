import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { validateScript } from '@/lib/lesson-schema'
import { LESSON_MAX_STEPS, normalizeChapters } from '@/lib/lesson-sections'
import { exportFileName, lessonHtml, lessonText } from '@/lib/lesson-export'

export const dynamic = 'force-dynamic'

/**
 * GET /api/lessons/:id/export?format=html|txt — an offline copy of a lesson the learner can open:
 * their own AI lesson or a shared approved one (read with the learner's session, so RLS applies).
 * html = one self-contained file (transcript, boards as SVG, clip links); txt = plain transcript.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const format = new URL(request.url).searchParams.get('format') === 'txt' ? 'txt' : 'html'
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data } = await supabase.from('lessons').select('id, title, subject, objectives, script, chapters, status, owner_student_id').eq('id', id).maybeSingle()
  const l = data as { id: string; title: string; subject: string; objectives: string[] | null; script: unknown; chapters: unknown; status: string; owner_student_id: string | null } | null
  if (!l || (l.owner_student_id !== profile.id && l.status !== 'approved')) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { steps } = validateScript(l.script, { maxSteps: LESSON_MAX_STEPS })
  if (!steps.length) return NextResponse.json({ error: 'This lesson is still being written.' }, { status: 409 })
  const chapters = normalizeChapters(l.chapters, steps.length, l.title, steps)
  const origin = new URL(request.url).origin
  const lesson = { title: l.title, subject: l.subject ?? '', objectives: l.objectives ?? [], steps, chapters, url: `${origin}/learn/${l.id}` }
  const body = format === 'txt' ? lessonText(lesson) : lessonHtml(lesson)
  const name = exportFileName(l.title, format)
  return new NextResponse(body, {
    headers: {
      'Content-Type': format === 'txt' ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}

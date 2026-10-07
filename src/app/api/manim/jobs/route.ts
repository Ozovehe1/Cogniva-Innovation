import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { generateManimCode } from '@/lib/lesson-ai'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchRender, withUrl, type ManimJob } from '@/lib/manim'

export const maxDuration = 90

/** GET /api/manim/jobs?lessonId=  — the tutor's own jobs (optionally for one lesson). */
export async function GET(request: Request) {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (profile.role !== 'tutor') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const lessonId = new URL(request.url).searchParams.get('lessonId')
  let q = supabase.from('manim_jobs').select('*').eq('requested_by', profile.id).order('created_at', { ascending: false }).limit(50)
  if (lessonId) q = q.eq('lesson_id', lessonId)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jobs: ((data ?? []) as ManimJob[]).map(withUrl) })
}

/**
 * POST /api/manim/jobs  (tutors only)
 * Body: { prompt, lessonId? }. Gemini writes Manim code, a render job is queued on Modal.
 * Student input never reaches this route: only the tutor's own description is used.
 */
export async function POST(request: Request) {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (profile.role !== 'tutor') return NextResponse.json({ error: 'Only tutors can create animations.' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 2000) : ''
  if (prompt.length < 10) return NextResponse.json({ error: 'Describe the animation in a sentence or two.' }, { status: 400 })

  let lessonCtx: { title?: string; subject?: string } = {}
  let lessonId: string | null = null
  if (typeof body.lessonId === 'string') {
    const { data: lesson } = await supabase.from('lessons').select('id, title, subject').eq('id', body.lessonId).eq('tutor_id', profile.id).maybeSingle()
    if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 })
    lessonId = (lesson as { id: string }).id
    lessonCtx = { title: (lesson as { title: string }).title, subject: (lesson as { subject: string }).subject }
  }

  const { data: job, error } = await supabase
    .from('manim_jobs').insert({ lesson_id: lessonId, requested_by: profile.id, prompt, status: 'queued' }).select('*').single()
  if (error || !job) return NextResponse.json({ error: error?.message ?? 'Could not create job' }, { status: 500 })

  let code: string
  try {
    code = await generateManimCode(prompt, { lessonTitle: lessonCtx.title, subject: lessonCtx.subject })
  } catch (err) {
    const message = `Could not write the animation code: ${err instanceof Error ? err.message : String(err)}`
    await supabase.from('manim_jobs').update({ status: 'failed', error: message.slice(0, 1000) }).eq('id', (job as ManimJob).id)
    return NextResponse.json({ error: message }, { status: 502 })
  }
  await supabase.from('manim_jobs').update({ code }).eq('id', (job as ManimJob).id)

  let admin
  try { admin = createAdminClient() } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server not configured' }, { status: 500 })
  }
  const dispatch = await dispatchRender(admin, { id: (job as ManimJob).id, code, attempts: 0, prompt })
  const { data: fresh } = await supabase.from('manim_jobs').select('*').eq('id', (job as ManimJob).id).single()
  return NextResponse.json({ job: withUrl(fresh as ManimJob), dispatched: dispatch.ok, warning: dispatch.ok ? undefined : dispatch.error })
}

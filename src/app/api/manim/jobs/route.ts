import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { generateManimCode, type ManimNarration } from '@/lib/lesson-ai'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchRender, withUrl, type ManimJob } from '@/lib/manim'
import { ensureNarration } from '@/lib/tts-server'

export const maxDuration = 300

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
 * Body: { prompt, lessonId?, narration?, sourceText?, styleNotes? }. Gemini writes Manim code, a render job is queued on Modal.
 * narration: the line spoken over the clip; it is voiced (cached) and its real word timings set the clip's pacing.
 * sourceText / styleNotes: excerpt of the tutor's material and its conventions, followed by the clip.
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

  const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined)
  const narrationText = str(body.narration, 1200)
  const sourceText = str(body.sourceText, 6000)
  const styleNotes = str(body.styleNotes, 2000)

  const { data: job, error } = await supabase
    .from('manim_jobs').insert({ lesson_id: lessonId, requested_by: profile.id, prompt, status: 'queued', narration: narrationText ?? null }).select('*').single()
  if (error || !job) return NextResponse.json({ error: error?.message ?? 'Could not create job' }, { status: 500 })

  // Real word timings for the narration (cached voice); without them the clip is paced by an estimate.
  let narration: ManimNarration | undefined
  if (narrationText) {
    narration = { text: narrationText }
    try {
      const r = await ensureNarration([narrationText], { timeoutMs: 60_000 })
      const c = r.clips[0]
      if (c) narration = { text: narrationText, ms: c.ms, words: c.words }
    } catch (err) {
      console.warn('Clip narration timing unavailable:', err instanceof Error ? err.message : err)
    }
  }

  let code: string
  try {
    code = await generateManimCode(prompt, { lessonTitle: lessonCtx.title, subject: lessonCtx.subject, sourceText, styleNotes, narration })
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

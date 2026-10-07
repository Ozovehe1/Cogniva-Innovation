import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { draftLessonScript } from '@/lib/lesson-ai'
import { validateScript, type ManimClipStep, type Step } from '@/lib/lesson-schema'
import { publicClipUrl } from '@/lib/supabase/admin'

export const maxDuration = 180

type Lesson = { id: string; tutor_id: string; title: string; subject: string; objectives: string[]; status: string; script: Step[] }

async function loadOwn(id: string) {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (profile.role !== 'tutor') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const { data } = await supabase.from('lessons').select('*').eq('id', id).eq('tutor_id', profile.id).maybeSingle()
  if (!data) return { error: NextResponse.json({ error: 'Lesson not found' }, { status: 404 }) }
  return { supabase, profile, lesson: data as Lesson }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await loadOwn(id)
  if ('error' in r) return r.error
  return NextResponse.json({ lesson: r.lesson })
}

/**
 * PATCH actions:
 *  { action: 'update', title?, subject?, objectives? }
 *  { action: 'regenerate', notes? }        — new AI draft from the current objectives (back to draft)
 *  { action: 'approve' } | { action: 'unapprove' }
 *  { action: 'save_script', script }       — validated
 *  { action: 'insert_clip', jobId, afterIndex, caption? } — only approved clips from this tutor's jobs
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await loadOwn(id)
  if ('error' in r) return r.error
  const { supabase, profile, lesson } = r
  const body = await request.json().catch(() => ({}))

  const save = async (patch: Partial<Lesson>) => {
    const { data, error } = await supabase.from('lessons').update(patch).eq('id', id).select('*').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ lesson: data })
  }

  switch (body.action) {
    case 'update': {
      const patch: Partial<Lesson> = {}
      if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 160)
      if (typeof body.subject === 'string' && body.subject.trim()) patch.subject = body.subject.trim().slice(0, 80)
      if (Array.isArray(body.objectives)) {
        patch.objectives = body.objectives.filter((o: unknown): o is string => typeof o === 'string' && !!o.trim()).map((o: string) => o.trim().slice(0, 300)).slice(0, 10)
      }
      return save(patch)
    }
    case 'regenerate': {
      try {
        const script = await draftLessonScript(
          { title: lesson.title, subject: lesson.subject, objectives: lesson.objectives ?? [] },
          typeof body.notes === 'string' ? body.notes.slice(0, 1000) : undefined,
        )
        return save({ script, status: 'draft' })
      } catch (err) {
        console.error('Regenerate failed:', err instanceof Error ? err.message : err)
        return NextResponse.json({ error: 'The AI draft failed. Try again in a moment.' }, { status: 502 })
      }
    }
    case 'approve': {
      const v = validateScript(lesson.script)
      if (!v.ok) return NextResponse.json({ error: `The script has problems and cannot be approved: ${v.errors.slice(0, 3).join('; ')}` }, { status: 400 })
      return save({ status: 'approved' })
    }
    case 'unapprove':
      return save({ status: 'draft' })
    case 'save_script': {
      const v = validateScript(body.script)
      if (!v.ok) return NextResponse.json({ error: v.errors.slice(0, 5).join('; ') }, { status: 400 })
      return save({ script: v.steps, status: 'draft' })
    }
    case 'insert_clip': {
      if (typeof body.jobId !== 'string') return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
      const { data: job } = await supabase
        .from('manim_jobs').select('id, status, video_path, prompt, requested_by').eq('id', body.jobId).eq('requested_by', profile.id).maybeSingle()
      const j = job as { id: string; status: string; video_path: string | null; prompt: string } | null
      if (!j || j.status !== 'approved' || !j.video_path)
        return NextResponse.json({ error: 'Only approved animations can be added to a lesson.' }, { status: 400 })
      const script = Array.isArray(lesson.script) ? [...lesson.script] : []
      const after = typeof body.afterIndex === 'number' ? Math.max(-1, Math.min(script.length - 1, Math.floor(body.afterIndex))) : script.length - 1
      const step: ManimClipStep = {
        type: 'manim_clip',
        url: publicClipUrl(j.video_path),
        jobId: j.id,
        caption: typeof body.caption === 'string' && body.caption.trim() ? body.caption.trim().slice(0, 300) : j.prompt.slice(0, 120),
      }
      script.splice(after + 1, 0, step)
      return save({ script, status: 'draft' })
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await loadOwn(id)
  if ('error' in r) return r.error
  const { error } = await r.supabase.from('lessons').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

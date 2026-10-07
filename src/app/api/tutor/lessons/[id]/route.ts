import { NextResponse, after } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { loadSections, restartDraft, runDraftWork, selfOrigin, syncLessonScript } from '@/lib/lesson-drafting'
import { LESSON_MAX_STEPS, MAX_TARGET, MIN_TARGET, chapterAt, estimateMs, flattenSections, normalizeChapters, validateSection } from '@/lib/lesson-sections'
import { validateScript, type ManimClipStep, type Step } from '@/lib/lesson-schema'
import { publicClipUrl } from '@/lib/supabase/admin'

export const maxDuration = 300

type Lesson = { id: string; tutor_id: string; title: string; subject: string; objectives: string[]; status: string; script: Step[]; chapters: unknown; target_minutes: number | null }

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
  const sections = await loadSections(r.supabase, id)
  return NextResponse.json({ lesson: r.lesson, sections })
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

  const save = async (patch: Partial<Lesson> & Record<string, unknown>) => {
    const { data, error } = await supabase.from('lessons').update(patch).eq('id', id).select('*').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ lesson: data, sections: await loadSections(supabase, id) })
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
      // New outline and sections, drafted in the background; the editor polls /draft.
      const t = Math.round(Number(body.targetMinutes ?? lesson.target_minutes ?? 15))
      if (!Number.isFinite(t) || t < MIN_TARGET || t > MAX_TARGET) return NextResponse.json({ error: `Target length must be ${MIN_TARGET} to ${MAX_TARGET} minutes.` }, { status: 400 })
      const { error } = await restartDraft(supabase, id, t, typeof body.notes === 'string' ? body.notes.slice(0, 1000) : null)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      const origin = selfOrigin(request)
      after(() => runDraftWork(id, { origin }).catch(err => console.error('Draft worker crashed:', err)))
      const { data } = await supabase.from('lessons').select('*').eq('id', id).single()
      return NextResponse.json({ lesson: data, sections: [] })
    }
    case 'approve': {
      const sections = await loadSections(supabase, id)
      if (sections.length > 0) {
        const notReady = sections.filter(x => x.status !== 'ready')
        if (notReady.length) return NextResponse.json({ error: `Section ${notReady[0].position + 1} (“${notReady[0].title}”) isn’t drafted yet.` }, { status: 400 })
        const flat = flattenSections(sections.map(x => ({ title: x.title, steps: x.steps })))
        const v = validateScript(flat.steps, { maxSteps: LESSON_MAX_STEPS })
        if (!v.ok) return NextResponse.json({ error: `The script has problems and cannot be approved: ${v.errors.slice(0, 3).join('; ')}` }, { status: 400 })
        return save({ script: flat.steps, chapters: flat.chapters, status: 'approved' })
      }
      const v = validateScript(lesson.script, { maxSteps: LESSON_MAX_STEPS })
      if (!v.ok) return NextResponse.json({ error: `The script has problems and cannot be approved: ${v.errors.slice(0, 3).join('; ')}` }, { status: 400 })
      return save({ status: 'approved', chapters: normalizeChapters(null, v.steps.length, lesson.title, v.steps) })
    }
    case 'unapprove':
      return save({ status: 'draft' })
    case 'save_script': {
      if ((await loadSections(supabase, id)).length > 0)
        return NextResponse.json({ error: 'This lesson has sections: edit each section’s script instead.' }, { status: 400 })
      const v = validateScript(body.script, { maxSteps: LESSON_MAX_STEPS })
      if (!v.ok) return NextResponse.json({ error: v.errors.slice(0, 5).join('; ') }, { status: 400 })
      return save({ script: v.steps, status: 'draft', chapters: [{ title: lesson.title, start: 0, count: v.steps.length, ms: estimateMs(v.steps) }] })
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
      const sections = await loadSections(supabase, id)
      if (sections.length > 0) {
        // Insert into the section that holds the chosen step of the flattened script.
        const flat = flattenSections(sections.filter(x => x.status === 'ready').map(x => ({ title: x.title, steps: x.steps })))
        const ready = sections.filter(x => x.status === 'ready')
        if (!ready.length) return NextResponse.json({ error: 'No drafted section to add the clip to yet.' }, { status: 400 })
        const ci = after < 0 ? 0 : chapterAt(flat.chapters, after)
        const target = ready[ci]
        const ch = flat.chapters[ci]
        // Offset inside the section's own steps (the flattened copy may carry an extra leading clear).
        const extra = ch.count - target.steps.length
        const offset = after < 0 ? 0 : Math.max(0, after - ch.start - extra + 1)
        const steps = [...target.steps]
        steps.splice(Math.min(offset, steps.length), 0, step)
        const v = validateSection(steps, target.position)
        if (!v.ok) return NextResponse.json({ error: v.errors.slice(0, 3).join('; ') }, { status: 400 })
        await supabase.from('lesson_sections').update({ steps: v.steps }).eq('id', target.id)
        await syncLessonScript(supabase, id)
        return save({ status: 'draft' })
      }
      script.splice(after + 1, 0, step)
      return save({ script, status: 'draft', chapters: [{ title: lesson.title, start: 0, count: script.length, ms: estimateMs(script) }] })
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

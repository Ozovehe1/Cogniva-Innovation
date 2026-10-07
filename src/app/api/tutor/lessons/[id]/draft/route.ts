import { NextResponse, after } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { loadSections, needsWorker, restartDraft, runDraftWork, selfOrigin, syncLessonScript, type SectionRow } from '@/lib/lesson-drafting'
import { MAX_TARGET, MIN_TARGET, estimateMs, validateSection } from '@/lib/lesson-sections'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

type LessonDraft = {
  id: string; status: string; target_minutes: number | null; draft_status: string; draft_error: string | null
  draft_retry_at: string | null; draft_lock_until: string | null
}
const COLS = 'id, status, target_minutes, draft_status, draft_error, draft_retry_at, draft_lock_until'

async function loadOwn(id: string) {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (profile.role !== 'tutor') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const { data } = await supabase.from('lessons').select(COLS).eq('id', id).eq('tutor_id', profile.id).maybeSingle()
  if (!data) return { error: NextResponse.json({ error: 'Lesson not found' }, { status: 404 }) }
  return { supabase, lesson: data as LessonDraft }
}

function summary(lesson: LessonDraft, rows: SectionRow[]) {
  return {
    status: lesson.status,
    targetMinutes: lesson.target_minutes,
    draftStatus: lesson.draft_status,
    draftError: lesson.draft_error,
    retryAt: lesson.draft_retry_at,
    working: !!lesson.draft_lock_until && new Date(lesson.draft_lock_until).getTime() > Date.now(),
    sections: rows.map(r => ({
      id: r.id, position: r.position, title: r.title, goal: r.goal, keyPoints: r.key_points, minutes: Number(r.minutes),
      status: r.status, error: r.error, notes: r.notes, stepCount: Array.isArray(r.steps) ? r.steps.length : 0,
      estMs: Array.isArray(r.steps) ? estimateMs(r.steps) : 0, updatedAt: r.updated_at,
    })),
  }
}

function kick(request: Request, id: string) {
  const origin = selfOrigin(request)
  after(() => runDraftWork(id, { origin }).catch(err => console.error('Draft worker crashed:', err)))
}

/** Draft status (polled by the editor). Also restarts the worker when it should be running and isn't. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await loadOwn(id)
  if ('error' in r) return r.error
  const rows = await loadSections(r.supabase, id)
  if (needsWorker(r.lesson)) kick(request, id)
  return NextResponse.json(summary(r.lesson, rows))
}

/**
 * POST actions:
 *  { action: 'start', targetMinutes, notes? }         — new outline + all sections (replaces the script)
 *  { action: 'retry' }                                — resume now: paused → running, failed sections → pending
 *  { action: 'regenerate_section', sectionId, notes? } — redraft one section in the background
 *  { action: 'update_section', sectionId, title?, goal?, steps? } — tutor edits (steps validated)
 *  { action: 'delete_section', sectionId }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await loadOwn(id)
  if ('error' in r) return r.error
  const { supabase, lesson } = r
  const body = await request.json().catch(() => ({}))
  const rows = await loadSections(supabase, id)
  const section = typeof body.sectionId === 'string' ? rows.find(s => s.id === body.sectionId) : undefined
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 1000) : null
  const drafting = ['outlining', 'drafting'].includes(lesson.draft_status)

  const done = async () => {
    const { data } = await supabase.from('lessons').select(COLS).eq('id', id).single()
    return NextResponse.json(summary(data as LessonDraft, await loadSections(supabase, id)))
  }

  switch (body.action) {
    case 'start': {
      const t = Math.round(Number(body.targetMinutes))
      if (!Number.isFinite(t) || t < MIN_TARGET || t > MAX_TARGET) return NextResponse.json({ error: `Target length must be ${MIN_TARGET} to ${MAX_TARGET} minutes.` }, { status: 400 })
      const { error } = await restartDraft(supabase, id, t, notes)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      kick(request, id)
      return done()
    }
    case 'retry': {
      const failed = rows.filter(s => s.status === 'failed').map(s => s.id)
      if (failed.length) await supabase.from('lesson_sections').update({ status: 'pending', attempts: 0, error: null }).in('id', failed)
      const next = rows.length === 0 ? 'outlining' : 'drafting'
      await supabase.from('lessons').update({ draft_status: next, draft_error: null, draft_retry_at: null, status: 'draft' }).eq('id', id)
      kick(request, id)
      return done()
    }
    case 'regenerate_section': {
      if (!section) return NextResponse.json({ error: 'Section not found' }, { status: 404 })
      await supabase.from('lesson_sections').update({ status: 'pending', attempts: 0, error: null, notes }).eq('id', section.id)
      if (!drafting) await supabase.from('lessons').update({ draft_status: 'drafting', draft_error: null, draft_retry_at: null, status: 'draft' }).eq('id', id)
      else await supabase.from('lessons').update({ status: 'draft' }).eq('id', id)
      kick(request, id)
      return done()
    }
    case 'update_section': {
      if (!section) return NextResponse.json({ error: 'Section not found' }, { status: 404 })
      const patch: Record<string, unknown> = {}
      if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 120)
      if (typeof body.goal === 'string') patch.goal = body.goal.trim().slice(0, 400)
      if (body.steps !== undefined) {
        if (section.status === 'drafting') return NextResponse.json({ error: 'This section is being drafted right now.' }, { status: 409 })
        const v = validateSection(body.steps, section.position)
        if (!v.ok) return NextResponse.json({ error: v.errors.slice(0, 5).join('; ') }, { status: 400 })
        patch.steps = v.steps
        patch.status = 'ready'
        patch.error = null
      }
      if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
      const { error } = await supabase.from('lesson_sections').update(patch).eq('id', section.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await syncLessonScript(supabase, id)
      await supabase.from('lessons').update({ status: 'draft' }).eq('id', id)
      return done()
    }
    case 'delete_section': {
      if (!section) return NextResponse.json({ error: 'Section not found' }, { status: 404 })
      if (rows.length <= 1) return NextResponse.json({ error: 'A lesson needs at least one section.' }, { status: 400 })
      if (section.status === 'drafting') return NextResponse.json({ error: 'This section is being drafted right now.' }, { status: 409 })
      await supabase.from('lesson_sections').delete().eq('id', section.id)
      // Re-number and make sure the new first section doesn't depend on a clear.
      const rest = rows.filter(s => s.id !== section.id)
      for (const [i, s] of rest.entries()) if (s.position !== i) await supabase.from('lesson_sections').update({ position: i }).eq('id', s.id)
      await syncLessonScript(supabase, id)
      const allReady = rest.every(s => s.status === 'ready')
      await supabase.from('lessons').update({ status: 'draft', ...(allReady && !drafting ? { draft_status: 'ready' } : {}) }).eq('id', id)
      return done()
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}

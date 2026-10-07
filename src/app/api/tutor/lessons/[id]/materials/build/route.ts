import { NextResponse, after } from 'next/server'
import { GeminiQuotaError } from '@/lib/gemini'
import { analyzeMaterials } from '@/lib/lesson-ai'
import { restartDraft, runDraftWork, selfOrigin } from '@/lib/lesson-drafting'
import { MAX_TARGET, MIN_TARGET } from '@/lib/lesson-sections'
import { loadMaterialSources } from '@/lib/materials'
import { loadTutorLesson } from '@/lib/materials-server'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

/**
 * Build the lesson draft from the uploaded materials:
 * { targetMinutes, notes?, rewriteObjectives? }.
 * Reads the materials once for style notes (and objectives if asked), then starts the
 * usual background draft (outline, then sections) with the materials as source.
 * The lesson stays a draft until the tutor approves it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await loadTutorLesson(id)
  if ('error' in r) return r.error
  const { supabase, lesson } = r
  const body = await request.json().catch(() => ({}))
  const t = Math.round(Number(body.targetMinutes ?? lesson.target_minutes ?? 15))
  if (!Number.isFinite(t) || t < MIN_TARGET || t > MAX_TARGET) return NextResponse.json({ error: `Target length must be ${MIN_TARGET} to ${MAX_TARGET} minutes.` }, { status: 400 })
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 1000) : null
  if (['outlining', 'drafting'].includes(lesson.draft_status)) return NextResponse.json({ error: 'A draft is being written right now. Wait for it to finish, then build again.' }, { status: 409 })

  const { count: reading } = await supabase.from('lesson_materials').select('id', { count: 'exact', head: true }).eq('lesson_id', id).in('status', ['uploading', 'reading'])
  const sources = await loadMaterialSources(supabase, id)
  if (sources.length === 0) return NextResponse.json({ error: reading ? 'The files are still being read. Try again in a moment.' : 'Upload at least one readable file first.' }, { status: 400 })

  // Style notes and objectives from one model call. If Gemini is out of quota, the draft
  // still starts (it pauses and resumes on its own); only the style notes are skipped.
  const patch: Record<string, unknown> = {}
  let warning: string | null = null
  try {
    const a = await analyzeMaterials(sources, { title: lesson.title, subject: lesson.subject, objectives: lesson.objectives ?? [] })
    patch.style_notes = a.style
    if (body.rewriteObjectives && a.objectives.length >= 2) patch.objectives = a.objectives
  } catch (err) {
    warning = err instanceof GeminiQuotaError
      ? 'The AI is at its usage limit, so style notes were skipped; the draft will start when it frees up.'
      : 'Style notes could not be derived; the draft follows the materials without them.'
    console.warn('Material analysis failed:', err instanceof Error ? err.message : err)
  }
  if (Object.keys(patch).length) {
    const { error } = await supabase.from('lessons').update(patch).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const { error } = await restartDraft(supabase, id, t, notes, true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const origin = selfOrigin(request)
  after(() => runDraftWork(id, { origin }).catch(err => console.error('Draft worker crashed:', err)))
  return NextResponse.json({ ok: true, warning, styleNotes: patch.style_notes ?? lesson.style_notes ?? null, objectives: patch.objectives ?? null })
}

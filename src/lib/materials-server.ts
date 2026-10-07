/** Server helpers shared by the materials routes. */
import { NextResponse } from 'next/server'
import { getSessionProfile } from './auth'
import { createAdminClient } from './supabase/admin'
import { MATERIALS_BUCKET, MATERIAL_PUBLIC_COLS, extractMaterialText, kindOf, type MaterialRow } from './materials'

/** The signed-in tutor and their lesson, or an error response. */
export async function loadTutorLesson(lessonId: string) {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (profile.role !== 'tutor') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const { data } = await supabase
    .from('lessons').select('id, tutor_id, title, subject, objectives, target_minutes, draft_status, style_notes, draft_from_materials')
    .eq('id', lessonId).eq('tutor_id', profile.id).maybeSingle()
  if (!data) return { error: NextResponse.json({ error: 'Lesson not found' }, { status: 404 }) }
  return {
    supabase, profile,
    lesson: data as {
      id: string; tutor_id: string; title: string; subject: string; objectives: string[] | null; target_minutes: number | null
      draft_status: string; style_notes: unknown; draft_from_materials: boolean
    },
  }
}

export async function listMaterials(db: Awaited<ReturnType<typeof getSessionProfile>>['supabase'], lessonId: string) {
  const { data } = await db.from('lesson_materials').select(MATERIAL_PUBLIC_COLS).eq('lesson_id', lessonId).order('created_at', { ascending: true })
  return (data ?? []) as Omit<MaterialRow, 'extracted_text' | 'path' | 'tutor_id'>[]
}

/** Downloads the uploaded file and extracts its text. Runs after the response (service role). */
export async function readMaterial(materialId: string) {
  const db = createAdminClient()
  const { data } = await db.from('lesson_materials').select('id, file_name, mime, path, status').eq('id', materialId).maybeSingle()
  const row = data as Pick<MaterialRow, 'id' | 'file_name' | 'mime' | 'path' | 'status'> | null
  if (!row) return
  const fail = (msg: string) => db.from('lesson_materials').update({ status: 'failed', error: msg.slice(0, 300) }).eq('id', materialId)
  try {
    const kind = kindOf(row.file_name, row.mime)
    if (!kind) { await fail('Only PDF, PowerPoint (.pptx) and Word (.docx) files can be read.'); return }
    const { data: blob, error } = await db.storage.from(MATERIALS_BUCKET).download(row.path)
    if (error || !blob) { await fail('The upload did not finish. Delete the file and upload it again.'); return }
    const buf = Buffer.from(await blob.arrayBuffer())
    const { text, pages } = await extractMaterialText(buf, kind)
    await db.from('lesson_materials').update({ status: 'ready', extracted_text: text, page_count: pages, error: null }).eq('id', materialId)
  } catch (err) {
    await fail(err instanceof Error ? err.message : String(err))
  }
}

/** Deletes a lesson's files from Storage (rows go with the lesson via the cascade). */
export async function removeMaterialFiles(db: Awaited<ReturnType<typeof getSessionProfile>>['supabase'], lessonId: string) {
  const { data } = await db.from('lesson_materials').select('path').eq('lesson_id', lessonId)
  const paths = ((data ?? []) as { path: string }[]).map(r => r.path)
  if (!paths.length) return
  try { await createAdminClient().storage.from(MATERIALS_BUCKET).remove(paths) } catch (err) {
    console.warn('Material files delete failed:', err instanceof Error ? err.message : err)
  }
}

import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { listMaterials, loadTutorLesson } from '@/lib/materials-server'
import { MATERIALS_BUCKET, MATERIALS_PER_LESSON, MATERIAL_MAX_BYTES, MATERIAL_PUBLIC_COLS, MIME_BY_KIND, kindOf, safeFileName } from '@/lib/materials'

export const dynamic = 'force-dynamic'

/** Materials of a lesson (tutor), with the lesson's style notes. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await loadTutorLesson(id)
  if ('error' in r) return r.error
  return NextResponse.json({
    materials: await listMaterials(r.supabase, id),
    styleNotes: r.lesson.style_notes ?? null,
    fromMaterials: r.lesson.draft_from_materials,
  })
}

/**
 * Start an upload: { fileName, size, visible? }. Creates the row (status "uploading")
 * and returns a signed upload URL; the browser uploads straight to Storage (files are
 * larger than a serverless request body allows), then calls POST …/[materialId] { action: 'uploaded' }.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await loadTutorLesson(id)
  if ('error' in r) return r.error
  const body = await request.json().catch(() => ({}))
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim().slice(0, 200) : ''
  const size = Number(body.size)
  const kind = fileName ? kindOf(fileName, typeof body.mime === 'string' ? body.mime : null) : null
  if (!fileName || !kind) return NextResponse.json({ error: 'Upload a PDF, PowerPoint (.pptx) or Word (.docx) file.' }, { status: 400 })
  if (!Number.isFinite(size) || size <= 0) return NextResponse.json({ error: 'The file is empty.' }, { status: 400 })
  if (size > MATERIAL_MAX_BYTES) return NextResponse.json({ error: 'Files can be up to 20 MB.' }, { status: 400 })

  const { count } = await r.supabase.from('lesson_materials').select('id', { count: 'exact', head: true }).eq('lesson_id', id)
  if ((count ?? 0) >= MATERIALS_PER_LESSON) return NextResponse.json({ error: `A lesson can have up to ${MATERIALS_PER_LESSON} files.` }, { status: 400 })

  const materialId = randomUUID()
  const path = `${r.profile.id}/${id}/${materialId}/${safeFileName(fileName)}`
  const mime = MIME_BY_KIND[kind]
  const { data: row, error } = await r.supabase.from('lesson_materials').insert({
    id: materialId, lesson_id: id, tutor_id: r.profile.id, file_name: fileName, mime, size, path,
    status: 'uploading', visible_to_students: body.visible !== false,
  }).select(MATERIAL_PUBLIC_COLS).single()
  if (error || !row) return NextResponse.json({ error: error?.message ?? 'Could not start the upload.' }, { status: 500 })

  let admin
  try { admin = createAdminClient() } catch {
    await r.supabase.from('lesson_materials').delete().eq('id', materialId)
    return NextResponse.json({ error: 'File storage is not configured.' }, { status: 500 })
  }
  const { data: signed, error: signErr } = await admin.storage.from(MATERIALS_BUCKET).createSignedUploadUrl(path)
  if (signErr || !signed) {
    await r.supabase.from('lesson_materials').delete().eq('id', materialId)
    return NextResponse.json({ error: `Could not prepare the upload: ${signErr?.message ?? 'unknown error'}` }, { status: 500 })
  }
  return NextResponse.json({ material: row, upload: { bucket: MATERIALS_BUCKET, path: signed.path, token: signed.token, contentType: mime } })
}

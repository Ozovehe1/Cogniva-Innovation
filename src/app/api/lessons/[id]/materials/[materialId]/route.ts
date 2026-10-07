import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { MATERIALS_BUCKET, SIGNED_URL_SECONDS } from '@/lib/materials'

export const dynamic = 'force-dynamic'

/**
 * Opens a material through a short-lived signed URL.
 *   ?mode=view      redirect to an inline link (PDFs open in the browser)
 *   ?mode=download  redirect to a download link
 *   ?mode=text      JSON with the extracted text (reader view for slides and documents)
 * Access is the caller's own row access: RLS lets tutors see their files and linked
 * students see shared files of approved lessons. The service role only signs the link.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; materialId: string }> }) {
  const { id, materialId } = await params
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const mode = new URL(request.url).searchParams.get('mode') ?? 'view'
  const cols = mode === 'text' ? 'id, file_name, path, status, extracted_text' : 'id, file_name, path, status'
  const { data } = await supabase.from('lesson_materials').select(cols).eq('id', materialId).eq('lesson_id', id).maybeSingle()
  const row = data as { id: string; file_name: string; path: string; status: string; extracted_text?: string | null } | null
  if (!row || row.status === 'uploading') return NextResponse.json({ error: 'File not found' }, { status: 404 })
  const noStore = { 'Cache-Control': 'private, no-store' }
  if (mode === 'text') return NextResponse.json({ fileName: row.file_name, text: row.extracted_text ?? '' }, { headers: noStore })
  const { data: signed, error } = await createAdminClient().storage
    .from(MATERIALS_BUCKET)
    .createSignedUrl(row.path, SIGNED_URL_SECONDS, mode === 'download' ? { download: row.file_name } : undefined)
  if (error || !signed) return NextResponse.json({ error: 'Could not open the file.' }, { status: 500 })
  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: noStore })
}

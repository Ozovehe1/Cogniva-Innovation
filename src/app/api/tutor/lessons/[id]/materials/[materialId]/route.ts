import { NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadTutorLesson, readMaterial } from '@/lib/materials-server'
import { MATERIALS_BUCKET, MATERIAL_PUBLIC_COLS } from '@/lib/materials'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string; materialId: string }> }

async function loadOwn(ctx: Ctx) {
  const { id, materialId } = await ctx.params
  const r = await loadTutorLesson(id)
  if ('error' in r) return { error: r.error! }
  const { data } = await r.supabase.from('lesson_materials').select('id, path, status').eq('id', materialId).eq('lesson_id', id).maybeSingle()
  if (!data) return { error: NextResponse.json({ error: 'File not found' }, { status: 404 }) }
  return { supabase: r.supabase, material: data as { id: string; path: string; status: string } }
}

/** { action: 'uploaded' } after the browser finished uploading, or { action: 'retry' } to read a failed file again. */
export async function POST(request: Request, ctx: Ctx) {
  const r = await loadOwn(ctx)
  if (r.error) return r.error
  const body = await request.json().catch(() => ({}))
  if (body.action !== 'uploaded' && body.action !== 'retry') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  if (r.material.status === 'reading') return NextResponse.json({ error: 'This file is being read.' }, { status: 409 })
  const { data, error } = await r.supabase.from('lesson_materials').update({ status: 'reading', error: null }).eq('id', r.material.id).select(MATERIAL_PUBLIC_COLS).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  after(() => readMaterial(r.material.id).catch(err => console.error('Material read crashed:', err)))
  return NextResponse.json({ material: data })
}

/** { visible: boolean } — share with students or not. */
export async function PATCH(request: Request, ctx: Ctx) {
  const r = await loadOwn(ctx)
  if (r.error) return r.error
  const body = await request.json().catch(() => ({}))
  if (typeof body.visible !== 'boolean') return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
  const { data, error } = await r.supabase.from('lesson_materials').update({ visible_to_students: body.visible }).eq('id', r.material.id).select(MATERIAL_PUBLIC_COLS).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ material: data })
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const r = await loadOwn(ctx)
  if (r.error) return r.error
  try { await createAdminClient().storage.from(MATERIALS_BUCKET).remove([r.material.path]) } catch (err) {
    console.warn('Material file delete failed:', err instanceof Error ? err.message : err)
  }
  const { error } = await r.supabase.from('lesson_materials').delete().eq('id', r.material.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

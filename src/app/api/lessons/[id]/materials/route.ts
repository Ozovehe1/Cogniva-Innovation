import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/** Shared materials of an approved lesson the student may see (RLS decides). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabase
    .from('lesson_materials').select('id, file_name, mime, size, page_count, created_at')
    .eq('lesson_id', id).eq('visible_to_students', true).eq('status', 'ready').order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ materials: data ?? [] })
}

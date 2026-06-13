import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'student')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { tutor_id } = await request.json()
  const code = (tutor_id ?? '').trim().toUpperCase()
  if (!code) return NextResponse.json({ error: 'Tutor code is required' }, { status: 400 })

  const { data: tutor } = await supabase
    .from('profiles').select('id, role, full_name').eq('tutor_code', code).single()
  if (!tutor || (tutor as { role: string }).role !== 'tutor')
    return NextResponse.json({ error: 'No tutor found with that code. Double-check and try again.' }, { status: 404 })

  const { error } = await supabase.from('tutor_students').upsert(
    { tutor_id: (tutor as { id: string }).id, student_id: (profile as { id: string }).id },
    { onConflict: 'tutor_id,student_id', ignoreDuplicates: true }
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, tutor_name: (tutor as { full_name: string }).full_name })
}

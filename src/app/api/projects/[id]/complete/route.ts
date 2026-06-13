import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { data, error } = await supabase.from('project_assignments')
    .update({ status: 'completed', submitted_at: new Date().toISOString() })
    .eq('project_id', id)
    .eq('student_id', (profile as { id: string }).id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ assignment: data })
}

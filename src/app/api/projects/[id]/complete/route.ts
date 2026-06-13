import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Student submits project for tutor review — moves to pending_review, NOT completed yet
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('id').eq('user_id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { data, error } = await supabase.from('project_assignments')
    .update({ status: 'pending_review', submitted_at: new Date().toISOString() })
    .eq('project_id', id)
    .eq('student_id', (profile as { id: string }).id)
    .eq('status', 'in_progress')
    .select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ assignment: data })
}

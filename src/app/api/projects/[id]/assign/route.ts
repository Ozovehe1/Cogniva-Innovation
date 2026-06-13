import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'tutor')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Verify this tutor owns the project
  const { data: project } = await supabase
    .from('projects').select('id, title').eq('id', projectId).eq('tutor_id', (profile as { id: string }).id).single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { student_id } = await request.json()

  // Verify student is actually linked to this tutor
  const { data: link } = await supabase
    .from('tutor_students').select('id').eq('tutor_id', (profile as { id: string }).id).eq('student_id', student_id).single()
  if (!link) return NextResponse.json({ error: 'This student is not linked to you' }, { status: 403 })

  const { data, error } = await supabase.from('project_assignments').upsert(
    { project_id: projectId, student_id, status: 'assigned' },
    { onConflict: 'project_id,student_id', ignoreDuplicates: true }
  ).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ assignment: data })
}

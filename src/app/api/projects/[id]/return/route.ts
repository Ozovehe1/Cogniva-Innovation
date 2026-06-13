import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Tutor returns a project to student for revision
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: tutorProfile } = await supabase.from('profiles').select('id, role').eq('user_id', user.id).single()
  if (!tutorProfile || (tutorProfile as { role: string }).role !== 'tutor')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { feedback } = await request.json().catch(() => ({ feedback: '' }))

  const { data: project } = await supabase
    .from('projects').select('id, tutor_id').eq('id', id).single()
  if (!project || (project as { tutor_id: string }).tutor_id !== (tutorProfile as { id: string }).id)
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { error } = await supabase.from('project_assignments')
    .update({ status: 'in_progress', feedback: feedback || null, submitted_at: null })
    .eq('project_id', id)
    .eq('status', 'pending_review')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

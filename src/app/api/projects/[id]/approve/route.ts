import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: tutorProfile } = await supabase.from('profiles').select('id, role').eq('user_id', user.id).single()
  if (!tutorProfile || (tutorProfile as { role: string }).role !== 'tutor')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { score } = await request.json().catch(() => ({ score: null }))
  const validScore = (typeof score === 'number' && score >= 1 && score <= 10) ? score : null

  const { data: project } = await supabase
    .from('projects').select('id, tutor_id').eq('id', id).single()
  if (!project || (project as { tutor_id: string }).tutor_id !== (tutorProfile as { id: string }).id)
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: assignment } = await supabase.from('project_assignments')
    .select('id').eq('project_id', id).eq('status', 'pending_review').single()
  if (!assignment) return NextResponse.json({ error: 'No pending submission found' }, { status: 404 })

  const { error } = await supabase.from('project_assignments')
    .update({ status: 'completed', score: validScore })
    .eq('id', (assignment as { id: string }).id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

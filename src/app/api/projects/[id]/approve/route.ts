import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Tutor approves a student's pending submission — marks completed + evolves intelligence scores
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: tutorProfile } = await supabase.from('profiles').select('id, role').eq('user_id', user.id).single()
  if (!tutorProfile || (tutorProfile as { role: string }).role !== 'tutor')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Verify tutor owns this project
  const { data: project } = await supabase
    .from('projects').select('id, tutor_id, intelligence_activated').eq('id', id).single()
  if (!project || (project as { tutor_id: string }).tutor_id !== (tutorProfile as { id: string }).id)
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Find the pending_review assignment
  const { data: assignment } = await supabase.from('project_assignments')
    .select('id, student_id').eq('project_id', id).eq('status', 'pending_review').single()
  if (!assignment) return NextResponse.json({ error: 'No pending submission found' }, { status: 404 })

  const studentId = (assignment as { id: string; student_id: string }).student_id

  // Mark as completed
  const { error } = await supabase.from('project_assignments')
    .update({ status: 'completed' })
    .eq('id', (assignment as { id: string }).id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Evolve intelligence scores
  const activated = ((project as { intelligence_activated?: string[] })?.intelligence_activated ?? [])
  if (activated.length > 0) {
    const { data: intel } = await supabase
      .from('intelligence_profiles').select('intelligence_scores').eq('student_id', studentId).single()

    if (intel) {
      const scores = { ...(intel.intelligence_scores as Record<string, number>) }
      activated.forEach((type: string) => {
        if (typeof scores[type] === 'number') {
          scores[type] = Math.min(10, +(scores[type] + 0.5).toFixed(1))
        }
      })
      await supabase.from('intelligence_profiles')
        .update({ intelligence_scores: scores, updated_at: new Date().toISOString() })
        .eq('student_id', studentId)
    }
  }

  return NextResponse.json({ success: true })
}

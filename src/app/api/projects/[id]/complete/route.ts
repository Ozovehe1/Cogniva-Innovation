import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('id').eq('user_id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const profileId = (profile as { id: string }).id

  // Mark completed
  const { data, error } = await supabase.from('project_assignments')
    .update({ status: 'completed', submitted_at: new Date().toISOString() })
    .eq('project_id', id)
    .eq('student_id', profileId)
    .neq('status', 'completed') // idempotent
    .select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Evolve intelligence scores based on which intelligences this project activates
  const { data: project } = await supabase
    .from('projects').select('intelligence_activated').eq('id', id).single()

  const activated = ((project as { intelligence_activated?: string[] })?.intelligence_activated ?? [])
  if (activated.length > 0) {
    const { data: intel } = await supabase
      .from('intelligence_profiles').select('intelligence_scores').eq('student_id', profileId).single()

    if (intel) {
      const scores = { ...(intel.intelligence_scores as Record<string, number>) }
      activated.forEach((type: string) => {
        if (typeof scores[type] === 'number') {
          scores[type] = Math.min(10, +(scores[type] + 0.5).toFixed(1))
        }
      })
      await supabase.from('intelligence_profiles')
        .update({ intelligence_scores: scores, updated_at: new Date().toISOString() })
        .eq('student_id', profileId)
    }
  }

  return NextResponse.json({ assignment: data })
}

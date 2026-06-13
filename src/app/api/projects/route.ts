import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  if ((profile as { role: string }).role === 'tutor') {
    const { data } = await supabase.from('projects').select('*').eq('tutor_id', (profile as { id: string }).id).order('created_at', { ascending: false })
    return NextResponse.json({ projects: data })
  } else {
    const { data } = await supabase.from('project_assignments').select('*, project:projects(*)').eq('student_id', (profile as { id: string }).id).order('created_at', { ascending: false })
    return NextResponse.json({ assignments: data })
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'tutor') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { data, error } = await supabase.from('projects').insert({ ...body, tutor_id: (profile as { id: string }).id }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ project: data })
}

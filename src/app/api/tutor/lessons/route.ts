import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { draftLessonScript } from '@/lib/lesson-ai'

export const maxDuration = 180

function cleanObjectives(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((o): o is string => typeof o === 'string').map(o => o.trim()).filter(Boolean).slice(0, 10).map(o => o.slice(0, 300))
  if (typeof v === 'string') return cleanObjectives(v.split('\n'))
  return []
}

export async function GET() {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (profile.role !== 'tutor') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { data, error } = await supabase
    .from('lessons').select('id, title, subject, objectives, status, created_at, updated_at')
    .eq('tutor_id', profile.id).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ lessons: data ?? [] })
}

/** Create a draft lesson and ask Gemini to write its first script. */
export async function POST(request: Request) {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (profile.role !== 'tutor') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : ''
  const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, 80) : ''
  const objectives = cleanObjectives(body.objectives)
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 1000) : undefined
  if (!title || !subject || objectives.length === 0)
    return NextResponse.json({ error: 'Title, subject and at least one objective are required.' }, { status: 400 })

  const { data: lesson, error } = await supabase
    .from('lessons')
    .insert({ tutor_id: profile.id, title, subject, objectives, status: 'draft', script: [] })
    .select('id').single()
  if (error || !lesson) return NextResponse.json({ error: error?.message ?? 'Could not create lesson' }, { status: 500 })

  try {
    const script = await draftLessonScript({ title, subject, objectives }, notes)
    await supabase.from('lessons').update({ script }).eq('id', (lesson as { id: string }).id)
    return NextResponse.json({ id: (lesson as { id: string }).id, drafted: true })
  } catch (err) {
    console.error('Lesson draft failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({
      id: (lesson as { id: string }).id,
      drafted: false,
      error: 'The lesson was saved, but the AI draft failed. Open it and choose Regenerate.',
    })
  }
}

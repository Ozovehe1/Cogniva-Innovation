import { NextResponse, after } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { runDraftWork, selfOrigin } from '@/lib/lesson-drafting'
import { MAX_TARGET, MIN_TARGET } from '@/lib/lesson-sections'

export const maxDuration = 300

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
    .from('lessons').select('id, title, subject, objectives, status, target_minutes, chapters, draft_status, created_at, updated_at')
    .eq('tutor_id', profile.id).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ lessons: data ?? [] })
}

/** Create a draft lesson and start drafting it in the background (outline, then one section at a time). */
export async function POST(request: Request) {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (profile.role !== 'tutor') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : ''
  const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, 80) : ''
  const objectives = cleanObjectives(body.objectives)
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.slice(0, 1000) : null
  const target = Math.round(Number(body.targetMinutes ?? 15))
  if (!title || !subject || objectives.length === 0)
    return NextResponse.json({ error: 'Title, subject and at least one objective are required.' }, { status: 400 })
  if (!Number.isFinite(target) || target < MIN_TARGET || target > MAX_TARGET)
    return NextResponse.json({ error: `Target length must be ${MIN_TARGET} to ${MAX_TARGET} minutes.` }, { status: 400 })

  const { data: lesson, error } = await supabase
    .from('lessons')
    .insert({ tutor_id: profile.id, title, subject, objectives, status: 'draft', script: [], target_minutes: target, draft_notes: notes, draft_status: 'outlining' })
    .select('id').single()
  if (error || !lesson) return NextResponse.json({ error: error?.message ?? 'Could not create lesson' }, { status: 500 })
  const id = (lesson as { id: string }).id
  const origin = selfOrigin(request)
  after(() => runDraftWork(id, { origin }).catch(err => console.error('Draft worker crashed:', err)))
  return NextResponse.json({ id, drafting: true })
}

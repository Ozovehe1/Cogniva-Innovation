import { NextResponse, after } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadLearner, type PathRow, type TopicRow } from '@/lib/learner'
import { createTopicLesson } from '@/lib/path'
import { runDraftWork, selfOrigin } from '@/lib/lesson-drafting'

export const maxDuration = 300

/** POST /api/topics/:id/start — create (or reuse) the AI lesson for a ready topic and start drafting it. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()
  const { data: t } = await db.from('path_topics').select('*').eq('id', id).eq('student_id', profile.id).maybeSingle()
  const topic = t as TopicRow | null
  if (!topic) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (topic.lesson_id) {
    // A lesson written ahead (prefetched) for a topic that has just become available.
    if (topic.status === 'ready') await createAdminClient().from('path_topics').update({ status: 'learning' }).eq('id', topic.id)
    return NextResponse.json({ lessonId: topic.lesson_id })
  }
  if (topic.status === 'locked') return NextResponse.json({ error: 'Finish the topics before this one first.' }, { status: 400 })
  const { data: p } = await db.from('learning_paths').select('*').eq('id', topic.path_id).single()
  const learner = await loadLearner(db, profile.id)
  if (!p || !learner) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const lessonId = await createTopicLesson(db, learner, p as PathRow, topic)
  const origin = selfOrigin(request)
  after(() => runDraftWork(lessonId, { origin }).then(() => undefined).catch(err => console.error('Lesson draft failed:', err)))
  return NextResponse.json({ lessonId })
}

import { NextResponse, after } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { needsWorker, runDraftWork, selfOrigin } from '@/lib/lesson-drafting'
import { prefetchNextLesson } from '@/lib/path'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 300

/**
 * GET /api/lessons/:id/status — drafting progress of the learner's own AI lesson.
 * Also the safety net that keeps drafting going: if no worker holds the lesson (or a
 * quota pause has passed), one is started after the response.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data } = await supabase.from('lessons')
    .select('id, draft_status, draft_error, draft_retry_at, draft_lock_until, chapters, owner_student_id')
    .eq('id', id).eq('owner_student_id', profile.id).maybeSingle()
  const l = data as { id: string; draft_status: string; draft_error: string | null; draft_retry_at: string | null; draft_lock_until: string | null; chapters: unknown[] } | null
  if (!l) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // A section that failed validation (e.g. too much text, not enough demonstration) gets more tries, bounded.
  if (l.draft_status === 'partial') {
    const db = createAdminClient()
    const { data: retry } = await db.from('lesson_sections').update({ status: 'pending', error: null }).eq('lesson_id', id).eq('status', 'failed').lt('attempts', 5).select('id')
    if (retry?.length) {
      await db.from('lessons').update({ draft_status: 'drafting' }).eq('id', id)
      l.draft_status = 'drafting'
    }
  }
  if (needsWorker(l)) {
    const origin = selfOrigin(request)
    after(() => runDraftWork(id, { origin }).then(() => undefined).catch(err => console.error('Draft worker failed:', err)))
  }
  // This lesson is written: write the next one in the path while the learner plays it.
  if (l.draft_status === 'ready' || l.draft_status === 'partial') {
    const origin = selfOrigin(request)
    after(() => prefetchNextLesson(createAdminClient(), id, { origin }).then(() => undefined).catch(() => {}))
  }
  return NextResponse.json({
    status: l.draft_status,
    sectionsReady: Array.isArray(l.chapters) ? l.chapters.length : 0,
    retryAt: l.draft_status === 'paused' ? l.draft_retry_at : null,
    error: l.draft_status === 'failed' ? 'This lesson could not be written. Try again from your path.' : null,
  })
}

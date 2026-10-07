import { NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { needsWorker, runDraftWork, selfOrigin } from '@/lib/lesson-drafting'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

/** Daily (Vercel cron): resumes lesson drafts paused for quota or left without a worker, and deletes expired mood check-ins. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createAdminClient()
  // Mood and confidence check-ins are short-lived: delete expired ones.
  const { data: purged } = await db.rpc('purge_expired_checkins')
  const { data } = await db
    .from('lessons').select('id, draft_status, draft_retry_at, draft_lock_until')
    .in('draft_status', ['outlining', 'drafting', 'paused']).limit(20)
  const due = (data ?? []).filter(needsWorker).slice(0, 4) as { id: string }[]
  const origin = selfOrigin(request)
  after(() => Promise.all(due.map(l => runDraftWork(l.id, { origin }).catch(err => console.error('Cron draft failed:', err)))))
  return NextResponse.json({ resumed: due.map(l => l.id), purgedCheckins: purged ?? 0 })
}

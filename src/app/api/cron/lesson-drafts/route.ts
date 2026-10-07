import { timingSafeEqual } from 'crypto'
import { NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { needsWorker, runDraftWork, selfOrigin } from '@/lib/lesson-drafting'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

function bearerIs(request: Request, secret: string | undefined) {
  if (!secret) return false
  const a = Buffer.from(request.headers.get('authorization') ?? '')
  const b = Buffer.from(`Bearer ${secret}`)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Resumes lesson drafts paused for quota or left without a worker (a hand-over that
 * did not land, a worker that died), so drafting finishes with no page open.
 * Called by:
 * - Vercel cron, daily (Hobby plan limit), with CRON_SECRET; also deletes expired mood check-ins.
 * - Supabase pg_cron every minute (`?tick=1`, DRAFT_TICK_SECRET), only when a lesson needs a worker
 *   (the SQL job checks first). Free on both plans. See supabase/migrations/20261011091000_draft_tick.sql.
 */
export async function GET(request: Request) {
  const tick = new URL(request.url).searchParams.get('tick') === '1'
  const ok = tick ? bearerIs(request, process.env.DRAFT_TICK_SECRET) : bearerIs(request, process.env.CRON_SECRET)
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createAdminClient()
  // Mood and confidence check-ins are short-lived: delete expired ones (daily run only).
  const purged = tick ? null : (await db.rpc('purge_expired_checkins')).data
  const { data } = await db
    .from('lessons').select('id, draft_status, draft_retry_at, draft_lock_until')
    .in('draft_status', ['outlining', 'drafting', 'paused']).order('created_at', { ascending: false }).limit(20)
  const due = (data ?? []).filter(needsWorker).slice(0, 4) as { id: string }[]
  const origin = selfOrigin(request)
  after(() => Promise.all(due.map(l => runDraftWork(l.id, { origin }).catch(err => console.error('Cron draft failed:', err)))))
  return NextResponse.json({ resumed: due.map(l => l.id), purgedCheckins: purged ?? 0 })
}

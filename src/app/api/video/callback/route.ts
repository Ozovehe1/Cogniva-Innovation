import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { renderTokenMatches } from '@/lib/manim'
import { VIDEO_BUCKET, videoPath, type LessonVideoRow } from '@/lib/lesson-video'

export const dynamic = 'force-dynamic'

/**
 * POST /api/video/callback — called by the Modal recorder (modal_app/manim_render.py, lesson_video).
 * Header X-Render-Token must equal RENDER_TOKEN.
 * Body: { job_id, status: 'rendering'|'done'|'failed', progress?, error?, bytes?, duration_ms?, meta? }
 */
export async function POST(request: Request) {
  if (!renderTokenMatches(request.headers.get('x-render-token'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const jobId = typeof body.job_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.job_id) ? body.job_id : null
  const status = body.status
  if (!jobId || (status !== 'rendering' && status !== 'done' && status !== 'failed')) return NextResponse.json({ error: 'job_id and a valid status are required' }, { status: 400 })
  const db = createAdminClient()
  const { data } = await db.from('lesson_videos').select('id, lesson_id, script_hash, status, storage_path, meta').eq('id', jobId).maybeSingle()
  const row = data as (Pick<LessonVideoRow, 'id' | 'lesson_id' | 'script_hash' | 'status' | 'storage_path'> & { meta: Record<string, unknown> | null }) | null
  if (!row) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (row.status === 'done') return NextResponse.json({ ok: true, ignored: 'already done' })
  const now = new Date().toISOString()
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  if (status === 'rendering') {
    const progress = Math.max(0, Math.min(1, num(body.progress) ?? 0))
    await db.from('lesson_videos').update({ status: 'rendering', progress, updated_at: now }).eq('id', jobId).neq('status', 'done')
    return NextResponse.json({ ok: true })
  }
  if (status === 'failed') {
    const error = typeof body.error === 'string' ? body.error.slice(-4000) : 'Render failed'
    await db.from('lesson_videos').update({ status: 'failed', error, finished_at: now, updated_at: now }).eq('id', jobId)
    return NextResponse.json({ ok: true })
  }

  const meta = body.meta && typeof body.meta === 'object' ? body.meta as Record<string, unknown> : {}
  await db.from('lesson_videos').update({
    status: 'done', progress: 1, error: null, finished_at: now, updated_at: now,
    storage_path: row.storage_path ?? videoPath(row.lesson_id, row.script_hash),
    bytes: num(body.bytes), duration_ms: num(body.duration_ms) !== null ? Math.round(num(body.duration_ms)!) : null,
    meta: { ...(row.meta ?? {}), ...meta },
  }).eq('id', jobId)
  // Only the newest script's video is kept: older versions of this lesson are removed.
  const { data: old } = await db.from('lesson_videos').select('id, lesson_id, script_hash, storage_path').eq('lesson_id', row.lesson_id).neq('id', jobId).in('status', ['done', 'failed'])
  const stale = (old ?? []) as { id: string; lesson_id: string; script_hash: string; storage_path: string | null }[]
  if (stale.length) {
    await db.storage.from(VIDEO_BUCKET).remove(stale.map(o => o.storage_path ?? videoPath(o.lesson_id, o.script_hash)))
    await db.from('lesson_videos').delete().in('id', stale.map(o => o.id))
  }
  return NextResponse.json({ ok: true })
}

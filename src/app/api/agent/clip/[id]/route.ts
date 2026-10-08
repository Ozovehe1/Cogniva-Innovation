import { getSessionProfile } from '@/lib/auth'
import { createAdminClient, publicClipUrl } from '@/lib/supabase/admin'

/** GET /api/agent/clip/:jobId — status of an animation the learner asked for in chat (owner only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { profile } = await getSessionProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  const { data } = await createAdminClient().from('manim_jobs').select('status, video_path, attempts, updated_at').eq('id', id).eq('requested_by', profile.id).maybeSingle()
  if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
  const done = data.status === 'done' || data.status === 'approved'
  return Response.json({ status: done ? 'done' : data.status === 'failed' ? 'failed' : 'rendering', url: done && data.video_path ? publicClipUrl(data.video_path) : null, attempts: data.attempts }, { headers: { 'Cache-Control': 'no-store' } })
}

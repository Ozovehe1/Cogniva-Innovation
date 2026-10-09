import { getSessionProfile } from '@/lib/auth'
import { createAdminClient, publicClipUrl } from '@/lib/supabase/admin'
import { clipBlocked, clipState, clipVerified } from '@/lib/correctness/clip'

/** GET /api/agent/clip/:jobId — status of an animation the learner asked for in chat (owner only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { profile } = await getSessionProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  const { data } = await createAdminClient().from('manim_jobs').select('status, video_path, attempts, updated_at, verdict').eq('id', id).eq('requested_by', profile.id).maybeSingle()
  if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
  // A clip the scene verifier failed is never shown (correctness guard), whatever its render status.
  const state = clipState(data)
  const done = state === 'done'
  return Response.json({ status: state, blocked: clipBlocked(data.verdict), verified: clipVerified(data.verdict), url: done && data.video_path ? publicClipUrl(data.video_path) : null, attempts: data.attempts }, { headers: { 'Cache-Control': 'no-store' } })
}

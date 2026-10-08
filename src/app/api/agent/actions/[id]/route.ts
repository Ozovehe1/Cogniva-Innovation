import { getSessionProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { confirmAction, declineAction, undoAction, type ActionRow } from '@/lib/agent/actions'

export const maxDuration = 60

/**
 * POST /api/agent/actions/:id  { op: 'confirm' | 'decline' | 'undo' }
 * The learner's tap on a proposal (Today card or chat), or Undo within 24 hours. Owner only.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { profile } = await getSessionProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  const { op } = await request.json().catch(() => ({})) as { op?: string }
  const admin = createAdminClient()
  const { data } = await admin.from('agent_actions').select('*').eq('id', id).eq('student_id', profile.id).maybeSingle()
  const a = data as ActionRow | null
  if (!a) return Response.json({ error: 'Not found' }, { status: 404 })
  try {
    const r = op === 'confirm' ? await confirmAction(admin, a) : op === 'decline' ? await declineAction(admin, a) : op === 'undo' ? await undoAction(admin, a) : null
    if (!r) return Response.json({ error: 'Unknown op' }, { status: 400 })
    return Response.json({ ok: true, status: r.status, summary: r.summary })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Could not do that' }, { status: 409 })
  }
}

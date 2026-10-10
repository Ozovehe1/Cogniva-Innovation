import { getSessionProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { answerNumeric, answerPractice } from '@/lib/agent/practice'

/** POST /api/agent/practice { actionId, index, choice } (or { …, value: '1.5 A' } for a typed numeric item) → hint first, answer after a second try; the review is logged when the set is done. */
export async function POST(request: Request) {
  const { profile } = await getSessionProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await request.json().catch(() => ({})) as { actionId?: unknown; index?: unknown; choice?: unknown; value?: unknown }
  if (typeof b.actionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.actionId)) return Response.json({ error: 'Bad request' }, { status: 400 })
  if (typeof b.value === 'string') { const n = await answerNumeric(createAdminClient(), profile.id, b.actionId, Number(b.index), b.value); return Response.json(n.body, { status: n.status }) }
  const r = await answerPractice(createAdminClient(), profile.id, b.actionId, Number(b.index), Number(b.choice))
  return Response.json(r.body, { status: r.status })
}

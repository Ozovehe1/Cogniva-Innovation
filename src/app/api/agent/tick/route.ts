import { createAdminClient } from '@/lib/supabase/admin'
import { drainEvents } from '@/lib/agent/director'
import { agentSecretOk } from '@/lib/agent/secret'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

/**
 * GET /api/agent/tick — drains the agent_events queue (Learning Director turns). Called every minute by the
 * agent-tick pg_cron job only when the queue has work (Bearer AGENT_SECRET, also in Supabase Vault).
 */
export async function GET(request: Request) {
  if (!agentSecretOk(request)) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createAdminClient()
  const deadline = Date.now() + 270_000
  const done: Awaited<ReturnType<typeof drainEvents>> = []
  while (Date.now() < deadline - 60_000) {
    const batch = await drainEvents(admin, 3, { origin: new URL(request.url).origin, deadline })
    done.push(...batch)
    if (!batch.length) break
  }
  return Response.json({ handled: done.length, events: done })
}

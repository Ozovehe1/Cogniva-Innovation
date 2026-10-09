import { createAdminClient } from '@/lib/supabase/admin'
import { agentSecretOk } from '@/lib/agent/secret'
import { playbookTick } from '@/lib/playbook/tick'
import { withLlmContext } from '@/lib/agent/pool'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

/**
 * GET /api/playbook/tick — the Teaching Playbook's background job (pg_cron 'playbook-tick', Bearer AGENT_SECRET):
 * harvest signals → credit successes → reflect → curate → gate. See docs/playbook.md.
 */
export async function GET(request: Request) {
  if (!agentSecretOk(request)) return Response.json({ error: 'Forbidden' }, { status: 403 })
  // Background class in the shared LLM pool: shed / deferred first so learners keep their capacity.
  const r = await withLlmContext({ priority: 'background', label: 'playbook' }, () => playbookTick(createAdminClient(), { deadline: Date.now() + 270_000 }))
  return Response.json(r)
}

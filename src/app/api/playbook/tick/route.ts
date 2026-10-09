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
  // ?budget=<seconds> shortens a hand-run tick (default and maximum 270 s).
  const budget = Math.min(270, Math.max(40, Number(new URL(request.url).searchParams.get('budget')) || 270))
  const r = await withLlmContext({ priority: 'background', label: 'playbook' }, () => playbookTick(createAdminClient(), { deadline: Date.now() + budget * 1000 }))
  return Response.json(r)
}

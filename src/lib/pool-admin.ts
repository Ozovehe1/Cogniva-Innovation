import { getAdmin } from '@/lib/admin'
import { agentSecretOk } from '@/lib/agent/secret'

/**
 * Who may see the LLM pool's health: an admin session (ADMIN_EMAILS, see lib/admin.ts) or a server-to-server caller
 * with Bearer AGENT_SECRET. The pool view holds no learner data (slot counters and health only). Server only.
 */
export async function poolAdmin(request?: Request): Promise<{ who: string } | null> {
  if (request && agentSecretOk(request)) return { who: 'agent-secret' }
  try { const a = await getAdmin(); return a ? { who: a.email } : null } catch { return null }
}

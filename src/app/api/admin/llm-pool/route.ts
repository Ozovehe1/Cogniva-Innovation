import { poolAdmin } from '@/lib/pool-admin'
import { poolHealth } from '@/lib/agent/pool'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/llm-pool   (admin session or Bearer AGENT_SECRET)
 * Every key × model slot: limits, minute/day usage, headroom, health (cooldown / breaker), rolling latency and error
 * rate, reserve state, today's shed / deferred / trimmed / failover counters and tokens saved. Key values are never
 * returned, only their env names.
 */
export async function GET(request: Request) {
  if (!(await poolAdmin(request))) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const h = await poolHealth()
  return Response.json(h, { headers: { 'Cache-Control': 'no-store' } })
}

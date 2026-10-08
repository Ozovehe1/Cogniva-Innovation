import { timingSafeEqual } from 'node:crypto'

/** Server-to-server calls (pg_cron tick, eval runner): Authorization: Bearer AGENT_SECRET. */
export function agentSecretOk(request: Request) {
  const secret = process.env.AGENT_SECRET
  if (!secret) return false
  const a = Buffer.from(request.headers.get('authorization') ?? '')
  const b = Buffer.from(`Bearer ${secret}`)
  return a.length === b.length && timingSafeEqual(a, b)
}

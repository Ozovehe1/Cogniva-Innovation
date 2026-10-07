import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'

// TEMPORARY diagnostics (tutor-only): does Agent Router answer from Vercel? Remove after use.
export const maxDuration = 120
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { profile } = await getSessionProfile()
  if (!profile || profile.role !== 'tutor') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const key = process.env.AGENTROUTER_API_KEY
  if (!key) return NextResponse.json({ error: 'AGENTROUTER_API_KEY not set' })
  const url = new URL(request.url)
  const model = url.searchParams.get('model') || 'claude-opus-5'
  const hosts = ['https://agentrouter.org', 'https://co.agentrouter.org']
  const out: Record<string, string> = {}
  const tries: [string, string, RequestInit][] = []
  for (const h of hosts) {
    tries.push([`${h} chat`, `${h}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, max_tokens: 20, messages: [{ role: 'user', content: 'Reply with the single word OK.' }] }) }])
    tries.push([`${h} messages`, `${h}/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 20, messages: [{ role: 'user', content: 'Reply with the single word OK.' }] }) }])
    tries.push([`${h} models`, `${h}/v1/models`, { headers: { Authorization: `Bearer ${key}` } }])
  }
  await Promise.all(tries.map(async ([name, u, init]) => {
    const t0 = Date.now()
    try {
      const r = await fetch(u, { ...init, signal: AbortSignal.timeout(45_000) })
      const text = await r.text()
      out[name] = `${r.status} ${r.headers.get('content-type') ?? ''} ${Date.now() - t0}ms: ${text.replace(/\s+/g, ' ').slice(0, 400)}`
    } catch (e) { out[name] = `ERR ${(e as Error).message.slice(0, 200)}` }
  }))
  return NextResponse.json({ model, out })
}

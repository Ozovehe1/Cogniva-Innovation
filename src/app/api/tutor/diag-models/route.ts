import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { ai, GEMINI_MODELS, thinkingFor } from '@/lib/gemini'

// TEMPORARY diagnostics (tutor-only): which Gemini models answer for this key. Remove after use.
export const maxDuration = 120
export const dynamic = 'force-dynamic'

const EXTRA = ['gemini-3.8-flash-lite-preview', 'gemini-3.5-flash-lite-preview', 'gemini-3.1-flash-lite-preview', 'gemini-2.0-flash-lite', 'gemini-flash-lite-latest', 'gemini-flash-latest']

export async function GET(request: Request) {
  const { profile } = await getSessionProfile()
  if (!profile || profile.role !== 'tutor') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const url = new URL(request.url)
  const listed: string[] = []
  try {
    const pager = await ai.models.list({ config: { pageSize: 200 } })
    for await (const m of pager) { if (m.name && /flash/i.test(m.name)) listed.push(m.name.replace(/^models\//, '')) }
  } catch (e) { listed.push(`list failed: ${(e as Error).message.slice(0, 200)}`) }
  const probe = url.searchParams.get('probe') !== '0'
  if (url.searchParams.get('list') === '0') listed.length = 0
  const results: Record<string, string> = {}
  if (probe) {
    const asked = (url.searchParams.get('models') ?? '').split(',').map(m => m.trim()).filter(m => /^gemini-[\w.-]+$/.test(m))
    const names = asked.length ? asked : [...new Set([...GEMINI_MODELS, ...EXTRA])]
    await Promise.all(names.map(async model => {
      const t0 = Date.now()
      try {
        const tc = thinkingFor(model, 'low')
        const r = await ai.models.generateContent({ model, contents: 'Reply with the single word OK.', config: { httpOptions: { timeout: 30_000 }, ...(tc ? { thinkingConfig: tc } : {}), responseMimeType: 'application/json' } })
        results[model] = `OK ${Date.now() - t0}ms: ${(r.text ?? '').slice(0, 30)}`
      } catch (e) {
        results[model] = `ERR ${Date.now() - t0}ms: ${(e as Error).message.replace(/\s+/g, ' ').slice(0, 260)}`
      }
    }))
  }
  return NextResponse.json({ listed, results })
}

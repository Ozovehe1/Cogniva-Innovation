// GeniusMap embeddings on Supabase's built-in gte-small model (384 dims, English, ~512 tokens): $0, no external API.
// POST (header x-agent-secret = AGENT_SECRET)
//   { texts: string[] }                 -> { embeddings: number[][] }        (query embedding for hybrid search)
//   { mode: 'pending', limit?: number } -> { embedded: n }                   (pg_cron: rows of learner_memory with no embedding)
// Deployed with verify_jwt off; the shared secret is the only way in.
import { createClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
const session = new (globalThis as any).Supabase.ai.Session('gte-small')

async function embed(text: string): Promise<number[]> {
  const out = await session.run(text.slice(0, 2000), { mean_pool: true, normalize: true })
  return Array.from(out as number[])
}

function same(a: string, b: string) {
  if (!a || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  if (!same(req.headers.get('x-agent-secret') ?? '', Deno.env.get('AGENT_SECRET') ?? '')) return new Response('Forbidden', { status: 403 })
  const body = await req.json().catch(() => ({}))
  try {
    if (Array.isArray(body.texts)) {
      const texts = body.texts.filter((t: unknown) => typeof t === 'string').slice(0, 16)
      const embeddings = []
      for (const t of texts) embeddings.push(await embed(t))
      return Response.json({ embeddings, model: 'gte-small', dims: 384 })
    }
    if (body.mode === 'pending') {
      const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
      const limit = Math.min(80, Math.max(1, Number(body.limit) || 40))
      const { data, error } = await db.from('learner_memory').select('id, title, content').is('embedding', null).order('id').limit(limit)
      if (error) throw new Error(error.message)
      let n = 0
      for (const r of data ?? []) {
        const v = await embed(`${r.title ? r.title + ': ' : ''}${r.content}`)
        const { error: e } = await db.from('learner_memory').update({ embedding: JSON.stringify(v) }).eq('id', r.id)
        if (!e) n++
      }
      return Response.json({ embedded: n })
    }
    return Response.json({ error: 'Send {texts} or {mode:"pending"}' }, { status: 400 })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
})

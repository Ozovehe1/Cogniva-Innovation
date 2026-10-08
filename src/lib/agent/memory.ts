/**
 * Long-term learner memory (RAG). Rows are written by the Learning Director (lesson summaries,
 * misconceptions, chat summaries) and embedded with gte-small by the Supabase Edge Function "embed"
 * (inline when possible, otherwise by the agent-embed pg_cron job within a minute). Retrieval is the
 * hybrid_search RPC (full text + vector, RRF) under the learner's own JWT, so RLS limits it to their rows.
 * Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type MemoryKind = 'lesson_summary' | 'misconception' | 'chat_summary' | 'checkin_note' | 'goal'
export interface MemoryRow { kind: MemoryKind; title: string; content: string; path_id?: string | null; node_id?: string | null; lesson_id?: string | null; source_key?: string | null }

const EMBED_URL = () => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/embed`

export async function embedTexts(texts: string[], timeoutMs = 8000): Promise<number[][] | null> {
  const secret = process.env.AGENT_SECRET
  if (!secret || !texts.length) return null
  try {
    const r = await fetch(EMBED_URL(), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-agent-secret': secret }, body: JSON.stringify({ texts: texts.slice(0, 16) }), signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    const j = await r.json() as { embeddings?: number[][] }
    return Array.isArray(j.embeddings) && j.embeddings.length === texts.slice(0, 16).length ? j.embeddings : null
  } catch { return null }
}

/** Insert (or refresh, by source_key) memory rows for one learner; embeds them inline when the function answers. */
export async function writeMemory(admin: SupabaseClient, studentId: string, rows: MemoryRow[]): Promise<number> {
  const clean = rows.filter(r => r.content?.trim()).slice(0, 12).map(r => ({
    student_id: studentId, kind: r.kind, title: (r.title ?? '').slice(0, 200), content: r.content.trim().slice(0, 1600),
    path_id: r.path_id ?? null, node_id: r.node_id ?? null, lesson_id: r.lesson_id ?? null, source_key: r.source_key ?? null,
  }))
  if (!clean.length) return 0
  const vecs = await embedTexts(clean.map(r => `${r.title ? r.title + ': ' : ''}${r.content}`))
  const withVec = clean.map((r, i) => ({ ...r, embedding: vecs?.[i] ? JSON.stringify(vecs[i]) : null }))
  const keyed = withVec.filter(r => r.source_key)
  const unkeyed = withVec.filter(r => !r.source_key)
  let n = 0
  if (keyed.length) {
    // Re-writing the same source replaces it (e.g. a lesson summarised again after more was learned).
    for (const r of keyed) await admin.from('learner_memory').delete().eq('student_id', studentId).eq('source_key', r.source_key!)
    const { data } = await admin.from('learner_memory').insert(keyed).select('id')
    n += data?.length ?? 0
  }
  if (unkeyed.length) { const { data } = await admin.from('learner_memory').insert(unkeyed).select('id'); n += data?.length ?? 0 }
  return n
}

export interface MemoryHit { id: number; kind: string; title: string; content: string; lesson_id: string | null; node_id: string | null; created_at: string; score: number }

/**
 * Hybrid search. `userDb` is the learner's own client (RLS) for chat; background jobs pass the admin
 * client together with the student id from the job (never from model arguments).
 */
export async function searchMemory(db: SupabaseClient, query: string, opts: { asStudent?: string; k?: number } = {}): Promise<{ hits: MemoryHit[]; semantic: boolean }> {
  const q = query.replace(/\s+/g, ' ').trim().slice(0, 300)
  const vec = (await embedTexts([q], 6000))?.[0] ?? null
  const k = opts.k ?? 6
  const args = { query_text: q, query_embedding: vec ? JSON.stringify(vec) : null, match_count: k }
  const { data, error } = opts.asStudent
    ? await db.rpc('hybrid_search_for', { p_student: opts.asStudent, ...args })
    : await db.rpc('hybrid_search', args)
  if (error) throw new Error(error.message)
  return { hits: (data ?? []) as MemoryHit[], semantic: !!vec }
}

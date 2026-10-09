/**
 * The PER-LEARNER layer of the playbook: what confused this learner and what helped them, kept in their own
 * learner_memory (kind 'teaching_note', owner-only RLS, deleted with the account). Written deterministically from that
 * learner's own outcomes; read only for that same learner's lessons and tutor turns (student id from the session or the
 * lesson's owner — never from model arguments). Never copied into the global playbook. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { writeMemory } from '../agent/memory'
import { cosine, embedOne, parseVec } from './store'
import { sameTopic, topicKey } from '../correctness/blocklist'

export interface TeachingNote { title: string; content: string; lesson_id?: string | null; source_key: string }

export async function writeTeachingNotes(admin: SupabaseClient, studentId: string, notes: TeachingNote[]): Promise<number> {
  if (!studentId || !notes.length) return 0
  return writeMemory(admin, studentId, notes.map(n => ({ kind: 'teaching_note' as const, title: n.title.slice(0, 200), content: n.content.slice(0, 600), lesson_id: n.lesson_id ?? null, source_key: n.source_key })))
}

/** This learner's most relevant teaching notes for a topic (embedding similarity + topic words + recency). */
export async function learnerNotes(admin: SupabaseClient, studentId: string, topic: string, k = 4, queryVec?: number[] | null): Promise<string[]> {
  if (!studentId) return []
  const { data } = await admin.from('learner_memory').select('title, content, embedding, created_at').eq('student_id', studentId).eq('kind', 'teaching_note').order('created_at', { ascending: false }).limit(40)
  const rows = (data ?? []) as { title: string; content: string; embedding: unknown; created_at: string }[]
  if (!rows.length) return []
  const qk = topicKey(topic)
  const qv = queryVec === undefined ? await embedOne(topic, 2500) : queryVec
  const now = Date.now()
  return rows
    .map((r, i) => {
      const sim = qv ? cosine(qv, parseVec(r.embedding)) : 0
      const topical = qk && sameTopic(topicKey(r.title), qk) ? 0.15 : 0
      const recency = Math.max(0, 0.05 - ((now - new Date(r.created_at).getTime()) / 86_400_000) * 0.002) - i * 0.001
      return { r, s: sim + topical + recency }
    })
    .filter(x => x.s > (qv ? 0.78 : 0.1))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map(x => `${x.r.title}: ${x.r.content}`.slice(0, 300))
}

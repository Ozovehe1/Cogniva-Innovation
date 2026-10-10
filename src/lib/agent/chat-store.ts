import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

export interface ChatListItem { id: string; title: string; updated_at: string; lesson_id: string | null; lesson_title: string | null }

/** The learner's own chats, newest first (RLS on chat_sessions limits the read to their rows). */
export async function listChats(supabase: SupabaseClient, studentId: string, limit = 200): Promise<ChatListItem[]> {
  const { data } = await supabase.from('chat_sessions').select('id, title, updated_at, lesson_id, lessons(title)')
    .eq('student_id', studentId).order('updated_at', { ascending: false }).limit(limit)
  return ((data ?? []) as unknown as { id: string; title: string; updated_at: string; lesson_id: string | null; lessons: { title: string } | { title: string }[] | null }[])
    .map(r => ({ id: r.id, title: r.title, updated_at: r.updated_at, lesson_id: r.lesson_id, lesson_title: (Array.isArray(r.lessons) ? r.lessons[0]?.title : r.lessons?.title) ?? null }))
}

/**
 * Hard-delete the learner's own chats: the sessions go through the learner's session (RLS delete policy
 * own_chat_sessions_delete, so another learner's id deletes nothing), their messages cascade, and what was stored
 * per chat elsewhere is removed or unlinked with the service role, scoped to the ids that were actually deleted:
 * the chat's memory summary (learner_memory source_key chat:<id>) is deleted; playbook usage/signal rows keep their
 * anonymous counts but lose the link to the chat.
 */
export async function deleteOwnChats(supabase: SupabaseClient, studentId: string, ids: string[] | 'all'): Promise<string[]> {
  let q = supabase.from('chat_sessions').delete().eq('student_id', studentId)
  if (ids !== 'all') { if (!ids.length) return []; q = q.in('id', ids) }
  const { data, error } = await q.select('id')
  if (error) throw new Error(error.message)
  const gone = ((data ?? []) as { id: string }[]).map(r => r.id)
  if (!gone.length) return gone
  const admin = createAdminClient()
  // Belt and braces: messages cascade with the session, but clear any left behind for these ids.
  await admin.from('chat_messages').delete().in('session_id', gone).eq('student_id', studentId)
  await admin.from('learner_memory').delete().eq('student_id', studentId).in('source_key', gone.map(id => `chat:${id}`))
  await admin.from('playbook_usage').update({ session_id: null }).in('session_id', gone)
  await admin.from('playbook_signals').update({ session_id: null }).in('session_id', gone)
  return gone
}

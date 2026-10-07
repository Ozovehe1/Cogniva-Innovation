import { createClient } from '@/lib/supabase/server'

export interface SessionProfile {
  id: string
  user_id: string
  full_name: string
  role: 'student' | 'tutor'
}

/** Current user's profile with a request-scoped Supabase client (RLS applies). */
export async function getSessionProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, profile: null as SessionProfile | null }
  const { data } = await supabase.from('profiles').select('id, user_id, full_name, role').eq('user_id', user.id).maybeSingle()
  return { supabase, profile: (data as SessionProfile | null) ?? null }
}

import { createClient } from '@/lib/supabase/server'

/**
 * Admin (Ideanimo staff) access: the signed-in user's email must be in ADMIN_EMAILS (comma-separated Vercel env).
 * Admin pages show anonymised-in-spirit triage data; they never act on a learner's account. Server only.
 */
const DEFAULT_ADMINS = ['abdulcosman01@gmail.com']
export function adminEmails(): string[] {
  const env = (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  return env.length ? env : DEFAULT_ADMINS
}
export async function getAdmin(): Promise<{ email: string } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const email = user?.email?.toLowerCase()
  return email && adminEmails().includes(email) ? { email } : null
}

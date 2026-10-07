import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role client. Server-only: bypasses RLS. Used for storage signed upload
 * URLs and for the render callback, which has no user session.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export const MANIM_BUCKET = 'manim-clips'

export function publicClipUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${MANIM_BUCKET}/${path}`
}

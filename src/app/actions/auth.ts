'use server'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export type LoginState = { error: string }
export type SignupState = { error: string; confirmEmail: boolean }

async function ensureProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  fullName: string,
  email: string,
  role: string
) {
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('user_id', userId).single()
  if (profile) return profile.role as string

  // Try RPC first (if schema has been run)
  const { data: rpcRole, error: rpcError } = await supabase.rpc('ensure_profile_exists', {
    p_user_id: userId,
    p_full_name: fullName,
    p_email: email,
    p_role: role,
  })
  if (!rpcError && rpcRole) return rpcRole as string

  // Fallback: direct upsert (works with anon key + user JWT)
  await supabase.from('profiles').upsert(
    { user_id: userId, full_name: fullName, email, role },
    { onConflict: 'user_id', ignoreDuplicates: true }
  )
  const { data: created } = await supabase
    .from('profiles').select('role').eq('user_id', userId).single()
  return (created?.role ?? role) as string
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return {
      error: error.message.toLowerCase().includes('email not confirmed')
        ? 'Please confirm your email first — check your inbox.'
        : error.message,
    }
  }

  const meta = data.user.user_metadata
  const role = await ensureProfile(
    supabase,
    data.user.id,
    meta?.full_name ?? email.split('@')[0],
    email,
    meta?.role ?? 'student'
  )

  revalidatePath('/', 'layout')
  redirect(role === 'tutor' ? '/tutor/dashboard' : '/dashboard')
}

export async function signupAction(
  _prev: SignupState,
  formData: FormData
): Promise<SignupState> {
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const fullName = formData.get('fullName') as string
  const role = formData.get('role') as 'student' | 'tutor'

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, role } },
  })

  if (error) return { error: error.message, confirmEmail: false }
  if (!data.user) return { error: 'Signup failed. Please try again.', confirmEmail: false }

  if (data.session) {
    await ensureProfile(supabase, data.user.id, fullName, email, role)
    revalidatePath('/', 'layout')
    redirect(role === 'student' ? '/assessment' : '/tutor/dashboard')
  }

  return { error: '', confirmEmail: true }
}

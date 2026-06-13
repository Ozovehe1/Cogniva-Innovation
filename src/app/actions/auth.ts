'use server'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export type LoginState = { error: string }
export type SignupState = { error: string; confirmEmail: boolean }

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
        ? 'Please confirm your email first — check your inbox for the confirmation link.'
        : error.message,
    }
  }

  let { data: profile } = await supabase
    .from('profiles').select('role').eq('user_id', data.user.id).single()

  if (!profile) {
    const meta = data.user.user_metadata
    if (meta?.role) {
      await supabase.rpc('ensure_profile_exists', {
        p_user_id: data.user.id,
        p_full_name: meta.full_name ?? email.split('@')[0],
        p_email: email,
        p_role: meta.role,
      })
      revalidatePath('/', 'layout')
      redirect(meta.role === 'tutor' ? '/tutor/dashboard' : '/dashboard')
    }
    return { error: 'Account found but profile is missing. Please sign up again.' }
  }

  revalidatePath('/', 'layout')
  redirect(profile.role === 'tutor' ? '/tutor/dashboard' : '/dashboard')
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
    await supabase.rpc('ensure_profile_exists', {
      p_user_id: data.user.id,
      p_full_name: fullName,
      p_email: email,
      p_role: role,
    })
    revalidatePath('/', 'layout')
    redirect(role === 'student' ? '/assessment' : '/tutor/dashboard')
  }

  return { error: '', confirmEmail: true }
}

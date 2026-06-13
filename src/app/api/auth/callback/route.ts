import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    const { data } = await supabase.auth.exchangeCodeForSession(code)

    if (data?.user) {
      const meta = data.user.user_metadata
      const role = (meta?.role as 'student' | 'tutor') ?? 'student'

      // Create profile if it doesn't exist yet (email-confirmation flow)
      await supabase.rpc('ensure_profile_exists', {
        p_user_id: data.user.id,
        p_full_name: meta?.full_name ?? data.user.email!.split('@')[0],
        p_email: data.user.email!,
        p_role: role,
      })

      return NextResponse.redirect(`${origin}${role === 'tutor' ? '/tutor/dashboard' : '/dashboard'}`)
    }
  }

  return NextResponse.redirect(`${origin}/login`)
}

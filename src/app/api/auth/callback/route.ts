import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const role = searchParams.get('role') as 'student' | 'tutor' | null

  if (code) {
    const supabase = await createClient()
    const { data } = await supabase.auth.exchangeCodeForSession(code)
    if (data?.user) {
      const { data: existing } = await supabase.from('profiles').select('id, role').eq('user_id', data.user.id).single()
      if (!existing && role) {
        await supabase.from('profiles').insert({
          user_id: data.user.id,
          full_name: data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || 'User',
          email: data.user.email!,
          role,
        })
      }
      const profileRole = existing?.role || role
      return NextResponse.redirect(`${origin}${profileRole === 'tutor' ? '/tutor/dashboard' : '/assessment'}`)
    }
  }
  return NextResponse.redirect(`${origin}/login`)
}

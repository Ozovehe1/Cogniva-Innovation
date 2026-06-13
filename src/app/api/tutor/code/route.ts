import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('id, role').eq('user_id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'tutor')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { code } = await request.json()
  const cleaned = (code ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')
  if (cleaned.length < 3 || cleaned.length > 20)
    return NextResponse.json({ error: 'Code must be 3–20 characters (letters, numbers, hyphens)' }, { status: 400 })

  const { error } = await supabase
    .from('profiles')
    .update({ tutor_code: cleaned })
    .eq('id', (profile as { id: string }).id)

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'That code is already taken' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ code: cleaned })
}

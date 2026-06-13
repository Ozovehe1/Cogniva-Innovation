import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TutorShell } from '@/components/tutor-shell'

export const dynamic = 'force-dynamic'

export default async function TutorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()

  if (!profile) {
    const meta = user.user_metadata
    const role = meta?.role ?? 'tutor'
    const fullName = meta?.full_name ?? user.email!.split('@')[0]

    const { error: rpcError } = await supabase.rpc('ensure_profile_exists', {
      p_user_id: user.id, p_full_name: fullName, p_email: user.email!, p_role: role,
    })
    const { error: upsertError } = await supabase.from('profiles').upsert(
      { user_id: user.id, full_name: fullName, email: user.email!, role },
      { onConflict: 'user_id', ignoreDuplicates: true }
    )
    const { data: recovered, error: selectError } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
    profile = recovered

    if (!profile) {
      return (
        <div style={{ color: 'white', padding: '2rem', background: '#09090B', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h2 style={{ color: '#f87171', marginBottom: '0.5rem' }}>Profile setup failed</h2>
          <p style={{ color: '#a1a1aa', marginBottom: '1.5rem', fontSize: '14px' }}>Your account was created but the profile could not be loaded.</p>
          <pre style={{ background: '#18181B', padding: '1rem', borderRadius: '8px', fontSize: '12px', color: '#71717A', marginBottom: '1.5rem', overflowX: 'auto' }}>
{`user_id:      ${user.id}
email:        ${user.email}
rpc_error:    ${rpcError?.message ?? 'none'}
upsert_error: ${upsertError?.message ?? 'none'}
select_error: ${selectError?.message ?? 'none'}`}
          </pre>
          <form action="/api/auth/signout" method="post">
            <button style={{ background: '#7C3AED', color: 'white', padding: '0.5rem 1.25rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '14px' }}>
              Sign out
            </button>
          </form>
        </div>
      )
    }
  }

  if (profile.role !== 'tutor') redirect('/dashboard')

  const navItems = [
    { href: '/tutor/dashboard', icon: '◈', label: 'Dashboard' },
    { href: '/tutor/students', icon: '⬡', label: 'Students' },
    { href: '/tutor/projects', icon: '⬢', label: 'Projects' },
    { href: '/tutor/projects/new', icon: '+', label: 'New Project' },
  ]

  const initials = profile.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <TutorShell fullName={profile.full_name} initials={initials} navItems={navItems}>
      {children}
    </TutorShell>
  )
}

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StudentShell } from '@/components/student-shell'

export const dynamic = 'force-dynamic'

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()

  if (!profile) {
    const meta = user.user_metadata
    const role = meta?.role ?? 'student'
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
        <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
          <div className="w-full max-w-lg rounded-[14px] border border-line bg-surface p-6 shadow-[var(--shadow-card)] md:p-8">
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-danger">Account issue</p>
            <h2 className="mt-2 font-display text-[28px] leading-tight text-ink">Profile setup failed</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">Your account was created but the profile could not be loaded. Send these details to support:</p>
            <pre className="mt-5 overflow-x-auto rounded-[10px] border border-line bg-sunken p-4 font-mono text-[12px] leading-relaxed text-ink-2">
{`user_id:      ${user.id}
email:        ${user.email}
rpc_error:    ${rpcError?.message ?? 'none'}
upsert_error: ${upsertError?.message ?? 'none'}
select_error: ${selectError?.message ?? 'none'}`}
            </pre>
            <form action="/api/auth/signout" method="post" className="mt-6">
              <button className="inline-flex h-10 items-center rounded-[10px] bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover">
                Sign out
              </button>
            </form>
          </div>
        </div>
      )
    }
  }

  if (profile.role === 'tutor') redirect('/tutor/dashboard')

  const navItems = [
    { href: '/dashboard', icon: 'home', label: 'Dashboard' },
    { href: '/assessment', icon: 'brain', label: 'Assessment' },
    { href: '/projects', icon: 'list', label: 'My Projects' },
  ]

  const initials = profile.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <StudentShell fullName={profile.full_name} initials={initials} navItems={navItems}>
      {children}
    </StudentShell>
  )
}

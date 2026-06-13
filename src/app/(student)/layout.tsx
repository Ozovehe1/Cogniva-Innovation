import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

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
        <div style={{ color: 'white', padding: '2rem', background: '#09090B', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h2 style={{ color: '#f87171', marginBottom: '0.5rem' }}>Profile setup failed</h2>
          <p style={{ color: '#a1a1aa', marginBottom: '1.5rem', fontSize: '14px' }}>Your account was created but the profile could not be loaded. Send these details to support:</p>
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

  if (profile.role === 'tutor') redirect('/tutor/dashboard')

  const navItems = [
    { href: '/dashboard', icon: '◈', label: 'Dashboard' },
    { href: '/assessment', icon: '⬡', label: 'Assessment' },
    { href: '/projects', icon: '⬢', label: 'My Projects' },
  ]

  const initials = profile.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="flex h-screen" style={{ background: '#09090B' }}>
      {/* Sidebar */}
      <aside className="w-56 flex flex-col flex-shrink-0" style={{ background: '#0D0D10', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="w-6 h-6 rounded-md bg-violet-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">G</div>
          <span className="text-white font-semibold text-sm">GeniusMap</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2 space-y-0.5 pt-3">
          {navItems.map(({ href, icon, label }) => (
            <Link key={href} href={href}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition group hover:text-white"
              style={{ color: '#71717A' }}>
              <span className="text-base">{icon}</span>
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        {/* User */}
        <div className="p-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="w-7 h-7 rounded-full bg-violet-700 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-medium truncate">{profile.full_name}</p>
              <p className="text-zinc-500 text-xs">Student</p>
            </div>
          </div>
          <form action="/api/auth/signout" method="post" className="mt-1">
            <button className="w-full text-left px-2 py-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition rounded">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  )
}

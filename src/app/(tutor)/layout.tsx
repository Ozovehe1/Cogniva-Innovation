import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function TutorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()

  // Profile missing — auto-recover from user metadata (handles pre-schema-fix accounts)
  if (!profile && user.user_metadata?.role) {
    await supabase.rpc('ensure_profile_exists', {
      p_user_id: user.id,
      p_full_name: user.user_metadata.full_name ?? user.email!.split('@')[0],
      p_email: user.email!,
      p_role: user.user_metadata.role,
    })
    const { data: recovered } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
    profile = recovered
  }

  if (!profile || profile.role !== 'tutor') redirect('/dashboard')

  const navItems = [
    { href: '/tutor/dashboard', icon: '◈', label: 'Dashboard' },
    { href: '/tutor/students', icon: '⬡', label: 'Students' },
    { href: '/tutor/projects', icon: '⬢', label: 'Projects' },
    { href: '/tutor/projects/new', icon: '+', label: 'New Project' },
  ]

  const initials = profile.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="flex h-screen" style={{ background: '#09090B' }}>
      <aside className="w-56 flex flex-col flex-shrink-0" style={{ background: '#0A0F0C', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2 px-4 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="w-6 h-6 rounded-md bg-emerald-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">G</div>
          <span className="text-white font-semibold text-sm">GeniusMap</span>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 pt-3">
          {navItems.map(({ href, icon, label }) => (
            <Link key={href} href={href}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition hover:text-white"
              style={{ color: '#71717A' }}>
              <span className="text-base w-4 text-center">{icon}</span>
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="p-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="w-7 h-7 rounded-full bg-emerald-800 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">{initials}</div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-medium truncate">{profile.full_name}</p>
              <p className="text-zinc-500 text-xs">Tutor</p>
            </div>
          </div>
          <form action="/api/auth/signout" method="post" className="mt-1">
            <button className="w-full text-left px-2 py-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition rounded">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  )
}

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { LogOut, LayoutDashboard, Users, FolderOpen, PlusCircle } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function TutorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'tutor') redirect('/dashboard')

  const navItems = [
    { href: '/tutor/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/tutor/students', icon: Users, label: 'My Students' },
    { href: '/tutor/projects', icon: FolderOpen, label: 'Projects' },
    { href: '/tutor/projects/new', icon: PlusCircle, label: 'New Project' },
  ]

  return (
    <div className="flex h-screen bg-gray-950">
      <aside className="w-64 bg-emerald-950 border-r border-emerald-800 flex flex-col">
        <div className="p-6 border-b border-emerald-800">
          <h1 className="text-xl font-bold text-white">GeniusMap</h1>
          <p className="text-emerald-400 text-xs mt-1">Tutor Portal</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(({ href, icon: Icon, label }) => (
            <Link key={href} href={href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-emerald-300 hover:bg-emerald-800 hover:text-white transition">
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-emerald-800">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white text-sm font-bold">
              {(profile as { full_name: string }).full_name[0]}
            </div>
            <div>
              <p className="text-white text-sm font-medium">{(profile as { full_name: string }).full_name}</p>
              <p className="text-emerald-400 text-xs">Tutor</p>
            </div>
          </div>
          <form action="/api/auth/signout" method="post">
            <button className="flex items-center gap-2 text-emerald-400 hover:text-white text-sm transition w-full">
              <LogOut size={16} /> Sign Out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-auto bg-gray-950 p-8">
        {children}
      </main>
    </div>
  )
}

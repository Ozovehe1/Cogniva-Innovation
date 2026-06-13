import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { LogOut, LayoutDashboard, Brain, FolderOpen } from 'lucide-react'

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
  if (!profile) redirect('/login')

  const navItems = [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/assessment', icon: Brain, label: 'Assessment' },
    { href: '/projects', icon: FolderOpen, label: 'My Projects' },
  ]

  return (
    <div className="flex h-screen bg-gray-950">
      <aside className="w-64 bg-indigo-950 border-r border-indigo-800 flex flex-col">
        <div className="p-6 border-b border-indigo-800">
          <h1 className="text-xl font-bold text-white">GeniusMap</h1>
          <p className="text-indigo-400 text-xs mt-1">Student Portal</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(({ href, icon: Icon, label }) => (
            <Link key={href} href={href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-indigo-300 hover:bg-indigo-800 hover:text-white transition">
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-indigo-800">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white text-sm font-bold">
              {profile.full_name[0]}
            </div>
            <div>
              <p className="text-white text-sm font-medium">{profile.full_name}</p>
              <p className="text-indigo-400 text-xs">Student</p>
            </div>
          </div>
          <form action="/api/auth/signout" method="post">
            <button className="flex items-center gap-2 text-indigo-400 hover:text-white text-sm transition w-full">
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

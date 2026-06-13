'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { IdleTimeout } from './idle-timeout'

interface NavItem { href: string; icon: string; label: string }

export function StudentShell({
  children,
  fullName,
  initials,
  navItems,
}: {
  children: React.ReactNode
  fullName: string
  initials: string
  navItems: NavItem[]
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  const NavLinks = ({ onNav }: { onNav?: () => void }) => (
    <>
      {navItems.map(({ href, icon, label }) => {
        const active = pathname === href
        return (
          <Link key={href} href={href} onClick={onNav}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition"
            style={{
              color: active ? '#fff' : '#71717A',
              background: active ? 'rgba(124,58,237,0.15)' : 'transparent',
            }}>
            <span className="text-base w-4 text-center">{icon}</span>
            <span>{label}</span>
          </Link>
        )
      })}
    </>
  )

  const UserBlock = () => (
    <div className="p-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
        <div className="w-7 h-7 rounded-full bg-violet-700 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">{initials}</div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-xs font-medium truncate">{fullName}</p>
          <p className="text-zinc-500 text-xs">Student</p>
        </div>
      </div>
      <form action="/api/auth/signout" method="post" className="mt-1">
        <button className="w-full text-left px-2 py-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition rounded">Sign out</button>
      </form>
    </div>
  )

  return (
    <div className="flex h-screen" style={{ background: '#09090B' }}>
      <IdleTimeout />
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 flex-col flex-shrink-0" style={{ background: '#0D0D10', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2 px-4 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="w-6 h-6 rounded-md bg-violet-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">G</div>
          <span className="text-white font-semibold text-sm">GeniusMap</span>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 pt-3">
          <NavLinks />
        </nav>
        <UserBlock />
      </aside>

      {/* Mobile drawer overlay */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 flex flex-col" style={{ background: '#0D0D10', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-violet-600 flex items-center justify-center text-white text-xs font-bold">G</div>
                <span className="text-white font-semibold text-sm">GeniusMap</span>
              </div>
              <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-white transition p-1">✕</button>
            </div>
            <nav className="flex-1 p-2 space-y-0.5 pt-3">
              <NavLinks onNav={() => setOpen(false)} />
            </nav>
            <UserBlock />
          </aside>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <header className="flex md:hidden items-center justify-between px-4 py-3 flex-shrink-0" style={{ background: '#0D0D10', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-violet-600 flex items-center justify-center text-white text-xs font-bold">G</div>
            <span className="text-white font-semibold text-sm">GeniusMap</span>
          </div>
          <button onClick={() => setOpen(true)} className="p-2 rounded-lg text-zinc-400 hover:text-white transition" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="p-4 md:p-8">{children}</div>
        </main>
      </div>
    </div>
  )
}

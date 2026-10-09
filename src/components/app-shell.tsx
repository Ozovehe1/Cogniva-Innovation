'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { BookOpen, LayoutGrid, LogOut, Settings, Sparkles, X } from 'lucide-react'
import { IdleTimeout } from './idle-timeout'
import { ZoomHost } from './zoomable'
import { Avatar, Logo, SheetGrabber, cx } from './ui'

export interface NavItem { href: string; icon: string; label: string }

const icons: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  home: LayoutGrid,
  learn: BookOpen,
  ask: Sparkles,
}

/** The nav item whose href is the longest prefix of the current path is active. */
function activeHref(pathname: string, items: NavItem[]) {
  let best: string | null = null
  for (const { href } of items) {
    if (pathname === href || pathname.startsWith(href + '/')) {
      if (!best || href.length > best.length) best = href
    }
  }
  return best
}

export function AppShell({
  children,
  fullName,
  initials,
  navItems,
  roleLabel,
  homeHref,
}: {
  children: React.ReactNode
  fullName: string
  initials: string
  navItems: NavItem[]
  roleLabel?: string
  homeHref: string
}) {
  const pathname = usePathname()
  const current = activeHref(pathname, navItems)
  // The account sheet belongs to the page it was opened on, so navigating closes it.
  const [menuPath, setMenuPath] = useState<string | null>(null)
  const menuOpen = menuPath === pathname
  const setMenuOpen = (open: boolean) => setMenuPath(open ? pathname : null)
  // A forward navigation can leave the new page's heading under the sticky top bar (the router only
  // scrolls when the page top is outside the viewport, and the bar covers its first 56 px). Bring it out.
  const popped = React.useRef(false)
  useEffect(() => {
    const onPop = () => { popped.current = true }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    // Back/forward keeps the restored scroll position.
    if (popped.current) { popped.current = false; return }
    const id = requestAnimationFrame(() => {
      const bar = document.querySelector<HTMLElement>('[data-app-topbar]')
      const main = document.getElementById('main')
      if (!bar || !main || getComputedStyle(bar).display === 'none') return
      if (window.scrollY > 0 && main.getBoundingClientRect().top < bar.getBoundingClientRect().bottom - 1) window.scrollTo({ top: 0 })
    })
    return () => cancelAnimationFrame(id)
  }, [pathname])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuPath(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const settingsActive = pathname === '/settings' || pathname.startsWith('/settings/')
  const settingsLink = (
    <Link
      href="/settings"
      aria-current={settingsActive ? 'page' : undefined}
      className={cx('flex h-10 w-full items-center gap-2.5 rounded-[10px] px-3 text-sm transition-colors duration-150', settingsActive ? 'bg-sunken font-medium text-ink' : 'text-ink-2 hover:bg-sunken hover:text-ink')}
    >
      <Settings className="h-4 w-4" strokeWidth={1.75} />
      Settings &amp; goals
    </Link>
  )

  const signOutForm = (className?: string) => (
    <form action="/api/auth/signout" method="post" className={className}>
      <button
        type="submit"
        className="flex h-10 w-full items-center gap-2.5 rounded-[10px] px-3 text-sm text-ink-2 transition-colors duration-150 hover:bg-sunken hover:text-ink"
      >
        <LogOut className="h-4 w-4" strokeWidth={1.75} />
        Sign out
      </button>
    </form>
  )

  return (
    <div className="flex min-h-dvh bg-canvas">
      <IdleTimeout />
      <ZoomHost />

      {/* ── Desktop sidebar ── */}
      <aside className="sticky top-0 hidden h-dvh w-[248px] flex-shrink-0 flex-col border-r border-line bg-[#FBFAF7] md:flex">
        <div className="flex h-16 items-center px-5">
          <Logo href={homeHref} />
        </div>

        <nav aria-label="Main" className="flex-1 space-y-0.5 px-3 pt-4">
          {navItems.map(({ href, icon, label }) => {
            const Icon = icons[icon] ?? LayoutGrid
            const active = current === href
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'group relative flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm transition-colors duration-150',
                  active ? 'bg-surface font-medium text-ink shadow-[var(--shadow-card)] ring-1 ring-line' : 'text-ink-2 hover:bg-sunken hover:text-ink',
                )}
              >
                <Icon className={cx('h-[17px] w-[17px] flex-shrink-0', active ? 'text-accent' : 'text-muted group-hover:text-ink-2')} strokeWidth={1.75} />
                {label}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar initials={initials} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{fullName}</p>
              {roleLabel ? <p className="text-[12px] text-muted">{roleLabel}</p> : null}
            </div>
          </div>
          <div className="mt-1 space-y-0.5">{settingsLink}{signOutForm()}</div>
        </div>
      </aside>

      {/* ── Content ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header data-app-topbar className="pt-safe sticky top-0 z-30 flex-shrink-0 border-b border-line bg-canvas/95 backdrop-blur-sm md:hidden">
          <div className="flex h-14 items-center justify-between px-4">
            <Logo href={homeHref} />
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Account menu"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              className="-mr-1 flex h-11 w-11 items-center justify-center rounded-full"
            >
              <Avatar initials={initials} size="sm" />
            </button>
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 overflow-x-clip">
          <div className="mx-auto w-full max-w-[1120px] px-4 pb-[calc(88px+env(safe-area-inset-bottom))] pt-6 sm:px-6 md:px-10 md:pb-16 md:pt-10">
            {children}
          </div>
        </main>
      </div>

      {/* ── Mobile bottom tab bar ── */}
      <nav
        aria-label="Main"
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-sm md:hidden"
      >
        <ul className="mx-auto flex max-w-md items-stretch justify-around px-2">
          {navItems.map(({ href, icon, label }) => {
            const Icon = icons[icon] ?? LayoutGrid
            const active = current === href
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150',
                    active ? 'text-accent' : 'text-muted hover:text-ink',
                  )}
                >
                  <span className={cx('flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-150', active && 'bg-accent-soft')}>
                    <Icon className="h-[19px] w-[19px]" strokeWidth={active ? 2 : 1.75} />
                  </span>
                  {label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* ── Mobile account sheet ── */}
      <AnimatePresence>
        {menuOpen && (
          <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Account">
            <motion.div
              className="absolute inset-0 bg-ink/30"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setMenuOpen(false)}
            />
            <motion.div
              className="pb-safe absolute inset-x-0 bottom-0 rounded-t-[18px] border-t border-line bg-surface"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
              drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, info) => { if (info.offset.y > 80 || info.velocity.y > 500) setMenuOpen(false) }}
            >
              <SheetGrabber />
              <div className="flex items-center gap-3 border-b border-line px-5 py-4">
                <Avatar initials={initials} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-ink">{fullName}</p>
                  {roleLabel ? <p className="text-[13px] text-muted">{roleLabel}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close"
                  className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink"
                >
                  <X className="h-5 w-5" strokeWidth={1.75} />
                </button>
              </div>
              <div className="space-y-0.5 p-3 pb-4">{settingsLink}{signOutForm()}</div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

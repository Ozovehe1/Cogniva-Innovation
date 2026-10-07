import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Logo } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const { data: profile } = await supabase
      .from('profiles').select('role').eq('user_id', user.id).single()
    if (profile) {
      redirect('/dashboard')
    }
  }

  return (
    <div className="flex min-h-dvh bg-canvas">
      {/* Left: brand panel (desktop) */}
      <aside className="relative hidden w-[44%] max-w-[620px] flex-col justify-between bg-accent p-12 text-white lg:flex">
        <Logo inverted />
        <div>
          <blockquote className="font-display text-[34px] leading-[1.2]">
            Start from what you already know, and learn the next thing properly.
          </blockquote>
          <p className="mt-5 text-sm text-white/70">An AI tutor that teaches at your level and pace</p>
        </div>
        <ul className="grid gap-3 text-sm text-white/80">
          {[
            'A short conversation about your goal and why it matters',
            'A quick adaptive check of what you know and what’s next',
            'Lessons on a live whiteboard, with a natural voice',
          ].map(item => (
            <li key={item} className="flex items-start gap-3">
              <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-white/60" />
              {item}
            </li>
          ))}
        </ul>
      </aside>

      {/* Right: form */}
      <main className="flex flex-1 flex-col">
        <div className="pt-safe flex h-16 items-center px-5 lg:hidden">
          <Logo />
        </div>
        <div className="flex flex-1 items-start justify-center px-5 pb-12 pt-6 sm:items-center sm:pt-0">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
      </main>
    </div>
  )
}

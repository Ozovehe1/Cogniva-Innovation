import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const { data: profile } = await supabase
      .from('profiles').select('role').eq('user_id', user.id).single()
    if (profile) {
      redirect(profile.role === 'tutor' ? '/tutor/dashboard' : '/dashboard')
    }
  }

  return (
    <div className="min-h-screen flex" style={{ background: '#09090B' }}>
      {/* Left: Brand panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0F0A1E 0%, #1A0A2E 50%, #0D1A2D 100%)' }}>
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-30" style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.4) 0%, transparent 70%)' }} />
          <div className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.4) 0%, transparent 70%)' }} />
        </div>
        <div className="relative">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center text-white font-bold">G</div>
            <span className="text-white font-semibold text-lg">GeniusMap</span>
          </Link>
        </div>
        <div className="relative">
          <blockquote className="text-2xl font-semibold text-white leading-relaxed mb-4">
            &ldquo;The problem is not that students lack intelligence. The problem is that the system lacks the ability to see it.&rdquo;
          </blockquote>
          <p className="text-violet-400 text-sm">— GeniusMap Core Belief</p>
        </div>
        <div className="relative grid grid-cols-2 gap-3">
          {[
            { emoji: '🧠', label: '8 Intelligence Types' },
            { emoji: '⚡', label: 'AI-Powered Analysis' },
            { emoji: '🗺️', label: 'Personalised Paths' },
            { emoji: '📈', label: 'Dynamic Growth' },
          ].map(({ emoji, label }) => (
            <div key={label} className="flex items-center gap-2 text-sm text-violet-300">
              <span>{emoji}</span>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Auth form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <Link href="/" className="flex lg:hidden items-center gap-2 mb-8">
            <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center text-white font-bold text-sm">G</div>
            <span className="text-white font-semibold">GeniusMap</span>
          </Link>
          {children}
        </div>
      </div>
    </div>
  )
}

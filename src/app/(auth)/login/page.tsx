'use client'
import { use, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { Alert, Pending, buttonClass, inputClass, labelClass } from '@/components/ui'


export default function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [show, setShow] = useState(false)
  // Signed out after 30 minutes away: say so calmly and that their place is kept (anxiety-safe, no mystery).
  const away = use(searchParams).reason === 'away'

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError('')

    const fd = new FormData(e.currentTarget)
    const email = fd.get('email') as string
    const password = fd.get('password') as string

    const supabase = createClient()
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError(
        authError.message.toLowerCase().includes('email not confirmed')
          ? 'Please confirm your email first — check your inbox.'
          : /invalid login credentials/i.test(authError.message)
            ? 'That email and password don’t match an account. Check for a typo, or create an account below.'
            : /network|fetch/i.test(authError.message)
              ? 'We couldn’t reach GeniusMap. Check your connection and try again.'
              : authError.message
      )
      setPending(false)
      return
    }

    // Determine role — prefer the profile row, fall back to user metadata
    let role = (data.user.user_metadata?.role as string) ?? 'student'
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', data.user.id)
      .single()

    if (profile) {
      role = profile.role
    } else {
      // Profile missing — create it before navigating
      await supabase.rpc('ensure_profile_exists', {
        p_user_id: data.user.id,
        p_full_name: data.user.user_metadata?.full_name ?? email.split('@')[0],
        p_email: email,
        p_role: role,
      })
    }

    // Full-page navigation so the server layouts receive the fresh session cookie.
    // ?next= (set by the away sign-out and the sign-in redirect) returns the user to where they were.
    const next = new URLSearchParams(window.location.search).get('next')
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : null
    const studentArea = /^\/(dashboard|start|learn)(\/|$|\?)/.test(safeNext ?? '')
    window.location.href = safeNext && studentArea ? safeNext : '/dashboard'
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-[34px] leading-tight text-ink">Welcome back</h1>
        <p className="mt-2 text-[15px] text-muted">Sign in to pick up where you left off.</p>
      </div>
      {away && <Alert tone="info" className="mb-6" title="You were signed out after 30 minutes away">Your place is saved. Sign in and you’ll go straight back to it.</Alert>}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="email" className={labelClass}>Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" inputMode="email"
            className={inputClass} placeholder="you@example.com" />
        </div>
        <div>
          <label htmlFor="password" className={labelClass}>Password</label>
          <div className="relative">
            <input id="password" name="password" type={show ? 'text' : 'password'} required autoComplete="current-password"
              className={`${inputClass} pr-12`} placeholder="Your password" />
            <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
              className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-[10px] text-muted hover:text-ink">
              {show ? <EyeOff className="h-4 w-4" strokeWidth={1.75} /> : <Eye className="h-4 w-4" strokeWidth={1.75} />}
            </button>
          </div>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <button type="submit" disabled={pending} className={buttonClass('primary', 'lg', 'w-full')}>
          <Pending busy={pending} label="Signing in">Sign in</Pending>
        </button>
      </form>

      <p className="mt-8 border-t border-line pt-6 text-center text-sm text-muted">
        New to GeniusMap?{' '}
        <Link href="/signup" className="font-medium text-accent underline-offset-4 hover:underline">Create an account</Link>
      </p>
    </div>
  )
}

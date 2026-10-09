'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { Eye, EyeOff, Mail } from 'lucide-react'
import { Alert, Spinner, buttonClass, inputClass, labelClass } from '@/components/ui'


export default function SignupPage() {
  const role = 'student' as const
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState(false)
  const [show, setShow] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError('')

    const fd = new FormData(e.currentTarget)
    const emailVal = fd.get('email') as string
    const password = fd.get('password') as string
    const fullName = fd.get('fullName') as string

    const supabase = createClient()
    const { data, error: authError } = await supabase.auth.signUp({
      email: emailVal,
      password,
      options: { data: { full_name: fullName, role } },
    })

    if (authError) {
      setError(/already registered|already exists/i.test(authError.message) ? 'There’s already an account with that email. Sign in instead.' : authError.message)
      setPending(false)
      return
    }
    if (!data.user) {
      setError('Signup failed. Please try again.')
      setPending(false)
      return
    }

    if (data.session) {
      // Email confirmation disabled — user is immediately signed in
      await supabase.rpc('ensure_profile_exists', {
        p_user_id: data.user.id,
        p_full_name: fullName,
        p_email: emailVal,
        p_role: role,
      })
      window.location.href = '/start'
      return
    }

    // Email confirmation required
    setConfirmEmail(true)
  }

  if (confirmEmail) {
    return (
      <div>
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full border border-accent-line bg-accent-soft text-accent">
          <Mail className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <h1 className="font-display text-[34px] leading-tight text-ink">Check your email</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          We sent a confirmation link to <span className="font-medium text-ink">{email}</span>. Open it to
          activate your account, then sign in.
        </p>
        <Link href="/login" className={buttonClass('primary', 'lg', 'mt-8 w-full')}>
          Go to sign in
        </Link>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-[34px] leading-tight text-ink">Create your account</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Next, your AI tutor asks a few questions about what you want to learn, then runs a short check to find where to start.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="fullName" className={labelClass}>Full name</label>
          <input id="fullName" name="fullName" type="text" required autoComplete="name"
            className={inputClass} placeholder="Your full name" />
        </div>
        <div>
          <label htmlFor="email" className={labelClass}>Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" inputMode="email"
            className={inputClass} placeholder="you@example.com"
            onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="password" className={labelClass}>Password</label>
          <div className="relative">
            <input id="password" name="password" type={show ? 'text' : 'password'} required minLength={6} autoComplete="new-password"
              className={`${inputClass} pr-12`} placeholder="At least 6 characters" aria-describedby="pw-hint" />
            <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
              className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-[10px] text-muted hover:text-ink">
              {show ? <EyeOff className="h-4 w-4" strokeWidth={1.75} /> : <Eye className="h-4 w-4" strokeWidth={1.75} />}
            </button>
          </div>
          <p id="pw-hint" className="mt-1.5 text-[12.5px] text-muted">At least 6 characters. A short phrase is easier to remember.</p>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="text-[13px] leading-relaxed text-muted">If you’re under 18, we’ll ask for a parent or guardian’s okay before saving your answers.</p>
        <button type="submit" disabled={pending} className={buttonClass('primary', 'lg', 'w-full')}>
          {pending ? (<><Spinner /> Creating account…</>) : 'Create account'}
        </button>
      </form>
      <p className="mt-8 border-t border-line pt-6 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-accent underline-offset-4 hover:underline">Sign in</Link>
      </p>
    </div>
  )
}

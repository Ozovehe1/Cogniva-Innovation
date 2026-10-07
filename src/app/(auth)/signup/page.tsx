'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, GraduationCap, Mail, Presentation } from 'lucide-react'
import { Alert, Spinner, buttonClass, cx, inputClass, labelClass } from '@/components/ui'


export default function SignupPage() {
  const [role, setRole] = useState<'student' | 'tutor' | null>(null)
  const [step, setStep] = useState<'role' | 'details'>('role')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!role) return
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
      setError(authError.message)
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
      window.location.href = role === 'student' ? '/assessment' : '/tutor/dashboard'
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

  if (step === 'role') {
    return (
      <div>
        <div className="mb-8">
          <p className="mb-2 text-[13px] font-medium text-muted">Step 1 of 2</p>
          <h1 className="font-display text-[34px] leading-tight text-ink">Create your account</h1>
          <p className="mt-2 text-[15px] text-muted">How will you use GeniusMap?</p>
        </div>
        <div role="radiogroup" aria-label="Account type" className="mb-6 space-y-3">
          {([
            { value: 'student', Icon: GraduationCap, title: 'I’m a student', desc: 'Take the assessment, see your profile and work on projects from your tutor.' },
            { value: 'tutor', Icon: Presentation, title: 'I’m a tutor', desc: 'Connect with students, view their profiles, and create and grade projects.' },
          ] as const).map(({ value, Icon, title, desc }) => {
            const on = role === value
            return (
              <button key={value} onClick={() => setRole(value)} type="button" role="radio" aria-checked={on}
                className={cx(
                  'flex w-full items-start gap-4 rounded-[12px] border bg-surface p-4 text-left transition-colors duration-150',
                  on ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-line-strong',
                )}>
                <span className={cx('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border', on ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-sunken text-ink-2')}>
                  <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-ink">{title}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-muted">{desc}</span>
                </span>
                <span className={cx('mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2', on ? 'border-accent' : 'border-line-strong')}>
                  {on && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}
                </span>
              </button>
            )
          })}
        </div>
        <button onClick={() => role && setStep('details')} disabled={!role} type="button" className={buttonClass('primary', 'lg', 'w-full')}>
          Continue
          <ArrowRight className="h-4 w-4" strokeWidth={2} />
        </button>
        <p className="mt-8 border-t border-line pt-6 text-center text-sm text-muted">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-accent underline-offset-4 hover:underline">Sign in</Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <button onClick={() => setStep('role')} type="button" className={buttonClass('ghost', 'sm', '-ml-3 mb-4')}>
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          Back
        </button>
        <p className="mb-2 text-[13px] font-medium text-muted">Step 2 of 2</p>
        <h1 className="font-display text-[34px] leading-tight text-ink">Your details</h1>
        <p className="mt-2 text-[15px] text-muted">
          Joining as a <span className="font-medium capitalize text-ink">{role}</span>.
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
          <input id="password" name="password" type="password" required minLength={6} autoComplete="new-password"
            className={inputClass} placeholder="At least 6 characters" />
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <button type="submit" disabled={pending} className={buttonClass('primary', 'lg', 'w-full')}>
          {pending ? (<><Spinner /> Creating account…</>) : 'Create account'}
        </button>
      </form>
    </div>
  )
}

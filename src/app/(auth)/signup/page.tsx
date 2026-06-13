'use client'
import { useState, useActionState } from 'react'
import { signupAction } from '@/app/actions/auth'
import Link from 'next/link'

const inputClass = "w-full px-4 py-3 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50 transition"
const inputStyle = { background: '#18181B', border: '1px solid rgba(255,255,255,0.1)' }

export default function SignupPage() {
  const [role, setRole] = useState<'student' | 'tutor' | null>(null)
  const [step, setStep] = useState<'role' | 'details'>('role')
  const [email, setEmail] = useState('')
  const [state, formAction, pending] = useActionState(signupAction, { error: '', confirmEmail: false })

  if (state.confirmEmail) {
    return (
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl mx-auto mb-6 flex items-center justify-center text-2xl" style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.2)' }}>
          ✉️
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Check your email</h1>
        <p className="text-zinc-500 text-sm mb-2">We sent a confirmation link to</p>
        <p className="text-violet-400 font-medium text-sm mb-6">{email}</p>
        <p className="text-zinc-600 text-xs">Click the link in the email to activate your account, then sign in.</p>
        <Link href="/login" className="mt-8 inline-block text-sm text-violet-400 hover:text-violet-300 transition">
          Go to Sign In →
        </Link>
      </div>
    )
  }

  if (step === 'role') {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Join GeniusMap</h1>
          <p className="text-zinc-500 text-sm">First, tell us how you&apos;ll use GeniusMap</p>
        </div>
        <div className="space-y-3 mb-6">
          {([
            { value: 'student', emoji: '🎓', title: "I'm a Student", desc: 'Discover my intelligence type and get a personalised learning path' },
            { value: 'tutor', emoji: '👨‍🏫', title: "I'm a Tutor", desc: 'Guide students, view their genius profiles, and assign custom projects' },
          ] as const).map(({ value, emoji, title, desc }) => (
            <button key={value} onClick={() => setRole(value)} type="button"
              className="w-full text-left p-4 rounded-xl transition"
              style={{
                background: role === value ? 'rgba(124,58,237,0.15)' : '#18181B',
                border: `1px solid ${role === value ? 'rgba(124,58,237,0.5)' : 'rgba(255,255,255,0.08)'}`,
              }}>
              <div className="flex items-center gap-3">
                <span className="text-2xl">{emoji}</span>
                <div>
                  <p className={`font-semibold text-sm ${role === value ? 'text-violet-300' : 'text-white'}`}>{title}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{desc}</p>
                </div>
                <div className="ml-auto">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${role === value ? 'border-violet-500 bg-violet-500' : 'border-zinc-600'}`}>
                    {role === value && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
        <button onClick={() => role && setStep('details')} disabled={!role} type="button"
          className="w-full py-3 rounded-xl text-sm font-semibold text-white transition disabled:opacity-40"
          style={{ background: '#7C3AED' }}>
          Continue →
        </button>
        <p className="text-center mt-4 text-sm text-zinc-500">
          Already have an account?{' '}
          <Link href="/login" className="text-violet-400 hover:text-violet-300 font-medium">Sign in</Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <button onClick={() => setStep('role')} className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 text-sm mb-4 transition" type="button">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-white mb-1">Create your account</h1>
        <p className="text-zinc-500 text-sm">
          Joining as a <span className="text-violet-400 font-medium capitalize">{role}</span>
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="role" value={role ?? ''} />
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Full Name</label>
          <input name="fullName" type="text" required
            className={inputClass} style={inputStyle} placeholder="Your full name" />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email</label>
          <input name="email" type="email" required
            className={inputClass} style={inputStyle} placeholder="you@example.com"
            onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Password</label>
          <input name="password" type="password" required minLength={6}
            className={inputClass} style={inputStyle} placeholder="Min. 6 characters" />
        </div>
        {state.error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-400" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <span>⚠</span> {state.error}
          </div>
        )}
        <button type="submit" disabled={pending}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50"
          style={{ background: '#7C3AED' }}>
          {pending ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-violet-300 border-t-white animate-spin" />
              Creating account...
            </span>
          ) : 'Create Account'}
        </button>
      </form>
    </div>
  )
}

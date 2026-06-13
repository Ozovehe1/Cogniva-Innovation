'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

const inputClass = "w-full px-4 py-3 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50 transition"
const inputStyle = { background: '#18181B', border: '1px solid rgba(255,255,255,0.1)' }

export default function LoginPage() {
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

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

    // Full-page navigation so the server layouts receive the fresh session cookie
    window.location.href = role === 'tutor' ? '/tutor/dashboard' : '/dashboard'
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Welcome back</h1>
        <p className="text-zinc-500 text-sm">Sign in to continue your genius journey</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email</label>
          <input name="email" type="email" required
            className={inputClass} style={inputStyle} placeholder="you@example.com" />
        </div>
        <div>
          <label className="text-xs font-medium text-zinc-400 mb-1.5 block">Password</label>
          <input name="password" type="password" required
            className={inputClass} style={inputStyle} placeholder="••••••••" />
        </div>
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-400" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <span>⚠</span> {error}
          </div>
        )}
        <button type="submit" disabled={pending}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50"
          style={{ background: pending ? '#6D28D9' : '#7C3AED' }}>
          {pending ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-violet-300 border-t-white animate-spin" />
              Signing in...
            </span>
          ) : 'Sign In'}
        </button>
      </form>

      <p className="text-center mt-6 text-sm text-zinc-500">
        No account?{' '}
        <Link href="/signup" className="text-violet-400 hover:text-violet-300 font-medium transition">Create one free</Link>
      </p>
    </div>
  )
}

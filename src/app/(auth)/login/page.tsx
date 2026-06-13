'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      if (signInError.message.toLowerCase().includes('email not confirmed')) {
        setError('Please confirm your email first — check your inbox for the confirmation link.')
      } else {
        setError(signInError.message)
      }
      setLoading(false)
      return
    }

    // Full page reload so server layouts receive fresh session cookies
    window.location.href = '/dashboard'
  }

  const inputClass = "w-full px-4 py-3 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50 transition"
  const inputStyle = { background: '#18181B', border: '1px solid rgba(255,255,255,0.1)' }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Welcome back</h1>
        <p className="text-zinc-500 text-sm">Sign in to continue your genius journey</p>
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
            className={inputClass} style={inputStyle} placeholder="you@example.com" />
        </div>
        <div>
          <label className="text-xs font-medium text-zinc-400 mb-1.5 block">Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
            className={inputClass} style={inputStyle} placeholder="••••••••" />
        </div>
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-400" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <span>⚠</span> {error}
          </div>
        )}
        <button type="submit" disabled={loading}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50"
          style={{ background: loading ? '#6D28D9' : '#7C3AED' }}>
          {loading ? (
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

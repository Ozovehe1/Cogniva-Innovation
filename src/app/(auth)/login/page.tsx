'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', data.user.id).single()
    if (profile?.role === 'tutor') router.push('/dashboard')
    else router.push('/dashboard')
  }

  return (
    <div className="bg-white/10 backdrop-blur rounded-2xl p-8 border border-white/20">
      <h2 className="text-2xl font-bold text-white mb-6">Welcome Back</h2>
      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label className="block text-purple-200 text-sm mb-1">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
            className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:border-purple-400"
            placeholder="you@example.com" />
        </div>
        <div>
          <label className="block text-purple-200 text-sm mb-1">Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
            className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:border-purple-400"
            placeholder="••••••••" />
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition disabled:opacity-50">
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
      <p className="text-purple-300 text-center mt-4 text-sm">
        No account? <Link href="/signup" className="text-purple-200 hover:text-white underline">Create one</Link>
      </p>
    </div>
  )
}

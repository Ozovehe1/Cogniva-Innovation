'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SignupPage() {
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'student' as 'student' | 'tutor' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { data, error: signUpError } = await supabase.auth.signUp({ email: form.email, password: form.password })
    if (signUpError || !data.user) { setError(signUpError?.message || 'Signup failed'); setLoading(false); return }
    const { error: profileError } = await supabase.from('profiles').insert({
      user_id: data.user.id, full_name: form.fullName, email: form.email, role: form.role
    })
    if (profileError) { setError(profileError.message); setLoading(false); return }
    router.push(form.role === 'student' ? '/assessment' : '/tutor/dashboard')
  }

  return (
    <div className="bg-white/10 backdrop-blur rounded-2xl p-8 border border-white/20">
      <h2 className="text-2xl font-bold text-white mb-6">Join GeniusMap</h2>
      <form onSubmit={handleSignup} className="space-y-4">
        <div>
          <label className="block text-purple-200 text-sm mb-1">Full Name</label>
          <input type="text" value={form.fullName} onChange={e => setForm({...form, fullName: e.target.value})} required
            className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:border-purple-400"
            placeholder="Your full name" />
        </div>
        <div>
          <label className="block text-purple-200 text-sm mb-1">Email</label>
          <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required
            className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:border-purple-400"
            placeholder="you@example.com" />
        </div>
        <div>
          <label className="block text-purple-200 text-sm mb-1">Password</label>
          <input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required
            className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:border-purple-400"
            placeholder="Min 6 characters" />
        </div>
        <div>
          <label className="block text-purple-200 text-sm mb-2">I am a...</label>
          <div className="grid grid-cols-2 gap-3">
            {(['student', 'tutor'] as const).map(role => (
              <button key={role} type="button" onClick={() => setForm({...form, role})}
                className={`py-3 rounded-xl border-2 font-semibold capitalize transition ${form.role === role ? 'border-purple-400 bg-purple-600 text-white' : 'border-white/20 text-purple-300 hover:border-purple-400'}`}>
                {role === 'student' ? '🎓 Student' : '👨‍🏫 Tutor'}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition disabled:opacity-50">
          {loading ? 'Creating account...' : 'Create Account'}
        </button>
      </form>
      <p className="text-purple-300 text-center mt-4 text-sm">
        Have an account? <Link href="/login" className="text-purple-200 hover:text-white underline">Sign in</Link>
      </p>
    </div>
  )
}

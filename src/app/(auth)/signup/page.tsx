'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SignupPage() {
  const [step, setStep] = useState<'role' | 'details'>('role')
  const [role, setRole] = useState<'student' | 'tutor' | null>(null)
  const [form, setForm] = useState({ fullName: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleGoogleSignup() {
    if (!role) return
    setGoogleLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?role=${role}`,
      },
    })
    if (error) { setError(error.message); setGoogleLoading(false) }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    if (!role) return
    setLoading(true)
    setError('')
    const { data, error: signUpError } = await supabase.auth.signUp({ email: form.email, password: form.password })
    if (signUpError || !data.user) { setError(signUpError?.message || 'Signup failed'); setLoading(false); return }
    const { error: profileError } = await supabase.from('profiles').insert({
      user_id: data.user.id, full_name: form.fullName, email: form.email, role,
    })
    if (profileError) { setError(profileError.message); setLoading(false); return }
    router.push(role === 'student' ? '/assessment' : '/tutor/dashboard')
    router.refresh()
  }

  const inputClass = "w-full px-4 py-3 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50 transition"
  const inputStyle = { background: '#18181B', border: '1px solid rgba(255,255,255,0.1)' }

  if (step === 'role') {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Join GeniusMap</h1>
          <p className="text-zinc-500 text-sm">First, tell us how you&apos;ll use GeniusMap</p>
        </div>
        <div className="space-y-3 mb-6">
          {([
            { value: 'student', emoji: '🎓', title: 'I\'m a Student', desc: 'Discover my intelligence type and get a personalised learning path' },
            { value: 'tutor', emoji: '👨‍🏫', title: 'I\'m a Tutor', desc: 'Guide students, view their genius profiles, and assign custom projects' },
          ] as const).map(({ value, emoji, title, desc }) => (
            <button key={value} onClick={() => setRole(value)}
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
        <button onClick={() => role && setStep('details')} disabled={!role}
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
        <button onClick={() => setStep('role')} className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 text-sm mb-4 transition">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-white mb-1">Create your account</h1>
        <p className="text-zinc-500 text-sm">
          Joining as a <span className="text-violet-400 font-medium capitalize">{role}</span>
        </p>
      </div>

      <button onClick={handleGoogleSignup} disabled={googleLoading}
        className="w-full flex items-center justify-center gap-3 py-3 rounded-xl text-sm font-medium text-white transition mb-4 disabled:opacity-50"
        style={{ background: '#18181B', border: '1px solid rgba(255,255,255,0.1)' }}>
        {googleLoading ? <span className="w-4 h-4 rounded-full border-2 border-zinc-600 border-t-white animate-spin" /> : (
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
        )}
        Continue with Google
      </button>

      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
        <span className="text-xs text-zinc-600">or</span>
        <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
      </div>

      <form onSubmit={handleSignup} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Full Name</label>
          <input type="text" value={form.fullName} onChange={e => setForm({...form, fullName: e.target.value})} required
            className={inputClass} style={inputStyle} placeholder="Your full name" />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email</label>
          <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required
            className={inputClass} style={inputStyle} placeholder="you@example.com" />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Password</label>
          <input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required minLength={6}
            className={inputClass} style={inputStyle} placeholder="Min. 6 characters" />
        </div>
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-400" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <span>⚠</span> {error}
          </div>
        )}
        <button type="submit" disabled={loading}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50"
          style={{ background: '#7C3AED' }}>
          {loading ? (
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

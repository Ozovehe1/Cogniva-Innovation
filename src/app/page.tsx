import Link from 'next/link'

const features = [
  {
    icon: '🧠',
    title: 'Intelligence Detection',
    desc: 'AI maps your unique genius across Howard Gardner\'s 8 intelligence types in under 5 minutes.',
    color: 'from-violet-500/10 to-purple-500/5',
    border: 'border-violet-500/20',
  },
  {
    icon: '🗺️',
    title: 'Personalised Learning Path',
    desc: 'Get a custom roadmap — study strategies, career paths, and mentor matches built for your mind.',
    color: 'from-blue-500/10 to-cyan-500/5',
    border: 'border-blue-500/20',
  },
  {
    icon: '📈',
    title: 'Dynamic Growth Tracking',
    desc: 'Earn XP, level up, and track your growth in real time as you complete tutor-assigned projects.',
    color: 'from-emerald-500/10 to-green-500/5',
    border: 'border-emerald-500/20',
  },
  {
    icon: '👨‍🏫',
    title: 'Personal Tutor Portal',
    desc: 'Dedicated tutors see each student\'s full intelligence profile and assign perfectly matched projects.',
    color: 'from-amber-500/10 to-yellow-500/5',
    border: 'border-amber-500/20',
  },
]

const stats = [
  { value: '8', label: 'Intelligence Types Detected' },
  { value: '89%', label: 'Students Underserved by Traditional Ed' },
  { value: '30%', label: 'Avg. Performance Improvement' },
  { value: '5min', label: 'To Discover Your Genius' },
]

export default function HomePage() {
  return (
    <div className="min-h-screen" style={{ background: '#09090B' }}>
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4" style={{ background: 'rgba(9,9,11,0.8)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center text-white text-sm font-bold">G</div>
          <span className="font-semibold text-white">GeniusMap</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm px-4 py-2 rounded-lg text-zinc-400 hover:text-white transition">Sign in</Link>
          <Link href="/signup" className="text-sm px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition">Get Started</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-24 px-8 text-center overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[600px] h-[600px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.15) 0%, transparent 70%)' }} />
        </div>
        <div className="relative max-w-4xl mx-auto">
          <h1 className="text-5xl md:text-7xl font-bold text-white leading-tight mb-6">
            Every Student is a<br />
            <span style={{ background: 'linear-gradient(135deg, #A78BFA 0%, #7C3AED 50%, #5B21B6 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Genius
            </span>
          </h1>
          <p className="text-xl text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            GeniusMap uses AI to detect your unique intelligence type and builds a fully personalised learning path, study strategy, and career direction — just for you.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link href="/signup" className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-lg transition shadow-lg shadow-violet-900/40">
              Discover Your Genius
              <span>→</span>
            </Link>
            <Link href="/login" className="inline-flex items-center gap-2 px-8 py-4 rounded-xl text-zinc-300 font-semibold text-lg transition" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="px-8 py-12 max-w-5xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map(({ value, label }) => (
            <div key={label} className="text-center p-6 rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="text-3xl font-bold text-white mb-1">{value}</p>
              <p className="text-xs text-zinc-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="px-8 py-16 max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-white mb-3">How GeniusMap Works</h2>
          <p className="text-zinc-500">Three stages. One mission. Unlock every student&apos;s potential.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {features.map(({ icon, title, desc, color, border }) => (
            <div key={title} className={`p-6 rounded-2xl bg-gradient-to-br ${color} border ${border} transition hover:scale-[1.01]`}>
              <div className="text-3xl mb-4">{icon}</div>
              <h3 className="text-white font-semibold text-lg mb-2">{title}</h3>
              <p className="text-zinc-400 text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Intelligence Types */}
      <section className="px-8 py-16 max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-white mb-3">8 Types of Genius</h2>
          <p className="text-zinc-500">Based on Howard Gardner&apos;s Theory of Multiple Intelligences (1983)</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { emoji: '📝', label: 'Linguistic', desc: 'Word Smart' },
            { emoji: '🔢', label: 'Logical', desc: 'Number Smart' },
            { emoji: '🎨', label: 'Spatial', desc: 'Picture Smart' },
            { emoji: '🎵', label: 'Musical', desc: 'Music Smart' },
            { emoji: '⚡', label: 'Kinesthetic', desc: 'Body Smart' },
            { emoji: '🤝', label: 'Interpersonal', desc: 'People Smart' },
            { emoji: '🧘', label: 'Intrapersonal', desc: 'Self Smart' },
            { emoji: '🌿', label: 'Naturalist', desc: 'Nature Smart' },
          ].map(({ emoji, label, desc }) => (
            <div key={label} className="p-4 rounded-xl text-center transition hover:border-violet-500/40" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="text-2xl mb-2">{emoji}</div>
              <p className="text-white text-sm font-medium">{label}</p>
              <p className="text-zinc-600 text-xs">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-8 py-20 text-center">
        <div className="max-w-2xl mx-auto p-10 rounded-3xl" style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.2) 0%, rgba(76,29,149,0.1) 100%)', border: '1px solid rgba(124,58,237,0.25)' }}>
          <h2 className="text-3xl font-bold text-white mb-3">Ready to Find Your Genius?</h2>
          <p className="text-zinc-400 mb-8">Join thousands of students discovering how they truly learn best.</p>
          <Link href="/signup" className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-lg transition">
            Start Free Assessment →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-8 py-8 text-center text-zinc-600 text-sm" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <p>© {new Date().getFullYear()} GeniusMap. All rights reserved.</p>
      </footer>
    </div>
  )
}

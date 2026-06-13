import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-purple-900 to-indigo-900 flex flex-col items-center justify-center p-8 text-center">
      <h1 className="text-6xl font-bold text-white mb-4">GeniusMap</h1>
      <p className="text-2xl text-purple-300 mb-3">AI-Powered Student Intelligence Detection</p>
      <p className="text-purple-400 italic mb-12 text-lg">&quot;Every Student is a Genius — AI Finds the Proof&quot;</p>
      <div className="flex gap-4">
        <Link href="/signup" className="px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition text-lg">
          Get Started
        </Link>
        <Link href="/login" className="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl transition border border-white/20 text-lg">
          Sign In
        </Link>
      </div>
      <div className="mt-20 grid grid-cols-3 gap-8 max-w-3xl text-left">
        {[
          { icon: '🧠', title: 'Intelligence Detection', desc: "AI identifies your unique genius type using Gardner's 8 intelligences" },
          { icon: '🗺️', title: 'Personalized Path', desc: 'Get a custom learning path, study tips, and career direction' },
          { icon: '📈', title: 'Dynamic Growth', desc: 'Track your progress as you complete tutor-assigned projects' },
        ].map(({ icon, title, desc }) => (
          <div key={title} className="bg-white/5 rounded-2xl p-6 border border-white/10">
            <div className="text-3xl mb-3">{icon}</div>
            <h3 className="text-white font-semibold mb-2">{title}</h3>
            <p className="text-purple-300 text-sm">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

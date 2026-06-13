import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const intelligenceLabels: Record<string, { label: string; emoji: string; color: string }> = {
  linguistic: { label: 'Linguistic', emoji: '📝', color: 'bg-blue-500' },
  logicalMathematical: { label: 'Logical-Math', emoji: '🔢', color: 'bg-green-500' },
  spatial: { label: 'Spatial', emoji: '🎨', color: 'bg-yellow-500' },
  musical: { label: 'Musical', emoji: '🎵', color: 'bg-pink-500' },
  bodilyKinesthetic: { label: 'Bodily-Kinesthetic', emoji: '⚡', color: 'bg-orange-500' },
  interpersonal: { label: 'Interpersonal', emoji: '🤝', color: 'bg-teal-500' },
  intrapersonal: { label: 'Intrapersonal', emoji: '🧘', color: 'bg-purple-500' },
  naturalist: { label: 'Naturalist', emoji: '🌿', color: 'bg-emerald-500' },
}

const levelColors: Record<string, string> = {
  Seed: 'text-gray-400', Sprout: 'text-green-400', Explorer: 'text-blue-400',
  Master: 'text-purple-400', Legend: 'text-yellow-400'
}

export default async function StudentDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
  const { data: intel } = await supabase.from('intelligence_profiles').select('*').eq('student_id', profile?.id).single()
  const { data: growth } = await supabase.from('student_growth').select('*').eq('student_id', profile?.id).single()

  if (!intel) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <div className="text-6xl mb-6">🧠</div>
        <h1 className="text-3xl font-bold text-white mb-3">Discover Your Genius</h1>
        <p className="text-gray-400 mb-8 max-w-md">You haven&apos;t taken the intelligence assessment yet. It takes about 5 minutes and will reveal your unique genius type.</p>
        <Link href="/assessment" className="px-8 py-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition">
          Start Assessment →
        </Link>
      </div>
    )
  }

  const scores = intel.intelligence_scores as Record<string, number>
  const dominant = intelligenceLabels[intel.dominant_intelligence]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Your GeniusMap</h1>
        <p className="text-gray-400 mt-1">Welcome back, {profile?.full_name}</p>
      </div>

      {/* Genius Statement */}
      <div className="bg-gradient-to-r from-purple-900 to-indigo-900 rounded-2xl p-6 border border-purple-700">
        <p className="text-purple-300 text-sm mb-2">Your Genius Statement</p>
        <p className="text-2xl font-bold text-white">{intel.genius_statement}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Intelligence Scores */}
        <div className="lg:col-span-2 bg-gray-900 rounded-2xl p-6 border border-gray-800">
          <h2 className="text-white font-semibold mb-4">Intelligence Profile</h2>
          <div className="space-y-3">
            {Object.entries(scores).sort((a,b) => b[1]-a[1]).map(([key, val]) => {
              const meta = intelligenceLabels[key]
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-lg w-6">{meta?.emoji}</span>
                  <span className="text-gray-400 text-sm w-36">{meta?.label}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-2">
                    <div className={`${meta?.color} h-2 rounded-full`} style={{ width: `${val * 10}%` }} />
                  </div>
                  <span className="text-gray-300 text-sm w-8">{val}/10</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Growth Card */}
        <div className="space-y-4">
          <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
            <h2 className="text-white font-semibold mb-3">Growth</h2>
            <div className={`text-3xl font-bold ${levelColors[growth?.level || 'Seed']}`}>{growth?.level || 'Seed'}</div>
            <div className="mt-3 bg-gray-800 rounded-full h-2">
              <div className="bg-green-500 h-2 rounded-full" style={{ width: `${growth?.growth_score || 0}%` }} />
            </div>
            <p className="text-gray-500 text-sm mt-2">{growth?.projects_completed || 0} / {growth?.projects_total || 0} projects done</p>
          </div>
          <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800 text-center">
            <div className="text-4xl mb-2">{dominant?.emoji}</div>
            <p className="text-purple-400 text-sm">Dominant Intelligence</p>
            <p className="text-white font-bold mt-1">{dominant?.label}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Learning Path */}
        <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
          <h2 className="text-white font-semibold mb-4">Learning Path</h2>
          <ul className="space-y-2">
            {(intel.learning_path as string[]).map((item, i) => (
              <li key={i} className="flex gap-2 text-gray-300 text-sm">
                <span className="text-purple-400 font-bold">{i+1}.</span> {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Career Suggestions */}
        <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
          <h2 className="text-white font-semibold mb-4">Career Paths</h2>
          <ul className="space-y-2">
            {(intel.career_suggestions as string[]).map((item, i) => (
              <li key={i} className="text-gray-300 text-sm py-1 border-b border-gray-800 last:border-0">{item}</li>
            ))}
          </ul>
        </div>

        {/* Study Tips */}
        <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
          <h2 className="text-white font-semibold mb-4">Study Tips</h2>
          <ul className="space-y-2">
            {(intel.study_tips as string[]).map((item, i) => (
              <li key={i} className="flex gap-2 text-gray-300 text-sm">
                <span className="text-green-400">✓</span> {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

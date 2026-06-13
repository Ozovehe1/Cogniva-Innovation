import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const intelligenceMeta: Record<string, { label: string; emoji: string; hex: string }> = {
  linguistic: { label: 'Linguistic', emoji: '📝', hex: '#3B82F6' },
  logicalMathematical: { label: 'Logical-Math', emoji: '🔢', hex: '#22C55E' },
  spatial: { label: 'Spatial', emoji: '🎨', hex: '#EAB308' },
  musical: { label: 'Musical', emoji: '🎵', hex: '#EC4899' },
  bodilyKinesthetic: { label: 'Kinesthetic', emoji: '⚡', hex: '#F97316' },
  interpersonal: { label: 'Interpersonal', emoji: '🤝', hex: '#14B8A6' },
  intrapersonal: { label: 'Intrapersonal', emoji: '🧘', hex: '#8B5CF6' },
  naturalist: { label: 'Naturalist', emoji: '🌿', hex: '#10B981' },
}

const levelConfig: Record<string, { color: string; bg: string; next: string; xpNeeded: number }> = {
  Seed: { color: '#71717A', bg: 'rgba(113,113,122,0.1)', next: 'Sprout', xpNeeded: 2 },
  Sprout: { color: '#22C55E', bg: 'rgba(34,197,94,0.1)', next: 'Explorer', xpNeeded: 5 },
  Explorer: { color: '#3B82F6', bg: 'rgba(59,130,246,0.1)', next: 'Master', xpNeeded: 10 },
  Master: { color: '#8B5CF6', bg: 'rgba(139,92,246,0.1)', next: 'Legend', xpNeeded: 20 },
  Legend: { color: '#F59E0B', bg: 'rgba(245,158,11,0.1)', next: 'Legend', xpNeeded: 20 },
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
      <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
        <div className="w-20 h-20 rounded-2xl mb-6 flex items-center justify-center text-4xl" style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.25)' }}>
          🧠
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Discover Your Genius</h1>
        <p className="text-zinc-500 text-sm max-w-sm mb-8 leading-relaxed">
          Complete the 5-minute intelligence assessment and let AI map your unique genius type across Gardner&apos;s 8 intelligences.
        </p>
        <Link href="/assessment"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white transition"
          style={{ background: '#7C3AED' }}>
          Start Assessment →
        </Link>
      </div>
    )
  }

  const scores = intel.intelligence_scores as Record<string, number>
  const sortedScores = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const dominant = intelligenceMeta[intel.dominant_intelligence]
  const level = growth?.level || 'Seed'
  const levelData = levelConfig[level] || levelConfig['Seed']
  const completedProjects = growth?.projects_completed || 0
  const totalProjects = growth?.projects_total || 0
  const growthPct = growth?.growth_score || 0

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Your GeniusMap</h1>
        <p className="text-zinc-500 text-sm mt-0.5">Good to see you, {profile?.full_name?.split(' ')[0]}</p>
      </div>

      {/* Genius Statement Banner */}
      <div className="relative p-5 rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.2) 0%, rgba(91,33,182,0.1) 100%)', border: '1px solid rgba(124,58,237,0.25)' }}>
        <div className="absolute top-0 right-0 text-6xl opacity-10 pointer-events-none p-4">{dominant?.emoji}</div>
        <p className="text-xs text-violet-400 font-medium mb-1 uppercase tracking-wider">Your Genius Statement</p>
        <p className="text-white font-semibold text-lg leading-snug">{intel.genius_statement}</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: 'Dominant Intelligence',
            value: dominant?.label || '—',
            sub: 'Primary strength',
            icon: dominant?.emoji || '🧠',
            color: '#8B5CF6',
          },
          {
            label: 'Growth Level',
            value: level,
            sub: `${completedProjects} projects done`,
            icon: '📈',
            color: levelData.color,
          },
          {
            label: 'Completion Rate',
            value: totalProjects > 0 ? `${growthPct}%` : '—',
            sub: `${completedProjects}/${totalProjects} projects`,
            icon: '✓',
            color: '#22C55E',
          },
          {
            label: 'Assessment',
            value: 'Complete',
            sub: 'Genius identified',
            icon: '⚡',
            color: '#F59E0B',
          },
        ].map(({ label, value, sub, icon, color }) => (
          <div key={label} className="p-4 rounded-xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-zinc-500">{label}</span>
              <span className="text-base">{icon}</span>
            </div>
            <p className="text-lg font-bold" style={{ color }}>{value}</p>
            <p className="text-xs text-zinc-600 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Intelligence Profile */}
        <div className="lg:col-span-2 p-6 rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 className="text-white font-semibold mb-5">Intelligence Profile</h2>
          <div className="space-y-3">
            {sortedScores.map(([key, val]) => {
              const meta = intelligenceMeta[key]
              const pct = val * 10
              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{meta?.emoji}</span>
                      <span className="text-xs text-zinc-400">{meta?.label}</span>
                    </div>
                    <span className="text-xs font-medium" style={{ color: meta?.hex }}>{val}/10</span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: meta?.hex }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          {/* Level Card */}
          <div className="p-5 rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-semibold text-sm">Growth Level</h3>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: levelData.bg, color: levelData.color }}>{level}</span>
            </div>
            <div className="h-1.5 rounded-full mb-2" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div className="h-1.5 rounded-full transition-all" style={{ width: `${Math.min((completedProjects / levelData.xpNeeded) * 100, 100)}%`, background: levelData.color }} />
            </div>
            <p className="text-xs text-zinc-600">{completedProjects} / {levelData.xpNeeded} projects to next level</p>
          </div>

          {/* Study Tips */}
          <div className="p-5 rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
            <h3 className="text-white font-semibold text-sm mb-3">Study Tips</h3>
            <ul className="space-y-2">
              {(intel.study_tips as string[]).slice(0, 3).map((tip, i) => (
                <li key={i} className="flex gap-2 text-xs text-zinc-400">
                  <span className="text-emerald-500 mt-0.5 flex-shrink-0">✓</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Learning Path + Careers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-6 rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 className="text-white font-semibold mb-4 text-sm">Learning Path</h2>
          <ol className="space-y-3">
            {(intel.learning_path as string[]).map((item, i) => (
              <li key={i} className="flex gap-3 text-xs">
                <span className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold" style={{ background: 'rgba(124,58,237,0.2)', color: '#A78BFA' }}>{i + 1}</span>
                <span className="text-zinc-400 leading-relaxed pt-0.5">{item}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="p-6 rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 className="text-white font-semibold mb-4 text-sm">Career Paths</h2>
          <ul className="space-y-2">
            {(intel.career_suggestions as string[]).map((item, i) => (
              <li key={i} className="flex items-center gap-3 py-2" style={{ borderBottom: i < (intel.career_suggestions as string[]).length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#7C3AED' }} />
                <span className="text-xs text-zinc-400">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

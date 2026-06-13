import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const intelligenceMeta: Record<string, { label: string; emoji: string; hex: string }> = {
  linguistic:          { label: 'Linguistic',    emoji: '📖', hex: '#3B82F6' },
  logicalMathematical: { label: 'Logical-Math',  emoji: '🔢', hex: '#22C55E' },
  spatial:             { label: 'Spatial',        emoji: '🗺️', hex: '#EAB308' },
  musical:             { label: 'Musical',        emoji: '🎵', hex: '#EC4899' },
  bodilyKinesthetic:   { label: 'Kinesthetic',   emoji: '🏃', hex: '#F97316' },
  interpersonal:       { label: 'Interpersonal',  emoji: '🤝', hex: '#14B8A6' },
  intrapersonal:       { label: 'Intrapersonal',  emoji: '🧘', hex: '#8B5CF6' },
  naturalist:          { label: 'Naturalist',     emoji: '🌿', hex: '#10B981' },
}

const levelConfig: Record<string, { color: string; bg: string; next: string; xpNeeded: number }> = {
  Seed:     { color: '#71717A', bg: 'rgba(113,113,122,0.1)', next: 'Sprout',   xpNeeded: 2  },
  Sprout:   { color: '#22C55E', bg: 'rgba(34,197,94,0.1)',   next: 'Explorer', xpNeeded: 5  },
  Explorer: { color: '#3B82F6', bg: 'rgba(59,130,246,0.1)',  next: 'Master',   xpNeeded: 10 },
  Master:   { color: '#8B5CF6', bg: 'rgba(139,92,246,0.1)', next: 'Legend',   xpNeeded: 20 },
  Legend:   { color: '#F59E0B', bg: 'rgba(245,158,11,0.1)', next: 'Legend',   xpNeeded: 20 },
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  assigned:       { label: 'Assigned',     color: '#F59E0B', bg: 'rgba(245,158,11,0.1)'  },
  in_progress:    { label: 'In Progress',  color: '#3B82F6', bg: 'rgba(59,130,246,0.1)'  },
  pending_review: { label: 'Under Review', color: '#A78BFA', bg: 'rgba(124,58,237,0.1)'  },
  completed:      { label: 'Approved',     color: '#22C55E', bg: 'rgba(34,197,94,0.1)'   },
}

export default async function StudentDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()

  const [{ data: intel }, { data: growth }, { data: assignments }] = await Promise.all([
    supabase.from('intelligence_profiles').select('*').eq('student_id', profile?.id).single(),
    supabase.from('student_growth').select('*').eq('student_id', profile?.id).single(),
    supabase.from('project_assignments')
      .select('*, project:projects(title, subject, difficulty, estimated_hours)')
      .eq('student_id', profile?.id)
      .order('created_at', { ascending: false }),
  ])

  const level = growth?.level || 'Seed'
  const levelData = levelConfig[level] || levelConfig['Seed']
  const completedProjects = growth?.projects_completed || 0
  const totalProjects = growth?.projects_total || 0
  const progressPct = totalProjects > 0 ? Math.round((completedProjects / totalProjects) * 100) : 0
  const toNextLevel = Math.max(0, levelData.xpNeeded - completedProjects)

  const activeProjects = (assignments || []).filter(a => a.status !== 'completed')
  const completedList = (assignments || []).filter(a => a.status === 'completed')

  if (!intel) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
        <div className="w-20 h-20 rounded-2xl mb-6 flex items-center justify-center text-4xl" style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.25)' }}>
          🧠
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Discover Your Genius</h1>
        <p className="text-zinc-500 text-sm max-w-sm mb-8 leading-relaxed">
          Complete the 5-minute intelligence assessment and let AI map your unique genius type.
        </p>
        <Link href="/assessment" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white transition" style={{ background: '#7C3AED' }}>
          Start Assessment →
        </Link>
      </div>
    )
  }

  const scores = intel.intelligence_scores as Record<string, number>
  const sortedScores = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const dominant = intelligenceMeta[intel.dominant_intelligence]

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-zinc-500 text-sm mt-0.5">Welcome back, {profile?.full_name?.split(' ')[0]}</p>
      </div>

      {/* ── TOP ROW: Level + Progress bar ── */}
      <div className="p-5 rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl font-bold" style={{ color: levelData.color }}>{level}</span>
              {level !== 'Legend' && (
                <span className="text-xs text-zinc-600">→ {levelData.next}</span>
              )}
            </div>
            <p className="text-zinc-500 text-sm">
              {completedProjects} project{completedProjects !== 1 ? 's' : ''} approved
              {totalProjects > 0 && <span className="text-zinc-600"> out of {totalProjects} assigned</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold" style={{ color: levelData.color }}>{progressPct}%</p>
            <p className="text-zinc-600 text-xs">overall completion</p>
          </div>
        </div>

        {/* Full-width progress bar */}
        <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${Math.min((completedProjects / Math.max(levelData.xpNeeded, 1)) * 100, 100)}%`, background: levelData.color }} />
        </div>
        {level !== 'Legend' && (
          <p className="text-xs text-zinc-600">{toNextLevel} more approval{toNextLevel !== 1 ? 's' : ''} to reach {levelData.next}</p>
        )}
      </div>

      {/* ── ACTIVE PROJECTS ── */}
      <div className="p-5 rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold text-sm">Active Projects</h2>
          <Link href="/projects" className="text-xs font-medium transition" style={{ color: '#A78BFA' }}>View all →</Link>
        </div>

        {activeProjects.length === 0 ? (
          <div className="py-6 text-center">
            {totalProjects === 0 ? (
              <p className="text-zinc-500 text-sm">No projects yet — connect to a tutor to get started</p>
            ) : (
              <p className="text-emerald-400 text-sm font-medium">All projects completed! Ask your tutor for more.</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {activeProjects.map(a => {
              const sc = statusConfig[a.status] || statusConfig.assigned
              return (
                <div key={a.id} className="flex items-center justify-between gap-3 p-3 rounded-xl" style={{ background: '#18181B' }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{a.project?.title}</p>
                    <p className="text-zinc-600 text-xs mt-0.5">{a.project?.subject} · {a.project?.estimated_hours}h</p>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0" style={{ background: sc.bg, color: sc.color }}>{sc.label}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── COMPLETED PROJECTS: what was gained ── */}
      {completedList.length > 0 && (
        <div className="p-5 rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 className="text-white font-semibold text-sm mb-4">Completed Projects</h2>
          <div className="space-y-3">
            {completedList.map(a => (
              <div key={a.id} className="flex items-center gap-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(34,197,94,0.15)' }}>
                  <span className="text-emerald-500 text-xs">✓</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">{a.project?.title}</p>
                  <p className="text-zinc-600 text-xs mt-0.5">{a.project?.subject}</p>
                </div>
                <span className="text-xs text-emerald-600 font-medium flex-shrink-0">Approved</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── INTELLIGENCE PROFILE (bottom — evolves with projects) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 p-6 rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 className="text-white font-semibold text-sm mb-5">Intelligence Profile</h2>
          <div className="space-y-3">
            {sortedScores.map(([key, val]) => {
              const meta = intelligenceMeta[key]
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
                    <div className="h-1.5 rounded-full transition-all" style={{ width: `${val * 10}%`, background: meta?.hex }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="space-y-4">
          {/* Genius statement */}
          <div className="relative p-5 rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(91,33,182,0.08) 100%)', border: '1px solid rgba(124,58,237,0.2)' }}>
            <div className="absolute top-0 right-0 text-5xl opacity-10 pointer-events-none p-3">{dominant?.emoji}</div>
            <p className="text-xs font-medium mb-2 uppercase tracking-wider" style={{ color: '#A78BFA' }}>Your Genius</p>
            <p className="text-white text-sm font-semibold leading-snug">{intel.genius_statement}</p>
          </div>

          {/* Study tips */}
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
    </div>
  )
}

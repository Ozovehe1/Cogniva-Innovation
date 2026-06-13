import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const intelligenceMeta: Record<string, { label: string; emoji: string; hex: string }> = {
  linguistic:          { label: 'Linguistic',   emoji: '📖', hex: '#3B82F6' },
  logicalMathematical: { label: 'Logical-Math', emoji: '🔢', hex: '#22C55E' },
  spatial:             { label: 'Spatial',       emoji: '🗺️', hex: '#EAB308' },
  musical:             { label: 'Musical',       emoji: '🎵', hex: '#EC4899' },
  bodilyKinesthetic:   { label: 'Kinesthetic',  emoji: '🏃', hex: '#F97316' },
  interpersonal:       { label: 'Interpersonal', emoji: '🤝', hex: '#14B8A6' },
  intrapersonal:       { label: 'Intrapersonal', emoji: '🧘', hex: '#8B5CF6' },
  naturalist:          { label: 'Naturalist',    emoji: '🌿', hex: '#10B981' },
}

const levelColor: Record<string, string> = {
  Seed: '#71717A', Sprout: '#22C55E', Explorer: '#3B82F6', Master: '#8B5CF6', Legend: '#F59E0B',
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  assigned:       { label: 'Assigned',      color: '#F59E0B', bg: 'rgba(245,158,11,0.1)'  },
  in_progress:    { label: 'In Progress',   color: '#3B82F6', bg: 'rgba(59,130,246,0.1)'  },
  pending_review: { label: 'Under Review',  color: '#A78BFA', bg: 'rgba(124,58,237,0.1)'  },
  completed:      { label: 'Approved',      color: '#22C55E', bg: 'rgba(34,197,94,0.1)'   },
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

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there'

  if (!intel) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-sm mx-auto">
        <div className="w-16 h-16 rounded-2xl mb-5 flex items-center justify-center text-3xl"
          style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.2)' }}>
          🧠
        </div>
        <h1 className="text-xl font-semibold text-white mb-2">Discover Your Genius</h1>
        <p className="text-zinc-500 text-sm mb-7 leading-relaxed">
          Take the 5-minute intelligence assessment and let AI map your unique learning profile.
        </p>
        <Link href="/assessment"
          className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
          style={{ background: '#7C3AED' }}>
          Start Assessment →
        </Link>
      </div>
    )
  }

  const level = growth?.level || 'Seed'
  const sublevel = (growth as { sublevel?: number } | null)?.sublevel || 1
  const avgScore = (growth as { average_score?: number } | null)?.average_score || 0
  const completedProjects = growth?.projects_completed || 0
  const totalProjects = growth?.projects_total || 0
  const overallPct = Math.min(Math.round((completedProjects / 45) * 100), 100)
  const lc = levelColor[level] || levelColor['Seed']

  const activeProjects = (assignments || []).filter(a => a.status !== 'completed')
  const completedList = (assignments || []).filter(a => a.status === 'completed')

  const scores = intel.intelligence_scores as Record<string, number>
  const sortedScores = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const dominant = intelligenceMeta[intel.dominant_intelligence]

  return (
    <div className="max-w-3xl space-y-8">

      {/* ── HEADER ── */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-zinc-500 text-sm mb-0.5">Welcome back</p>
          <h1 className="text-2xl font-bold text-white">{firstName}</h1>
        </div>
        <div className="flex items-center gap-2 pb-0.5">
          <span className="text-sm font-semibold" style={{ color: lc }}>{level}</span>
          <span className="text-zinc-700">·</span>
          <span className="text-zinc-500 text-sm">sublevel {sublevel}/9</span>
          {avgScore > 0 && (
            <>
              <span className="text-zinc-700">·</span>
              <span className="text-sm font-medium"
                style={{ color: avgScore >= 8 ? '#22C55E' : avgScore >= 6 ? '#F59E0B' : '#EF4444' }}>
                {avgScore.toFixed(1)} avg
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── PROGRESS BAR ── */}
      <div>
        <div className="flex justify-between text-xs mb-2" style={{ color: '#3F3F46' }}>
          <span>{completedProjects} of 45 stages complete</span>
          <span style={{ color: lc }}>{overallPct}%</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${overallPct}%`, background: lc }} />
        </div>
      </div>

      {/* ── PROJECTS ── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold">Projects</h2>
          {totalProjects > 0 && (
            <Link href="/projects" className="text-xs font-medium" style={{ color: '#52525B' }}>
              View all →
            </Link>
          )}
        </div>

        {totalProjects === 0 ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: '#111113', border: '1px dashed rgba(255,255,255,0.08)' }}>
            <p className="text-white text-sm font-medium mb-1">No projects yet</p>
            <p className="text-zinc-600 text-xs mb-4 leading-relaxed">
              Your tutor assigns projects after you connect. Share your tutor's ID on the Projects page to get started.
            </p>
            <Link href="/projects"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white"
              style={{ background: '#7C3AED' }}>
              Connect to a Tutor →
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
            {activeProjects.length === 0 ? (
              <div className="px-5 py-4 text-center" style={{ background: '#111113' }}>
                <p className="text-emerald-500 text-sm font-medium">All caught up — ask your tutor for more</p>
              </div>
            ) : (
              activeProjects.map((a, i) => {
                const sc = statusConfig[a.status] || statusConfig.assigned
                return (
                  <div key={a.id}
                    className="flex items-center justify-between gap-4 px-5 py-4"
                    style={{
                      background: '#111113',
                      borderBottom: i < activeProjects.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined,
                    }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{a.project?.title}</p>
                      <p className="text-zinc-600 text-xs mt-0.5">{a.project?.subject} · {a.project?.estimated_hours}h</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                      style={{ background: sc.bg, color: sc.color }}>
                      {sc.label}
                    </span>
                  </div>
                )
              })
            )}

            {completedList.length > 0 && (
              <div className="px-5 py-3 flex items-center justify-between"
                style={{ background: 'rgba(34,197,94,0.04)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <span className="text-xs text-zinc-600">{completedList.length} completed</span>
                <Link href="/projects" className="text-xs font-medium" style={{ color: '#22C55E' }}>
                  See completed →
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── INTELLIGENCE ── */}
      <div>
        <h2 className="text-white font-semibold mb-4">Intelligence Profile</h2>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* Bars */}
          <div className="lg:col-span-3 rounded-2xl p-5 space-y-2.5"
            style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
            {sortedScores.map(([key, val]) => {
              const meta = intelligenceMeta[key]
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-xs w-20 text-zinc-500 flex-shrink-0">{meta?.label}</span>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <div className="h-full rounded-full" style={{ width: `${val * 10}%`, background: meta?.hex }} />
                  </div>
                  <span className="text-xs w-6 text-right flex-shrink-0" style={{ color: meta?.hex }}>{val}</span>
                </div>
              )
            })}
          </div>

          {/* Genius + tip */}
          <div className="lg:col-span-2 space-y-3">
            <div className="relative rounded-2xl p-5 overflow-hidden"
              style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.15)' }}>
              <div className="absolute top-2 right-3 text-4xl opacity-10 pointer-events-none">{dominant?.emoji}</div>
              <p className="text-xs uppercase tracking-wider mb-2" style={{ color: '#7C3AED' }}>Your Genius</p>
              <p className="text-white text-sm font-medium leading-snug">{intel.genius_statement}</p>
            </div>

            <div className="rounded-2xl p-5"
              style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
              <p className="text-xs text-zinc-600 uppercase tracking-wider mb-3">Study Tips</p>
              <ul className="space-y-2">
                {(intel.study_tips as string[]).slice(0, 3).map((tip, i) => (
                  <li key={i} className="flex gap-2 text-xs text-zinc-500 leading-relaxed">
                    <span className="text-emerald-600 flex-shrink-0 mt-0.5">—</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          </div>

        </div>
      </div>

    </div>
  )
}

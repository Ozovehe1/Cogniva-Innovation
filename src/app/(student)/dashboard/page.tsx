import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const intelligenceMeta: Record<string, { label: string; hex: string }> = {
  linguistic:          { label: 'Linguistic',   hex: '#3B82F6' },
  logicalMathematical: { label: 'Logical-Math', hex: '#22C55E' },
  spatial:             { label: 'Spatial',       hex: '#EAB308' },
  musical:             { label: 'Musical',       hex: '#EC4899' },
  bodilyKinesthetic:   { label: 'Kinesthetic',  hex: '#F97316' },
  interpersonal:       { label: 'Interpersonal', hex: '#14B8A6' },
  intrapersonal:       { label: 'Intrapersonal', hex: '#8B5CF6' },
  naturalist:          { label: 'Naturalist',    hex: '#10B981' },
}

const levelColor: Record<string, string> = {
  Seed: '#52525B', Sprout: '#22C55E', Explorer: '#3B82F6', Master: '#8B5CF6', Legend: '#F59E0B',
}

const statusConfig: Record<string, { label: string; color: string; dot: string }> = {
  assigned:       { label: 'Assigned',     color: '#A16207', dot: '#CA8A04' },
  in_progress:    { label: 'In Progress',  color: '#1D4ED8', dot: '#3B82F6' },
  pending_review: { label: 'Under Review', color: '#6D28D9', dot: '#A78BFA' },
  completed:      { label: 'Approved',     color: '#166534', dot: '#22C55E' },
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
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center" style={{ maxWidth: 380, margin: '0 auto' }}>
        <div className="w-12 h-12 rounded-xl mb-5 flex items-center justify-center"
          style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.15)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a4 4 0 0 1 4 4c0 .34-.04.67-.1 1A4 4 0 0 1 20 11a4 4 0 0 1-2 3.46V20a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-5.54A4 4 0 0 1 4 11a4 4 0 0 1 4.1-4A4 4 0 0 1 12 2z"/>
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-white mb-2">Discover Your Genius</h1>
        <p className="text-sm mb-7 leading-relaxed" style={{ color: '#52525B' }}>
          Take the 8-minute assessment and let AI map your unique intelligence profile.
        </p>
        <Link href="/assessment" className="px-4 py-2 rounded-lg text-sm font-medium text-white"
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
  const top3 = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 3)

  return (
    <div style={{ maxWidth: 1100 }}>

      {/* Page header */}
      <div className="mb-7">
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: '#3F3F46' }}>Dashboard</p>
        <h1 className="text-2xl font-bold text-white">{firstName}</h1>
      </div>

      {/* 2-column layout on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* ── LEFT: Projects ── */}
        <div className="lg:col-span-3 space-y-5">

          {/* Progress bar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs" style={{ color: '#3F3F46' }}>
                {completedProjects} of 45 stages — <span style={{ color: lc }}>{level}</span> {sublevel}/9
              </span>
              <span className="text-xs font-medium tabular-nums" style={{ color: lc }}>{overallPct}%</span>
            </div>
            <div className="h-px rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${overallPct}%`, background: lc }} />
            </div>
          </div>

          {/* Projects */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs uppercase tracking-widest" style={{ color: '#3F3F46' }}>Projects</p>
              {totalProjects > 0 && (
                <Link href="/projects" className="text-xs transition" style={{ color: '#3F3F46' }}>
                  View all →
                </Link>
              )}
            </div>

            {totalProjects === 0 ? (
              <div className="rounded-xl p-6 text-center" style={{ border: '1px dashed rgba(255,255,255,0.06)' }}>
                <p className="text-sm font-medium text-white mb-1">No projects yet</p>
                <p className="text-xs mb-4 leading-relaxed" style={{ color: '#3F3F46' }}>
                  Your tutor assigns projects after you connect. Share your tutor's code on the Projects page.
                </p>
                <Link href="/projects" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-white"
                  style={{ background: '#7C3AED' }}>
                  Connect to a tutor →
                </Link>
              </div>
            ) : (
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                {activeProjects.length === 0 ? (
                  <div className="px-5 py-4" style={{ background: '#111113' }}>
                    <p className="text-xs" style={{ color: '#22C55E' }}>All caught up — ask your tutor for more projects</p>
                  </div>
                ) : (
                  activeProjects.map((a, i) => {
                    const sc = statusConfig[a.status] || statusConfig.assigned
                    return (
                      <div key={a.id} className="flex items-center gap-4 px-5 py-3.5"
                        style={{
                          background: '#111113',
                          borderBottom: i < activeProjects.length - 1 ? '1px solid rgba(255,255,255,0.04)' : undefined,
                        }}>
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: sc.dot }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white font-medium truncate">{a.project?.title}</p>
                          <p className="text-xs mt-0.5" style={{ color: '#3F3F46' }}>
                            {a.project?.subject} · {a.project?.estimated_hours}h
                          </p>
                        </div>
                        <span className="text-xs flex-shrink-0" style={{ color: sc.dot }}>{sc.label}</span>
                      </div>
                    )
                  })
                )}
                {completedList.length > 0 && (
                  <div className="flex items-center justify-between px-5 py-2.5"
                    style={{ background: 'rgba(34,197,94,0.03)', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    <span className="text-xs" style={{ color: '#3F3F46' }}>{completedList.length} completed</span>
                    <Link href="/projects" className="text-xs" style={{ color: '#166534' }}>See all →</Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Profile sidebar ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Level card */}
          <div className="rounded-xl p-5" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-xs uppercase tracking-widest mb-4" style={{ color: '#3F3F46' }}>Progress</p>
            <div className="flex items-end justify-between mb-4">
              <div>
                <p className="text-2xl font-bold" style={{ color: lc }}>{level}</p>
                <p className="text-xs mt-0.5" style={{ color: '#3F3F46' }}>Sublevel {sublevel} of 9</p>
              </div>
              {avgScore > 0 && (
                <div className="text-right">
                  <p className="text-xl font-bold"
                    style={{ color: avgScore >= 8 ? '#22C55E' : avgScore >= 6 ? '#F59E0B' : '#EF4444' }}>
                    {avgScore.toFixed(1)}
                  </p>
                  <p className="text-xs" style={{ color: '#3F3F46' }}>avg grade</p>
                </div>
              )}
            </div>
            <div className="h-px rounded-full mb-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="h-full rounded-full transition-all"
                style={{ width: `${(sublevel / 9) * 100}%`, background: lc }} />
            </div>
            <p className="text-xs" style={{ color: '#3F3F46' }}>{completedProjects} projects approved</p>
          </div>

          {/* Top intelligences */}
          <div className="rounded-xl p-5" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-xs uppercase tracking-widest mb-4" style={{ color: '#3F3F46' }}>Top intelligences</p>
            <div className="space-y-3">
              {top3.map(([key, val], rank) => {
                const meta = intelligenceMeta[key]
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono" style={{ color: '#3F3F46' }}>0{rank + 1}</span>
                        <span className="text-sm text-white">{meta?.label}</span>
                      </div>
                      <span className="text-xs tabular-nums" style={{ color: meta?.hex }}>{val}/10</span>
                    </div>
                    <div className="h-px rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <div className="h-full rounded-full" style={{ width: `${val * 10}%`, background: `${meta?.hex}88` }} />
                    </div>
                  </div>
                )
              })}
            </div>
            <Link href="/assessment" className="block mt-4 text-xs" style={{ color: '#3F3F46' }}>
              View full profile →
            </Link>
          </div>

          {/* Genius statement */}
          <div className="rounded-xl p-5" style={{ background: 'rgba(124,58,237,0.05)', border: '1px solid rgba(124,58,237,0.1)' }}>
            <p className="text-xs uppercase tracking-widest mb-2" style={{ color: '#6D28D9' }}>Your genius</p>
            <p className="text-sm leading-relaxed" style={{ color: '#C4B5FD' }}>{intel.genius_statement}</p>
          </div>

        </div>
      </div>
    </div>
  )
}

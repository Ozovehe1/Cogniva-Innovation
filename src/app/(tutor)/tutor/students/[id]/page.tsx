import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { AssignProject } from '@/components/assign-project'
import { TutorProjectActions } from '@/components/tutor-project-actions'

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

const levelConfig: Record<string, { color: string; bg: string }> = {
  Seed: { color: '#71717A', bg: 'rgba(113,113,122,0.1)' },
  Sprout: { color: '#22C55E', bg: 'rgba(34,197,94,0.1)' },
  Explorer: { color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
  Master: { color: '#8B5CF6', bg: 'rgba(139,92,246,0.1)' },
  Legend: { color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  assigned:       { label: 'Assigned',     color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  in_progress:    { label: 'In Progress',  color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
  pending_review: { label: 'Needs Review', color: '#A78BFA', bg: 'rgba(124,58,237,0.15)' },
  completed:      { label: 'Completed',    color: '#22C55E', bg: 'rgba(34,197,94,0.1)' },
}

export default async function StudentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: tutorProfile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
  const { data: isLinked } = await supabase.from('tutor_students').select('id').eq('tutor_id', tutorProfile?.id).eq('student_id', id).single()
  if (!isLinked) notFound()

  const [{ data: student }, { data: intel }, { data: growth }, { data: assignments }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', id).single(),
    supabase.from('intelligence_profiles').select('*').eq('student_id', id).single(),
    supabase.from('student_growth').select('*').eq('student_id', id).single(),
    supabase.from('project_assignments').select('*, project:projects(*)').eq('student_id', id)
  ])

  if (!student) notFound()

  const studentData = student as { full_name: string; email: string }
  const growthData = growth as { level?: string; growth_score?: number; projects_completed?: number; projects_total?: number } | null
  const intelData = intel as {
    genius_statement: string;
    dominant_intelligence: string;
    intelligence_scores: Record<string, number>;
    study_tips?: string[];
    learning_path?: string[];
    career_suggestions?: string[];
  } | null

  const pendingReviews = (assignments as Array<{ status: string; project_id: string; project?: { title?: string } }> | null)
    ?.filter(a => a.status === 'pending_review') ?? []

  const level = growthData?.level || 'Seed'
  const lc = levelConfig[level] || levelConfig['Seed']
  const initials = studentData.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4 flex-wrap">
        <div className="w-14 h-14 rounded-2xl bg-emerald-900 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white">{studentData.full_name}</h1>
            <span className="text-sm px-3 py-1 rounded-full font-medium flex-shrink-0" style={{ background: lc.bg, color: lc.color }}>{level}</span>
          </div>
          <p className="text-zinc-500 text-sm mt-0.5">{studentData.email}</p>
        </div>
      </div>

      {/* Pending review alert */}
      {pendingReviews.length > 0 && (
        <div className="p-4 rounded-2xl" style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.25)' }}>
          <p className="text-sm font-semibold mb-1" style={{ color: '#A78BFA' }}>
            {pendingReviews.length} project{pendingReviews.length > 1 ? 's' : ''} awaiting your review
          </p>
          <p className="text-xs text-zinc-500">Scroll to Assigned Projects below to approve or return them.</p>
        </div>
      )}

      {!intelData ? (
        <div className="p-5 rounded-2xl" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
          <p className="text-sm font-medium" style={{ color: '#F59E0B' }}>Assessment Pending</p>
          <p className="text-xs text-zinc-500 mt-1">This student hasn&apos;t completed their intelligence assessment yet.</p>
        </div>
      ) : (
        <>
          {/* Genius Statement */}
          <div className="relative p-5 rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(5,150,105,0.15) 0%, rgba(4,120,87,0.08) 100%)', border: '1px solid rgba(5,150,105,0.2)' }}>
            <p className="text-xs font-medium mb-1 uppercase tracking-wider" style={{ color: '#34D399' }}>Genius Statement</p>
            <p className="text-white font-semibold text-lg leading-snug">{intelData.genius_statement}</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Intelligence Profile */}
            <div className="lg:col-span-2 p-6 rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
              <h2 className="text-white font-semibold mb-5">Intelligence Profile</h2>
              <div className="space-y-3">
                {Object.entries(intelData.intelligence_scores).sort((a, b) => b[1] - a[1]).map(([key, val]) => {
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

            {/* Right column */}
            <div className="space-y-4">
              {/* Growth */}
              <div className="p-5 rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
                <h3 className="text-white font-semibold text-sm mb-3">Progress</h3>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-zinc-500">Level</span>
                  <span className="text-sm font-semibold" style={{ color: lc.color }}>{level}</span>
                </div>
                <div className="h-2 rounded-full mb-2" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div className="h-full rounded-full" style={{ width: `${growthData?.growth_score || 0}%`, background: lc.color }} />
                </div>
                <div className="flex items-center justify-between text-xs mb-4">
                  <span className="text-zinc-600">{growthData?.projects_completed || 0} approved</span>
                  <span className="text-zinc-600">{growthData?.projects_total || 0} total</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-lg text-center" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.15)' }}>
                    <p className="text-lg font-bold" style={{ color: '#22C55E' }}>{growthData?.projects_completed || 0}</p>
                    <p className="text-xs text-zinc-600 mt-0.5">Approved</p>
                  </div>
                  <div className="p-2.5 rounded-lg text-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <p className="text-lg font-bold text-zinc-400">{(growthData?.projects_total || 0) - (growthData?.projects_completed || 0)}</p>
                    <p className="text-xs text-zinc-600 mt-0.5">Remaining</p>
                  </div>
                </div>
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <p className="text-xs text-zinc-500">Dominant Intelligence</p>
                  <p className="text-sm font-medium text-white mt-0.5">
                    {intelligenceMeta[intelData.dominant_intelligence]?.emoji} {intelligenceMeta[intelData.dominant_intelligence]?.label}
                  </p>
                </div>
              </div>

              {/* Study Tips */}
              {intelData.study_tips && intelData.study_tips.length > 0 && (
                <div className="p-5 rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <h3 className="text-white font-semibold text-sm mb-3">Study Tips</h3>
                  <ul className="space-y-2">
                    {intelData.study_tips.slice(0, 3).map((tip, i) => (
                      <li key={i} className="flex gap-2 text-xs text-zinc-400">
                        <span className="text-emerald-500 flex-shrink-0">✓</span>
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Assigned Projects */}
      <div className="p-6 rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-white font-semibold">
            Assigned Projects
            <span className="ml-2 text-xs text-zinc-600 font-normal">({(assignments as unknown[])?.length || 0})</span>
          </h2>
          <AssignProject studentId={id} />
        </div>
        {!assignments || (assignments as unknown[]).length === 0 ? (
          <p className="text-zinc-600 text-sm">No projects assigned yet. Use the button above to assign one.</p>
        ) : (
          <div className="space-y-2">
            {(assignments as Array<{
              id: string;
              status: string;
              project_id: string;
              feedback?: string | null;
              project?: { title?: string; subject?: string; difficulty?: string }
            }>).map(a => {
              const sc = statusConfig[a.status] || statusConfig['assigned']
              const isPending = a.status === 'pending_review'
              return (
                <div key={a.id} className="py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">{a.project?.title}</p>
                      <p className="text-zinc-600 text-xs mt-0.5">{a.project?.subject} · {a.project?.difficulty}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: sc.bg, color: sc.color }}>
                        {sc.label}
                      </span>
                      {isPending && (
                        <TutorProjectActions projectId={a.project_id} />
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

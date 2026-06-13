import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { TutorCodeEditor } from './tutor-code-editor'

export const dynamic = 'force-dynamic'

const levelConfig: Record<string, { color: string }> = {
  Seed: { color: '#71717A' },
  Sprout: { color: '#22C55E' },
  Explorer: { color: '#3B82F6' },
  Master: { color: '#8B5CF6' },
  Legend: { color: '#F59E0B' },
}

export default async function TutorDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
  if (!profile) redirect('/login')

  // Auto-generate a short tutor code if this tutor doesn't have one yet
  let tutorCode = (profile as { tutor_code?: string }).tutor_code ?? ''
  if (!tutorCode) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let code = ''
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
    await supabase.from('profiles').update({ tutor_code: code }).eq('id', profile.id)
    tutorCode = code
  }

  const { data: students } = await supabase
    .from('tutor_students')
    .select('*, student:profiles!tutor_students_student_id_fkey(*)')
    .eq('tutor_id', profile.id)

  const studentIds = (students || []).map((s: { student_id: string }) => s.student_id)
  const [{ data: growthData }, { data: intelData }, { data: projectsData }] = await Promise.all([
    studentIds.length > 0 ? supabase.from('student_growth').select('*').in('student_id', studentIds) : Promise.resolve({ data: [] }),
    studentIds.length > 0 ? supabase.from('intelligence_profiles').select('student_id, dominant_intelligence, genius_statement').in('student_id', studentIds) : Promise.resolve({ data: [] }),
    supabase.from('projects').select('id').eq('tutor_id', profile.id),
  ])

  const growthMap = Object.fromEntries((growthData || []).map((g: { student_id: string; level?: string; projects_completed?: number }) => [g.student_id, g]))
  const intelMap = Object.fromEntries((intelData || []).map((i: { student_id: string; genius_statement?: string }) => [i.student_id, i]))

  const totalCompleted = (growthData || []).reduce((sum: number, g: { projects_completed?: number }) => sum + (g.projects_completed || 0), 0)
  const assessedCount = (intelData || []).length

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Tutor Dashboard</h1>
        <p className="text-zinc-500 text-sm mt-0.5">Welcome back, {profile.full_name.split(' ')[0]}</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Students', value: students?.length || 0, icon: '👨‍🎓', color: '#A78BFA' },
          { label: 'Projects Created', value: projectsData?.length || 0, icon: '📋', color: '#34D399' },
          { label: 'Projects Completed', value: totalCompleted, icon: '✓', color: '#22C55E' },
          { label: 'Assessed', value: assessedCount, icon: '🧠', color: '#F59E0B' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="p-4 rounded-xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-zinc-500">{label}</span>
              <span>{icon}</span>
            </div>
            <p className="text-2xl font-bold" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      <TutorCodeEditor initial={tutorCode} />

      {/* Students */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold">Your Students</h2>
          <Link href="/tutor/projects/new" className="text-xs px-3 py-1.5 rounded-lg transition font-medium" style={{ background: 'rgba(5,150,105,0.15)', color: '#34D399', border: '1px solid rgba(5,150,105,0.25)' }}>
            + New Project
          </Link>
        </div>

        {!students || students.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="text-4xl mb-4">🔗</div>
            <p className="text-white font-medium mb-1">No students linked yet</p>
            <p className="text-zinc-500 text-sm">Copy your Tutor ID above and share it with your students</p>
          </div>
        ) : (
          <div className="space-y-2">
            {students.map(({ student, student_id }: { student: { full_name?: string }; student_id: string }) => {
              const growth = growthMap[student_id] as { level?: string; projects_completed?: number } | undefined
              const intel = intelMap[student_id] as { genius_statement?: string } | undefined
              const level = growth?.level || 'Seed'
              const lc = levelConfig[level] || levelConfig['Seed']
              return (
                <Link key={student_id} href={`/tutor/students/${student_id}`}
                  className="flex items-center gap-4 p-4 rounded-xl transition group"
                  style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="w-10 h-10 rounded-full bg-emerald-900 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
                    {student?.full_name?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{student?.full_name}</p>
                    {intel ? (
                      <p className="text-zinc-600 text-xs truncate mt-0.5">{intel.genius_statement}</p>
                    ) : (
                      <p className="text-xs mt-0.5" style={{ color: '#F59E0B' }}>Assessment pending</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold" style={{ color: lc.color }}>{level}</p>
                    <p className="text-zinc-600 text-xs">{growth?.projects_completed || 0} projects</p>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

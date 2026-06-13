import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const levelConfig: Record<string, { color: string }> = {
  Seed: { color: '#71717A' },
  Sprout: { color: '#22C55E' },
  Explorer: { color: '#3B82F6' },
  Master: { color: '#8B5CF6' },
  Legend: { color: '#F59E0B' },
}

export default async function StudentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
  if (!profile) redirect('/login')

  const { data: students } = await supabase
    .from('tutor_students')
    .select('*, student:profiles!tutor_students_student_id_fkey(*)')
    .eq('tutor_id', (profile as { id: string }).id)

  const studentIds = (students || []).map((s: { student_id: string }) => s.student_id)
  const [{ data: growthData }, { data: intelData }] = await Promise.all([
    studentIds.length > 0 ? supabase.from('student_growth').select('*').in('student_id', studentIds) : Promise.resolve({ data: [] }),
    studentIds.length > 0 ? supabase.from('intelligence_profiles').select('student_id, dominant_intelligence, genius_statement').in('student_id', studentIds) : Promise.resolve({ data: [] }),
  ])

  const growthMap = Object.fromEntries((growthData || []).map((g: { student_id: string; level?: string; projects_completed?: number }) => [g.student_id, g]))
  const intelMap = Object.fromEntries((intelData || []).map((i: { student_id: string; genius_statement?: string }) => [i.student_id, i]))

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">My Students</h1>
          <p className="text-zinc-500 text-sm mt-0.5">{students?.length || 0} student{students?.length !== 1 ? 's' : ''} linked</p>
        </div>
      </div>

      {(!students || students.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-16 text-center rounded-2xl" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="text-4xl mb-4">🔗</div>
          <p className="text-white font-medium mb-1">No students linked yet</p>
          <p className="text-zinc-500 text-sm mb-4">Share your Tutor ID with students to connect</p>
          <code className="px-4 py-2 rounded-lg text-xs font-mono" style={{ background: '#18181B', color: '#A78BFA', border: '1px solid rgba(124,58,237,0.2)' }}>{(profile as { id: string }).id}</code>
        </div>
      ) : (
        <div className="space-y-2">
          {students.map(({ student, student_id }: { student: { full_name?: string; email?: string }; student_id: string }) => {
            const growth = growthMap[student_id] as { level?: string; projects_completed?: number } | undefined
            const intel = intelMap[student_id] as { genius_statement?: string } | undefined
            const level = growth?.level || 'Seed'
            const lc = levelConfig[level] || levelConfig['Seed']
            return (
              <Link key={student_id} href={`/tutor/students/${student_id}`}
                className="flex items-center gap-4 p-4 rounded-xl transition"
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
                <span className="text-zinc-600 text-xs flex-shrink-0">→</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const levelColors: Record<string, string> = {
  Seed: 'text-gray-400', Sprout: 'text-green-400', Explorer: 'text-blue-400',
  Master: 'text-purple-400', Legend: 'text-yellow-400'
}

export default async function TutorDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
  if (!profile) redirect('/login')

  const { data: students } = await supabase
    .from('tutor_students')
    .select('*, student:profiles!tutor_students_student_id_fkey(*)')
    .eq('tutor_id', profile.id)

  const studentIds = students?.map((s: { student_id: string }) => s.student_id) || []
  const { data: growthData } = studentIds.length > 0
    ? await supabase.from('student_growth').select('*').in('student_id', studentIds)
    : { data: [] }
  const { data: intelData } = studentIds.length > 0
    ? await supabase.from('intelligence_profiles').select('student_id, dominant_intelligence, genius_statement').in('student_id', studentIds)
    : { data: [] }

  const growthMap = Object.fromEntries((growthData || []).map((g: { student_id: string; level?: string; growth_score?: number; projects_completed?: number }) => [g.student_id, g]))
  const intelMap = Object.fromEntries((intelData || []).map((i: { student_id: string; genius_statement?: string }) => [i.student_id, i]))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Tutor Dashboard</h1>
          <p className="text-gray-400 mt-1">Welcome, {profile.full_name}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-white">{students?.length || 0}</p>
          <p className="text-gray-400 text-sm">Total Students</p>
        </div>
      </div>

      {(!students || students.length === 0) ? (
        <div className="text-center py-20 bg-gray-900 rounded-2xl border border-gray-800">
          <p className="text-4xl mb-4">👨‍🎓</p>
          <p className="text-gray-400">No students linked yet. Share your tutor ID with students to connect.</p>
          <p className="mt-4 text-emerald-400 font-mono text-sm bg-gray-800 px-4 py-2 rounded-lg inline-block">{profile.id}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {students?.map(({ student, student_id }: { student: { full_name?: string; email?: string }; student_id: string }) => {
            const growth = growthMap[student_id] as { level?: string; growth_score?: number; projects_completed?: number } | undefined
            const intel = intelMap[student_id] as { genius_statement?: string } | undefined
            return (
              <Link key={student_id} href={`/tutor/students/${student_id}`}
                className="bg-gray-900 rounded-2xl p-6 border border-gray-800 hover:border-emerald-700 transition block">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-emerald-700 flex items-center justify-center text-white font-bold text-lg">
                      {student?.full_name?.[0]}
                    </div>
                    <div>
                      <p className="text-white font-semibold">{student?.full_name}</p>
                      <p className="text-gray-500 text-sm">{student?.email}</p>
                      {intel && <p className="text-emerald-400 text-sm mt-1">&quot;{intel.genius_statement}&quot;</p>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-bold ${levelColors[growth?.level || 'Seed']}`}>{growth?.level || 'Seed'}</p>
                    <p className="text-gray-500 text-sm">{growth?.projects_completed || 0} projects done</p>
                    {!intel && <p className="text-yellow-500 text-xs mt-1">Assessment pending</p>}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'

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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-emerald-700 flex items-center justify-center text-white font-bold text-2xl">
          {(student as { full_name: string }).full_name[0]}
        </div>
        <div>
          <h1 className="text-3xl font-bold text-white">{(student as { full_name: string }).full_name}</h1>
          <p className="text-gray-400">{(student as { email: string }).email}</p>
        </div>
      </div>

      {!intel ? (
        <div className="bg-yellow-900/30 border border-yellow-700 rounded-xl p-4 text-yellow-400">
          This student hasn&apos;t completed their intelligence assessment yet.
        </div>
      ) : (
        <>
          <div className="bg-gradient-to-r from-emerald-900 to-teal-900 rounded-2xl p-6 border border-emerald-700">
            <p className="text-emerald-300 text-sm mb-1">Genius Statement</p>
            <p className="text-xl font-bold text-white">{(intel as { genius_statement: string }).genius_statement}</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-gray-900 rounded-2xl p-6 border border-gray-800">
              <h2 className="text-white font-semibold mb-4">Intelligence Scores</h2>
              <div className="space-y-3">
                {Object.entries((intel as { intelligence_scores: Record<string, number> }).intelligence_scores).sort((a,b) => b[1]-a[1]).map(([key, val]) => {
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

            <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
              <h2 className="text-white font-semibold mb-4">Growth</h2>
              <p className="text-2xl font-bold text-purple-400">{(growth as { level?: string } | null)?.level || 'Seed'}</p>
              <div className="mt-2 bg-gray-800 rounded-full h-2">
                <div className="bg-green-500 h-2 rounded-full" style={{ width: `${(growth as { growth_score?: number } | null)?.growth_score || 0}%` }} />
              </div>
              <p className="text-gray-500 text-sm mt-2">
                {(growth as { projects_completed?: number } | null)?.projects_completed || 0} / {(growth as { projects_total?: number } | null)?.projects_total || 0} projects
              </p>
              <p className="text-gray-400 mt-4 text-sm">
                <span className="text-gray-500">Dominant: </span>
                {intelligenceLabels[(intel as { dominant_intelligence: string }).dominant_intelligence]?.label}
              </p>
            </div>
          </div>
        </>
      )}

      <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
        <h2 className="text-white font-semibold mb-4">Assigned Projects ({(assignments as unknown[])?.length || 0})</h2>
        {!assignments || (assignments as unknown[]).length === 0 ? (
          <p className="text-gray-500">No projects assigned yet.</p>
        ) : (
          <div className="space-y-3">
            {(assignments as Array<{
              id: string;
              status: string;
              project?: { title?: string; subject?: string; difficulty?: string }
            }>).map(a => (
              <div key={a.id} className="flex items-center justify-between py-3 border-b border-gray-800 last:border-0">
                <div>
                  <p className="text-white font-medium">{a.project?.title}</p>
                  <p className="text-gray-500 text-sm">{a.project?.subject} · {a.project?.difficulty}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${a.status === 'completed' ? 'bg-green-900 text-green-400' : a.status === 'in_progress' ? 'bg-blue-900 text-blue-400' : 'bg-yellow-900 text-yellow-400'}`}>
                  {a.status.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

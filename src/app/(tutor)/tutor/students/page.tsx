import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Users } from 'lucide-react'
import { Card, EmptyState, PageHeader } from '@/components/ui'
import { StudentRow } from '@/components/student-row'

export const dynamic = 'force-dynamic'

export default async function StudentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
  if (!profile) redirect('/login')

  const tutorCode = (profile as { tutor_code?: string }).tutor_code ?? ''

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
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Students"
        title="My students"
        description={<span className="tnum">{students?.length || 0} student{students?.length !== 1 ? 's' : ''} connected</span>}
      />

      {(!students || students.length === 0) ? (
        <EmptyState icon={<Users className="h-5 w-5" strokeWidth={1.75} />} title="No students connected yet">
          <p>Share your tutor code with students so they can connect.</p>
          {tutorCode ? (
            <code className="mt-4 inline-block rounded-[8px] border border-line bg-sunken px-4 py-2 font-mono text-[18px] tracking-[0.2em] text-ink">
              {tutorCode}
            </code>
          ) : (
            <p className="mt-2 text-[13px]">Your code appears on your dashboard.</p>
          )}
        </EmptyState>
      ) : (
        <Card padded={false} className="overflow-hidden">
          <ul className="divide-y divide-line">
            {students.map(({ student, student_id }: { student: { full_name?: string; email?: string }; student_id: string }) => {
              const growth = growthMap[student_id] as { level?: string; projects_completed?: number } | undefined
              const intel = intelMap[student_id] as { genius_statement?: string } | undefined
              return (
                <li key={student_id}>
                  <StudentRow
                    href={`/tutor/students/${student_id}`}
                    name={student?.full_name}
                    statement={intel?.genius_statement}
                    assessed={!!intel}
                    level={growth?.level || 'Seed'}
                    projectsCompleted={growth?.projects_completed || 0}
                    chevron
                  />
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </div>
  )
}

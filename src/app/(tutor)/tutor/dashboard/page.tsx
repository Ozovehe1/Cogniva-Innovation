import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { TutorCodeEditor } from './tutor-code-editor'
import { Plus, Users } from 'lucide-react'
import { Card, EmptyState, PageHeader, SectionTitle, buttonClass } from '@/components/ui'
import { StudentRow } from '@/components/student-row'

export const dynamic = 'force-dynamic'

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

  const kpis = [
    { label: 'Students', value: students?.length || 0 },
    { label: 'Assessed', value: assessedCount },
    { label: 'Projects created', value: projectsData?.length || 0 },
    { label: 'Projects approved', value: totalCompleted },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Tutor dashboard"
        title={<>Welcome back, {profile.full_name.split(' ')[0]}</>}
        actions={
          <Link href="/tutor/projects/new" className={buttonClass('primary', 'md')}>
            <Plus className="h-4 w-4" strokeWidth={2} />
            New project
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card padded={false} className="lg:col-span-2">
          <dl className="grid grid-cols-2 sm:grid-cols-4">
            {kpis.map(({ label, value }, i) => (
              <div
                key={label}
                className={[
                  'p-5 md:p-6',
                  i % 2 === 0 ? 'border-r border-line' : '',
                  i < 2 ? 'border-b border-line sm:border-b-0' : '',
                  i === 1 ? 'sm:border-r' : '',
                  i === 2 ? 'sm:border-r' : '',
                ].join(' ')}
              >
                <dt className="text-[13px] text-muted">{label}</dt>
                <dd className="tnum mt-1 font-display text-[30px] leading-none text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <TutorCodeEditor initial={tutorCode} />
      </div>

      <section className="mt-8 md:mt-10">
        <SectionTitle
          action={students && students.length > 0 ? (
            <Link href="/tutor/students" className="text-[13px] font-medium text-accent underline-offset-4 hover:underline">All students</Link>
          ) : undefined}
        >
          Your students
        </SectionTitle>

        {!students || students.length === 0 ? (
          <EmptyState icon={<Users className="h-5 w-5" strokeWidth={1.75} />} title="No students connected yet">
            Share your tutor code above. Students enter it on their Projects page to connect with you.
          </EmptyState>
        ) : (
          <Card padded={false} className="overflow-hidden">
            <ul className="divide-y divide-line">
              {students.map(({ student, student_id }: { student: { full_name?: string }; student_id: string }) => {
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
                    />
                  </li>
                )
              })}
            </ul>
          </Card>
        )}
      </section>
    </div>
  )
}

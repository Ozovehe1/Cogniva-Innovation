import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

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

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-white">My Students</h1>
      {(!students || students.length === 0) ? (
        <div className="text-center py-20 bg-gray-900 rounded-2xl border border-gray-800">
          <p className="text-4xl mb-4">👨‍🎓</p>
          <p className="text-gray-400">No students linked yet.</p>
          <p className="mt-2 text-gray-500 text-sm">Share your tutor ID with students to connect:</p>
          <p className="mt-2 text-emerald-400 font-mono text-sm bg-gray-800 px-4 py-2 rounded-lg inline-block">{(profile as { id: string }).id}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {students.map(({ student, student_id }: { student: { full_name?: string; email?: string }; student_id: string }) => (
            <Link key={student_id} href={`/tutor/students/${student_id}`}
              className="bg-gray-900 rounded-2xl p-6 border border-gray-800 hover:border-emerald-700 transition flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-emerald-700 flex items-center justify-center text-white font-bold">
                  {student?.full_name?.[0]}
                </div>
                <div>
                  <p className="text-white font-semibold">{student?.full_name}</p>
                  <p className="text-gray-500 text-sm">{student?.email}</p>
                </div>
              </div>
              <span className="text-emerald-400 text-sm">View Profile →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSessionProfile } from '@/lib/auth'
import { Eyebrow } from '@/components/ui'
import { MasteryCheck } from '@/components/mastery-check'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mastery check · GeniusMap' }

export default async function CheckPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ recheck?: string }> }) {
  const { id } = await params
  const { recheck } = await searchParams
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const { supabase, profile } = await getSessionProfile()
  if (!profile) notFound()
  const { data: t } = await supabase.from('path_topics').select('id, title, status').eq('lesson_id', id).eq('student_id', profile.id).maybeSingle()
  if (!t) notFound()
  const topic = t as { id: string; title: string; status: string }
  return (
    <div className="mx-auto max-w-[680px]">
      <Link href={`/learn/${id}`} className="-ml-1 mb-4 inline-flex h-9 items-center gap-1.5 rounded-md px-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />Back to the lesson
      </Link>
      <Eyebrow className="mb-2">{recheck ? 'Checking the basics' : 'Mastery check'}</Eyebrow>
      <h1 className="font-display text-[28px] leading-[1.1] text-ink md:text-[34px]">{topic.title}</h1>
      <MasteryCheck topicId={topic.id} lessonId={id} mastered={topic.status === 'mastered'} recheck={recheck === '1'} />
    </div>
  )
}

import Link from 'next/link'
import { TutorPresence } from '@/components/genie/tutor-presence'
import { redirect } from 'next/navigation'
import { getSessionProfile } from '@/lib/auth'
import { AgentChat, type ChatMessage } from '@/components/agent/chat'
import { Eyebrow, cx } from '@/components/ui'
import type { Block } from '@/lib/agent/types'

export const dynamic = 'force-dynamic'

export default async function AskPage({ searchParams }: { searchParams: Promise<{ session?: string; q?: string }> }) {
  const { session, q } = await searchParams
  const { supabase, profile } = await getSessionProfile()
  if (!profile) redirect('/login')
  const { data: sessions } = await supabase.from('chat_sessions').select('id, title, updated_at').eq('student_id', profile.id).order('updated_at', { ascending: false }).limit(8)
  let initial: ChatMessage[] = []
  let sessionId: string | null = null
  if (session && /^[0-9a-f-]{36}$/i.test(session)) {
    const { data: s } = await supabase.from('chat_sessions').select('id').eq('id', session).maybeSingle()
    if (s) {
      sessionId = s.id
      const { data: msgs } = await supabase.from('chat_messages').select('role, content, blocks').eq('session_id', s.id).order('id').limit(60)
      initial = ((msgs ?? []) as { role: 'user' | 'assistant'; content: string; blocks: Block[] }[]).map(m => ({ role: m.role, content: m.content, blocks: m.blocks ?? [] }))
    }
  }
  const { data: lp } = await supabase.from('learner_profiles').select('age_band').eq('student_id', profile.id).maybeSingle()
  const minor = lp ? ['under13', '13to17'].includes((lp as { age_band: string | null }).age_band ?? '') : null
  const prompt = !sessionId && typeof q === 'string' && q.trim() ? q.trim().slice(0, 300) : null
  return (
    <div className="mx-auto max-w-[820px]">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div>
          <Eyebrow>Ask GeniusMap</Eyebrow>
          <h1 className="mt-1 font-display text-[28px] leading-tight text-ink md:text-[34px]">Your tutor, any time</h1>
        </div>
        {(sessionId || prompt) && <Link href="/ask" className="text-[13px] font-medium text-accent">New chat</Link>}
      </div>
      <TutorPresence className="mb-1 rounded-[14px] border border-line bg-surface py-1.5 pl-2 pr-1.5 shadow-[var(--shadow-card)]" />
      {(sessions ?? []).length > 0 && !prompt && (
        <nav aria-label="Recent chats" className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 py-2 sm:mx-0 sm:px-0">
          {(sessions ?? []).map(s => (
            <Link key={s.id} href={`/ask?session=${s.id}`} className={cx('max-w-[220px] flex-shrink-0 truncate rounded-full border px-3 py-1.5 text-[13px]', s.id === sessionId ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-ink-2 hover:border-line-strong')}>{s.title}</Link>
          ))}
        </nav>
      )}
      <AgentChat key={sessionId ?? prompt ?? 'new'} initialSessionId={sessionId} initialMessages={initial} initialPrompt={prompt} minor={minor} />
    </div>
  )
}

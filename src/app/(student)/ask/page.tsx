import { TutorPresence } from '@/components/genie/tutor-presence'
import { redirect } from 'next/navigation'
import { getSessionProfile } from '@/lib/auth'
import { AgentChat, type ChatMessage } from '@/components/agent/chat'
import { ChatHistory } from '@/components/agent/chat-history'
import { listChats } from '@/lib/agent/chat-store'
import type { Block } from '@/lib/agent/types'

export const dynamic = 'force-dynamic'

export default async function AskPage({ searchParams }: { searchParams: Promise<{ session?: string; q?: string }> }) {
  const { session, q } = await searchParams
  const { supabase, profile } = await getSessionProfile()
  if (!profile) redirect('/login')
  // Every chat is kept until the learner deletes it (history drawer below); the drawer refetches when opened.
  const sessions = await listChats(supabase, profile.id)
  let initial: ChatMessage[] = []
  let sessionId: string | null = null
  if (session && /^[0-9a-f-]{36}$/i.test(session)) {
    const { data: s } = await supabase.from('chat_sessions').select('id').eq('id', session).maybeSingle()
    if (s) {
      sessionId = s.id
      const { data: msgs } = await supabase.from('chat_messages').select('role, content, blocks, meta').eq('session_id', s.id).order('id').limit(500)
      // A reported answer stays flagged for this learner (meta.flagged; reported visuals carry block.flagged).
      initial = ((msgs ?? []) as { role: 'user' | 'assistant'; content: string; blocks: Block[]; meta: { flagged?: ChatMessage['flagged'] } | null }[]).map(m => ({ role: m.role, content: m.content, blocks: m.blocks ?? [], flagged: m.meta?.flagged ?? null }))
    }
  }
  const { data: lp } = await supabase.from('learner_profiles').select('age_band').eq('student_id', profile.id).maybeSingle()
  const minor = lp ? ['under13', '13to17'].includes((lp as { age_band: string | null }).age_band ?? '') : null
  const prompt = !sessionId && typeof q === 'string' && q.trim() ? q.trim().slice(0, 300) : null
  return (
    <div className="mx-auto max-w-[820px]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h1 className="font-display text-[28px] leading-tight text-ink md:text-[34px]">Ask</h1>
        <div className="flex flex-shrink-0 items-center gap-3">
          <ChatHistory initial={sessions} />
        </div>
      </div>
      <TutorPresence className="mb-1 rounded-[14px] border border-line bg-surface py-1.5 pl-2 pr-1.5 shadow-[var(--shadow-card)]" />
      <AgentChat key={sessionId ?? prompt ?? 'new'} initialSessionId={sessionId} initialMessages={initial} initialPrompt={prompt} minor={minor} />
    </div>
  )
}

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getSessionProfile } from '@/lib/auth'
import { deleteOwnChats } from '@/lib/agent/chat-store'

export const dynamic = 'force-dynamic'

/** DELETE /api/agent/chats/:id — hard-delete one of the learner's own chats and its messages. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const gone = await deleteOwnChats(supabase, profile.id, [id])
    if (!gone.length) return NextResponse.json({ error: 'That chat is already gone.' }, { status: 404 })
    revalidatePath('/ask')
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Could not delete the chat. Please try again.' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getSessionProfile } from '@/lib/auth'
import { deleteOwnChats, listChats } from '@/lib/agent/chat-store'

export const dynamic = 'force-dynamic'

/** GET /api/agent/chats — the signed-in learner's chats, newest first. */
export async function GET() {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ chats: await listChats(supabase, profile.id) }, { headers: { 'Cache-Control': 'no-store' } })
}

/** DELETE /api/agent/chats { all: true } — delete every chat the learner has (with its messages). */
export async function DELETE(req: Request) {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { all?: unknown }
  if (body.all !== true) return NextResponse.json({ error: 'Say which chats to delete' }, { status: 400 })
  try {
    const gone = await deleteOwnChats(supabase, profile.id, 'all')
    revalidatePath('/ask'); revalidatePath('/settings')
    return NextResponse.json({ ok: true, deleted: gone.length })
  } catch {
    return NextResponse.json({ error: 'Could not delete your chats. Please try again.' }, { status: 500 })
  }
}

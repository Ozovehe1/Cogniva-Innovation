import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { deleteOwnPath } from '@/lib/purge'
import { updateOwnPathAnswers } from '@/lib/path-edit'

export const dynamic = 'force-dynamic'

const refresh = () => { revalidatePath('/learn'); revalidatePath('/dashboard'); revalidatePath('/settings') }

/** DELETE /api/paths/:id — delete one of the signed-in learner's goals and everything written for it. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await deleteOwnPath(id)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  refresh()
  return NextResponse.json({ ok: true, remainingGoals: res.remainingGoals ?? 0 })
}

/** PATCH /api/paths/:id — edit a goal's answers (deadline, purpose, weekly time); re-plans pace and due dates. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const res = await updateOwnPathAnswers(id, body)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  refresh()
  return NextResponse.json({ ok: true })
}

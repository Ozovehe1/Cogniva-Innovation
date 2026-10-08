import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { deleteOwnLesson } from '@/lib/purge'

export const dynamic = 'force-dynamic'

/** DELETE /api/lessons/:id — delete one of the signed-in learner's own lessons. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await deleteOwnLesson(id)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  revalidatePath('/learn'); revalidatePath('/dashboard'); revalidatePath('/settings')
  return NextResponse.json({ ok: true })
}

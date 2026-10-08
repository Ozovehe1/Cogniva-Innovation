import { NextResponse } from 'next/server'
import { deleteOwnAccount } from '@/lib/purge'

export const dynamic = 'force-dynamic'

/** DELETE /api/account with {"confirm":"DELETE"} — delete the signed-in user's account and all their data. */
export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => null)) as { confirm?: string } | null
  const res = await deleteOwnAccount(body?.confirm ?? '')
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true })
}

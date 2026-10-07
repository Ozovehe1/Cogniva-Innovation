import { NextResponse, after } from 'next/server'
import { checkDraftKey, runDraftWork, selfOrigin } from '@/lib/lesson-drafting'

export const maxDuration = 300

/** Internal: continues a lesson's background draft (called by the worker itself when its time budget runs out). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!checkDraftKey(id, request.headers.get('x-draft-key'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const origin = selfOrigin(request)
  after(() => runDraftWork(id, { origin }).catch(err => console.error('Draft worker crashed:', err)))
  return NextResponse.json({ ok: true }, { status: 202 })
}

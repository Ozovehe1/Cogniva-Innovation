import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchRender, withUrl, type ManimJob } from '@/lib/manim'

export const maxDuration = 120

async function loadOwn(id: string) {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (profile.role !== 'tutor') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const { data } = await supabase.from('manim_jobs').select('*').eq('id', id).eq('requested_by', profile.id).maybeSingle()
  if (!data) return { error: NextResponse.json({ error: 'Job not found' }, { status: 404 }) }
  return { supabase, job: data as ManimJob }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await loadOwn(id)
  if ('error' in r) return r.error
  return NextResponse.json({ job: withUrl(r.job) })
}

/** PATCH { action: 'approve' | 'reject' | 'retry' } */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await loadOwn(id)
  if ('error' in r) return r.error
  const { supabase, job } = r
  const body = await request.json().catch(() => ({}))

  if (body.action === 'approve') {
    if (job.status !== 'done') return NextResponse.json({ error: 'Only a finished render can be approved.' }, { status: 400 })
    await supabase.from('manim_jobs').update({ status: 'approved' }).eq('id', id)
  } else if (body.action === 'reject') {
    if (job.status !== 'approved' && job.status !== 'done') return NextResponse.json({ error: 'Nothing to reject.' }, { status: 400 })
    await supabase.from('manim_jobs').update({ status: 'done' }).eq('id', id)
  } else if (body.action === 'retry') {
    if (job.status !== 'failed' && job.status !== 'queued') return NextResponse.json({ error: 'Only failed or queued jobs can be retried.' }, { status: 400 })
    try {
      const admin = createAdminClient()
      // A manual retry starts a fresh budget of automatic fixes.
      await admin.from('manim_jobs').update({ attempts: 0 }).eq('id', id)
      await dispatchRender(admin, { id, code: job.code, attempts: 0, prompt: job.prompt })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Retry failed' }, { status: 500 })
    }
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
  const { data } = await supabase.from('manim_jobs').select('*').eq('id', id).single()
  return NextResponse.json({ job: withUrl(data as ManimJob) })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await loadOwn(id)
  if ('error' in r) return r.error
  const { error } = await r.supabase.from('manim_jobs').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

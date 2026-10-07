import { NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MAX_RENDER_ATTEMPTS, dispatchRender, renderTokenMatches, type ManimJob } from '@/lib/manim'
import { fixManimCode } from '@/lib/lesson-ai'

export const maxDuration = 90

/**
 * POST /api/manim/callback  — called by the Modal render service.
 * Header X-Render-Token must equal RENDER_TOKEN. Body: { job_id, status: 'rendering'|'done'|'failed', error? }
 * On failure, Gemini fixes the code once per attempt and the job is re-queued (max 2 automatic retries).
 */
export async function POST(request: Request) {
  if (!renderTokenMatches(request.headers.get('x-render-token'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  const jobId = typeof body.job_id === 'string' ? body.job_id : null
  const status = body.status
  if (!jobId || !['rendering', 'done', 'failed'].includes(status)) {
    return NextResponse.json({ error: 'job_id and a valid status are required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data } = await admin.from('manim_jobs').select('*').eq('id', jobId).maybeSingle()
  const job = data as ManimJob | null
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (job.status === 'approved') return NextResponse.json({ ok: true, ignored: 'already approved' })

  if (status === 'rendering') {
    await admin.from('manim_jobs').update({ status: 'rendering' }).eq('id', jobId)
    return NextResponse.json({ ok: true })
  }
  if (status === 'done') {
    await admin.from('manim_jobs').update({ status: 'done', error: null }).eq('id', jobId)
    return NextResponse.json({ ok: true })
  }

  // Failed.
  const error = typeof body.error === 'string' ? body.error.slice(-6000) : 'Render failed'
  if (job.attempts >= MAX_RENDER_ATTEMPTS || !job.code) {
    await admin.from('manim_jobs').update({ status: 'failed', error }).eq('id', jobId)
    return NextResponse.json({ ok: true, retried: false })
  }

  await admin.from('manim_jobs').update({ status: 'queued', error: `Attempt ${job.attempts} failed; fixing the code and retrying.\n${error.slice(-1500)}` }).eq('id', jobId)
  // Answer Modal right away; fix and re-dispatch after the response.
  after(async () => {
    try {
      const code = await fixManimCode(job.code!, error, job.prompt)
      await admin.from('manim_jobs').update({ code }).eq('id', jobId)
      await dispatchRender(admin, { id: jobId, code, attempts: job.attempts, prompt: job.prompt })
    } catch (err) {
      await admin.from('manim_jobs').update({
        status: 'failed',
        error: `${error.slice(-3000)}\n\nAutomatic fix failed: ${err instanceof Error ? err.message : String(err)}`,
      }).eq('id', jobId)
    }
  })
  return NextResponse.json({ ok: true, retried: true })
}

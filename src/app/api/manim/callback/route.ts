import { NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MAX_RENDER_ATTEMPTS, dispatchRender, renderTokenMatches, type ManimJob } from '@/lib/manim'
import { fixManimCode, generateManimCode, type ManimNarration } from '@/lib/lesson-ai'
import { ensureNarration } from '@/lib/tts-server'
import { clipBlocked } from '@/lib/correctness/clip'

// The composer fallback writes fresh code (up to two 60 s Gemini passes) after answering Modal.
export const maxDuration = 300

/**
 * POST /api/manim/callback  — called by the Modal render service.
 * Header X-Render-Token must equal RENDER_TOKEN. Body: { job_id, status: 'rendering'|'done'|'failed', error?, verdict? }
 * verdict: the deterministic scene verifier's result ({ ok, failed: [...] }); ok === false blocks a 'done' clip.
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
    // Composed clips report the scene they rendered (grammar spec as Python) so it can be inspected and re-rendered.
    const code = body.composed && typeof body.code === 'string' ? body.code.slice(0, 60000) : undefined
    // Correctness guard: the scene engine's deterministic verifier verdict ({ ok, failed: [...] }). A failed verdict
    // blocks the clip: it is never shown or placed into a lesson.
    const verdict = body.verdict && typeof body.verdict === 'object' ? body.verdict as { ok?: unknown; failed?: unknown } : null
    if (clipBlocked(verdict)) {
      const why = Array.isArray(verdict!.failed) ? verdict!.failed.map(String).slice(0, 8).join('; ') : 'verifier failed'
      await admin.from('manim_jobs').update({ status: 'failed', verdict, error: `Blocked by the correctness verifier: ${why}`.slice(0, 3000), ...(code ? { code } : {}) }).eq('id', jobId)
      return NextResponse.json({ ok: true, blocked: true })
    }
    // No verdict (free-form code, template composer) or ok: null means UNVERIFIED, recorded as such (never as a pass).
    const stored = verdict && verdict.ok === true ? verdict : { ...(verdict ?? {}), ok: null, unverified: true }
    await admin.from('manim_jobs').update({ status: 'done', error: null, verdict: stored, ...(code ? { code } : {}) }).eq('id', jobId)
    // AI lessons: the drafting worker places the finished clip into the next section it releases
    // (sections the learner may already be playing are never changed).
    return NextResponse.json({ ok: true })
  }

  // Failed.
  const error = typeof body.error === 'string' ? body.error.slice(-6000) : 'Render failed'
  if (body.composed && !job.code) {
    // Modal retries callbacks; a repeat of the same failure must not start a second fallback.
    if (job.status === 'queued' || job.status === 'failed') return NextResponse.json({ ok: true, ignored: 'fallback already handled' })
    // The composer gave up after its own bounded repair: fall back to free-form Manim code (the escape hatch).
    await admin.from('manim_jobs').update({ status: 'queued', error: `Composer failed; falling back to free-form code.\n${error.slice(-1500)}` }).eq('id', jobId)
    after(async () => {
      try {
        const code = await generateManimCode(job.prompt)
        await admin.from('manim_jobs').update({ code }).eq('id', jobId)
        await dispatchRender(admin, { id: jobId, code, attempts: job.attempts, prompt: job.prompt })
      } catch (err) {
        await admin.from('manim_jobs').update({ status: 'failed', error: `${error.slice(-3000)}\n\nFallback failed: ${err instanceof Error ? err.message : String(err)}` }).eq('id', jobId)
      }
    })
    return NextResponse.json({ ok: true, fallback: true })
  }
  if (job.attempts >= MAX_RENDER_ATTEMPTS || !job.code) {
    await admin.from('manim_jobs').update({ status: 'failed', error }).eq('id', jobId)
    return NextResponse.json({ ok: true, retried: false })
  }

  await admin.from('manim_jobs').update({ status: 'queued', error: `Attempt ${job.attempts} failed; fixing the code and retrying.\n${error.slice(-1500)}` }).eq('id', jobId)
  // Answer Modal right away; fix and re-dispatch after the response.
  after(async () => {
    try {
      // A narrated clip keeps its timing through the fix (cached voice: one storage lookup).
      const text = (job as ManimJob & { narration?: string | null }).narration
      let narration: ManimNarration | undefined
      if (text) {
        const c = (await ensureNarration([text], { cacheOnly: true }).catch(() => null))?.clips[0]
        narration = c ? { text, ms: c.ms, words: c.words } : { text }
      }
      const code = await fixManimCode(job.code!, error, job.prompt, narration)
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

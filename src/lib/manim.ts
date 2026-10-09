import { timingSafeEqual } from 'node:crypto'
import { manimContext } from './playbook/retrieve'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MANIM_BUCKET, publicClipUrl } from './supabase/admin'
import { MANIM_SCENE_NAME, fixManimCode, vetManimCode } from './lesson-ai'
import { layoutTuning } from './correctness/layout-learning'

export interface ManimJob {
  id: string
  lesson_id: string | null
  requested_by: string
  prompt: string
  code: string | null
  scene_name: string
  status: 'queued' | 'rendering' | 'done' | 'failed' | 'approved'
  attempts: number
  video_path: string | null
  error: string | null
  created_at: string
  updated_at: string
}

/** Storage path of a clip's pen paths (the whiteboard hand traces them): next to the video, `.pen.json`. */
export function penPathFor(videoPath: string) {
  return videoPath.replace(/\.mp4$/i, '') + '.pen.json'
}

/** Initial render + up to 2 AI-fixed retries. */
export const MAX_RENDER_ATTEMPTS = 3

export function renderTokenMatches(given: string | null) {
  const expected = process.env.RENDER_TOKEN
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function renderServiceConfigured() {
  return !!process.env.MODAL_RENDER_URL && !!process.env.RENDER_TOKEN
}

/**
 * Creates a signed upload URL for the next attempt and asks the Modal service to render.
 * Uses the service-role client. Updates the job row with the outcome of the dispatch.
 */
export async function dispatchRender(admin: SupabaseClient, job: Pick<ManimJob, 'id' | 'code' | 'attempts'> & { prompt?: string | null }) {
  const attempt = job.attempts + 1
  const path = `${job.id}/${attempt}.mp4`
  if (!job.code) {
    await admin.from('manim_jobs').update({ status: 'failed', error: 'No code to render.' }).eq('id', job.id)
    return { ok: false as const, error: 'No code to render.' }
  }

  // Static Manim v0.19 check before any container time is spent: safe renames are applied;
  // anything else gets one Gemini fix (when we know the request) or fails fast with a clear error.
  const vetted = await vetForRender(job.code, job.prompt ?? null)
  if (!vetted.ok) {
    await admin.from('manim_jobs').update({ status: 'failed', error: vetted.error.slice(0, 6000) }).eq('id', job.id)
    return { ok: false as const, error: vetted.error }
  }
  if (vetted.code !== job.code) {
    await admin.from('manim_jobs').update({ code: vetted.code }).eq('id', job.id)
    job = { ...job, code: vetted.code }
  }
  if (!renderServiceConfigured()) {
    const error = 'The render service is not connected yet (MODAL_RENDER_URL is not set). The job will stay queued.'
    await admin.from('manim_jobs').update({ status: 'queued', error }).eq('id', job.id)
    return { ok: false as const, error }
  }

  const { data: signed, error: signErr } = await admin.storage.from(MANIM_BUCKET).createSignedUploadUrl(path, { upsert: true })
  if (signErr || !signed) {
    const error = `Could not create an upload URL: ${signErr?.message ?? 'unknown error'}`
    await admin.from('manim_jobs').update({ status: 'failed', error }).eq('id', job.id)
    return { ok: false as const, error }
  }

  // Where the hand's pen paths for this clip go (see modal_app/pen_export.py); optional, the clip plays without them.
  const { data: penSigned } = await admin.storage.from(MANIM_BUCKET).createSignedUploadUrl(penPathFor(path), { upsert: true })

  await admin.from('manim_jobs').update({ status: 'rendering', error: null, attempts: attempt, video_path: path }).eq('id', job.id)

  try {
    const base = process.env.MODAL_RENDER_URL!.replace(/\/+$/, '')
    const res = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Render-Token': process.env.RENDER_TOKEN! },
      body: JSON.stringify({ job_id: job.id, code: job.code, scene_name: MANIM_SCENE_NAME, upload_url: signed.signedUrl, ...(penSigned ? { paths_upload_url: penSigned.signedUrl } : {}) }),
      signal: AbortSignal.timeout(20_000),
    })
    if (res.status === 422) {
      const error = (await res.text()).slice(0, 2000)
      await admin.from('manim_jobs').update({ status: 'failed', error }).eq('id', job.id)
      return { ok: false as const, error }
    }
    if (!res.ok) throw new Error(`render service answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return { ok: true as const }
  } catch (err) {
    const error = `Could not reach the render service: ${err instanceof Error ? err.message : String(err)}`
    await admin.from('manim_jobs').update({ status: 'failed', error }).eq('id', job.id)
    return { ok: false as const, error }
  }
}

/**
 * The general visual composer (modal_app/gm_compose.py): the render service plans the concept, writes a scene in the
 * GeniusMap scene grammar, validates it (every LaTeX snippet compiled, every expression evaluated), renders it, runs the
 * frame gate and repairs once, all at render time on Modal, ahead of playback. On success the callback stores the
 * composed scene as the job's code; on failure the callback falls back to free-form Manim code (the escape hatch).
 */
export async function dispatchCompose(admin: SupabaseClient, job: Pick<ManimJob, 'id' | 'attempts'> & { prompt: string }, narration?: { text: string; ms?: number; words?: { w: string; s: number; e: number }[] } | null, context = '') {
  if (!renderServiceConfigured()) return { ok: false as const, error: 'render service not configured' }
  // Teaching Playbook rules for the Manim planner ride in the context (gm_compose PLAN_PROMPT reads context[:1500]).
  context = await manimContext(context, job.prompt)
  const attempt = job.attempts + 1
  const path = `${job.id}/${attempt}.mp4`
  const [{ data: signed, error: signErr }, { data: penSigned }, { data: repSigned }] = await Promise.all([
    admin.storage.from(MANIM_BUCKET).createSignedUploadUrl(path, { upsert: true }),
    admin.storage.from(MANIM_BUCKET).createSignedUploadUrl(penPathFor(path), { upsert: true }),
    admin.storage.from(MANIM_BUCKET).createSignedUploadUrl(path.replace(/\.mp4$/, '') + '.report.json', { upsert: true }),
  ])
  if (signErr || !signed) return { ok: false as const, error: `Could not create an upload URL: ${signErr?.message ?? 'unknown error'}` }
  await admin.from('manim_jobs').update({ status: 'rendering', error: null, attempts: attempt, video_path: path }).eq('id', job.id)
  try {
    const base = process.env.MODAL_RENDER_URL!.replace(/\/+$/, '')
    const res = await fetch(`${base}/compose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Render-Token': process.env.RENDER_TOKEN! },
      body: JSON.stringify({
        job_id: job.id, description: job.prompt.slice(0, 4000), context: context.slice(0, 3000),
        narration: narration?.text ? { text: narration.text, ms: narration.ms, words: narration.words } : null,
        upload_url: signed.signedUrl, paths_upload_url: penSigned?.signedUrl ?? null, report_upload_url: repSigned?.signedUrl ?? null,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`render service answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return { ok: true as const }
  } catch (err) {
    const error = `Could not reach the composer: ${err instanceof Error ? err.message : String(err)}`
    await admin.from('manim_jobs').update({ status: 'failed', error }).eq('id', job.id)
    return { ok: false as const, error }
  }
}

/**
 * Free-form animation (modal_app/gm_freeform.py), used by the agent's animate_concept tool: the render service plans a
 * storyboard, has the model write a full Manim scene, renders it in a network-less sandbox, repairs errors from the
 * traceback (max 3), checks the layout (overlaps, off-frame, phone-legible text) and a few frames with a vision model,
 * repairs once, then renders the clip. If that fails it runs the template composer (dispatchCompose's path) itself, so the
 * callback contract is the same as /compose. A render service without /freeform (older deploy) gets /compose.
 * Its loop report (attempts, repairs, layout issues, critique, timings) goes next to the clip as `<n>.ff.json`.
 */
export async function dispatchFreeform(admin: SupabaseClient, job: Pick<ManimJob, 'id' | 'attempts'> & { prompt: string }, context = '', aspect: '16:9' | '9:16' = '16:9') {
  if (!renderServiceConfigured()) return { ok: false as const, error: 'render service not configured' }
  const attempt = job.attempts + 1
  const path = `${job.id}/${attempt}.mp4`
  const base = path.replace(/\.mp4$/, '')
  const sign = (p: string) => admin.storage.from(MANIM_BUCKET).createSignedUploadUrl(p, { upsert: true })
  const [{ data: signed, error: signErr }, { data: penSigned }, { data: repSigned }, { data: ffSigned }] = await Promise.all([
    sign(path), sign(penPathFor(path)), sign(`${base}.report.json`), sign(`${base}.ff.json`),
  ])
  if (signErr || !signed) return { ok: false as const, error: `Could not create an upload URL: ${signErr?.message ?? 'unknown error'}` }
  await admin.from('manim_jobs').update({ status: 'rendering', error: null, attempts: attempt, video_path: path }).eq('id', job.id)
  // What the engine has learned from recurring layout failures: bounded solver weights + avoid-notes for the scene writer.
  const tuning = await layoutTuning(admin).catch(() => null)
  try {
    const res = await fetch(`${process.env.MODAL_RENDER_URL!.replace(/\/+$/, '')}/freeform`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Render-Token': process.env.RENDER_TOKEN! },
      body: JSON.stringify({
        job_id: job.id, description: job.prompt.slice(0, 4000), context: context.slice(0, 3000), narration: null, aspect,
        upload_url: signed.signedUrl, paths_upload_url: penSigned?.signedUrl ?? null, report_upload_url: repSigned?.signedUrl ?? null,
        ff_report_upload_url: ffSigned?.signedUrl ?? null, tuning,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (res.status === 404) return dispatchCompose(admin, { ...job, attempts: job.attempts }, null, context)
    if (!res.ok) throw new Error(`render service answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return { ok: true as const }
  } catch (err) {
    const error = `Could not reach the free-form renderer: ${err instanceof Error ? err.message : String(err)}`
    await admin.from('manim_jobs').update({ status: 'failed', error }).eq('id', job.id)
    return { ok: false as const, error }
  }
}

async function vetForRender(code: string, prompt: string | null): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const v = vetManimCode(code)
  if (!v.error) return { ok: true, code: v.code }
  if (!prompt) return { ok: false, error: v.error }
  try {
    return { ok: true, code: await fixManimCode(v.code, v.error, prompt) }
  } catch (err) {
    return { ok: false, error: `${v.error}\n\nAutomatic fix failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** Adds a public video_url once the clip exists. */
export function withUrl(job: ManimJob) {
  return { ...job, video_url: job.video_path && (job.status === 'done' || job.status === 'approved') ? publicClipUrl(job.video_path) : null }
}

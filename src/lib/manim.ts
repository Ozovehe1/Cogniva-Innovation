import { timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MANIM_BUCKET, publicClipUrl } from './supabase/admin'
import { MANIM_SCENE_NAME } from './lesson-ai'

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
export async function dispatchRender(admin: SupabaseClient, job: Pick<ManimJob, 'id' | 'code' | 'attempts'>) {
  const attempt = job.attempts + 1
  const path = `${job.id}/${attempt}.mp4`
  if (!job.code) {
    await admin.from('manim_jobs').update({ status: 'failed', error: 'No code to render.' }).eq('id', job.id)
    return { ok: false as const, error: 'No code to render.' }
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

  await admin.from('manim_jobs').update({ status: 'rendering', error: null, attempts: attempt, video_path: path }).eq('id', job.id)

  try {
    const base = process.env.MODAL_RENDER_URL!.replace(/\/+$/, '')
    const res = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Render-Token': process.env.RENDER_TOKEN! },
      body: JSON.stringify({ job_id: job.id, code: job.code, scene_name: MANIM_SCENE_NAME, upload_url: signed.signedUrl }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`render service answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return { ok: true as const }
  } catch (err) {
    const error = `Could not reach the render service: ${err instanceof Error ? err.message : String(err)}`
    await admin.from('manim_jobs').update({ status: 'failed', error }).eq('id', job.id)
    return { ok: false as const, error }
  }
}

/** Adds a public video_url once the clip exists. */
export function withUrl(job: ManimJob) {
  return { ...job, video_url: job.video_path && (job.status === 'done' || job.status === 'approved') ? publicClipUrl(job.video_path) : null }
}

/**
 * Lesson videos (Download -> Video (.mp4)), rendered only when a learner asks for one.
 *
 * The Modal app (modal_app/manim_render.py, function `lesson_video`) opens the token-protected render page
 * /render/lesson/:id in headless Chrome at 1280x720. That page plays the lesson exactly as the player does (boards
 * drawn by the hand, Manim clips, KaTeX), with no controls and checks shown as a card and answered by themselves. The
 * function records the screen, rebuilds the narration track from the real audio timeline the page logs, muxes them
 * with ffmpeg, uploads the MP4 to the private lesson-videos bucket through a signed upload URL and calls back
 * /api/video/callback. A finished render is cached per lesson + script hash. Server only.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Step } from './lesson-schema'
import type { Chapter } from './lesson-sections'
import { estimateMs } from './lesson-sections'
import { NARRATION_VOICE } from './narration'
import { ensureNarration, scriptLines } from './tts-server'

export const VIDEO_BUCKET = 'lesson-videos'
/** Bump when the render page or the recorder changes what a video looks like: every cached video is re-rendered. */
export const VIDEO_RENDER_VERSION = 2
/** Per learner: one render at a time, and at most this many new renders a day (finished videos are free to download). */
export const VIDEO_DAILY_LIMIT = 5
/** Recorder overhead on top of the lesson's own running time (browser start, narration check, encode, upload). */
const OVERHEAD_MS = 90_000
/** An active job that has not reported for this long is treated as dead (the recorder reports every ~20 s). */
const STALE_RENDERING_MS = 12 * 60_000
const STALE_QUEUED_MS = 10 * 60_000

export type VideoStatus = 'queued' | 'preparing' | 'rendering' | 'done' | 'failed'

export interface LessonVideoRow {
  id: string
  lesson_id: string
  script_hash: string
  status: VideoStatus
  requested_by: string | null
  storage_path: string | null
  bytes: number | null
  duration_ms: number | null
  est_ms: number | null
  progress: number
  call_id: string | null
  error: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

/** What the client sees for a job. */
export interface VideoState {
  status: VideoStatus | 'none'
  progress: number
  /** Seconds left, roughly (null when unknown). */
  etaSec: number | null
  bytes?: number | null
  durationMs?: number | null
  error?: string | null
  cached?: boolean
}

/** Content hash of everything that changes how the video looks or sounds. */
export function videoScriptHash(lesson: { title: string; steps: Step[]; chapters: Chapter[] }): string {
  const h = createHash('sha256')
  h.update(JSON.stringify({ v: VIDEO_RENDER_VERSION, voice: NARRATION_VOICE, title: lesson.title, steps: lesson.steps, chapters: lesson.chapters.map(c => ({ t: c.title, s: c.start, n: c.count })) }))
  return h.digest('hex').slice(0, 32)
}

export function videoPath(lessonId: string, hash: string) {
  return `${lessonId}/${hash}.mp4`
}

/** Expected wall time of a render: the lesson plays in real time while it is recorded. */
export function videoEstimateMs(steps: Step[]) {
  return estimateMs(steps) + OVERHEAD_MS
}

export function isStale(row: Pick<LessonVideoRow, 'status' | 'updated_at'>) {
  const age = Date.now() - new Date(row.updated_at).getTime()
  if (row.status === 'rendering') return age > STALE_RENDERING_MS
  if (row.status === 'queued' || row.status === 'preparing') return age > STALE_QUEUED_MS
  return false
}

export function isActive(row: Pick<LessonVideoRow, 'status' | 'updated_at'>) {
  return (row.status === 'queued' || row.status === 'preparing' || row.status === 'rendering') && !isStale(row)
}

export function videoState(row: LessonVideoRow | null, cached = false): VideoState {
  if (!row) return { status: 'none', progress: 0, etaSec: null }
  if (row.status === 'done') return { status: 'done', progress: 1, etaSec: 0, bytes: row.bytes, durationMs: row.duration_ms, cached }
  if (row.status === 'failed' || isStale(row)) return { status: 'failed', progress: row.progress ?? 0, etaSec: null, error: row.status === 'failed' ? friendlyError(row.error) : 'The render stopped responding.' }
  const est = row.est_ms ?? 0
  const p = Math.max(0, Math.min(1, row.progress ?? 0))
  let left = est
  if (row.status === 'rendering' && row.started_at) {
    // Real time since the recording started, against the estimate, whichever says longer.
    const elapsed = Date.now() - new Date(row.started_at).getTime()
    left = Math.max((est - OVERHEAD_MS) * (1 - p) + 45_000, est - elapsed)
  }
  return { status: row.status, progress: p, etaSec: Math.max(15, Math.round(left / 1000)) }
}

function friendlyError(e: string | null) {
  if (!e) return 'The video could not be made.'
  const first = e.split('\n')[0].trim()
  return first.length > 160 ? first.slice(0, 157) + '…' : first
}

/* ── The render page's token ── */

function secret() {
  const s = process.env.RENDER_TOKEN
  if (!s) throw new Error('RENDER_TOKEN is not configured')
  return s
}

function sign(lessonId: string, jobId: string, exp: number) {
  return createHmac('sha256', secret()).update(`lesson-video:${lessonId}:${jobId}:${exp}`).digest('base64url')
}

/** URL of the render page for one job; valid for `ttlMs` (long enough for the longest lesson to play through). */
export function renderPageUrl(origin: string, lessonId: string, jobId: string, ttlMs: number) {
  const exp = Math.floor((Date.now() + ttlMs) / 1000)
  // hand=photo: the photographic hand (the player's own fallback). The 3D hand renders in software on the recorder's
  // CPU-only container and halved the captured frame rate (~11 fps instead of ~25).
  return `${origin}/render/lesson/${lessonId}?job=${jobId}&exp=${exp}&sig=${sign(lessonId, jobId, exp)}&hand=photo`
}

export function verifyRenderToken(lessonId: string, jobId: string | undefined, exp: string | undefined, sig: string | undefined) {
  if (!jobId || !exp || !sig || !/^\d+$/.test(exp)) return false
  if (Number(exp) * 1000 < Date.now()) return false
  let expected: string
  try { expected = sign(lessonId, jobId, Number(exp)) } catch { return false }
  const a = Buffer.from(sig), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/* ── Dispatch to Modal ── */

export function videoServiceConfigured() {
  return !!process.env.MODAL_RENDER_URL && !!process.env.RENDER_TOKEN
}

/** Ask the Modal recorder to render this job. Updates the row with the outcome. */
export async function dispatchVideo(db: SupabaseClient, row: Pick<LessonVideoRow, 'id' | 'lesson_id' | 'script_hash' | 'est_ms'>, origin: string) {
  const fail = async (error: string) => {
    await db.from('lesson_videos').update({ status: 'failed', error, updated_at: new Date().toISOString() }).eq('id', row.id)
    return { ok: false as const, error }
  }
  if (!videoServiceConfigured()) return fail('The video service is not connected (MODAL_RENDER_URL).')
  const path = videoPath(row.lesson_id, row.script_hash)
  const { data: signed, error: signErr } = await db.storage.from(VIDEO_BUCKET).createSignedUploadUrl(path, { upsert: true })
  if (signErr || !signed) return fail(`Could not create an upload URL: ${signErr?.message ?? 'unknown error'}`)
  const est = row.est_ms ?? 30 * 60_000
  const maxS = Math.round((est * 1.6 + 10 * 60_000) / 1000)
  const pageUrl = renderPageUrl(origin, row.lesson_id, row.id, est * 2 + 60 * 60_000)
  try {
    const base = process.env.MODAL_RENDER_URL!.replace(/\/+$/, '')
    const res = await fetch(`${base}/video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Render-Token': process.env.RENDER_TOKEN! },
      body: JSON.stringify({ job_id: row.id, page_url: pageUrl, upload_url: signed.signedUrl, max_s: maxS, callback_url: `${origin}/api/video/callback` }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`video service answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const j = await res.json().catch(() => ({})) as { call_id?: string }
    await db.from('lesson_videos').update({ status: 'rendering', storage_path: path, call_id: j.call_id ?? null, started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', row.id)
    return { ok: true as const }
  } catch (err) {
    return fail(`Could not reach the video service: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Remove every rendered video of these lessons (files and rows). Throws when storage refuses. */
export async function purgeLessonVideos(db: SupabaseClient, lessonIds: string[]) {
  const rows: { id: string; lesson_id: string; script_hash: string; storage_path: string | null }[] = []
  for (let i = 0; i < lessonIds.length; i += 100) {
    const { data } = await db.from('lesson_videos').select('id, lesson_id, script_hash, storage_path').in('lesson_id', lessonIds.slice(i, i + 100))
    rows.push(...((data ?? []) as typeof rows))
  }
  const files = [...new Set(rows.flatMap(r => [r.storage_path ?? '', videoPath(r.lesson_id, r.script_hash)]).filter(Boolean))]
  for (let i = 0; i < files.length; i += 100) {
    const { error } = await db.storage.from(VIDEO_BUCKET).remove(files.slice(i, i + 100))
    if (error) throw new Error(`${VIDEO_BUCKET}: ${error.message}`)
  }
  const ids = rows.map(r => r.id)
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await db.from('lesson_videos').delete().in('id', ids.slice(i, i + 100))
    if (error) throw new Error(error.message)
  }
}

/**
 * Make sure every spoken line of the script is in the narration cache before recording (the render page has no
 * session, so it can only play cached lines). Cached lines cost one lookup; missing ones are voiced within a budget.
 * Returns how many lines are still missing (those would be silent in the video).
 */
export async function voiceForVideo(steps: Step[], budgetMs = 180_000): Promise<{ lines: number; missing: number }> {
  const t0 = Date.now()
  const lines = scriptLines(steps)
  const first = await ensureNarration(lines, { cacheOnly: true }).catch(() => null)
  let missing = first ? lines.filter((_, i) => !first.clips[i]) : lines
  for (let k = 0; k < missing.length && Date.now() - t0 < budgetMs; k += 6) {
    await ensureNarration(missing.slice(k, k + 6), { timeoutMs: Math.max(30_000, Math.min(120_000, budgetMs - (Date.now() - t0))) }).catch(() => null)
  }
  if (missing.length) {
    const again = await ensureNarration(missing, { cacheOnly: true }).catch(() => null)
    missing = again ? missing.filter((_, i) => !again.clips[i]) : missing
  }
  return { lines: lines.length, missing: missing.length }
}

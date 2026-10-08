/**
 * Lesson videos (Download -> Video (.mp4)), rendered only when a learner asks for one.
 *
 * The Modal app (modal_app/manim_render.py, functions `lesson_video` + `lesson_video_part`) renders the token-protected
 * page /render/lesson/:id in headless Chrome at 1280x720. That page plays the lesson exactly as the player does (boards
 * drawn by the hand, Manim clips, KaTeX), with no controls and checks shown as a card and answered by themselves.
 * The page runs on a virtual clock and is captured frame by frame as fast as the CPU allows (not in real time), and
 * the lesson is cut into short parts (planVideoParts) that render side by side and are joined, so any lesson is ready
 * in well under two minutes. The renderer reads every narration line and clip from Storage once (videoAssets) and
 * hands each part its own files. The narration track is rebuilt from the timeline the page logs. The MP4 goes to the private
 * lesson-videos bucket through a signed upload URL and /api/video/callback is called. A finished render is cached per
 * lesson + script hash. Server only.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Step } from './lesson-schema'
import type { Chapter } from './lesson-sections'
import { estimateStepMs } from './lesson-sections'
import { NARRATION_VOICE, audioPaths, audioPublicBase, narrationKey } from './narration'
import { normalizeSpoken, MAX_TTS_CHARS } from './narration'
import { stepSpeech } from '@/components/whiteboard/speech'
import { ensureNarration } from './tts-server'

export const VIDEO_BUCKET = 'lesson-videos'
/** Bump when the render page or the recorder changes what a video looks like: every cached video is re-rendered. */
export const VIDEO_RENDER_VERSION = 4
/** Per learner: one render at a time, and at most this many new renders a day (finished videos are free to download). */
export const VIDEO_DAILY_LIMIT = 5
/** Render cost per part (see RENDER_WEIGHT; ms of lesson at full weight): parts render side by side in ~20-60 s. */
const PART_MS = 8_000
/** More parts than this and they get longer instead (cost, and Modal's 100-container cap on the account's plan). */
const MAX_PARTS = 90
/** Expected wall time of a render, whatever the lesson's length (containers start, parts render, join, upload). */
const RENDER_MS = 60_000
/** An active job that has not reported for this long is treated as dead (the renderer reports every few seconds). */
const STALE_RENDERING_MS = 6 * 60_000
const STALE_QUEUED_MS = 5 * 60_000

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

/** Expected wall time of a render. Parts render in parallel, so it barely depends on the lesson's length. */
export function videoEstimateMs(steps: Step[]) {
  const total = steps.reduce((t, s, i) => t + estimateStepMs(s, i), 0)
  return Math.round(RENDER_MS + Math.max(0, total / MAX_PARTS - PART_MS) * 1.5)
}

/** Real length of each clip of the lesson in ms, from the pen paths saved beside it (missing ones are left out). */
export async function clipDurations(steps: Step[], timeoutMs = 4000): Promise<Map<string, number>> {
  const urls = [...new Set(steps.flatMap(s => (s.type === 'manim_clip' && /\.mp4(\?|$)/i.test(s.url) ? [s.url] : [])))]
  const out = new Map<string, number>()
  await Promise.all(urls.map(async u => {
    try {
      const r = await fetch(u.replace(/\.mp4(\?.*)?$/i, '.pen.json'), { signal: AbortSignal.timeout(timeoutMs) })
      if (!r.ok) return
      const j = await r.json() as { duration?: number }
      if (typeof j.duration === 'number' && j.duration > 0) out.set(u, Math.round(j.duration * 1000) + 400)
    } catch { /* unknown: the estimate stands */ }
  }))
  return out
}

/**
 * Every Storage file the parts will read (narration audio + timings, clips + their pen paths), in part order, and the
 * indices each part needs. The renderer downloads them once and serves them to its parts' browsers.
 */
export async function videoAssets(steps: Step[], parts: VideoPart[]): Promise<{ urls: string[]; perPart: number[][] }> {
  const base = audioPublicBase()
  const urls: string[] = []
  const index = new Map<string, number>()
  const add = (u: string) => {
    let k = index.get(u)
    if (k === undefined) { k = urls.length; urls.push(u); index.set(u, k) }
    return k
  }
  const keys = new Map<string, string>()
  const perPart: number[][] = []
  for (const [from, to] of parts) {
    const mine = new Set<number>()
    for (const s of steps.slice(from, to)) {
      const text = normalizeSpoken(stepSpeech(s)).slice(0, MAX_TTS_CHARS)
      if (text && base.startsWith('http')) {
        let key = keys.get(text)
        if (!key) { key = await narrationKey(text); keys.set(text, key) }
        const p = audioPaths(key)
        mine.add(add(`${base}/${p.json}`)); mine.add(add(`${base}/${p.mp3}`))
      }
      if (s.type === 'manim_clip' && /^https:\/\//.test(s.url)) {
        const clip = s.url.split('?')[0]
        mine.add(add(clip))
        if (/\.mp4$/i.test(clip)) mine.add(add(clip.replace(/\.mp4$/i, '.pen.json')))
      }
    }
    perPart.push([...mine])
  }
  return { urls, perPart }
}

/** A part: steps [from, to), or one piece of a long clip step: [step, step + 1, skip ms into it, length ms (0: to its end)]. */
export type VideoPart = [number, number] | [number, number, number, number]

/**
 * Render cost per second of lesson, by step type: a clip changes every frame (every frame is drawn), a check sits
 * still on the board for most of its time, drawing and narration are in between (measured: ~70% of frames drawn).
 */
const RENDER_WEIGHT: Partial<Record<Step['type'], number>> = { manim_clip: 1, check: 0.15, clear: 0.3 }
const DEFAULT_WEIGHT = 0.75
/** A clip piece shorter than this is not worth its own container (start-up, opening the page, stepping to its start). */
const MIN_PIECE_MS = 8_000
const FRAME_MS = 40

/**
 * Cut the lesson into parts for parallel rendering. Each part starts from the board as it stands at its first step,
 * so any step can start one, and a long clip step is cut into pieces (the part steps through the clip up to its piece
 * without drawing it). The slowest part sets the render time, so parts are balanced by render cost (RENDER_WEIGHT),
 * not lesson time: the longest part is made as short as the part count allows, then the rest are spread evenly.
 */
export function planVideoParts(steps: Step[], clipMs?: Map<string, number>): { parts: VideoPart[]; totalMs: number; steps: Step[]; partMs?: number[] } {
  // A clip plays to its end: its real length (when known) beats the narration estimate.
  const ms = steps.map((s, i) => Math.max(estimateStepMs(s, i), s.type === 'manim_clip' ? (clipMs?.get(s.url) ?? 0) : 0))
  const totalMs = ms.reduce((a, b) => a + b, 0)
  if (!steps.length) return { parts: [], totalMs, steps }
  const cost = steps.map((s, i) => ms[i] * (RENDER_WEIGHT[s.type] ?? DEFAULT_WEIGHT))
  const totalCost = cost.reduce((a, b) => a + b, 0)
  const n = Math.max(1, Math.min(MAX_PARTS, Math.round(totalCost / PART_MS)))

  type Unit = { from: number; to: number; cost: number; skip?: number; len?: number }
  const build = (splitAbove: number): Unit[] => {
    const units: Unit[] = []
    steps.forEach((s, i) => {
      const real = s.type === 'manim_clip' ? clipMs?.get(s.url) : undefined
      const k = real && cost[i] > splitAbove ? Math.min(6, Math.floor(real / MIN_PIECE_MS), Math.ceil(cost[i] / splitAbove)) : 1
      if (k < 2 || !real) { units.push({ from: i, to: i + 1, cost: cost[i] }); return }
      const at = (j: number) => Math.round((real * j) / k / FRAME_MS) * FRAME_MS
      for (let j = 0; j < k; j++) units.push({ from: i, to: i + 1, cost: cost[i] / k, skip: at(j), len: j < k - 1 ? at(j + 1) - at(j) : 0 })
    })
    return units
  }
  const piece = (u: Unit) => u.skip !== undefined
  // Greedy packing of units into parts of at most `limit` cost (a clip piece is always a part of its own).
  const pack = (units: Unit[], limit: number) => {
    const bounds = [0]
    let acc = 0
    units.forEach((u, i) => {
      if (acc > 0 && (acc + u.cost > limit || piece(u) || piece(units[i - 1]))) { bounds.push(i); acc = 0 }
      acc += u.cost
    })
    bounds.push(units.length)
    return bounds
  }
  const plan = (units: Unit[]) => {
    let lo = Math.max(...units.map(u => u.cost), totalCost / n), hi = Math.max(lo, totalCost)
    if (pack(units, hi).length - 1 > n) return null
    for (let k = 0; k < 40 && hi - lo > 50; k++) {
      const mid = (lo + hi) / 2
      if (pack(units, mid).length - 1 <= n) hi = mid
      else lo = mid
    }
    // Spread the units over all n parts without exceeding that cost: every part is as short as it can be, so a part
    // that lands on a slow host costs less (cut nearest each part's even share of what is left).
    const bounds = [0]
    let acc = 0, left = totalCost
    units.forEach((u, i) => {
      const partsLeft = n - (bounds.length - 1)
      const share = left / Math.max(1, partsLeft)
      if (acc > 0 && partsLeft > 1 && (acc + u.cost > hi || acc + u.cost / 2 > share || piece(u) || piece(units[i - 1]))) { bounds.push(i); left -= acc; acc = 0 }
      acc += u.cost
    })
    bounds.push(units.length)
    const sum = (b: number[], k: number) => units.slice(b[k], b[k + 1]).reduce((x, y) => x + y.cost, 0)
    const ok = bounds.length - 1 <= n && bounds.slice(1).every((_, k) => sum(bounds, k) <= hi + 1)
    const fin = ok ? bounds : pack(units, hi)
    return { units, bounds: fin, longest: Math.max(...fin.slice(1).map((_, k) => sum(fin, k))) }
  }
  // Clip pieces only when they make the longest part shorter (each piece pays its own start-up).
  let best = plan(build(Infinity))!
  for (const f of [1.25, 1]) {
    const alt = plan(build(Math.max(MIN_PIECE_MS, (totalCost / n) * f)))
    if (alt && alt.longest < best.longest - 2_000) best = alt
  }
  const { units, bounds } = best
  const parts: VideoPart[] = []
  const partMs: number[] = []
  for (let k = 0; k + 1 < bounds.length; k++) {
    const us = units.slice(bounds[k], bounds[k + 1])
    const u = us[0]
    parts.push(piece(u) ? [u.from, u.to, u.skip!, u.len!] : [u.from, us[us.length - 1].to])
    partMs.push(Math.round(us.reduce((x, y) => x + y.cost, 0)))
  }
  return { parts, totalMs, steps, partMs }
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
  const est = row.est_ms ?? RENDER_MS
  const p = Math.max(0, Math.min(1, row.progress ?? 0))
  // Time since the learner asked, against the estimate; never promises less than a few seconds.
  const elapsed = Date.now() - new Date(row.created_at).getTime()
  const left = Math.max(est * (1 - p) * 0.9, est - elapsed)
  return { status: row.status, progress: p, etaSec: Math.max(5, Math.round(left / 1000)) }
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

/** URL of the render page for one job; valid for `ttlMs`. The renderer adds &from=&to= for each part. */
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
export async function dispatchVideo(db: SupabaseClient, row: Pick<LessonVideoRow, 'id' | 'lesson_id' | 'script_hash'>, origin: string, plan: { parts: VideoPart[]; totalMs: number; steps: Step[]; partMs?: number[] }) {
  const fail = async (error: string) => {
    await db.from('lesson_videos').update({ status: 'failed', error, updated_at: new Date().toISOString() }).eq('id', row.id)
    return { ok: false as const, error }
  }
  if (!videoServiceConfigured()) return fail('The video service is not connected (MODAL_RENDER_URL).')
  const path = videoPath(row.lesson_id, row.script_hash)
  const { data: signed, error: signErr } = await db.storage.from(VIDEO_BUCKET).createSignedUploadUrl(path, { upsert: true })
  if (signErr || !signed) return fail(`Could not create an upload URL: ${signErr?.message ?? 'unknown error'}`)
  const { parts, totalMs } = plan
  // A cap on any one part's video length (a page that never finishes is stopped).
  const maxS = Math.round(Math.min(4 * 3600 - 900, Math.max(600, (totalMs * 3) / 1000)))
  const pageUrl = renderPageUrl(origin, row.lesson_id, row.id, 2 * 3600_000)
  const assets = await videoAssets(plan.steps, parts).catch(() => null)
  try {
    const base = process.env.MODAL_RENDER_URL!.replace(/\/+$/, '')
    const res = await fetch(`${base}/video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Render-Token': process.env.RENDER_TOKEN! },
      body: JSON.stringify({ job_id: row.id, page_url: pageUrl, upload_url: signed.signedUrl, max_s: maxS, callback_url: `${origin}/api/video/callback`, parts, total_s: totalMs / 1000, asset_urls: assets?.urls, part_assets: assets?.perPart, part_ms: plan.partMs }),
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
 * Make sure every spoken line of the script is in the narration cache before rendering (the render page has no
 * session, so it can only play cached lines). Cached lines cost one lookup; missing ones are voiced in parallel
 * batches within a budget. Returns how many lines are still missing (those would be silent in the video).
 */
export async function voiceForVideo(steps: Step[], budgetMs = 45_000): Promise<{ lines: number; missing: number }> {
  const t0 = Date.now()
  // Only the lines the video speaks (a recorded check never re-teaches).
  const lines = [...new Set(steps.map(s => normalizeSpoken(stepSpeech(s)).slice(0, MAX_TTS_CHARS)).filter(Boolean))]
  const first = await ensureNarration(lines, { cacheOnly: true }).catch(() => null)
  let missing = first ? lines.filter((_, i) => !first.clips[i]) : lines
  if (missing.length) {
    const batches: string[][] = []
    for (let k = 0; k < missing.length; k += 4) batches.push(missing.slice(k, k + 4))
    let next = 0
    // The voice service runs several containers with a few requests each: keep 8 batches in flight.
    await Promise.all(Array.from({ length: Math.min(8, batches.length) }, async () => {
      while (next < batches.length && Date.now() - t0 < budgetMs) {
        const b = batches[next++]
        await ensureNarration(b, { timeoutMs: Math.max(15_000, budgetMs - (Date.now() - t0)) }).catch(() => null)
      }
    }))
    const again = await ensureNarration(missing, { cacheOnly: true }).catch(() => null)
    missing = again ? missing.filter((_, i) => !again.clips[i]) : missing
  }
  return { lines: lines.length, missing: missing.length }
}

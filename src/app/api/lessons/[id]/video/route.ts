import { NextResponse, after } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateScript, type Step } from '@/lib/lesson-schema'
import { LESSON_MAX_STEPS, normalizeChapters, type Chapter } from '@/lib/lesson-sections'
import { exportFileName } from '@/lib/lesson-export'
import {
  VIDEO_BUCKET, VIDEO_DAILY_LIMIT, dispatchVideo, isActive, planVideoParts, videoEstimateMs, videoPath, videoScriptHash,
  videoServiceConfigured, videoState, voiceForVideo, type LessonVideoRow,
} from '@/lib/lesson-video'

export const dynamic = 'force-dynamic'
// Starting a render first makes sure every line is voiced (cached lines are one lookup each, missing ones in parallel).
export const maxDuration = 300

const COLS = 'id, lesson_id, script_hash, status, requested_by, storage_path, bytes, duration_ms, est_ms, progress, call_id, error, started_at, finished_at, created_at, updated_at'

type Loaded = { id: string; title: string; steps: Step[]; chapters: Chapter[]; hash: string }

/**
 * The lesson, if this learner may open it: their own AI lesson or a shared approved one, read with their session so
 * RLS applies (the same rule as the export route).
 */
async function load(id: string): Promise<{ lesson: Loaded; profileId: string } | NextResponse> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data } = await supabase.from('lessons').select('id, title, script, chapters, status, owner_student_id, draft_status').eq('id', id).maybeSingle()
  const l = data as { id: string; title: string; script: unknown; chapters: unknown; status: string; owner_student_id: string | null; draft_status: string | null } | null
  if (!l || (l.owner_student_id !== profile.id && l.status !== 'approved')) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { steps } = validateScript(l.script, { maxSteps: LESSON_MAX_STEPS })
  if (!steps.length) return NextResponse.json({ error: 'This lesson is still being written.' }, { status: 409 })
  if (['outlining', 'drafting', 'paused'].includes(l.draft_status ?? '')) return NextResponse.json({ error: 'Your tutor is still writing this lesson. The video can be made once it’s finished.' }, { status: 409 })
  const chapters = normalizeChapters(l.chapters, steps.length, l.title, steps)
  return { lesson: { id: l.id, title: l.title, steps, chapters, hash: videoScriptHash({ title: l.title, steps, chapters }) }, profileId: profile.id }
}

async function current(db: ReturnType<typeof createAdminClient>, lesson: Loaded) {
  const { data } = await db.from('lesson_videos').select(COLS).eq('lesson_id', lesson.id).eq('script_hash', lesson.hash).maybeSingle()
  return data as LessonVideoRow | null
}

/**
 * GET /api/lessons/:id/video            -> { status, progress, etaSec, ... } for the current script
 * GET /api/lessons/:id/video?download=1 -> 302 to a short-lived signed link that downloads the MP4
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await load(id)
  if (r instanceof NextResponse) return r
  const db = createAdminClient()
  const row = await current(db, r.lesson)
  if (new URL(request.url).searchParams.get('download') === '1') {
    if (!row || row.status !== 'done') return NextResponse.json({ error: 'The video is not ready yet.' }, { status: 409 })
    const { data, error } = await db.storage.from(VIDEO_BUCKET).createSignedUrl(row.storage_path ?? videoPath(row.lesson_id, row.script_hash), 600, { download: exportFileName(r.lesson.title, 'mp4') })
    if (error || !data) return NextResponse.json({ error: 'The video file could not be found. Tap Video again to remake it.' }, { status: 404 })
    return NextResponse.redirect(data.signedUrl, { status: 302, headers: { 'Cache-Control': 'private, no-store' } })
  }
  return NextResponse.json(videoState(row), { headers: { 'Cache-Control': 'private, no-store' } })
}

/**
 * POST /api/lessons/:id/video -> start (or join) the render of the current script.
 * A finished video for this script is returned at once (no re-render); a render already running for it is joined
 * (repeated taps never start a second one). New renders: one at a time per learner, VIDEO_DAILY_LIMIT a day.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await load(id)
  if (r instanceof NextResponse) return r
  const { lesson, profileId } = r
  const db = createAdminClient()
  const existing = await current(db, lesson)
  if (existing?.status === 'done') {
    // Cached: make sure the file is still there before promising it.
    const { data: files } = await db.storage.from(VIDEO_BUCKET).list(lesson.id, { search: `${lesson.hash}.mp4` })
    if (files?.some(f => f.name === `${lesson.hash}.mp4`)) return NextResponse.json(videoState(existing, true))
  }
  if (existing && isActive(existing)) return NextResponse.json(videoState(existing))
  if (!videoServiceConfigured()) return NextResponse.json({ error: 'Video downloads are not available right now.' }, { status: 503 })

  // Limits on new renders (a cached download above never counts).
  const { data: mine } = await db.from('lesson_videos').select('id, status, updated_at, created_at, lesson_id').eq('requested_by', profileId).gte('created_at', new Date(Date.now() - 24 * 3600_000).toISOString())
  const recent = (mine ?? []) as Pick<LessonVideoRow, 'id' | 'status' | 'updated_at' | 'created_at' | 'lesson_id'>[]
  if (recent.some(v => v.id !== existing?.id && isActive(v))) return NextResponse.json({ error: 'Another of your videos is still being made. Try this one when it finishes.' }, { status: 429 })
  if (recent.filter(v => v.id !== existing?.id).length >= VIDEO_DAILY_LIMIT) return NextResponse.json({ error: `You can make ${VIDEO_DAILY_LIMIT} lesson videos a day. Videos you’ve already made still download.` }, { status: 429 })

  const now = new Date().toISOString()
  const fields = { status: 'queued' as const, requested_by: profileId, est_ms: videoEstimateMs(lesson.steps), progress: 0, error: null, call_id: null, storage_path: null, bytes: null, duration_ms: null, started_at: null, finished_at: null, updated_at: now }
  let row: LessonVideoRow | null = null
  if (existing) {
    // A failed, stale or vanished render of this script: take it over (only if nobody else just did).
    const { data } = await db.from('lesson_videos').update({ ...fields, created_at: now }).eq('id', existing.id).eq('updated_at', existing.updated_at).select(COLS).maybeSingle()
    row = data as LessonVideoRow | null
    if (!row) { const again = await current(db, lesson); return NextResponse.json(videoState(again)) }
  } else {
    const { data, error } = await db.from('lesson_videos').insert({ lesson_id: lesson.id, script_hash: lesson.hash, ...fields }).select(COLS).maybeSingle()
    if (error || !data) {
      // A double tap raced us to the insert (unique lesson + script): join that one.
      const again = await current(db, lesson)
      if (again) return NextResponse.json(videoState(again))
      return NextResponse.json({ error: 'Could not start the video. Please try again.' }, { status: 500 })
    }
    row = data as LessonVideoRow
  }

  const origin = new URL(request.url).origin
  const job = row
  after(async () => {
    await db.from('lesson_videos').update({ status: 'preparing', updated_at: new Date().toISOString() }).eq('id', job.id)
    // Missing narration is voiced first (in parallel; normally every line is already cached), then the parts render.
    const voiced = await voiceForVideo(lesson.steps).catch(() => null)
    const plan = planVideoParts(lesson.steps)
    await db.from('lesson_videos').update({ meta: { lines: voiced?.lines ?? null, unvoiced: voiced?.missing ?? null, parts: plan.parts.length, est_lesson_ms: Math.round(plan.totalMs) } }).eq('id', job.id)
    await dispatchVideo(db, job, origin, plan)
  })
  return NextResponse.json(videoState(row), { status: 202 })
}

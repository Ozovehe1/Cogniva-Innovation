/**
 * Background drafting of AI lessons (server only), free-tier friendly.
 *
 * A lesson is planned as many small beats (about 45-90 s each: a demonstration, a
 * worked example, a check or a "your turn"), and each beat is written by its own
 * small model call with the plan in context and the board as the previous beat left
 * it (see lesson-beats.ts). The opening beat is written in parallel with the plan and
 * published at once, so playback starts while the rest is written. Each beat is
 * published as soon as it is ready; length is steered by the worker (optional beats
 * when behind schedule, extra practice before the closing beat), not by the model.
 *
 * One worker holds a lease on the lesson (lessons.draft_lock_until) so client polls,
 * the self-chain and the cron ticks never draft the same lesson twice. A worker
 * drafts until its time budget runs low, then hands over to a fresh invocation.
 * When Gemini's quota is exhausted the job pauses (drafted beats are kept) and the
 * once-a-minute Supabase pg_cron tick (or a page poll) resumes it after draft_retry_at,
 * so drafting carries on with no page open.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from './supabase/admin'
import { withPlaybook } from './playbook/context'
import { GeminiQuotaError, isRetryable } from './gemini'
import { withLlmContext } from './agent/pool'
import type { GenMeta } from './lesson-ai'
import { EXTRA_PREFIX, HOOK_SECONDS, MAX_BEATS, MAX_EXTRA_BEATS, draftBeat, extraBeat, hookPlan, planLessonBeats, traceSummary, type BeatKind, type BeatPlan } from './lesson-beats'
import { flattenSections, type Chapter } from './lesson-sections'
import type { Step } from './lesson-schema'
import { lengthReport } from './lesson-timing'
import { pregenerateNarration, warmTts } from './tts-server'
import { attachReadyClips, queueLessonClip } from './lesson-clip'

const LOCK_MS = 295_000
/** Routes run with maxDuration 300: all work (and the hand-over call) ends by this point. */
const HARD_END_MS = 265_000
/** Don't start a beat with less than this left before HARD_END_MS. */
const BEAT_RESERVE_MS = 85_000
/** One beat (its call, a repair and fallbacks) must finish within this. */
const BEAT_DEADLINE_MS = 75_000
/** Short rate-limit waits are slept through inside the worker instead of pausing. */
const MAX_INLINE_WAIT_MS = 65_000
/**
 * Beats are written far faster than they play (a few seconds each vs about a minute), so after
 * a small head start the worker spaces its calls: at most ~8 a minute per lesson keeps one lesson
 * well under the free-tier per-minute limits and leaves room for other lessons and instances.
 */
const BEAT_SPACING_MS = 7_500
const HEAD_START_BEATS = 3
/** A beat that fails this many times is dropped (later beats never wait on it). */
const BEAT_ATTEMPTS = 3
/**
 * A first lesson drafted ahead during the diagnostic (not yet attached to a path topic, see
 * speculation.ts) stops after this many ready beats: enough for an instant start, little quota
 * lost if the diagnostic lands elsewhere. It carries on when the diagnostic attaches it.
 */
export const SPECULATIVE_BEATS = 4
export const SPECULATIVE_PAUSE = 'speculative'
export type DraftStatus = 'idle' | 'outlining' | 'drafting' | 'paused' | 'ready' | 'partial' | 'failed'
export type SectionStatus = 'pending' | 'drafting' | 'ready' | 'failed' | 'skipped'

export interface SectionRow {
  id: string
  lesson_id: string
  position: number
  title: string
  goal: string
  key_points: string[]
  minutes: number
  status: SectionStatus
  steps: Step[]
  notes: string | null
  error: string | null
  attempts: number
  expansions?: number | null
  play_ms?: number | null
  draft_model?: string | null
  kind?: string | null
  chapter?: string | null
  optional?: boolean | null
  seconds?: number | null
  updated_at: string
}

interface LessonJobRow {
  id: string
  title: string
  subject: string
  objectives: string[] | null
  target_minutes: number | null
  draft_status: DraftStatus
  draft_notes: string | null
  draft_retry_at: string | null
  draft_lock_until: string | null
  generated_by?: string | null
  owner_student_id?: string | null
  created_at?: string | null
}

const JOB_COLS = 'id, title, subject, objectives, target_minutes, draft_status, draft_notes, draft_retry_at, draft_lock_until, generated_by, created_at, owner_student_id'

/* ───────────── Internal auth for the self-chain ───────────── */

export function draftKey(lessonId: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  return createHmac('sha256', secret).update(`lesson-draft:${lessonId}`).digest('hex')
}

export function checkDraftKey(lessonId: string, key: string | null) {
  if (!key || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false
  const a = Buffer.from(draftKey(lessonId))
  const b = Buffer.from(key)
  return a.length === b.length && timingSafeEqual(a, b)
}

/* ───────────── Helpers ───────────── */

async function claim(db: SupabaseClient, id: string) {
  const now = new Date().toISOString()
  const { data } = await db
    .from('lessons')
    .update({ draft_lock_until: new Date(Date.now() + LOCK_MS).toISOString() })
    .eq('id', id)
    .or(`draft_lock_until.is.null,draft_lock_until.lt.${now}`)
    .select('id')
  return Array.isArray(data) && data.length > 0
}

async function release(db: SupabaseClient, id: string) {
  await db.from('lessons').update({ draft_lock_until: null }).eq('id', id)
}

export async function loadSections(db: SupabaseClient, lessonId: string): Promise<SectionRow[]> {
  const { data } = await db.from('lesson_sections').select('*').eq('lesson_id', lessonId).order('position', { ascending: true })
  return (data ?? []) as SectionRow[]
}

/** Rebuild lessons.script and lessons.chapters from the ready sections. */
export async function syncLessonScript(db: SupabaseClient, lessonId: string, sections?: SectionRow[]): Promise<{ steps: Step[]; chapters: Chapter[] }> {
  const rows = sections ?? await loadSections(db, lessonId)
  const flat = flattenSections(rows.filter(r => r.status === 'ready').map(r => ({ id: r.id, title: r.title, chapter: r.chapter ?? null, steps: r.steps })))
  await db.from('lessons').update({ script: flat.steps, chapters: flat.chapters }).eq('id', lessonId)
  return flat
}

/** When to try again after a quota error. */
function retryAt(err: GeminiQuotaError) {
  // The pool spans many keys and models: one model's daily window is rarely all of them, and a learner may be
  // watching the lesson wait on its next section (measured: a fresh lesson paused 30 min after its opening beat while
  // other slots were healthy). Retry within 3 minutes; the pool itself paces background work.
  const wait = Math.min(3 * 60_000, err.daily ? 3 * 60_000 : Math.max(60_000, err.retryAfterMs ?? 90_000))
  return new Date(Date.now() + wait).toISOString()
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function chain(origin: string | undefined, lessonId: string) {
  if (!origin) return
  try {
    await fetch(`${origin}/api/lessons/${lessonId}/draft/run`, {
      method: 'POST',
      headers: { 'x-draft-key': draftKey(lessonId) },
      signal: AbortSignal.timeout(8000),
    })
  } catch (err) {
    // The client poll or the cron picks the job up instead.
    console.warn('Draft chain failed:', err instanceof Error ? err.message : err)
  }
}

/** Is there work a worker could do right now? */
export function needsWorker(l: { draft_status: string; draft_retry_at: string | null; draft_lock_until: string | null }) {
  const now = Date.now()
  const locked = l.draft_lock_until && new Date(l.draft_lock_until).getTime() > now
  if (locked) return false
  if (l.draft_status === 'outlining' || l.draft_status === 'drafting') return true
  if (l.draft_status === 'paused') return !l.draft_retry_at || new Date(l.draft_retry_at).getTime() <= now
  return false
}

/* ───────────── The worker ───────────── */

export function toPlan(r: SectionRow): BeatPlan {
  return { chapter: r.chapter ?? r.title, title: r.title, kind: (r.kind ?? 'demo') as BeatKind, seconds: r.seconds ?? Math.round((Number(r.minutes) || 1) * 60), points: r.key_points ?? [], optional: !!r.optional }
}

function beatRow(lessonId: string, position: number, b: BeatPlan) {
  // Every row carries every column: a bulk insert fills keys missing from some rows with null.
  return {
    lesson_id: lessonId, position, title: b.title, goal: b.points.join('; ').slice(0, 400), key_points: b.points, minutes: Math.round(b.seconds / 6) / 10,
    seconds: b.seconds, kind: b.kind, chapter: b.chapter, optional: b.optional, status: 'pending' as string,
    steps: [] as Step[], play_ms: null as number | null, draft_model: null as string | null, attempts: 0, error: null as string | null,
  }
}

/** Which model wrote a beat, how long it took, and what failed first (diagnostics, in lesson_sections.draft_model). */
const modelNote = (meta: GenMeta) => {
  const failed = traceSummary(meta.trace)
  return `${meta.model ?? 'unknown'} ${Math.round(meta.ms / 100) / 10}s${failed ? ` after ${failed}` : ''}`.slice(0, 200)
}

const sayOf = (steps: Step[]) => steps.map(s => s.say ?? '').filter(Boolean).join(' ')

/**
 * Drafts as much of the lesson as fits in one invocation. Safe to call any number
 * of times concurrently: only the holder of the lease does anything.
 */
export async function runDraftWork(lessonId: string, opts: { origin?: string } = {}): Promise<string> {
  // Teaching Playbook context: the writer's prompt hook knows the lesson (topic + owner's private notes).
  return withPlaybook({ lessonId }, () => runDraftWorkInner(lessonId, opts))
}

async function runDraftWorkInner(lessonId: string, opts: { origin?: string } = {}): Promise<string> {
  const db = createAdminClient()
  const t0 = Date.now()
  const hardEnd = t0 + HARD_END_MS
  if (!(await claim(db, lessonId))) return 'busy'
  let handOver = false
  let lastBeatAt = 0
  /** Set once the lesson is known to belong to a path topic (it never becomes unattached again). */
  let attached = false
  /** Narration being voiced in the background while later beats are written. */
  const voicing: Promise<unknown>[] = []
  const voice = (steps: Step[], budget: number) => { voicing.push(pregenerateNarration(steps, budget).catch(() => null)) }

  /** Quota: sleep through a short wait when it fits, otherwise pause until the retry time. */
  const onQuota = async (err: GeminiQuotaError): Promise<'continue' | 'paused'> => {
    const wait = err.retryAfterMs ?? MAX_INLINE_WAIT_MS
    if (!err.daily && wait <= MAX_INLINE_WAIT_MS && Date.now() + wait + BEAT_RESERVE_MS < hardEnd) { await sleep(wait); return 'continue' }
    await db.from('lessons').update({ draft_status: 'paused', draft_error: 'quota', draft_retry_at: retryAt(err) }).eq('id', lessonId)
    return 'paused'
  }

  try {
    for (;;) {
      const { data } = await db.from('lessons').select(JOB_COLS).eq('id', lessonId).maybeSingle()
      const lesson = data as LessonJobRow | null
      if (!lesson) return 'gone'

      // A paused job resumes once its retry time has passed.
      if (lesson.draft_status === 'paused') {
        if (lesson.draft_retry_at && new Date(lesson.draft_retry_at).getTime() > Date.now()) return 'paused'
        const { data: any1 } = await db.from('lesson_sections').select('id').eq('lesson_id', lessonId).limit(1)
        const status: DraftStatus = any1?.length ? 'drafting' : 'outlining'
        await db.from('lessons').update({ draft_status: status, draft_error: null, draft_retry_at: null }).eq('id', lessonId)
        continue
      }
      if (lesson.draft_status !== 'outlining' && lesson.draft_status !== 'drafting') return lesson.draft_status

      const lite = { title: lesson.title, subject: lesson.subject, objectives: lesson.objectives ?? [] }
      const notes = lesson.draft_notes ?? undefined
      const targetMs = (lesson.target_minutes ?? 15) * 60_000

      if (lesson.draft_status === 'outlining') {
        // A planned lesson is never planned again (that would drop beats a learner may be playing).
        const { data: planned } = await db.from('lesson_sections').select('id').eq('lesson_id', lessonId).limit(1)
        if (planned?.length) {
          await db.from('lessons').update({ draft_status: 'drafting' }).eq('id', lessonId)
          continue
        }
        // The plan and the opening beat are written at the same time, so playback can start
        // as soon as the opening beat exists. The voice container (scales to zero, ~20-40 s cold
        // start) is woken now so it is up by the time the opening lines need voicing.
        warmTts()
        const hook = hookPlan(lite)
        const hookMeta: GenMeta = { ms: 0, repaired: false, model: null, dropped: 0 }
        let planModel: string | null = null
        const planTrace: string[] = []
        const deadline = Math.min(Date.now() + BEAT_DEADLINE_MS, hardEnd - 20_000)
        // A learner is (or soon will be) waiting on the opening: live priority in the LLM pool.
        const [planR, hookR] = await withLlmContext({ priority: 'live', learnerId: lesson.owner_student_id ?? null, label: 'lesson-open' }, () => Promise.allSettled([
          planLessonBeats(lite, lesson.target_minutes ?? 15, notes, { deadline, onModel: m => { planModel = m }, trace: planTrace }),
          draftBeat({ lesson: lite, plan: [hook], index: 0, board: [], recentSay: '', notes, meta: hookMeta, deadline, chapterStart: true, opening: true }),
        ]))
        if (planR.status === 'rejected') {
          const err = planR.reason
          if (err instanceof GeminiQuotaError) { if (await onQuota(err) === 'paused') return 'paused'; continue }
          const msg = err instanceof Error ? err.message : String(err)
          // Overload (503) and timeouts pass: try again shortly (the pg_cron tick resumes it), for up to 30 minutes.
          if (isRetryable(err) && Date.now() - new Date(lesson.created_at ?? Date.now()).getTime() < 30 * 60_000) {
            await db.from('lessons').update({ draft_status: 'paused', draft_error: 'busy', draft_retry_at: new Date(Date.now() + 60_000).toISOString() }).eq('id', lessonId)
            return 'paused'
          }
          console.error('Beat plan failed:', msg)
          await db.from('lessons').update({ draft_status: 'failed', draft_error: `The lesson plan could not be written: ${msg.slice(0, 200)}` }).eq('id', lessonId)
          return 'failed'
        }
        const plan = planR.value
        console.log(`Lesson ${lessonId}: plan of ${plan.length} beats by ${planModel}${planTrace.length ? ` after ${traceSummary(planTrace)}` : ''}; opening beat ${hookR.status === 'fulfilled' ? `by ${hookMeta.model} in ${hookMeta.ms} ms` : `failed: ${hookR.reason instanceof Error ? hookR.reason.message.slice(0, 160) : hookR.reason}`}`)
        await db.from('lesson_sections').delete().eq('lesson_id', lessonId)
        const rows = [hook, ...plan].map((b, i) => beatRow(lessonId, i, b))
        if (hookR.status === 'fulfilled') {
          const len = lengthReport(hookR.value, hook.seconds / 60)
          Object.assign(rows[0], { status: 'ready', steps: hookR.value, play_ms: Math.round(len.ms), draft_model: modelNote(hookMeta), attempts: 1, error: `Opening beat at ${Math.round((Date.now() - t0) / 100) / 10}s; plan by ${planModel ?? '?'}${planTrace.length ? ` after ${traceSummary(planTrace)}` : ''}`.slice(0, 300) })
        }
        const { error } = await db.from('lesson_sections').insert(rows)
        if (error) {
          await db.from('lessons').update({ draft_status: 'failed', draft_error: error.message.slice(0, 300) }).eq('id', lessonId)
          return 'failed'
        }
        await db.from('lessons').update({ draft_status: 'drafting', draft_error: null, script: [], chapters: [] }).eq('id', lessonId)
        if (hookR.status === 'fulfilled') {
          // Publish the opening beat at once; its voice is made while the next beats are written.
          await syncLessonScript(db, lessonId)
          voice(hookR.value, 25_000)
        }
        // AI lessons get one rendered animation (AI-written code, guarded and sandboxed); queued after the opening beat.
        if (lesson.generated_by === 'ai') void queueLessonClip(db, lessonId).catch(err => console.warn('Lesson clip not queued:', err instanceof Error ? err.message : err))
        continue
      }

      // drafting: the next beat that isn't done. A "drafting" row here was left by a worker that died (we hold the lease).
      const rows = await loadSections(db, lessonId)
      const next = rows.find(r => r.status === 'pending' || r.status === 'drafting')
      const ready = rows.filter(r => r.status === 'ready')
      const played = ready.reduce((a, r) => a + (r.play_ms ?? 0), 0)
      if (!next) {
        const status: DraftStatus = ready.length > 0 && (played >= targetMs * 0.85 || rows.every(r => r.status === 'ready' || r.status === 'skipped')) ? 'ready' : 'partial'
        await syncLessonScript(db, lessonId, rows)
        await db.from('lessons').update({ draft_status: status, draft_error: null, draft_retry_at: null }).eq('id', lessonId)
        console.log(`Lesson ${lessonId}: ${status}, ${ready.length} beats, plays ${(played / 60000).toFixed(1)} of ${(targetMs / 60000).toFixed(0)} min`)
        return status
      }
      if (Date.now() + BEAT_RESERVE_MS > hardEnd) { handOver = true; return 'handover' }

      // A speculative first lesson waits after its opening beats until the diagnostic attaches it.
      if (!attached && lesson.generated_by === 'ai' && ready.length >= SPECULATIVE_BEATS) {
        const { data: topic } = await db.from('path_topics').select('id').eq('lesson_id', lessonId).limit(1)
        if (topic?.length) attached = true
        else if (Date.now() - new Date(lesson.created_at ?? Date.now()).getTime() > 3 * 3600_000) {
          // The diagnostic it was written for was abandoned: stop for good.
          await db.from('lessons').update({ draft_status: 'partial', draft_error: SPECULATIVE_PAUSE, draft_retry_at: null }).eq('id', lessonId)
          return 'partial'
        } else {
          await db.from('lessons').update({ draft_status: 'paused', draft_error: SPECULATIVE_PAUSE, draft_retry_at: new Date(Date.now() + 20 * 60_000).toISOString() }).eq('id', lessonId)
          console.log(`Lesson ${lessonId}: speculative draft waits after ${ready.length} beats`)
          return 'paused'
        }
      }

      // Length is steered here, not by the model: optional beats only when behind schedule…
      const plannedBefore = HOOK_SECONDS * 1000 + rows.filter(r => r.position > 0 && r.position < next.position && !r.optional).reduce((a, r) => a + (r.seconds ?? 60) * 1000, 0)
      if (next.optional && played >= plannedBefore) {
        await db.from('lesson_sections').update({ status: 'skipped', error: 'Not needed: the lesson is on schedule' }).eq('id', next.id)
        continue
      }
      // …and extra practice before the closing beat until the lesson reaches its target.
      if (next.kind === 'wrap' && next.status === 'pending') {
        const extras = rows.filter(r => r.title.startsWith(EXTRA_PREFIX)).length
        // Beats play shorter or longer than planned; expect the wrap to run like the beats so far.
        const plannedReady = ready.reduce((a, r) => a + (r.seconds ?? 60) * 1000, 0)
        const pace = plannedReady > 0 ? Math.min(1.3, Math.max(0.4, played / plannedReady)) : 1
        const wrapMs = (next.seconds ?? 60) * 1000 * pace
        if (played + wrapMs < targetMs * 0.97 && extras < MAX_EXTRA_BEATS && rows.length < MAX_BEATS) {
          const deficitS = Math.round((targetMs - played - wrapMs) / 1000 / pace)
          const extra = extraBeat(rows.map(toPlan), extras, deficitS, next.chapter ?? next.title)
          // Shift the wrap (and anything after it) down one place; nothing after it is published yet.
          for (const r of rows.filter(r => r.position >= next.position).sort((a, b) => b.position - a.position)) {
            await db.from('lesson_sections').update({ position: r.position + 1 }).eq('id', r.id)
          }
          await db.from('lesson_sections').insert(beatRow(lessonId, next.position, extra))
          continue
        }
      }

      // Context: the plan (without dropped beats), the board this beat starts on, and what was just said.
      const live = rows.filter(r => r.status !== 'skipped' && r.status !== 'failed')
      const plan = live.map(toPlan)
      const index = live.findIndex(r => r.id === next.id)
      const before = ready.filter(r => r.position < next.position)
      const prev = before[before.length - 1]
      const chapterStart = !prev || (prev.chapter ?? prev.title) !== (next.chapter ?? next.title)
      const board: Step[] = []
      if (!chapterStart) {
        const run: SectionRow[] = []
        for (let k = before.length - 1; k >= 0 && (before[k].chapter ?? before[k].title) === (next.chapter ?? next.title); k--) run.unshift(before[k])
        for (const r of run) board.push(...r.steps)
      }
      const recentSay = sayOf(before.slice(-2).flatMap(r => r.steps)).slice(-600)

      if (ready.length >= HEAD_START_BEATS) {
        const wait = lastBeatAt + BEAT_SPACING_MS - Date.now()
        if (wait > 0) await sleep(wait)
      }
      lastBeatAt = Date.now()
      await db.from('lesson_sections').update({ status: 'drafting', error: null }).eq('id', next.id)
      const meta: GenMeta = { ms: 0, repaired: false, model: null, dropped: 0 }
      try {
        // The next few beats may be needed soon by a learner playing the lesson (Ask class); drafting further ahead
        // is background work, the first to be deferred when the pool is under pressure.
        const priority = ready.length < HEAD_START_BEATS + 2 ? 'ask' as const : 'background' as const
        let steps = await withLlmContext({ priority, learnerId: lesson.owner_student_id ?? null, label: 'lesson-beat' }, () => draftBeat({ lesson: lite, plan, index, board, recentSay, notes, meta, chapterStart, deadline: Math.min(Date.now() + BEAT_DEADLINE_MS, hardEnd - 15_000) }))
        if (chapterStart && before.length > 0 && !(steps[0]?.type === 'clear' && !(steps[0] as { targets?: string[] }).targets)) steps = [{ type: 'clear' }, ...steps]
        const len = lengthReport(steps, (next.seconds ?? 60) / 60)
        await db.from('lesson_sections').update({
          status: 'ready', steps, play_ms: Math.round(len.ms), draft_model: modelNote(meta), attempts: (next.attempts ?? 0) + 1,
          error: len.ratio < 0.6 ? `Plays ${Math.round(len.ms / 1000)} of ${next.seconds} s` : null,
        }).eq('id', next.id)
        // A finished clip goes into this beat before it is published (published beats never change).
        if (lesson.generated_by === 'ai') await attachReadyClips(db, lessonId, next.position).catch(() => false)
        const fresh = await loadSections(db, lessonId)
        await syncLessonScript(db, lessonId, fresh)
        voice(fresh.find(r => r.id === next.id)?.steps ?? steps, 60_000)
      } catch (err) {
        if (err instanceof GeminiQuotaError) {
          await db.from('lesson_sections').update({ status: 'pending' }).eq('id', next.id)
          if (await onQuota(err) === 'paused') return 'paused'
          continue
        }
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Beat ${next.position + 1} failed:`, msg)
        const attempts = (next.attempts ?? 0) + 1
        await db.from('lesson_sections').update({ status: attempts >= BEAT_ATTEMPTS ? 'failed' : 'pending', attempts, steps: [], error: msg.slice(0, 300) }).eq('id', next.id)
        // An overload spike (503, timeouts) usually passes in seconds: give it a moment before the next try.
        if (isRetryable(err) && Date.now() + 10_000 + BEAT_RESERVE_MS < hardEnd) await sleep(10_000)
      }
    }
  } finally {
    await release(db, lessonId)
    // Hand over first (the next worker starts writing at once), then let the voicing finish within the budget.
    if (handOver) await chain(opts.origin, lessonId)
    if (voicing.length) await Promise.race([Promise.allSettled(voicing), sleep(Math.max(0, hardEnd + 25_000 - Date.now()))])
  }
}

/** Start a fresh draft (outline + all sections) for a lesson. */
export async function restartDraft(db: SupabaseClient, lessonId: string, targetMinutes: number, notes?: string | null) {
  await db.from('lesson_sections').delete().eq('lesson_id', lessonId)
  return db.from('lessons').update({
    status: 'draft', target_minutes: targetMinutes, draft_notes: notes ?? null,
    draft_status: 'outlining', draft_error: null, draft_retry_at: null, script: [], chapters: [],
  }).eq('id', lessonId)
}

/** The origin this deployment can call itself on. */
export function selfOrigin(request: Request) {
  try { return new URL(request.url).origin } catch { return undefined }
}

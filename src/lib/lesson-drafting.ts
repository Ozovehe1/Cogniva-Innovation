/**
 * Background drafting of long lessons (server only).
 *
 * A lesson is drafted as a small job: first an outline (one model call), then one
 * model call per section, each saved as soon as it finishes. One worker holds a
 * lease on the lesson (lessons.draft_lock_until) so client polls, the self-chain and
 * the cron never draft the same lesson twice. A worker drafts sections until its
 * time budget runs low, then hands over to a fresh invocation. When Gemini's quota
 * is exhausted the job pauses (drafted sections are kept) and resumes on the next
 * poll or cron run after draft_retry_at.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from './supabase/admin'
import { GeminiQuotaError } from './gemini'
import { draftLessonOutline, draftLessonSection, expandLessonSection, type OutlineSection } from './lesson-ai'
import { flattenSections, validateSection, type Chapter } from './lesson-sections'
import type { Step } from './lesson-schema'
import { LENGTH_MIN_RATIO, lengthReport } from './lesson-timing'
import { pregenerateNarration } from './tts-server'
import { attachReadyClips, queueLessonClip } from './lesson-clip'

const LOCK_MS = 295_000
/** Work budget of one invocation (routes run with maxDuration 300). */
const RUN_BUDGET_MS = 240_000
/** Don't start a section with less than this left in the budget. */
const SECTION_RESERVE_MS = 125_000
/** Don't start a length expansion with less than this left in the budget. */
const EXPAND_RESERVE_MS = 115_000
/** Length expansions per section before it is accepted as it is. */
export const MAX_EXPANSIONS = 2
/** Short rate-limit waits are slept through inside the worker instead of pausing. */
const MAX_INLINE_WAIT_MS = 65_000

export type DraftStatus = 'idle' | 'outlining' | 'drafting' | 'paused' | 'ready' | 'partial' | 'failed'
export type SectionStatus = 'pending' | 'drafting' | 'ready' | 'failed'

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
}

const JOB_COLS = 'id, title, subject, objectives, target_minutes, draft_status, draft_notes, draft_retry_at, draft_lock_until, generated_by'

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
  const flat = flattenSections(rows.filter(r => r.status === 'ready').map(r => ({ title: r.title, steps: r.steps })))
  await db.from('lessons').update({ script: flat.steps, chapters: flat.chapters }).eq('id', lessonId)
  return flat
}

function toOutline(rows: SectionRow[]): OutlineSection[] {
  return rows.map(r => ({ title: r.title, goal: r.goal, minutes: Number(r.minutes) || 8, keyPoints: r.key_points ?? [] }))
}

/** When to try again after a quota error. */
function retryAt(err: GeminiQuotaError) {
  const wait = err.daily ? 30 * 60_000 : Math.max(60_000, err.retryAfterMs ?? 90_000)
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

/**
 * Drafts as much of the lesson as fits in one invocation. Safe to call any number
 * of times concurrently: only the holder of the lease does anything.
 */
export async function runDraftWork(lessonId: string, opts: { origin?: string } = {}): Promise<string> {
  const db = createAdminClient()
  const t0 = Date.now()
  if (!(await claim(db, lessonId))) return 'busy'
  let handOver = false
  try {
    for (;;) {
      const { data } = await db.from('lessons').select(JOB_COLS).eq('id', lessonId).maybeSingle()
      const lesson = data as LessonJobRow | null
      if (!lesson) return 'gone'

      // A paused job resumes once its retry time has passed.
      if (lesson.draft_status === 'paused') {
        if (lesson.draft_retry_at && new Date(lesson.draft_retry_at).getTime() > Date.now()) return 'paused'
        const { count } = await db.from('lesson_sections').select('id', { count: 'exact', head: true }).eq('lesson_id', lessonId)
        const status: DraftStatus = count ? 'drafting' : 'outlining'
        await db.from('lessons').update({ draft_status: status, draft_error: null, draft_retry_at: null }).eq('id', lessonId)
        continue
      }
      if (lesson.draft_status !== 'outlining' && lesson.draft_status !== 'drafting') return lesson.draft_status

      const lite = { title: lesson.title, subject: lesson.subject, objectives: lesson.objectives ?? [] }

      if (lesson.draft_status === 'outlining') {
        let outline: OutlineSection[]
        try {
          outline = await draftLessonOutline(lite, lesson.target_minutes ?? 15, lesson.draft_notes ?? undefined)
        } catch (err) {
          if (err instanceof GeminiQuotaError) {
            if (!err.daily && (err.retryAfterMs ?? 90_000) <= MAX_INLINE_WAIT_MS && Date.now() - t0 + MAX_INLINE_WAIT_MS < RUN_BUDGET_MS - 60_000) {
              await sleep(err.retryAfterMs ?? MAX_INLINE_WAIT_MS); continue
            }
            await db.from('lessons').update({ draft_status: 'paused', draft_error: 'quota', draft_retry_at: retryAt(err) }).eq('id', lessonId)
            return 'paused'
          }
          const msg = err instanceof Error ? err.message : String(err)
          console.error('Outline failed:', msg)
          await db.from('lessons').update({ draft_status: 'failed', draft_error: `The outline could not be written: ${msg.slice(0, 200)}` }).eq('id', lessonId)
          return 'failed'
        }
        await db.from('lesson_sections').delete().eq('lesson_id', lessonId)
        const { error } = await db.from('lesson_sections').insert(outline.map((o, i) => ({
          lesson_id: lessonId, position: i, title: o.title, goal: o.goal, key_points: o.keyPoints, minutes: o.minutes, status: 'pending',
        })))
        if (error) {
          await db.from('lessons').update({ draft_status: 'failed', draft_error: error.message.slice(0, 300) }).eq('id', lessonId)
          return 'failed'
        }
        await db.from('lessons').update({ draft_status: 'drafting', draft_error: null, script: [], chapters: [] }).eq('id', lessonId)
        // AI lessons get one rendered animation for the opening idea (AI-written code, guarded and sandboxed).
        if (lesson.generated_by === 'ai') void queueLessonClip(db, lessonId).catch(err => console.warn('Lesson clip not queued:', err instanceof Error ? err.message : err))
        continue
      }

      // drafting: next section that isn't done. A "drafting" row here was left by a worker that died (we hold the lease).
      const rows = await loadSections(db, lessonId)
      const next = rows.find(r => r.status === 'pending' || r.status === 'drafting')
      if (!next) {
        const status: DraftStatus = rows.length > 0 && rows.every(r => r.status === 'ready') ? 'ready' : 'partial'
        await syncLessonScript(db, lessonId, rows)
        await db.from('lessons').update({ draft_status: status, draft_error: null, draft_retry_at: null }).eq('id', lessonId)
        return status
      }
      // A section that is drafted but plays short of its target is lengthened before it is released.
      const expanding = next.status === 'drafting' && Array.isArray(next.steps) && next.steps.length > 0
      if (Date.now() - t0 > RUN_BUDGET_MS - (expanding ? EXPAND_RESERVE_MS : SECTION_RESERVE_MS)) { handOver = true; return 'handover' }

      const notes = [lesson.draft_notes, next.notes].filter(Boolean).join('\n') || undefined
      const finish = async (steps: Step[], expansions: number, note?: string) => {
        const len = lengthReport(steps, Number(next.minutes) || 6)
        const short = len.ratio < LENGTH_MIN_RATIO
        // The opening section is released as soon as it is written (the learner may be waiting to start);
        // whatever it is short of its target is carried into the next section instead.
        const maxExpansions = next.position === 0 ? 0 : MAX_EXPANSIONS
        if (short && expansions < maxExpansions) {
          // Keep the steps and come back to lengthen them (this run if time allows, otherwise the next).
          await db.from('lesson_sections').update({ status: 'drafting', steps, expansions, play_ms: Math.round(len.ms), error: note ?? null }).eq('id', next.id)
          return
        }
        await db.from('lesson_sections').update({
          status: 'ready', steps, expansions, play_ms: Math.round(len.ms),
          error: short ? `Plays ${len.minutes} of ${next.minutes} min after ${expansions} expansions; shortfall carried forward${note ? ` (${note})` : ''}` : null,
        }).eq('id', next.id)
        if (short) {
          // Carry the shortfall into the next section that is still to be written, so the lesson keeps its length.
          const later = rows.find(r => r.position > next.position && r.status === 'pending')
          const deficit = Math.round((len.targetMs - len.ms) / 6000) / 10
          if (later && deficit > 0) await db.from('lesson_sections').update({ minutes: Math.min(12, Math.round((Number(later.minutes) + deficit) * 10) / 10) }).eq('id', later.id)
        }
        // A finished clip goes into this section before it is published (published sections never change).
        if (lesson.generated_by === 'ai') await attachReadyClips(db, lessonId, next.position).catch(() => false)
        // Voice the whole section before it is published, so it plays at once with the natural voice
        // (bounded: anything not voiced in time is voiced on demand and by the lesson-open warm-up).
        const fresh = (await loadSections(db, lessonId))
        const mine = fresh.find(r => r.id === next.id)
        await pregenerateNarration(mine?.steps ?? steps, Math.min(next.position === 0 ? 20_000 : 60_000, Math.max(15_000, RUN_BUDGET_MS - (Date.now() - t0) - 20_000))).catch(() => null)
        await syncLessonScript(db, lessonId, fresh)
      }

      if (expanding) {
        const expansions = (next.expansions ?? 0) + 1
        const have = next.steps
        try {
          const len = lengthReport(have, Number(next.minutes) || 6)
          const more = await expandLessonSection({ lesson: lite, outline: toOutline(rows), position: next.position, steps: have, playedMinutes: len.minutes, notes })
          const v = validateSection([...have, ...more], next.position)
          if (!v.ok) throw new Error(v.errors.slice(0, 2).join('; '))
          await finish(v.steps, expansions)
        } catch (err) {
          if (err instanceof GeminiQuotaError) {
            if (!err.daily && (err.retryAfterMs ?? 90_000) <= MAX_INLINE_WAIT_MS && Date.now() - t0 + MAX_INLINE_WAIT_MS < RUN_BUDGET_MS - EXPAND_RESERVE_MS) {
              await sleep(err.retryAfterMs ?? MAX_INLINE_WAIT_MS); continue
            }
            await db.from('lessons').update({ draft_status: 'paused', draft_error: 'quota', draft_retry_at: retryAt(err) }).eq('id', lessonId)
            return 'paused'
          }
          // A failed expansion never loses the drafted section: it counts as a try and the section is kept.
          const msg = err instanceof Error ? err.message : String(err)
          console.warn(`Section ${next.position + 1} expansion ${expansions} failed:`, msg)
          await finish(have, expansions, msg.slice(0, 200))
        }
        continue
      }

      await db.from('lesson_sections').update({ status: 'drafting', error: null }).eq('id', next.id)
      try {
        const steps = await draftLessonSection({ lesson: lite, outline: toOutline(rows), position: next.position, notes })
        const v = validateSection(steps, next.position)
        if (!v.ok) throw new Error(v.errors.slice(0, 2).join('; '))
        await finish(v.steps, 0)
      } catch (err) {
        if (err instanceof GeminiQuotaError) {
          await db.from('lesson_sections').update({ status: 'pending' }).eq('id', next.id)
          if (!err.daily && (err.retryAfterMs ?? 90_000) <= MAX_INLINE_WAIT_MS && Date.now() - t0 + MAX_INLINE_WAIT_MS < RUN_BUDGET_MS - SECTION_RESERVE_MS) {
            await sleep(err.retryAfterMs ?? MAX_INLINE_WAIT_MS); continue
          }
          await db.from('lessons').update({ draft_status: 'paused', draft_error: 'quota', draft_retry_at: retryAt(err) }).eq('id', lessonId)
          return 'paused'
        }
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Section ${next.position + 1} failed:`, msg)
        const attempts = (next.attempts ?? 0) + 1
        await db.from('lesson_sections').update({
          status: attempts >= 3 ? 'failed' : 'pending',
          attempts,
          steps: [],
          error: msg.slice(0, 300),
        }).eq('id', next.id)
      }
    }
  } finally {
    await release(db, lessonId)
    if (handOver) await chain(opts.origin, lessonId)
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

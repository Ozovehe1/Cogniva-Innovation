/**
 * Deleting what a learner owns: one lesson, a whole goal (path), or the account.
 * Server only. Every entry point first proves ownership with the learner's own
 * Supabase session (RLS), then cleans up with the service role, as every other
 * path/topic write does. Shared narration audio (lesson-audio / narration_audio)
 * is a cross-lesson cache keyed by the spoken text and is never deleted here.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient, MANIM_BUCKET } from '@/lib/supabase/admin'
import { penPathFor } from '@/lib/manim'
import { getSessionProfile } from '@/lib/auth'
import { purgeLessonVideos } from '@/lib/lesson-video'

export type PurgeResult = { ok: true; remainingGoals?: number } | { ok: false; status: number; error: string }

export const MATERIALS_BUCKET = 'lesson-materials'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const fail = (status: number, error: string): PurgeResult => ({ ok: false, status, error })

function admin(): SupabaseClient | null {
  try { return createAdminClient() } catch { return null }
}

/** Remove storage objects in batches (Supabase caps a remove call). Throws when a batch fails. */
async function removeObjects(db: SupabaseClient, bucket: string, paths: string[]) {
  const list = [...new Set(paths.filter(Boolean))]
  for (let i = 0; i < list.length; i += 100) {
    const { error } = await db.storage.from(bucket).remove(list.slice(i, i + 100))
    if (error) throw new Error(`${bucket}: ${error.message}`)
  }
}

/** Clip jobs (and their rendered mp4 + pen-timing JSON) for these lessons, or requested by this profile. */
async function purgeClipJobs(db: SupabaseClient, filter: { lessonIds?: string[]; requestedBy?: string }) {
  const jobs: { id: string; video_path: string | null }[] = []
  if (filter.lessonIds?.length) {
    for (let i = 0; i < filter.lessonIds.length; i += 100) {
      const { data } = await db.from('manim_jobs').select('id, video_path').in('lesson_id', filter.lessonIds.slice(i, i + 100))
      jobs.push(...((data ?? []) as typeof jobs))
    }
  }
  if (filter.requestedBy) {
    const { data } = await db.from('manim_jobs').select('id, video_path').eq('requested_by', filter.requestedBy)
    jobs.push(...((data ?? []) as typeof jobs))
  }
  const files = jobs.flatMap(j => (j.video_path ? [j.video_path, penPathFor(j.video_path)] : []))
  await removeObjects(db, MANIM_BUCKET, files)
  const ids = [...new Set(jobs.map(j => j.id))]
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await db.from('manim_jobs').delete().in('id', ids.slice(i, i + 100))
    if (error) throw new Error(error.message)
  }
}

/**
 * Delete lessons owned by studentId and everything hanging off them: progress, beats/sections and
 * material rows (FK cascade), clip jobs and their rendered files, rendered lesson videos, uploaded material files. With
 * resetTopics, a path topic that pointed at a lesson goes back to "ready" (mastered/locked stay) with
 * its quiz state cleared, so it can be written again; a path's speculative-draft pointer is cleared.
 */
export async function purgeLessons(db: SupabaseClient, studentId: string, lessonIds: string[], opts: { resetTopics?: boolean } = {}) {
  const ids = [...new Set(lessonIds.filter(id => UUID.test(id)))]
  if (!ids.length) return
  if (opts.resetTopics) {
    const { data: topics } = await db.from('path_topics').select('id, status, mastery').in('lesson_id', ids).eq('student_id', studentId)
    for (const t of (topics ?? []) as { id: string; status: string; mastery: Record<string, unknown> | null }[]) {
      const mastery = { ...(t.mastery ?? {}) }
      delete mastery.items; delete mastery.startedAt; delete mastery.recheck
      const status = t.status === 'mastered' || t.status === 'locked' ? t.status : 'ready'
      await db.from('path_topics').update({ lesson_id: null, status, mastery, wrong_streak: 0 }).eq('id', t.id)
    }
    const { data: paths } = await db.from('learning_paths').select('id, speculation').eq('student_id', studentId)
    for (const p of (paths ?? []) as { id: string; speculation: Record<string, unknown> | null }[]) {
      if (p.speculation && ids.includes(String(p.speculation.lessonId))) await db.from('learning_paths').update({ speculation: { ...p.speculation, lessonId: null } }).eq('id', p.id)
    }
  }
  await purgeClipJobs(db, { lessonIds: ids })
  await purgeLessonVideos(db, ids)
  const { data: mats } = await db.from('lesson_materials').select('path').in('lesson_id', ids)
  await removeObjects(db, MATERIALS_BUCKET, ((mats ?? []) as { path: string | null }[]).map(m => m.path ?? ''))
  const { error } = await db.from('lessons').delete().in('id', ids).eq('owner_student_id', studentId)
  if (error) throw new Error(error.message)
}

/** Delete one of the signed-in learner's own lessons (path topic, if any, becomes re-writable). */
export async function deleteOwnLesson(lessonId: string): Promise<PurgeResult> {
  if (typeof lessonId !== 'string' || !UUID.test(lessonId)) return fail(404, 'Lesson not found.')
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return fail(401, 'Please sign in again.')
  const { data } = await supabase.from('lessons').select('id, owner_student_id').eq('id', lessonId).maybeSingle()
  const own = data as { id: string; owner_student_id: string | null } | null
  if (!own || own.owner_student_id !== profile.id) return fail(403, 'You can only delete your own lessons.')
  const db = admin()
  if (!db) return fail(503, 'Deleting is unavailable right now.')
  try { await purgeLessons(db, profile.id, [lessonId], { resetTopics: true }) } catch (e) {
    console.error('deleteOwnLesson', e)
    return fail(500, 'Could not delete the lesson. Please try again.')
  }
  return { ok: true }
}

/**
 * Delete one of the signed-in learner's goals: the path row (its diagnostic and plan live on it),
 * its topics and their quiz state (cascade), every lesson written for it (and a speculative
 * first-lesson draft), with their progress, clip jobs, rendered files and materials.
 */
export async function deleteOwnPath(pathId: string): Promise<PurgeResult> {
  if (typeof pathId !== 'string' || !UUID.test(pathId)) return fail(404, 'Goal not found.')
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return fail(401, 'Please sign in again.')
  const { data } = await supabase.from('learning_paths').select('id, student_id').eq('id', pathId).maybeSingle()
  const own = data as { id: string; student_id: string } | null
  if (!own || own.student_id !== profile.id) return fail(403, 'You can only delete your own goals.')
  const db = admin()
  if (!db) return fail(503, 'Deleting is unavailable right now.')
  try {
    const { data: path } = await db.from('learning_paths').select('id, speculation').eq('id', pathId).eq('student_id', profile.id).maybeSingle()
    const spec = (path as { speculation: Record<string, unknown> | null } | null)?.speculation
    const { data: topics } = await db.from('path_topics').select('lesson_id').eq('path_id', pathId)
    const lessonIds = ((topics ?? []) as { lesson_id: string | null }[]).map(t => t.lesson_id).filter((x): x is string => !!x)
    if (spec?.lessonId && typeof spec.lessonId === 'string') lessonIds.push(spec.lessonId)
    // Only lessons this learner owns (a shared lesson is never removed by a learner).
    const { data: owned } = lessonIds.length ? await db.from('lessons').select('id').in('id', lessonIds).eq('owner_student_id', profile.id) : { data: [] }
    await purgeLessons(db, profile.id, ((owned ?? []) as { id: string }[]).map(l => l.id))
    const { error } = await db.from('learning_paths').delete().eq('id', pathId).eq('student_id', profile.id)
    if (error) throw new Error(error.message)
  } catch (e) {
    console.error('deleteOwnPath', e)
    return fail(500, 'Could not delete the goal. Please try again.')
  }
  const { count } = await db.from('learning_paths').select('id', { count: 'exact', head: true }).eq('student_id', profile.id).eq('status', 'ready')
  return { ok: true, remainingGoals: count ?? 0 }
}

/**
 * Delete the signed-in user's account: every owned lesson (with clips, files and materials), clip jobs
 * they requested, then the auth user itself, whose removal cascades to the profile and every row keyed
 * to it (learner profile, check-ins, paths, topics, progress, voice usage). The session is signed out.
 */
export async function deleteOwnAccount(confirm: string): Promise<PurgeResult> {
  if (String(confirm ?? '').trim().toUpperCase() !== 'DELETE') return fail(400, 'Type DELETE to confirm.')
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return fail(401, 'Please sign in again.')
  const db = admin()
  if (!db) return fail(503, 'Deleting is unavailable right now.')
  try {
    const { data: lessons } = await db.from('lessons').select('id').eq('owner_student_id', profile.id)
    await purgeLessons(db, profile.id, ((lessons ?? []) as { id: string }[]).map(l => l.id))
    await purgeClipJobs(db, { requestedBy: profile.id })
    const { error } = await db.auth.admin.deleteUser(profile.user_id)
    if (error) throw new Error(error.message)
    // In case the auth cascade is ever removed, make sure the profile is gone too.
    await db.from('profiles').delete().eq('id', profile.id)
  } catch (e) {
    console.error('deleteOwnAccount', e)
    return fail(500, 'Could not delete your account. Please try again.')
  }
  await supabase.auth.signOut().catch(() => null)
  return { ok: true }
}

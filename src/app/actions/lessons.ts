'use server'
import { revalidatePath } from 'next/cache'
import { getSessionProfile } from '@/lib/auth'
import { createAdminClient, MANIM_BUCKET } from '@/lib/supabase/admin'
import { penPathFor } from '@/lib/manim'

export type DeleteLessonResult = { ok: true } | { ok: false; error: string }

const MATERIALS_BUCKET = 'lesson-materials'

/**
 * Delete one of the learner's own AI lessons and everything that hangs off it.
 *
 * Ownership is checked with the learner's own Supabase session (RLS: a private lesson is only
 * visible to its owner) before anything is touched; the clean-up then runs with the service role,
 * as every other path/topic write does. Removed: the lesson row, its progress, beats/sections and
 * materials (FK cascade), its Manim clip jobs and their rendered mp4 + pen-timing files, uploaded
 * material files, and any mastery quiz written for it. A path topic that pointed at the lesson goes
 * back to "ready" (a mastered topic stays mastered) with no lesson, so it can be written again.
 * Shared narration audio is a cross-lesson cache keyed by the spoken text and is left alone.
 */
export async function deleteLesson(lessonId: string): Promise<DeleteLessonResult> {
  if (typeof lessonId !== 'string' || !/^[0-9a-f-]{36}$/i.test(lessonId)) return { ok: false, error: 'Lesson not found.' }
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return { ok: false, error: 'Please sign in again.' }
  const { data: lesson } = await supabase.from('lessons').select('id, owner_student_id').eq('id', lessonId).maybeSingle()
  const own = lesson as { id: string; owner_student_id: string | null } | null
  if (!own || own.owner_student_id !== profile.id) return { ok: false, error: 'You can only delete your own lessons.' }

  let db: ReturnType<typeof createAdminClient>
  try { db = createAdminClient() } catch { return { ok: false, error: 'Deleting is unavailable right now.' } }

  // Path topics that used this lesson: re-generatable, never broken.
  const { data: topics } = await db.from('path_topics').select('id, status, mastery').eq('lesson_id', lessonId).eq('student_id', profile.id)
  for (const t of (topics ?? []) as { id: string; status: string; mastery: Record<string, unknown> | null }[]) {
    const mastery = { ...(t.mastery ?? {}) }
    delete mastery.items; delete mastery.startedAt; delete mastery.recheck
    const status = t.status === 'mastered' || t.status === 'locked' ? t.status : 'ready'
    await db.from('path_topics').update({ lesson_id: null, status, mastery, wrong_streak: 0 }).eq('id', t.id)
  }

  // A speculative first-lesson draft recorded on a path.
  const { data: paths } = await db.from('learning_paths').select('id, speculation').eq('student_id', profile.id)
  for (const p of (paths ?? []) as { id: string; speculation: Record<string, unknown> | null }[]) {
    if (p.speculation && p.speculation.lessonId === lessonId) await db.from('learning_paths').update({ speculation: { ...p.speculation, lessonId: null } }).eq('id', p.id)
  }

  // Rendered clips (mp4 + pen timing JSON) and their jobs.
  const { data: jobs } = await db.from('manim_jobs').select('id, video_path').eq('lesson_id', lessonId)
  const clipPaths = ((jobs ?? []) as { id: string; video_path: string | null }[]).flatMap(j => (j.video_path ? [j.video_path, penPathFor(j.video_path)] : []))
  if (clipPaths.length) await db.storage.from(MANIM_BUCKET).remove(clipPaths).catch(() => null)
  if (jobs?.length) await db.from('manim_jobs').delete().in('id', (jobs as { id: string }[]).map(j => j.id))

  // Uploaded material files (rows cascade with the lesson).
  const { data: mats } = await db.from('lesson_materials').select('path').eq('lesson_id', lessonId)
  const matPaths = ((mats ?? []) as { path: string }[]).map(m => m.path).filter(Boolean)
  if (matPaths.length) await db.storage.from(MATERIALS_BUCKET).remove(matPaths).catch(() => null)

  // The lesson itself: progress, sections and materials cascade; check-ins keep no link.
  const { error } = await db.from('lessons').delete().eq('id', lessonId).eq('owner_student_id', profile.id)
  if (error) return { ok: false, error: 'Could not delete the lesson. Please try again.' }

  revalidatePath('/learn')
  revalidatePath('/dashboard')
  return { ok: true }
}

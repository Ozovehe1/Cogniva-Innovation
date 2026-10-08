/**
 * Editing a goal's own answers after it was planned: deadline, purpose and weekly time. The answers
 * live in the path's learner_snapshot (a later intake never changes them); the plan's pace, lesson
 * length and the due dates of topics not yet mastered are worked out again from them. The path's
 * scope and topics stay as they are. Server only.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionProfile } from '@/lib/auth'
import { learnerForPath, loadLearner, planFor, type LearnerRow, type PathRow, type TopicRow } from '@/lib/learner'
import { HOURS_CHOICES, PURPOSE_LABEL, pathDeadline } from '@/lib/path-view'

type Result = { ok: true } | { ok: false; status: number; error: string }

export async function updateOwnPathAnswers(pathId: string, body: unknown): Promise<Result> {
  if (!/^[0-9a-f-]{36}$/i.test(pathId)) return { ok: false, status: 404, error: 'Goal not found.' }
  const b = (body && typeof body === 'object' ? body : {}) as { deadline?: unknown; purpose?: unknown; hours?: unknown }
  const patch: Partial<LearnerRow> = {}
  if ('deadline' in b) {
    const d = b.deadline === null || b.deadline === '' ? null : String(b.deadline)
    if (d !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(new Date(d + 'T12:00:00Z').getTime()))) return { ok: false, status: 400, error: 'Pick a valid date.' }
    patch.deadline = d
  }
  if ('purpose' in b) {
    const p = String(b.purpose ?? '')
    if (!(p in PURPOSE_LABEL)) return { ok: false, status: 400, error: 'Pick what it’s for.' }
    patch.purpose = p
  }
  if ('hours' in b) {
    const h = Number(b.hours)
    if (!HOURS_CHOICES.some(c => c.value === h)) return { ok: false, status: 400, error: 'Pick how much time you have.' }
    patch.weekly_hours = h
  }
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return { ok: false, status: 401, error: 'Please sign in again.' }
  const { data } = await supabase.from('learning_paths').select('*').eq('id', pathId).maybeSingle()
  const path = data as PathRow | null
  if (!path || path.student_id !== profile.id) return { ok: false, status: 403, error: 'You can only edit your own goals.' }
  const learner = await loadLearner(supabase, profile.id)
  if (!learner) return { ok: false, status: 400, error: 'Finish getting started first.' }

  let db: ReturnType<typeof createAdminClient>
  try { db = createAdminClient() } catch { return { ok: false, status: 503, error: 'Editing is unavailable right now.' } }
  const before = learnerForPath(learner, path)
  // Keep every answer this goal was planned from; older paths without a snapshot take the current ones.
  const snapshot = { ...(path.learner_snapshot ?? {}), deadline: pathDeadline(path), purpose: before.purpose, weekly_hours: before.weekly_hours, ...patch }
  const after = learnerForPath(learner, { learner_snapshot: snapshot })
  const { data: topicRows } = await db.from('path_topics').select('*').eq('path_id', pathId).order('position')
  const topics = (topicRows ?? []) as TopicRow[]
  const fresh = planFor(after, topics.length)
  const plan = path.plan ? { ...path.plan, lessonMinutes: fresh.lessonMinutes, sessionsPerWeek: fresh.sessionsPerWeek, pace: fresh.pace, weeksLeft: fresh.weeksLeft, note: fresh.note } : fresh
  const { error } = await db.from('learning_paths').update({ learner_snapshot: snapshot, plan }).eq('id', pathId).eq('student_id', profile.id)
  if (error) return { ok: false, status: 500, error: 'Could not save. Please try again.' }

  // Due dates for what is left, spread from today the same way buildPath does.
  const left = topics.filter(t => t.status !== 'mastered')
  const perTopicDays = plan.weeksLeft && plan.weeksLeft > 0 ? Math.max(1, (plan.weeksLeft * 7) / Math.max(1, left.length)) : 7 / Math.max(1, plan.sessionsPerWeek / 1.6)
  const today = Date.now()
  for (const [i, t] of left.entries()) {
    const due_on = new Date(today + Math.round((i + 1) * perTopicDays) * 86_400_000).toISOString().slice(0, 10)
    await db.from('path_topics').update(t.lesson_id ? { due_on } : { due_on, target_minutes: plan.lessonMinutes }).eq('id', t.id)
  }
  return { ok: true }
}

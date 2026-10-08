/**
 * Every write the agent or the Learning Director makes goes through here: an agent_actions row with an
 * idempotency key (tool + student + target + day), the arguments, the result, and the inverse needed to
 * undo it for 24 hours. Confirm-tier writes are stored as 'proposed' and only run on the learner's tap.
 * Never available to any model: mark mastered, delete, guardian or consent actions. Server only.
 */
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PathRow, TopicRow } from '../learner'
import { reopenPrerequisite } from '../path'
import { restoreSkill, type SkillRow } from './learner-model'
import { ancestors } from '../diagnostic-core'

export const UNDO_WINDOW_MS = 24 * 3600_000

export interface ActionRow {
  id: string; student_id: string; run_id: string | null; source: string; tool: string; args: Record<string, unknown>; result: Record<string, unknown> | null
  idempotency_key: string | null; autonomy: 'auto' | 'confirm'; status: 'proposed' | 'done' | 'undone' | 'declined' | 'failed' | 'expired'
  undo: Record<string, unknown> | null; summary: string | null; created_at: string; decided_at: string | null
}

export function todayWAT(d = new Date()) {
  return new Date(d.getTime() + 3600_000).toISOString().slice(0, 10)
}
export function idemKey(tool: string, studentId: string, target: string, day = todayWAT()) {
  return createHash('sha256').update(`${tool}|${studentId}|${target}|${day}`).digest('hex').slice(0, 40)
}

export async function findAction(admin: SupabaseClient, key: string): Promise<ActionRow | null> {
  const { data } = await admin.from('agent_actions').select('*').eq('idempotency_key', key).maybeSingle()
  return (data as ActionRow | null) ?? null
}

export async function logAction(admin: SupabaseClient, row: {
  studentId: string; runId?: string | null; source?: 'agent' | 'director' | 'student'; tool: string; args?: Record<string, unknown>; result?: Record<string, unknown> | null
  key?: string | null; autonomy?: 'auto' | 'confirm'; status?: ActionRow['status']; undo?: Record<string, unknown> | null; summary?: string
}): Promise<ActionRow> {
  const { data, error } = await admin.from('agent_actions').insert({
    student_id: row.studentId, run_id: row.runId ?? null, source: row.source ?? 'agent', tool: row.tool, args: row.args ?? {}, result: row.result ?? null,
    idempotency_key: row.key ?? null, autonomy: row.autonomy ?? 'auto', status: row.status ?? 'done', undo: row.undo ?? null, summary: row.summary?.slice(0, 300) ?? null,
  }).select('*').single()
  if (error) {
    if (row.key && /duplicate key|unique/i.test(error.message)) { const ex = await findAction(admin, row.key); if (ex) return ex }
    throw new Error(error.message)
  }
  return data as ActionRow
}

/* ───────────── Confirm-tier proposals ───────────── */

/** Validate a remediation target: the prerequisite must be an ancestor of the topic on the same path. */
export async function remediationTarget(admin: SupabaseClient, studentId: string, topicId: string, nodeId: string | null) {
  const { data: t } = await admin.from('path_topics').select('*').eq('id', topicId).eq('student_id', studentId).maybeSingle()
  const topic = t as TopicRow | null
  if (!topic) return { error: 'topic not found for this learner' as const }
  const { data: p } = await admin.from('learning_paths').select('*').eq('id', topic.path_id).maybeSingle()
  const path = p as PathRow | null
  if (!path) return { error: 'path not found' as const }
  const pre = [...ancestors(path.graph, topic.node_id)]
  if (!pre.length) return { error: 'this topic has no earlier skill to go back to' as const }
  const node = nodeId && pre.includes(nodeId) ? nodeId : null
  // Default: the closest prerequisite (the direct one with the lowest mastery isn't known here; the first direct prereq).
  const direct = path.graph.nodes.find(n => n.id === topic.node_id)?.prereqs ?? []
  const pick = node ?? direct.find(d => pre.includes(d)) ?? pre[pre.length - 1]
  const title = path.graph.nodes.find(n => n.id === pick)?.title ?? pick
  if (nodeId && !node) return { error: `"${nodeId}" is not an earlier skill of this topic; choose one of: ${pre.join(', ')}` as const }
  return { topic, path, nodeId: pick, title }
}

async function applyRemediation(admin: SupabaseClient, a: ActionRow) {
  const r = await remediationTarget(admin, a.student_id, String(a.args.topic_id), String(a.args.node_id ?? ''))
  if ('error' in r) throw new Error(r.error)
  const { data: rows } = await admin.from('path_topics').select('id, status, position, mastered_at').eq('path_id', r.path.id)
  const snapshot = { pathId: r.path.id, known: r.path.known, topics: rows ?? [] }
  const title = await reopenPrerequisite(admin, r.path, r.topic, r.nodeId)
  return { result: { reopened: title, topic: r.topic.title }, undo: { type: 'restore_path', ...snapshot } }
}

async function applyPace(admin: SupabaseClient, a: ActionRow) {
  const pathId = String(a.args.path_id)
  const { data: p } = await admin.from('learning_paths').select('learner_snapshot, plan').eq('id', pathId).eq('student_id', a.student_id).maybeSingle()
  if (!p) throw new Error('goal not found')
  const { data: rows } = await admin.from('path_topics').select('id, due_on, target_minutes').eq('path_id', pathId)
  const { updateOwnPathAnswers } = await import('../path-edit')
  const body: Record<string, unknown> = {}
  if (a.args.weekly_hours !== undefined) body.hours = a.args.weekly_hours
  if (a.args.deadline !== undefined) body.deadline = a.args.deadline
  const res = await updateOwnPathAnswers(pathId, body)
  if (!res.ok) throw new Error(res.error)
  return { result: { applied: body }, undo: { type: 'restore_pace', pathId, learner_snapshot: (p as { learner_snapshot: unknown }).learner_snapshot, plan: (p as { plan: unknown }).plan, topics: rows ?? [] } }
}

/** The learner tapped Confirm on a proposal. Runs it, records the inverse. */
export async function confirmAction(admin: SupabaseClient, a: ActionRow): Promise<ActionRow> {
  if (a.status !== 'proposed') return a
  if (Date.now() - new Date(a.created_at).getTime() > 7 * 24 * 3600_000) {
    await admin.from('agent_actions').update({ status: 'expired', decided_at: new Date().toISOString() }).eq('id', a.id)
    throw new Error('This suggestion has expired.')
  }
  const out = a.tool === 'suggest_remediation' ? await applyRemediation(admin, a) : a.tool === 'adjust_pace' ? await applyPace(admin, a) : null
  if (!out) throw new Error('Nothing to confirm')
  const { data } = await admin.from('agent_actions').update({ status: 'done', result: out.result, undo: out.undo, decided_at: new Date().toISOString() }).eq('id', a.id).eq('status', 'proposed').select('*').single()
  return data as ActionRow
}

export async function declineAction(admin: SupabaseClient, a: ActionRow) {
  if (a.status !== 'proposed') return a
  const { data } = await admin.from('agent_actions').update({ status: 'declined', decided_at: new Date().toISOString() }).eq('id', a.id).select('*').single()
  return data as ActionRow
}

/* ───────────── Undo (24 h) ───────────── */

async function lessonUntouched(admin: SupabaseClient, studentId: string, lessonId: string) {
  const { data } = await admin.from('lesson_progress').select('step_index, completed_at').eq('student_id', studentId).eq('lesson_id', lessonId).maybeSingle()
  const p = data as { step_index: number; completed_at: string | null } | null
  return !p || (p.step_index === 0 && !p.completed_at)
}

export async function undoAction(admin: SupabaseClient, a: ActionRow): Promise<ActionRow> {
  if (a.status !== 'done' || !a.undo) throw new Error('This can’t be undone.')
  const at = new Date(a.decided_at ?? a.created_at).getTime()
  if (Date.now() - at > UNDO_WINDOW_MS) throw new Error('The 24-hour undo window has passed.')
  const u = a.undo as Record<string, unknown>
  switch (u.type) {
    case 'restore_plan': {
      const prev = u.previous as Record<string, unknown> | null
      if (prev) await admin.from('daily_plans').upsert({ ...prev, updated_at: new Date().toISOString() }, { onConflict: 'student_id,plan_date' })
      else await admin.from('daily_plans').delete().eq('student_id', a.student_id).eq('plan_date', String(u.plan_date))
      break
    }
    case 'remove_lesson': {
      const lessonId = String(u.lessonId)
      if (!(await lessonUntouched(admin, a.student_id, lessonId))) throw new Error('You have already started that lesson, so it stays.')
      if (u.topicId) await admin.from('path_topics').update({ lesson_id: null, ...(u.topicStatus ? { status: u.topicStatus } : {}) }).eq('id', String(u.topicId)).eq('student_id', a.student_id)
      await admin.from('lessons').delete().eq('id', lessonId).eq('owner_student_id', a.student_id)
      break
    }
    case 'restore_skill': {
      await restoreSkill(admin, u.key as { student_id: string; path_id: string; node_id: string }, (u.before ?? null) as SkillRow | null)
      break
    }
    case 'restore_path': {
      const pathId = String(u.pathId)
      const topics = (u.topics ?? []) as { id: string; status: string; position: number; mastered_at: string | null }[]
      const keep = new Set(topics.map(t => t.id))
      const { data: now } = await admin.from('path_topics').select('id, lesson_id').eq('path_id', pathId)
      for (const t of (now ?? []) as { id: string; lesson_id: string | null }[]) if (!keep.has(t.id) && !t.lesson_id) await admin.from('path_topics').delete().eq('id', t.id)
      for (const t of topics) await admin.from('path_topics').update({ status: t.status, position: t.position, mastered_at: t.mastered_at }).eq('id', t.id)
      await admin.from('learning_paths').update({ known: u.known }).eq('id', pathId).eq('student_id', a.student_id)
      break
    }
    case 'restore_pace': {
      const pathId = String(u.pathId)
      await admin.from('learning_paths').update({ learner_snapshot: u.learner_snapshot, plan: u.plan }).eq('id', pathId).eq('student_id', a.student_id)
      for (const t of (u.topics ?? []) as { id: string; due_on: string | null; target_minutes: number | null }[]) await admin.from('path_topics').update({ due_on: t.due_on, target_minutes: t.target_minutes }).eq('id', t.id)
      break
    }
    case 'delete_memory': {
      const ids = (u.ids ?? []) as number[]
      if (ids.length) await admin.from('learner_memory').delete().in('id', ids).eq('student_id', a.student_id)
      break
    }
    default: throw new Error('This can’t be undone.')
  }
  const { data } = await admin.from('agent_actions').update({ status: 'undone', decided_at: new Date().toISOString() }).eq('id', a.id).select('*').single()
  return data as ActionRow
}

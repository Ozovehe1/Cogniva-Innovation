/**
 * Zero wait for a new learner's first lesson (server only, service-role client).
 *
 * While the adaptive diagnostic runs, the likely starting topic is predicted after every answer
 * (startPlan on the partial knowledge state). Once the prediction is fairly clear (60% of the
 * minimum questions asked and the same prediction twice in a row, or one question before the
 * minimum), that topic's lesson is created as an AI lesson that is not yet attached to any path
 * topic (so the learner never sees it) and drafted by the normal beat worker: plan + opening beat
 * in parallel, then the next beats, each pre-voiced. Free-tier pacing and the lesson-draft-tick
 * cron apply as for any lesson.
 *
 * When the diagnostic finishes (buildPath), settleSpeculation attaches the draft to the first
 * topic if it is for the same skill (reused), otherwise deletes it (discarded) and the right
 * lesson is drafted at once. A changed, stable prediction mid-diagnostic replaces the draft, at
 * most MAX_TRIES drafts per path. Outcomes are kept in learning_paths.speculation.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { MIN_ITEMS, type DiagState } from './diagnostic-core'
import { learnerForPath, type LearnerRow, type PathRow, type TopicRow } from './learner'
import { lessonFields, startPlan } from './path'
import { SPECULATIVE_PAUSE } from './lesson-drafting'

export interface Speculation {
  lessonId?: string | null
  nodeId?: string | null
  /** When the current draft was started, and after how many answers. */
  at?: string
  asked?: number
  tries?: number
  lastPrediction?: string | null
  stableFor?: number
  discarded?: string[]
  outcome?: 'reused' | 'discarded' | 'none'
  outcomeAt?: string
  startNode?: string
  /** Beats ready (and published) when the diagnostic finished. */
  beatsAtFinish?: number
}

export const SPECULATE_AFTER = Math.ceil(MIN_ITEMS * 0.6)
const MAX_TRIES = 2

/**
 * Called by the answer request with the new diagnostic state, before it is saved. Returns the
 * speculation to save with it, the lesson to start drafting and a draft to drop (both done in
 * the background by the caller). Creating the lesson row here (one insert) keeps the speculation
 * written in the same update as the answer, so consecutive answers never race on it.
 */
export async function planSpeculation(db: SupabaseClient, learner: LearnerRow, path: PathRow, st: DiagState): Promise<{ spec: Speculation; start?: string; drop?: string }> {
  const prev = ((path as PathRow & { speculation?: Speculation | null }).speculation ?? {}) as Speculation
  if (st.done || !path.graph?.nodes?.length) return { spec: prev }
  const l = learnerForPath(learner, path)
  const sp = startPlan(l, path.graph, st)
  const prediction = sp.first?.id ?? null
  const stableFor = prediction && prediction === prev.lastPrediction ? (prev.stableFor ?? 1) + 1 : 1
  const spec: Speculation = { ...prev, lastPrediction: prediction, stableFor }
  const asked = st.asked.length
  const clear = asked >= SPECULATE_AFTER && (stableFor >= 2 || asked >= MIN_ITEMS - 1)
  if (!prediction || !sp.first || !clear || prediction === prev.nodeId || (prev.tries ?? 0) >= MAX_TRIES) return { spec }
  const node = sp.first
  const fields = await lessonFields(db, l, { ...path, known: sp.known, plan: sp.plan }, { node_id: node.id, title: node.title, summary: node.summary, target_minutes: sp.plan.lessonMinutes }, { firstLesson: true })
  const { data, error } = await db.from('lessons').insert({ ...fields, draft_status: 'outlining', script: [], chapters: [] }).select('id').single()
  if (error || !data) { console.warn('Speculative lesson not created:', error?.message); return { spec } }
  const id = (data as { id: string }).id
  const drop = prev.lessonId ?? undefined
  console.log(`Speculation: path ${path.id} drafting "${node.title}" ahead after ${asked} answers (try ${(prev.tries ?? 0) + 1})${drop ? `, replacing ${prev.nodeId}` : ''}`)
  return {
    spec: { ...spec, lessonId: id, nodeId: node.id, at: new Date().toISOString(), asked, tries: (prev.tries ?? 0) + 1, discarded: drop && prev.nodeId ? [...(prev.discarded ?? []), prev.nodeId] : prev.discarded },
    start: id, drop,
  }
}

/** Delete a speculative draft nobody will see (its sections, clip jobs and audio links cascade or are nulled). */
export async function dropSpeculativeLesson(db: SupabaseClient, lessonId: string) {
  // Only an unattached AI lesson: never one a path topic points at.
  const { data: used } = await db.from('path_topics').select('id').eq('lesson_id', lessonId).limit(1)
  if (used?.length) return
  await db.from('lessons').delete().eq('id', lessonId).eq('generated_by', 'ai')
}

/**
 * At the end of the diagnostic: reuse the draft for the first topic when it is for the same
 * skill, otherwise drop it. Returns the reused lesson id, if any.
 */
export async function settleSpeculation(db: SupabaseClient, learner: LearnerRow, path: PathRow, first: TopicRow): Promise<{ outcome: 'reused' | 'discarded' | 'none'; lessonId?: string }> {
  const spec = ((path as PathRow & { speculation?: Speculation | null }).speculation ?? {}) as Speculation
  const save = async (s: Speculation) => { await db.from('learning_paths').update({ speculation: s }).eq('id', path.id) }
  const outcomeAt = new Date().toISOString()
  if (!spec.lessonId) { await save({ ...spec, outcome: 'none', outcomeAt, startNode: first.node_id }); return { outcome: 'none' } }
  const { data: lesson } = await db.from('lessons').select('id, draft_status, draft_error').eq('id', spec.lessonId).maybeSingle()
  const l = lesson as { id: string; draft_status: string; draft_error: string | null } | null
  if (l && spec.nodeId === first.node_id && !first.lesson_id && l.draft_status !== 'failed') {
    // Same skill: the final notes (now with the full known set) and length steer the beats still to be written.
    const fields = await lessonFields(db, learner, path, first, { firstLesson: true })
    // A draft waiting after its opening beats (or stopped as abandoned) carries on now.
    const resume = l.draft_error === SPECULATIVE_PAUSE && (l.draft_status === 'paused' || l.draft_status === 'partial')
      ? { draft_status: 'drafting', draft_error: null, draft_retry_at: null } : {}
    await db.from('lessons').update({ draft_notes: fields.draft_notes, target_minutes: fields.target_minutes, objectives: fields.objectives, title: fields.title, ...resume }).eq('id', spec.lessonId)
    const { data: won } = await db.from('path_topics').update({ lesson_id: spec.lessonId, status: 'learning' }).eq('id', first.id).is('lesson_id', null).select('id')
    if (won?.length) {
      const { count } = await db.from('lesson_sections').select('id', { count: 'exact', head: true }).eq('lesson_id', spec.lessonId).eq('status', 'ready')
      await save({ ...spec, outcome: 'reused', outcomeAt, startNode: first.node_id, beatsAtFinish: count ?? 0 })
      return { outcome: 'reused', lessonId: spec.lessonId }
    }
  }
  await dropSpeculativeLesson(db, spec.lessonId)
  await save({ ...spec, lessonId: null, outcome: 'discarded', outcomeAt, startNode: first.node_id, discarded: [...(spec.discarded ?? []), spec.nodeId ?? '?'] })
  return { outcome: 'discarded' }
}

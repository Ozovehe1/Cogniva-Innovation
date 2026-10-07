/**
 * Learning path operations (server only, service-role client): build the path
 * from the diagnostic, create AI lessons for topics, unlock after mastery and
 * re-diagnose after repeated errors.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ancestors, knownSkills, readyToLearn, topoOrder, type DiagState } from './diagnostic-core'
import { pathNodes, planFor, teachingNotes, type LearnerRow, type PathRow, type TopicRow } from './learner'

export async function recentLowMood(db: SupabaseClient, studentId: string): Promise<boolean> {
  const { data } = await db.from('learner_checkins').select('mood, energy, confidence').eq('student_id', studentId)
    .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1)
  const r = (data ?? [])[0] as { mood: number | null; energy: number | null; confidence: number | null } | undefined
  return !!r && ((r.mood ?? 3) <= 2 || (r.energy ?? 3) <= 2 || (r.confidence ?? 3) <= 2)
}

/** Finish the diagnostic: known / ready sets, plan, topics; the first lesson is created right away. */
export async function buildPath(db: SupabaseClient, learner: LearnerRow, path: PathRow): Promise<{ path: PathRow; topics: TopicRow[]; firstLessonId: string | null }> {
  const st = path.diagnostic.state as DiagState
  const g = path.graph
  const known = knownSkills(g, st)
  const ready = readyToLearn(g, st)
  const provisional = planFor(learner, g.nodes.length)
  const nodes = pathNodes(g, known, provisional.scope)
  const plan = planFor(learner, nodes.length)
  const readySet = new Set(ready)

  // Due dates: spread over the deadline when there is one, otherwise by sessions per week.
  const perTopicDays = plan.weeksLeft && plan.weeksLeft > 0
    ? Math.max(1, (plan.weeksLeft * 7) / Math.max(1, nodes.length))
    : 7 / Math.max(1, plan.sessionsPerWeek / 1.6)
  const today = Date.now()
  await db.from('path_topics').delete().eq('path_id', path.id)
  const rows = nodes.map((n, i) => ({
    path_id: path.id, student_id: path.student_id, node_id: n.id, position: i, title: n.title, summary: n.summary,
    status: readySet.has(n.id) || (i === 0 && !nodes.some(x => readySet.has(x.id))) ? 'ready' : 'locked',
    target_minutes: plan.lessonMinutes,
    due_on: new Date(today + Math.round((i + 1) * perTopicDays) * 86_400_000).toISOString().slice(0, 10),
  }))
  const { data: topics, error } = await db.from('path_topics').insert(rows).select('*')
  if (error) throw new Error(error.message)
  const { data: updated } = await db.from('learning_paths').update({ status: 'ready', known, ready, plan, diagnostic: path.diagnostic }).eq('id', path.id).select('*').single()
  const list = ((topics ?? []) as TopicRow[]).sort((a, b) => a.position - b.position)
  const first = list.find(t => t.status === 'ready') ?? null
  let firstLessonId: string | null = null
  if (first) firstLessonId = await createTopicLesson(db, learner, updated as PathRow, first, { firstLesson: true })
  return { path: updated as PathRow, topics: list, firstLessonId }
}

/** Create the AI lesson for a topic (drafting starts in the background). Returns the lesson id. */
export async function createTopicLesson(db: SupabaseClient, learner: LearnerRow, path: PathRow, topic: TopicRow, opts: { firstLesson?: boolean } = {}): Promise<string> {
  if (topic.lesson_id) return topic.lesson_id
  const lowMood = await recentLowMood(db, path.student_id)
  const notes = teachingNotes({ learner, path, nodeId: topic.node_id, firstLesson: !!opts.firstLesson, lowMood })
  let minutes = topic.target_minutes ?? path.plan.lessonMinutes ?? 15
  if (opts.firstLesson && lowMood) minutes = Math.min(minutes, 10)
  const objectives = [topic.summary || `Understand ${topic.title}`, `Use ${topic.title.toLowerCase()} on the way to: ${path.goal}`].map(s => s.slice(0, 300))
  const { data, error } = await db.from('lessons').insert({
    tutor_id: null, owner_student_id: path.student_id, generated_by: 'ai',
    title: topic.title, subject: path.subject || learner.subject || '', objectives,
    status: 'approved', target_minutes: Math.max(5, Math.min(180, minutes)),
    draft_status: 'outlining', draft_notes: notes, script: [], chapters: [],
  }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Could not create the lesson')
  const id = (data as { id: string }).id
  await db.from('path_topics').update({ lesson_id: id, status: topic.status === 'locked' ? 'ready' : 'learning' }).eq('id', topic.id)
  return id
}

/** Mark a topic mastered and unlock topics whose prerequisites are now all known. */
export async function masterTopic(db: SupabaseClient, path: PathRow, topic: TopicRow, score: number) {
  await db.from('path_topics').update({ status: 'mastered', mastered_at: new Date().toISOString(), wrong_streak: 0, mastery: { ...topic.mastery, items: undefined, lastScore: score } }).eq('id', topic.id)
  const known = [...new Set([...(path.known ?? []), topic.node_id])]
  const { data } = await db.from('path_topics').select('*').eq('path_id', path.id).order('position')
  const topics = (data ?? []) as TopicRow[]
  const done = new Set([...known, ...topics.filter(t => t.status === 'mastered').map(t => t.node_id)])
  const unlocked: string[] = []
  for (const t of topics) {
    if (t.status !== 'locked') continue
    const node = path.graph.nodes.find(n => n.id === t.node_id)
    if (node && node.prereqs.every(p => done.has(p) || !topics.some(x => x.node_id === p))) {
      await db.from('path_topics').update({ status: 'ready' }).eq('id', t.id)
      unlocked.push(t.id)
    }
  }
  const ready = topics.filter(t => t.status === 'ready' || unlocked.includes(t.id)).map(t => t.node_id)
  await db.from('learning_paths').update({ known, ready }).eq('id', path.id)
  return { unlocked }
}

/**
 * Re-diagnose after repeated errors: the topic's known prerequisites are checked again
 * with diagnostic items the learner has not seen (or the ones they answered before).
 */
export function recheckItems(path: PathRow, topic: TopicRow): { node: string; item: number }[] {
  const g = path.graph
  const st = path.diagnostic.state as DiagState | undefined
  const known = new Set(path.known ?? [])
  const pre = [...ancestors(g, topic.node_id)].filter(id => known.has(id))
  // Closest prerequisites first.
  const order = topoOrder(g).map(n => n.id).filter(id => pre.includes(id)).reverse().slice(0, 3)
  return order.map(id => {
    const n = g.nodes.find(x => x.id === id)!
    const used = new Set((st?.asked ?? []).filter(a => a.node === id).map(a => a.item))
    const fresh = n.items.findIndex((_, i) => !used.has(i))
    return { node: id, item: fresh >= 0 ? fresh : 0 }
  })
}

/** A prerequisite failed the re-check: put it back into the path, ready, before the topic. */
export async function reopenPrerequisite(db: SupabaseClient, path: PathRow, topic: TopicRow, nodeId: string) {
  const node = path.graph.nodes.find(n => n.id === nodeId)
  if (!node) return null
  const known = (path.known ?? []).filter(k => k !== nodeId)
  path.known = known
  const { data: existing } = await db.from('path_topics').select('*').eq('path_id', path.id).eq('node_id', nodeId).maybeSingle()
  if (existing) {
    await db.from('path_topics').update({ status: 'review', mastered_at: null }).eq('id', (existing as TopicRow).id)
  } else {
    // Shift later topics down and insert the prerequisite just before the topic.
    const { data: later } = await db.from('path_topics').select('id, position').eq('path_id', path.id).gte('position', topic.position).order('position', { ascending: false })
    for (const t of (later ?? []) as { id: string; position: number }[]) await db.from('path_topics').update({ position: t.position + 1 }).eq('id', t.id)
    await db.from('path_topics').insert({ path_id: path.id, student_id: path.student_id, node_id: nodeId, position: topic.position, title: node.title, summary: node.summary, status: 'review', target_minutes: topic.target_minutes, due_on: topic.due_on })
  }
  await db.from('path_topics').update({ status: 'locked' }).eq('id', topic.id)
  await db.from('learning_paths').update({ known, rediagnosed_at: new Date().toISOString() }).eq('id', path.id)
  return node.title
}

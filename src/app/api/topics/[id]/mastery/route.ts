import { NextResponse, after } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { GeminiQuotaError } from '@/lib/gemini'
import { learnerForPath, loadLearner, masteryItems, type PathRow, type TopicRow } from '@/lib/learner'
import { masterTopic, prefetchNextLesson, recheckItems, reopenPrerequisite } from '@/lib/path'
import { selfOrigin } from '@/lib/lesson-drafting'
import { displayItem, storedItemProblems } from '@/lib/question-quality'
import { normalizeMathText } from '@/lib/math-text'

export const maxDuration = 120

/** Mastery threshold: 3 of 4 (75%) to unlock the next topic. */
const PASS = 0.75

function publicQuiz(t: TopicRow, path: PathRow) {
  // Stored questions are normalised on read too (older ones may hold bare LaTeX).
  const items = (t.mastery.items ?? []).map(displayItem).map((it, i) => ({ i, q: it.q, options: it.options }))
  const recheck = (t.mastery.recheck ?? []).map((r, i) => {
    const n = path.graph.nodes.find(x => x.id === r.node)
    const raw = n?.items[r.item]
    const it = raw ? displayItem(raw) : null
    return it ? { i, topic: normalizeMathText(n!.title), q: it.q, options: it.options } : null
  }).filter(Boolean)
  return { topicId: t.id, title: t.title, status: t.status, attempts: t.mastery_attempts, wrongStreak: t.wrong_streak, items, recheck }
}

async function load(id: string, studentId: string) {
  const db = createAdminClient()
  const { data: t } = await db.from('path_topics').select('*').eq('id', id).eq('student_id', studentId).maybeSingle()
  if (!t) return null
  const { data: p } = await db.from('learning_paths').select('*').eq('id', (t as TopicRow).path_id).single()
  return { db, topic: t as TopicRow, path: p as PathRow }
}

/** GET /api/topics/:id/mastery — the current mastery check (no answers). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const r = await load(id, profile.id)
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(publicQuiz(r.topic, r.path))
}

/**
 * POST /api/topics/:id/mastery
 *  { action: 'start' }                    → 4 fresh questions on the skill
 *  { action: 'submit', answers: number[] } → pass (≥75%) unlocks the next topics; a second miss in a row triggers a re-check of prerequisites
 *  { action: 'recheck_start' }            → re-check the prerequisites (also used after repeated wrong answers in a lesson)
 *  { action: 'recheck', answers: number[] } → a missed prerequisite goes back into the path before this topic
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const r = await load(id, profile.id)
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { db, path } = r
  let topic = r.topic
  const body = await request.json().catch(() => ({})) as { action?: string; answers?: unknown[] }
  const answers = Array.isArray(body.answers) ? body.answers.map(a => (typeof a === 'number' ? a : null)) : []

  if (body.action === 'start') {
    // A stored, unanswered check written before the quality gate is rewritten when its options are too close to tell apart.
    const stale = (topic.mastery.items ?? []).some(it => storedItemProblems(it).length > 0)
    if (!topic.mastery.items?.length || stale) {
      const learner = await loadLearner(db, profile.id)
      if (!learner) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      try {
        const items = await masteryItems({ learner: learnerForPath(learner, path), topicTitle: topic.title, summary: topic.summary, goal: path.goal })
        const { data } = await db.from('path_topics').update({ mastery: { ...topic.mastery, items, startedAt: new Date().toISOString() } }).eq('id', topic.id).select('*').single()
        topic = data as TopicRow
      } catch (err) {
        const quota = err instanceof GeminiQuotaError
        return NextResponse.json({ error: quota ? 'The AI is busy right now. Please try again in a minute.' : 'Could not write your check. Please try again.' }, { status: quota ? 503 : 502 })
      }
    }
    return NextResponse.json(publicQuiz(topic, path))
  }

  if (body.action === 'submit') {
    const items = topic.mastery.items ?? []
    if (!items.length) return NextResponse.json({ error: 'Start the check first' }, { status: 400 })
    const results = items.map(displayItem).map((it, i) => ({ correct: answers[i] === it.answer, answer: it.options[it.answer], explain: it.explain ?? null }))
    const score = results.filter(x => x.correct).length / items.length
    if (score >= PASS) {
      const { unlocked } = await masterTopic(db, path, topic, score)
      const { data: next } = await db.from('path_topics').select('id, title, lesson_id').eq('path_id', path.id).in('status', ['ready', 'review']).order('position').limit(1)
      // Keep one lesson written ahead: the one after the topic that just opened up.
      const nextLesson = ((next ?? [])[0] as { lesson_id: string | null } | undefined)?.lesson_id
      const origin = selfOrigin(request)
      after(() => prefetchNextLesson(db, nextLesson ?? topic.lesson_id ?? '', { origin }).then(() => undefined).catch(() => {}))
      return NextResponse.json({ passed: true, score, results, unlocked: unlocked.length, next: (next ?? [])[0] ?? null })
    }
    const streak = topic.wrong_streak + 1
    const recheck = streak >= 2 ? recheckItems(path, topic) : []
    await db.from('path_topics').update({
      mastery_attempts: topic.mastery_attempts + 1, wrong_streak: streak, status: 'learning',
      mastery: { ...topic.mastery, items: undefined, lastScore: score, recheck: recheck.length ? recheck : undefined },
    }).eq('id', topic.id)
    const { data: fresh } = await db.from('path_topics').select('*').eq('id', topic.id).single()
    return NextResponse.json({ passed: false, score, results, recheck: recheck.length > 0, quiz: publicQuiz(fresh as TopicRow, path) })
  }

  if (body.action === 'recheck_start') {
    const recheck = recheckItems(path, topic)
    const { data: fresh } = await db.from('path_topics').update({ mastery: { ...topic.mastery, recheck } }).eq('id', topic.id).select('*').single()
    return NextResponse.json({ ...publicQuiz(fresh as TopicRow, path), noPrerequisites: recheck.length === 0 })
  }

  if (body.action === 'recheck') {
    const rc = topic.mastery.recheck ?? []
    if (!rc.length) return NextResponse.json({ error: 'No re-check in progress' }, { status: 400 })
    const missed: string[] = []
    const results = rc.map((x, i) => {
      const found = path.graph.nodes.find(n => n.id === x.node)?.items[x.item]
      const it = found ? displayItem(found) : undefined
      const correct = !!it && answers[i] === it.answer
      if (!correct) missed.push(x.node)
      return { correct, answer: it ? it.options[it.answer] : null, explain: it?.explain ?? null }
    })
    let reopened: string[] = []
    if (missed.length) {
      for (const node of missed) { const t = await reopenPrerequisite(db, path, topic, node); if (t) reopened.push(t) }
      await db.from('path_topics').update({ wrong_streak: 0, mastery: { ...topic.mastery, recheck: undefined } }).eq('id', topic.id)
    } else {
      await db.from('path_topics').update({ wrong_streak: 0, mastery: { ...topic.mastery, recheck: undefined } }).eq('id', topic.id)
      reopened = []
    }
    const { data: next } = await db.from('path_topics').select('id, title, lesson_id').eq('path_id', path.id).in('status', ['ready', 'review']).order('position').limit(1)
    return NextResponse.json({ results, reopened, next: (next ?? [])[0] ?? null })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

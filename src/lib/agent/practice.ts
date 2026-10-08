/**
 * Interactive practice sets made by the agent. Answers stay on the server (agent_actions.result); the
 * learner gets a hint after a first wrong try and the answer only after a second (hints before answers).
 * When every question is answered, the review is recorded from those real answers: BKT observations and
 * an FSRS rating on the skill, logged with an undo snapshot. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { displayItem } from '../question-quality'
import { logAction, type ActionRow } from './actions'
import { observeSkill, ratingForScore } from './learner-model'

interface PracticeResult { items: { q: string; options: string[]; answer: number; explain?: string; hint: string }[]; answers: Record<string, { tries: number[]; correct: boolean; done: boolean }>; finished?: boolean; review?: unknown }

export async function answerPractice(admin: SupabaseClient, studentId: string, actionId: string, index: number, choice: number) {
  const { data } = await admin.from('agent_actions').select('*').eq('id', actionId).eq('student_id', studentId).eq('tool', 'make_practice_set').maybeSingle()
  const a = data as ActionRow | null
  if (!a) return { status: 404, body: { error: 'Practice set not found' } }
  const r = a.result as unknown as PracticeResult
  const item = r.items?.[index]
  if (!item || !Number.isInteger(choice) || choice < 0 || choice >= item.options.length) return { status: 400, body: { error: 'Bad answer' } }
  const shown = displayItem(item)
  const prev = r.answers?.[index] ?? { tries: [], correct: false, done: false }
  if (prev.done) return { status: 200, body: { done: true, correct: prev.correct, answer: item.answer, explain: shown.explain ?? null } }
  const correct = choice === item.answer
  const tries = [...prev.tries, choice]
  const done = correct || tries.length >= 2
  // Only a first-try success counts as correct for the learner model (a hinted success is partial).
  const firstTry = correct && tries.length === 1
  const answers: PracticeResult['answers'] = { ...(r.answers ?? {}), [index]: { tries, correct: firstTry, done } }
  const next: PracticeResult = { ...r, answers }
  await admin.from('agent_actions').update({ result: next }).eq('id', a.id)
  let review: unknown = null
  if (Object.keys(answers).length === r.items.length && Object.values(answers).every(x => x.done)) review = await finishPractice(admin, { ...a, result: next as never })
  return {
    status: 200,
    body: correct
      ? { done: true, correct: true, firstTry, explain: shown.explain ?? null, review }
      : done
        ? { done: true, correct: false, answer: item.answer, explain: shown.explain ?? null, review }
        : { done: false, correct: false, hint: item.hint },
  }
}

/** Record the review from the real answers (idempotent: once per set). */
export async function finishPractice(admin: SupabaseClient, a: ActionRow) {
  const r = a.result as unknown as PracticeResult
  if (r.finished) return { already: true, review: r.review }
  const answers = Object.values(r.answers ?? {})
  if (!answers.length || answers.length < r.items.length || !answers.every(x => x.done)) return { error: 'The learner has not answered every question yet; a review is only logged from real answers.' }
  const score = answers.filter(x => x.correct).length / r.items.length
  const pathId = a.args.path_id as string | null, nodeId = a.args.node_id as string | null
  let review: Record<string, unknown> = { score }
  if (pathId && nodeId) {
    const rating = ratingForScore(score)
    const { before, after } = await observeSkill(admin, { studentId: a.student_id, pathId, nodeId, title: String(a.args.topic ?? nodeId), answers: answers.map(x => ({ correct: x.correct, weight: 0.6 })), review: rating })
    review = { score, rating, p_mastery: Math.round(after.p_mastery * 100) / 100, next_review: after.due_at }
    await logAction(admin, { studentId: a.student_id, runId: a.run_id, source: 'student', tool: 'log_review', args: { practice_action_id: a.id, path_id: pathId, node_id: nodeId }, result: review, undo: { type: 'restore_skill', key: { student_id: a.student_id, path_id: pathId, node_id: nodeId }, before }, summary: `Review logged: ${String(a.args.topic ?? '')} (${Math.round(score * 100)}%)` })
  }
  await admin.from('agent_actions').update({ result: { ...r, finished: true, review } }).eq('id', a.id)
  return review
}

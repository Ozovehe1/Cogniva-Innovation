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

interface Numeric { value: number; unit?: string; tol: number; mistakes?: { value: number; why: string }[] }
interface PracticeResult { items: { q: string; options: string[]; answer: number; explain?: string; hint: string; numeric?: Numeric; answerText?: string }[]; answers: Record<string, { tries: number[]; correct: boolean; done: boolean }>; finished?: boolean; review?: unknown }

/**
 * A typed numeric answer: a number with an optional unit ("1.5", "1.5 A", "1500 mA", "3/4"). Returns the value in the
 * item's unit, or null when it cannot be read or the unit does not convert.
 */
export function readNumeric(typed: string, unit?: string): number | null {
  const t = typed.trim().replace(/,/g, '').replace(/−/g, '-').replace(/\s+/g, ' ')
  const m = /^(-?\d+(?:\.\d+)?|-?\.\d+)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*(.*)$/.exec(t)
  if (!m) return null
  let v = Number(m[1]) / (m[2] ? Number(m[2]) : 1)
  const u = m[3].trim().replace(/ohms?|Ω/i, 'Ω').replace(/^°$/, '°')
  if (!u || !unit || u === unit || u.toLowerCase() === unit.toLowerCase()) return Number.isFinite(v) ? v : null
  // SI prefixes on the same unit (mA, kΩ, cm, g→kg …)
  const P: Record<string, number> = { m: 1e-3, k: 1e3, c: 1e-2, M: 1e6, 'µ': 1e-6, u: 1e-6, n: 1e-9 }
  const pre = (a: string, b: string) => (a.length === b.length + 1 && a.endsWith(b) && a[0] in P ? P[a[0]] : null)
  const f1 = pre(u, unit), f2 = pre(unit, u)
  if (f1 !== null) v *= f1
  else if (f2 !== null) v /= f2
  else return null
  return Number.isFinite(v) ? v : null
}

const within = (a: number, b: number, tol: number) => Math.abs(a - b) <= Math.max(tol * Math.abs(b), 1e-9)

/** A typed answer to a numeric item (worked-example your-turn): tolerance, units, and a hint that names a known mistake. */
export async function answerNumeric(admin: SupabaseClient, studentId: string, actionId: string, index: number, typed: string) {
  const { data } = await admin.from('agent_actions').select('*').eq('id', actionId).eq('student_id', studentId).eq('tool', 'make_practice_set').maybeSingle()
  const a = data as ActionRow | null
  if (!a) return { status: 404, body: { error: 'Practice set not found' } }
  const r = a.result as unknown as PracticeResult
  const item = r.items?.[index]
  if (!item?.numeric || typeof typed !== 'string' || !typed.trim() || typed.length > 40) return { status: 400, body: { error: 'Bad answer' } }
  const prev = r.answers?.[index] ?? { tries: [], correct: false, done: false }
  if (prev.done) return { status: 200, body: { done: true, correct: prev.correct, answerText: item.answerText ?? null, explain: item.explain ?? null } }
  const v = readNumeric(typed, item.numeric.unit)
  if (v === null) return { status: 200, body: { done: false, correct: false, hint: `Type a number${item.numeric.unit ? ` in ${item.numeric.unit}` : ''}, like 2.5.`, unread: true } }
  const correct = within(v, item.numeric.value, item.numeric.tol)
  const tries = [...prev.tries, v]
  const done = correct || tries.length >= 2
  const firstTry = correct && tries.length === 1
  const answers: PracticeResult['answers'] = { ...(r.answers ?? {}), [index]: { tries, correct: firstTry, done } }
  await admin.from('agent_actions').update({ result: { ...r, answers } }).eq('id', a.id)
  let review: unknown = null
  if (Object.keys(answers).length === r.items.length && Object.values(answers).every(x => x.done)) review = await finishPractice(admin, { ...a, result: { ...r, answers } as never })
  const mistake = !correct ? item.numeric.mistakes?.find(m => within(v, m.value, Math.max(item.numeric!.tol, 0.01)) && m.why) : undefined
  const hint = mistake ? `That is what you get if you ${mistake.why.replace(/^(you )?/i, '').replace(/\.$/, '')}. ${item.hint}` : item.hint
  return { status: 200, body: correct ? { done: true, correct: true, firstTry, answerText: item.answerText ?? null, explain: item.explain ?? null, review } : done ? { done: true, correct: false, answerText: item.answerText ?? null, explain: item.explain ?? null, mistake: mistake?.why ?? null, review } : { done: false, correct: false, hint } }
}

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

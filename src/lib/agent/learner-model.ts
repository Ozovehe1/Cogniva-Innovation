/**
 * The learner model: per skill, a BKT-style probability of mastery (fixed priors) and an FSRS card
 * (ts-fsrs, FSRS v6) that schedules retrieval practice. The 3-of-4 mastery gate in the mastery route
 * stays the authority on unlocking; p_mastery orders reviews and gives the agent context. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs'

const scheduler = fsrs({ enable_fuzz: true, request_retention: 0.9 })

/** BKT parameters (fixed priors; revisit with data). */
const BKT = { learn: 0.15, slip: 0.1, guess: 0.25 }

export function bktUpdate(p: number, correct: boolean, weight = 1): number {
  const post = correct
    ? (p * (1 - BKT.slip)) / (p * (1 - BKT.slip) + (1 - p) * BKT.guess)
    : (p * BKT.slip) / (p * BKT.slip + (1 - p) * (1 - BKT.guess))
  const mixed = p + (post - p) * Math.max(0, Math.min(1, weight))
  const learned = mixed + (1 - mixed) * BKT.learn * weight
  return Math.max(0.01, Math.min(0.99, learned))
}

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'
const GRADE: Record<ReviewRating, Grade> = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy }

/** Mastery-check score to an FSRS rating: 4/4 Good, 3/4 Hard, below the gate Again. */
export function ratingForScore(score: number): ReviewRating {
  return score >= 0.999 ? 'good' : score >= 0.75 ? 'hard' : 'again'
}

interface StoredCard { due: string; stability: number; difficulty: number; elapsed_days: number; scheduled_days: number; reps: number; lapses: number; learning_steps?: number; state: number; last_review?: string | null }

function toCard(s: StoredCard | null | undefined, now: Date): Card {
  if (!s || !s.due) return createEmptyCard(now)
  return { ...(s as unknown as Card), due: new Date(s.due), last_review: s.last_review ? new Date(s.last_review) : undefined } as Card
}
function fromCard(c: Card): StoredCard {
  return {
    due: c.due.toISOString(), stability: c.stability, difficulty: c.difficulty, elapsed_days: c.elapsed_days, scheduled_days: c.scheduled_days,
    reps: c.reps, lapses: c.lapses, learning_steps: (c as { learning_steps?: number }).learning_steps ?? 0, state: c.state, last_review: c.last_review ? c.last_review.toISOString() : null,
  }
}

export interface SkillRow {
  student_id: string; path_id: string; node_id: string; title: string; lesson_id: string | null
  p_mastery: number; n_obs: number; last_obs_at: string | null; fsrs_card: StoredCard | null; due_at: string | null
}

export async function loadSkill(db: SupabaseClient, studentId: string, pathId: string, nodeId: string): Promise<SkillRow | null> {
  const { data } = await db.from('learner_skill_state').select('*').eq('student_id', studentId).eq('path_id', pathId).eq('node_id', nodeId).maybeSingle()
  return (data as SkillRow | null) ?? null
}

/**
 * Record observations (each answer is one; a confidence tap can down-weight) and optionally an FSRS review.
 * Returns the row before and after, so the caller can log an undo.
 */
export async function observeSkill(db: SupabaseClient, input: {
  studentId: string; pathId: string; nodeId: string; title?: string; lessonId?: string | null
  answers?: { correct: boolean; weight?: number }[]; review?: ReviewRating; prior?: number
}): Promise<{ before: SkillRow | null; after: SkillRow }> {
  const before = await loadSkill(db, input.studentId, input.pathId, input.nodeId)
  const now = new Date()
  let p = before?.p_mastery ?? input.prior ?? 0.3
  for (const a of input.answers ?? []) p = bktUpdate(p, a.correct, a.weight ?? 1)
  let card = before?.fsrs_card ?? null
  let due = before?.due_at ?? null
  if (input.review) {
    const next = scheduler.next(toCard(card, now), now, GRADE[input.review])
    card = fromCard(next.card)
    due = next.card.due.toISOString()
  }
  const row: SkillRow = {
    student_id: input.studentId, path_id: input.pathId, node_id: input.nodeId,
    title: input.title ?? before?.title ?? input.nodeId, lesson_id: input.lessonId ?? before?.lesson_id ?? null,
    p_mastery: p, n_obs: (before?.n_obs ?? 0) + (input.answers?.length ?? 0), last_obs_at: now.toISOString(), fsrs_card: card, due_at: due,
  }
  const { error } = await db.from('learner_skill_state').upsert({ ...row, updated_at: now.toISOString() }, { onConflict: 'student_id,path_id,node_id' })
  if (error) throw new Error(error.message)
  return { before, after: row }
}

/** Restore a skill row to an earlier snapshot (undo), or delete it when it did not exist. */
export async function restoreSkill(db: SupabaseClient, key: { student_id: string; path_id: string; node_id: string }, before: SkillRow | null) {
  if (!before) { await db.from('learner_skill_state').delete().eq('student_id', key.student_id).eq('path_id', key.path_id).eq('node_id', key.node_id); return }
  await db.from('learner_skill_state').upsert({ ...before, updated_at: new Date().toISOString() }, { onConflict: 'student_id,path_id,node_id' })
}

/** Skills whose review is due by `by` (most overdue first). */
export async function dueReviews(db: SupabaseClient, studentId: string, by = new Date(Date.now() + 18 * 3600_000), limit = 8) {
  const { data } = await db.from('learner_skill_state').select('path_id, node_id, title, lesson_id, p_mastery, due_at, fsrs_card')
    .eq('student_id', studentId).not('due_at', 'is', null).lte('due_at', by.toISOString()).order('due_at').limit(limit)
  return (data ?? []) as Pick<SkillRow, 'path_id' | 'node_id' | 'title' | 'lesson_id' | 'p_mastery' | 'due_at' | 'fsrs_card'>[]
}

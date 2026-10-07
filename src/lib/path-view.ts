import type { SupabaseClient } from '@supabase/supabase-js'
import { loadLearner, type LearnerRow, type PathRow, type TopicRow } from './learner'
import { stepSpeech } from '@/components/whiteboard/speech'
import type { Step } from './lesson-schema'

export interface LessonProgress { step_index: number; completed_at: string | null; updated_at?: string }

/** One of the learner's paths (a goal), with its topics in order. */
export interface PathEntry {
  path: PathRow
  topics: TopicRow[]
  next: TopicRow | null
  mastered: number
  /** ms epoch of the learner's last lesson activity on this path (or when it was made). */
  lastActive: number
}

export interface PathView {
  learner: LearnerRow | null
  /** Every finished path, most recently studied first. */
  paths: PathEntry[]
  /** An unfinished check for a new goal, if any. */
  diagnosing: PathRow | null
  progress: Map<string, LessonProgress>
  /** The most recently studied path (paths[0]) and its fields, for single-path views. */
  path: PathRow | null
  topics: TopicRow[]
  next: TopicRow | null
}

export function nextTopic(topics: TopicRow[]) {
  return topics.find(t => t.status === 'learning') ?? topics.find(t => t.status === 'review') ?? topics.find(t => t.status === 'ready') ?? null
}

/** Everything the learner pages show about their paths (RLS: the learner's own rows). */
export async function loadPathView(supabase: SupabaseClient, studentId: string): Promise<PathView> {
  const learner = await loadLearner(supabase, studentId)
  const progress = new Map<string, LessonProgress>()
  const empty: PathView = { learner, paths: [], diagnosing: null, progress, path: null, topics: [], next: null }
  if (!learner?.completed_at) return empty
  const { data: rows } = await supabase.from('learning_paths').select('*').eq('student_id', studentId).neq('status', 'archived').order('created_at', { ascending: false })
  const all = (rows ?? []) as PathRow[]
  const ready = all.filter(p => p.status === 'ready')
  const diagnosing = all.find(p => p.status === 'diagnosing') ?? null
  let topics: TopicRow[] = []
  if (ready.length) {
    const { data } = await supabase.from('path_topics').select('*').in('path_id', ready.map(p => p.id)).order('position')
    topics = (data ?? []) as TopicRow[]
    const ids = topics.map(t => t.lesson_id).filter(Boolean) as string[]
    if (ids.length) {
      const { data: p } = await supabase.from('lesson_progress').select('lesson_id, step_index, completed_at, updated_at').eq('student_id', studentId).in('lesson_id', ids)
      for (const r of (p ?? []) as (LessonProgress & { lesson_id: string })[]) progress.set(r.lesson_id, r)
    }
  }
  const paths: PathEntry[] = ready.map(path => {
    const own = topics.filter(t => t.path_id === path.id).sort((a, b) => a.position - b.position)
    const active = own.map(t => (t.lesson_id ? progress.get(t.lesson_id)?.updated_at : undefined)).filter(Boolean).map(d => new Date(d!).getTime())
    return {
      path, topics: own, next: nextTopic(own),
      mastered: own.filter(t => t.status === 'mastered').length,
      lastActive: Math.max(new Date(path.created_at ?? 0).getTime(), ...active),
    }
  }).sort((a, b) => b.lastActive - a.lastActive)
  const first = paths[0]
  return { learner, paths, diagnosing, progress, path: first?.path ?? null, topics: first?.topics ?? [], next: first?.next ?? null }
}

/** The first spoken lines of a lesson (to fetch its voice before the learner opens it). */
export async function openingLines(supabase: SupabaseClient, lessonId: string | null | undefined, count = 6): Promise<string[]> {
  if (!lessonId) return []
  const { data } = await supabase.from('lessons').select('script').eq('id', lessonId).maybeSingle()
  const script = (data as { script?: unknown } | null)?.script
  if (!Array.isArray(script)) return []
  const out: string[] = []
  for (const s of script as Step[]) {
    if (out.length >= count) break
    try { const t = stepSpeech(s); if (t) out.push(t) } catch { /* skip malformed */ }
  }
  return out
}

export const PURPOSE_LABEL: Record<string, string> = {
  curiosity: 'Curiosity', project: 'A project', exam: 'An exam or school', career: 'Work or career', helping: 'Helping someone',
}

export function formatDue(d: string | null) {
  if (!d) return null
  return new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

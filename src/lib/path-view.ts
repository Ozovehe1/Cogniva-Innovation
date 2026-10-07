import type { SupabaseClient } from '@supabase/supabase-js'
import { latestPath, loadLearner, type LearnerRow, type PathRow, type TopicRow } from './learner'

export interface PathView {
  learner: LearnerRow | null
  path: PathRow | null
  topics: TopicRow[]
  progress: Map<string, { step_index: number; completed_at: string | null }>
  next: TopicRow | null
}

/** Everything the learner pages show about the path (RLS: the learner's own rows). */
export async function loadPathView(supabase: SupabaseClient, studentId: string): Promise<PathView> {
  const learner = await loadLearner(supabase, studentId)
  const path = learner?.completed_at ? await latestPath(supabase, studentId) : null
  let topics: TopicRow[] = []
  const progress = new Map<string, { step_index: number; completed_at: string | null }>()
  if (path && path.status === 'ready') {
    const { data } = await supabase.from('path_topics').select('*').eq('path_id', path.id).order('position')
    topics = (data ?? []) as TopicRow[]
    const ids = topics.map(t => t.lesson_id).filter(Boolean) as string[]
    if (ids.length) {
      const { data: p } = await supabase.from('lesson_progress').select('lesson_id, step_index, completed_at').eq('student_id', studentId).in('lesson_id', ids)
      for (const r of (p ?? []) as { lesson_id: string; step_index: number; completed_at: string | null }[]) progress.set(r.lesson_id, r)
    }
  }
  const next = topics.find(t => t.status === 'learning') ?? topics.find(t => t.status === 'review') ?? topics.find(t => t.status === 'ready') ?? null
  return { learner, path, topics, progress, next }
}

export const PURPOSE_LABEL: Record<string, string> = {
  curiosity: 'Curiosity', project: 'A project', exam: 'An exam or school', career: 'Work or career', helping: 'Helping someone',
}

export function formatDue(d: string | null) {
  if (!d) return null
  return new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

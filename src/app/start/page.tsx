import { redirect } from 'next/navigation'
import { getSessionProfile } from '@/lib/auth'
import { diagnosticPath, loadLearner } from '@/lib/learner'
import { GOAL_ITEMS, priorKnowledge } from '@/lib/intake'
import { emptyState, firstSkills, knownSkills, publicItem, readyToLearn, MAX_ITEMS, MIN_ITEMS, type DiagState } from '@/lib/diagnostic-core'
import { IntakeFlow } from '@/components/intake-flow'


export const dynamic = 'force-dynamic'
export const metadata = { title: 'Get started · GeniusMap', robots: { index: false } }

export default async function StartPage({ searchParams }: { searchParams: Promise<{ edit?: string; new?: string }> }) {
  const sp = await searchParams
  // ?new=1: learn something else. The intake re-asks only the goal questions; finishing it adds a new path
  // and every existing path (and its lessons) stays as it is.
  const fresh = sp.new === '1'
  const edit = sp.edit
  const { supabase, profile } = await getSessionProfile()
  if (!profile) redirect('/login?next=/start')
  const learner = await loadLearner(supabase, profile.id)
  const path = learner?.completed_at && !fresh ? await diagnosticPath(supabase, profile.id) : null
  let view = null
  if (path?.graph?.nodes) {
    // RLS lets the learner read their own path; only the current question (no answers) goes to the browser.
    const st = (path.diagnostic?.state ?? emptyState()) as DiagState
    const title = (id: string) => path.graph.nodes.find(n => n.id === id)?.title ?? id
    view = {
      pathId: path.id, goal: path.goal, subject: path.subject, status: path.status, asked: st.asked.length, min: MIN_ITEMS, max: MAX_ITEMS,
      item: publicItem(path.graph, st), done: st.done, fresh: !!path.diagnostic?.fresh,
      known: path.status === 'ready' ? knownSkills(path.graph, st).map(title) : undefined,
      next: path.status === 'ready' ? (path.diagnostic?.fresh ? firstSkills(path.graph) : readyToLearn(path.graph, st)).map(title) : undefined,
    }
  }
  return (
    <IntakeFlow
      firstName={profile.full_name.split(' ')[0] || 'there'}
      initialAnswers={fresh ? Object.fromEntries(Object.entries(learner?.answers ?? {}).filter(([k]) => !GOAL_ITEMS.includes(k))) : learner?.answers ?? {}}
      startAt={fresh ? 'goal' : undefined}
      initialItem={learner?.current_item ?? null}
      completed={!!learner?.completed_at}
      startFresh={!fresh && priorKnowledge(learner?.answers ?? {}).none}
      initialPath={view}
      edit={edit === '1' || fresh}
    />
  )
}

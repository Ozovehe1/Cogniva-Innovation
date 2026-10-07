import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildGraph, latestPath, loadLearner, type PathRow } from '@/lib/learner'
import { buildPath } from '@/lib/path'
import { GeminiQuotaError } from '@/lib/gemini'
import { applyAnswer, emptyState, knownSkills, nextItem, publicItem, readyToLearn, MAX_ITEMS, MIN_ITEMS, type Confidence, type DiagState } from '@/lib/diagnostic-core'

export const maxDuration = 300

function view(path: PathRow) {
  const st = (path.diagnostic?.state ?? emptyState()) as DiagState
  const g = path.graph
  const title = (id: string) => g.nodes?.find(n => n.id === id)?.title ?? id
  const last = st.asked[st.asked.length - 1]
  const lastNode = last ? g.nodes.find(n => n.id === last.node) : null
  return {
    pathId: path.id,
    goal: path.goal,
    subject: path.subject,
    status: path.status,
    asked: st.asked.length,
    min: MIN_ITEMS,
    max: MAX_ITEMS,
    item: publicItem(g, st),
    // Feedback on the previous answer: right or not, plus the one-line explanation.
    last: last ? { correct: last.correct, skipped: last.choice === null, explain: lastNode?.items[last.item]?.explain ?? null, answer: lastNode?.items[last.item]?.options[lastNode.items[last.item].answer] ?? null } : null,
    done: st.done,
    known: st.done || path.status === 'ready' ? knownSkills(g, st).map(title) : undefined,
    next: st.done || path.status === 'ready' ? readyToLearn(g, st).map(title) : undefined,
  }
}

/** GET /api/diagnostic — the current diagnostic (resume) without answers. */
export async function GET() {
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const path = await latestPath(supabase, profile.id)
  if (!path || !path.graph?.nodes) return NextResponse.json({ path: null })
  return NextResponse.json({ path: view(path) })
}

/**
 * POST /api/diagnostic
 *  { action: 'start', restart? }  → builds the prerequisite graph and item bank for the learner's goal (one AI call)
 *  { action: 'answer', node, item, choice: number|null, confidence: 'guess'|'fairly'|'sure'|null }
 *  { action: 'finish' }           → builds the learning path (known / ready, plan, topics, first lesson)
 * Graph, bank and answers stay server-side; the client only ever sees the current question.
 */
export async function POST(request: Request) {
  const { profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { action?: string; restart?: boolean; node?: string; item?: number; choice?: number | null; confidence?: string | null }
  const db = createAdminClient()
  const learner = await loadLearner(db, profile.id)
  if (!learner?.completed_at) return NextResponse.json({ error: 'Finish the intake first.' }, { status: 400 })
  let path = await latestPath(db, profile.id)

  if (body.action === 'start') {
    if (path && path.status === 'diagnosing' && path.graph?.nodes && !body.restart) return NextResponse.json({ path: view(path) })
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const { count } = await db.from('learning_paths').select('id', { count: 'exact', head: true }).eq('student_id', profile.id).gte('created_at', since)
    if ((count ?? 0) >= 6) return NextResponse.json({ error: 'You have started several new checks today. Try again tomorrow.' }, { status: 429 })
    let graph
    try {
      graph = await buildGraph(learner)
    } catch (err) {
      const quota = err instanceof GeminiQuotaError
      return NextResponse.json({ error: quota ? 'The AI is busy right now. Please try again in a minute.' : 'Could not prepare your check. Please try again.', detail: (err instanceof Error ? err.message : String(err)).slice(0, 200) }, { status: quota ? 503 : 502 })
    }
    if (path) await db.from('learning_paths').update({ status: 'archived' }).eq('student_id', profile.id).neq('status', 'archived')
    const st = emptyState()
    st.current = nextItem(graph, st)
    const { data, error } = await db.from('learning_paths').insert({
      student_id: profile.id, goal: learner.goal ?? learner.goal_text ?? graph.subject, subject: graph.subject || learner.subject || '',
      status: 'diagnosing', graph, diagnostic: { state: st },
    }).select('*').single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Could not save' }, { status: 500 })
    if (graph.subject && !learner.subject) await db.from('learner_profiles').update({ subject: graph.subject }).eq('student_id', profile.id)
    return NextResponse.json({ path: view(data as PathRow) })
  }

  if (!path || !path.graph?.nodes) return NextResponse.json({ error: 'No diagnostic in progress' }, { status: 404 })

  if (body.action === 'answer') {
    if (path.status !== 'diagnosing') return NextResponse.json({ path: view(path) })
    const st = path.diagnostic.state as DiagState
    if (!st.current || st.current.node !== body.node || st.current.item !== body.item) return NextResponse.json({ path: view(path) })
    const node = path.graph.nodes.find(n => n.id === st.current!.node)!
    const it = node.items[st.current.item]
    const choice = typeof body.choice === 'number' && body.choice >= 0 && body.choice < it.options.length ? Math.floor(body.choice) : null
    const confidence = (['guess', 'fairly', 'sure'] as const).includes(body.confidence as Confidence) ? (body.confidence as Confidence) : null
    const next = applyAnswer(path.graph, st, { node: node.id, item: st.current.item, choice, correct: choice === it.answer, confidence })
    const { data } = await db.from('learning_paths').update({ diagnostic: { ...path.diagnostic, state: next } }).eq('id', path.id).select('*').single()
    path = data as PathRow
    return NextResponse.json({ path: view(path) })
  }

  if (body.action === 'finish') {
    const st = path.diagnostic.state as DiagState
    if (path.status === 'ready') {
      const { data: t } = await db.from('path_topics').select('lesson_id').eq('path_id', path.id).not('lesson_id', 'is', null).order('position').limit(1)
      return NextResponse.json({ path: view(path), firstLessonId: (t ?? [])[0]?.lesson_id ?? null })
    }
    if (!st.done && st.asked.length < MIN_ITEMS) return NextResponse.json({ error: 'A few more questions first.' }, { status: 400 })
    if (!st.done) { st.done = true; st.current = null }
    path.diagnostic = { ...path.diagnostic, state: st }
    try {
      const r = await buildPath(db, learner, path)
      // Start drafting the first lesson now so it is ready (or nearly) when they open it.
      if (r.firstLessonId) {
        const { after } = await import('next/server')
        const { runDraftWork, selfOrigin } = await import('@/lib/lesson-drafting')
        const origin = selfOrigin(request)
        after(() => runDraftWork(r.firstLessonId!, { origin }).then(() => undefined).catch(err => console.error('First lesson draft failed:', err)))
      }
      return NextResponse.json({ path: view({ ...r.path, diagnostic: { state: st } }), firstLessonId: r.firstLessonId })
    } catch (err) {
      return NextResponse.json({ error: 'Could not build your path. Please try again.', detail: (err instanceof Error ? err.message : String(err)).slice(0, 200) }, { status: 500 })
    }
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

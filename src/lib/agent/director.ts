/**
 * The Learning Director: background agent turns after a lesson, after a mastery check, after a mood
 * check-in, and nightly (02:00 WAT). Events go through the pgmq queue "agent_events" and are drained right
 * away (after the response) and by the agent-tick pg_cron job. Each event is ONE LLM agent turn with tools
 * (gpt-oss-120b first, then the other Groq models, then Gemini) that decides what to remember, what to
 * review, whether to reteach or step back, which visual to make, and today's plan and why.
 *
 * Code keeps the guardrails only: the 3-of-4 mastery gate (in the mastery route) and the FSRS/BKT update
 * from real answers happen before the turn and cannot be changed by it; no mark-mastered tool exists;
 * writes are capped, idempotent, logged and undoable. When every model is rate-limited, a deterministic
 * fallback does the minimum (memory from the lesson digest, a rule-based plan, a remediation proposal after
 * two misses). Opening the app reads daily_plans and makes no model call. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { AllModelsBusyError } from './llm'
import { runAgent, DIRECTOR_SYSTEM, MAX_WRITES } from './run'
import { savePlan, type AgentCtx } from './tools'
import type { Block, PlanItem } from './types'
import { findAction, idemKey, logAction, remediationTarget, todayWAT } from './actions'
import { dueReviews, observeSkill, ratingForScore } from './learner-model'
import { writeMemory, type MemoryRow } from './memory'
import { lessonDigest } from '../lesson-digest'
import { loadLearner, type TopicRow } from '../learner'
import { levelLine } from '../intake'
import { prefetchNextLesson } from '../path'

export type EventKind = 'post_lesson' | 'post_check' | 'checkin' | 'nightly_plan'
export interface AgentEvent { kind: EventKind; student_id: string; payload: Record<string, unknown> }

export async function enqueueEvent(admin: SupabaseClient, kind: EventKind, studentId: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc('agent_enqueue', { p_kind: kind, p_student: studentId, p_payload: payload, p_delay: 0 })
  if (error) console.warn('agent_enqueue failed:', error.message)
  return data as number | null
}

/** Drain up to n events (pgmq visibility timeout keeps a slow event from being taken twice). */
export async function drainEvents(admin: SupabaseClient, n = 3, opts: { origin?: string; deadline?: number } = {}) {
  const { data, error } = await admin.rpc('agent_dequeue', { p_n: n, p_vt: 240 })
  if (error) throw new Error(error.message)
  const out: { kind: string; ok: boolean; summary: string }[] = []
  for (const m of (data ?? []) as { msg_id: number; read_ct: number; message: AgentEvent }[]) {
    if (opts.deadline && Date.now() > opts.deadline - 20_000) break
    if (m.read_ct > 3) { await admin.rpc('agent_ack', { p_msg_id: m.msg_id }); out.push({ kind: m.message.kind, ok: false, summary: 'dropped after 3 tries' }); continue }
    try {
      const r = await handleEvent(admin, m.message, opts)
      await admin.rpc('agent_ack', { p_msg_id: m.msg_id })
      out.push({ kind: m.message.kind, ok: true, summary: r.summary })
    } catch (err) {
      out.push({ kind: m.message.kind, ok: false, summary: err instanceof Error ? err.message.slice(0, 200) : String(err) })
    }
  }
  return out
}

function newCtx(admin: SupabaseClient, studentId: string, origin?: string): AgentCtx {
  const blocks: Block[] = []
  return {
    mode: 'director', studentId, admin, userDb: null, runId: `dir_${randomUUID().slice(0, 12)}`, origin,
    writes: 0, maxWrites: MAX_WRITES, restricted: false, practiceMode: false,
    emit: b => { blocks.push(b) }, blocks, trace: [], searchUrls: new Set(), computeCalls: 0, sources: [],
    limits: { animations: 0, miniLessons: Number(process.env.AGENT_DAILY_MINI_LESSONS ?? 2), practiceSets: 10, webSearches: 0, pythonRuns: 0 },
  }
}

export async function handleEvent(admin: SupabaseClient, ev: AgentEvent, opts: { origin?: string; deadline?: number; forceFallback?: boolean } = {}) {
  const day = todayWAT()
  const ref = String(ev.payload.lesson_id ?? ev.payload.topic_id ?? ev.payload.checkin_id ?? (ev.payload.attempt ?? '')) || day
  const key = idemKey(`director:${ev.kind}`, ev.student_id, ref + (ev.kind === 'post_check' ? `:${ev.payload.attempt ?? ''}` : ''), day)
  const done = await findAction(admin, key)
  if (done) return { summary: 'already handled', action: done }
  const ctx = newCtx(admin, ev.student_id, opts.origin)
  const facts = await prepare(admin, ev, ctx)
  let summary = ''
  let model: string | null = null
  let fallback = false
  try {
    if (opts.forceFallback) throw new AllModelsBusyError('forced')
    const r = await runAgent({ ctx, system: DIRECTOR_SYSTEM, messages: [{ role: 'user', content: facts.prompt }], deadline: opts.deadline ?? Date.now() + 150_000 })
    summary = r.text.trim().slice(0, 400) || `Handled ${ev.kind}.`
    model = r.model
  } catch (err) {
    if (!(err instanceof AllModelsBusyError)) console.warn('Director turn failed, using fallback:', err instanceof Error ? err.message : err)
    fallback = true
    summary = await deterministic(admin, ev, ctx, facts)
  }
  // Recap visuals the turn made become a chat the learner can open from today's plan.
  if (ctx.blocks.some(b => b.kind === 'board' || b.kind === 'svg')) await saveRecap(admin, ctx, facts.title)
  // A plan must exist for today after any event (rule-based when the turn did not write one).
  const { data: plan } = await admin.from('daily_plans').select('updated_at').eq('student_id', ev.student_id).eq('plan_date', day).maybeSingle()
  if (!plan) await rulePlan(admin, ev.student_id, ctx.runId, { light: facts.low })
  const action = await logAction(admin, { studentId: ev.student_id, runId: ctx.runId, source: 'director', tool: `director:${ev.kind}`, key, args: ev.payload, result: { summary, model, fallback, tools: ctx.trace.slice(0, 8) }, summary })
  return { summary, action, fallback, model }
}

interface Facts { prompt: string; title: string; low: boolean; topic?: TopicRow | null; digest?: string | null }

/** Deterministic pre-work (guardrails and facts) and the turn's prompt. */
async function prepare(admin: SupabaseClient, ev: AgentEvent, ctx: AgentCtx): Promise<Facts> {
  const learner = await loadLearner(admin, ev.student_id)
  const who = `Learner: ${learner ? levelLine(learner) : 'unknown level'}; weekly time ${learner?.weekly_hours ?? '?'} h; interests: ${(learner?.interests ?? []).join(', ') || 'none given'}. Today (WAT): ${todayWAT()}.`
  const p = ev.payload
  if (ev.kind === 'post_lesson') {
    const lessonId = String(p.lesson_id)
    const { data: t } = await admin.from('path_topics').select('*').eq('lesson_id', lessonId).eq('student_id', ev.student_id).maybeSingle()
    const topic = t as TopicRow | null
    const d = await lessonDigest(admin, lessonId, 3000).catch(() => null)
    if (topic) await observeSkill(admin, { studentId: ev.student_id, pathId: topic.path_id, nodeId: topic.node_id, title: topic.title, lessonId, answers: [{ correct: true, weight: 0.3 }] }).catch(() => null)
    const { data: next } = topic ? await admin.from('path_topics').select('id, title, status, lesson_id').eq('path_id', topic.path_id).gt('position', topic.position).neq('status', 'mastered').order('position').limit(1) : { data: [] }
    return {
      title: d?.title ?? 'your lesson', low: false, topic, digest: d?.text ?? null,
      prompt: `EVENT post_lesson: the learner just FINISHED the lesson "${d?.title ?? lessonId}" (lesson_id ${lessonId})${topic ? ` for topic "${topic.title}" (topic_id ${topic.id}); its mastery check is next` : ' (not on a path)'}.
${who}
Next topic on the path: ${(next ?? [])[0] ? JSON.stringify((next ?? [])[0]) : 'none'}.
What the lesson taught:
<data source="lesson">${d?.text ?? '(no content)'}</data>
Decide: memories to save (lesson_summary with this lesson_id), whether to prefetch the next lesson, today's plan.`,
    }
  }
  if (ev.kind === 'post_check') {
    const topicId = String(p.topic_id)
    const { data: t } = await admin.from('path_topics').select('*').eq('id', topicId).eq('student_id', ev.student_id).maybeSingle()
    const topic = t as TopicRow | null
    const score = Number(p.score)
    const results = (Array.isArray(p.results) ? p.results : []) as { q?: string; correct?: boolean; chosen?: string | null; answer?: string; explain?: string | null }[]
    let review = ''
    if (topic) {
      // Guardrail: the FSRS card and p_mastery come from the real answers, before the turn.
      const rating = ratingForScore(score)
      const r = await observeSkill(admin, { studentId: ev.student_id, pathId: topic.path_id, nodeId: topic.node_id, title: topic.title, lessonId: topic.lesson_id, answers: results.map(x => ({ correct: !!x.correct })), review: p.passed ? rating : 'again' }).catch(() => null)
      if (r) review = `FSRS rating ${p.passed ? rating : 'again'} recorded; p_mastery now ${r.after.p_mastery.toFixed(2)}; next review ${r.after.due_at?.slice(0, 10) ?? 'n/a'}.`
    }
    return {
      title: topic?.title ?? 'your check', low: false, topic,
      prompt: `EVENT post_check: mastery check on "${topic?.title ?? topicId}" (topic_id ${topicId}). Score ${Math.round(score * 100)}% → ${p.passed ? 'PASSED (topic mastered by the gate)' : 'not passed'}. Failed attempts so far: ${topic?.mastery_attempts ?? '?'}, wrong streak ${topic?.wrong_streak ?? '?'}. ${review}
${who}
Answers:
<data source="check">${results.map((x, i) => `${i + 1}. ${String(x.q ?? '').slice(0, 220)} | ${x.correct ? 'right' : `wrong (chose: ${String(x.chosen ?? '?').slice(0, 80)}; correct: ${String(x.answer ?? '').slice(0, 80)})`}${x.explain ? ` | key step: ${String(x.explain).slice(0, 160)}` : ''}`).join('\n')}</data>
Decide: misconception memories (with the fix), whether to reteach (mini lesson or recap visual), whether to propose stepping back, today's plan.`,
    }
  }
  if (ev.kind === 'checkin') {
    const low = [p.mood, p.energy, p.confidence].some(v => typeof v === 'number' && v <= 2)
    return {
      title: 'your check-in', low,
      prompt: `EVENT checkin: the learner reported mood ${p.mood ?? '?'}/5, energy ${p.energy ?? '?'}/5, confidence ${p.confidence ?? '?'}/5${p.lesson_id ? ` during lesson ${p.lesson_id}` : ''}. ${low ? 'This is LOW: make today lighter (reviews they can win, a short practice, rest; no new topics).' : 'Not low: keep the plan, adjust only if needed.'}
${who}
Decide today's plan (and only that, unless something else clearly helps).`,
    }
  }
  const due = await dueReviews(admin, ev.student_id)
  return {
    title: 'tonight’s plan', low: false,
    prompt: `EVENT nightly_plan: write the learner's plan for today (${todayWAT()}).
${who}
Reviews due (spaced repetition): ${due.length ? due.map(d => `${d.title} (path ${d.path_id}, node ${d.node_id}, p=${d.p_mastery.toFixed(2)})`).join('; ') : 'none'}.
Look at get_path_progress, then set_today_plan: due reviews first (2-5 min each), then the next lesson or check, within about a third of their weekly time per day.`,
  }
}

/* ───────────── Deterministic fallback (models rate-limited) ───────────── */

async function deterministic(admin: SupabaseClient, ev: AgentEvent, ctx: AgentCtx, facts: Facts): Promise<string> {
  const did: string[] = []
  if (ev.kind === 'post_lesson' && facts.digest) {
    const lessonId = String(ev.payload.lesson_id)
    const beats = facts.digest.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2))
    const chunks: string[] = []
    for (let i = 0; i < beats.length; i += 4) chunks.push(beats.slice(i, i + 4).join(' '))
    const rows: MemoryRow[] = chunks.slice(0, 3).map((c, i) => ({ kind: 'lesson_summary', title: `${facts.title}${chunks.length > 1 ? ` (part ${i + 1})` : ''}`, content: c, lesson_id: lessonId, node_id: facts.topic?.node_id ?? null, path_id: facts.topic?.path_id ?? null, source_key: `lesson:${lessonId}:${i}` }))
    const n = await writeMemory(admin, ev.student_id, rows)
    if (n) did.push(`saved ${n} lesson memories`)
    const pre = await prefetchNextLesson(admin, lessonId, { origin: ctx.origin }).catch(() => null)
    if (pre) did.push('prepared the next lesson')
  }
  if (ev.kind === 'post_check') {
    const results = (Array.isArray(ev.payload.results) ? ev.payload.results : []) as { q?: string; correct?: boolean; answer?: string; explain?: string | null }[]
    const wrong = results.filter(r => !r.correct)
    if (wrong.length && facts.topic) {
      await writeMemory(admin, ev.student_id, wrong.slice(0, 3).map(w => ({ kind: 'misconception', title: `Missed in the ${facts.topic!.title} check`, content: `Question: ${String(w.q ?? '').slice(0, 300)} Correct answer: ${String(w.answer ?? '')}. ${w.explain ? `Key step: ${w.explain}` : ''}`, node_id: facts.topic!.node_id, path_id: facts.topic!.path_id, lesson_id: facts.topic!.lesson_id })))
      did.push('saved what was missed')
    }
    if (!ev.payload.passed && facts.topic && facts.topic.wrong_streak >= 2) {
      const r = await remediationTarget(admin, ev.student_id, facts.topic.id, null)
      if (!('error' in r)) {
        const key = idemKey('suggest_remediation', ev.student_id, `${r.topic.id}:${r.nodeId}`)
        if (!(await findAction(admin, key))) await logAction(admin, { studentId: ev.student_id, runId: ctx.runId, source: 'director', tool: 'suggest_remediation', key, autonomy: 'confirm', status: 'proposed', args: { topic_id: r.topic.id, node_id: r.nodeId, reason: 'Two checks in a row were missed; a quick return to the earlier skill usually fixes it.' }, summary: `Go back to “${r.title}” before “${r.topic.title}”` })
        did.push(`proposed revisiting “${r.title}”`)
      }
    }
  }
  await rulePlan(admin, ev.student_id, ctx.runId, { light: facts.low })
  did.push(facts.low ? 'made today lighter' : 'updated today’s plan')
  return `Fallback (models busy): ${did.join('; ')}.`
}

/** Rule-based plan: due reviews, then the next lesson or check per goal. Light: reviews and rest only. */
export async function rulePlan(admin: SupabaseClient, studentId: string, runId: string, opts: { light?: boolean; save?: boolean } = {}): Promise<{ items: PlanItem[]; note: string }> {
  const items: PlanItem[] = []
  const due = await dueReviews(admin, studentId)
  for (const d of due.slice(0, opts.light ? 2 : 2)) items.push({ kind: 'review', title: `Quick review: ${d.title}`, why: 'Due today, so it sticks.', minutes: 5, pathId: d.path_id, nodeId: d.node_id, href: `/ask?q=${encodeURIComponent(`Quick review: ${d.title}`)}` })
  if (!opts.light) {
    const { data: topics } = await admin.from('path_topics').select('id, path_id, title, status, lesson_id, position').eq('student_id', studentId).in('status', ['learning', 'review', 'ready']).order('position')
    const { data: paths } = await admin.from('learning_paths').select('id').eq('student_id', studentId).eq('status', 'ready').order('created_at', { ascending: false }).limit(2)
    const lessonIds = (topics ?? []).map(t => t.lesson_id).filter(Boolean) as string[]
    const { data: prog } = lessonIds.length ? await admin.from('lesson_progress').select('lesson_id, completed_at').eq('student_id', studentId).in('lesson_id', lessonIds) : { data: [] }
    const finished = new Set((prog ?? []).filter(p => p.completed_at).map(p => p.lesson_id))
    for (const p of paths ?? []) {
      const t = (topics ?? []).filter(x => x.path_id === p.id).sort((a, b) => (a.status === 'learning' ? -1 : 0) - (b.status === 'learning' ? -1 : 0) || a.position - b.position)[0]
      if (!t) continue
      if (t.lesson_id && finished.has(t.lesson_id)) items.push({ kind: 'check', title: `Mastery check: ${t.title}`, why: 'You finished the lesson; 3 of 4 unlocks the next topic.', minutes: 8, topicId: t.id, pathId: t.path_id, lessonId: t.lesson_id, href: `/learn/${t.lesson_id}/check` })
      else items.push({ kind: 'lesson', title: t.title, why: t.status === 'review' ? 'Back to basics before moving on.' : 'Next on your path.', minutes: 15, topicId: t.id, pathId: t.path_id, lessonId: t.lesson_id ?? undefined, href: t.lesson_id ? `/learn/${t.lesson_id}` : '/dashboard' })
      if (items.length >= 4) break
    }
  } else items.push({ kind: 'rest', title: 'Take it easy today', why: 'You said you’re low on energy. A short review is plenty.', minutes: 5 })
  const note = opts.light ? 'A lighter day: a little review and some rest.' : items.length ? 'Reviews first while you’re fresh, then the next step.' : 'Nothing due today. Ask GeniusMap anything you’re curious about.'
  if (opts.save !== false) await savePlan({ admin, studentId, runId }, items, note, opts.light ? 'checkin' : 'rule', !!opts.light)
  return { items, note }
}

/** Recap visuals from a Director turn become a chat session, linked from today's plan. */
async function saveRecap(admin: SupabaseClient, ctx: AgentCtx, title: string) {
  const visual = ctx.blocks.filter(b => b.kind === 'board' || b.kind === 'svg')
  const { data: s } = await admin.from('chat_sessions').insert({ student_id: ctx.studentId, title: `Recap: ${title}`.slice(0, 120) }).select('id').single()
  if (!s) return
  await admin.from('chat_messages').insert({ session_id: s.id, student_id: ctx.studentId, role: 'assistant', content: `Here’s a quick recap of ${title}, made for you after your last session.`, blocks: visual })
  const day = todayWAT()
  const { data: plan } = await admin.from('daily_plans').select('items').eq('student_id', ctx.studentId).eq('plan_date', day).maybeSingle()
  const items = ((plan?.items ?? []) as PlanItem[]).filter(i => i.kind !== 'recap')
  items.unshift({ kind: 'recap', title: `Recap: ${title}`, why: 'A picture of what tripped you up.', minutes: 2, sessionId: s.id, href: `/ask?session=${s.id}` })
  if (plan) await admin.from('daily_plans').update({ items: items.slice(0, 6), updated_at: new Date().toISOString() }).eq('student_id', ctx.studentId).eq('plan_date', day)
  else await admin.from('daily_plans').insert({ student_id: ctx.studentId, plan_date: day, items, note: 'Start with your recap.', source: 'agent' })
}

/**
 * Called from routes (lesson finished, check submitted, check-in): queue the event, then drain it right after
 * the response. If this instance dies, the agent-tick pg_cron job picks it up within a minute.
 */
export async function kickDirector(kind: EventKind, studentId: string, payload: Record<string, unknown>, origin?: string) {
  const { createAdminClient } = await import('../supabase/admin')
  const { after } = await import('next/server')
  const admin = createAdminClient()
  await enqueueEvent(admin, kind, studentId, payload)
  after(() => drainEvents(admin, 2, { origin, deadline: Date.now() + 200_000 }).then(() => undefined).catch(err => console.warn('director drain:', err instanceof Error ? err.message : err)))
}

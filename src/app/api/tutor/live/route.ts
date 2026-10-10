import { randomUUID } from 'node:crypto'
import { getSessionProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { detectDistress } from '@/lib/safety'
import { withLlmContext } from '@/lib/agent/pool'
import { AllModelsBusyError } from '@/lib/agent/llm'
import { learnerFacts, lessonBoardAt, lessonPos, tutorState } from '@/lib/agent/tutor-state'
import { lessonDigest } from '@/lib/lesson-digest'
import { normalizeChapters } from '@/lib/lesson-sections'
import { loadLearner } from '@/lib/learner'
import { levelLine } from '@/lib/intake'
import { writeMemory } from '@/lib/agent/memory'
import { textGate } from '@/lib/correctness/chat'
import { guardBlock } from '@/lib/correctness/chat'
import type { AgentCtx } from '@/lib/agent/tools'
import type { Block } from '@/lib/agent/types'
import type { CheckStep, Step } from '@/lib/lesson-schema'
import { liveAgentOn } from '@/lib/live/registry'
import { runLive } from '@/lib/live/agent'
import { parseSignal, signalLine, type LearnerSignal } from '@/lib/live/signals'
import { newWakeState, noteSlider, shouldWake } from '@/lib/live/policy'
import { busySignalLine } from '@/lib/live/busy'
import { benchInitiated } from '@/lib/live/tools/bench'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

const BUDGET_MS = 75_000

/**
 * POST /api/tutor/live  { lessonId, signal, recent?: signal[], stage?: string[], cursor?: number }
 *   → NDJSON: {t:'wake', woke, why} … {t:'decision', move, reason, plan} {t:'tool'} {t:'block'} {t:'text'} {t:'done'}
 * The Live Tutor agent's event channel. The server re-runs the wake policy (the one that counts; it is rebuilt from
 * this learner's logged decisions, so every instance agrees), then wakes the agent with the signal, and logs the
 * decision (signal → reasoning → plan → tools → outcome) to agent_actions as `live_decision`.
 * GET /api/tutor/live?lessonId=…  → this learner's recent decisions (the trace view).
 * Feature flag: LIVE_AGENT=0 turns the whole channel off (the lesson then behaves exactly as before).
 */
export async function POST(request: Request) {
  const t0 = Date.now()
  if (!liveAgentOn()) return Response.json({ off: true }, { status: 404 })
  const { supabase, profile } = await getSessionProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const signal = parseSignal(body.signal)
  const lessonId = typeof body.lessonId === 'string' && /^[0-9a-f-]{36}$/i.test(body.lessonId) ? body.lessonId : null
  if (!signal || !lessonId) return Response.json({ error: 'signal and lessonId are required' }, { status: 400 })
  const recent = (Array.isArray(body.recent) ? body.recent : []).slice(-12).map(parseSignal).filter((s): s is LearnerSignal => !!s)
  if (!recent.some(r => r.at === signal.at && r.kind === signal.kind)) recent.push(signal)
  const stage = (Array.isArray(body.stage) ? body.stage : []).slice(-6).map(x => String(x).slice(0, 300))
  const admin = createAdminClient()
  const studentId = profile.id

  const { data: lesson } = await admin.from('lessons').select('id, title, script, chapters, owner_student_id, status').eq('id', lessonId).maybeSingle()
  const l = lesson as { id: string; title: string; script: Step[] | null; chapters: unknown; owner_student_id: string | null; status: string } | null
  if (!l || (l.owner_student_id && l.owner_student_id !== studentId) || (!l.owner_student_id && l.status !== 'approved')) return Response.json({ error: 'Lesson not found' }, { status: 404 })

  // Safety first: typed text that reads as distress pauses everything (no model sees it).
  const typed = `${signal.detail ?? ''} ${signal.answer ?? ''}`
  if ((signal.kind === 'message' || signal.kind === 'lost' || signal.kind === 'answer') && detectDistress(typed)) return Response.json({ safety: true })

  // The wake gate (server copy): rebuilt from this learner's decisions in the last 10 minutes.
  const since = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data: rows } = await admin.from('agent_actions').select('args, created_at').eq('student_id', studentId).eq('tool', 'live_decision').gte('created_at', since).order('created_at', { ascending: true }).limit(40)
  const st = newWakeState()
  for (const r of (rows ?? []) as { args: { signal?: { kind?: string; where?: string }; urgent?: boolean }; created_at: string }[]) {
    const at = Date.parse(r.created_at), kind = (r.args?.signal?.kind ?? 'tap') as LearnerSignal['kind']
    st.wakes.push({ at, kind, urgent: !!r.args?.urgent })
    st.lastByKind[kind] = at
    if (kind === 'hesitation' && r.args?.signal?.where) st.hesitatedAt[r.args.signal.where] = at
  }
  const now = Date.now()
  for (const s of recent.filter(s => s.kind === 'slider')) noteSlider(st, { ...s, at: Math.min(s.at, now) })
  // Client clocks drift: judge the slider settle time by the client's own last move.
  const gate = shouldWake(st, signal, signal.kind === 'slider' ? Math.max(now, (recent.filter(s => s.kind === 'slider').pop()?.at ?? 0) + 3000) : now)

  const enc = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
  let closed = false
  const send = (e: Record<string, unknown>) => { if (!closed) try { controller.enqueue(enc.encode(JSON.stringify(e) + '\n')) } catch { closed = true } }
  const beat = setInterval(() => send({ t: 'ping' }), 8000)
  const close = () => { if (!closed) { closed = true; clearInterval(beat); try { controller.close() } catch { /* closed */ } } }

  const work = async () => {
    send({ t: 'wake', woke: gate.wake, why: gate.why })
    if (!gate.wake) { send({ t: 'done', woke: false }); return }
    const runId = `live_${randomUUID().slice(0, 12)}`
    const script: Step[] = Array.isArray(l.script) ? l.script : []
    const cursor = Number.isInteger(body.cursor) ? Math.max(0, Math.min(script.length, body.cursor as number)) : 0
    const chapters = normalizeChapters(l.chapters, script.length, l.title, script)
    const pos = script.length ? lessonPos(l.title, script, chapters, cursor) : null
    const board = script.length ? lessonBoardAt(script, cursor) : null
    const [learner, facts, digest, mem] = await Promise.all([
      loadLearner(admin, studentId).catch(() => null),
      learnerFacts(admin, studentId, { lessonId }).catch(() => null),
      lessonDigest(admin, lessonId, 500).catch(() => null),
      admin.from('learner_memory').select('title, content, kind').eq('student_id', studentId).in('kind', ['teaching_note', 'misconception']).order('created_at', { ascending: false }).limit(4),
    ])
    const memory = ((mem.data ?? []) as { title: string; content: string; kind: string }[]).map(m => `${m.kind === 'teaching_note' ? 'worked before' : 'misconception'}: ${m.content}`.slice(0, 200))
    const lastActs = ((rows ?? []) as { args: { signal?: { kind?: string }; move?: string; tools?: string[] } }[]).slice(-3).map(r => `${r.args?.signal?.kind ?? '?'} → ${r.args?.move ?? '?'}${r.args?.tools?.length ? ` (${r.args.tools.join(', ')})` : ''}`)
    // The check the signal is about (for its expected answer and the busy fallback).
    const checkAt = typeof signal.step === 'number' ? script[signal.step] : null
    const check = checkAt?.type === 'check' ? checkAt as CheckStep : null
    if (check && signal.kind === 'answer' && !signal.expected) signal.expected = check.kind === 'choice' && Array.isArray(check.options) && typeof check.answer === 'number' ? String(check.options[check.answer] ?? '') : check.accept?.[0]
    if (check && !signal.detail) signal.detail = check.prompt?.slice(0, 200)
    const state = tutorState({
      surface: 'reteach', lesson: pos, board: board && board.steps.length ? { doc: board, where: 'the lesson board, at the step playing' } : null, learner: facts ? { ...facts, level: learner ? levelLine(learner) || null : null } : null,
      event: signal.kind === 'answer' ? { kind: 'answer', text: `check "${(signal.detail ?? '').slice(0, 110)}", they answered "${(signal.answer ?? '').slice(0, 60)}"`, correct: signal.correct, expected: signal.expected ?? null } : null,
      message: signal.kind === 'message' || signal.kind === 'lost' ? signal.detail ?? null : null,
      featuresFrom: `${l.title}. ${signal.detail ?? ''}`,
    })

    const blocks: Block[] = []
    const ctx: AgentCtx = {
      mode: 'chat', studentId, admin, userDb: supabase, runId, lessonId, sessionId: null, hasBoard: !!board?.steps.length, board: board ?? undefined,
      visualTopic: `${l.title}. ${digest?.text.slice(0, 300) ?? ''}`, origin: new URL(request.url).origin, writes: 0, maxWrites: 1, restricted: false, practiceMode: false,
      emit: b => { const v = guardBlock(b, l.title); if (!v.block) return; const k = blocks.findIndex(x => x.id === v.block!.id); if (k >= 0) blocks[k] = v.block; else blocks.push(v.block); send({ t: 'block', block: v.block }) },
      blocks, trace: [], searchUrls: new Set(), computeCalls: 0, sources: [], guardIssues: [],
      limits: { animations: Number(process.env.AGENT_DAILY_ANIMATIONS ?? 3) || 3, miniLessons: 0, practiceSets: 2, webSearches: 0, pythonRuns: 5 },
    }
    let text = ''
    const gateT = textGate(d => { text += d; send({ t: 'text', d }) })
    let result: Awaited<ReturnType<typeof runLive>> | null = null
    let outcome = 'acted'
    try {
      result = await withLlmContext({ priority: 'live', learnerId: studentId, label: 'live' }, () => runLive({
        ctx, signal, recent, stage, memory, lastActs, state,
        lesson: `"${l.title}"${pos?.section ? `, section "${pos.section.title}"` : ''}${pos ? `, step ${pos.cursor + 1}/${pos.total}` : ''}${digest ? `. It teaches: ${digest.text.slice(0, 350)}` : ''}`,
        deadline: t0 + BUDGET_MS,
        onText: d => gateT.push(d),
        onTool: (name, label, state) => send({ t: 'tool', name, label, state }),
      }))
      gateT.end()
      const mv = result.move
      send({ t: 'decision', move: mv?.move ?? null, reason: mv?.reason ?? '', plan: result.plan ?? [] })
      if (mv?.move === 'wait' && !blocks.length) outcome = 'chose to wait'
      else if (!text.trim() && !blocks.length) outcome = 'no output'
    } catch (err) {
      gateT.end()
      const busy = err instanceof AllModelsBusyError
      outcome = busy ? 'busy fallback' : `error: ${err instanceof Error ? err.message.slice(0, 120) : err}`
      const line = busy ? busySignalLine(signal, check ? { explanation: check.explanation, hint: (check as { hint?: string }).hint } : null) : null
      if (line) { text += line; send({ t: 'text', d: line }) }
    }
    // Persistent memory: what the agent chose to remember about this learner.
    if (result?.remember) {
      const kind = /misconcept|thinks|confus|believes|mix(es)? up/i.test(result.remember) ? 'misconception' : 'teaching_note'
      await writeMemory(admin, studentId, [{ kind, title: `Live tutor: ${l.title}`.slice(0, 120), content: result.remember, lesson_id: lessonId, source_key: `${runId}` }]).catch(() => 0)
    }
    const ms = Date.now() - t0
    const toolsUsed = (result?.toolCalls ?? []).filter(n => n !== 'teaching_move')
    const decision = {
      signal: { kind: signal.kind, where: signal.where, line: signalLine(signal), step: signal.step }, urgent: gate.urgent,
      move: result?.move?.move ?? null, reason: result?.move?.reason ?? null, plan: result?.plan ?? [], remember: result?.remember ?? null,
      offered: result?.offered ?? [], tools: toolsUsed, blocks: blocks.map(b => `${b.kind}${b.kind === 'embed' ? `:${b.tool}` : ''}`),
      // Tool-bench calls: initiated by the agent unless the learner typed a request for that kind of work.
      bench: (ctx.benchCalls ?? []).map(b => ({ ...b, initiated: benchInitiated(signal) })),
      checks: result?.checks ?? [], revised: !!result?.revised, models: result?.models ?? [], text: text.slice(0, 600), outcome, ms,
      trace: ctx.trace.slice(-14).map(t => t.slice(0, 200)),
    }
    await admin.from('agent_actions').insert({ student_id: studentId, run_id: runId, source: 'agent', tool: 'live_decision', args: decision, summary: `${signal.kind} → ${decision.move ?? outcome}${toolsUsed.length ? ` (${toolsUsed.join(', ')})` : ''}`.slice(0, 200) })
    send({ t: 'done', woke: true, move: decision.move, outcome, ms, runId })
  }
  void work().catch(err => { console.error('live tutor:', err); send({ t: 'error', message: 'The tutor could not respond just now.' }) }).finally(close)
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } })
}

export async function GET(request: Request) {
  const { profile } = await getSessionProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  const admin = createAdminClient()
  const { data } = await admin.from('agent_actions').select('run_id, args, summary, created_at').eq('student_id', profile.id).eq('tool', 'live_decision').order('created_at', { ascending: false }).limit(Math.min(100, Number(url.searchParams.get('limit')) || 40))
  return Response.json({ on: liveAgentOn(), decisions: data ?? [] })
}

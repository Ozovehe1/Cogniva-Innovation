/**
 * Signals in. External evidence only (never the writers' self-critique alone):
 *   report     confirmed "Report a mistake" reports (admin triaged)                     → lesson / ask / diagram / illustration / manim
 *   guard      correctness-guard catches while writing (fixed or regenerated)            → lesson / ask
 *   clip       Manim scene verifier failures (render verdict ok === false)               → manim
 *   outcome    wrong check answers in a lesson                                           → lesson
 *   reexplain  "explain differently" / "again" / "explain my wrong answer" requests      → lesson
 *   confusion  low mood/confidence check-ins during a lesson                             → lesson
 *   success    lessons whose checks were strong (≥3 answered, ≥80 % right, no re-teach)  → lesson (strategies)
 * Each signal row carries an anonymised payload for the global reflector; learner-linked ones also write that learner's
 * own private teaching notes (learner-notes.ts). Hooks are fire-and-forget and never throw. Server only.
 */
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '../supabase/admin'
import { playbookCtx } from './context'
import { redact, redactTerms, scrubForReflection } from './privacy'
import { getState, setState } from './store'
import { writeTeachingNotes, type TeachingNote } from './learner-notes'
import type { SignalSource, Target } from './types'

export interface SignalRow {
  source: SignalSource
  target: Target
  external?: boolean
  subject?: string
  topic?: string
  skill?: string
  payload: Record<string, unknown>
  weight?: number
  student_id?: string | null
  lesson_id?: string | null
  session_id?: string | null
  dedupe_key: string
  scope?: 'global' | 'eval'
}

const h = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16)

/** Learner names / emails for a set of profiles: redacted out of signals, checked against every proposed bullet, never sent to a model. */
export async function learnerTerms(admin: SupabaseClient, studentIds: string[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(studentIds.filter(Boolean))].slice(0, 80)
  const out = new Map<string, string[]>()
  if (!ids.length) return out
  const { data } = await admin.from('profiles').select('id, full_name, email').in('id', ids)
  for (const p of (data ?? []) as { id: string; full_name?: string | null; email?: string | null }[]) {
    const t: string[] = []
    if (p.email) t.push(p.email, p.email.split('@')[0])
    if (p.full_name?.trim()) t.push(p.full_name.trim(), ...p.full_name.split(/\s+/).filter(x => x.length >= 3))
    out.set(p.id, t)
  }
  return out
}

export async function recordSignals(admin: SupabaseClient, rows: SignalRow[], extraTerms: string[] = []): Promise<number> {
  if (!rows.length) return 0
  const terms = await learnerTerms(admin, rows.map(r => r.student_id ?? '')).catch(() => new Map<string, string[]>())
  const clean = rows.map(r => ({
    source: r.source, target: r.target, external: r.external ?? true, subject: (r.subject ?? '').slice(0, 80), topic: String(redactTerms(redact(r.topic ?? ''), [...(terms.get(r.student_id ?? '') ?? []), ...extraTerms])).slice(0, 160), skill: (r.skill ?? '').slice(0, 120),
    payload: redactTerms(scrubForReflection(r.payload), [...(terms.get(r.student_id ?? '') ?? []), ...extraTerms]) as Record<string, unknown>, weight: r.weight ?? 1, student_id: r.student_id ?? null, lesson_id: r.lesson_id ?? null,
    session_id: r.session_id ?? null, dedupe_key: r.dedupe_key.slice(0, 200), scope: r.scope ?? 'global',
  }))
  const { data, error } = await admin.from('playbook_signals').upsert(clean, { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('id')
  if (error) { console.warn('playbook signals:', error.message); return 0 }
  return data?.length ?? 0
}

/** Hook (lesson writer): the guard caught faults in generated steps. Reads lesson/learner from the playbook context. */
export function noteGuardCatches(issues: { kind: string; detail: string; fixed: boolean }[], target: Target = 'lesson', extra: { topic?: string; lessonId?: string | null; sessionId?: string | null } = {}) {
  if (!issues.length) return
  const ctx = playbookCtx()
  if (ctx?.off || ctx?.override) return
  const lessonId = extra.lessonId ?? ctx?.lessonId ?? null
  const sessionId = extra.sessionId ?? ctx?.sessionId ?? null
  const kinds = [...new Set(issues.map(i => i.kind))].sort()
  const payload = { guard: issues.slice(0, 6).map(i => ({ kind: i.kind, fixed: i.fixed, detail: i.detail.slice(0, 160) })) }
  void (async () => {
    try {
      const admin = createAdminClient()
      let topic = extra.topic ?? ctx?.topic ?? '', subject = ctx?.subject ?? '', student = ctx?.studentId ?? null
      if (lessonId && (!topic || !student)) {
        const { data } = await admin.from('lessons').select('title, subject, owner_student_id').eq('id', lessonId).maybeSingle()
        const l = data as { title?: string; subject?: string; owner_student_id?: string | null } | null
        topic ||= l?.title ?? ''; subject ||= l?.subject ?? ''; student ??= l?.owner_student_id ?? null
      }
      await recordSignals(admin, [{
        source: 'guard', target, external: true, topic, subject, skill: kinds.join(', '), payload, weight: issues.some(i => !i.fixed) ? 1 : 0.6,
        student_id: student, lesson_id: lessonId, session_id: sessionId, dedupe_key: `guard:${lessonId ?? sessionId ?? 'x'}:${h(JSON.stringify(payload))}`,
      }])
    } catch { /* never block the writer */ }
  })()
}

/* ───────────── Harvester (background job) ───────────── */

const SURFACE_TARGET: Record<string, Target> = { lesson_step: 'lesson', stage: 'lesson', check: 'lesson', diagram: 'diagram', illustration: 'illustration', animation: 'manim', ask: 'ask', practice: 'ask', mastery: 'ask' }
const RETEACH = new Set(['differently', 'again', 'explain_wrong'])

interface Watermarks { reports: string; clips: string; progress: string; checkins: string }

type Ev = { at?: string; kind?: string; step?: number; type?: string; response?: string; correct?: boolean }

function checkPromptAt(script: unknown, i: number | undefined): string | null {
  if (!Array.isArray(script) || typeof i !== 'number') return null
  const s = script[i] as { type?: string; prompt?: string } | undefined
  return s?.type === 'check' && typeof s.prompt === 'string' ? redact(s.prompt).slice(0, 160) : null
}
function beatKinds(script: unknown): string[] {
  if (!Array.isArray(script)) return []
  const t = new Set<string>()
  for (const s of script as { type?: string; kind?: string; shape?: { kind?: string } }[]) {
    if (s?.type === 'draw' && s.shape?.kind) t.add(`draw:${s.shape.kind}`)
    else if (s?.type && !['write', 'pause', 'clear', 'check'].includes(s.type)) t.add(s.type)
  }
  return [...t].slice(0, 10)
}

/** Scan the app's own tables for new evidence since the last run. Bounded per call; returns counts. */
export async function harvest(admin: SupabaseClient, opts: { since?: string } = {}): Promise<Record<string, number>> {
  const start = opts.since ?? new Date(Date.now() - 7 * 86_400_000).toISOString()
  const wm = await getState<Watermarks>(admin, 'harvest', { reports: start, clips: start, progress: start, checkins: start })
  const next = { ...wm }
  const out: Record<string, number> = { report: 0, clip: 0, outcome: 0, success: 0, reexplain: 0, confusion: 0, notes: 0 }
  const lessonCache = new Map<string, { title: string; subject: string; script: unknown }>()
  const lessonOf = async (id: string | null) => {
    if (!id) return null
    if (lessonCache.has(id)) return lessonCache.get(id)!
    const { data } = await admin.from('lessons').select('title, subject, script').eq('id', id).maybeSingle()
    const v = data ? { title: (data as { title: string }).title ?? '', subject: (data as { subject: string }).subject ?? '', script: (data as { script: unknown }).script } : null
    if (v) lessonCache.set(id, v)
    return v
  }

  // 1. Confirmed mistake reports. The learner's note and question are NOT used (scrubbed); staff triage notes are.
  {
    const { data } = await admin.from('mistake_reports').select('id, student_id, surface, category, artefact, lesson_id, step_index, query, guard, triage_note, triaged_at').eq('status', 'confirmed').gt('triaged_at', wm.reports).order('triaged_at').limit(40)
    const rows: SignalRow[] = []
    for (const r of (data ?? []) as { id: string; student_id: string | null; surface: string; category: string | null; artefact: Record<string, unknown>; lesson_id: string | null; step_index: number | null; query: string | null; guard: { issues?: string[] } | null; triage_note: string | null; triaged_at: string }[]) {
      const l = await lessonOf(r.lesson_id)
      const { topicKey } = await import('../correctness/blocklist')
      const a = r.artefact as { step?: { type?: string; say?: string; text?: string; prompt?: string; shape?: { kind?: string; alt?: string } }; block?: { kind?: string; alt?: string; title?: string }; text?: string; prompt?: string; verdict?: unknown }
      rows.push({
        source: 'report', target: SURFACE_TARGET[r.surface] ?? 'lesson', external: true, weight: 2,
        topic: l?.title ?? topicKey(r.query ?? '') , subject: l?.subject ?? '',
        skill: r.category ?? '',
        payload: {
          surface: r.surface, category: r.category, staff_note: r.triage_note, guard_issues: r.guard?.issues?.slice(0, 4) ?? [],
          shown: a.step ? { type: a.step.type, shape: a.step.shape?.kind, alt: a.step.shape?.alt, tutor_said: a.step.say, board_text: a.step.text ?? a.step.prompt } : a.block ? { kind: a.block.kind, alt: a.block.alt, title: a.block.title } : { tutor_text: a.text?.slice(0, 240), clip_brief: a.prompt, verdict: a.verdict },
        },
        student_id: r.student_id, lesson_id: r.lesson_id, dedupe_key: `report:${r.id}`,
      })
      if (r.triaged_at > next.reports) next.reports = r.triaged_at
    }
    out.report = await recordSignals(admin, rows)
  }

  // 2. Manim verifier failures.
  {
    const { data } = await admin.from('manim_jobs').select('id, lesson_id, prompt, verdict, updated_at').not('verdict', 'is', null).gt('updated_at', wm.clips).order('updated_at').limit(40)
    const rows: SignalRow[] = []
    for (const j of (data ?? []) as { id: string; lesson_id: string | null; prompt: string | null; verdict: { ok?: boolean; failed?: unknown[] } | null; updated_at: string }[]) {
      if (j.updated_at > next.clips) next.clips = j.updated_at
      if (j.verdict?.ok !== false) continue
      const l = await lessonOf(j.lesson_id)
      rows.push({ source: 'clip', target: 'manim', topic: l?.title ?? (j.prompt ?? '').slice(0, 80), subject: l?.subject ?? '', payload: { failed: (j.verdict.failed ?? []).slice(0, 8), clip_brief: (j.prompt ?? '').slice(0, 300) }, lesson_id: j.lesson_id, dedupe_key: `clip:${j.id}` })
    }
    out.clip = await recordSignals(admin, rows)
  }

  // 3. Learner outcomes from lesson progress events (checks, re-teach requests) + successes.
  {
    const { data } = await admin.from('lesson_progress').select('student_id, lesson_id, events, updated_at, completed_at').gt('updated_at', wm.progress).order('updated_at').limit(40)
    const rows: SignalRow[] = []
    const notes = new Map<string, TeachingNote[]>()
    for (const p of (data ?? []) as { student_id: string; lesson_id: string; events: Ev[] | null; updated_at: string; completed_at: string | null }[]) {
      if (p.updated_at > next.progress) next.progress = p.updated_at
      const evs = (Array.isArray(p.events) ? p.events : []).filter(e => e?.type === 'check')
      if (!evs.length) continue
      const l = await lessonOf(p.lesson_id)
      if (!l) continue
      const answered = evs.filter(e => e.response === 'answer' && typeof e.correct === 'boolean')
      const firstTry = new Map<number, boolean>()
      for (const e of answered) if (typeof e.step === 'number' && !firstTry.has(e.step)) firstTry.set(e.step, !!e.correct)
      const wrongSteps = [...firstTry].filter(([, ok]) => !ok).map(([s]) => s)
      const reteach = evs.filter(e => RETEACH.has(e.response ?? ''))
      const prompts = [...new Set([...wrongSteps, ...reteach.map(e => e.step)].map(s => checkPromptAt(l.script, s)).filter(Boolean) as string[])].slice(0, 4)
      const total = firstTry.size, right = total - wrongSteps.length
      const base = { topic: l.title, subject: l.subject, student_id: p.student_id, lesson_id: p.lesson_id }
      const mine: TeachingNote[] = []
      if (wrongSteps.length >= 2 || (wrongSteps.length >= 1 && total <= 3)) {
        rows.push({ ...base, source: 'outcome', target: 'lesson', weight: Math.min(2, 0.5 + wrongSteps.length * 0.3), payload: { wrong_first_try: wrongSteps.length, answered: total, missed_checks: prompts }, dedupe_key: `outcome:${p.lesson_id}:${p.student_id}:${wrongSteps.length}` })
        mine.push({ title: `Struggled: ${l.title}`, content: `Missed ${wrongSteps.length} of ${total} checks first time${prompts[0] ? ` (e.g. "${prompts[0]}")` : ''}. Revisit this idea with a fresh worked example before building on it.`, lesson_id: p.lesson_id, source_key: `pb:outcome:${p.lesson_id}` })
      }
      if (reteach.length) {
        rows.push({ ...base, source: 'reexplain', target: 'lesson', weight: Math.min(2, 0.6 + reteach.length * 0.3), payload: { reteach_requests: reteach.length, kinds: [...new Set(reteach.map(e => e.response))], at_checks: prompts }, dedupe_key: `reexplain:${p.lesson_id}:${p.student_id}:${reteach.length}` })
        mine.push({ title: `Confused: ${l.title}`, content: `Asked for another explanation ${reteach.length} time${reteach.length > 1 ? 's' : ''}${prompts[0] ? ` around "${prompts[0]}"` : ''}. Show it a different way (picture or worked example) before the check.`, lesson_id: p.lesson_id, source_key: `pb:reexplain:${p.lesson_id}` })
      }
      if (total >= 3 && right / total >= 0.8 && !reteach.length) {
        rows.push({ ...base, source: 'success', target: 'lesson', weight: 1, payload: { right_first_try: right, answered: total, completed: !!p.completed_at, lesson_moves: beatKinds(l.script) }, dedupe_key: `success:${p.lesson_id}:${p.student_id}:${total}` })
        mine.push({ title: `Went well: ${l.title}`, content: `Got ${right} of ${total} checks right first time with this lesson's approach (${beatKinds(l.script).slice(0, 4).join(', ') || 'board explanation'}). Build on it; similar pacing suits them.`, lesson_id: p.lesson_id, source_key: `pb:success:${p.lesson_id}` })
      }
      if (mine.length) notes.set(p.student_id, [...(notes.get(p.student_id) ?? []), ...mine])
    }
    const n = await recordSignals(admin, rows)
    for (const r of rows) out[r.source] = (out[r.source] ?? 0) + 1
    out.outcomeRows = n
    for (const [sid, ns] of notes) out.notes += await writeTeachingNotes(admin, sid, ns).catch(() => 0)
  }

  // 4. Confusion: low mood / confidence check-ins during a lesson.
  {
    const { data } = await admin.from('learner_checkins').select('id, student_id, lesson_id, mood, confidence, created_at').not('lesson_id', 'is', null).gt('created_at', wm.checkins).order('created_at').limit(60)
    const rows: SignalRow[] = []
    for (const c of (data ?? []) as { id: string; student_id: string; lesson_id: string; mood: number | null; confidence: number | null; created_at: string }[]) {
      if (c.created_at > next.checkins) next.checkins = c.created_at
      const low = Math.min(c.mood ?? 5, c.confidence ?? 5)
      if (low > 2) continue
      const l = await lessonOf(c.lesson_id)
      if (!l) continue
      rows.push({ source: 'confusion', target: 'lesson', weight: 0.5, topic: l.title, subject: l.subject, payload: { low_confidence: true, scale_value: low }, student_id: c.student_id, lesson_id: c.lesson_id, dedupe_key: `confusion:${c.id}` })
      out.notes += await writeTeachingNotes(admin, c.student_id, [{ title: `Low confidence: ${l.title}`, content: 'Felt unsure during this lesson. Slow down, open with a quick win and a worked example, and keep checks low-stakes.', lesson_id: c.lesson_id, source_key: `pb:confusion:${c.lesson_id}` }]).catch(() => 0)
    }
    out.confusion = await recordSignals(admin, rows)
  }

  await setState(admin, 'harvest', next)
  return out
}

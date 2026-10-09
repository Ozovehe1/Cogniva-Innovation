/**
 * "Report a mistake": what a report holds, the guard's re-check of the reported artefact, anonymising a report into a
 * regression case, and feeding confirmed reports into the blocklist. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Step } from '../lesson-schema'
import { checkText } from './claims'
import { guardSteps } from './steps'
import { clipBlocked } from './clip'
import { clearBlocklistCache, topicKey } from './blocklist'
import type { RegressionCase } from './seeds'

export const SURFACES = ['lesson_step', 'stage', 'diagram', 'illustration', 'animation', 'ask', 'check', 'practice', 'mastery'] as const
export type Surface = (typeof SURFACES)[number]
export const CATEGORIES = ['wrong_maths', 'wrong_picture', 'confusing', 'typo', 'other'] as const
export type Category = (typeof CATEGORIES)[number]

export interface ReportRow {
  id: string; student_id: string | null; surface: Surface; category: Category | null; note: string | null
  artefact: Record<string, unknown>; artefact_key: string | null; lesson_id: string | null; step_index: number | null
  chat_session_id: string | null; block_id: string | null; illustration_id: string | null; clip_job_id: string | null
  query: string | null; model: string | null; trace: unknown; guard: unknown; status: 'open' | 'confirmed' | 'invalid'
  triage_note: string | null; triaged_at: string | null; regression_case_id: string | null; created_at: string
}

/**
 * Illustration id from a figure's bucket URL (…/illustrations/<src>/<sha1(v1:id:file)>.svg, see illustrations/prepare.ts):
 * the library is hashed once to map URLs back to ids.
 */
let byKey: Map<string, string> | null = null
export async function illustrationIdFromSrc(src: unknown): Promise<string | null> {
  if (typeof src !== 'string') return null
  const m = /\/((?:bio|servier|commons)\/[0-9a-f]{24})\.svg/.exec(src)
  if (!m) return null
  if (!byKey) {
    const { createHash } = await import('node:crypto')
    const lib = (await import('../illustrations/library.json')).default as unknown as { items: { id: string; src: string; file: string }[] }
    byKey = new Map(lib.items.map(i => [`${i.src}/${createHash('sha1').update(`v1:${i.id}:${i.file}`).digest('hex').slice(0, 24)}`, i.id]))
  }
  return byKey.get(m[1]) ?? null
}

/** The steps/text inside an artefact, whatever surface it came from. */
export function artefactParts(a: Record<string, unknown>): { steps: Step[]; text: string[] } {
  const steps: Step[] = []
  const text: string[] = []
  const block = a.block as Record<string, unknown> | undefined
  if (Array.isArray(a.steps)) steps.push(...(a.steps as Step[]))
  if (a.step && typeof a.step === 'object') steps.push(a.step as Step)
  if (block?.kind === 'board' && Array.isArray(block.steps)) steps.push(...(block.steps as Step[]))
  if (typeof a.text === 'string') text.push(a.text)
  if (typeof a.question === 'string') text.push(a.question)
  if (block?.kind === 'practice' && Array.isArray(block.items)) for (const it of block.items as { q?: string }[]) if (it.q) text.push(it.q)
  return { steps, text }
}

/** Deterministic re-check of a reported artefact (what the guard says now). */
export function recheck(a: Record<string, unknown>, problem = ''): { flagged: boolean; issues: string[] } {
  const { steps, text } = artefactParts(a)
  const issues: string[] = []
  if (steps.length) for (const i of guardSteps(steps, { problem }).issues) issues.push(`${i.kind}${i.fixed ? ' (fixable)' : ''}: ${i.detail}`)
  for (const t of text) for (const w of checkText(t).wrong) issues.push(`maths: ${w.source}${Number.isFinite(w.computed) ? ` (is ${w.computed})` : ''}`)
  const block = a.block as Record<string, unknown> | undefined
  if (clipBlocked(a.verdict) || clipBlocked(block?.verdict)) issues.push('animation: the scene verifier failed it')
  return { flagged: issues.length > 0, issues: issues.slice(0, 12) }
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
/** Deep copy with learner identity removed: ids, their name, storage paths and the learner's own words. */
export function anonymise<T>(value: T, names: string[]): T {
  const nameRe = names.filter(n => n && n.length >= 3).map(n => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'))
  const DROP = new Set(['student_id', 'studentId', 'owner_student_id', 'requested_by', 'session_id', 'sessionId', 'lessonId', 'lesson_id', 'note', 'email', 'full_name', 'user_id', 'video_path', 'url'])
  const walk = (v: unknown, key = ''): unknown => {
    if (typeof v === 'string') {
      let s = v.replace(UUID, '<id>')
      for (const r of nameRe) s = s.replace(r, 'Learner')
      return key === 'src' && /^https?:/.test(s) ? s.replace(/\?.*$/, '') : s
    }
    if (Array.isArray(v)) return v.map(x => walk(x))
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !DROP.has(k)).map(([k, x]) => [k, walk(x, k)]))
    return v
  }
  return walk(value) as T
}

/** A regression case from a confirmed report (anonymised; the assertion follows the artefact). */
export function caseFromReport(r: ReportRow, names: string[]): Omit<RegressionCase, 'id'> {
  const title = `${r.surface.replace('_', ' ')}: ${r.category?.replace('_', ' ') ?? 'mistake'} (report ${r.id.slice(0, 8)})`
  if (r.illustration_id && (r.query || r.artefact.query)) {
    return { kind: 'illustration', title, source: 'report', input: { query: String(r.query ?? r.artefact.query).slice(0, 160) }, expect: { notIds: [r.illustration_id] } }
  }
  const art = anonymise(r.artefact, names)
  return { kind: 'artefact' as RegressionCase['kind'], title, source: 'report', input: { artefact: art, problem: typeof art.problem === 'string' ? art.problem : '', category: r.category }, expect: { guardFlags: true } }
}

/** Confirmed: feed the blocklist (a wrong picture is never picked again for that topic; a failed clip spec is avoided). */
export async function feedBlocklist(admin: SupabaseClient, r: ReportRow, avoid?: string | null) {
  const rows: { kind: string; value: string; topic: string; reason: string; report_id: string }[] = []
  if (r.illustration_id) rows.push({ kind: 'illustration', value: r.illustration_id, topic: topicKey(String(r.query ?? r.artefact.query ?? '')), reason: r.category ?? 'reported', report_id: r.id })
  if (r.surface === 'animation' && typeof r.artefact.prompt === 'string') rows.push({ kind: 'clip_spec', value: String(r.artefact.prompt).slice(0, 300), topic: '', reason: r.category ?? 'reported', report_id: r.id })
  if (avoid && avoid.trim()) rows.push({ kind: 'prompt_pattern', value: avoid.trim().slice(0, 300), topic: '', reason: r.category ?? 'reported', report_id: r.id })
  if (rows.length) await admin.from('correctness_blocklist').upsert(rows, { onConflict: 'kind,value,topic', ignoreDuplicates: true })
  clearBlocklistCache()
  return rows.length
}

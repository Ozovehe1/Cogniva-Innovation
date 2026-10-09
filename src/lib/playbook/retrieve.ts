/**
 * Retrieval: the top-k live bullets for a target and topic (embedding similarity + topic/skill match + counters), plus
 * that learner's private teaching notes, rendered as a short prompt block. One-line hooks call these from the lesson
 * writer (generateSteps), the Ask tutor (chat route: ask + diagram targets), illustration ranking (find.ts) and the
 * Manim planner (dispatchCompose context → gm_compose PLAN_PROMPT). Never throws; a slow embedding falls back to topic
 * words so the opening beat is never held up. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '../supabase/admin'
import { sameTopic, topicKey } from '../correctness/blocklist'
import { playbookCtx, type PlaybookCtx } from './context'
import { learnerNotes } from './learner-notes'
import { bulletEmbedText, cosine, embedOne, loadBullets } from './store'
import type { Bullet, Target } from './types'

export interface Scored { b: Bullet; score: number; sim: number; topical: boolean }

/** Similarity above which a bullet applies even without a topic-word match (gte-small cosines run high). */
export const SIM_ANY = 0.86
/** Similarity a topic-matched or general bullet needs. */
export const SIM_TOPIC = 0.74

export function scoreBullet(b: Bullet, q: { key: string; skill?: string }, qv: number[] | null): Scored {
  const sim = qv && b.embedding ? cosine(qv, b.embedding) : 0
  const bKey = b.topic_key || topicKey(`${b.topic} ${b.skill}`)
  const topical = !!(q.key && bKey && (sameTopic(bKey, q.key) || sameTopic(q.key, bKey)))
  const general = !b.topic.trim()
  const skill = !!(q.skill && b.skill && sameTopic(topicKey(b.skill), topicKey(q.skill)))
  const counters = Math.log1p(Math.max(0, b.helpful)) * 0.03 - Math.min(5, b.harmful) * 0.04 + Math.min(4, b.evidence - 1) * 0.01
  const score = sim + (topical ? 0.2 : 0) + (skill ? 0.08 : 0) + (general ? 0.03 : 0) + counters
  return { b, score, sim, topical }
}

/** Is a scored bullet relevant enough to inject? */
export function relevant(s: Scored, semantic: boolean): boolean {
  if (!semantic) return s.topical || !s.b.topic.trim()
  if (s.topical) return s.sim >= SIM_TOPIC - 0.06
  if (!s.b.topic.trim()) return s.sim >= SIM_TOPIC
  return s.sim >= SIM_ANY
}

export async function retrieve(admin: SupabaseClient, target: Target, q: { topic: string; subject?: string; skill?: string }, opts: { k?: number; scope?: 'global' | 'eval'; statuses?: Bullet['status'][]; queryVec?: number[] | null; extra?: Bullet[] } = {}): Promise<Scored[]> {
  const pool = [...await loadBullets(admin, target, { statuses: opts.statuses ?? ['live'], scope: opts.scope ?? 'global', fresh: opts.scope === 'eval' }), ...(opts.extra ?? [])]
  if (!pool.length) return []
  const text = [q.subject, q.topic, q.skill].filter(Boolean).join(' · ')
  const qv = opts.queryVec !== undefined ? opts.queryVec : await embedOne(text, 1800)
  const key = topicKey(`${q.topic} ${q.skill ?? ''}`)
  return pool.map(b => scoreBullet(b, { key, skill: q.skill }, qv)).filter(s => relevant(s, !!qv)).sort((a, b) => b.score - a.score).slice(0, opts.k ?? 5)
}

/* ───────────── Prompt hooks ───────────── */

const lessonMeta = new Map<string, { at: number; title: string; subject: string; owner: string | null }>()
async function lessonInfo(admin: SupabaseClient, id: string) {
  const hit = lessonMeta.get(id)
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit
  const { data } = await admin.from('lessons').select('title, subject, owner_student_id').eq('id', id).maybeSingle()
  const row = data as { title?: string; subject?: string; owner_student_id?: string | null } | null
  const v = { at: Date.now(), title: row?.title ?? '', subject: row?.subject ?? '', owner: row?.owner_student_id ?? null }
  lessonMeta.set(id, v)
  return v
}

/** The lesson title from a writer prompt ("Lesson: <title> (<subject>)"), when no context names it. */
export function topicFromPrompt(prompt: string): { topic: string; subject: string } {
  const m = /Lesson(?: title)?:\s*([^\n(]{3,120})(?:\(([^)\n]{2,60})\))?/i.exec(prompt) ?? /Lesson\s+"([^"\n]{3,120})"\s*(?:\(([^)\n]{2,60})\))?/i.exec(prompt) ?? /(?:teach(?:ing)?|about|on)\s+"([^"\n]{3,120})"/i.exec(prompt)
  return { topic: (m?.[1] ?? prompt.replace(/\s+/g, ' ').slice(0, 120)).trim(), subject: (m?.[2] ?? '').trim() }
}

const notesSeen = new Map<string, { at: number; has: boolean }>()
async function hasNotes(admin: SupabaseClient, student: string): Promise<boolean> {
  const hit = notesSeen.get(student)
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.has
  const { data } = await admin.from('learner_memory').select('id').eq('student_id', student).eq('kind', 'teaching_note').limit(1)
  const has = !!data?.length
  notesSeen.set(student, { at: Date.now(), has })
  if (notesSeen.size > 2000) notesSeen.delete(notesSeen.keys().next().value as string)
  return has
}

const blockCache = new Map<string, { at: number; block: string }>()
const BLOCK_TTL = 10 * 60_000

async function record(admin: SupabaseClient, used: { id: string; target: Target }[], ctx: PlaybookCtx | undefined) {
  if (!used.length || (!ctx?.lessonId && !ctx?.sessionId)) return
  const rows = [...new Map(used.map(u => [u.id, u])).values()].map(u => ({ bullet_id: u.id, target: u.target, lesson_id: ctx.lessonId ?? null, session_id: ctx.lessonId ? null : ctx.sessionId ?? null }))
  try { await admin.from('playbook_usage').upsert(rows, { onConflict: ctx.lessonId ? 'bullet_id,lesson_id' : 'bullet_id,session_id', ignoreDuplicates: true }) } catch { /* best effort */ }
}

export function renderBlock(rules: string[], notes: string[], target: Target): string {
  const head = target === 'manim' ? 'Teaching playbook for this animation (rules learned from past mistakes and successes):' : 'Teaching playbook (rules learned from past lessons; follow them unless they conflict with the task):'
  return [
    rules.length ? `${head}\n${rules.map(r => `- ${r}`).join('\n')}` : '',
    notes.length ? `About THIS learner (private notes from their own past lessons; use them to choose examples and pace):\n${notes.map(n => `- ${n}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

/**
 * The prompt block for one target: global bullets for the topic, plus this learner's notes when the context names the
 * learner (or the lesson's owner). `fallbackText` (the writer's prompt / the learner's message) gives the topic when the
 * context does not. Cached per target + lesson/session for ten minutes, so a lesson's beats share one lookup.
 */
export async function playbookBlock(target: Target | Target[], fallbackText = '', extra: PlaybookCtx = {}): Promise<string> {
  const ctx = { ...(playbookCtx() ?? {}), ...extra }
  const targets = Array.isArray(target) ? target : [target]
  if (ctx.off) return ''
  if (ctx.override) return renderBlock(ctx.override, [], targets[0])
  try {
    const admin = createAdminClient()
    let topic = ctx.topic ?? '', subject = ctx.subject ?? '', student = ctx.studentId ?? null
    if (ctx.lessonId && (!topic || !student)) {
      const l = await lessonInfo(admin, ctx.lessonId)
      topic ||= l.title; subject ||= l.subject; student ??= l.owner
    }
    if (!topic) ({ topic, subject } = topicFromPrompt(fallbackText))
    if (!topic.trim()) return ''
    const ck = `${targets.join('+')}|${ctx.lessonId ?? ctx.sessionId ?? ''}|${student ?? ''}|${topicKey(topic)}`
    const hit = blockCache.get(ck)
    if (hit && Date.now() - hit.at < BLOCK_TTL) return hit.block
    // Nothing to retrieve (no live bullets, no learner): skip the embedding so the opening beat is never delayed.
    const pools = await Promise.all(targets.map(t => loadBullets(admin, t)))
    if (pools.every(p => !p.length) && !(student && await hasNotes(admin, student))) return ''
    const qv = await embedOne([subject, topic].filter(Boolean).join(' · '), 1500)
    const scored = (await Promise.all(targets.map(t => retrieve(admin, t, { topic, subject }, { queryVec: qv, k: targets.length > 1 ? 3 : 5 })))).flat()
    const notes = student ? await learnerNotes(admin, student, topic, 3, qv).catch(() => []) : []
    const block = renderBlock(scored.map(s => s.b.text), notes, targets[0])
    blockCache.set(ck, { at: Date.now(), block })
    if (blockCache.size > 500) blockCache.delete(blockCache.keys().next().value as string)
    void record(admin, scored.map(s => ({ id: s.b.id, target: s.b.target })), ctx)
    return block
  } catch {
    return ''
  }
}

/** Illustration ranking hints from live 'illustration' bullets for the topic: words to prefer / avoid in titles. */
export async function illustrationHints(topic: string, admin?: SupabaseClient | null): Promise<{ prefer: string[]; avoid: string[] }> {
  const ctx = playbookCtx()
  if (ctx?.off) return { prefer: [], avoid: [] }
  try {
    const db = admin ?? createAdminClient()
    const all = await loadBullets(db, 'illustration')
    if (!all.length) return { prefer: [], avoid: [] }
    const key = topicKey(topic)
    const hits = all.filter(b => !b.topic || sameTopic(b.topic_key || topicKey(b.topic), key) || sameTopic(key, b.topic_key || topicKey(b.topic)))
    return {
      prefer: [...new Set(hits.flatMap(b => b.hints?.prefer ?? []).map(w => w.toLowerCase()))].slice(0, 12),
      avoid: [...new Set(hits.flatMap(b => b.hints?.avoid ?? []).map(w => w.toLowerCase()))].slice(0, 12),
    }
  } catch { return { prefer: [], avoid: [] } }
}

/** Re-rank library hits with the hints (a nudge; the vision check still has the last word). */
export function applyIllustrationHints<T extends { item: { t: string; d?: string; k?: string }; score: number }>(hits: T[], h: { prefer: string[]; avoid: string[] }): T[] {
  if (!h.prefer.length && !h.avoid.length) return hits
  const words = (x: T) => `${x.item.t} ${x.item.d ?? ''} ${x.item.k ?? ''}`.toLowerCase()
  const adj = (x: T) => x.score + h.prefer.filter(w => words(x).includes(w)).length * 1.5 - h.avoid.filter(w => words(x).includes(w)).length * 3
  return [...hits].sort((a, b) => adj(b) - adj(a))
}

/** Manim planner: the composer's context string with the playbook block appended (gm_compose reads context[:1500]). */
export async function manimContext(context: string, prompt: string): Promise<string> {
  const block = await playbookBlock('manim', `${context}\n${prompt}`.slice(0, 600), { topic: topicFromPrompt(`${context} ${prompt}`).topic })
  return block ? `${context}\n${block}`.slice(0, 2900) : context
}

/** For gates/evals: the text a bullet set renders to. */
export function bulletLines(bs: Pick<Bullet, 'text'>[]): string[] { return bs.map(b => b.text) }
export { bulletEmbedText }

/**
 * Learner profile, AI prompts for the intake and diagnostic, and the learning
 * path: scope from purpose, difficulty and scaffolding from the diagnostic plus
 * self-efficacy, pace from deadline and weekly hours, examples from interests
 * and purpose. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateStructuredJson } from './gemini'
import { inferStatus, levelLine, type Answers } from './intake'
import { inferSignals, type DiagSignals } from './onboarding-signals'
import { cleanGraph, descendants, ancestors, topoOrder, type DiagGraph, type DiagState, type DiagItem } from './diagnostic-core'
import type { StudentProfileLite } from './lesson-ai'
import { QUESTION_RULES } from './question-quality'
import { ITEM_JSON, ITEM_RULES, type AssessItem } from './assessment/spec'
import { curriculumLines, inferCurriculum } from './assessment/curriculum'
import { objectivesFromDigest, taughtFromText } from './assessment/align'
import { feedbackLines, finishSet, gateItems, parseItems, type Rejected } from './assessment/write'

export interface LearnerRow {
  student_id: string
  answers: Answers
  current_item: string | null
  learner_status: string | null
  age_band: string | null
  level: string | null
  school_system: string | null
  last_studied: string | null
  goal_text: string | null
  goal: string | null
  subject: string | null
  why_text: string | null
  value_type: string | null
  purpose: string | null
  deadline: string | null
  weekly_hours: number | null
  efficacy: number | null
  goal_orientation: string | null
  anxiety: Record<string, number> | null
  example_pref: string | null
  interests: string[]
  barriers: string | null
  guardian_email: string | null
  guardian_consent_at: string | null
  completed_at: string | null
}

export interface PathRow {
  id: string
  student_id: string
  goal: string
  subject: string
  status: 'diagnosing' | 'ready' | 'archived'
  graph: DiagGraph
  /** fresh: the learner said they are completely new to the topic, so the check was skipped (see priorKnowledge). */
  diagnostic: { state?: DiagState; extra?: Record<string, DiagItem[]>; fresh?: boolean; freshReason?: string | null; skipped?: boolean; signals?: DiagSignals }
  known: string[]
  ready: string[]
  plan: PathPlan
  /** The intake answers this path was planned from (a later intake for another goal never changes them). */
  learner_snapshot?: Partial<LearnerRow> | null
  created_at?: string
}

export interface TopicRow {
  id: string
  path_id: string
  student_id: string
  node_id: string
  position: number
  title: string
  summary: string
  status: 'locked' | 'ready' | 'learning' | 'mastered' | 'review'
  lesson_id: string | null
  target_minutes: number | null
  due_on: string | null
  /** itemsVersion/basis describe `items`: version 2+ items were written from the learner's lessons ('lesson') or, with no lesson content, the topic title ('title'). */
  mastery: { items?: DiagItem[]; itemsVersion?: number; basis?: 'lesson' | 'title'; lessonIds?: string[]; startedAt?: string; lastScore?: number; recheck?: { node: string; item: number }[]; /** Learner's Elo skill rating on this topic (assessment/calibrate.ts). */ elo?: { r: number; n: number } }
  mastery_attempts: number
  wrong_streak: number
  mastered_at: string | null
}

export interface PathPlan {
  scope: 'full' | 'path' | 'short'
  lessonMinutes: number
  sessionsPerWeek: number
  pace: 'steady' | 'brisk' | 'relaxed'
  weeksLeft: number | null
  note: string
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && !isNaN(Number(v)) ? Number(v) : null)

/** Map intake answers onto learner_profiles columns. Skipped / not-sure answers become null. */
export function answersToColumns(a: Answers): Partial<LearnerRow> {
  const val = (id: string) => (a[id] && !a[id].skipped && !a[id].notSure ? a[id].v : undefined)
  const str = (id: string, n = 300) => { const v = val(id); return typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null }
  const out: Partial<LearnerRow> = {}
  if ('status' in a) out.learner_status = str('status')
  else if ('level' in a || 'age' in a) out.learner_status = inferStatus(a)
  if ('age' in a) out.age_band = str('age')
  if ('level' in a) out.level = str('level')
  if ('system' in a) out.school_system = str('system')
  if ('last_studied' in a) out.last_studied = str('last_studied')
  if ('goal' in a) out.goal_text = str('goal', 600)
  if ('goal_pick' in a) {
    const g = val('goal_pick') as { goal?: string; subject?: string } | undefined
    out.goal = (g?.goal && String(g.goal).slice(0, 300)) || out.goal_text || null
    out.subject = g?.subject ? String(g.subject).slice(0, 80) : null
  }
  if ('why' in a) out.why_text = str('why', 600)
  if ('purpose' in a) out.purpose = str('purpose')
  if ('deadline' in a) { const d = str('deadline'); out.deadline = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null }
  if ('hours' in a) out.weekly_hours = num(val('hours'))
  if ('efficacy' in a) { const e = num(val('efficacy')); out.efficacy = e && e >= 1 && e <= 5 ? Math.round(e) : null }
  if ('orientation' in a) out.goal_orientation = str('orientation')
  if ('anxiety' in a) {
    const raw = val('anxiety')
    // v2: one single-item rating (SIMA-style, 1-5); v1: three situation ratings.
    const v = (typeof raw === 'number' ? { sima: raw } : raw) as Record<string, unknown> | undefined
    out.anxiety = v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, num(x)]).filter(([, x]) => x !== null && (x as number) >= 1 && (x as number) <= 5)) as Record<string, number> : null
  }
  if ('example_pref' in a) out.example_pref = str('example_pref')
  if ('interests' in a) {
    const v = val('interests')
    out.interests = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(x => x.slice(0, 60)).slice(0, 8) : []
  } else if ('goal_pick' in a) {
    // Not asked yet: contexts the learner named in their own goal (e.g. "for my solar project") stand in.
    const c = (val('goal_pick') as { contexts?: unknown } | undefined)?.contexts
    if (Array.isArray(c)) out.interests = c.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim().slice(0, 60)).slice(0, 2)
  }
  if ('barriers' in a) out.barriers = str('barriers', 600)
  return out
}

export async function loadLearner(db: SupabaseClient, studentId: string): Promise<LearnerRow | null> {
  const { data } = await db.from('learner_profiles').select('*').eq('student_id', studentId).maybeSingle()
  return (data as LearnerRow | null) ?? null
}

/** Intake fields that belong to one goal: saved on its path so a new intake never changes an existing path. */
export const PATH_SNAPSHOT_KEYS = ['goal_text', 'goal', 'subject', 'why_text', 'value_type', 'purpose', 'deadline', 'weekly_hours', 'efficacy', 'goal_orientation', 'anxiety', 'example_pref', 'interests', 'barriers', 'last_studied'] as const

export function learnerSnapshot(l: LearnerRow): Partial<LearnerRow> {
  const out: Record<string, unknown> = {}
  for (const k of PATH_SNAPSHOT_KEYS) out[k] = l[k] ?? null
  return out as Partial<LearnerRow>
}

/** The learner as they were when this path was planned (current profile for anything not snapshotted). */
export function learnerForPath(l: LearnerRow, path: Pick<PathRow, 'learner_snapshot'> | null | undefined): LearnerRow {
  const snap = path?.learner_snapshot
  if (!snap || typeof snap !== 'object') return l
  const out = { ...l } as Record<string, unknown>
  for (const k of PATH_SNAPSHOT_KEYS) if (k in snap) out[k] = (snap as Record<string, unknown>)[k]
  return out as unknown as LearnerRow
}

/** Every path the learner has (newest first), archived ones excluded. */
export async function listPaths(db: SupabaseClient, studentId: string): Promise<PathRow[]> {
  const { data } = await db.from('learning_paths').select('*').eq('student_id', studentId).neq('status', 'archived').order('created_at', { ascending: false })
  return (data ?? []) as PathRow[]
}

/** The path a diagnostic action works on: the newest unfinished check, otherwise the newest path. */
export async function diagnosticPath(db: SupabaseClient, studentId: string, pathId?: string | null): Promise<PathRow | null> {
  if (pathId) {
    const { data } = await db.from('learning_paths').select('*').eq('student_id', studentId).eq('id', pathId).neq('status', 'archived').maybeSingle()
    if (data) return data as PathRow
  }
  const { data } = await db.from('learning_paths').select('*').eq('student_id', studentId).eq('status', 'diagnosing').order('created_at', { ascending: false }).limit(1).maybeSingle()
  return (data as PathRow | null) ?? await latestPath(db, studentId)
}

export const sameGoal = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase().replace(/[.!\s]+$/, '') === b.trim().toLowerCase().replace(/[.!\s]+$/, '')

export async function latestPath(db: SupabaseClient, studentId: string): Promise<PathRow | null> {
  const { data } = await db.from('learning_paths').select('*').eq('student_id', studentId).neq('status', 'archived').order('created_at', { ascending: false }).limit(1).maybeSingle()
  return (data as PathRow | null) ?? null
}

export function anxietyScore(l: Pick<LearnerRow, 'anxiety'> | null): number | null {
  const v = Object.values(l?.anxiety ?? {}).filter(x => typeof x === 'number')
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/** What the live tutor knows about this learner (for re-teaches and worked examples). */
export function learnerLite(l: LearnerRow | null, mood?: number | null): StudentProfileLite | null {
  if (!l) return null
  return {
    level: levelLine(l) || null,
    goal: l.goal ?? l.goal_text,
    purpose: l.purpose,
    efficacy: l.efficacy,
    goalOrientation: l.goal_orientation,
    anxiety: anxietyScore(l),
    examplePref: l.example_pref,
    interests: l.interests,
    mood: mood ?? null,
  }
}

/* ───────────── Intake AI: narrow the goal, reflect the why ───────────── */

export async function suggestGoals(input: { goal: string; level: string }): Promise<{ goals: { goal: string; subject: string; stem: boolean }[]; reflection: string; prior: 'none' | 'some' | 'unclear'; contexts: string[]; purpose: string | null }> {
  const prompt = `A learner (${input.level || 'level unknown'}) told an AI tutor what they want to learn, in their own words:
"""${input.goal.slice(0, 600)}"""
Suggest 3 or 4 specific, achievable learning goals that are closest to what they meant, from narrow to broader. Each goal is one plain sentence starting with a verb ("Solve…", "Size…", "Explain…"), under 90 characters, at a level that suits them. Use neutral wording: do not assume an exam unless they said so.
Also give "reflection": one warm sentence (under 25 words) reflecting back what they want, without praise or emoji.
Also give "prior": what their words say about how much they already know of this topic: "none" ONLY when they clearly say they know nothing about it yet (e.g. "I have no idea about…", "never studied it", "complete beginner", "from scratch"); "some" when they say they know some of it or are studying it; otherwise "unclear".
Also "contexts": 0 to 2 short real-life settings the learner THEMSELVES mentioned that examples could be set in (e.g. "solar installations", "football", "their family shop"); [] when they mention none. Never invent one.
Also "purpose": what it seems to be for, only when their words make it clear: "exam" (a test, class or course), "project" (building or making something), "career" (a job), "helping" (teaching someone else) or "curiosity"; otherwise null.
Return JSON: {"reflection": string, "prior": string, "contexts": [string], "purpose": string|null, "goals": [{"goal": string, "subject": string (the school or field subject in 1-3 words, e.g. "Mathematics", "Solar PV", "Chemistry"), "stem": boolean (true for maths, physics, chemistry, engineering, computing, statistics)}]}`
  const raw = await generateStructuredJson(prompt, { timeoutMs: 25_000, primaryTimeoutMs: 15_000, thinking: 'minimal', priority: 'live' as const }) as Record<string, unknown>
  const goals = (Array.isArray(raw?.goals) ? raw.goals : []).flatMap(g => {
    if (!g || typeof g !== 'object') return []
    const o = g as Record<string, unknown>
    return typeof o.goal === 'string' && o.goal.trim() ? [{ goal: o.goal.trim().replace(/\.$/, '').slice(0, 140), subject: typeof o.subject === 'string' ? o.subject.trim().slice(0, 60) : '', stem: o.stem === true }] : []
  }).slice(0, 4)
  const prior = raw?.prior === 'none' || raw?.prior === 'some' ? raw.prior : 'unclear'
  const contexts = (Array.isArray(raw?.contexts) ? raw.contexts : []).filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim().slice(0, 60)).slice(0, 2)
  const purpose = typeof raw?.purpose === 'string' && ['exam', 'project', 'career', 'helping', 'curiosity'].includes(raw.purpose) ? raw.purpose : null
  return { goals, reflection: typeof raw?.reflection === 'string' ? raw.reflection.slice(0, 220) : '', prior, contexts, purpose }
}

export async function reflectWhy(input: { why: string; goal: string }): Promise<{ reflection: string; valueType: string }> {
  const prompt = `A learner wants to: ${input.goal.slice(0, 200)}.
Asked "Why does this matter to you?", they said:
"""${input.why.slice(0, 600)}"""
Reply as a warm, brief tutor using motivational-interviewing reflection: one sentence (under 28 words) that reflects their reason back in plain words, e.g. "So you need this for your solar project by December, and you want to really get it." No praise, no emoji, no advice.
Also classify the main value: "intrinsic" (interest, enjoyment), "attainment" (identity, doing well), "utility" (useful for a goal, job, exam, project) or "mixed".
Return JSON {"reflection": string, "valueType": string}.`
  const raw = await generateStructuredJson(prompt, { timeoutMs: 20_000, primaryTimeoutMs: 12_000, thinking: 'minimal', priority: 'live' as const }) as Record<string, unknown>
  const vt = typeof raw?.valueType === 'string' && ['intrinsic', 'attainment', 'utility', 'mixed'].includes(raw.valueType) ? raw.valueType : 'mixed'
  return { reflection: typeof raw?.reflection === 'string' ? raw.reflection.slice(0, 240) : '', valueType: vt }
}

/* ───────────── Diagnostic: prerequisite graph + item bank ───────────── */

export async function buildGraph(l: LearnerRow): Promise<DiagGraph> {
  const goal = l.goal ?? l.goal_text ?? 'the topic'
  const prompt = `You are designing an adaptive prerequisite diagnostic (knowledge-space style, like ALEKS).
Learner: ${levelLine(l) || 'level unknown'}. Last studied this: ${l.last_studied ?? 'unknown'}.
Goal: ${goal}${l.subject ? ` (subject: ${l.subject})` : ''}. Purpose: ${l.purpose ?? 'unknown'}.

Build a small prerequisite graph of 8 to 10 skills that leads to the goal, starting from just BELOW the learner's stated level (2 or 3 foundation skills they should already have), through skills at their level, up to the goal skill itself. Each skill is one teachable idea (one lesson), e.g. "Factorise simple quadratics", "Convert watt-hours to amp-hours".
For each skill give:
- "id": short kebab-case id
- "title": under 60 characters, plain
- "summary": one sentence: what someone who has this skill can do
- "prereqs": ids of skills it directly needs (only skills in this list; foundations have [])
- "level": "below", "at" or "above" relative to the learner's stated level (the goal and skills beyond their level are "above")
- "items": exactly 2 multiple-choice questions that test THIS skill only (not its prerequisites), each ${ITEM_JSON} ("objective" here: the skill's summary). Questions are short, unambiguous, answerable in under a minute without a calculator unless trivial, at the skill's own level, in the notation of the learner's curriculum. 4 options. No trick questions.
${ITEM_RULES}
${QUESTION_RULES}
${curriculumLines(inferCurriculum({ goal: [l.goal, l.goal_text, l.subject].filter(Boolean).join(' '), profile: l }))}
Also "goalNode": the id of the goal skill, "subject": the subject in 1-3 words, "stem": true for maths/science/engineering/computing.
Neutral, global wording. Return JSON {"subject", "stem", "goalNode", "nodes": [...]} only.`
  const raw = await generateStructuredJson(prompt, { timeoutMs: 110_000, primaryTimeoutMs: 80_000, temperature: 0.4, priority: 'live' as const })
  await gateGraphItems(raw, l)
  return cleanGraph(raw, l.subject ?? '')
}

/**
 * The skill map for a learner who is completely new to the topic (no check, so no question bank):
 * from the very first idea of the topic, assuming only what their education level gives them, up
 * to the goal. One small call on the fast models, so the path (and the first lesson's draft) starts
 * within seconds of the intake.
 */
export async function buildFoundationGraph(l: LearnerRow): Promise<DiagGraph> {
  const goal = l.goal ?? l.goal_text ?? 'the topic'
  const prompt = `A learner is COMPLETELY NEW to this topic: they have never studied it and know nothing about it yet.
Learner: ${levelLine(l) || 'level unknown'}.
Goal: ${goal}${l.subject ? ` (subject: ${l.subject})` : ''}. Purpose: ${l.purpose ?? 'unknown'}.

Plan a learning path of 6 to 9 skills that takes them from the very first idea of this topic up to the goal. Assume only the general knowledge typical of their education level (everyday arithmetic and reading for their age), and no prior study of this topic: the first 1 or 2 skills introduce what the topic is about and its most basic ideas and words. Each skill is one teachable idea (one lesson), pitched at their level, e.g. "What voltage and current are", "Factorise simple quadratics".
For each skill give:
- "id": short kebab-case id
- "title": under 60 characters, plain
- "summary": one sentence: what someone who has this skill can do
- "prereqs": ids of skills it directly needs (only skills in this list; the first skills have [])
- "level": "below", "at" or "above" relative to the learner's stated level
Also "goalNode": the id of the goal skill (the last one), "subject": the subject in 1-3 words, "stem": true for maths/science/engineering/computing.
Neutral, global wording. Return JSON {"subject", "stem", "goalNode", "nodes": [...]} only.`
  const raw = await generateStructuredJson(prompt, { timeoutMs: 45_000, primaryTimeoutMs: 25_000, temperature: 0.4, thinking: 'minimal', preferFast: true, priority: 'live' as const })
  return cleanGraph(raw, l.subject ?? '', { noItems: true })
}

/**
 * Quality gate on the diagnostic's items, in place on the raw AI graph: maths
 * normalised and validated, options distinct, numeric answers verified. Failing
 * items are re-asked once (one call for all of them); items still failing are
 * dropped unless that would leave a skill with no question.
 */
async function gateGraphItems(raw: unknown, l: LearnerRow) {
  const nodes = (raw && typeof raw === 'object' && Array.isArray((raw as { nodes?: unknown }).nodes) ? (raw as { nodes: Record<string, unknown>[] }).nodes : [])
    .filter(n => n && typeof n === 'object')
  // Nothing is taught yet: items are judged on accuracy, cues, form, fairness and figure need (no alignment).
  const goal = [l.goal, l.goal_text, l.subject].filter(Boolean).join(' ')
  const curriculum = inferCurriculum({ goal, profile: l })
  const ctxFor = (n: Record<string, unknown>) => ({ surface: 'diagnostic' as const, curriculum, goal, level: levelLine(l), skill: `${String(n.title ?? '')} ${String(n.summary ?? '')}`, requireCalc: true })
  const rejected: (Rejected & { node: Record<string, unknown> })[] = []
  const good = new Map<Record<string, unknown>, AssessItem[]>()
  const fallback = new Map<Record<string, unknown>, AssessItem[]>()
  await Promise.all(nodes.map(async n => {
    const r = await gateItems(parseItems(n.items), ctxFor(n))
    good.set(n, r.good)
    // Last resort only for items whose sole problems are presentational (never a wrong or doubled key).
    fallback.set(n, r.rejected.filter(x => x.problems.every(p => !/correct|marked answer|computed|equal to|satisf|same expression|too close|calc/.test(p))).map(x => x.raw as AssessItem))
    for (const x of r.rejected) rejected.push({ ...x, node: n })
  }))
  if (rejected.length) {
    try {
      const fix = await generateStructuredJson(`These multiple-choice diagnostic questions failed automatic checks. Write one NEW replacement question for each, testing the same skill at the same level, fixing the problem.
${feedbackLines(rejected)}

Skills (by number above): ${rejected.map((r, i) => `${i + 1}=${String(r.node.title ?? r.node.id ?? '')}`).join('; ')}
Each replacement: {"n": the number above, ...${ITEM_JSON}}.
${ITEM_RULES}
${QUESTION_RULES}
${curriculumLines(curriculum)}
Return JSON {"items": [...]} only.`, { timeoutMs: 60_000, primaryTimeoutMs: 40_000, temperature: 0.3, priority: 'live' }) as { items?: unknown[] }
      const parsed = parseItems(fix?.items)
      await Promise.all(parsed.map(async x => {
        const target = rejected[Number(x.n) - 1]
        if (!target) return
        const r = await gateItems([x], ctxFor(target.node))
        if (r.good.length) good.get(target.node)?.push(r.good[0])
      }))
    } catch (err) {
      console.warn('Diagnostic item repair failed:', err instanceof Error ? err.message : err)
    }
  }
  // Keys spread over positions across the whole bank (no "when in doubt pick A").
  const all = finishSet(nodes.flatMap(n => (good.get(n) ?? []).slice(0, 3).map(it => ({ ...it, __n: n }) as AssessItem & { __n: Record<string, unknown> })))
  for (const n of nodes) {
    const ok = all.filter(x => x.__n === n).map(({ __n: _drop, ...it }) => { void _drop; return it })
    // Never leave a skill without a question: keep a presentational-only failure as a last resort.
    n.items = (ok.length ? ok : fallback.get(n) ?? []).slice(0, 3)
  }
}

/* ───────────── Path: scope, pace, teaching notes ───────────── */

export function planFor(l: LearnerRow, topicCount: number): PathPlan {
  const hours = l.weekly_hours ?? 2
  const sessionsPerWeek = hours <= 1 ? 2 : hours <= 2 ? 3 : hours <= 5 ? 4 : 5
  // About half of each session is the lesson; the rest is practice and the mastery check.
  let lessonMinutes = Math.round((hours * 60) / sessionsPerWeek / 2 / 5) * 5
  // Low confidence or high anxiety: shorter chunks with more frequent wins.
  const fragile = (l.efficacy ?? 3) <= 2 || (anxietyScore(l) ?? 0) >= 3.5
  lessonMinutes = Math.max(10, Math.min(fragile ? 20 : 45, lessonMinutes))
  const scope: PathPlan['scope'] = l.purpose === 'exam' ? 'full' : l.purpose === 'curiosity' ? 'short' : 'path'
  let weeksLeft: number | null = null
  let pace: PathPlan['pace'] = l.purpose === 'curiosity' ? 'relaxed' : 'steady'
  let note = ''
  if (l.deadline) {
    const days = (new Date(l.deadline + 'T12:00:00Z').getTime() - Date.now()) / 86_400_000
    weeksLeft = Math.max(0, Math.round((days / 7) * 10) / 10)
    // Each topic: one lesson + practice + mastery check, about 1.6x the lesson length.
    const neededMin = topicCount * lessonMinutes * 1.6
    const availableMin = Math.max(1, days / 7) * hours * 60
    if (neededMin > availableMin) { pace = 'brisk'; note = 'The deadline is close for this much material: keep to the core, fewer detours, more practice.' }
    else note = `About ${Math.max(1, Math.round(days / 7))} weeks to the deadline: a steady pace fits.`
  }
  return { scope, lessonMinutes, sessionsPerWeek, pace, weeksLeft, note }
}

/** Topics for the path, in prerequisite order, scoped by purpose. */
export function pathNodes(g: DiagGraph, known: string[], scope: PathPlan['scope']) {
  const knownSet = new Set(known)
  const order = topoOrder(g)
  const onPath = new Set([...ancestors(g, g.goalNode), g.goalNode])
  let nodes = order.filter(n => !knownSet.has(n.id))
  if (scope !== 'full') nodes = nodes.filter(n => onPath.has(n.id))
  if (scope === 'short' && nodes.length > 5) nodes = nodes.slice(0, 4).concat(nodes.filter(n => n.id === g.goalNode))
  if (nodes.length === 0) nodes = order.filter(n => n.id === g.goalNode)
  return nodes
}

/** Personalisation notes the lesson drafter follows (level, scaffolding, examples, pace, tone). */
export function teachingNotes(input: { learner: LearnerRow; path: Pick<PathRow, 'graph' | 'known' | 'plan' | 'goal'> & { diagnostic?: PathRow['diagnostic'] }; nodeId: string; firstLesson: boolean; lowMood?: boolean }): string {
  const { learner: l, path, nodeId } = input
  const g = path.graph
  const node = g.nodes.find(n => n.id === nodeId)
  const known = new Set(path.known)
  const titles = (ids: string[]) => ids.map(id => g.nodes.find(n => n.id === id)?.title).filter(Boolean).join('; ')
  const prereqs = node?.prereqs ?? []
  const prereqKnown = prereqs.filter(p => known.has(p))
  const novice = prereqs.length > 0 ? prereqKnown.length < prereqs.length : node?.level !== 'below'
  // Stated answers (v1 intake, or the later micro-question) drive scaffolding as before. Signals inferred from the
  // check's confidence taps (v2, docs/design/onboarding.md) only change tone: knowledge decides scaffolding.
  const sig: DiagSignals | null | undefined = path.diagnostic?.signals ?? inferSignals(path.diagnostic?.state, { stem: !!g.stem })
  const lowEfficacy = (l.efficacy ?? 3) <= 2
  const anxious = (anxietyScore(l) ?? 0) >= 3.5
  const toneLowConfidence = !lowEfficacy && l.efficacy == null && !!sig && sig.efficacy <= 2
  const toneAnxious = !anxious && anxietyScore(l) == null && !!sig?.anxious
  const strong = !novice && (l.efficacy ?? sig?.efficacy ?? 3) >= 4 && path.known.length >= Math.ceil(g.nodes.length / 2)
  const minor = l.age_band === 'under13' || l.age_band === '13to17'
  const lines = [
    `Learner: ${levelLine(l) || 'level unknown'}. ${minor ? 'Teenager or child: friendly, simple sentences, concrete examples.' : 'Adult: direct, respectful, no talking down.'}`,
    `Their goal: ${path.goal.replace(/\.+$/, '')}. This lesson teaches the skill "${node?.title ?? nodeId}": ${node?.summary ?? ''}`,
    path.diagnostic?.fresh && !path.known.length
      ? 'They told us they are completely new to this topic (no check was taken): assume no prior knowledge of it. Start from the very first idea, introduce and define every term the first time it appears, and connect it to everyday things they already know.'
      : path.known.length ? `They already showed they know: ${titles(path.known)}. Do not re-teach these; a one-line reminder is enough.` : 'The diagnostic found few secure foundations: start from the very basics of this skill.',
    path.diagnostic?.fresh && path.known.length ? 'They were completely new to this topic when they started; only the skills above were learned here, so define any other term the first time it appears.' : '',
    novice || lowEfficacy || anxious
      ? 'Scaffolding: HIGH. Worked example first, every step shown and narrated, then a nearly identical problem for them, then fade the steps. Small steps, frequent "does this make sense?" checks, early easy wins.'
      : strong
        ? 'Scaffolding: LOW. They are ready for more: brief worked example, then let them try problems with only hints; avoid over-explaining what they already know (expertise reversal).'
        : 'Scaffolding: MEDIUM. One worked example, then guided practice with fading support.',
    l.example_pref === 'try' && !novice ? 'They like to try first: pose a problem before showing the method, then explain.' : l.example_pref === 'try' ? 'They like to try first, but this skill is new to them: show ONE short worked example first, then let them try.'
      : l.example_pref === 'worked' ? 'They prefer to see a worked example before trying.'
      : strong ? 'Examples vs trying: they showed this ground is familiar, so pose a problem first and explain after (expertise reversal).' : 'Examples vs trying: this is new ground for them, so show a worked example before they try.',
    toneLowConfidence ? 'In the check they were often unsure of answers (even some they got right): name what they did well, start with a quick win, and build their confidence step by step.' : '',
    toneAnxious ? 'In the check they hesitated a lot and often said "I don\'t know": calm, unhurried tone; mistakes are normal; never mention speed or time limits.' : '',
    anxious ? 'They feel tense about this subject: calm, unhurried tone; say mistakes are normal; never mention speed or time limits.' : '',
    l.goal_orientation === 'performance_avoid' ? 'Feedback framing: mistakes are private information about what to practise next; never compare with others.' : 'Feedback framing: focus on understanding and progress; mistakes are private information about what to practise next, never compared with others.',
    l.purpose === 'exam' ? 'Scope: full coverage of this skill and exam-style practice questions in the checks (without naming an exam board).'
      : l.purpose === 'project' ? `Scope: only what their project needs; apply each idea directly to their project${l.why_text ? ` (they said: "${l.why_text.slice(0, 160)}")` : ''}.`
      : l.purpose === 'career' ? 'Scope: practical, workplace-style applications.'
      : l.purpose === 'helping' ? 'Scope: make sure they could explain each step to someone else.'
      : 'Scope: intuitive and lighter; follow what makes it interesting.',
    l.interests?.length ? `Set examples and word problems in: ${l.interests.slice(0, 3).join(', ')}${l.purpose === 'project' || l.purpose === 'career' ? ', and their stated purpose' : ''}. Use Nigerian names, places and naira where natural.` : 'Use everyday Nigerian examples (names, places, naira) where natural.',
    path.plan.pace === 'brisk' ? `Pace: brisk. ${path.plan.note}` : path.plan.pace === 'relaxed' ? 'Pace: relaxed, with room for curiosity.' : 'Pace: steady.',
    l.barriers ? `They said this made learning hard before: "${l.barriers.slice(0, 200)}". Adapt to it (e.g. slower, fewer steps at once).` : '',
    input.firstLesson && input.lowMood ? 'They reported low mood or energy at the start: keep this first lesson especially gentle and short, with an easy first success.' : '',
  ]
  return lines.filter(Boolean).join('\n').slice(0, 3000)
}

/**
 * Mastery-check items for a topic: 4 fresh questions on exactly what this learner's lesson(s) taught (alignment), in
 * their curriculum's conventions, each verified by the item validator (src/lib/assessment). Figures only when needed.
 */
export async function masteryItems(input: { learner: LearnerRow; topicTitle: string; summary: string; goal: string; lessonDigest?: string; admin?: import('@supabase/supabase-js').SupabaseClient | null }): Promise<AssessItem[]> {
  const digest = (input.lessonDigest ?? '').trim()
  const goalWords = [input.goal, input.learner.goal_text, input.learner.subject].filter(Boolean).join(' ')
  const curriculum = inferCurriculum({ goal: goalWords, taught: digest, profile: input.learner })
  const taught = digest ? taughtFromText(digest, objectivesFromDigest(digest)) : null
  // With the learner's lessons: test what they were actually taught, in the lessons' notation; otherwise the skill as titled.
  const basis = digest
    ? `The learner has just been taught this skill in the lesson(s) below. Base EVERY question on what these lessons actually covered: the same methods, steps, formulas, terms, notation, symbols and kinds of pictures, and the same kinds of problems as the worked examples and in-lesson checks, with NEW numbers and new situations. Never copy a lesson example or check question verbatim, never reuse its exact numbers, and do not test anything the lessons did not teach. Questions are on this topic; an earlier lesson may only supply background the topic builds on. "objective" names the lesson aim or key idea each question tests, in the lesson's words.
--- LESSONS ---
${digest}
--- END LESSONS ---`
    : ''
  const prompt = (count: number, avoid: string) => `Write a ${count}-question mastery check for the skill "${input.topicTitle}" (${input.summary}).
Learner: ${levelLine(input.learner) || 'level unknown'}; goal (their words): ${input.goal}.${input.learner.interests?.length ? ` If a context helps, use one of: ${input.learner.interests.slice(0, 2).join(', ')}.` : ''}
${basis ? basis + '\n' : ''}Each question tests whether they can DO the skill (apply it, not recall a definition), at their level, answerable in about a minute. Every question is physically and mathematically correct and has exactly one right answer. 4 options. Mix difficulty: one easier, two at level, one harder.
${ITEM_RULES}
${QUESTION_RULES}
${curriculumLines(curriculum)}${avoid}
Return JSON {"items": [${ITEM_JSON}]}.`
  const opts = { timeoutMs: 45_000, primaryTimeoutMs: 30_000, temperature: 0.5, priority: 'live' as const }
  const ctx = { surface: 'mastery' as const, curriculum, taught, goal: goalWords, level: levelLine(input.learner), skill: `${input.topicTitle} ${input.summary}`, requireCalc: true }
  const first = await gateItems(parseItems((await generateStructuredJson(prompt(4, ''), opts) as Record<string, unknown>)?.items), ctx, { admin: input.admin })
  const good: AssessItem[] = [...first.good]
  if (good.length < 4) {
    // One re-ask for the missing questions, with what was wrong.
    const need = 4 - good.length
    const avoid = first.rejected.length ? `\nEarlier questions were rejected by automatic checks; do not repeat these mistakes:\n${feedbackLines(first.rejected)}` : ''
    try {
      const again = await gateItems(parseItems((await generateStructuredJson(prompt(need, avoid), opts) as Record<string, unknown>)?.items), ctx, { admin: input.admin })
      good.push(...again.good.slice(0, need))
    } catch (err) {
      if (good.length < 3) throw err
    }
  }
  if (good.length < 3) throw new Error('The AI could not write mastery questions that pass the checks')
  return finishSet(good.slice(0, 4))
}

export { descendants }

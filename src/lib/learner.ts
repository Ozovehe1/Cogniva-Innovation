/**
 * Learner profile, AI prompts for the intake and diagnostic, and the learning
 * path: scope from purpose, difficulty and scaffolding from the diagnostic plus
 * self-efficacy, pace from deadline and weekly hours, examples from interests
 * and purpose. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateStructuredJson } from './gemini'
import { levelLine, type Answers } from './intake'
import { cleanGraph, descendants, ancestors, topoOrder, type DiagGraph, type DiagState, type DiagItem } from './diagnostic-core'
import type { StudentProfileLite } from './lesson-ai'

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
  diagnostic: { state?: DiagState; extra?: Record<string, DiagItem[]> }
  known: string[]
  ready: string[]
  plan: PathPlan
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
  mastery: { items?: DiagItem[]; startedAt?: string; lastScore?: number; recheck?: { node: string; item: number }[] }
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
    const v = val('anxiety') as Record<string, unknown> | undefined
    out.anxiety = v ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, num(x)]).filter(([, x]) => x !== null && (x as number) >= 1 && (x as number) <= 5)) as Record<string, number> : null
  }
  if ('example_pref' in a) out.example_pref = str('example_pref')
  if ('interests' in a) {
    const v = val('interests')
    out.interests = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(x => x.slice(0, 60)).slice(0, 8) : []
  }
  if ('barriers' in a) out.barriers = str('barriers', 600)
  return out
}

export async function loadLearner(db: SupabaseClient, studentId: string): Promise<LearnerRow | null> {
  const { data } = await db.from('learner_profiles').select('*').eq('student_id', studentId).maybeSingle()
  return (data as LearnerRow | null) ?? null
}

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

export async function suggestGoals(input: { goal: string; level: string }): Promise<{ goals: { goal: string; subject: string; stem: boolean }[]; reflection: string }> {
  const prompt = `A learner (${input.level || 'level unknown'}) told an AI tutor what they want to learn, in their own words:
"""${input.goal.slice(0, 600)}"""
Suggest 3 or 4 specific, achievable learning goals that are closest to what they meant, from narrow to broader. Each goal is one plain sentence starting with a verb ("Solve…", "Size…", "Explain…"), under 90 characters, at a level that suits them. Use neutral wording: do not assume an exam unless they said so.
Also give "reflection": one warm sentence (under 25 words) reflecting back what they want, without praise or emoji.
Return JSON: {"reflection": string, "goals": [{"goal": string, "subject": string (the school or field subject in 1-3 words, e.g. "Mathematics", "Solar PV", "Chemistry"), "stem": boolean (true for maths, physics, chemistry, engineering, computing, statistics)}]}`
  const raw = await generateStructuredJson(prompt, { timeoutMs: 25_000, primaryTimeoutMs: 15_000, thinking: 'minimal' }) as Record<string, unknown>
  const goals = (Array.isArray(raw?.goals) ? raw.goals : []).flatMap(g => {
    if (!g || typeof g !== 'object') return []
    const o = g as Record<string, unknown>
    return typeof o.goal === 'string' && o.goal.trim() ? [{ goal: o.goal.trim().slice(0, 140), subject: typeof o.subject === 'string' ? o.subject.trim().slice(0, 60) : '', stem: o.stem === true }] : []
  }).slice(0, 4)
  return { goals, reflection: typeof raw?.reflection === 'string' ? raw.reflection.slice(0, 220) : '' }
}

export async function reflectWhy(input: { why: string; goal: string }): Promise<{ reflection: string; valueType: string }> {
  const prompt = `A learner wants to: ${input.goal.slice(0, 200)}.
Asked "Why does this matter to you?", they said:
"""${input.why.slice(0, 600)}"""
Reply as a warm, brief tutor using motivational-interviewing reflection: one sentence (under 28 words) that reflects their reason back in plain words, e.g. "So you need this for your solar project by December, and you want to really get it." No praise, no emoji, no advice.
Also classify the main value: "intrinsic" (interest, enjoyment), "attainment" (identity, doing well), "utility" (useful for a goal, job, exam, project) or "mixed".
Return JSON {"reflection": string, "valueType": string}.`
  const raw = await generateStructuredJson(prompt, { timeoutMs: 20_000, primaryTimeoutMs: 12_000, thinking: 'minimal' }) as Record<string, unknown>
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
- "items": exactly 2 multiple-choice questions that test THIS skill only (not its prerequisites), each {"q": string, "options": [4 strings], "answer": index of the correct option, "explain": one short sentence}. Questions are short, unambiguous, answerable in under a minute without a calculator unless trivial, at the skill's own level. Use $...$ for maths (KaTeX). Distractors are common mistakes. Vary the position of the correct answer. No trick questions; no "all of the above".
Also "goalNode": the id of the goal skill, "subject": the subject in 1-3 words, "stem": true for maths/science/engineering/computing.
Neutral, global wording; examples may use Nigerian context. Return JSON {"subject", "stem", "goalNode", "nodes": [...]} only.`
  const raw = await generateStructuredJson(prompt, { timeoutMs: 110_000, primaryTimeoutMs: 80_000, temperature: 0.4 })
  return cleanGraph(raw, l.subject ?? '')
}

/* ───────────── Path: scope, pace, teaching notes ───────────── */

export function planFor(l: LearnerRow, topicCount: number): PathPlan {
  const hours = l.weekly_hours ?? 2
  const sessionsPerWeek = hours <= 1 ? 2 : hours <= 2 ? 3 : hours <= 5 ? 4 : 5
  let lessonMinutes = Math.round((hours * 60) / sessionsPerWeek / 5) * 5
  lessonMinutes = Math.max(10, Math.min(30, lessonMinutes))
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
export function teachingNotes(input: { learner: LearnerRow; path: Pick<PathRow, 'graph' | 'known' | 'plan' | 'goal'>; nodeId: string; firstLesson: boolean; lowMood?: boolean }): string {
  const { learner: l, path, nodeId } = input
  const g = path.graph
  const node = g.nodes.find(n => n.id === nodeId)
  const known = new Set(path.known)
  const titles = (ids: string[]) => ids.map(id => g.nodes.find(n => n.id === id)?.title).filter(Boolean).join('; ')
  const prereqs = node?.prereqs ?? []
  const prereqKnown = prereqs.filter(p => known.has(p))
  const novice = prereqs.length > 0 ? prereqKnown.length < prereqs.length : node?.level !== 'below'
  const lowEfficacy = (l.efficacy ?? 3) <= 2
  const anxious = (anxietyScore(l) ?? 0) >= 3.5
  const strong = !novice && (l.efficacy ?? 3) >= 4 && path.known.length >= Math.ceil(g.nodes.length / 2)
  const minor = l.age_band === 'under13' || l.age_band === '13to17'
  const lines = [
    `Learner: ${levelLine(l) || 'level unknown'}. ${minor ? 'Teenager or child: friendly, simple sentences, concrete examples.' : 'Adult: direct, respectful, no talking down.'}`,
    `Their goal: ${path.goal.replace(/\.+$/, '')}. This lesson teaches the skill "${node?.title ?? nodeId}": ${node?.summary ?? ''}`,
    path.known.length ? `They already showed they know: ${titles(path.known)}. Do not re-teach these; a one-line reminder is enough.` : 'The diagnostic found few secure foundations: start from the very basics of this skill.',
    novice || lowEfficacy || anxious
      ? 'Scaffolding: HIGH. Worked example first, every step shown and narrated, then a nearly identical problem for them, then fade the steps. Small steps, frequent "does this make sense?" checks, early easy wins.'
      : strong
        ? 'Scaffolding: LOW. They are ready for more: brief worked example, then let them try problems with only hints; avoid over-explaining what they already know (expertise reversal).'
        : 'Scaffolding: MEDIUM. One worked example, then guided practice with fading support.',
    l.example_pref === 'try' && !novice ? 'They like to try first: pose a problem before showing the method, then explain.' : l.example_pref === 'try' ? 'They like to try first, but this skill is new to them: show ONE short worked example first, then let them try.' : 'They prefer to see a worked example before trying.',
    anxious ? 'They feel tense about this subject: calm, unhurried tone; say mistakes are normal; never mention speed or time limits.' : '',
    l.goal_orientation === 'performance_avoid' ? 'Feedback framing: mistakes are private information about what to practise next; never compare with others.' : 'Feedback framing: focus on understanding and progress.',
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

/** Mastery-check items for a topic: 4 fresh multiple-choice questions on this skill. */
export async function masteryItems(input: { learner: LearnerRow; topicTitle: string; summary: string; goal: string }): Promise<DiagItem[]> {
  const prompt = `Write a 4-question mastery check for the skill "${input.topicTitle}" (${input.summary}).
Learner: ${levelLine(input.learner) || 'level unknown'}; goal: ${input.goal}.${input.learner.interests?.length ? ` Set word problems in: ${input.learner.interests.slice(0, 2).join(', ')}.` : ''}
Each question tests whether they can DO the skill (apply it, not recall a definition), at their level, answerable in about a minute. Use $...$ for maths. 4 options each, distractors are common mistakes, vary the correct position.
Return JSON {"items": [{"q": string, "options": [4 strings], "answer": index, "explain": one sentence showing the key step}]}.`
  const raw = await generateStructuredJson(prompt, { timeoutMs: 45_000, primaryTimeoutMs: 30_000, temperature: 0.5 }) as Record<string, unknown>
  const items = cleanItems(raw?.items)
  if (items.length < 3) throw new Error('The AI returned too few mastery questions')
  return items.slice(0, 4)
}

function cleanItems(raw: unknown): DiagItem[] {
  const out: DiagItem[] = []
  for (const it of Array.isArray(raw) ? raw : []) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    if (typeof o.q !== 'string' || !Array.isArray(o.options) || typeof o.answer !== 'number') continue
    const opts = o.options.filter((s): s is string => typeof s === 'string' && !!s.trim()).map(s => s.slice(0, 200)).slice(0, 5)
    if (opts.length < 3 || o.answer < 0 || o.answer >= opts.length) continue
    out.push({ q: o.q.slice(0, 500), options: opts, answer: Math.floor(o.answer), explain: typeof o.explain === 'string' ? o.explain.slice(0, 400) : undefined })
  }
  return out.slice(0, 5)
}

export { descendants }

/**
 * The GeniusMap intake: a short conversation (about 12-14 items, under ~5 minutes)
 * that finds the learner's level, goal, reasons, constraints and current state.
 * Evidence base (see the intake research brief): open-then-narrow goal questions,
 * expectancy-value "why", PALS-style efficacy and goal-orientation items, AMAS-style
 * maths anxiety items asked only after rapport, and no learning-styles test.
 *
 * Pure data and helpers: safe on the server and in the browser.
 */

export type ItemKind = 'choice' | 'multi' | 'text' | 'scale' | 'date' | 'consent' | 'pair' | 'goal'

export interface Choice { value: string; label: string; hint?: string }

export interface IntakeItem {
  id: string
  kind: ItemKind
  /** The question; {subject} and {goal} are filled in. */
  ask: string
  sub?: string
  choices?: Choice[]
  /** For scale items: 5 anchors (emoji or words) from 1 to 5. */
  anchors?: string[]
  /** For pair items: two scale rows on one screen. */
  rows?: { id: string; label: string; anchors: string[] }[]
  placeholder?: string
  optional?: boolean
  /** Shown only when this returns true for the answers so far. */
  when?: (a: Answers) => boolean
}

export interface Answer {
  v?: unknown
  skipped?: boolean
  notSure?: boolean
}
export type Answers = Record<string, Answer>

const MOOD = ['😣', '🙁', '😐', '🙂', '😄']
const ENERGY = ['🪫', '😪', '😐', '⚡', '🔋']

export const LEVELS: Choice[] = [
  { value: 'Primary 4-6', label: 'Primary 4–6' },
  { value: 'JSS1', label: 'JSS1' }, { value: 'JSS2', label: 'JSS2' }, { value: 'JSS3', label: 'JSS3' },
  { value: 'SS1', label: 'SS1' }, { value: 'SS2', label: 'SS2' }, { value: 'SS3', label: 'SS3' },
  { value: 'ND/HND', label: 'ND / HND' },
  { value: 'University 100L', label: '100L' }, { value: 'University 200L', label: '200L' }, { value: 'University 300L', label: '300L' },
  { value: 'University 400L', label: '400L' }, { value: 'University 500L', label: '500L' },
  { value: 'Postgraduate', label: 'Postgraduate' },
  { value: 'Other', label: 'Something else' },
]

export const INTERESTS: Choice[] = [
  { value: 'technology and coding', label: 'Tech & coding' },
  { value: 'business and money', label: 'Business & money' },
  { value: 'sport', label: 'Sport' },
  { value: 'farming and food', label: 'Farming & food' },
  { value: 'everyday Lagos life', label: 'Everyday Lagos life' },
  { value: 'music and film', label: 'Music & film' },
  { value: 'health and the body', label: 'Health' },
  { value: 'energy and engineering', label: 'Energy & engineering' },
  { value: 'space and nature', label: 'Space & nature' },
  { value: 'fashion and design', label: 'Fashion & design' },
]

export const PURPOSES: Choice[] = [
  { value: 'curiosity', label: 'Curiosity', hint: 'I just want to understand it' },
  { value: 'project', label: 'A project', hint: 'I’m building or making something' },
  { value: 'exam', label: 'An exam or school', hint: 'A test, a class, a course' },
  { value: 'career', label: 'A job or career', hint: 'Work I do or want to do' },
  { value: 'helping', label: 'Helping someone', hint: 'A child, a sibling, a colleague' },
]

export const isMinor = (a: Answers) => a.age?.v === 'under13' || a.age?.v === '13to17'
/** Maths and science goals get the anxiety items (set from the AI's goal analysis). */
export const isStem = (a: Answers) => {
  const g = a.goal_pick?.v as { stem?: boolean } | undefined
  return !!g?.stem
}

export const INTAKE: IntakeItem[] = [
  { id: 'status', kind: 'choice', ask: 'First, a little about you. Are you in school right now, or have you finished?', choices: [
    { value: 'in_school', label: 'In school' }, { value: 'finished', label: 'Finished' }, { value: 'break', label: 'Taking a break' },
  ] },
  { id: 'age', kind: 'choice', ask: 'How old are you?', sub: 'This decides how we talk with you and whether we need a parent or guardian’s okay.', choices: [
    { value: 'under13', label: 'Under 13' }, { value: '13to17', label: '13 to 17' }, { value: '18plus', label: '18 or over' },
  ] },
  { id: 'consent', kind: 'consent', ask: 'Because you’re under 18, we need a parent or guardian to agree before we save your answers.', sub: 'Nigeria’s Data Protection Act (2023, s.31) asks for this. We only keep what helps us teach you.', when: isMinor },
  { id: 'level', kind: 'choice', ask: 'Which class or year are you in, or did you last finish?', choices: LEVELS },
  { id: 'system', kind: 'choice', ask: 'Which school system is that?', choices: [
    { value: 'Nigerian curriculum (public)', label: 'Nigerian, public' }, { value: 'Nigerian curriculum (private)', label: 'Nigerian, private' },
    { value: 'British (IGCSE / A-level)', label: 'British (IGCSE / A-level)' }, { value: 'American', label: 'American' },
    { value: 'Homeschool', label: 'Homeschool' }, { value: 'Other', label: 'Other' },
  ] },
  { id: 'goal', kind: 'text', ask: 'What do you want to learn, or be able to do?', sub: 'In your own words. A sentence is plenty.', placeholder: 'e.g. Solve quadratic equations without getting stuck' },
  { id: 'goal_pick', kind: 'goal', ask: 'Which of these is closest?', sub: 'Pick one, or keep your own words.' },
  { id: 'last_studied', kind: 'choice', ask: 'When did you last study {subject}?', choices: [
    { value: 'now', label: 'I’m studying it now' }, { value: 'this_year', label: 'Earlier this year' },
    { value: '1-2y', label: '1–2 years ago' }, { value: 'longer', label: 'Longer ago' },
    { value: 'never', label: 'I’m completely new to this', hint: 'Never studied it, no idea yet' },
  ] },
  { id: 'why', kind: 'text', ask: 'Why does this matter to you?', sub: 'There’s no right answer.', placeholder: 'e.g. I want to understand it properly, not just pass' },
  { id: 'purpose', kind: 'choice', ask: 'What is it for, mainly?', choices: PURPOSES },
  { id: 'deadline', kind: 'date', ask: 'Is there a deadline?', sub: 'An exam date, a project hand-in, a start date.' },
  { id: 'hours', kind: 'choice', ask: 'How much time can you give it each week?', choices: [
    { value: '1', label: 'About an hour' }, { value: '2', label: '1–2 hours' }, { value: '4', label: '3–5 hours' },
    { value: '8', label: '6–10 hours' }, { value: '12', label: 'More than 10' },
  ] },
  { id: 'efficacy', kind: 'scale', ask: 'How sure are you that you can learn this if you keep at it?', anchors: ['Not sure at all', 'A little', 'Somewhat', 'Fairly sure', 'Very sure'] },
  { id: 'orientation', kind: 'choice', ask: 'When you’re learning, which matters more to you?', sub: 'Pick the one that’s closer, even if both are a bit true.', choices: [
    { value: 'mastery', label: 'Really understanding it' }, { value: 'performance_avoid', label: 'Not looking bad in front of others' },
  ] },
  { id: 'feeling', kind: 'pair', ask: 'How are you feeling right now?', sub: 'Only you see this, and we delete it after two weeks.', rows: [
    { id: 'mood', label: 'Mood', anchors: MOOD }, { id: 'energy', label: 'Energy', anchors: ENERGY },
  ] },
  { id: 'anxiety', kind: 'pair', ask: 'A few honest ones about {subject}. How tense would you feel…', sub: '1 is calm, 5 is very tense.', when: isStem, rows: [
    { id: 'test', label: '…taking a test on it?', anchors: ['1', '2', '3', '4', '5'] },
    { id: 'problems', label: '…being handed a page of problems?', anchors: ['1', '2', '3', '4', '5'] },
    { id: 'new_topic', label: '…hearing a new topic explained?', anchors: ['1', '2', '3', '4', '5'] },
  ] },
  { id: 'example_pref', kind: 'choice', ask: 'When something is new, do you like to see a worked example first, or try it first?', choices: [
    { value: 'worked', label: 'Show me an example first' }, { value: 'try', label: 'Let me try first' },
  ] },
  { id: 'interests', kind: 'multi', ask: 'What should your examples be about?', sub: 'Pick any. We’ll use them to make problems feel real.', choices: INTERESTS },
  { id: 'barriers', kind: 'text', ask: 'Anything that’s made learning hard before?', sub: 'Optional. Anything you share helps us pace things.', placeholder: 'e.g. Teachers moved too fast; I get lost when there are many steps', optional: true },
]

/**
 * Free-text signs that the learner knows nothing about the topic yet ("no idea", "never studied it",
 * "complete beginner", "from scratch"...). Checked on the goal and "why" answers.
 */
export const NEW_TO_IT = /\b(no idea|no clue|clueless|never (?:studied|learn(?:ed|t)|done|touched|tried|heard of|seen|taken)|(?:complete(?:ly)?|total(?:ly)?|absolute|pure|real) (?:beginner|newbie|novice|noob|new)|beginner from|from (?:scratch|zero|the very (?:start|beginning))|know(?:s)? nothing|don[’']?t know (?:anything|any thing|a thing)|zero (?:knowledge|background|experience)|no (?:background|prior knowledge|knowledge|experience) (?:in|of|on|about|with)|brand new to|new to (?:it|this|this topic|the topic) entirely)\b/i

export type PriorKnowledge = { none: boolean; reason: 'choice' | 'ai' | 'text' | null }

/**
 * Does the learner start with zero prior knowledge of this goal's topic? If so the adaptive check is
 * skipped and the path starts from the foundations. In order:
 *  1. the explicit "I’m completely new to this" answer (last_studied = never);
 *  2. having studied it recently ("now", "this year", "1–2 years ago") means some exposure: take the check;
 *  3. the intake AI's reading of their goal in their own words (goal_pick.prior = 'none');
 *  4. a keyword check on the goal and "why" answers.
 * Pure: used by the server (authoritative) and by the browser (copy only).
 */
export function priorKnowledge(a: Answers): PriorKnowledge {
  const ls = a.last_studied
  const lsv = ls && !ls.skipped && !ls.notSure ? ls.v : undefined
  if (lsv === 'never') return { none: true, reason: 'choice' }
  if (lsv === 'now' || lsv === 'this_year' || lsv === '1-2y') return { none: false, reason: null }
  const pick = a.goal_pick?.v as { prior?: unknown } | undefined
  if (pick && typeof pick === 'object' && pick.prior === 'none') return { none: true, reason: 'ai' }
  for (const id of ['goal', 'why']) {
    const t = a[id]?.v
    if (typeof t === 'string' && NEW_TO_IT.test(t)) return { none: true, reason: 'text' }
  }
  return { none: false, reason: null }
}

export function visibleItems(a: Answers): IntakeItem[] {
  return INTAKE.filter(i => !i.when || i.when(a))
}

export function fill(text: string, a: Answers): string {
  const g = a.goal_pick?.v as { subject?: string; goal?: string } | undefined
  const subject = g?.subject || 'this'
  return text.replace(/\{subject\}/g, subject).replace(/\{goal\}/g, g?.goal || (a.goal?.v as string) || 'this')
}

const label = (choices: Choice[] | undefined, v: unknown) => choices?.find(c => c.value === v)?.label ?? String(v ?? '')

/** A short, warm reflection of the answer just given (motivational-interviewing style). Null = no reflection. */
export function reflect(item: IntakeItem, a: Answers): string | null {
  const ans = a[item.id]
  if (!ans || ans.skipped) return item.id === 'consent' ? null : 'No problem, we can skip that.'
  if (ans.notSure) return 'Not sure is a fine answer. We’ll work it out as we go.'
  const v = ans.v
  switch (item.id) {
    case 'status': return v === 'in_school' ? 'Good, so this can fit around school.' : v === 'finished' ? 'Got it. We’ll pitch things for someone who’s finished school.' : 'A break is a good time to learn something on your own terms.'
    case 'level': return v === 'Other' ? 'Thanks. The short check later will find the right starting point anyway.' : `${label(item.choices, v)}. Your class is only a starting guess; the short check later finds where you really are.`
    case 'system': return null
    case 'why': return 'Thank you. That reason will shape the examples I use.'
    case 'goal_pick': {
      const g = v as { goal?: string } | undefined
      return g?.goal ? `So the goal is: ${g.goal.trim().replace(/[.!?]+$/, '')}.` : null
    }
    case 'last_studied': return v === 'never' ? 'Then we’ll start from the very first idea. No check needed for this one.' : v === 'longer' ? 'Then we’ll start with a quick refresh of the basics underneath it.' : null
    case 'purpose': {
      const p = v as string
      return p === 'exam' ? 'An exam, so we’ll cover the full topic and practise exam-style questions.'
        : p === 'project' ? 'A project, so we’ll focus on what the project actually needs and skip detours.'
        : p === 'career' ? 'For work, so the examples will lean on real situations.'
        : p === 'helping' ? 'Helping someone else: we’ll make sure you can explain it, not just do it.'
        : 'Curiosity is a great reason. We’ll keep it lighter and follow what interests you.'
    }
    case 'deadline': {
      const d = typeof v === 'string' && v ? new Date(v) : null
      if (!d || isNaN(d.getTime())) return 'No fixed deadline, so we’ll go at a steady pace.'
      return `So you need this by ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}. We’ll pace the plan to that.`
    }
    case 'hours': return `${label(item.choices, v)} a week. We’ll size each lesson to fit.`
    case 'efficacy': return Number(v) <= 2 ? 'Thanks for being honest. We’ll start with small wins and build from there.' : Number(v) >= 4 ? 'Good. That belief helps more than people think.' : 'That’s a fair place to start.'
    case 'orientation': return v === 'performance_avoid' ? 'That’s very common. Here, mistakes are private and they’re just information about what to teach next.' : 'Understanding it is exactly what we’ll aim for.'
    case 'feeling': {
      const f = v as { mood?: number; energy?: number } | undefined
      return (f?.mood ?? 3) <= 2 || (f?.energy ?? 3) <= 2 ? 'Thanks for telling me. We’ll keep the first lesson short and gentle.' : 'Good to know. Let’s use that energy.'
    }
    case 'anxiety': return 'Thank you. There are no timers here, and you can always ask for a worked example.'
    case 'example_pref': return v === 'try' ? 'You’ll get a go first. If something is brand new, I may show one example before you try.' : 'Examples first, then you try.'
    case 'interests': return Array.isArray(v) && v.length ? `I’ll use ${v.slice(0, 2).map(x => String(x).split(' and ')[0]).join(' and ')} in the examples.` : null
    case 'barriers': return 'Thank you for sharing that. I’ll keep it in mind.'
    default: return null
  }
}

/** Plain-language level line used in prompts, e.g. "SS2, Nigerian curriculum (public); in school; age 13-17". */
export function levelLine(p: { level?: string | null; school_system?: string | null; learner_status?: string | null; age_band?: string | null }) {
  const age = p.age_band === 'under13' ? 'under 13' : p.age_band === '13to17' ? 'age 13-17' : p.age_band === '18plus' ? 'adult' : null
  const status = p.learner_status === 'in_school' ? 'in school' : p.learner_status === 'finished' ? 'finished school' : p.learner_status === 'break' ? 'on a break from school' : null
  return [p.level && p.level !== 'Other' ? p.level : null, p.school_system && p.school_system !== 'Other' ? p.school_system : null, status, age].filter(Boolean).join(', ')
}

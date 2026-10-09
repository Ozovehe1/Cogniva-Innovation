/**
 * The GeniusMap intake (v2): four short screens before the adaptive check, then progressive profiling.
 * Evidence base: docs/design/onboarding.md (survey length vs drop-off, time-to-value, stealth assessment,
 * single-item anxiety measures, implementation intentions, expertise reversal, interest personalisation, CAT).
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
  /** Asked later as a micro-question, not during onboarding. */
  deferred?: boolean
  /** A v1 item that is no longer asked (answers still accepted). */
  legacy?: boolean
}

export interface Answer {
  v?: unknown
  skipped?: boolean
  notSure?: boolean
  /** Set when the value was inferred from behaviour rather than answered (e.g. 'diagnostic', 'goal-text'). */
  inferred?: string
  /** When it was answered (micro-questions). */
  at?: string
}
export type Answers = Record<string, Answer>


export const LEVELS: Choice[] = [
  { value: 'Primary 4-6', label: 'Primary 4–6' },
  { value: 'JSS1', label: 'JSS1' }, { value: 'JSS2', label: 'JSS2' }, { value: 'JSS3', label: 'JSS3' },
  { value: 'SS1', label: 'SS1' }, { value: 'SS2', label: 'SS2' }, { value: 'SS3', label: 'SS3' },
  { value: 'ND/HND', label: 'ND / HND' },
  { value: 'University 100L', label: '100L' }, { value: 'University 200L', label: '200L' }, { value: 'University 300L', label: '300L' },
  { value: 'University 400L', label: '400L' }, { value: 'University 500L', label: '500L' },
  { value: 'Postgraduate', label: 'Postgraduate' },
  { value: 'Finished school', label: 'Finished school / working' },
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

/**
 * Onboarding v2 (docs/design/onboarding.md). Four explicit screens before the check (five for under-18s, who
 * need a guardian's okay): the goal in their own words, age + class on one screen, the goal narrowed (with how
 * familiar it is), then an optional "what for / by when" shown while the skill map is being built. Everything
 * else is inferred from behaviour (efficacy and anxiety from the check's confidence taps, examples-first vs
 * try-first from the diagnostic's expertise, interests from the goal's own words) or asked once later, in
 * context, as a one-tap micro-question at the end of a lesson (MICRO_QUESTIONS). Items no longer asked stay
 * here (legacy: true) so older learners' answers keep loading, saving and mapping onto the profile.
 */
export const INTAKE: IntakeItem[] = [
  { id: 'goal', kind: 'text', ask: 'What do you want to learn?', sub: 'In your own words. A few words is plenty.', placeholder: 'e.g. Solve quadratic equations without getting stuck' },
  { id: 'age', kind: 'choice', ask: 'How old are you?', choices: [
    { value: 'under13', label: 'Under 13' }, { value: '13to17', label: '13–17' }, { value: '18plus', label: '18+' },
  ] },
  { id: 'level', kind: 'choice', ask: 'Which class or year are you in?', sub: 'Or the last one you finished.', choices: LEVELS },
  { id: 'consent', kind: 'consent', ask: 'One thing before we save anything: a parent or guardian’s okay.', sub: 'Nigeria’s Data Protection Act (2023, s.31) asks for this for anyone under 18. We only keep what helps us teach you.', when: isMinor },
  { id: 'goal_pick', kind: 'goal', ask: 'Which of these is closest?', sub: 'Pick one, or keep your own words.' },
  { id: 'last_studied', kind: 'choice', ask: 'How well do you know it already?', optional: true, choices: [
    { value: 'never', label: 'It’s new to me', hint: 'Never studied it' },
    { value: 'some', label: 'I know a bit' },
    { value: 'now', label: 'I’m studying it now' },
    // Older answers (the v1 question had five choices).
    { value: 'this_year', label: 'Earlier this year' }, { value: '1-2y', label: '1–2 years ago' }, { value: 'longer', label: 'Longer ago' },
  ] },
  { id: 'purpose', kind: 'choice', ask: 'What’s it for?', optional: true, choices: PURPOSES },
  { id: 'deadline', kind: 'date', ask: 'Is there a date you need it by?', optional: true },
  // Asked later, one at a time, at the end of a lesson (see MICRO_QUESTIONS).
  { id: 'interests', kind: 'multi', ask: 'What should your examples be about?', sub: 'Pick any. Problems set in things you care about are easier to think through.', choices: INTERESTS, optional: true, deferred: true },
  { id: 'hours', kind: 'choice', ask: 'How much time can you give this each week?', optional: true, deferred: true, choices: [
    { value: '1', label: 'About an hour' }, { value: '2', label: '1–2 hours' }, { value: '4', label: '3–5 hours' },
    { value: '8', label: '6–10 hours' }, { value: '12', label: 'More than 10' },
  ] },
  { id: 'next_session', kind: 'choice', ask: 'When will you do your next lesson?', sub: 'People who pick a time are far more likely to show up. We’ll keep your place ready.', optional: true, deferred: true, choices: [
    { value: 'today_later', label: 'Later today' }, { value: 'tomorrow_same', label: 'Tomorrow, same time' },
    { value: 'tomorrow_morning', label: 'Tomorrow morning' }, { value: 'tomorrow_evening', label: 'Tomorrow evening' }, { value: 'weekend', label: 'At the weekend' },
  ] },
  { id: 'anxiety', kind: 'scale', ask: 'How anxious does {subject} make you?', sub: 'Honest is best. It only changes how calmly I pace things.', anchors: ['Not at all', 'A little', 'Somewhat', 'Quite', 'Very'], optional: true, deferred: true, when: isStem },
  { id: 'why', kind: 'text', ask: 'How could this help you, in your own life?', sub: 'One sentence. Connecting it to your life makes it stick.', placeholder: 'e.g. So I can size the solar panels for my family’s shop', optional: true, deferred: true },
  // Legacy (v1) items: never asked now; kept so stored answers still validate and map.
  { id: 'status', kind: 'choice', ask: 'Are you in school right now?', legacy: true, choices: [
    { value: 'in_school', label: 'In school' }, { value: 'finished', label: 'Finished' }, { value: 'break', label: 'Taking a break' },
  ] },
  { id: 'system', kind: 'choice', ask: 'Which school system is that?', legacy: true },
  { id: 'efficacy', kind: 'scale', ask: 'How sure are you that you can learn this if you keep at it?', legacy: true, anchors: ['Not sure at all', 'A little', 'Somewhat', 'Fairly sure', 'Very sure'] },
  { id: 'orientation', kind: 'choice', ask: 'When you’re learning, which matters more to you?', legacy: true },
  { id: 'feeling', kind: 'pair', ask: 'How are you feeling right now?', legacy: true },
  { id: 'example_pref', kind: 'choice', ask: 'Worked example first, or try first?', legacy: true },
  { id: 'barriers', kind: 'text', ask: 'Anything that’s made learning hard before?', legacy: true, optional: true },
]

/** The onboarding screens, in order. Each holds one or more items answered together. */
export interface IntakeScreen { id: string; items: string[]; when?: (a: Answers) => boolean; optional?: boolean }
export const SCREENS: IntakeScreen[] = [
  { id: 'goal', items: ['goal'] },
  { id: 'about', items: ['age', 'level'] },
  { id: 'consent', items: ['consent'], when: isMinor },
  { id: 'goal_pick', items: ['goal_pick', 'last_studied'] },
  // Shown after the intake is complete, while the skill map builds; all optional.
  { id: 'purpose', items: ['purpose', 'deadline'], optional: true },
]
/** Screens that belong to one goal (asked again when the learner adds another goal). */
export const GOAL_SCREENS = ['goal', 'goal_pick', 'purpose']
export const GOAL_ITEMS = ['goal', 'goal_pick', 'last_studied', 'why', 'purpose', 'deadline', 'efficacy', 'anxiety', 'next_session']

export function visibleScreens(a: Answers): IntakeScreen[] {
  return SCREENS.filter(s => !s.when || s.when(a))
}

/**
 * One-tap micro-questions asked later, in context, at the end of a lesson (at most one per lesson end and one
 * every 12 hours), in this order. Each is asked once; skipping counts as asked.
 */
export const MICRO_QUESTIONS = ['interests', 'next_session', 'hours', 'anxiety', 'why'] as const
export type MicroId = typeof MICRO_QUESTIONS[number]

/** Status is no longer asked: from the class (school classes for under-18s are "in school"). */
export function inferStatus(a: Answers): string | null {
  const lv = a.level?.v; const age = a.age?.v
  if (lv === 'Finished school') return 'finished'
  if (typeof lv === 'string' && /^(Primary|JSS|SS|University|ND)/.test(lv) && (age === 'under13' || age === '13to17')) return 'in_school'
  return null
}

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
  if (lsv === 'now' || lsv === 'some' || lsv === 'this_year' || lsv === '1-2y') return { none: false, reason: null }
  const pick = a.goal_pick?.v as { prior?: unknown } | undefined
  if (pick && typeof pick === 'object' && pick.prior === 'none') return { none: true, reason: 'ai' }
  for (const id of ['goal', 'why']) {
    const t = a[id]?.v
    if (typeof t === 'string' && NEW_TO_IT.test(t)) return { none: true, reason: 'text' }
  }
  return { none: false, reason: null }
}

/** Items asked during onboarding (not deferred, not legacy) and visible for these answers. */
export function visibleItems(a: Answers): IntakeItem[] {
  return INTAKE.filter(i => !i.deferred && !i.legacy && (!i.when || i.when(a)))
}
export const itemById = (id: string) => INTAKE.find(i => i.id === id)

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

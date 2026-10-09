/**
 * Which curriculum / standard an assessment follows, inferred in this order (docs/design/assessment.md §4):
 *  1. the learner's own words: their goal and what they asked to learn ("WAEC further maths", "AP Calc AB",
 *     "GCSE higher", "SS2 quadratics", "200L circuits", "Class 10 CBSE");
 *  2. what the tutor actually taught (the lesson digest: notation, units, named exams);
 *  3. the profile (school system, level), only as a weak fallback.
 * The result sets notation, units and context rules for the item writer and the locale checks in validate.ts.
 * Pure: safe on the server and in the browser.
 */

export type System =
  | 'waec' | 'neco' | 'jamb' | 'gcse' | 'igcse' | 'a-level' | 'ib' | 'ap' | 'sat' | 'act' | 'common-core'
  | 'cbse' | 'icse' | 'kcse' | 'cape' | 'csec' | 'matric' | 'university' | 'professional'

export interface Curriculum {
  /** The exam or school system the learner is working towards, when they (or their lesson) named one. */
  system: System | null
  /** Where the system came from: their own words, the lesson, or the profile. */
  source: 'goal' | 'lesson' | 'profile' | 'none'
  /** Plain description for prompts, e.g. "WAEC (West African Senior School Certificate)". */
  label: string | null
  /** US customary units are only used when the learner is on a US system (AP, SAT, ACT, Common Core). */
  usUnits: boolean
  /** Currency the learner's context uses, when their goal or lesson shows one; otherwise none (keep money out or neutral). */
  currency: string | null
  /** Region hints taken from the learner's own words or lesson (names, places), never assumed from the system alone. */
  region: string | null
}

const SYSTEMS: { re: RegExp; system: System; label: string; us?: boolean; region?: string }[] = [
  { re: /\bwaec\b|\bwassce\b|\bssce\b/i, system: 'waec', label: 'WAEC (West African Senior School Certificate)', region: 'West Africa' },
  { re: /\bneco\b/i, system: 'neco', label: 'NECO (Nigeria Senior School Certificate)', region: 'Nigeria' },
  { re: /\bjamb\b|\butme\b/i, system: 'jamb', label: 'JAMB UTME', region: 'Nigeria' },
  { re: /\bigcse\b/i, system: 'igcse', label: 'Cambridge IGCSE' },
  { re: /\bgcse\b/i, system: 'gcse', label: 'GCSE (England)', region: 'UK' },
  { re: /\ba[- ]?levels?\b|\bas[- ]level\b/i, system: 'a-level', label: 'A level' },
  { re: /\bib\b(?!m)|\binternational baccalaureate\b|\bib (?:hl|sl)\b/i, system: 'ib', label: 'IB Diploma' },
  { re: /\bap (?:calc(?:ulus)?|physics|chem(?:istry)?|bio(?:logy)?|stat(?:istic)?s?|computer science|csa)\b|\badvanced placement\b/i, system: 'ap', label: 'AP (College Board)', us: true, region: 'US' },
  { re: /\bsat\b(?! nav)/, system: 'sat', label: 'SAT', us: true, region: 'US' },
  { re: /\bact\b(?= (?:math|science|exam|test|prep))/i, system: 'act', label: 'ACT', us: true, region: 'US' },
  { re: /\bcommon core\b|\b(?:[6-9]|1[0-2])(?:th)? grade\b/i, system: 'common-core', label: 'US Common Core', us: true, region: 'US' },
  { re: /\bcbse\b|\bncert\b/i, system: 'cbse', label: 'CBSE (India)', region: 'India' },
  { re: /\bicse\b|\bisc\b/i, system: 'icse', label: 'ICSE (India)', region: 'India' },
  { re: /\bkcse\b|\bkcpe\b/i, system: 'kcse', label: 'KCSE (Kenya)', region: 'Kenya' },
  { re: /\bcape\b(?= )/i, system: 'cape', label: 'CAPE (Caribbean)', region: 'Caribbean' },
  { re: /\bcsec\b|\bcxc\b/i, system: 'csec', label: 'CSEC (Caribbean)', region: 'Caribbean' },
  { re: /\bmatric\b|\bnsc\b(?= )|\bcaps\b(?= )/i, system: 'matric', label: 'South African NSC (Matric)', region: 'South Africa' },
  { re: /\b[1-6]00\s?(?:L|level)\b|\bundergrad|\buniversity\b|\bdegree\b|\bcourse code\b|\b[A-Z]{3}\s?\d{3}\b/, system: 'university', label: 'University level' },
  { re: /\bcfa\b|\bacca\b|\bica[ne]\b|\bpmp\b|\bccna\b|\baws certified\b|\bcompTIA\b/i, system: 'professional', label: 'Professional certification' },
]

/** Nigerian class names (SS1-3, JSS1-3) imply the Nigerian senior secondary curriculum, unless an exam was named. */
const LEVEL_HINTS: { re: RegExp; system: System; label: string; region: string }[] = [
  { re: /\b(?:ss|sss|js|jss)\s?[1-3]\b/i, system: 'waec', label: 'Nigerian senior/junior secondary (WAEC/NECO style)', region: 'Nigeria' },
  { re: /\byear (?:7|8|9|10|11|12|13)\b|\bkey stage [34]\b/i, system: 'gcse', label: 'UK secondary (GCSE/A level style)', region: 'UK' },
  { re: /\bclass (?:9|10|11|12)\b|\bstd\.? (?:9|10)\b/i, system: 'cbse', label: 'Indian secondary (CBSE style)', region: 'India' },
  { re: /\bform [1-4]\b/i, system: 'kcse', label: 'East African secondary (KCSE style)', region: 'East Africa' },
  { re: /\bgrade (?:9|10|11|12)\b/i, system: 'common-core', label: 'Grade 9-12 (North American style)', region: 'North America' },
]

const CURRENCY: { re: RegExp; cur: string }[] = [
  { re: /₦|\bnaira\b|\bngn\b/i, cur: 'naira (₦)' },
  { re: /£|\bpounds? sterling\b|\bgbp\b/i, cur: 'pounds (£)' },
  { re: /€|\beuros?\b/i, cur: 'euros (€)' },
  { re: /₹|\brupees?\b|\binr\b/i, cur: 'rupees (₹)' },
  { re: /\bksh\b|\bkenyan shillings?\b/i, cur: 'Kenyan shillings (KSh)' },
  { re: /\bcedis?\b|₵/i, cur: 'cedis (₵)' },
  { re: /\brand\b|\bzar\b/i, cur: 'rand (R)' },
  { re: /\bus ?\$|\busd\b|\bdollars?\b/i, cur: 'dollars ($)' },
]

const firstHit = <T extends { re: RegExp }>(list: T[], text: string) => list.find(x => x.re.test(text)) ?? null

/**
 * Infer the curriculum. `goal` is the learner's own words (goal, goal text, subject); `taught` is the lesson digest
 * or the lesson's text; `profile` is the stored school system / level (weak fallback only).
 */
export function inferCurriculum(input: { goal?: string | null; taught?: string | null; profile?: { school_system?: string | null; level?: string | null } | null }): Curriculum {
  const goal = (input.goal ?? '').slice(0, 2000)
  const taught = (input.taught ?? '').slice(0, 20000)
  const prof = [input.profile?.school_system, input.profile?.level].filter(Boolean).join(' ')
  let system: System | null = null, label: string | null = null, source: Curriculum['source'] = 'none', region: string | null = null, us = false
  const take = (x: { system: System; label: string; us?: boolean; region?: string }, src: Curriculum['source']) => { system = x.system; label = x.label; us = !!x.us; region = x.region ?? null; source = src }
  const fromGoal = firstHit(SYSTEMS, goal) ?? firstHit(LEVEL_HINTS, goal)
  if (fromGoal) take(fromGoal, 'goal')
  else {
    const fromLesson = firstHit(SYSTEMS.filter(s => s.system !== 'university'), taught)
    if (fromLesson) take(fromLesson, 'lesson')
    else {
      const fromProfile = firstHit(SYSTEMS, prof) ?? firstHit(LEVEL_HINTS, prof)
      if (fromProfile) take(fromProfile, 'profile')
    }
  }
  // Currency only when the learner's own words or their lesson used one (never assumed from the system).
  const cur = firstHit(CURRENCY, goal) ?? firstHit(CURRENCY, taught)
  return { system, source, label, usUnits: us, currency: cur?.cur ?? null, region }
}

/** Prompt lines for an item writer: the curriculum's conventions, units, context and language. */
export function curriculumLines(c: Curriculum): string {
  const lines = [
    c.system && c.label ? `Curriculum: ${c.label} (${c.source === 'goal' ? 'named in the learner\'s own goal' : c.source === 'lesson' ? 'used in their lesson' : 'from their profile, a weak hint'}). Follow its notation, units and question conventions, but only as far as the lesson taught them.` : 'Curriculum: none named. Use internationally standard notation and conventions.',
    c.usUnits ? 'Units: the learner is on a US system; use the units their lesson used (US customary only where the lesson used them), SI otherwise.' : 'Units: SI only (metres, kilograms, seconds, newtons, joules, °C). No miles, feet, inches, pounds, gallons or °F unless the lesson used them.',
    c.currency ? `Money: only if the skill needs it, in ${c.currency} as their goal/lesson did.` : 'Money: avoid it unless the skill is about money; if needed, use a neutral "units of money" or the currency their lesson used.',
    'Context: everyday situations familiar anywhere (school, home, sport, phones, cooking, travel), or the learner\'s own interests and the lesson\'s examples. No culture-specific knowledge, local landmarks, holidays or slang the question does not teach. Names (if any) short and from varied cultures.',
    'Language: plain international English, short sentences (under 20 words), common words; only the technical terms the lesson used. One idea per sentence; no double negatives; no idioms.',
  ]
  return lines.join('\n')
}

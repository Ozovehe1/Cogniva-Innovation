/**
 * Privacy for the GLOBAL playbook (hard rule): it holds only abstract teaching rules — never a learner's text, answers or
 * personal data. Two layers of defence:
 *   1. scrubForReflection: what the reflector may see is anonymised first (learner-written fields dropped, identifiers
 *      redacted, long strings cut). Learner notes, typed answers and chat messages never reach it.
 *   2. privacyCheck: every bullet the reflector proposes (and every admin edit) is checked before it is stored; any hit
 *      rejects the bullet. Learner names/emails from the batch are passed in as `forbidden` (checked, never sent).
 * Pure functions (unit-tested by the `playbook` eval group).
 */

/** Keys whose values are written by learners (or identify them): never passed to the global reflector. */
const LEARNER_KEYS = /^(note|notes|question|query|answer|answers|typed|response_text|message|messages|msg|content_from_learner|learner_text|student_text|name|full_name|first_name|last_name|email|phone|student_id|user_id|profile_id|learner_id|owner_student_id|requested_by|session_id|chat_session_id|why_text|goal_text|interests|history|transcript|guardian_email|age|birthday|school)$/i

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g
const PHONE = /(?:\+?\d[\s-]?){7,}\d/g
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const URL = /\bhttps?:\/\/\S+/gi

export function redact(s: string): string {
  return s.replace(EMAIL, '[email]').replace(UUID, '[id]').replace(URL, '[link]').replace(PHONE, m => (m.replace(/\D/g, '').length >= 9 ? '[number]' : m))
}

/** Replace known learner names / emails (whole words, any case) with "[learner]" everywhere in a value. */
export function redactTerms(v: unknown, terms: string[], depth = 0): unknown {
  const ts = terms.map(t => t.trim()).filter(t => t.length >= 3)
  if (!ts.length || depth > 6) return v
  if (typeof v === 'string') return ts.reduce((s, t) => s.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'giu'), '$1[learner]'), v)
  if (Array.isArray(v)) return v.map(x => redactTerms(x, ts, depth + 1))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, redactTerms(x, ts, depth + 1)]))
  return v
}

/** Deep copy of a signal payload with learner-written fields removed and identifiers redacted. */
export function scrubForReflection(v: unknown, depth = 0): unknown {
  if (depth > 5) return null
  if (typeof v === 'string') return redact(v).slice(0, 300)
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v
  if (Array.isArray(v)) return v.slice(0, 12).map(x => scrubForReflection(x, depth + 1))
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (LEARNER_KEYS.test(k)) continue
      out[k] = scrubForReflection(x, depth + 1)
    }
    return out
  }
  return null
}

/** Phrases that tie a rule to one person instead of teaching in general. */
const PERSONAL = [
  /\b(this|that|the same|our|one) (learner|student|pupil|child|kid|user)\b(?! (who|whose|that|which)\b)/i,
  /\b(the )?(learner|student|pupil|user) (said|wrote|typed|answered|replied|told|asked|mentioned|reported)\b/i,
  /\b(he|she|they) (said|wrote|typed|answered|replied|told us|mentioned)\b/i,
  /\b(my|his|her) (name|teacher|school|mum|mom|dad|father|mother|class teacher|uncle|aunt)\b/i,
  /\b(Mr|Mrs|Ms|Miss|Dr|Prof|MR|MRS)\.? [A-Z][a-z]+/,
  /\b(named|called) [A-Z][a-z]+/,
  /\b\d{1,2}[- ]years?[- ]old\b/i,
  /\b(lives in|from the town of|attends) [A-Z][a-z]+/,
  /\b(student|learner|user|account) (id|#|number)\b/i,
]

export interface PrivacyResult { ok: boolean; problems: string[] }

/**
 * Is this text safe for the global playbook? `forbidden`: strings from the learners behind the batch (their names, emails,
 * the words they typed) that must not appear; also any run of 5+ consecutive words from a forbidden passage.
 */
export function privacyCheck(text: string, forbidden: string[] = []): PrivacyResult {
  const problems: string[] = []
  const t = text ?? ''
  if (new RegExp(EMAIL.source).test(t)) problems.push('contains an email address')
  if ((t.match(new RegExp(PHONE.source, 'g')) ?? []).some(m => m.replace(/\D/g, '').length >= 9)) problems.push('contains a phone-like number')
  if (new RegExp(UUID.source, 'i').test(t)) problems.push('contains an id')
  if (new RegExp(URL.source, 'i').test(t)) problems.push('contains a link')
  for (const re of PERSONAL) if (re.test(t)) problems.push(`personal framing: "${(t.match(re)?.[0] ?? '').slice(0, 40)}"`)
  // A long quotation is someone's words, not a rule.
  // (double quotes only, within one line: apostrophes in "Pythagoras' theorem" are not quotation marks)
  for (const m of t.matchAll(/["“”]([^"“”\n]{45,})["“”]/g)) problems.push(`long quotation: "${m[1].slice(0, 40)}…"`)
  const lower = t.toLowerCase()
  const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? []
  const tw = words(t).join(' ')
  for (const f of forbidden) {
    const s = (f ?? '').trim()
    if (!s) continue
    const fw = words(s)
    if (fw.length <= 4) {
      // names / emails / short answers: whole-word match (case-insensitive), at least 3 characters
      if (s.length >= 3 && new RegExp(`(^|[^a-z0-9])${s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(lower)) problems.push(`contains learner data ("${s.slice(0, 24)}")`)
      continue
    }
    for (let i = 0; i + 5 <= fw.length; i++) {
      const run = fw.slice(i, i + 5).join(' ')
      if (tw.includes(run)) { problems.push(`copies learner text ("${run.slice(0, 40)}")`); break }
    }
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)] }
}

/** All string leaves of an object (used to check a whole bullet: text, check, probes, hints, tags). */
export function stringsOf(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach(x => stringsOf(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach(x => stringsOf(x, out))
  return out
}

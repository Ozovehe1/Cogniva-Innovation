/**
 * Guardrails around every model call the agent makes (users are minors):
 *  - injection screen: heuristics always; Groq Llama Prompt Guard 2 when GROQ_API_KEY is set. A flagged
 *    message does not stop the chat, it drops the run to read-only + visual tools (no writes, no web).
 *  - web safety: a blocklist of adult, gambling, violent and self-harm terms and domains for search
 *    queries and results (SafeSearch is applied at the source where one exists).
 *  - untrusted text (retrieved memory, fetched pages, the learner's own words inside tool results) is
 *    wrapped as data, with instruction-like lines neutralised.
 * Distress screening is src/lib/safety.ts (detectDistress) and always runs first, before any of this.
 */
import { promptGuardScore } from './llm'

const INJECTION: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|earlier|all|your|the)\b.{0,30}\b(instructions?|rules?|prompts?|guidelines|messages?)\b/i,
  /\b(reveal|show|print|repeat|leak|tell me)\b.{0,40}\b(system|hidden|secret|initial|developer)\b.{0,20}\b(prompt|instructions?|message|rules)\b/i,
  /\byou are (now|no longer)\b|\bfrom now on,? you\b|\bact as (an? )?(unfiltered|unrestricted|jailbroken|evil|dan)\b/i,
  /\b(developer|god|admin|sudo|debug) mode\b|\bjail ?break\b|\bDAN\b/,
  /<\|?(im_start|im_end|system|endoftext)\|?>|\[\/?(INST|SYS)\]|<<SYS>>/i,
  /\b(call|use|run|invoke)\b.{0,30}\b(tool|function)\b.{0,60}\b(student_?id|another (student|user)|all (students|users)|delete|mark_mastered|guardian|consent)\b/i,
  /\b(student|user|profile|learner)[_ ]?id\b\s*[:=]?\s*["']?[0-9a-f-]{8,}/i,
  /\b(another|other|different) (student|learner|user)'?s?\b.{0,40}\b(answers?|data|records?|progress|chats?|memory)\b/i,
  /\bmark (me|this|it|the topic)? ?(as )?mastered\b|\bset (my )?mastery\b|\bskip the (mastery )?check\b/i,
  /\bnew instructions?:|\bsystem:\s|\bassistant:\s/i,
]

export interface InjectionVerdict { flagged: boolean; score: number | null; reasons: string[] }

/** Heuristic only (no network): used for fetched pages and retrieved text, and as the first layer for messages. */
export function injectionHeuristic(text: string): string[] {
  const t = text.slice(0, 6000)
  return INJECTION.filter(r => r.test(t)).map(r => r.source.slice(0, 40))
}

/** Full screen for a learner message: heuristics, then the Prompt Guard model when available. */
export async function screenInjection(text: string): Promise<InjectionVerdict> {
  const reasons = injectionHeuristic(text)
  const score = await promptGuardScore(text)
  if (score !== null && score >= 0.85) reasons.push(`prompt-guard ${score.toFixed(2)}`)
  return { flagged: reasons.length > 0, score, reasons }
}

/** Wrap untrusted text as data: instruction-looking lines are defanged and the block is labelled. */
export function asData(label: string, text: string, cap = 2500): string {
  const lines = text.slice(0, cap).split('\n').map(l => (injectionHeuristic(l).length ? `[removed: instruction-like text]` : l))
  return `<data source="${label.replace(/[^a-z0-9 _.:/-]/gi, '')}">\n${lines.join('\n').replace(/<\/?data[^>]*>/gi, '')}\n</data>`
}

/* ───────────── Child-safe web filtering ───────────── */

const BLOCK_TERMS = [
  'porn', 'porno', 'xxx', 'nsfw', 'nude', 'nudes', 'naked', 'sex video', 'sexy', 'hentai', 'onlyfans', 'escort', 'camgirl', 'erotic', 'fetish', 'strip club', 'hookup',
  'betting', 'bet9ja', 'sportybet', 'casino', 'gambling', 'slot machine', 'poker site',
  'how to make a bomb', 'make a bomb', 'build a bomb', 'pipe bomb', 'make meth', 'cook meth', 'buy drugs', 'buy weed', 'buy cocaine', 'buy a gun', 'ghost gun', '3d printed gun',
  'suicide method', 'how to kill myself', 'painless way to die', 'self harm method', 'how to cut myself', 'pro-ana', 'thinspo',
  'gore', 'beheading', 'execution video', 'snuff',
  'hack someone', 'hack instagram', 'hack whatsapp', 'steal password', 'carding', 'yahoo yahoo', 'fake bank alert', 'money ritual',
]
const BLOCK_DOMAINS = ['pornhub', 'xvideos', 'xnxx', 'xhamster', 'onlyfans', 'redtube', 'youporn', 'chaturbate', 'bet9ja', 'sportybet', '1xbet', 'betway', 'nairabet', 'stake.com', '4chan', 'kiwifarms', 'liveleak', 'bestgore']

export function unsafeQuery(q: string): string | null {
  const t = ` ${q.toLowerCase().replace(/[^a-z0-9.\s-]/g, ' ').replace(/\s+/g, ' ')} `
  const hit = BLOCK_TERMS.find(w => t.includes(` ${w} `) || t.includes(` ${w}s `)) ?? BLOCK_DOMAINS.find(d => t.includes(d))
  return hit ?? null
}
export function blockedUrl(url: string): boolean {
  try { const h = new URL(url).hostname.toLowerCase(); return BLOCK_DOMAINS.some(d => h.includes(d)) } catch { return true }
}
/** Result text that is not suitable to show a minor (applied to titles and snippets). */
export function unsafeText(s: string): boolean {
  return !!unsafeQuery(s.slice(0, 3000))
}

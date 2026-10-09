/**
 * Token-lean prompt helpers for the LLM pool. Server only.
 * HARD RULE: these only reshape ONE learner's own conversation; nothing is cached or shared across learners.
 */
import type { Msg } from './llm'
export { withLlmContext } from './pool'

/**
 * Keep the last `keepLast` messages verbatim and fold older ones into a single short note (first sentence of each
 * learner turn and tutor reply), so long chats cost a bounded number of tokens on every turn. Deterministic: no
 * model call (a summariser call would cost more than it saves on the free tier).
 */
export function compactHistory(history: Msg[], opts: { keepLast?: number; maxChars?: number } = {}): { messages: Msg[]; savedChars: number } {
  const keepLast = opts.keepLast ?? 4
  const maxChars = opts.maxChars ?? 4200
  const before = history.reduce((a, m) => a + m.content.length, 0)
  let start = Math.max(0, history.length - keepLast)
  // Start the verbatim tail on a learner turn so roles alternate cleanly.
  while (start > 0 && history[start]?.role !== 'user') start--
  const tail = history.slice(start)
  const old = history.slice(0, start)
  const first = (s: string) => (/^[\s\S]*?[.?!](\s|$)/.exec(s.trim())?.[0] ?? s).trim().slice(0, 140)
  const note = old.length ? old.map(m => `${m.role === 'user' ? 'Learner' : 'Tutor'}: ${first(m.content)}`).join(' | ').slice(0, 900) : ''
  const messages: Msg[] = [...(note ? [{ role: 'system' as const, content: `Earlier in this chat (shortened): ${note}` }] : []), ...tail]
  // Still too long: trim the oldest verbatim messages, never the last one.
  let total = messages.reduce((a, m) => a + m.content.length, 0)
  for (let i = note ? 1 : 0; total > maxChars && i < messages.length - 1; i++) {
    const cut = Math.min(messages[i].content.length - 300, total - maxChars)
    if (cut > 0) { messages[i] = { ...messages[i], content: messages[i].content.slice(0, messages[i].content.length - cut) + ' …' }; total -= cut }
  }
  return { messages, savedChars: Math.max(0, before - total) }
}

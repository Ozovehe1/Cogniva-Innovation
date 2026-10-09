/**
 * Eval cases for the LLM pool (group "pool" in /api/agent/eval). Pure checks run on a private MemoryStore and never
 * touch the live pool state; the smoke cases make one tiny real call and read the shared health table.
 * The load test with mocked providers (many concurrent learners, real limits) is scripts/llm-pool-loadtest.mjs.
 */
import type { CaseResult } from './eval'
import { chat, trimRequest, type Msg } from './llm'
import { compactHistory } from './pool-prompt'
import { MemoryStore, classify, dayCapFor, discoverKeys, inventory, poolHealth, quality, type SlotDef } from './pool'

const G = 'pool'
function c(id: string, pass: boolean, detail: string, ms?: number): CaseResult { return { id, group: G, pass, detail, ms } }

export async function poolCases(opts: { smoke?: boolean } = {}): Promise<CaseResult[]> {
  const out: CaseResult[] = []

  // Keys: any number, gaps allowed, duplicates dropped, blanks ignored.
  const keys = discoverKeys('GEMINI_API_KEY', { GEMINI_API_KEY: 'a', GEMINI_API_KEY_2: 'b', GEMINI_API_KEY_5: 'c', GEMINI_API_KEY_12: 'a', GEMINI_API_KEY_7: ' ', GEMINI_API_KEY_X: 'd' })
  out.push(c('pool-keys-any-n', keys.map(k => k.n).join(',') === '1,2,5', `found ${keys.map(k => k.env).join(', ')}`))

  // Live inventory of this deployment (no key values).
  const inv = inventory()
  const groq = new Set(inv.filter(s => s.provider === 'groq').map(s => s.keyEnv)), gem = new Set(inv.filter(s => s.provider === 'gemini').map(s => s.keyEnv))
  out.push(c('pool-inventory', inv.length > 0 && gem.size > 0, `${groq.size} Groq keys (${[...groq].join(', ')}), ${gem.size} Gemini keys (${[...gem].join(', ')}), ${inv.length} slots`))

  // Quality routing: tutor chat prefers the strong Groq models; lesson content never goes to Groq; built-in tools only gpt-oss.
  const fake = (provider: 'groq' | 'gemini', model: string) => ({ provider, model }) as Pick<SlotDef, 'provider' | 'model'>
  const okQ = quality('chat', fake('groq', 'qwen/qwen3.8-27b')) > quality('chat', fake('gemini', 'gemini-3.5-flash-lite'))
    && quality('lesson', fake('groq', 'openai/gpt-oss-120b')) === 0 && quality('builtin', fake('gemini', 'gemini-3.8-flash')) === 0
    && quality('light', fake('groq', 'openai/gpt-oss-20b')) === 1
  out.push(c('pool-quality-routing', okQ, 'chat: qwen > flash-lite; lesson: Gemini only; built-ins: gpt-oss only; light: gpt-oss-20b first'))

  // Background pacing: right after the provider's reset background may use little; live always all of it.
  const slot = { resetTz: 'UTC' } as SlotDef
  const early = dayCapFor('background', slot, Date.parse('2026-10-09T00:30:00Z')), late = dayCapFor('background', slot, Date.parse('2026-10-09T23:30:00Z'))
  out.push(c('pool-bg-pacing', early < 0.2 && late > early && dayCapFor('live', slot) === 1, `background cap ${early.toFixed(2)} after reset → ${late.toFixed(2)} before the next; live 1`))

  // Fair share is keyed by learner id: learner A using up their minute share does not block learner B.
  const ms = new MemoryStore()
  const limits = { rpm: 1000, rpd: 1e6, tpm: 1e9, tpd: 1e9 }
  let a = 0
  while (await ms.take({ slot: 's', tokens: 5000, limits, day: 'd', dayCap: 1, user: 'learner-a', userTpm: 20_000 })) a++
  const b = await ms.take({ slot: 's', tokens: 5000, limits, day: 'd', dayCap: 1, user: 'learner-b', userTpm: 20_000 })
  out.push(c('pool-fair-share-per-learner', a === 4 && b, `learner A got ${a} calls this minute, then learner B still got one: ${b}`))

  // Error classes drive cooldowns: 429 with retry hint, daily quota, missing model, timeout.
  const k1 = classify(new Error('Groq 429: Rate limit reached ... Please try again in 7.5s')), k2 = classify(new Error('429 RESOURCE_EXHAUSTED GenerateRequestsPerDayPerProjectPerModel')), k3 = classify(new Error('404 NOT_FOUND model')), k4 = classify(new Error('timed out waiting 14 s for the first token'))
  out.push(c('pool-error-classes', k1.kind === 'quota' && (k1.cooldownMs ?? 0) < 10_000 && k2.kind === 'quota' && (k2.cooldownMs ?? 0) >= 600_000 && k3.kind === 'missing' && k4.kind === 'timeout', `${k1.kind}/${k1.cooldownMs} ${k2.kind}/${k2.cooldownMs} ${k3.kind} ${k4.kind}`))

  // History compaction and the trimmed rung: bounded size, last learner turn kept verbatim.
  const hist: Msg[] = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Turn ${i}. ` + 'word '.repeat(220) }) as Msg)
  const comp = compactHistory(hist, { keepLast: 4, maxChars: 4200 })
  const total = comp.messages.reduce((x, m) => x + m.content.length, 0)
  out.push(c('pool-history-compaction', total <= 4300 && comp.messages[comp.messages.length - 1].content === hist[9].content && comp.savedChars > 0, `${hist.reduce((x, m) => x + m.content.length, 0)} → ${total} chars`))
  const big = { purpose: 'chat' as const, maxTokens: 1000, messages: [{ role: 'system' as const, content: 'S' }, ...hist] }
  const tr = trimRequest(big)
  out.push(c('pool-trim-rung', tr.messages.length < big.messages.length && (tr.maxTokens ?? 0) === 600 && tr.messages[0].content === 'S', `${big.messages.length} → ${tr.messages.length} messages, max_tokens 1000 → ${tr.maxTokens}`))

  if (opts.smoke !== false) {
    // One tiny real call through the pool (light purpose) and the shared health view.
    const t0 = Date.now()
    try {
      const r = await chat({ purpose: 'light', priority: 'background', maxTokens: 20, temperature: 0, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] })
      out.push(c('pool-smoke-call', /ready/i.test(r.text), `${r.slot} answered "${r.text.trim().slice(0, 30)}" (${r.usage.input}+${r.usage.output} tokens${r.usage.cached ? `, ${r.usage.cached} cached` : ''})`, Date.now() - t0))
    } catch (err) {
      // Background may be deferred under pressure: that is the pool working, not a failure.
      const deferred = err instanceof Error && /deferred/i.test(err.message)
      out.push(c('pool-smoke-call', deferred, err instanceof Error ? err.message.slice(0, 200) : String(err), Date.now() - t0))
    }
    try {
      const h = await poolHealth()
      out.push(c('pool-health', h.slots.length === inv.length && h.reserve.wanted >= 2, `${h.slots.filter(s => s.state === 'healthy').length}/${h.slots.length} healthy; reserve chat ${h.reserve.chat.length}, lesson ${h.reserve.lesson.length}; live RPM free ${h.capacity.liveRpmNow}`))
    } catch (err) { out.push(c('pool-health', false, err instanceof Error ? err.message : String(err))) }
  }
  return out
}

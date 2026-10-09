/**
 * The playbook's model calls: background priority (the shared LLM pool sheds/defers background work to keep capacity
 * for learners — live lesson > Ask > background), cheap models first. Server only.
 */
import { chat, parseJsonLoose, type Purpose } from '../agent/llm'
import { llmContext } from '../agent/pool'

/** Pool priority: background unless a caller (the eval route) set one with withLlmContext. */
const prio = () => ({ priority: llmContext().priority ?? ('background' as const) })

export async function pbJson(prompt: string, opts: { system?: string; purpose?: Purpose; maxTokens?: number; deadline?: number; trace?: string[]; temperature?: number } = {}): Promise<{ json: unknown; model: string }> {
  const messages = [...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []), { role: 'user' as const, content: prompt }]
  const ask = (extra: { role: 'user' | 'assistant'; content: string }[] = []) => chat({ purpose: opts.purpose ?? 'light', json: true, maxTokens: opts.maxTokens ?? 2000, temperature: opts.temperature ?? 0.3, trace: opts.trace, deadline: opts.deadline, messages: [...messages, ...extra], priority: prio().priority })
  const r = await ask()
  try { return { json: parseJsonLoose(r.text), model: r.model } } catch (err) {
    const r2 = await ask([{ role: 'assistant', content: r.text.slice(0, 4000) }, { role: 'user', content: `That was not valid JSON (${err instanceof Error ? err.message : 'parse error'}). Reply with the complete valid JSON only.` }])
    return { json: parseJsonLoose(r2.text), model: r2.model }
  }
}

export async function pbText(system: string, user: string, opts: { purpose?: Purpose; maxTokens?: number; deadline?: number; trace?: string[] } = {}): Promise<{ text: string; model: string }> {
  const r = await chat({ purpose: opts.purpose ?? 'chat', maxTokens: opts.maxTokens ?? 900, temperature: 0.5, trace: opts.trace, deadline: opts.deadline, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], priority: prio().priority })
  return { text: r.text, model: r.model }
}

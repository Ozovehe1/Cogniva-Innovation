import { NextResponse } from 'next/server'
import { renderTokenMatches } from '@/lib/manim'
import { AllModelsBusyError, chat, visionText } from '@/lib/agent/llm'
import { generateText } from '@/lib/gemini'
import { withLlmContext, type Priority } from '@/lib/agent/pool'

// Composer/critic calls from the render service can take a minute each on the free tier.
export const maxDuration = 300

/**
 * POST /api/llm/pool — the shared LLM pool for the Modal render service (modal_app/gm_llm.py), so animation work draws on
 * the same keys, budgets and learner-reserved slots as the rest of the app instead of calling Groq/Gemini on its own.
 * Header X-Render-Token must equal RENDER_TOKEN.
 * Body: { mode: 'chat' (Groq-first chain, Gemini fallback) | 'gemini' (Gemini only), prompt, system?, json_out?,
 *         temperature?, max_tokens?, images?: base64 JPEG/PNG list (gemini mode), priority?: 'ask' | 'background' }
 * Answer: { text, model, log } — or 503 { error, retry_after_ms } when every slot is busy (the caller falls back).
 */
export async function POST(request: Request) {
  if (!renderTokenMatches(request.headers.get('x-render-token'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await request.json().catch(() => ({})) as Record<string, unknown>
  const prompt = typeof b.prompt === 'string' ? b.prompt : ''
  if (!prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  const system = typeof b.system === 'string' && b.system ? b.system : undefined
  const json = b.json_out === true
  const temperature = typeof b.temperature === 'number' ? b.temperature : undefined
  const maxTokens = typeof b.max_tokens === 'number' ? Math.min(8000, Math.max(200, b.max_tokens)) : undefined
  const priority: Priority = b.priority === 'background' ? 'background' : 'ask'
  const images = Array.isArray(b.images) ? b.images.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, 8) : []
  const log: string[] = []
  const deadline = Date.now() + 240_000
  try {
    return await withLlmContext({ priority, label: 'manim' }, async () => {
      if (images.length) {
        const mime = (d: string) => (d.startsWith('iVBOR') ? 'image/png' : 'image/jpeg')
        const r = await visionText(system ? `${system}\n\n${prompt}` : prompt, images.map(d => ({ data: d, mime: mime(d) })), { json, maxTokens, temperature, deadline, trace: log, priority })
        return NextResponse.json({ text: r.text, model: r.model, log })
      }
      if (b.mode === 'gemini') {
        let model = ''
        const text = await generateText(prompt, { json, systemInstruction: system, temperature, timeoutMs: 90_000, deadline, trace: log, priority, onModel: m => { model = m } })
        return NextResponse.json({ text, model, log })
      }
      const r = await chat({
        purpose: 'json', json, maxTokens, temperature, deadline, trace: log, priority,
        messages: [...(system ? [{ role: 'system' as const, content: system }] : []), { role: 'user' as const, content: prompt }],
      })
      return NextResponse.json({ text: r.text, model: r.model, provider: r.provider, log })
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const retry = err instanceof AllModelsBusyError ? (err as unknown as { retryAfterMs?: number }).retryAfterMs ?? null : null
    return NextResponse.json({ error: msg.slice(0, 300), retry_after_ms: retry, log: log.slice(-12) }, { status: 503 })
  }
}

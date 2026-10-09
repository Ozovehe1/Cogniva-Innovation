/**
 * Lesson boards: the step writer may ask for {"type":"illustration","query",x,y,w,h,say?}. Before the script is
 * validated, each one is replaced by a credited library figure (a draw/figure step referencing the cached SVG by URL),
 * fitted inside its box. Nothing found: the step becomes a short pause (its narration kept as a note is not
 * possible without a drawing, so it is dropped and the rest of the script still validates).
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { findIllustration } from './find'

const MAX_PER_ANSWER = 2

export async function resolveIllustrationSteps(raw: unknown, trace?: string[]): Promise<unknown> {
  const o = raw as { steps?: unknown[] } | null
  if (!o || !Array.isArray(o.steps) || !o.steps.some(s => (s as { type?: string })?.type === 'illustration')) return raw
  let admin: ReturnType<typeof createAdminClient> | null = null
  try { admin = createAdminClient() } catch { admin = null }
  let used = 0
  const steps = await Promise.all(o.steps.map(async (st) => {
    const s = st as Record<string, unknown>
    if (s?.type !== 'illustration') return st
    const query = typeof s.query === 'string' ? s.query.trim().slice(0, 80) : ''
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
    const box = { x: num(s.x, 24), y: num(s.y, 100), w: Math.max(60, num(s.w, 416)), h: Math.max(60, num(s.h, 376)) }
    const say = typeof s.say === 'string' ? s.say : undefined
    if (!query || ++used > MAX_PER_ANSWER) return { type: 'pause', ms: 300 }
    try {
      const f = await Promise.race([findIllustration({ topic: query }, admin, trace), new Promise<null>(r => setTimeout(() => r(null), 12_000))])
      if (!f || !f.url) { trace?.push(`illustration "${query}": nothing usable`); return say ? { type: 'pause', ms: 400 } : { type: 'pause', ms: 200 } }
      const k = Math.min(box.w / f.width, box.h / f.height)
      const w = Math.round(f.width * k), h = Math.round(f.height * k)
      return {
        type: 'draw', ...(typeof s.id === 'string' ? { id: s.id } : {}), ...(say ? { say } : {}),
        ...(s.at !== undefined ? { at: s.at } : {}), ...(s.until !== undefined ? { until: s.until } : {}),
        shape: { kind: 'figure', x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + (box.h - h) / 2), w, h, svg: '', src: f.url, alt: `${f.alt}. Credit: ${f.creditText}`.slice(0, 300) },
      }
    } catch (err) {
      trace?.push(`illustration "${query}" failed: ${err instanceof Error ? err.message.slice(0, 80) : err}`)
      return { type: 'pause', ms: 200 }
    }
  }))
  return { ...o, steps }
}

/**
 * Wake the two Modal services that scale to zero, ahead of need (server only):
 *  - the Kokoro narration voice (geniusmap-tts), so the first lesson's lines are voiced at once;
 *  - the Manim render container (geniusmap-manim), so the lesson's animation starts rendering at once.
 * Called when a new learner starts the intake, when the diagnostic starts and while it runs, and
 * when the first lesson is drafted ahead. Fire-and-forget, throttled per server instance.
 */
import { warmTts } from './tts-server'

let lastTts = 0
let lastManim = 0

/** Spawns a no-op render (job id "__warm__") so a render container boots; the web endpoint answers at once. */
export function warmManim() {
  const base = process.env.MODAL_RENDER_URL?.trim().replace(/\/+$/, '')
  const token = process.env.RENDER_TOKEN
  if (!base || !token) return
  void fetch(`${base}/warm`, { method: 'POST', headers: { 'X-Render-Token': token }, cache: 'no-store', signal: AbortSignal.timeout(15_000) }).catch(() => {})
}

/** Wake both services; at most once per `everyMs` per instance (the TTS container stays up 5 min after its last request). */
export function warmServices(opts: { manim?: boolean; everyMs?: number } = {}) {
  const every = opts.everyMs ?? 60_000
  const now = Date.now()
  if (now - lastTts > every) { lastTts = now; warmTts() }
  if (opts.manim !== false && now - lastManim > every) { lastManim = now; warmManim() }
}

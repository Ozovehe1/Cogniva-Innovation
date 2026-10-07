/**
 * Server side of the narration voice: synthesizes lines with the Kokoro app on
 * Modal (modal_app/tts.py) and caches them in the public `lesson-audio` bucket,
 * content-addressed by text + voice (see lib/narration). Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from './supabase/admin'
import { AUDIO_BUCKET, MAX_TTS_CHARS, NARRATION_SPEED, NARRATION_VOICE, audioPaths, audioPublicBase, narrationKey, normalizeSpoken, type NarrationClip, type WordTiming } from './narration'
import type { Step } from './lesson-schema'
import { stepSpeech } from '@/components/whiteboard/speech'

/** Kokoro web endpoint. MODAL_TTS_URL, or derived from the Manim render URL (same Modal workspace). */
export function ttsUrl(): string | null {
  const explicit = process.env.MODAL_TTS_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, '')
  const render = process.env.MODAL_RENDER_URL?.trim()
  if (render && /geniusmap-manim-render/.test(render)) return render.replace('geniusmap-manim-render', 'geniusmap-tts').replace(/\/$/, '')
  return null
}

/** Wake the voice container (cold start ~20 s) while something else is being prepared. */
export function warmTts() {
  const url = ttsUrl()
  if (url) void fetch(`${url}/health`, { cache: 'no-store' }).catch(() => {})
}

/** Every distinct spoken line in a script, including pre-written re-teach steps. */
export function scriptLines(steps: Step[]): string[] {
  const out = new Set<string>()
  const add = (s: Step) => {
    const t = normalizeSpoken(stepSpeech(s))
    if (t) out.add(t.slice(0, MAX_TTS_CHARS))
  }
  for (const s of steps) {
    add(s)
    if (s.type === 'check' && s.reteach) s.reteach.forEach(add)
  }
  return [...out]
}

async function cachedClip(text: string): Promise<NarrationClip | null> {
  const key = await narrationKey(text)
  const base = audioPublicBase()
  const p = audioPaths(key)
  const res = await fetch(`${base}/${p.json}`, { cache: 'no-store' }).catch(() => null)
  if (!res?.ok) return null
  const j = await res.json().catch(() => null) as { ms?: number; words?: WordTiming[] } | null
  if (!j || typeof j.ms !== 'number' || !Array.isArray(j.words)) return null
  return { key, url: `${base}/${p.mp3}`, ms: j.ms, words: j.words }
}

interface SynthClip { audio?: string; ms?: number; words?: WordTiming[]; error?: string }

async function synthBatch(texts: string[], timeoutMs: number): Promise<SynthClip[]> {
  const url = ttsUrl()
  const token = process.env.RENDER_TOKEN
  if (!url || !token) throw new Error('Narration voice is not configured (MODAL_TTS_URL / RENDER_TOKEN).')
  const res = await fetch(`${url}/synth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Render-Token': token },
    body: JSON.stringify({ texts, voice: NARRATION_VOICE, speed: NARRATION_SPEED }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`Voice service returned ${res.status}`)
  const j = await res.json() as { clips?: SynthClip[] }
  return j.clips ?? []
}

async function store(admin: SupabaseClient, text: string, clip: SynthClip): Promise<NarrationClip | null> {
  if (!clip.audio || typeof clip.ms !== 'number' || !Array.isArray(clip.words)) return null
  const key = await narrationKey(text)
  const p = audioPaths(key)
  const mp3 = Buffer.from(clip.audio, 'base64')
  const meta = { ms: clip.ms, words: clip.words, voice: NARRATION_VOICE }
  const up1 = await admin.storage.from(AUDIO_BUCKET).upload(p.mp3, mp3, { contentType: 'audio/mpeg', upsert: true, cacheControl: '31536000' })
  if (up1.error) throw new Error(`audio upload failed: ${up1.error.message}`)
  // The JSON is written last: its presence means the line is fully cached.
  const up2 = await admin.storage.from(AUDIO_BUCKET).upload(p.json, Buffer.from(JSON.stringify(meta)), { contentType: 'application/json', upsert: true, cacheControl: '31536000' })
  if (up2.error) throw new Error(`timing upload failed: ${up2.error.message}`)
  await admin.from('narration_audio').upsert({ key, voice: NARRATION_VOICE, text, audio_path: p.mp3, ms: clip.ms, words: clip.words })
  return { key, url: `${audioPublicBase()}/${p.mp3}`, ms: clip.ms, words: clip.words }
}

/**
 * Cached clips for `texts` (in order), synthesizing and storing the missing ones.
 * Returns the clips (null where synthesis failed) and how many were newly made.
 */
export async function ensureNarration(texts: string[], opts: { timeoutMs?: number; batch?: number; cacheOnly?: boolean } = {}): Promise<{ clips: (NarrationClip | null)[]; synthesized: number; chars: number }> {
  const lines = texts.map(t => normalizeSpoken(t).slice(0, MAX_TTS_CHARS))
  const clips: (NarrationClip | null)[] = await Promise.all(lines.map(t => (t ? cachedClip(t) : Promise.resolve(null))))
  const missing = lines.map((t, i) => ({ t, i })).filter(x => x.t && !clips[x.i])
  if (!missing.length || opts.cacheOnly) return { clips, synthesized: 0, chars: 0 }
  const admin = createAdminClient()
  const size = Math.max(1, opts.batch ?? 6)
  let synthesized = 0, chars = 0
  for (let k = 0; k < missing.length; k += size) {
    const part = missing.slice(k, k + size)
    const out = await synthBatch(part.map(x => x.t), opts.timeoutMs ?? 120_000)
    for (const [j, x] of part.entries()) {
      try {
        const c = await store(admin, x.t, out[j] ?? {})
        clips[x.i] = c
        if (c) { synthesized++; chars += x.t.length }
      } catch (err) {
        console.warn('Narration store failed:', err instanceof Error ? err.message : err)
      }
    }
  }
  return { clips, synthesized, chars }
}

/**
 * Pre-generate narration for a script within a time budget (approval, drafted
 * sections). Lines already cached cost one storage lookup. Never throws.
 */
export async function pregenerateNarration(steps: Step[], budgetMs = 240_000): Promise<{ lines: number; synthesized: number; done: boolean }> {
  const t0 = Date.now()
  const lines = scriptLines(steps)
  let synthesized = 0
  try {
    for (let k = 0; k < lines.length; k += 6) {
      if (Date.now() - t0 > budgetMs) return { lines: lines.length, synthesized, done: false }
      const r = await ensureNarration(lines.slice(k, k + 6), { timeoutMs: Math.max(30_000, Math.min(120_000, budgetMs - (Date.now() - t0))) })
      synthesized += r.synthesized
    }
  } catch (err) {
    console.warn('Narration pre-generation stopped:', err instanceof Error ? err.message : err)
    return { lines: lines.length, synthesized, done: false }
  }
  return { lines: lines.length, synthesized, done: true }
}

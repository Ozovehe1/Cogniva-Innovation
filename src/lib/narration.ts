/**
 * Narration audio shared by the server (synthesis + cache) and the browser
 * (playback). Every spoken line is content-addressed: its key is a hash of the
 * engine, voice, speed and exact text, so an unchanged step reuses its audio and
 * any client can find the cached files without asking the server:
 *
 *   {SUPABASE_URL}/storage/v1/object/public/lesson-audio/{voice}/{key}.mp3   audio
 *   {SUPABASE_URL}/storage/v1/object/public/lesson-audio/{voice}/{key}.json  { ms, words }
 *
 * Pure: safe on the server and in the browser.
 */

export const TTS_ENGINE = 'kokoro-82m-v1'
/** Kokoro's warmest, most natural English voice (American English, female; rated A by the model card). */
export const NARRATION_VOICE = 'af_heart'
export const NARRATION_SPEED = 1
export const AUDIO_BUCKET = 'lesson-audio'
/** Longest single line sent to the voice (narration lines are a sentence or two). */
export const MAX_TTS_CHARS = 1200

/** One spoken word: its text and when it is spoken, in ms from the start of the clip. */
export interface WordTiming { w: string; s: number; e: number }

export interface NarrationTiming {
  /** Total clip length in ms. */
  ms: number
  /** One entry per whitespace-separated word of the spoken text. */
  words: WordTiming[]
}

export interface NarrationClip extends NarrationTiming {
  key: string
  url: string
}

async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Normalise whitespace so trivially different copies of a line share audio. */
export function normalizeSpoken(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

export async function narrationKey(text: string, voice = NARRATION_VOICE, speed = NARRATION_SPEED): Promise<string> {
  return (await sha256Hex(`${TTS_ENGINE}|${voice}|${speed}|${normalizeSpoken(text)}`)).slice(0, 40)
}

export function audioPublicBase(supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''): string {
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${AUDIO_BUCKET}`
}

export function audioPaths(key: string, voice = NARRATION_VOICE) {
  return { mp3: `${voice}/${key}.mp3`, json: `${voice}/${key}.json` }
}

/** Average speaking pace of the voice, used when no real timings exist (browser speech, voice off). */
const MS_PER_CHAR = 62
const LEAD_MS = 250

/**
 * Estimated word timings: words take time in proportion to their length, with a
 * little extra at commas and full stops. Close enough to keep motion in step with
 * a device voice, and it gives silent playback (voice off) a natural pace.
 */
export function estimateTimings(text: string): NarrationTiming {
  const words = normalizeSpoken(text).split(' ').filter(Boolean)
  const out: WordTiming[] = []
  let t = LEAD_MS
  for (const w of words) {
    const len = Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, '').length + 1)
    const d = len * MS_PER_CHAR + 40
    out.push({ w, s: Math.round(t), e: Math.round(t + d) })
    t += d
    if (/[.!?:;]$/.test(w)) t += 330
    else if (/[,—–-]$/.test(w)) t += 160
  }
  return { ms: Math.round(t + 200), words: out }
}

/** Scale estimated timings so they end at `ms` (e.g. once the real length of a clip is known). */
export function stretchTimings(t: NarrationTiming, ms: number): NarrationTiming {
  if (!t.ms || !ms) return t
  const k = ms / t.ms
  return { ms, words: t.words.map(w => ({ w: w.w, s: Math.round(w.s * k), e: Math.round(w.e * k) })) }
}

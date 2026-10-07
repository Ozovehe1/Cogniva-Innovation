/**
 * Voice narration for the whiteboard player.
 *
 * The player only talks to the `Narrator` interface. The default narrator plays
 * natural Kokoro audio (pre-generated and cached per line, or synthesized on
 * demand) and falls back to the device's speech engine when no audio is
 * available. Audio comes with word timings, which drive the animation clock.
 */
import { MAX_TTS_CHARS, NARRATION_VOICE, audioPaths, audioPublicBase, narrationKey, normalizeSpoken, type NarrationClip, type NarrationTiming } from '@/lib/narration'

export interface Narrator {
  /** False when this device cannot speak at all. */
  readonly supported: boolean
  /** Call inside a user gesture (a tap on Play). Mobile browsers refuse speech until then. */
  unlock(): void
  /** Speak `text`, replacing anything already playing. `onEnd` fires once, when it finishes or is cancelled. */
  speak(text: string, onEnd: () => void): void
  pause(): void
  resume(): void
  /** Stop and drop the current utterance (its onEnd still fires). */
  cancel(): void
  /** Get the real audio for `text` ready; resolves its word timings, or null when only the device voice is available. */
  prepare?(text: string, timeoutMs?: number): Promise<NarrationTiming | null>
  /** Start fetching audio for upcoming lines. */
  preload?(texts: string[]): void
  /** ms into the line being spoken, or -1 when unknown (device voice). */
  position?(): number
  /** What spoke the last line: natural audio or the device voice. */
  readonly source?: 'audio' | 'device' | null
  /** Why the last line fell back to the device voice (only set after a real failure). */
  readonly fallbackReason?: string | null
  /** Wake the natural voice service (it scales to zero when idle). */
  warm?(): void
}

/**
 * How long the narrator waits for natural audio before it gives up and uses the
 * device voice. Generous on purpose: a cold voice container takes ~20-40 s, and a
 * robotic first line is worse than a short "Preparing voice" pause.
 */
export const NATURAL_VOICE_WAIT_MS = 45_000

const PREFERRED_VOICES = [
  /Google UK English Female/i,
  /Microsoft (Sonia|Libby|Aria|Jenny|Guy|Ryan) Online \(Natural\)/i,
  /\(Natural\)/i,
  /^Samantha$/i,
  /^Daniel$/i,
  /^Karen$/i,
  /^Moira$/i,
  /Google US English/i,
  /Google UK English Male/i,
  /enhanced|premium/i,
]

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter(v => /^en([-_]|$)/i.test(v.lang))
  if (!en.length) return null
  for (const re of PREFERRED_VOICES) {
    const v = en.find(x => re.test(x.name))
    if (v) return v
  }
  // Prefer an on-device default English voice, then any English voice.
  return en.find(v => v.default) ?? en.find(v => v.localService) ?? en[0]
}

/** Split into sentence-sized chunks: Chrome cuts off utterances longer than ~15s. */
export function chunkText(text: string): string[] {
  const parts = text.match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [text]
  const out: string[] = []
  for (const p of parts.map(s => s.trim()).filter(Boolean)) {
    if (out.length && (out[out.length - 1].length + p.length < 120)) out[out.length - 1] += ' ' + p
    else out.push(p)
  }
  return out
}

class WebSpeechNarrator implements Narrator {
  readonly supported: boolean
  private synth: SpeechSynthesis | null
  private voice: SpeechSynthesisVoice | null = null
  private chunks: string[] = []
  private at = 0
  private onEnd: (() => void) | null = null
  private paused = false
  private token = 0

  constructor() {
    this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
    this.supported = !!this.synth && typeof SpeechSynthesisUtterance !== 'undefined'
    if (this.synth) {
      const load = () => { this.voice = pickVoice(this.synth!.getVoices()) }
      load()
      this.synth.addEventListener?.('voiceschanged', load)
    }
  }

  unlock() {
    if (!this.synth) return
    try {
      // A silent utterance inside the gesture unlocks speech on mobile Chrome / iOS Safari.
      const u = new SpeechSynthesisUtterance(' ')
      u.volume = 0
      this.synth.speak(u)
      this.synth.resume()
    } catch { /* ignore */ }
  }

  speak(text: string, onEnd: () => void) {
    this.cancel()
    if (!this.synth || !text.trim()) { onEnd(); return }
    this.chunks = chunkText(text)
    this.at = 0
    this.onEnd = onEnd
    this.paused = false
    this.play()
  }

  private play() {
    const synth = this.synth
    if (!synth) return
    const token = ++this.token
    const chunk = this.chunks[this.at]
    if (chunk === undefined) { this.finish(); return }
    const u = new SpeechSynthesisUtterance(chunk)
    if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang } else u.lang = 'en-GB'
    u.rate = 0.98
    u.pitch = 1
    const next = () => {
      if (token !== this.token || this.paused) return
      this.at++
      this.play()
    }
    u.onend = next
    u.onerror = e => {
      if (token !== this.token) return
      // 'interrupted'/'canceled' come from our own cancel(); anything else skips the chunk.
      if (e.error === 'interrupted' || e.error === 'canceled') return
      next()
    }
    synth.speak(u)
  }

  private finish() {
    const cb = this.onEnd
    this.onEnd = null
    this.chunks = []
    cb?.()
  }

  pause() {
    if (!this.synth || !this.onEnd || this.paused) return
    // Pause by cancelling and replaying the current sentence on resume: speechSynthesis.pause()
    // is unreliable on Android Chrome.
    this.paused = true
    this.token++
    this.synth.cancel()
  }

  resume() {
    if (!this.synth || !this.paused) return
    this.paused = false
    if (this.onEnd) this.play()
  }

  cancel() {
    this.token++
    this.paused = false
    if (this.synth && (this.synth.speaking || this.synth.pending)) this.synth.cancel()
    this.finish()
  }
}

/* ───────────── Natural voice (Kokoro audio) ───────────── */

/** Lesson the current page plays, so on-demand synthesis can be attributed (and allowed) server-side. */
let currentLessonId: string | null = null
export function setNarrationLesson(id: string | null) { currentLessonId = id }

const SILENT_MP3 = 'data:audio/mpeg;base64,SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYxLjcuMTAzAAAAAAAAAAAAAAD/84TAAAAAAAAAAAAASW5mbwAAAA8AAAAHAAADYABVVVVVVVVVVVVVVVVVVXFxcXFxcXFxcXFxcXFxjo6Ojo6Ojo6Ojo6Ojo6qqqqqqqqqqqqqqqqqqqrHx8fHx8fHx8fHx8fHx+Pj4+Pj4+Pj4+Pj4+Pj//////////////////8AAAAATGF2YzYxLjE5AAAAAAAAAAAAAAAAJAQgAAAAAAAAA2CZUOnQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/80TEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TEUwAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TEpgAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80TErAAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80TErAAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU='

/**
 * Plays cached Kokoro narration from public storage (content-addressed by the
 * line's text), synthesizes missing lines through /api/tts (signed-in users),
 * and falls back to the device voice. One <audio> element is reused so mobile
 * browsers keep it unlocked after the first tap.
 */
class AudioNarrator implements Narrator {
  readonly supported = true
  private device: WebSpeechNarrator
  private audio: HTMLAudioElement | null = null
  private clips = new Map<string, Promise<NarrationClip | null>>()
  private ready = new Map<string, NarrationClip | null>()
  private queue: { text: string; resolve: (c: NarrationClip | null) => void }[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private onEnd: (() => void) | null = null
  private mode: 'audio' | 'device' | null = null
  private token = 0
  /** On-demand synthesis refused (signed out or rate limited): stop asking for a while. */
  private demandBlockedUntil = 0
  private lastError: string | null = null
  private warmedAt = 0
  source: 'audio' | 'device' | null = null
  fallbackReason: string | null = null

  constructor() {
    this.device = new WebSpeechNarrator()
    if (typeof window !== 'undefined') {
      this.audio = new Audio()
      this.audio.preload = 'auto'
    }
  }

  unlock() {
    this.device.unlock()
    const a = this.audio
    if (!a) return
    try {
      a.src = SILENT_MP3
      const p = a.play()
      // Pause only the silent unlock clip: on a warm cache the first line can start before this resolves.
      if (p) p.then(() => { if (a.src === SILENT_MP3) a.pause() }).catch(() => {})
    } catch { /* ignore */ }
  }

  private base() { return audioPublicBase() }

  /** Cached clip for `text` (storage lookup, then on-demand synthesis). */
  private resolve(text: string): Promise<NarrationClip | null> {
    const t = normalizeSpoken(text).slice(0, MAX_TTS_CHARS)
    let p = this.clips.get(t)
    if (!p) {
      p = this.lookup(t).then(c => c ?? this.demand(t)).catch(() => null)
      // Only successes are remembered: a failed line is asked for again next time.
      p.then(c => { if (c) { this.ready.set(t, c); void fetch(c.url, { cache: 'force-cache' }).catch(() => {}) } else this.clips.delete(t) })
      this.clips.set(t, p)
    }
    return p
  }

  private async lookup(text: string): Promise<NarrationClip | null> {
    const base = this.base()
    if (!base.startsWith('http')) return null
    const key = await narrationKey(text)
    const paths = audioPaths(key)
    const res = await fetch(`${base}/${paths.json}`, { cache: 'force-cache' }).catch(() => null)
    if (!res || !res.ok) return null
    const j = await res.json().catch(() => null) as { ms?: number; words?: NarrationTiming['words'] } | null
    if (!j || typeof j.ms !== 'number' || !Array.isArray(j.words)) return null
    return { key, url: `${base}/${paths.mp3}`, ms: j.ms, words: j.words }
  }

  private demand(text: string): Promise<NarrationClip | null> {
    if (Date.now() < this.demandBlockedUntil) return Promise.resolve(null)
    return new Promise(resolve => {
      this.queue.push({ text, resolve })
      if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 30)
    })
  }

  /** Send queued lines to /api/tts: the first line alone (so it plays soon), the rest together. */
  private flush() {
    this.flushTimer = null
    const all = this.queue.splice(0)
    if (!all.length) return
    const batches = [all.slice(0, 1), ...chunk(all.slice(1), 6)].filter(b => b.length)
    let chain = Promise.resolve()
    for (const b of batches) {
      chain = chain.then(async () => {
        const send = () => fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts: b.map(x => x.text), lessonId: currentLessonId }),
        })
        try {
          let res = await send().catch(() => null)
          // One retry after a transient failure (a voice container still starting, a network blip).
          if (!res || res.status >= 500) { await new Promise(r => setTimeout(r, 1500)); res = await send().catch(() => null) }
          if (!res) { this.lastError = 'network'; b.forEach(x => x.resolve(null)); return }
          if (res.status === 401 || res.status === 403 || res.status === 429) this.demandBlockedUntil = Date.now() + (res.status === 429 ? 60_000 : 10 * 60_000)
          if (!res.ok) this.lastError = res.status === 429 ? 'limit' : res.status === 401 || res.status === 403 ? 'signed-out' : `voice service ${res.status}`
          const j = res.ok ? await res.json().catch(() => null) as { clips?: (NarrationClip | null)[] } | null : null
          b.forEach((x, i) => x.resolve(j?.clips?.[i] ?? null))
        } catch {
          this.lastError = 'network'
          b.forEach(x => x.resolve(null))
        }
      })
    }
  }

  preload(texts: string[]) {
    for (const t of texts) if (t.trim()) void this.resolve(t)
  }

  /** Ping the voice service so a cold container starts while the student reads the page. Throttled. */
  warm() {
    if (typeof window === 'undefined' || Date.now() - this.warmedAt < 120_000) return
    this.warmedAt = Date.now()
    // The lesson being opened (so the server can voice the rest of its lines ahead of the student).
    const lessonId = currentLessonId ?? /\/learn\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(window.location.pathname)?.[1] ?? null
    void fetch('/api/tts/warm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lessonId }), keepalive: true }).catch(() => {})
  }

  async prepare(text: string, timeoutMs = NATURAL_VOICE_WAIT_MS): Promise<NarrationTiming | null> {
    if (!text.trim()) return null
    const t = normalizeSpoken(text).slice(0, MAX_TTS_CHARS)
    if (this.ready.has(t)) { const c = this.ready.get(t); return c ? { ms: c.ms, words: c.words } : null }
    let timer: ReturnType<typeof setTimeout> | undefined
    const c = await Promise.race([this.resolve(t), new Promise<null>(r => { timer = setTimeout(() => { this.lastError = 'timed out'; r(null) }, timeoutMs) })])
    clearTimeout(timer)
    return c ? { ms: c.ms, words: c.words } : null
  }

  speak(text: string, onEnd: () => void) {
    this.cancel()
    if (!text.trim()) { onEnd(); return }
    const t = normalizeSpoken(text).slice(0, MAX_TTS_CHARS)
    const clip = this.ready.get(t)
    this.onEnd = onEnd
    const token = ++this.token
    if (clip && this.audio) {
      const a = this.audio
      this.mode = 'audio'
      this.source = 'audio'
      this.fallbackReason = null
      a.onended = () => { if (token === this.token) this.finish() }
      a.onerror = () => {
        if (token !== this.token || this.mode !== 'audio') return
        // Audio failed (network, codec): say it with the device voice instead.
        this.mode = 'device'
        this.source = 'device'
        this.fallbackReason = 'audio playback failed'
        this.device.speak(text, () => { if (token === this.token) this.finish() })
      }
      a.src = clip.url
      a.currentTime = 0
      const p = a.play()
      if (p) p.catch(() => { a.onerror?.(new Event('error')) })
      return
    }
    // Only reached after a real failure: prepare() waited for the natural voice and got nothing.
    this.mode = 'device'
    this.source = 'device'
    this.fallbackReason = this.lastError ?? 'natural voice unavailable'
    this.device.speak(text, () => { if (token === this.token) this.finish() })
  }

  private finish() {
    const cb = this.onEnd
    this.onEnd = null
    this.mode = null
    cb?.()
  }

  position() {
    if (this.mode === 'audio' && this.audio && !this.audio.paused) return this.audio.currentTime * 1000
    if (this.mode === 'audio' && this.audio) return this.audio.currentTime * 1000
    return -1
  }

  pause() {
    if (this.mode === 'audio') this.audio?.pause()
    else if (this.mode === 'device') this.device.pause()
  }

  resume() {
    if (this.mode === 'audio') void this.audio?.play().catch(() => {})
    else if (this.mode === 'device') this.device.resume()
  }

  cancel() {
    this.token++
    if (this.mode === 'audio' && this.audio) { this.audio.onended = null; this.audio.onerror = null; this.audio.pause() }
    if (this.mode === 'device') this.device.cancel()
    this.finish()
  }
}

function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n))
  return out
}

let shared: Narrator | null = null

/** The narrator for this page: natural Kokoro audio with the device voice as fallback. */
export function getNarrator(): Narrator {
  if (!shared) shared = typeof window !== 'undefined' && typeof Audio !== 'undefined' ? new AudioNarrator() : new WebSpeechNarrator()
  return shared
}

export { NARRATION_VOICE }

const PREF_KEY = 'gm.whiteboard.sound'

export function readSoundPref(): boolean {
  try { return localStorage.getItem(PREF_KEY) !== 'off' } catch { return true }
}

export function writeSoundPref(on: boolean) {
  try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off') } catch { /* ignore */ }
}

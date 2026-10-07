/**
 * Voice narration for the whiteboard player.
 *
 * The player only talks to the `Narrator` interface, so a premium TTS provider
 * (streamed audio from a server route) can replace the browser engine later by
 * implementing the same five methods.
 */
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
}

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

let shared: Narrator | null = null

/** The narrator for this page. Swap the implementation here to use a premium provider. */
export function getNarrator(): Narrator {
  if (!shared) shared = new WebSpeechNarrator()
  return shared
}

const PREF_KEY = 'gm.whiteboard.sound'

export function readSoundPref(): boolean {
  try { return localStorage.getItem(PREF_KEY) !== 'off' } catch { return true }
}

export function writeSoundPref(on: boolean) {
  try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off') } catch { /* ignore */ }
}

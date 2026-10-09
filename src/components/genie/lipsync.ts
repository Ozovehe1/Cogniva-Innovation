'use client'
/**
 * Lip sync from the real narration audio: the clip the narrator is playing is fetched once (it is already in the
 * browser cache), decoded off the playback path, and turned into a loudness envelope (60 values a second).
 * The mouth follows the envelope at the audio's current time. Playback itself is never routed through Web Audio,
 * so narration can never be muted by this. Device speech (no audio to read) gets a gentle synthetic rhythm.
 */
import { getNarrator } from '@/components/whiteboard/narrator'
import { genie } from './presence'

const RATE = 60
const envelopes = new Map<string, Float32Array | 'pending' | 'failed'>()
let ctx: BaseAudioContext | null = null

function decoder(): BaseAudioContext | null {
  if (ctx) return ctx
  try { ctx = new OfflineAudioContext(1, 1, 22050) } catch { ctx = null }
  return ctx
}

async function load(url: string) {
  envelopes.set(url, 'pending')
  try {
    const c = decoder()
    if (!c) throw new Error('no audio decoding')
    const buf = await (await fetch(url, { cache: 'force-cache' })).arrayBuffer()
    const audio = await c.decodeAudioData(buf)
    const data = audio.getChannelData(0)
    const hop = Math.max(1, Math.floor(audio.sampleRate / RATE))
    const env = new Float32Array(Math.ceil(data.length / hop))
    for (let i = 0; i < env.length; i++) {
      let sum = 0
      const end = Math.min(data.length, (i + 1) * hop)
      for (let j = i * hop; j < end; j++) sum += data[j] * data[j]
      env[i] = Math.sqrt(sum / Math.max(1, end - i * hop))
    }
    // Normalise to the clip's loud speech (95th percentile), so quiet and loud lines move the mouth alike.
    const sorted = Array.from(env).sort((a, b) => a - b)
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1
    for (let i = 0; i < env.length; i++) env[i] = Math.min(1, Math.max(0, (env[i] / p95 - 0.08) * 1.15))
    if (envelopes.size > 40) envelopes.delete(envelopes.keys().next().value as string)
    envelopes.set(url, env)
  } catch { envelopes.set(url, 'failed') }
}

/** A gentle talking rhythm (~4 syllables a second) for audio we cannot read. */
export function syntheticMouth(t = performance.now() / 1000) {
  const v = 0.5 + 0.35 * Math.sin(t * 2 * Math.PI * 4.2) + 0.15 * Math.sin(t * 2 * Math.PI * 7.3 + 1)
  return Math.min(1, Math.max(0.05, v))
}

let installed = false
/** Connect the whiteboard narrator to the character (once per page). */
export function installNarratorSpeaker() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const n = getNarrator()
  genie.addSpeaker(() => {
    const ls = n.lipSync?.()
    if (!ls) return null
    if (ls === 'device') return syntheticMouth()
    const env = envelopes.get(ls.url)
    if (env === undefined) { void load(ls.url); return syntheticMouth() }
    if (env === 'pending' || env === 'failed') return syntheticMouth()
    const i = Math.floor(ls.t * RATE)
    return env[Math.min(env.length - 1, Math.max(0, i))] ?? 0
  })
}

/** Make any <audio> element (e.g. a chat "read aloud" clip) move the mouth while it plays. */
export function speakerForAudio(a: HTMLAudioElement) {
  return genie.addSpeaker(() => (!a.paused && !a.ended && a.readyState >= 3 ? syntheticMouth() : null))
}

'use client'
/**
 * The tutor character's state, shared by everything that can make it react (the Ask chat, the lesson player,
 * practice and check results, narration). Moods match the Rive view model: 0 idle, 1 listening, 2 thinking,
 * 3 talking, 4 happy (correct), 5 encouraging (wrong). Priority: a reaction (happy/encouraging, a few seconds)
 * > thinking > talking (audio playing) > listening > idle.
 */
import { useSyncExternalStore } from 'react'

export type GenieMood = 'idle' | 'listening' | 'thinking' | 'talking' | 'happy' | 'encouraging'
export const MOOD_NUMBER: Record<GenieMood, number> = { idle: 0, listening: 1, thinking: 2, talking: 3, happy: 4, encouraging: 5 }
export const MOOD_LABEL: Record<GenieMood, string> = {
  idle: 'Ready when you are', listening: 'Listening', thinking: 'Thinking…', talking: 'Explaining', happy: 'Nice work!', encouraging: 'You’ve got this',
}

type Flag = 'thinking' | 'listening'
/** A source of speech: returns a mouth opening 0..1 while it speaks, or null when silent. */
export type Speaker = () => number | null

const flags = new Map<Flag, Set<string>>([['thinking', new Set()], ['listening', new Set()]])
const speakers = new Set<Speaker>()
let reaction: { mood: 'happy' | 'encouraging'; until: number } | null = null
let reactionTimer: ReturnType<typeof setTimeout> | null = null
let speaking = false
let current: GenieMood = 'idle'
const subs = new Set<() => void>()

function compute(): GenieMood {
  if (reaction && reaction.until > Date.now()) return reaction.mood
  if (flags.get('thinking')!.size) return 'thinking'
  if (speaking) return 'talking'
  if (flags.get('listening')!.size) return 'listening'
  return 'idle'
}
function emit() {
  const next = compute()
  if (next === current) return
  current = next
  subs.forEach(f => f())
}

export const genie = {
  /** Turn a lasting state on or off for one source (e.g. 'chat', 'lesson'). */
  set(flag: Flag, on: boolean, source = 'default') {
    const s = flags.get(flag)!
    if (on) s.add(source); else s.delete(source)
    emit()
  },
  /** A short reaction: happy after a correct answer, encouraging after a wrong one. */
  react(mood: 'happy' | 'encouraging', ms = 2600) {
    reaction = { mood, until: Date.now() + ms }
    if (reactionTimer) clearTimeout(reactionTimer)
    reactionTimer = setTimeout(() => { reaction = null; emit() }, ms + 20)
    emit()
  },
  addSpeaker(s: Speaker) { speakers.add(s); return () => { speakers.delete(s) } },
  /** Polled every frame by the character: the loudest speaker's mouth opening, or null. Also updates talking. */
  mouth(): number | null {
    let best: number | null = null
    for (const s of speakers) { const v = s(); if (v !== null && (best === null || v > best)) best = v }
    const now = best !== null
    if (now !== speaking) { speaking = now; emit() }
    return best
  },
  get mood() { return current },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f) } },
}

export function useGenieMood(): GenieMood {
  return useSyncExternalStore(genie.subscribe, () => current, () => 'idle')
}

/* ───────────── Visibility (the learner can hide the character) ───────────── */

const KEY = 'gm.genie'
const visSubs = new Set<() => void>()
export const GENIE_ENABLED = process.env.NEXT_PUBLIC_GENIE !== 'off'

function readVisible() {
  if (!GENIE_ENABLED) return false
  try { return localStorage.getItem(KEY) !== 'hidden' } catch { return true }
}
export function setGenieVisible(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'shown' : 'hidden') } catch { /* private mode */ }
  visSubs.forEach(f => f())
}
export function useGenieVisible(): boolean {
  return useSyncExternalStore(f => { visSubs.add(f); const onStorage = (e: StorageEvent) => { if (e.key === KEY) f() }; window.addEventListener('storage', onStorage); return () => { visSubs.delete(f); window.removeEventListener('storage', onStorage) } }, readVisible, () => GENIE_ENABLED)
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

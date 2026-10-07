'use client'
import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'
import type { Vars } from '@/lib/lesson-schema'

/**
 * Live values of board variables while an `animate` action runs. The player
 * writes them every animation frame; only elements whose geometry or text
 * depends on a variable subscribe, so the rest of the board does not re-render.
 */
export class VarStore {
  private v: Vars = {}
  private listeners = new Set<() => void>()
  get = () => this.v
  set(next: Vars) {
    const a = this.v
    const keys = new Set([...Object.keys(a), ...Object.keys(next)])
    let same = true
    for (const k of keys) if (a[k] !== next[k]) { same = false; break }
    if (same) return
    this.v = next
    this.listeners.forEach(l => l())
  }
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
}

export const VarsContext = createContext<VarStore | null>(null)

const noop = () => () => {}

/** Variables for an element: live while animating when it depends on them, otherwise the board's. */
export function useLiveVars(dyn: boolean, fallback: Vars): Vars {
  const store = useContext(VarsContext)
  const sub = useCallback((l: () => void) => (dyn && store ? store.subscribe(l) : noop()), [dyn, store])
  const live = useSyncExternalStore(sub, () => (dyn && store ? store.get() : null), () => null)
  return live && Object.keys(live).length ? { ...fallback, ...live } : fallback
}

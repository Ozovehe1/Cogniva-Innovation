/**
 * Ready scene specs: each kind's example (its default lesson), and the mapping from the old hand-built SVG scenes
 * (lib/agent/scenes.ts kinds saved in older lessons and stage templates) onto the engine, so every lesson gets the
 * new look without a model call. Client-safe (no zod).
 */
import { KINDS } from './kinds'
import type { ParamValue, SceneKindId, SceneSpec } from './types'

export function templateSpec(kind: SceneKindId, over: Partial<Omit<SceneSpec, 'version' | 'kind'>> & { params?: Record<string, ParamValue> } = {}): SceneSpec {
  const ex = KINDS[kind].info.example
  return { version: 1, kind, ...ex, ...over, params: { ...ex.params, ...(over.params ?? {}) } }
}

/** Old scene kinds → engine specs (the slider of the old figure becomes the scene's control). */
export function legacySceneSpec(old: string, title?: string): { spec: SceneSpec; control?: string } | null {
  switch (old) {
    case 'magnet_coil':
      return { spec: templateSpec('em_induction', title ? { title } : {}), control: 'magnet_x' }
    case 'bar_magnet':
      return {
        spec: templateSpec('em_induction', {
          title: title ?? 'The field around a bar magnet',
          params: { show_coil: false, magnet_x: 0 },
          beats: [
            { do: 'reveal', target: 'field', dur: 2.2, caption: 'Field lines leave N and curve round to S' },
            { do: 'highlight', target: 'magnet', dur: 1.8, caption: 'Lines crowd at the poles: strongest there' },
            { do: 'pulse', target: 'field', dur: 1.8, caption: 'The flow shows the direction: N to S' },
          ],
          labels: [],
          drag: false,
          alt: 'A bar magnet with its field lines leaving the N end, curving round and entering the S end; moving streaks show the direction.',
        }),
      }
    case 'wire_field':
      return { spec: templateSpec('field_wire', title ? { title } : {}), control: 'current' }
    case 'charge_drift':
      return {
        spec: templateSpec('circuit', {
          title: title ?? 'Charges drifting along a wire',
          params: { voltage: 0, resistance: 4, show: 'electrons' },
          beats: [
            { do: 'hold', dur: 1.2, caption: 'No push: free electrons only jiggle' },
            { do: 'set', param: 'voltage', to: 6, dur: 2.0, caption: 'The cell pushes: electrons drift round' },
            { do: 'pulse', target: 'ammeter', dur: 1.8, caption: 'Current = charge passing each second' },
            { do: 'move', param: 'voltage', to: 12, dur: 2.0, caption: 'Bigger push: faster drift, more current' },
          ],
          controls: [{ param: 'voltage' }],
        }),
        control: 'voltage',
      }
    case 'projectile':
      return { spec: templateSpec('projectile', title ? { title } : {}) }
    case 'motor':
      return { spec: templateSpec('motor', title ? { title } : {}) }
    default:
      return null
  }
}

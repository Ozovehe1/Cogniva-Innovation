/**
 * Stage aspect (height / width, stage + plot strip) per kind, without importing the engine: the lazy loaders reserve
 * exactly this box so nothing below the scene moves when the engine chunk arrives. Kept equal to each kind's
 * aspect + plot (checked by validate's tests via kinds/index.ts).
 */
import type { SceneSpec } from './types'

export function stageAspect(spec: Pick<SceneSpec, 'kind' | 'params'>): number {
  const p = spec.params ?? {}
  switch (spec.kind) {
    case 'em_induction': return p.show_coil === false ? 0.7 : 0.96
    case 'field_wire': return 0.78
    case 'motor': return 0.86
    case 'circuit': return 0.8
    case 'projectile': return 0.8
    case 'heart': return 0.98
    case 'tangent': return p.show_derivative === false ? 0.72 : 1.02
    case 'cell': return 0.78
    default: return 0.86
  }
}
/** Readout chips row (all kinds but cell have readouts). */
export const hasReadouts = (spec: Pick<SceneSpec, 'kind' | 'params'>) => spec.kind !== 'cell' && !(spec.kind === 'em_induction' && spec.params?.show_coil === false)

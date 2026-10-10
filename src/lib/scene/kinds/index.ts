/** The scene-kind registry: id → runtime (drawing + physics). Info (params/targets) is server-safe metadata. */
import type { KindRuntime } from '../engine'
import type { KindInfo, SceneKindId } from '../types'
import { emInduction } from './em-induction'
import { fieldWire } from './field-wire'
import { motor } from './motor'
import { circuit } from './circuit'
import { projectile } from './projectile'
import { heart } from './heart'
import { tangent } from './tangent'
import { cell } from './cell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const KINDS: Record<SceneKindId, KindRuntime<any>> = {
  em_induction: emInduction,
  field_wire: fieldWire,
  motor,
  circuit,
  projectile,
  heart,
  tangent,
  cell,
}

export const KIND_IDS = Object.keys(KINDS) as SceneKindId[]
export const kindInfo = (id: SceneKindId): KindInfo => KINDS[id].info

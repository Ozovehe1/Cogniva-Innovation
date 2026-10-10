/**
 * Scene spec: what a model (or a lesson template) writes to put a live scene on screen. It names a scene kind, its
 * semantic parameters, a short beat timeline with captions, the learner's controls and up to 4 labels. It never names
 * pixels, colours or fonts: the engine (lib/scene/engine.ts + kinds/*) owns layout and look, so a valid spec always
 * renders cleanly at 390 px. Validated by validate.ts (zod + semantic + layout checks).
 */
import type { EaseName } from './tokens'

export type SceneKindId = 'em_induction' | 'field_wire' | 'motor' | 'circuit' | 'projectile' | 'heart' | 'tangent' | 'cell'

export type BeatVerb = 'reveal' | 'move' | 'set' | 'play' | 'hold' | 'pulse' | 'highlight' | 'ask'

export interface SceneBeat {
  do: BeatVerb
  /** An object of the kind (reveal / pulse / highlight), e.g. "field", "commutator". */
  target?: string
  /** A numeric parameter of the kind (move / set), e.g. "magnet_x", "current". */
  param?: string
  to?: number
  /** Seconds (0.3–8). */
  dur: number
  ease?: EaseName
  /** One line, ≤ 44 characters, shown in the caption pill during the beat. */
  caption: string
  /** Optional narration line for TTS. */
  say?: string
}

export type ParamValue = number | string | boolean

export interface SceneSpec {
  version: 1
  kind: SceneKindId
  title: string
  params: Record<string, ParamValue>
  beats: SceneBeat[]
  /** Sliders under the stage, bound to numeric params. */
  controls: { param: string; label?: string }[]
  /** Short labels the engine places next to objects of the kind (≤ 4, ≤ 22 chars). */
  labels: { target: string; text: string }[]
  /** After the timeline the learner may drag the kind's handle (magnet, point, launcher…). */
  drag: boolean
  alt: string
}

export type ParamDef =
  | { type: 'number'; min: number; max: number; default: number; label: string; unit?: string; step?: number }
  | { type: 'enum'; options: string[]; default: string; label: string }
  | { type: 'bool'; default: boolean; label: string }
  | { type: 'expr'; default: string; label: string }

/** What the validator and the model need to know about a kind (no drawing code). */
export interface KindInfo {
  id: SceneKindId
  /** One line for the tool description. */
  blurb: string
  params: Record<string, ParamDef>
  targets: string[]
  /** The numeric param a "play" beat runs (time-like), if any. */
  playParam?: string
  /** What dragging moves, if the kind has a handle. */
  dragParam?: string
  /** The default spec (also the template for older lessons). */
  example: Omit<SceneSpec, 'version' | 'kind'>
}

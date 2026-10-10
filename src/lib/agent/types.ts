/** Shared between the server agent and the chat UI. */
import type { Step } from '../lesson-schema'
import type { SimSpec } from './visual'
import type { IxSpec } from './interactive'
import type { Credit } from '../illustrations/types'

export type Block =
  /** start: steps before it are already on the board (shown at once); the rest animate (a board edit). */
  | { kind: 'board'; id: string; title: string; steps: Step[]; plot?: boolean; start?: number; rev?: number; diagram?: boolean }
  /** credit: attribution for a library illustration (shown under it; CC BY needs it). */
  | { kind: 'svg'; id: string; svg: string; alt: string; credit?: Credit; url?: string }
  | { kind: 'sim'; id: string; spec: SimSpec }
  /** A live JSXGraph figure from a validated spec (boardFigure: its static picture was also placed on the board). */
  | { kind: 'interactive'; id: string; spec: IxSpec; alt: string; boardFigure?: string; play?: { slider: string; seconds?: number } }
  | { kind: 'clip'; id: string; jobId: string; status: 'rendering' | 'done' | 'failed'; url?: string | null; caption?: string }
  | { kind: 'image'; id: string; png: string; caption?: string }
  | { kind: 'code'; id: string; code: string; stdout: string; error?: string | null; engine: string }
  /** numeric: a typed answer (number + unit) instead of options. */
  | { kind: 'practice'; id: string; actionId: string; title: string; items: { q: string; options: string[]; figure?: import('../assessment/spec').PublicFigure; numeric?: { unit?: string } }[] }
  /** A verified worked example (src/lib/examples): the client re-solves it live; practice answers stay on the server. */
  /** A live scene (lib/scene): a validated scene spec the engine renders and animates. */
  | { kind: 'scene'; id: string; spec: import('../scene/types').SceneSpec; alt: string }
  /** An external stage tool (lib/live/tools/embeds.ts): circuit sim, 3D molecule, diagram, physics, GeoGebra, PhET, Desmos. */
  | { kind: 'embed'; id: string; tool: import('../live/tools/embed-meta').EmbedKind; spec: Record<string, unknown>; title: string; alt: string }
  | { kind: 'worked_example'; id: string; spec: import('../examples/spec').ExampleSpec; practice?: { actionId: string; items: { q: string; svg?: string; unit?: string }[] } }
  | { kind: 'confirm'; id: string; actionId: string; title: string; detail: string; status: 'proposed' | 'done' | 'declined' | 'undone' }
  | { kind: 'sources'; id: string; items: { title: string; url: string; source: string }[] }
  | { kind: 'lesson'; id: string; lessonId: string; title: string; note: string }
  | { kind: 'audio'; id: string; text: string }
  | { kind: 'checked'; id: string; items: { expression: string; result: string }[] }
  | { kind: 'plan'; id: string; items: PlanItem[]; note?: string | null }

export interface PlanItem {
  kind: 'review' | 'lesson' | 'check' | 'practice' | 'recap' | 'remediation' | 'rest'
  title: string
  why?: string
  minutes?: number
  href?: string
  topicId?: string
  pathId?: string
  nodeId?: string
  lessonId?: string
  actionId?: string
  sessionId?: string
}

/** NDJSON events streamed by POST /api/agent/chat. */
export type ChatEvent =
  | { t: 'session'; id: string }
  | { t: 'text'; d: string }
  | { t: 'tool'; name: string; label: string; state: 'start' | 'done' | 'error' }
  | { t: 'block'; block: Block }
  | { t: 'safety'; minor: boolean | null }
  | { t: 'limit'; message: string }
  | { t: 'error'; message: string; retryAfterMs?: number }
  | { t: 'done'; model?: string; remaining?: number }
  | { t: 'ping' }

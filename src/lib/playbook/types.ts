/**
 * Teaching Playbook types. See docs/playbook.md.
 *
 * Two layers (hard rule):
 *   global   playbook_bullets — abstract teaching rules for a target (lesson writer, Ask tutor, diagrams, illustration
 *            ranking, Manim planner). Never any learner's text, answers or personal data (privacy.ts enforces it).
 *   learner  learner_memory kind 'teaching_note' — what confused / helped ONE learner; only feeds that learner's lessons.
 */
export type Target = 'lesson' | 'ask' | 'diagram' | 'illustration' | 'manim'
export const TARGETS: Target[] = ['lesson', 'ask', 'diagram', 'illustration', 'manim']
export type BulletStatus = 'candidate' | 'live' | 'rejected' | 'retired'
export type SignalSource = 'report' | 'guard' | 'clip' | 'outcome' | 'success' | 'reexplain' | 'confusion'

export interface Bullet {
  id: string
  target: Target
  kind: 'strategy' | 'avoid'
  subject: string
  topic: string
  topic_key: string
  skill: string
  text: string
  check_q: string | null
  probes: string[]
  hints: { prefer?: string[]; avoid?: string[] }
  status: BulletStatus
  scope: 'global' | 'eval'
  helpful: number
  harmful: number
  evidence: number
  sources: { signal?: number; source?: string }[]
  embedding?: number[] | null
  gate: GateVerdict | null
  gate_attempts: number
  version: number
  decided_by: string | null
  created_at: string
  updated_at: string
  live_at: string | null
  retired_at: string | null
}

/** Anonymised evidence the global reflector may read. */
export interface SignalForReflection {
  id: number
  source: SignalSource
  target: Target
  external: boolean
  subject: string
  topic: string
  skill: string
  payload: Record<string, unknown>
  weight: number
}

/** A delta op from the reflector (ACE): the curator applies these deterministically. */
export interface DeltaOp {
  op: 'add' | 'helpful' | 'harmful'
  /** add */
  target?: Target
  kind?: 'strategy' | 'avoid'
  subject?: string
  topic?: string
  skill?: string
  text?: string
  check?: string
  probes?: string[]
  hints?: { prefer?: string[]; avoid?: string[] }
  /** helpful / harmful: an existing bullet id */
  id?: string
  /** signal ids this op rests on */
  evidence?: number[]
}

export interface GateProbe { topic: string; base: number; cand: number; baseNotes: string[]; candNotes: string[] }
export interface GateVerdict {
  pass: boolean
  stage: 'privacy' | 'lint' | 'batch' | 'regression' | 'inconclusive' | 'admin'
  reason: string
  probes?: GateProbe[]
  regression?: { passed: number; total: number }
  at: string
  model?: string | null
}

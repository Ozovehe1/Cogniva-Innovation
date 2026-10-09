/**
 * Request-scoped playbook context (AsyncLocalStorage), so the lesson writer's single prompt hook (generateSteps) knows
 * which lesson / learner it is writing for without threading new arguments through lesson-ai.ts.
 * Set by: lesson drafting (runDraftWork), the live tutor (/api/tutor/step). Server only.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export interface PlaybookCtx {
  lessonId?: string | null
  studentId?: string | null
  sessionId?: string | null
  topic?: string | null
  subject?: string | null
  /** Eval / gate: use exactly these bullets (no DB retrieval, no usage logging). */
  override?: string[]
  /** Eval / gate: turn the playbook off for this call (the baseline arm). */
  off?: boolean
}

const als = new AsyncLocalStorage<PlaybookCtx>()

export function withPlaybook<T>(ctx: PlaybookCtx, fn: () => Promise<T>): Promise<T> {
  const parent = als.getStore()
  return als.run({ ...(parent ?? {}), ...ctx }, fn)
}

export function playbookCtx(): PlaybookCtx | undefined {
  return als.getStore()
}

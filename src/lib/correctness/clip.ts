/** Animations: the scene engine's deterministic verifier decides; a clip it failed is never shown or placed in a lesson. */
export interface ClipVerdict { ok?: unknown; failed?: unknown }
export function clipBlocked(verdict: unknown): boolean {
  return !!verdict && typeof verdict === 'object' && (verdict as ClipVerdict).ok === false
}
/** What the learner may see of a render job. */
export function clipState(job: { status: string; verdict?: unknown }): 'done' | 'failed' | 'rendering' {
  if (clipBlocked(job.verdict)) return 'failed'
  return job.status === 'done' || job.status === 'approved' ? 'done' : job.status === 'failed' ? 'failed' : 'rendering'
}

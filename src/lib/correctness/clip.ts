/** Animations: the scene engine's deterministic verifier decides; a clip it failed is never shown or placed in a lesson. */
export interface ClipVerdict { ok?: unknown; failed?: unknown }
export function clipBlocked(verdict: unknown): boolean {
  return !!verdict && typeof verdict === 'object' && (verdict as ClipVerdict).ok === false
}
/** Only an explicit { ok: true } from the deterministic scene verifier counts as checked; a missing verdict is unverified. */
export function clipVerified(verdict: unknown): boolean {
  return !!verdict && typeof verdict === 'object' && (verdict as ClipVerdict).ok === true
}
/** What the learner may see of a render job. */
export function clipState(job: { status: string; verdict?: unknown; updated_at?: string | null }): 'done' | 'failed' | 'rendering' {
  if (clipBlocked(job.verdict)) return 'failed'
  // A job still 'queued' minutes after it was asked for was never picked up (the request that queued it ended before
  // its dispatcher ran): stop showing a render in progress.
  if (job.status === 'queued' && job.updated_at && Date.now() - Date.parse(job.updated_at) > 4 * 60_000) return 'failed'
  return job.status === 'done' || job.status === 'approved' ? 'done' : job.status === 'failed' ? 'failed' : 'rendering'
}

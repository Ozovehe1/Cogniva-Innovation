/**
 * Where the learner is in the lesson that is playing, for the tutor sheet: the player reports its position and the
 * last check answer here, and the sheet sends it with each question so the tutor knows which step is on screen and
 * what they just answered (the saved progress row lags by up to the save interval). Client only, per tab, no PII
 * beyond the learner's own answer to their own lesson.
 */
export interface LessonLive {
  lessonId: string
  /** Step index in original-script terms (inserted re-teach steps are not counted). */
  cursor: number
  section: number
  total: number
  /** The last answered check: original step index, right/wrong and what they typed or chose. */
  lastCheck?: { step: number; correct?: boolean; answer?: string; response: string; at: number } | null
  /** A re-teach the player just ran. */
  lastReteach?: { step: number; reason: string; at: number } | null
}

let live: LessonLive | null = null

export function setLessonLive(patch: Partial<LessonLive> & { lessonId: string }) {
  live = live && live.lessonId === patch.lessonId ? { ...live, ...patch } : { cursor: 0, section: 0, total: 0, ...patch }
}

export function getLessonLive(lessonId: string | null | undefined): LessonLive | null {
  return lessonId && live?.lessonId === lessonId ? live : null
}

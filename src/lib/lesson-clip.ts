/**
 * One rendered Manim animation per AI lesson, with no human approval step.
 * Safety is unchanged: the code is written by Gemini from the lesson's own
 * outline (never code or text typed by a student is executed), it passes the
 * static Manim guard (security + v0.19 API) before rendering, and it renders
 * only inside the Modal sandbox. When the clip is done it is placed into the
 * lesson's second section (or the first, for one-section lessons).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateManimCode } from './lesson-ai'
import { dispatchFreeform, dispatchRender, renderServiceConfigured, type ManimJob } from './manim'
import { publicClipUrl } from './supabase/admin'
import type { Step } from './lesson-schema'
import { readVisual } from './visual-policy'

interface SectionLite { id: string; position: number; title: string; goal: string; key_points: string[]; status: string; steps: Step[] }

function targetPosition(count: number) { return count > 1 ? 1 : 0 }

/** Most auto clips one lesson gets (processes, fields and motion get a second one later in the lesson). */
export const LESSON_CLIPS_MAX = 2
/** Auto lesson clips one learner gets per day across all their lessons (Modal compute; free-tier LLM calls). */
export const LESSON_CLIPS_PER_LEARNER_DAY = Number(process.env.LESSON_CLIPS_PER_DAY ?? 6) || 6

/** Which sections get a clip: the second section, plus (for change/process topics) one later demo about change. */
export function clipTargets(lesson: { title: string; subject: string }, sections: { position: number; title: string; goal: string; key_points: string[]; kind?: string | null }[]): number[] {
  if (!sections.length) return []
  const out = [sections[targetPosition(sections.length)].position]
  const lessonRead = readVisual(`${lesson.title}. ${lesson.subject}`)
  const rich = (t: string) => { const f = readVisual(t).families; return f.includes('process') || f.includes('motion') || f.includes('field') }
  if (rich(`${lesson.title}. ${lesson.subject}`) || lessonRead.families.includes('field')) {
    const later = sections.find(s => s.position >= 3 && (s.kind ?? 'demo') === 'demo' && rich(`${s.title}. ${s.goal}. ${(s.key_points ?? []).join('; ')}`))
      ?? sections.find(s => s.position >= 3 && (s.kind ?? 'demo') === 'demo')
    if (later && !out.includes(later.position)) out.push(later.position)
  }
  return out.slice(0, LESSON_CLIPS_MAX)
}

export async function queueLessonClip(db: SupabaseClient, lessonId: string) {
  if (!renderServiceConfigured()) return
  const { data: lesson } = await db.from('lessons').select('id, title, subject, owner_student_id, generated_by').eq('id', lessonId).maybeSingle()
  const l = lesson as { id: string; title: string; subject: string; owner_student_id: string | null; generated_by: string } | null
  if (!l || l.generated_by !== 'ai' || !l.owner_student_id) return
  const { data: had } = await db.from('manim_jobs').select('id, prompt').eq('lesson_id', lessonId).eq('auto_insert', true)
  const existing = (had ?? []) as { id: string; prompt: string }[]
  if (existing.length >= LESSON_CLIPS_MAX) return
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const { count: today } = await db.from('manim_jobs').select('id', { count: 'exact', head: true }).eq('requested_by', l.owner_student_id).eq('auto_insert', true).gte('created_at', since)
  const { data: secs } = await db.from('lesson_sections').select('id, position, title, goal, key_points, kind').eq('lesson_id', lessonId).order('position')
  const sections = (secs ?? []) as (SectionLite & { kind?: string | null })[]
  if (!sections.length) return
  let budget = LESSON_CLIPS_PER_LEARNER_DAY - (today ?? 0)
  for (const pos of clipTargets(l, sections)) {
    if (budget <= 0 && existing.length) break
    const s = sections.find(x => x.position === pos)!
    if (existing.some(j => j.prompt.includes(`section "${s.title}"`))) continue
    // The description comes from the AI-written outline only.
    const prompt = `A short animation for the section "${s.title}" of the lesson "${l.title}" (${l.subject}). Goal: ${s.goal}. Show visually, in order: ${(s.key_points ?? []).slice(0, 4).join('; ')}. Show the real thing moving (fields as arrows or lines that form, objects that move, quantities that change), not a static graph. 10 to 25 seconds, one clear idea, no paragraphs of text.`.slice(0, 1800)
    const { data: job, error } = await db.from('manim_jobs').insert({ lesson_id: lessonId, requested_by: l.owner_student_id, prompt, status: 'queued', auto_insert: true }).select('*').single()
    if (error || !job) continue
    existing.push({ id: (job as ManimJob).id, prompt }); budget--
    try {
      // The render service's scene language first (the model writes objects + relations; sympy, the constraint solver and
      // the layout engine compute everything and verify it before rendering), then free-form Manim, then the template
      // composer (all on Modal). When the service cannot be reached, the code path below is the last resort.
      const composed = await dispatchFreeform(db, { id: (job as ManimJob).id, attempts: 0, prompt }, `Lesson "${l.title}" (${l.subject}).`)
      if (composed.ok) continue
      const code = await generateManimCode(prompt, { lessonTitle: l.title, subject: l.subject })
      await db.from('manim_jobs').update({ code }).eq('id', (job as ManimJob).id)
      await dispatchRender(db, { id: (job as ManimJob).id, code, attempts: 0, prompt })
    } catch (err) {
      await db.from('manim_jobs').update({ status: 'failed', error: `Could not write the animation code: ${err instanceof Error ? err.message : String(err)}`.slice(0, 1000) }).eq('id', (job as ManimJob).id)
    }
  }
}

/**
 * Place finished auto clips into a section as it is released. Called by the drafting
 * worker with the position of the section it has just finished, before that section
 * is published to the learner's script: a section the learner may already be playing
 * is never changed (that would restart their player). A clip that finishes rendering
 * after its section was released goes into the next section to be released instead.
 * A placed clip's job is marked 'approved' so it is only placed once.
 */
export async function attachReadyClips(db: SupabaseClient, lessonId: string, position?: number): Promise<boolean> {
  if (position === undefined) return false
  const { data: jobs } = await db.from('manim_jobs').select('*').eq('lesson_id', lessonId).eq('auto_insert', true).eq('status', 'done')
  const done = (jobs ?? []) as (ManimJob & { prompt: string })[]
  if (!done.length) return false
  const { data: secs } = await db.from('lesson_sections').select('id, position, title, goal, key_points, status, steps').eq('lesson_id', lessonId).order('position')
  const sections = (secs ?? []) as SectionLite[]
  if (!sections.length || position < targetPosition(sections.length)) return false
  const s = sections.find(x => x.position === position)
  if (!s || s.status !== 'ready' || !Array.isArray(s.steps)) return false
  let placed = false
  for (const job of done) {
    if (!job.video_path) continue
    // A clip made for a later section waits for that section.
    const forTitle = /section "([^"]+)"/.exec(job.prompt ?? '')?.[1]
    const forPos = forTitle ? sections.find(x => x.title === forTitle)?.position : undefined
    if (forPos !== undefined && position < forPos) continue
    if (s.steps.some(st => st.type === 'manim_clip' && (st as { jobId?: string }).jobId === job.id)) { await db.from('manim_jobs').update({ status: 'approved' }).eq('id', job.id); continue }
    // After the section title (and its opening clear), before the teaching starts.
    const titleAt = s.steps.findIndex(st => st.type === 'write' && (st as { id?: string }).id === 'title')
    const at = titleAt >= 0 ? titleAt + 1 : Math.min(1, s.steps.length)
    const clip: Step = { type: 'manim_clip', url: publicClipUrl(job.video_path), caption: s.goal?.slice(0, 280) || s.title, jobId: job.id } as Step
    const steps = [...s.steps.slice(0, at), clip, ...s.steps.slice(at)]
    await db.from('lesson_sections').update({ steps }).eq('id', s.id)
    await db.from('manim_jobs').update({ status: 'approved' }).eq('id', job.id)
    s.steps = steps
    placed = true
  }
  return placed
}

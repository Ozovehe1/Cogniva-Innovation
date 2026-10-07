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
import { dispatchRender, renderServiceConfigured, type ManimJob } from './manim'
import { publicClipUrl } from './supabase/admin'
import type { Step } from './lesson-schema'

interface SectionLite { id: string; position: number; title: string; goal: string; key_points: string[]; status: string; steps: Step[] }

function targetPosition(count: number) { return count > 1 ? 1 : 0 }

export async function queueLessonClip(db: SupabaseClient, lessonId: string) {
  if (!renderServiceConfigured()) return
  const { data: lesson } = await db.from('lessons').select('id, title, subject, owner_student_id, generated_by').eq('id', lessonId).maybeSingle()
  const l = lesson as { id: string; title: string; subject: string; owner_student_id: string | null; generated_by: string } | null
  if (!l || l.generated_by !== 'ai' || !l.owner_student_id) return
  const { count: existing } = await db.from('manim_jobs').select('id', { count: 'exact', head: true }).eq('lesson_id', lessonId).eq('auto_insert', true)
  if (existing) return
  const { data: secs } = await db.from('lesson_sections').select('id, position, title, goal, key_points').eq('lesson_id', lessonId).order('position')
  const sections = (secs ?? []) as SectionLite[]
  if (!sections.length) return
  const s = sections[targetPosition(sections.length)]
  // The description comes from the AI-written outline only.
  const prompt = `A short animation for the section "${s.title}" of the lesson "${l.title}" (${l.subject}). Goal: ${s.goal}. Show visually, in order: ${(s.key_points ?? []).slice(0, 4).join('; ')}. 10 to 25 seconds, one clear idea, no paragraphs of text.`.slice(0, 1800)
  const { data: job, error } = await db.from('manim_jobs').insert({ lesson_id: lessonId, requested_by: l.owner_student_id, prompt, status: 'queued', auto_insert: true }).select('*').single()
  if (error || !job) return
  try {
    const code = await generateManimCode(prompt, { lessonTitle: l.title, subject: l.subject })
    await db.from('manim_jobs').update({ code }).eq('id', (job as ManimJob).id)
    await dispatchRender(db, { id: (job as ManimJob).id, code, attempts: 0, prompt })
  } catch (err) {
    await db.from('manim_jobs').update({ status: 'failed', error: `Could not write the animation code: ${err instanceof Error ? err.message : String(err)}`.slice(0, 1000) }).eq('id', (job as ManimJob).id)
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

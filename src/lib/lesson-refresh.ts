/**
 * Visual refresh for a learner's OWN AI lesson, run when its owner opens it (never for shared lessons; nothing is
 * copied between learners). It brings in visuals the lesson missed:
 *
 *  1. Finished lesson clips that were never shown. attachReadyClips only places a clip into a section that is still
 *     being released, so a clip that renders after its section was released (or while drafting is paused on quota)
 *     was never seen. It is placed now: into its own section if the learner has not reached it yet, otherwise into the
 *     first ready section after where they are.
 *  2. Lessons with fewer auto clips than they should have (older lessons, change/process/field topics) get them
 *     queued (queueLessonClip applies the per-lesson and per-learner daily caps).
 *  3. Lessons about a real-world structure (heart, cell, solenoid, magnet, motor…) with no picture get, in up to two
 *     sections that name it, a credited library illustration after the section title, narrated, then cleared, so the
 *     section's board continues exactly as before.
 *
 * Runs on page load, before the player mounts (a changed step count resumes at the start of the section). Idempotent:
 * clips are placed once (job -> approved), pictures only when the lesson has none, and a version marker
 * (lessons.style_notes.visual_refresh) stops it once nothing is pending.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { publicClipUrl } from './supabase/admin'
import { LESSON_CLIPS_MAX, clipTargets, queueLessonClip } from './lesson-clip'
import { loadSections, syncLessonScript, type SectionRow } from './lesson-drafting'
import { readVisual } from './visual-policy'
import { validateScript, type Step } from './lesson-schema'

export const VISUAL_REFRESH_VERSION = 2
const MAX_PICTURES = 2

function afterTitle(steps: Step[]) {
  const t = steps.findIndex(st => st.type === 'write' && (st as { id?: string }).id === 'title')
  return t >= 0 ? t + 1 : Math.min(1, steps.length)
}

export function needsVisualRefresh(styleNotes: unknown): boolean {
  return ((styleNotes as { visual_refresh?: number } | null)?.visual_refresh ?? 0) < VISUAL_REFRESH_VERSION
}

export async function refreshLessonVisuals(db: SupabaseClient, lessonId: string, ownerId: string, trace: string[] = []): Promise<{ changed: boolean; trace: string[] }> {
  const { data: l } = await db.from('lessons').select('id, title, subject, objectives, owner_student_id, generated_by, draft_status, style_notes').eq('id', lessonId).maybeSingle()
  const lesson = l as { id: string; title: string; subject: string; objectives: string[] | null; owner_student_id: string | null; generated_by: string; draft_status: string; style_notes: Record<string, unknown> | null } | null
  if (!lesson || lesson.owner_student_id !== ownerId || lesson.generated_by !== 'ai') return { changed: false, trace }
  if (!needsVisualRefresh(lesson.style_notes)) return { changed: false, trace }
  // The drafting worker owns the sections while it runs (it places clips itself); paused / ready / partial only.
  if (['outlining', 'drafting'].includes(lesson.draft_status)) return { changed: false, trace }
  const all = await loadSections(db, lessonId)
  const sections = all.filter(s => s.status === 'ready' && Array.isArray(s.steps))
  if (!sections.length) return { changed: false, trace }
  const dirty = new Set<string>()

  // Where the learner is (section index into the ready sections).
  const { data: prog } = await db.from('lesson_progress').select('section_index').eq('student_id', ownerId).eq('lesson_id', lessonId).maybeSingle()
  const at = Math.max(0, (prog as { section_index: number | null } | null)?.section_index ?? 0)

  // 1. Finished clips never shown.
  const { data: jobs } = await db.from('manim_jobs').select('id, status, video_path, prompt').eq('lesson_id', lessonId).eq('auto_insert', true)
  const js = (jobs ?? []) as { id: string; status: string; video_path: string | null; prompt: string }[]
  const placed = new Set(sections.flatMap(s => s.steps).filter(st => st.type === 'manim_clip').map(st => (st as { jobId?: string }).jobId).filter(Boolean))
  for (const j of js) {
    if (j.status !== 'done' || !j.video_path || placed.has(j.id)) continue
    const forTitle = /section "([^"]+)"/.exec(j.prompt ?? '')?.[1]
    const own = sections.findIndex(s => s.title === forTitle)
    let k = own >= 0 && own >= at ? own : sections.findIndex((_, i) => i > at && i > 0)
    if (k < 0) k = Math.min(sections.length - 1, Math.max(own, at))
    const s = sections[k]
    const pos = afterTitle(s.steps)
    const clip = { type: 'manim_clip', url: publicClipUrl(j.video_path), caption: (s.goal || s.title).slice(0, 280), jobId: j.id } as Step
    s.steps = [...s.steps.slice(0, pos), clip, ...s.steps.slice(pos)]
    dirty.add(s.id)
    await db.from('manim_jobs').update({ status: 'approved' }).eq('id', j.id)
    trace.push(`clip ${j.id.slice(0, 8)} placed in section ${s.position}`)
  }

  // 2. Missing clips (queueLessonClip applies the caps; placed by a later open or by the drafting worker).
  const wanted = Math.min(LESSON_CLIPS_MAX, clipTargets(lesson, all).length)
  if (js.length < wanted) {
    try { await queueLessonClip(db, lessonId); trace.push('clip queued') } catch (err) { trace.push(`clip not queued: ${err instanceof Error ? err.message.slice(0, 80) : err}`) }
  }

  // 3. Real pictures for structure topics.
  const hasPicture = sections.some(s => s.steps.some(st => st.type === 'draw' && (st as { shape?: { kind?: string } }).shape?.kind === 'figure'))
  if (!hasPicture) {
    const lessonRead = readVisual(`${lesson.title}. ${(lesson.objectives ?? []).join('. ')}`)
    const picks: { s: SectionRow; query: string }[] = []
    for (const s of sections) {
      if (picks.length >= MAX_PICTURES) break
      const r = readVisual(`${s.title}. ${s.goal}. ${(s.key_points ?? []).join('. ')}`)
      const query = r.structure ?? (picks.length === 0 && s.position <= 1 ? lessonRead.structure : undefined)
      if (query && !picks.some(p => p.query === query)) picks.push({ s, query })
    }
    if (picks.length) {
      const { findIllustration } = await import('./illustrations/find')
      for (const { s, query } of picks) {
        try {
          const f = await Promise.race([findIllustration({ topic: query }, db, trace), new Promise<null>(r => setTimeout(() => r(null), 8_000))])
          if (!f?.url) { trace.push(`picture "${query}": nothing usable`); continue }
          const box = { x: 200, y: 90, w: 400, h: 330 }
          const k = Math.min(box.w / f.width, box.h / f.height)
          const w = Math.round(f.width * k), h = Math.round(f.height * k)
          const id = `pic_${s.position}`
          const fig = { type: 'draw', id, say: `Here is what a real ${query} looks like. Notice its main parts; we will build each one up on the board.`, shape: { kind: 'figure', x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + (box.h - h) / 2), w, h, svg: '', src: f.url, alt: `${f.alt}. Credit: ${f.creditText}`.slice(0, 300) } } as unknown as Step
          const added = [fig, { type: 'pause', ms: 1500 } as Step, { type: 'clear', targets: [id] } as Step]
          const check = validateScript(added)
          if (!check.ok) { trace.push(`picture "${query}" invalid: ${check.errors.slice(0, 2).join('; ')}`); continue }
          const pos = afterTitle(s.steps)
          s.steps = [...s.steps.slice(0, pos), ...check.steps, ...s.steps.slice(pos)]
          dirty.add(s.id)
          trace.push(`picture "${query}" placed in section ${s.position}`)
        } catch (err) { trace.push(`picture "${query}" failed: ${err instanceof Error ? err.message.slice(0, 80) : err}`) }
      }
    }
  }

  // Done once no clip is still on its way and drafting has finished.
  const { data: after } = await db.from('manim_jobs').select('status').eq('lesson_id', lessonId).eq('auto_insert', true)
  const pending = ((after ?? []) as { status: string }[]).some(j => !['approved', 'failed'].includes(j.status)) || ['outlining', 'drafting', 'paused'].includes(lesson.draft_status)
  await db.from('lessons').update({ style_notes: { ...(lesson.style_notes ?? {}), visual_refresh: pending ? 0 : VISUAL_REFRESH_VERSION, visual_refresh_at: new Date().toISOString() } }).eq('id', lessonId)

  if (!dirty.size) return { changed: false, trace }
  for (const s of sections.filter(x => dirty.has(x.id))) await db.from('lesson_sections').update({ steps: s.steps }).eq('id', s.id)
  await syncLessonScript(db, lessonId)
  return { changed: true, trace }
}

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
import { hasRichVisual, stageStep, stageTemplateFor, type StageTemplate } from './lesson-stages'

/** 3: live field figures (lesson-stages.ts), one clip per section, field-board re-draft (redraftFieldBoards). */
export const VISUAL_REFRESH_VERSION = 3
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
  // Still being written (incl. a quota pause): the drafting worker places clips as it releases sections.
  if (all.some(s => s.status === 'pending' || s.status === 'drafting')) return { changed: false, trace }
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
  const forSeen = new Set(js.filter(j => placed.has(j.id)).map(j => /section "([^"]+)"/.exec(j.prompt ?? '')?.[1]).filter(Boolean))
  for (const j of js) {
    if (j.status !== 'done' || !j.video_path || placed.has(j.id)) continue
    const forTitle = /section "([^"]+)"/.exec(j.prompt ?? '')?.[1]
    // A duplicate job for a section that already has its clip (concurrent queueing before the guard): withdrawn.
    if (forTitle && forSeen.has(forTitle)) { await db.from('manim_jobs').update({ status: 'failed', error: 'duplicate clip for this section (not shown)' }).eq('id', j.id); continue }
    if (forTitle) forSeen.add(forTitle)
    const own = sections.findIndex(s => s.title === forTitle)
    let k = own >= 0 && own >= at ? own : sections.findIndex((_, i) => i > at && i > 0)
    if (k < 0) k = Math.min(sections.length - 1, Math.max(own, at))
    // One clip per section: the next section without one instead.
    if (sections[k].steps.some(st => st.type === 'manim_clip')) {
      const free = sections.findIndex((x, i) => i >= k && !x.steps.some(st => st.type === 'manim_clip'))
      if (free < 0) continue
      k = free
    }
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

  // 4. Live field figures (wire field, magnet + coil, charges in a wire) for field / current lessons: the first demo
  //    section per kind (at most 2) gets the figure at its end. A stage takes over the lesson area and hands back to
  //    the board, so the section's board continues exactly as before.
  if (!sections.some(s => s.steps.some(st => st.type === 'stage'))) {
    const lessonTpl = stageTemplateFor(`${lesson.title}. ${(lesson.objectives ?? []).join('. ')}`)
    const used: StageTemplate[] = []
    const demos = sections.filter(s => (s.kind ?? 'demo') === 'demo')
    for (const s of [...demos.filter(x => x.position >= at), ...demos.filter(x => x.position < at)]) {
      if (used.length >= 2) break
      const tpl = stageTemplateFor(`${s.title}. ${s.goal}. ${(s.key_points ?? []).join('. ')}`) ?? (used.length === 0 ? lessonTpl : null)
      if (!tpl || used.includes(tpl)) continue
      const st = stageStep(tpl, `stage_${tpl}_${s.position}`)
      if (!st) continue
      s.steps = [...s.steps, st]
      used.push(tpl); dirty.add(s.id)
      trace.push(`stage ${tpl} placed in section ${s.position}`)
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

/** Field topics whose board steps draw a curve on axes instead of the field (the old "field profile" sine). */
export function fieldBoardNeedsRedraft(lesson: { title: string; objectives?: string[] | null }, s: SectionRow): boolean {
  const kind = s.kind ?? 'demo'
  if (kind !== 'demo' && kind !== 'example') return false
  const text = `${lesson.title}. ${s.title}. ${s.goal}. ${(s.key_points ?? []).join('. ')}`
  if (!readVisual(text).families.includes('field') && !stageTemplateFor(text)) return false
  if (hasRichVisual(s.steps)) return false
  const kinds = s.steps.filter(st => st.type === 'draw').map(st => (st as { shape?: { kind?: string } }).shape?.kind)
  const arrows = kinds.filter(k => k === 'arrow' || k === 'vector').length
  const curves = kinds.filter(k => k === 'function' || k === 'axes' || k === 'parametric').length
  return curves > 0 && arrows < 3
}

/**
 * Versioned re-draft of an owner's older lesson (style_notes.visual_redraft): demo / example sections about fields
 * whose board only plots a curve are written again with today's beat drafter (which draws field lines / arrows that
 * move, and adds a live figure or picture), chapter by chapter so the board stays consistent. Titles, objectives,
 * checks and the learner's progress are kept; a kept check whose board references no longer exist keeps only its
 * valid steps. At most 2 chapters per lesson per run. Per learner: only this learner's own lesson is touched.
 */
export const VISUAL_REDRAFT_VERSION = 1
export async function redraftFieldBoards(db: SupabaseClient, lessonId: string, ownerId: string, trace: string[] = []): Promise<{ redrafted: number; trace: string[] }> {
  const { data: l } = await db.from('lessons').select('id, title, subject, objectives, owner_student_id, generated_by, draft_status, style_notes').eq('id', lessonId).maybeSingle()
  const lesson = l as { id: string; title: string; subject: string; objectives: string[] | null; owner_student_id: string | null; generated_by: string; draft_status: string; style_notes: Record<string, unknown> | null } | null
  if (!lesson || lesson.owner_student_id !== ownerId || lesson.generated_by !== 'ai') return { redrafted: 0, trace }
  if (((lesson.style_notes as { visual_redraft?: number } | null)?.visual_redraft ?? 0) >= VISUAL_REDRAFT_VERSION) return { redrafted: 0, trace }
  if (['outlining', 'drafting'].includes(lesson.draft_status)) return { redrafted: 0, trace }
  const { draftBeat } = await import('./lesson-beats')
  const { toPlan } = await import('./lesson-drafting')
  const { withLlmContext } = await import('./agent/pool')
  const all = (await loadSections(db, lessonId)).filter(s => s.status === 'ready' && Array.isArray(s.steps))
  const chapterOf = (s: SectionRow) => s.chapter ?? s.title
  const chapters = [...new Set(all.filter(s => fieldBoardNeedsRedraft(lesson, s)).map(chapterOf))].slice(0, 2)
  const lite = { title: lesson.title, subject: lesson.subject, objectives: lesson.objectives ?? [] }
  const plan = all.map(toPlan)
  let redrafted = 0
  for (const ch of chapters) {
    const secs = all.filter(s => chapterOf(s) === ch)
    const board: Step[] = []
    const firstInLesson = all[0]?.id === secs[0]?.id
    for (const [k, s] of secs.entries()) {
      const kind = s.kind ?? 'demo'
      if (kind === 'check' || kind === 'your_turn') {
        // Kept as written; steps that pointed at the old board are dropped (the check itself stays).
        const v = validateScript(s.steps, { knownIds: board.flatMap(st => (st as { id?: string }).id ? [(st as { id: string }).id] : []) })
        if (v.steps.length !== s.steps.length && v.steps.some(st => st.type === 'check')) { s.steps = v.steps; await db.from('lesson_sections').update({ steps: s.steps }).eq('id', s.id) }
        board.push(...s.steps)
        continue
      }
      try {
        const index = all.findIndex(x => x.id === s.id)
        let steps = await withLlmContext({ priority: 'background', learnerId: ownerId, label: 'lesson-redraft' }, () => draftBeat({ lesson: lite, plan, index, board: k === 0 ? [] : [...board], recentSay: '', chapterStart: k === 0, deadline: Date.now() + 60_000 }))
        if (k === 0 && !firstInLesson && !(steps[0]?.type === 'clear' && !(steps[0] as { targets?: string[] }).targets)) steps = [{ type: 'clear' } as Step, ...steps]
        s.steps = steps
        await db.from('lesson_sections').update({ steps }).eq('id', s.id)
        redrafted++
        trace.push(`redrafted section ${s.position} (${s.title.slice(0, 40)})`)
      } catch (err) {
        trace.push(`section ${s.position} kept: ${err instanceof Error ? err.message.slice(0, 80) : err}`)
      }
      board.push(...s.steps)
    }
  }
  await db.from('lessons').update({ style_notes: { ...(lesson.style_notes ?? {}), visual_redraft: VISUAL_REDRAFT_VERSION, visual_redraft_at: new Date().toISOString(), visual_redraft_sections: redrafted } }).eq('id', lessonId)
  if (redrafted) await syncLessonScript(db, lessonId)
  return { redrafted, trace }
}

export function needsRedraft(styleNotes: unknown): boolean {
  return ((styleNotes as { visual_redraft?: number } | null)?.visual_redraft ?? 0) < VISUAL_REDRAFT_VERSION
}

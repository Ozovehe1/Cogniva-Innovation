import { getSessionProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { CATEGORIES, SURFACES, illustrationIdFromSrc, recheck, type Category, type Surface } from '@/lib/correctness/reports'
import type { Block } from '@/lib/agent/types'

export const dynamic = 'force-dynamic'

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

/**
 * POST /api/reports — a learner reports a mistake in something GeniusMap showed them.
 * { surface, category?, note?, artefact, lessonId?, stepIndex?, sessionId?, blockId?, blockKind?, text?, query?, clipJobId? }
 * The exact artefact is taken from the database where it lives (the chat message's block, the lesson's step) and
 * otherwise from the client. The artefact is flagged for this learner at once (chat blocks are marked flagged; lesson
 * steps are hidden on reload) and the reply says how to offer a corrected retry.
 */
export async function POST(request: Request) {
  const { profile } = await getSessionProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const surface = body.surface as Surface
  if (!SURFACES.includes(surface)) return Response.json({ error: 'Unknown surface' }, { status: 400 })
  const category = CATEGORIES.includes(body.category as Category) ? body.category as Category : null
  const note = str(body.note, 600) || null
  const admin = createAdminClient()
  // Ten reports a day per learner is plenty; more is noise (or a stuck button).
  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { count } = await admin.from('mistake_reports').select('id', { count: 'exact', head: true }).eq('student_id', profile.id).gte('created_at', since)
  if ((count ?? 0) >= 30) return Response.json({ error: 'Thanks — you have sent a lot of reports today. We are reading them.' }, { status: 429 })

  let artefact: Record<string, unknown> = body.artefact && typeof body.artefact === 'object' ? body.artefact as Record<string, unknown> : {}
  if (JSON.stringify(artefact).length > 120_000) artefact = { truncated: true, kind: (artefact as { kind?: unknown }).kind ?? null }
  let lessonId = isUuid(body.lessonId) ? body.lessonId : null
  const sessionId = isUuid(body.sessionId) ? body.sessionId : null
  const blockId = str(body.blockId, 40) || null
  let model: string | null = null
  let trace: unknown = null
  let problem = ''
  let artefactKey: string | null = null
  let messageRow: { id: number; blocks: Block[] | null; meta: Record<string, unknown> | null; content: string } | null = null

  if (sessionId) {
    const { data: s } = await admin.from('chat_sessions').select('id, lesson_id').eq('id', sessionId).eq('student_id', profile.id).maybeSingle()
    if (!s) return Response.json({ error: 'Not found' }, { status: 404 })
    lessonId = lessonId ?? (s.lesson_id as string | null)
    const { data: msgs } = await admin.from('chat_messages').select('id, role, content, blocks, meta').eq('session_id', sessionId).order('id', { ascending: false }).limit(60)
    const rows = (msgs ?? []) as { id: number; role: string; content: string; blocks: Block[] | null; meta: Record<string, unknown> | null }[]
    const text = str(body.text, 4000)
    const idx = rows.findIndex(m => m.role === 'assistant' && (blockId ? (m.blocks ?? []).some(b => b.id === blockId) : !!text && m.content.slice(0, 200) === text.slice(0, 200)))
    if (idx >= 0) {
      messageRow = rows[idx]
      const userMsg = rows.slice(idx + 1).find(m => m.role === 'user')
      problem = userMsg?.content.slice(0, 600) ?? ''
      const block = blockId ? (messageRow.blocks ?? []).find(b => b.id === blockId) : null
      artefact = { ...(block ? { block } : { text: messageRow.content }), question: problem }
      model = typeof messageRow.meta?.model === 'string' ? messageRow.meta.model : null
      trace = messageRow.meta?.tools ?? null
    }
    artefactKey = `chat:${sessionId}:${blockId ?? `msg${messageRow?.id ?? 'x'}`}`
  }
  if (lessonId) {
    const { data: l } = await admin.from('lessons').select('id, title, owner_student_id, status').eq('id', lessonId).maybeSingle()
    if (!l || (l.owner_student_id && l.owner_student_id !== profile.id)) lessonId = null
    else if (!sessionId) {
      const stepIndex = Number.isInteger(body.stepIndex) ? Number(body.stepIndex) : null
      artefactKey = `lesson:${lessonId}:step:${stepIndex ?? 'x'}`
      problem = str(l.title, 200)
      // The lesson's own models (per section) as the trace.
      const { data: secs } = await admin.from('lesson_sections').select('position, draft_model, title').eq('lesson_id', lessonId).order('position').limit(40)
      const models = [...new Set((secs ?? []).map(x => x.draft_model).filter(Boolean))]
      model = (models[0] as string | undefined) ?? null
      trace = { sections: (secs ?? []).map(x => ({ position: x.position, model: x.draft_model, title: x.title })) }
    }
  }
  const step = artefact.step as { shape?: { kind?: string; src?: string } } | undefined
  const figureSrc = step?.shape?.kind === 'figure' ? step.shape.src : (artefact.block as { url?: string } | undefined)?.url
  const illustrationId = str(body.illustrationId, 200) || await illustrationIdFromSrc(figureSrc) || null
  // The topic the picture was for: the lesson's title, or the learner's question in Ask (the blocklist matches by topic words).
  const query = str(body.query, 200) || (illustrationId ? str(problem || (artefact.block as { alt?: string } | undefined)?.alt || (step?.shape as { alt?: string } | undefined)?.alt || '', 200) : '') || null
  const clipJobId = isUuid(body.clipJobId) ? body.clipJobId : isUuid((artefact.block as { jobId?: string } | undefined)?.jobId) ? (artefact.block as { jobId: string }).jobId : null
  if (clipJobId) {
    const { data: job } = await admin.from('manim_jobs').select('prompt, status, verdict, error, scene_name').eq('id', clipJobId).maybeSingle()
    if (job) artefact = { ...artefact, prompt: job.prompt, render_status: job.status, verdict: job.verdict, render_error: typeof job.error === 'string' ? job.error.slice(0, 1500) : null }
  }
  if (illustrationId) artefactKey = artefactKey ?? `illus:${illustrationId}`
  const guard = recheck(artefact, problem)

  const { data: row, error } = await admin.from('mistake_reports').insert({
    student_id: profile.id, surface, category, note, artefact, artefact_key: artefactKey, lesson_id: lessonId,
    step_index: Number.isInteger(body.stepIndex) ? body.stepIndex : null, chat_session_id: sessionId, block_id: blockId,
    illustration_id: illustrationId, clip_job_id: clipJobId, query, model, trace, guard,
  }).select('id').single()
  if (error || !row) return Response.json({ error: 'Could not save the report. Please try again.' }, { status: 500 })

  // Flag the artefact for this learner straight away (their own chat history only).
  if (messageRow) {
    const flagged = { reportId: row.id, category }
    if (blockId) await admin.from('chat_messages').update({ blocks: (messageRow.blocks ?? []).map(b => (b.id === blockId ? { ...b, flagged } : b)) }).eq('id', messageRow.id)
    else await admin.from('chat_messages').update({ meta: { ...(messageRow.meta ?? {}), flagged } }).eq('id', messageRow.id)
  }
  const what = surface === 'illustration' ? 'picture' : surface === 'animation' ? 'animation' : surface === 'diagram' || surface === 'stage' ? 'diagram' : surface === 'check' || surface === 'mastery' || surface === 'practice' ? 'question' : 'explanation'
  return Response.json({
    id: row.id,
    guard: { flagged: guard.flagged },
    retry: { prompt: `The ${what} you just showed me had a mistake${category ? ` (${category.replace('_', ' ')})` : ''}${note ? `: ${note}` : ''}. Please redo it correctly${what === 'picture' ? ' with a different, correct picture' : ''}, and check the maths.` },
  })
}

/** GET /api/reports?lessonId=… — this learner's open/confirmed reports on a lesson (steps to hide on reload). */
export async function GET(request: Request) {
  const { profile } = await getSessionProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const lessonId = new URL(request.url).searchParams.get('lessonId')
  if (!isUuid(lessonId)) return Response.json({ reports: [] })
  const { data } = await createAdminClient().from('mistake_reports').select('id, step_index, category, surface, status').eq('student_id', profile.id).eq('lesson_id', lessonId).neq('status', 'invalid').limit(100)
  return Response.json({ reports: data ?? [] })
}

import { getAdmin } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { caseFromReport, feedBlocklist, sceneCaseFromReport, type ReportRow } from '@/lib/correctness/reports'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/reports/:id   (admin only)
 *   { action: 'confirm', note?, avoid? }  confirmed: feeds the blocklist (wrong picture for the topic, failed clip spec, an
 *                                         optional "avoid" line for the writers)
 *   { action: 'invalid', note? }          not a mistake: the learner's flag is lifted on their next load
 *   { action: 'regress' }                 confirm (if open) and add an anonymised case to the regression set
 *   { action: 'reopen' }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await getAdmin()
  if (!who) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  const body = await request.json().catch(() => ({})) as { action?: string; note?: string; avoid?: string }
  const admin = createAdminClient()
  const { data } = await admin.from('mistake_reports').select('*').eq('id', id).maybeSingle()
  const r = data as ReportRow | null
  if (!r) return Response.json({ error: 'Not found' }, { status: 404 })
  const note = typeof body.note === 'string' ? body.note.slice(0, 600) : null
  const now = new Date().toISOString()

  if (body.action === 'invalid' || body.action === 'reopen') {
    await admin.from('mistake_reports').update({ status: body.action === 'invalid' ? 'invalid' : 'open', triage_note: note ?? r.triage_note, triaged_at: now }).eq('id', id)
    // Not a mistake: lift the flag from the learner's chat message (lesson steps read the report status on load).
    if (body.action === 'invalid' && r.chat_session_id) {
      const { data: msgs } = await admin.from('chat_messages').select('id, blocks, meta').eq('session_id', r.chat_session_id).eq('role', 'assistant').limit(80)
      for (const m of (msgs ?? []) as { id: number; blocks: { id: string; flagged?: { reportId?: string } }[] | null; meta: { flagged?: { reportId?: string } } | null }[]) {
        if (m.meta?.flagged?.reportId === id) { const { flagged: _f, ...meta } = m.meta; void _f; await admin.from('chat_messages').update({ meta }).eq('id', m.id) }
        if ((m.blocks ?? []).some(b => b.flagged?.reportId === id)) await admin.from('chat_messages').update({ blocks: (m.blocks ?? []).map(b => { if (b.flagged?.reportId !== id) return b; const { flagged: _g, ...rest } = b; void _g; return rest }) }).eq('id', m.id)
      }
    }
    return Response.json({ ok: true, status: body.action === 'invalid' ? 'invalid' : 'open' })
  }
  if (body.action === 'confirm' || body.action === 'regress') {
    let blocked = 0
    if (r.status !== 'confirmed') {
      blocked = await feedBlocklist(admin, r, body.avoid)
      await admin.from('mistake_reports').update({ status: 'confirmed', triage_note: note ?? r.triage_note, triaged_at: now }).eq('id', id)
    } else if (body.avoid) blocked = await feedBlocklist(admin, { ...r, illustration_id: null }, body.avoid)
    // A confirmed mistake on a scene-language clip becomes a regression scene right away (and feeds layout learning).
    if (!r.regression_case_id) {
      const sc = await sceneCaseFromReport(admin, r).catch(() => null)
      if (sc) {
        const { data: row } = await admin.from('regression_cases').insert({ source: 'report', report_id: r.id, kind: sc.kind, title: sc.title, input: sc.input, expect: sc.expect }).select('id').single()
        if (row) {
          await admin.from('mistake_reports').update({ regression_case_id: row.id }).eq('id', id)
          return Response.json({ ok: true, status: 'confirmed', caseId: row.id, scene: true, blocked })
        }
      }
    }
    if (body.action === 'confirm') return Response.json({ ok: true, status: 'confirmed', blocked })
    if (r.regression_case_id) return Response.json({ ok: true, status: 'confirmed', caseId: r.regression_case_id, already: true })
    // The learner's name is scrubbed from the artefact along with every id.
    const { data: p } = r.student_id ? await admin.from('profiles').select('full_name').eq('id', r.student_id).maybeSingle() : { data: null }
    const names = String((p as { full_name?: string } | null)?.full_name ?? '').split(/\s+/).filter(Boolean)
    const c = caseFromReport({ ...r, status: 'confirmed' }, names)
    const { data: row, error } = await admin.from('regression_cases').insert({ source: 'report', report_id: r.id, kind: c.kind, title: c.title, input: c.input, expect: c.expect }).select('id').single()
    if (error || !row) return Response.json({ error: `Could not add the case: ${error?.message ?? 'unknown'}` }, { status: 500 })
    await admin.from('mistake_reports').update({ regression_case_id: row.id }).eq('id', id)
    return Response.json({ ok: true, status: 'confirmed', caseId: row.id, blocked })
  }
  return Response.json({ error: 'Unknown action' }, { status: 400 })
}

import { getAdmin } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { BULLET_COLS, bulletEmbedText, clearPlaybookCache, embedOne, logEvent, rowToBullet, topicKey } from '@/lib/playbook/store'
import { privacyCheck } from '@/lib/playbook/privacy'
import { gateBullet, lintBullet } from '@/lib/playbook/gate'
import { withLlmContext } from '@/lib/agent/pool'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/admin/playbook/:id   (admins only: ADMIN_EMAILS)
 *   { action: 'approve' }            make live now (admin override of the gate; recorded with the admin's email)
 *   { action: 'retire' }             take a live bullet out of every prompt
 *   { action: 'reject' }             drop a candidate
 *   { action: 'restore' }            back to candidate (from retired / rejected)
 *   { action: 'gate' }               run the batch gate again now (live on pass)
 *   { action: 'edit', text }         reword (privacy + lint checked); goes back to candidate and must pass the gate again
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await getAdmin()
  if (!who) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  const body = await request.json().catch(() => ({})) as { action?: string; text?: string }
  const admin = createAdminClient()
  const { data } = await admin.from('playbook_bullets').select(BULLET_COLS).eq('id', id).maybeSingle()
  if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
  const b = rowToBullet(data as Record<string, unknown>)
  const now = new Date().toISOString()
  const actor = who.email
  const set = async (upd: Record<string, unknown>, op: string, detail: Record<string, unknown> = {}) => {
    await admin.from('playbook_bullets').update({ ...upd, updated_at: now, decided_by: actor }).eq('id', id)
    await logEvent(admin, id, op, detail, actor)
    clearPlaybookCache()
  }
  switch (body.action) {
    case 'approve': {
      const pv = privacyCheck(b.text)
      if (!pv.ok) return Response.json({ error: `Privacy check failed: ${pv.problems.join('; ')}` }, { status: 400 })
      await set({ status: 'live', live_at: now, gate: { ...(b.gate ?? {}), pass: true, stage: 'admin', reason: `approved by ${actor}`, at: now } }, 'live', { via: 'admin approve' })
      return Response.json({ ok: true, status: 'live' })
    }
    case 'retire': await set({ status: 'retired', retired_at: now }, 'retire', { via: 'admin' }); return Response.json({ ok: true, status: 'retired' })
    case 'reject': await set({ status: 'rejected' }, 'reject', { via: 'admin' }); return Response.json({ ok: true, status: 'rejected' })
    case 'restore': await set({ status: 'candidate', retired_at: null, gate_attempts: 0 }, 'restore'); return Response.json({ ok: true, status: 'candidate' })
    case 'gate': {
      // An admin is waiting on this one: Ask-class priority in the pool.
      const v = await withLlmContext({ priority: 'ask', label: 'playbook-gate' }, () => gateBullet(admin, b, { actor, deadline: Date.now() + 240_000 }))
      return Response.json({ ok: true, verdict: v })
    }
    case 'edit': {
      const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim().slice(0, 400) : ''
      if (text.length < 12) return Response.json({ error: 'Write the rule in at least a short sentence.' }, { status: 400 })
      const pv = privacyCheck(text)
      if (!pv.ok) return Response.json({ error: `Privacy check failed: ${pv.problems.join('; ')}` }, { status: 400 })
      const lint = lintBullet(text)
      if (lint.length) return Response.json({ error: `This reads as harmful teaching: ${lint.join('; ')}` }, { status: 400 })
      const vec = await embedOne(bulletEmbedText({ ...b, text }))
      await set({ text, status: 'candidate', version: b.version + 1, gate: null, gate_attempts: 0, topic_key: topicKey(`${b.topic} ${b.skill}`), embedding: vec ? JSON.stringify(vec) : null }, 'edit', { from: b.text })
      return Response.json({ ok: true, status: 'candidate' })
    }
  }
  return Response.json({ error: 'Unknown action' }, { status: 400 })
}

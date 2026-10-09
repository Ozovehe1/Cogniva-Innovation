'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Check, FlaskConical, Pencil, RotateCcw, X } from 'lucide-react'
import { Spinner, buttonClass, cx, textareaClass } from '@/components/ui'

/** One primary action per state: candidate → Run gate (or approve), live → Retire, rejected/retired → Restore. */
export function BulletActions({ id, status, text }: { id: string; status: string; text: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const act = async (action: string) => {
    setBusy(action); setMsg(null)
    const r = await fetch(`/api/admin/playbook/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, text: action === 'edit' ? draft : undefined }) })
    const j = await r.json().catch(() => ({})) as { error?: string; status?: string; verdict?: { pass: boolean; stage: string; reason: string } }
    setBusy(null)
    if (!r.ok) { setMsg(j.error ?? 'That didn’t work.'); return }
    setMsg(j.verdict ? `${j.verdict.pass ? 'Passed — now live.' : 'Not passed.'} ${j.verdict.reason}` : action === 'edit' ? 'Reworded. It goes back through the gate.' : `Now ${j.status}.`)
    setEditing(false)
    router.refresh()
  }
  const btn = (action: string, label: string, Icon: typeof Check, variant: 'primary' | 'secondary' | 'ghost') => (
    <button type="button" disabled={!!busy} onClick={() => act(action)} className={cx(buttonClass(variant, 'md'), 'min-h-11')}>{busy === action ? <Spinner /> : <Icon className="h-4 w-4" />}{label}</button>
  )
  return (
    <div className="mt-5 rounded-[14px] border border-line bg-[#FBFAF7] p-3">
      {editing ? (
        <div>
          <label htmlFor={`edit-${id}`} className="block text-[12.5px] font-medium text-ink-2">Reword the rule <span className="font-normal text-muted">(abstract only: no learner names, words or answers)</span></label>
          <textarea id={`edit-${id}`} value={draft} onChange={e => setDraft(e.target.value)} rows={3} maxLength={400} className={cx(textareaClass, 'mt-1.5 text-[14px]')} />
          <div className="mt-2 grid grid-cols-2 gap-2 sm:flex">
            {btn('edit', 'Save', Check, 'primary')}
            <button type="button" onClick={() => { setEditing(false); setDraft(text) }} className={cx(buttonClass('ghost', 'md'), 'min-h-11')}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {status === 'candidate' && btn('gate', 'Run gate', FlaskConical, 'primary')}
          {status === 'candidate' && btn('approve', 'Approve', Check, 'secondary')}
          {status === 'candidate' && btn('reject', 'Reject', X, 'ghost')}
          {status === 'live' && btn('retire', 'Retire', Archive, 'secondary')}
          {(status === 'rejected' || status === 'retired') && btn('restore', 'Restore', RotateCcw, 'secondary')}
          <button type="button" disabled={!!busy} onClick={() => setEditing(true)} className={cx(buttonClass('ghost', 'md'), 'min-h-11')}><Pencil className="h-4 w-4" />Reword</button>
        </div>
      )}
      {busy === 'gate' && <p className="mt-2 text-[13px] text-muted" role="status">Writing probe lessons with and without this rule… about a minute.</p>}
      {msg && <p className="mt-2 text-[13px] text-ink-2" role="status">{msg}</p>}
    </div>
  )
}

'use client'
import { useState } from 'react'
import { Check, Undo2 } from 'lucide-react'
import { RichText } from '@/components/rich-text'
import { buttonClass, cx, Spinner } from '@/components/ui'

const frame = 'overflow-hidden rounded-[14px] border border-line bg-surface shadow-[var(--shadow-card)]'
const label = 'text-[11px] font-medium uppercase tracking-[0.08em] text-muted'

/* ───────────── One-tap confirm with undo ───────────── */

export function ConfirmBlock({ block, compact }: { block: { actionId: string; title: string; detail: string; status: string }; compact?: boolean }) {
  const [status, setStatus] = useState(block.status)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const act = async (op: 'confirm' | 'decline' | 'undo') => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/agent/actions/${block.actionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op }) })
      const j = await r.json()
      if (!r.ok) setErr(j.error ?? 'Could not do that'); else setStatus(j.status)
    } finally { setBusy(false) }
  }
  return (
    <div className={cx(compact ? '' : frame, compact ? '' : 'border-amber-line bg-amber-soft p-4')}>
      {!compact && <p className={cx(label, 'text-amber')}>Needs your OK</p>}
      <p className={cx('font-medium leading-snug text-ink', compact ? 'text-[15px]' : 'mt-1 text-[16px]')}><RichText text={block.title} /></p>
      {block.detail && <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2"><RichText text={block.detail} /></p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {status === 'proposed' && <>
          <button type="button" disabled={busy} onClick={() => act('confirm')} className={buttonClass('primary', 'sm')}>{busy ? <Spinner /> : <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}Confirm</button>
          <button type="button" disabled={busy} onClick={() => act('decline')} className={buttonClass('ghost', 'sm')}>Not now</button>
        </>}
        {status === 'done' && <>
          <span className="inline-flex items-center gap-1 text-[13px] font-medium text-accent"><Check className="h-3.5 w-3.5" strokeWidth={2.5} />Done</span>
          <button type="button" disabled={busy} onClick={() => act('undo')} className={buttonClass('ghost', 'sm')}><Undo2 className="h-3.5 w-3.5" />Undo</button>
        </>}
        {status === 'undone' && <span className="text-[13px] text-muted">Undone.</span>}
        {status === 'declined' && <span className="text-[13px] text-muted">Okay, left as it was.</span>}
      </div>
      {err && <p className="mt-2 text-[13px] text-danger">{err}</p>}
    </div>
  )
}


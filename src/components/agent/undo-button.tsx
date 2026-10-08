'use client'
import { useState } from 'react'
import { Undo2 } from 'lucide-react'
import { Spinner } from '@/components/ui'

export function UndoButton({ actionId }: { actionId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | string>('idle')
  if (state === 'done') return <span className="flex-shrink-0 text-[12px] text-muted">Undone</span>
  return (
    <span className="flex flex-shrink-0 items-center gap-1.5">
      {state !== 'idle' && state !== 'busy' && <span className="text-[12px] text-danger">{state}</span>}
      <button type="button" disabled={state === 'busy'} onClick={async () => {
        setState('busy')
        const r = await fetch(`/api/agent/actions/${actionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'undo' }) })
        const j = await r.json().catch(() => ({}))
        setState(r.ok ? 'done' : j.error ?? 'Could not undo')
      }} className="inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[12.5px] font-medium text-accent hover:bg-accent-soft">
        {state === 'busy' ? <Spinner /> : <Undo2 className="h-3.5 w-3.5" />}Undo
      </button>
    </span>
  )
}

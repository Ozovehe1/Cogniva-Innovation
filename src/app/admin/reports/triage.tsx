'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, FlaskConical, RotateCcw, X } from 'lucide-react'
import { AgentBlock, SvgBlock } from '@/components/agent/blocks'
import { WhiteboardPlayer } from '@/components/whiteboard'
import { RichText } from '@/components/rich-text'
import { Spinner, buttonClass, cx, inputClass } from '@/components/ui'
import type { Block } from '@/lib/agent/types'
import type { Step } from '@/lib/lesson-schema'

/** Confirm / not a mistake / add to the regression set — one click each. */
export function TriageActions({ id, status, inRegression }: { id: string; status: string; inRegression: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [avoid, setAvoid] = useState('')
  const act = async (action: string) => {
    setBusy(action); setMsg(null)
    const r = await fetch(`/api/admin/reports/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, avoid: avoid.trim() || undefined }) })
    const j = await r.json().catch(() => ({})) as { error?: string; caseId?: string; blocked?: number; already?: boolean }
    setBusy(null)
    if (!r.ok) { setMsg(j.error ?? 'That didn’t work.'); return }
    setMsg(action === 'regress' ? (j.already ? 'Already in the regression set.' : `Added to the regression set${j.blocked ? ` · ${j.blocked} blocklist entr${j.blocked === 1 ? 'y' : 'ies'}` : ''}.`) : action === 'confirm' ? `Confirmed${j.blocked ? ` · ${j.blocked} blocklist entr${j.blocked === 1 ? 'y' : 'ies'}` : ''}.` : action === 'invalid' ? 'Marked as not a mistake; the learner’s flag is lifted.' : 'Reopened.')
    router.refresh()
  }
  return (
    <div className="mt-5 rounded-[14px] border border-line bg-[#FBFAF7] p-3">
      <label className="block text-[12.5px] font-medium text-ink-2" htmlFor={`avoid-${id}`}>Avoid line for the writers <span className="font-normal text-muted">(optional, on confirm)</span></label>
      <input id={`avoid-${id}`} value={avoid} onChange={e => setAvoid(e.target.value)} placeholder="e.g. Never draw the refracted ray on the incident side of the normal" className={cx(inputClass, 'mt-1.5 h-11 text-[14px]')} />
      <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {status !== 'confirmed' && <button type="button" disabled={!!busy} onClick={() => act('confirm')} className={cx(buttonClass('secondary', 'md'), 'min-h-11')}>{busy === 'confirm' ? <Spinner /> : <Check className="h-4 w-4" />}Confirm</button>}
        {status !== 'invalid' && <button type="button" disabled={!!busy} onClick={() => act('invalid')} className={cx(buttonClass('ghost', 'md'), 'min-h-11')}>{busy === 'invalid' ? <Spinner /> : <X className="h-4 w-4" />}Not a mistake</button>}
        {status === 'invalid' && <button type="button" disabled={!!busy} onClick={() => act('reopen')} className={cx(buttonClass('ghost', 'md'), 'min-h-11')}>{busy === 'reopen' ? <Spinner /> : <RotateCcw className="h-4 w-4" />}Reopen</button>}
        {!inRegression && status !== 'invalid' && <button type="button" disabled={!!busy} onClick={() => act('regress')} className={cx(buttonClass('primary', 'md'), 'col-span-2 min-h-11')}>{busy === 'regress' ? <Spinner /> : <FlaskConical className="h-4 w-4" />}Add to regression set</button>}
      </div>
      {inRegression && !msg && <p className="mt-2 flex items-start gap-1.5 text-[13px] leading-snug text-ink-2"><FlaskConical className="mt-px h-4 w-4 flex-shrink-0 text-accent" /><span>In the regression set: it runs with the <code className="rounded bg-sunken px-1 text-[12px]">regression</code> eval group.</span></p>}
      {msg && <p className="mt-2 text-[13px] text-ink-2" role="status">{msg}</p>}
    </div>
  )
}

/** The artefact as the learner saw it: a chat block through the chat renderer, lesson steps on a board, text as text. */
export function ArtefactView({ artefact }: { artefact: Record<string, unknown> }) {
  const a = artefact as { block?: Block; step?: Step; steps?: Step[]; text?: string; question?: string; options?: string[]; answer?: string; prompt?: string; verdict?: unknown; render_error?: string | null }
  return (
    <div className="space-y-3">
      {a.question && <p className="rounded-[12px] bg-sunken px-3 py-2 text-[14px] text-ink-2"><span className="text-muted">Asked: </span><RichText text={a.question} /></p>}
      {a.options && <ol className="list-[upper-alpha] space-y-0.5 pl-6 text-[14px] text-ink-2">{a.options.map((o, i) => <li key={i}><RichText text={o} /></li>)}</ol>}
      {a.answer && <p className="text-[14px] text-ink-2">Answer shown: <RichText text={a.answer} /></p>}
      {a.text && <div className="rounded-[12px] border border-line px-3 py-2 text-[14.5px] leading-relaxed text-ink"><RichText text={a.text} /></div>}
      {a.block && (a.block.kind === 'svg' ? <SvgBlock svg={a.block.svg} alt={a.block.alt} credit={a.block.credit} url={a.block.url} /> : <AgentBlock block={a.block} />)}
      {a.steps && a.steps.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-line">
          <p className="border-b border-line px-3 py-2 text-[12px] text-muted">The board up to the reported step ({a.steps.length} steps)</p>
          <div className="p-2"><WhiteboardPlayer steps={a.steps} initialIndex={a.steps.length} allowSkipChecks embedded /></div>
        </div>
      )}
      {!a.steps && a.step && <pre className="max-h-48 overflow-auto rounded-[12px] bg-sunken p-3 font-mono text-[11.5px] text-ink-2">{JSON.stringify(a.step, null, 2).slice(0, 4000)}</pre>}
      {a.prompt && <p className="text-[13.5px] text-ink-2"><span className="text-muted">Clip prompt: </span>{String(a.prompt).slice(0, 400)}</p>}
      {(a.verdict || a.render_error) ? <p className="text-[13px] text-muted">Render: {JSON.stringify(a.verdict ?? a.render_error).slice(0, 300)}</p> : null}
    </div>
  )
}

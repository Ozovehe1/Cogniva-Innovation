'use client'
import React, { useState } from 'react'
import { AlertTriangle, ChevronDown, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { Alert, Badge, Card, ProgressBar, Spinner, buttonClass, cx, inputClass, labelClass, textareaClass } from '@/components/ui'
import { TARGET_MINUTES, estimateMs, formatDuration } from '@/lib/lesson-sections'
import type { Step } from '@/lib/lesson-schema'

export interface SectionView {
  id: string
  position: number
  title: string
  goal: string
  key_points: string[]
  minutes: number
  status: 'pending' | 'drafting' | 'ready' | 'failed'
  steps: Step[]
  notes: string | null
  error: string | null
  updated_at: string
}

export type DraftStatus = 'idle' | 'outlining' | 'drafting' | 'paused' | 'ready' | 'partial' | 'failed'

export function targetLabel(m: number) {
  return m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : m % 60 === 0 ? `${m / 60} hours` : `${Math.floor(m / 60)} h ${m % 60} min`
}

export function TargetSelect({ id, value, onChange, disabled }: { id: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const options = TARGET_MINUTES.includes(value as (typeof TARGET_MINUTES)[number]) ? TARGET_MINUTES : [...TARGET_MINUTES, value].sort((a, b) => a - b)
  return (
    <select id={id} className={inputClass} value={value} onChange={e => onChange(Number(e.target.value))} disabled={disabled}>
      {options.map(m => <option key={m} value={m}>{targetLabel(m)}</option>)}
    </select>
  )
}

const statusTone: Record<SectionView['status'], { label: string; cls: string }> = {
  pending: { label: 'Queued', cls: 'border-line bg-sunken text-ink-2' },
  drafting: { label: 'Drafting', cls: 'border-navy-line bg-navy-soft text-navy' },
  ready: { label: 'Ready', cls: 'border-accent-line bg-accent-soft text-accent' },
  failed: { label: 'Failed', cls: 'border-danger-line bg-danger-soft text-danger' },
}

function timeOf(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Overall drafting state: progress, quota pause with automatic resume, failures. */
export function DraftProgress({
  status, error, retryAt, sections, targetMinutes, onRetry, busy,
}: {
  status: DraftStatus
  error: string | null
  retryAt: string | null
  sections: SectionView[]
  targetMinutes: number | null
  onRetry: () => void
  busy: boolean
}) {
  const ready = sections.filter(s => s.status === 'ready').length
  const failed = sections.filter(s => s.status === 'failed').length
  const current = sections.find(s => s.status === 'drafting') ?? sections.find(s => s.status === 'pending')
  const retryBtn = (label: string) => (
    <button type="button" className={buttonClass('secondary', 'sm')} onClick={onRetry} disabled={busy}>
      {busy ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />} {label}
    </button>
  )

  if (status === 'outlining') {
    return (
      <Card className="flex items-center gap-3">
        <Spinner className="h-4 w-4 text-accent" />
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-ink">Planning the sections{targetMinutes ? ` for a ${targetLabel(targetMinutes)} lesson` : ''}…</p>
          <p className="mt-0.5 text-[13px] text-muted">Then each section is written on its own. You can leave this page; drafting carries on.</p>
        </div>
      </Card>
    )
  }
  if (status === 'drafting') {
    return (
      <Card>
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2.5 text-[15px] font-medium text-ink">
            <Spinner className="h-4 w-4 flex-shrink-0 text-accent" />
            <span className="truncate">Drafting section {current ? current.position + 1 : ready} of {sections.length}{current ? ` · ${current.title}` : ''}</span>
          </p>
          <span className="tnum flex-shrink-0 text-[13px] text-muted">{ready} ready</span>
        </div>
        <ProgressBar value={ready} max={sections.length || 1} className="mt-3" label="Sections drafted" />
        <p className="mt-2 text-[13px] text-muted">Each section is saved as soon as it is written; preview the ready ones below while the rest are drafted.</p>
      </Card>
    )
  }
  if (status === 'paused') {
    const t = timeOf(retryAt)
    return (
      <Alert tone="warning" title="Drafting paused: the AI quota is reached" action={retryBtn('Try now')}>
        {ready > 0 ? `${ready} of ${sections.length} sections are drafted and kept. ` : sections.length ? 'The outline is saved. ' : ''}
        Drafting resumes automatically{t ? ` from about ${t}` : ''} while this page is open, and once a day otherwise.
      </Alert>
    )
  }
  if (status === 'failed') {
    return <Alert title="The draft could not be written" action={retryBtn('Try again')}>{error ?? 'Something went wrong.'}</Alert>
  }
  if (status === 'partial' && failed > 0) {
    return (
      <Alert tone="warning" title={`${failed} section${failed === 1 ? '' : 's'} could not be drafted`} action={retryBtn('Retry failed')}>
        The other sections are ready. Retry, or regenerate the failed section with a note below.
      </Alert>
    )
  }
  return null
}

/** Section list: estimated length, status, and per-section regenerate / edit / delete. */
export function SectionsPanel({
  sections, targetMinutes, onAction, busyId, locked,
}: {
  sections: SectionView[]
  targetMinutes: number | null
  onAction: (action: 'regenerate_section' | 'update_section' | 'delete_section', sectionId: string, extra?: Record<string, unknown>) => Promise<boolean>
  busyId: string | null
  /** Outline being rewritten: no edits. */
  locked: boolean
}) {
  const [open, setOpen] = useState<string | null>(null)
  const totalMs = sections.reduce((a, s) => a + (s.status === 'ready' ? estimateOf(s) : s.minutes * 60_000), 0)
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink">Sections</h2>
        <p className="tnum text-[13px] text-muted">
          About {formatDuration(totalMs)}{targetMinutes ? ` · target ${targetLabel(targetMinutes)}` : ''}
        </p>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">Each section starts on a clean board. Regenerate or edit one without touching the rest.</p>
      <ol className="mt-4 divide-y divide-line rounded-[12px] border border-line">
        {sections.map(s => (
          <SectionRow
            key={s.id}
            s={s}
            open={open === s.id}
            onToggle={() => setOpen(o => (o === s.id ? null : s.id))}
            onAction={onAction}
            busy={busyId === s.id}
            locked={locked}
            canDelete={sections.length > 1}
          />
        ))}
      </ol>
    </Card>
  )
}

function estimateOf(s: SectionView) {
  return s.status === 'ready' && s.steps.length ? estimateMs(s.steps) : s.minutes * 60_000
}

function SectionRow({
  s, open, onToggle, onAction, busy, locked, canDelete,
}: {
  s: SectionView
  open: boolean
  onToggle: () => void
  onAction: (action: 'regenerate_section' | 'update_section' | 'delete_section', sectionId: string, extra?: Record<string, unknown>) => Promise<boolean>
  busy: boolean
  locked: boolean
  canDelete: boolean
}) {
  const [notes, setNotes] = useState(s.notes ?? '')
  const [title, setTitle] = useState(s.title)
  const [json, setJson] = useState(() => JSON.stringify(s.steps, null, 2))
  const [err, setErr] = useState<string | null>(null)
  const [mode, setMode] = useState<'regen' | 'edit'>('regen')
  const tone = statusTone[s.status]
  const ms = estimateOf(s)
  let parseError: string | null = null
  if (mode === 'edit') { try { JSON.parse(json) } catch (e) { parseError = e instanceof Error ? e.message : 'Invalid JSON' } }

  // Pick up new drafts of this section.
  const [seen, setSeen] = useState(s.updated_at)
  if (seen !== s.updated_at) { setSeen(s.updated_at); setJson(JSON.stringify(s.steps, null, 2)); setTitle(s.title) }

  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors duration-150 hover:bg-[#FBFAF7] sm:px-4">
        <span className="tnum w-6 flex-shrink-0 text-[13px] text-faint">{String(s.position + 1).padStart(2, '0')}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] text-ink">{s.title}</span>
          <span className="tnum mt-0.5 block text-[12px] text-muted">
            {s.status === 'ready' ? `${s.steps.length} steps · about ${formatDuration(ms)}` : `planned ${formatDuration(s.minutes * 60_000)}`}
          </span>
        </span>
        <Badge className={cx('flex-shrink-0', tone.cls)}>
          {s.status === 'drafting' && <Spinner className="h-3 w-3" />}
          {s.status === 'failed' && <AlertTriangle className="h-3 w-3" strokeWidth={2} />}
          {tone.label}
        </Badge>
        <ChevronDown className={cx('h-4 w-4 flex-shrink-0 text-muted transition-transform duration-200', open && 'rotate-180')} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="border-t border-dashed border-line px-3.5 pb-4 pt-3 sm:px-4">
          {s.goal && <p className="text-[13px] leading-relaxed text-ink-2"><span className="font-medium text-ink">Goal:</span> {s.goal}</p>}
          {s.key_points?.length > 0 && <p className="mt-1 text-[13px] leading-relaxed text-muted">{s.key_points.join(' · ')}</p>}
          {s.error && <p className="mt-2 text-[13px] text-danger">{s.error}</p>}
          <div className="mt-3 flex gap-1" role="tablist" aria-label="Section actions">
            {(['regen', 'edit'] as const).map(m => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                className={cx('h-8 rounded-full px-3 text-[13px] font-medium transition-colors', mode === m ? 'bg-sunken text-ink' : 'text-muted hover:text-ink')}>
                {m === 'regen' ? 'Regenerate' : 'Edit'}
              </button>
            ))}
          </div>
          {mode === 'regen' ? (
            <div className="mt-3">
              <label htmlFor={`notes-${s.id}`} className={labelClass}>Notes for this section <span className="font-normal text-faint">(optional)</span></label>
              <textarea id={`notes-${s.id}`} rows={2} className={textareaClass} value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} placeholder="e.g. Slower; start from a worked example." />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={buttonClass('primary', 'sm')} disabled={busy || locked || s.status === 'drafting'} onClick={async () => { setErr(null); if (!(await onAction('regenerate_section', s.id, { notes }))) setErr('Could not queue the section.') }}>
                  {busy ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />} Regenerate section
                </button>
                {canDelete && (
                  <button type="button" className={buttonClass('ghost', 'sm')} disabled={busy || locked || s.status === 'drafting'} onClick={async () => { if (confirm(`Delete section ${s.position + 1}?`)) await onAction('delete_section', s.id) }}>
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Delete
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor={`title-${s.id}`} className={labelClass}>Title</label>
                <input id={`title-${s.id}`} className={inputClass} value={title} maxLength={120} onChange={e => setTitle(e.target.value)} />
              </div>
              <div>
                <label htmlFor={`json-${s.id}`} className={labelClass}>Script <span className="font-normal text-faint">(validated on save)</span></label>
                <textarea id={`json-${s.id}`} rows={12} spellCheck={false} className={`${textareaClass} font-mono text-[12px]`} value={json} onChange={e => setJson(e.target.value)} disabled={s.status === 'drafting'} />
                {parseError && <p className="mt-1 text-[13px] text-danger">{parseError}</p>}
              </div>
              <button type="button" className={buttonClass('secondary', 'sm')} disabled={busy || locked || !!parseError || s.status === 'drafting'}
                onClick={async () => {
                  setErr(null)
                  const extra: Record<string, unknown> = { title }
                  if (json !== JSON.stringify(s.steps, null, 2)) extra.steps = JSON.parse(json)
                  if (!(await onAction('update_section', s.id, extra))) setErr('Not saved.')
                }}>
                {busy ? <Spinner /> : <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />} Save section
              </button>
            </div>
          )}
          {err && <p className="mt-2 text-[13px] text-danger">{err}</p>}
        </div>
      )}
    </li>
  )
}

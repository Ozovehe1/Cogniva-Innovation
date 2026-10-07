'use client'
import React, { useCallback, useEffect, useState } from 'react'
import { Check, Film, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { Alert, Badge, Card, Spinner, buttonClass, cx, inputClass, labelClass, textareaClass } from '@/components/ui'
import type { Step } from '@/lib/lesson-schema'

export function LessonStatusBadge({ status }: { status: string }) {
  return status === 'approved'
    ? <Badge className="border-accent-line bg-accent-soft text-accent"><span className="h-1.5 w-1.5 rounded-full bg-accent" />Approved</Badge>
    : <Badge className="border-amber-line bg-amber-soft text-amber"><span className="h-1.5 w-1.5 rounded-full bg-amber" />Draft</Badge>
}

/* ───────────── Objectives ───────────── */

export function ObjectivesEditor({
  objectives,
  busy,
  onSave,
  onRegenerate,
}: {
  objectives: string[]
  busy: null | 'save' | 'regenerate'
  onSave: (objectives: string[]) => void
  onRegenerate: (objectives: string[], notes: string) => void
}) {
  const [items, setItems] = useState<string[]>(objectives.length ? objectives : [''])
  const [notes, setNotes] = useState('')
  useEffect(() => { setItems(objectives.length ? objectives : ['']) }, [objectives])
  const clean = items.map(i => i.trim()).filter(Boolean)
  const dirty = JSON.stringify(clean) !== JSON.stringify(objectives)

  return (
    <Card>
      <h2 className="text-[15px] font-semibold text-ink">Objectives</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">The draft is written from these. Edit them, then regenerate.</p>
      <ol className="mt-4 space-y-2">
        {items.map((o, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="tnum w-5 flex-shrink-0 text-[13px] text-faint">{String(i + 1).padStart(2, '0')}</span>
            <label className="sr-only" htmlFor={`obj-${i}`}>Objective {i + 1}</label>
            <input
              id={`obj-${i}`}
              className={inputClass}
              value={o}
              maxLength={300}
              onChange={e => setItems(list => list.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button
              type="button"
              aria-label={`Remove objective ${i + 1}`}
              onClick={() => setItems(list => (list.length > 1 ? list.filter((_, j) => j !== i) : ['']))}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ol>
      {items.length < 10 && (
        <button type="button" className={buttonClass('ghost', 'sm', 'mt-2')} onClick={() => setItems(l => [...l, ''])}>
          <Plus className="h-4 w-4" strokeWidth={1.75} /> Add objective
        </button>
      )}
      <div className="mt-4">
        <label htmlFor="regen-notes" className={labelClass}>Notes for the next draft <span className="font-normal text-faint">(optional)</span></label>
        <textarea id="regen-notes" rows={2} className={textareaClass} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Use a real-world example first; slower pace." maxLength={1000} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={buttonClass('secondary', 'md')} disabled={!dirty || !!busy || clean.length === 0} onClick={() => onSave(clean)}>
          {busy === 'save' ? <Spinner /> : null} Save objectives
        </button>
        <button type="button" className={buttonClass('primary', 'md')} disabled={!!busy || clean.length === 0} onClick={() => onRegenerate(clean, notes)}>
          {busy === 'regenerate' ? <Spinner /> : <RefreshCw className="h-4 w-4" strokeWidth={1.75} />}
          {busy === 'regenerate' ? 'Regenerating…' : 'Regenerate draft'}
        </button>
      </div>
    </Card>
  )
}

/* ───────────── Animations (Manim) ───────────── */

interface Job {
  id: string
  prompt: string
  code: string | null
  status: 'queued' | 'rendering' | 'done' | 'failed' | 'approved'
  attempts: number
  error: string | null
  video_url: string | null
  created_at: string
}

const jobTone: Record<Job['status'], { label: string; cls: string }> = {
  queued: { label: 'Queued', cls: 'border-line bg-sunken text-ink-2' },
  rendering: { label: 'Rendering', cls: 'border-navy-line bg-navy-soft text-navy' },
  done: { label: 'Ready to review', cls: 'border-amber-line bg-amber-soft text-amber' },
  failed: { label: 'Failed', cls: 'border-danger-line bg-danger-soft text-danger' },
  approved: { label: 'Approved', cls: 'border-accent-line bg-accent-soft text-accent' },
}

export function AnimationsPanel({
  lessonId,
  script,
  onInserted,
}: {
  lessonId: string
  script: Step[]
  onInserted: () => void
}) {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [prompt, setPrompt] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/manim/jobs?lessonId=${lessonId}`)
    const data = await res.json().catch(() => ({}))
    if (res.ok) setJobs(data.jobs ?? [])
  }, [lessonId])

  useEffect(() => { void load() }, [load])

  // Poll while anything is in flight.
  const inFlight = jobs?.some(j => j.status === 'queued' || j.status === 'rendering')
  useEffect(() => {
    if (!inFlight) return
    const t = setInterval(() => { void load() }, 5000)
    return () => clearInterval(t)
  }, [inFlight, load])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (prompt.trim().length < 10) { setError('Describe the animation in a sentence or two.'); return }
    setError(null); setNotice(null); setCreating(true)
    try {
      const res = await fetch('/api/manim/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, lessonId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setError(data.error ?? 'Could not create the animation.')
      else {
        setPrompt('')
        if (data.warning) setNotice(data.warning)
      }
      await load()
    } finally {
      setCreating(false)
    }
  }

  const act = async (id: string, action: 'approve' | 'reject' | 'retry') => {
    setError(null)
    const res = await fetch(`/api/manim/jobs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) setError(data.error ?? 'Something went wrong.')
    await load()
  }

  const remove = async (id: string) => {
    await fetch(`/api/manim/jobs/${id}`, { method: 'DELETE' })
    await load()
  }

  const insert = async (jobId: string, afterIndex: number) => {
    setError(null)
    const res = await fetch(`/api/tutor/lessons/${lessonId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'insert_clip', jobId, afterIndex }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error ?? 'Could not add the clip.'); return }
    setNotice('Clip added to the lesson. The lesson is back in draft until you approve it again.')
    onInserted()
  }

  return (
    <Card>
      <div className="flex items-center gap-2">
        <Film className="h-4 w-4 text-muted" strokeWidth={1.75} />
        <h2 className="text-[15px] font-semibold text-ink">Animations</h2>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        For motion the whiteboard can’t draw, describe it and an animation is written and rendered with Manim. Review the clip, approve it, then place it in the lesson.
      </p>

      <form onSubmit={create} className="mt-4 space-y-3">
        <label htmlFor="anim-prompt" className={labelClass}>Describe the animation</label>
        <textarea
          id="anim-prompt"
          rows={3}
          className={textareaClass}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="e.g. A secant line through two points on y = x² rotates into the tangent at x = 1 as the second point slides in."
          maxLength={2000}
          disabled={creating}
        />
        <button type="submit" className={buttonClass('primary', 'md')} disabled={creating}>
          {creating ? <><Spinner /> Writing the animation…</> : 'Create animation'}
        </button>
      </form>

      {error && <Alert className="mt-4">{error}</Alert>}
      {notice && <Alert tone="info" className="mt-4">{notice}</Alert>}

      <ul className="mt-5 space-y-3">
        {jobs?.map(j => (
          <li key={j.id} className="rounded-[12px] border border-line bg-[#FBFAF7] p-3.5">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-sm leading-relaxed text-ink-2">{j.prompt}</p>
              <Badge className={cx('flex-shrink-0', jobTone[j.status].cls)}>
                {(j.status === 'rendering' || j.status === 'queued') && !j.error && <Spinner className="h-3 w-3" />}
                {jobTone[j.status].label}
              </Badge>
            </div>
            {j.video_url && (
              <video src={j.video_url} controls playsInline className="mt-3 aspect-video w-full rounded-[10px] bg-[#0E0E12]" />
            )}
            {j.error && (j.status === 'failed' || j.status === 'queued') && (
              <p className="mt-2 line-clamp-4 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-muted">{j.error}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {j.status === 'done' && (
                <button type="button" className={buttonClass('primary', 'sm')} onClick={() => act(j.id, 'approve')}>
                  <Check className="h-3.5 w-3.5" strokeWidth={2} /> Approve clip
                </button>
              )}
              {j.status === 'approved' && <InsertClip script={script} onInsert={after => insert(j.id, after)} />}
              {j.status === 'approved' && (
                <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => act(j.id, 'reject')}>Withdraw approval</button>
              )}
              {(j.status === 'failed' || j.status === 'queued') && (
                <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => act(j.id, 'retry')}>
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} /> Retry
                </button>
              )}
              {j.code && (
                <details className="w-full">
                  <summary className="cursor-pointer text-[13px] text-muted hover:text-ink">View code</summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-[8px] border border-line bg-surface p-3 font-mono text-[12px] leading-relaxed text-ink-2">{j.code}</pre>
                </details>
              )}
              <button type="button" aria-label="Delete animation" className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-faint hover:bg-sunken hover:text-danger" onClick={() => remove(j.id)}>
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function stepLabel(s: Step, i: number) {
  const n = String(i + 1).padStart(2, '0')
  switch (s.type) {
    case 'write': return `${n} · ${s.text.slice(0, 40)}`
    case 'math': return `${n} · ${s.tex.slice(0, 40)}`
    case 'check': return `${n} · Check: ${s.prompt.slice(0, 34)}`
    case 'draw': return `${n} · Draw ${s.shape.kind}`
    default: return `${n} · ${s.type}`
  }
}

function InsertClip({ script, onInsert }: { script: Step[]; onInsert: (afterIndex: number) => void }) {
  const [after, setAfter] = useState(script.length - 1)
  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
      <label htmlFor="insert-after" className="text-[13px] text-muted">Insert after</label>
      <select id="insert-after" className={cx(inputClass, 'h-9 text-sm sm:max-w-[260px]')} value={after} onChange={e => setAfter(Number(e.target.value))}>
        <option value={-1}>Start of lesson</option>
        {script.map((s, i) => <option key={i} value={i}>{stepLabel(s, i)}</option>)}
      </select>
      <button type="button" className={buttonClass('primary', 'sm')} onClick={() => onInsert(after)}>Add to lesson</button>
    </div>
  )
}

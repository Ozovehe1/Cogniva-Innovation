'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, Eye, EyeOff, FileText, Presentation, RefreshCw, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { Alert, Badge, Card, Spinner, buttonClass, cx, labelClass, textareaClass } from '@/components/ui'
import { TargetSelect } from '@/components/tutor-sections'
import { createClient } from '@/lib/supabase/client'

/* Shared with the server rules in src/lib/materials.ts (kept here so the client bundle stays free of server code). */
const MAX_BYTES = 20 * 1024 * 1024
const ACCEPT = '.pdf,.pptx,.docx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export interface MaterialView {
  id: string
  file_name: string
  mime: string
  size: number
  page_count: number | null
  status?: 'uploading' | 'reading' | 'ready' | 'failed'
  error?: string | null
  visible_to_students?: boolean
  created_at: string
}

interface StyleNotes { subject: string; level: string; notation: string[]; diagramTypes: string[]; terminology: string[]; summary: string }

export function fileKind(m: Pick<MaterialView, 'file_name' | 'mime'>): 'PDF' | 'Slides' | 'Document' {
  const n = m.file_name.toLowerCase()
  if (n.endsWith('.pdf') || m.mime === 'application/pdf') return 'PDF'
  if (n.endsWith('.pptx') || m.mime.includes('presentation')) return 'Slides'
  return 'Document'
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function metaLine(m: MaterialView) {
  const kind = fileKind(m)
  const unit = kind === 'Slides' ? 'slide' : 'page'
  return [kind, m.page_count ? `${m.page_count} ${unit}${m.page_count === 1 ? '' : 's'}` : null, formatBytes(m.size)].filter(Boolean).join(' · ')
}

function KindIcon({ m, className }: { m: Pick<MaterialView, 'file_name' | 'mime'>; className?: string }) {
  const kind = fileKind(m)
  const Icon = kind === 'Slides' ? Presentation : FileText
  return (
    <span aria-hidden className={cx('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] border border-line bg-canvas', className)}>
      <Icon className={cx('h-[18px] w-[18px]', kind === 'PDF' ? 'text-clay' : kind === 'Slides' ? 'text-amber' : 'text-navy')} strokeWidth={1.6} />
    </span>
  )
}

const statusTone = {
  uploading: { label: 'Uploading', cls: 'border-line bg-sunken text-ink-2', spin: true },
  reading: { label: 'Reading', cls: 'border-navy-line bg-navy-soft text-navy', spin: true },
  ready: { label: 'Read', cls: 'border-accent-line bg-accent-soft text-accent', spin: false },
  failed: { label: 'Could not read', cls: 'border-danger-line bg-danger-soft text-danger', spin: false },
} as const

/* ───────────── Reader (extracted text of slides and documents) ───────────── */

export function MaterialReader({ lessonId, material, onClose }: { lessonId: string; material: MaterialView; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    fetch(`/api/lessons/${lessonId}/materials/${material.id}?mode=text`)
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => { if (!live) return; if (ok) setText(d.text ?? ''); else setError(d.error ?? 'Could not open the file.') })
      .catch(() => live && setError('Network error.'))
    return () => { live = false }
  }, [lessonId, material.id])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const blocks = (text ?? '').split(/\n(?=## )/)
  return (
    <div role="dialog" aria-modal="true" aria-label={material.file_name} className="fixed inset-0 z-50 flex items-end justify-center bg-[#14141A]/40 p-0 backdrop-blur-[2px] md:items-center md:p-6" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-[720px] flex-col rounded-t-[16px] border border-line bg-surface shadow-[0_24px_60px_rgba(20,20,26,0.18)] md:rounded-[16px]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 md:px-6">
          <div className="min-w-0">
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">{fileKind(material)} · text view</p>
            <h2 className="mt-1 truncate font-display text-[20px] leading-tight text-ink">{material.file_name}</h2>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            <a href={`/api/lessons/${lessonId}/materials/${material.id}?mode=download`} className={buttonClass('secondary', 'sm')}>
              <ArrowDownToLine className="h-3.5 w-3.5" strokeWidth={1.75} /> Download
            </a>
            <button type="button" aria-label="Close" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink">
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 py-5 md:px-8 md:py-6">
          {error ? <Alert>{error}</Alert> : text === null ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted"><Spinner /> Opening…</div>
          ) : (
            <div className="space-y-6">
              {blocks.map((b, i) => {
                const h = /^## (.+)\n?/.exec(b)
                const body = h ? b.slice(h[0].length) : b
                return (
                  <section key={i}>
                    {h && <p className="tnum mb-2 text-[12px] font-medium uppercase tracking-[0.08em] text-faint">{h[1]}</p>}
                    <div className="whitespace-pre-wrap font-display text-[17px] leading-[1.6] text-ink-2">{body.trim()}</div>
                  </section>
                )
              })}
            </div>
          )}
        </div>
        <p className="border-t border-line px-5 py-3 text-[12px] text-faint md:px-6">Text only. Download the file to see its layout and images.</p>
      </div>
    </div>
  )
}

/** View action: PDFs open in the browser through a short-lived link; slides and documents open in the reader. */
function ViewButton({ lessonId, m, onRead, size = 'sm' }: { lessonId: string; m: MaterialView; onRead: (m: MaterialView) => void; size?: 'sm' | 'md' }) {
  if (fileKind(m) === 'PDF') {
    return (
      <a href={`/api/lessons/${lessonId}/materials/${m.id}?mode=view`} target="_blank" rel="noopener noreferrer" className={buttonClass('ghost', size)}>
        <Eye className="h-3.5 w-3.5" strokeWidth={1.75} /> View
      </a>
    )
  }
  return (
    <button type="button" className={buttonClass('ghost', size)} onClick={() => onRead(m)}>
      <Eye className="h-3.5 w-3.5" strokeWidth={1.75} /> Read
    </button>
  )
}

/* ───────────── Tutor: materials panel ───────────── */

export function MaterialsPanel({
  lessonId,
  targetMinutes,
  drafting,
  onBuilt,
}: {
  lessonId: string
  targetMinutes: number
  /** A draft is running: building is disabled. */
  drafting: boolean
  onBuilt: () => void
}) {
  const [materials, setMaterials] = useState<MaterialView[] | null>(null)
  const [loadedAt, setLoadedAt] = useState(0)
  const [styleNotes, setStyleNotes] = useState<StyleNotes | null>(null)
  const [fromMaterials, setFromMaterials] = useState(false)
  const [uploading, setUploading] = useState<{ name: string; pct: number | null }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [share, setShare] = useState(true)
  const [drag, setDrag] = useState(false)
  const [reading, setReading] = useState<MaterialView | null>(null)
  const [target, setTarget] = useState(targetMinutes)
  const [notes, setNotes] = useState('')
  const [rewrite, setRewrite] = useState(true)
  const [building, setBuilding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/tutor/lessons/${lessonId}/materials`).catch(() => null)
    if (!res || !res.ok) return
    const d = await res.json().catch(() => null)
    if (!d) return
    setLoadedAt(Date.now())
    setMaterials(d.materials ?? [])
    setStyleNotes(d.styleNotes ?? null)
    setFromMaterials(!!d.fromMaterials)
  }, [lessonId])
  useEffect(() => { void load() }, [load])

  const pending = materials?.some(m => m.status === 'reading' || m.status === 'uploading')
  useEffect(() => {
    if (!pending) return
    const t = setInterval(() => { void load() }, 2500)
    return () => clearInterval(t)
  }, [pending, load])

  const uploadOne = async (file: File) => {
    const lower = file.name.toLowerCase()
    if (!/\.(pdf|pptx|docx)$/.test(lower)) {
      setError(/\.(ppt|doc)$/.test(lower) ? `${file.name}: older .ppt and .doc files can’t be read. Save it as .pptx or .docx.` : `${file.name}: only PDF, PowerPoint (.pptx) and Word (.docx) files.`)
      return
    }
    if (file.size > MAX_BYTES) { setError(`${file.name} is ${formatBytes(file.size)}. Files can be up to 20 MB.`); return }
    setUploading(u => [...u, { name: file.name, pct: null }])
    try {
      const res = await fetch(`/api/tutor/lessons/${lessonId}/materials`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, size: file.size, mime: file.type, visible: share }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? `Could not upload ${file.name}.`); return }
      await load()
      const { error: upErr } = await createClient().storage.from(d.upload.bucket).uploadToSignedUrl(d.upload.path, d.upload.token, file, { contentType: d.upload.contentType })
      if (upErr) {
        await fetch(`/api/tutor/lessons/${lessonId}/materials/${d.material.id}`, { method: 'DELETE' }).catch(() => {})
        setError(`${file.name} did not upload: ${upErr.message}`)
        return
      }
      await fetch(`/api/tutor/lessons/${lessonId}/materials/${d.material.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'uploaded' }) })
    } catch {
      setError(`Network error while uploading ${file.name}.`)
    } finally {
      setUploading(u => u.filter(x => x.name !== file.name))
      await load()
    }
  }

  const onFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return
    setError(null); setNotice(null)
    for (const f of Array.from(list)) await uploadOne(f)
    if (inputRef.current) inputRef.current.value = ''
  }

  const act = async (m: MaterialView, method: 'PATCH' | 'POST' | 'DELETE', body?: object) => {
    setError(null)
    if (method === 'DELETE' && !confirm(`Remove ${m.file_name}? Students lose access to it too.`)) return
    const res = await fetch(`/api/tutor/lessons/${lessonId}/materials/${m.id}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null)
    if (!res || !res.ok) { const d = res ? await res.json().catch(() => ({})) : {}; setError(d.error ?? 'Something went wrong.') }
    await load()
  }

  const build = async () => {
    setError(null); setNotice(null); setBuilding(true)
    try {
      const res = await fetch(`/api/tutor/lessons/${lessonId}/materials/build`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetMinutes: target, notes, rewriteObjectives: rewrite }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? 'Could not build the lesson.'); return }
      setNotice(d.warning ?? 'Drafting from your materials. Sections appear in the preview as they are written; nothing reaches students until you approve.')
      setNotes('')
      await load()
      onBuilt()
    } catch {
      setError('Network error. Check your connection and try again.')
    } finally {
      setBuilding(false)
    }
  }

  const ready = materials?.filter(m => m.status === 'ready') ?? []
  const busyReading = !!pending || uploading.length > 0

  return (
    <Card padded={false}>
      <div className="flex flex-col gap-1 px-5 pt-5 md:px-6 md:pt-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-[15px] font-semibold text-ink">Class materials</h2>
          {materials && materials.length > 0 && <span className="tnum text-[12px] text-muted">{materials.length} {materials.length === 1 ? 'file' : 'files'}</span>}
        </div>
        <p className="max-w-[62ch] text-[13px] leading-relaxed text-muted">
          Upload the notes, slides or handouts this lesson should follow. They are read on the server and can shape the draft: its sections, worked examples and notation. Shared files appear to your students beside the transcript.
        </p>
      </div>

      <div className="px-5 pt-4 md:px-6">
        <label
          htmlFor="materials-input"
          onDragOver={e => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); void onFiles(e.dataTransfer.files) }}
          className={cx(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed px-6 py-7 text-center transition-colors',
            drag ? 'border-accent bg-accent-soft' : 'border-line-strong bg-canvas hover:border-accent/60 hover:bg-[#F3F1EA]',
          )}
        >
          <Upload className="h-5 w-5 text-muted" strokeWidth={1.6} />
          <span className="text-[15px] text-ink">Drop files here, or <span className="font-medium text-accent underline decoration-accent/30 underline-offset-4">choose files</span></span>
          <span className="text-[12px] text-faint">PDF, PowerPoint (.pptx) or Word (.docx) · up to 20 MB each</span>
          <input ref={inputRef} id="materials-input" type="file" multiple accept={ACCEPT} className="sr-only" onChange={e => void onFiles(e.target.files)} />
        </label>
        <label className="mt-3 flex items-center gap-2.5 text-[13px] text-ink-2">
          <input type="checkbox" className="h-4 w-4 accent-[#1F4D3A]" checked={share} onChange={e => setShare(e.target.checked)} />
          Share new uploads with students
        </label>
      </div>

      {(error || notice) && (
        <div className="px-5 pt-4 md:px-6">
          {error && <Alert>{error}</Alert>}
          {notice && <Alert tone="success" className={error ? 'mt-3' : undefined}>{notice}</Alert>}
        </div>
      )}

      {(uploading.length > 0 || (materials && materials.length > 0)) && (
        <ul className="mt-5 divide-y divide-line border-t border-line">
          {uploading.filter(u => !materials?.some(m => m.file_name === u.name && m.status !== 'uploading')).map(u => (
            <li key={`up-${u.name}`} className="flex items-center gap-3 px-5 py-3.5 md:px-6">
              <KindIcon m={{ file_name: u.name, mime: '' }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] text-ink">{u.name}</p>
                <p className="text-[12px] text-muted">Uploading…</p>
              </div>
              <Spinner className="text-muted" />
            </li>
          ))}
          {materials?.filter(m => !(m.status === 'uploading' && uploading.some(u => u.name === m.file_name))).map(m => {
            const st = statusTone[m.status ?? 'ready']
            const stale = m.status === 'uploading' && loadedAt - new Date(m.created_at).getTime() > 10 * 60_000
            return (
              <li key={m.id} className="px-5 py-3.5 md:px-6">
                <div className="flex items-start gap-3">
                  <KindIcon m={m} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <p className="min-w-0 truncate text-[15px] text-ink">{m.file_name}</p>
                      <Badge className={st.cls}>{st.spin && !stale && <Spinner className="h-3 w-3" />}{stale ? 'Upload interrupted' : st.label}</Badge>
                    </div>
                    <p className="tnum mt-0.5 text-[12px] text-muted">
                      {metaLine(m)}
                      {m.status === 'ready' && <> · {m.visible_to_students ? <span className="text-accent">Shared with students</span> : 'Only you'}</>}
                    </p>
                    {m.status === 'failed' && m.error && <p className="mt-1.5 text-[13px] leading-relaxed text-danger">{m.error}</p>}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1 pl-[52px]">
                  {m.status === 'ready' && <ViewButton lessonId={lessonId} m={m} onRead={setReading} />}
                  {m.status !== 'uploading' && (
                    <a href={`/api/lessons/${lessonId}/materials/${m.id}?mode=download`} className={buttonClass('ghost', 'sm')}>
                      <ArrowDownToLine className="h-3.5 w-3.5" strokeWidth={1.75} /> Download
                    </a>
                  )}
                  {m.status === 'ready' && (
                    <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => act(m, 'PATCH', { visible: !m.visible_to_students })}>
                      {m.visible_to_students ? <><EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} /> Stop sharing</> : <><Eye className="h-3.5 w-3.5" strokeWidth={1.75} /> Share with students</>}
                    </button>
                  )}
                  {m.status === 'failed' && (
                    <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => act(m, 'POST', { action: 'retry' })}>
                      <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} /> Read again
                    </button>
                  )}
                  <button type="button" aria-label={`Remove ${m.file_name}`} className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-faint hover:bg-sunken hover:text-danger" onClick={() => act(m, 'DELETE')}>
                    <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {ready.length > 0 && (
        <div className="border-t border-line bg-canvas/60 px-5 py-5 md:px-6 md:py-6 rounded-b-[14px]">
          <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
            <div>
              <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink"><Sparkles className="h-4 w-4 text-accent" strokeWidth={1.75} /> Build lesson from materials</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                Replaces the current draft. The outline follows the order of your {ready.length === 1 ? 'file' : 'files'}; each section is written from the relevant pages, using their worked examples and notation. You review and approve as usual.
              </p>
              <div className="mt-4">
                <label htmlFor="mat-target" className={labelClass}>Lesson length</label>
                <TargetSelect id="mat-target" value={target} onChange={setTarget} disabled={building} />
              </div>
              <div className="mt-4">
                <label htmlFor="mat-notes" className={labelClass}>Notes for the draft <span className="font-normal text-faint">(optional)</span></label>
                <textarea id="mat-notes" rows={2} className={textareaClass} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Skip section 4; spend longer on the worked examples." maxLength={1000} />
              </div>
              <label className="mt-3 flex items-start gap-2.5 text-[13px] leading-relaxed text-ink-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#1F4D3A]" checked={rewrite} onChange={e => setRewrite(e.target.checked)} />
                Rewrite the objectives to match the materials
              </label>
              <button
                type="button"
                className={buttonClass('primary', 'md', 'mt-4')}
                disabled={building || drafting || busyReading}
                title={drafting ? 'Wait for the current draft to finish' : busyReading ? 'Wait until every file is read' : undefined}
                onClick={() => {
                  if (!confirm('Build a new draft from the materials? The current draft and its sections are replaced.')) return
                  void build()
                }}
              >
                {building ? <><Spinner /> Reading the materials…</> : 'Build lesson from materials'}
              </button>
              {drafting && <p className="mt-2 text-[12px] text-muted">A draft is being written. You can build again once it finishes.</p>}
            </div>
            <div className="md:border-l md:border-line md:pl-6">
              <h3 className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Style notes</h3>
              {styleNotes ? (
                <dl className="mt-3 space-y-3 text-[13px] leading-relaxed">
                  {styleNotes.subject && <div><dt className="text-faint">Subject</dt><dd className="text-ink-2">{styleNotes.subject}{styleNotes.level ? ` · ${styleNotes.level}` : ''}</dd></div>}
                  {styleNotes.notation.length > 0 && <div><dt className="text-faint">Notation</dt><dd className="text-ink-2">{styleNotes.notation.join('; ')}</dd></div>}
                  {styleNotes.diagramTypes.length > 0 && <div><dt className="text-faint">Diagrams</dt><dd className="text-ink-2">{styleNotes.diagramTypes.join('; ')}</dd></div>}
                  {styleNotes.summary && <div><dt className="text-faint">Covers</dt><dd className="font-display text-[15px] text-ink-2">{styleNotes.summary}</dd></div>}
                  <p className="text-[12px] text-faint">Used by the draft and by new animations{fromMaterials ? '. Redrafts keep following the materials.' : '.'}</p>
                </dl>
              ) : (
                <p className="mt-3 text-[13px] leading-relaxed text-muted">Derived when you build: the subject and level, the notation to copy exactly, and the kinds of diagram the materials use. Animations follow them too.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {reading && <MaterialReader lessonId={lessonId} material={reading} onClose={() => setReading(null)} />}
    </Card>
  )
}

/* ───────────── Student: materials list (tab beside the transcript) ───────────── */

export function StudentMaterials({ lessonId, materials }: { lessonId: string; materials: MaterialView[] }) {
  const [reading, setReading] = useState<MaterialView | null>(null)
  if (materials.length === 0) {
    return <p className="py-1 text-[15px] text-muted">Your tutor hasn’t shared any files for this lesson.</p>
  }
  return (
    <>
      <ul className="-my-1 divide-y divide-line">
        {materials.map(m => (
          <li key={m.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <KindIcon m={m} />
              <div className="min-w-0">
                <p className="truncate text-[15px] text-ink">{m.file_name}</p>
                <p className="tnum text-[12px] text-muted">{metaLine(m)}</p>
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-1 pl-[52px] sm:pl-0">
              <ViewButton lessonId={lessonId} m={m} onRead={setReading} />
              <a href={`/api/lessons/${lessonId}/materials/${m.id}?mode=download`} className={buttonClass('secondary', 'sm')}>
                <ArrowDownToLine className="h-3.5 w-3.5" strokeWidth={1.75} /> Download
              </a>
            </div>
          </li>
        ))}
      </ul>
      {reading && <MaterialReader lessonId={lessonId} material={reading} onClose={() => setReading(null)} />}
    </>
  )
}

'use client'
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Check, Trash2 } from 'lucide-react'
import { Alert, Card, Eyebrow, Skeleton, Spinner, buttonClass, textareaClass } from '@/components/ui'
import { LessonSession } from '@/components/lesson-session'
import { AnimationsPanel, LessonStatusBadge, ObjectivesEditor } from '@/components/tutor-lessons'
import { validateScript, type Step } from '@/lib/lesson-schema'
import { LESSON_MAX_STEPS, flattenSections, normalizeChapters, type Chapter } from '@/lib/lesson-sections'
import { DraftProgress, SectionsPanel, type DraftStatus, type SectionView } from '@/components/tutor-sections'

interface Lesson {
  id: string
  title: string
  subject: string
  objectives: string[]
  status: 'draft' | 'approved'
  script: Step[]
  chapters: unknown
  target_minutes: number | null
  draft_status: DraftStatus
  draft_error: string | null
  draft_retry_at: string | null
  updated_at: string
}

const RUNNING: DraftStatus[] = ['outlining', 'drafting', 'paused']

export default function TutorLessonEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const search = useSearchParams()
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [sections, setSections] = useState<SectionView[]>([])
  const [sectionBusy, setSectionBusy] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'save' | 'regenerate' | 'approve' | 'script' | 'delete'>(null)
  const [error, setError] = useState<string | null>(search.get('draft') === 'failed' ? 'The AI draft failed when the lesson was created. Choose Redraft lesson to try again.' : null)
  const [scriptText, setScriptText] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/tutor/lessons/${id}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setLoadError(data.error ?? 'Could not load the lesson.'); return }
    setLesson(data.lesson)
    setSections(data.sections ?? [])
    setScriptText(JSON.stringify(data.lesson.script, null, 2))
  }, [id])
  useEffect(() => { void load() }, [load])

  // Poll the background draft while it runs; reload the lesson whenever a section changes.
  const signature = useRef('')
  const draftStatus = lesson?.draft_status
  useEffect(() => {
    if (!draftStatus || !RUNNING.includes(draftStatus)) return
    let stop = false
    const tick = async () => {
      const res = await fetch(`/api/tutor/lessons/${id}/draft`).catch(() => null)
      if (!res || !res.ok || stop) return
      const d = await res.json().catch(() => null)
      if (!d || stop) return
      const sig = `${d.draftStatus}|${(d.sections ?? []).map((x: { id: string; status: string; updatedAt: string }) => `${x.id}:${x.status}:${x.updatedAt}`).join(',')}`
      if (sig !== signature.current) { signature.current = sig; await load() }
    }
    void tick()
    const t = setInterval(tick, draftStatus === 'paused' ? 20_000 : 4000)
    return () => { stop = true; clearInterval(t) }
  }, [draftStatus, id, load])

  const draftAction = async (body: object) => {
    setError(null)
    const res = await fetch(`/api/tutor/lessons/${id}/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res || !res.ok) { setError(data.error ?? 'Something went wrong.'); return false }
    signature.current = ''
    await load()
    return true
  }
  const sectionAction = async (action: 'regenerate_section' | 'update_section' | 'delete_section', sectionId: string, extra: Record<string, unknown> = {}) => {
    setSectionBusy(sectionId)
    try { return await draftAction({ action, sectionId, ...extra }) } finally { setSectionBusy(null) }
  }
  const retry = async () => { setRetrying(true); try { await draftAction({ action: 'retry' }) } finally { setRetrying(false) } }

  // What the preview plays: ready sections only (each starts on a clean board).
  const playable = useMemo((): { steps: Step[]; chapters: Chapter[] } => {
    if (!lesson) return { steps: [], chapters: [] }
    if (sections.length > 0) return flattenSections(sections.filter(x => x.status === 'ready').map(x => ({ title: x.title, steps: x.steps })))
    const steps = Array.isArray(lesson.script) ? lesson.script : []
    return { steps, chapters: normalizeChapters(lesson.chapters, steps.length, lesson.title, steps) }
  }, [lesson, sections])
  const previewKey = useMemo(() => `${playable.steps.length}:${playable.chapters.map(c => `${c.start}-${c.count}`).join('.')}:${sections.map(x => x.updated_at).join('.')}`, [playable, sections])

  const patch = async (body: object, kind: NonNullable<typeof busy>) => {
    setBusy(kind); setError(null)
    try {
      const res = await fetch(`/api/tutor/lessons/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Something went wrong.'); return false }
      setLesson(data.lesson)
      if (Array.isArray(data.sections)) setSections(data.sections)
      signature.current = ''
      setScriptText(JSON.stringify(data.lesson.script, null, 2))
      return true
    } catch {
      setError('Network error. Check your connection and try again.')
      return false
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!confirm('Delete this lesson? This cannot be undone.')) return
    setBusy('delete')
    const res = await fetch(`/api/tutor/lessons/${id}`, { method: 'DELETE' })
    if (res.ok) router.push('/tutor/lessons')
    else { setBusy(null); setError('Could not delete the lesson.') }
  }

  if (loadError) return <Alert>{loadError}</Alert>
  if (!lesson) return (
    <div aria-busy="true">
      <Skeleton className="mb-3 h-3 w-24" />
      <Skeleton className="mb-6 h-9 w-2/3" />
      <Skeleton className="aspect-[16/10] w-full rounded-[14px]" />
    </div>
  )

  const steps = playable.steps
  const validation = validateScript(steps, { maxSteps: LESSON_MAX_STEPS })
  const sectioned = sections.length > 0
  const running = RUNNING.includes(lesson.draft_status)
  const allReady = !sectioned || sections.every(x => x.status === 'ready')
  let scriptParseError: string | null = null
  try { JSON.parse(scriptText) } catch (e) { scriptParseError = e instanceof Error ? e.message : 'Invalid JSON' }

  return (
    <div className="mx-auto max-w-[1000px]">
      <Link href="/tutor/lessons" className="-ml-1 mb-4 inline-flex h-9 items-center gap-1.5 rounded-md px-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} /> All lessons
      </Link>

      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-3">
            <Eyebrow>{lesson.subject}</Eyebrow>
            <LessonStatusBadge status={lesson.status} />
          </div>
          <h1 className="font-display text-[28px] leading-[1.1] text-ink md:text-[36px]">{lesson.title}</h1>
        </div>
        <div className="flex flex-shrink-0 flex-wrap gap-2">
          {lesson.status === 'draft' ? (
            <button type="button" className={buttonClass('primary', 'md')} disabled={!!busy || steps.length === 0 || !validation.ok || !allReady || lesson.draft_status === 'outlining'} title={!allReady ? 'Every section must be drafted first' : undefined} onClick={() => patch({ action: 'approve' }, 'approve')}>
              {busy === 'approve' ? <Spinner /> : <Check className="h-4 w-4" strokeWidth={2} />} Approve for students
            </button>
          ) : (
            <button type="button" className={buttonClass('secondary', 'md')} disabled={!!busy} onClick={() => patch({ action: 'unapprove' }, 'approve')}>
              Move back to draft
            </button>
          )}
          <button type="button" aria-label="Delete lesson" className={buttonClass('ghost', 'md')} disabled={!!busy} onClick={remove}>
            <Trash2 className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {error && <Alert className="mb-5">{error}</Alert>}
      {(running || lesson.draft_status === 'failed' || lesson.draft_status === 'partial') && (
        <div className="mb-5">
          <DraftProgress
            status={lesson.draft_status}
            error={lesson.draft_error}
            retryAt={lesson.draft_retry_at}
            sections={sections}
            targetMinutes={lesson.target_minutes}
            onRetry={retry}
            busy={retrying}
          />
        </div>
      )}
      {!validation.ok && steps.length > 0 && (
        <Alert tone="warning" className="mb-5" title="This script has problems">
          {validation.errors.slice(0, 3).join('; ')}
        </Alert>
      )}

      <section aria-label="Preview">
        <p className="mb-3 text-[13px] text-muted">Preview — exactly what students will see. You can skip past checks here; students can’t.</p>
        {busy === 'regenerate' ? (
          <Card className="flex aspect-[16/10] flex-col items-center justify-center gap-3 text-center">
            <Spinner className="h-5 w-5 text-accent" />
            <p className="text-[15px] text-ink-2">Starting a new draft…</p>
          </Card>
        ) : steps.length === 0 ? (
          <Card className="flex aspect-[16/10] flex-col items-center justify-center gap-2 px-6 text-center">
            {running && <Spinner className="h-5 w-5 text-accent" />}
            <p className="text-[15px] text-muted">{running ? 'The first section will appear here as soon as it is written.' : 'No script yet. Use Redraft lesson below.'}</p>
          </Card>
        ) : (
          <LessonSession key={previewKey} lessonId={lesson.id} steps={validation.steps} chapters={playable.chapters} title={lesson.title} mode="preview" />
        )}
      </section>

      {sectioned && (
        <div className="mt-8">
          <SectionsPanel sections={sections} targetMinutes={lesson.target_minutes} onAction={sectionAction} busyId={sectionBusy} locked={lesson.draft_status === 'outlining'} />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ObjectivesEditor
          targetMinutes={lesson.target_minutes ?? 15}
          objectives={lesson.objectives ?? []}
          busy={busy === 'save' || busy === 'regenerate' ? busy : null}
          onSave={objectives => patch({ action: 'update', objectives }, 'save')}
          onRegenerate={async (objectives, notes, targetMinutes) => {
            if (sectioned && sections.some(x => x.status === 'ready') && !confirm('Redraft the whole lesson? Every section is replaced.')) return
            const changed = JSON.stringify(objectives) !== JSON.stringify(lesson.objectives)
            if (changed && !(await patch({ action: 'update', objectives }, 'save'))) return
            await patch({ action: 'regenerate', notes, targetMinutes }, 'regenerate')
          }}
        />
        <AnimationsPanel lessonId={lesson.id} script={steps} onInserted={load} />
      </div>

      {!sectioned && <details className="mt-6 rounded-[14px] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <summary className="cursor-pointer text-[15px] font-semibold text-ink">Script <span className="font-normal text-muted">· {steps.length} steps · advanced</span></summary>
        <p className="mt-2 text-[13px] text-muted">Edit the scene script directly. It is validated before saving.</p>
        <label htmlFor="script-json" className="sr-only">Scene script JSON</label>
        <textarea id="script-json" rows={18} spellCheck={false} className={`${textareaClass} mt-3 font-mono text-[12px]`} value={scriptText} onChange={e => setScriptText(e.target.value)} />
        {scriptParseError && <p className="mt-2 text-[13px] text-danger">{scriptParseError}</p>}
        <button
          type="button"
          className={buttonClass('secondary', 'md', 'mt-3')}
          disabled={!!busy || !!scriptParseError}
          onClick={() => patch({ action: 'save_script', script: JSON.parse(scriptText) }, 'script')}
        >
          {busy === 'script' ? <Spinner /> : null} Save script
        </button>
      </details>}
    </div>
  )
}

'use client'
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Check, Trash2 } from 'lucide-react'
import { Alert, Card, Eyebrow, Skeleton, Spinner, buttonClass, textareaClass } from '@/components/ui'
import { LessonSession } from '@/components/lesson-session'
import { AnimationsPanel, LessonStatusBadge, ObjectivesEditor } from '@/components/tutor-lessons'
import { validateScript, type Step } from '@/lib/lesson-schema'

interface Lesson {
  id: string
  title: string
  subject: string
  objectives: string[]
  status: 'draft' | 'approved'
  script: Step[]
  updated_at: string
}

export default function TutorLessonEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const search = useSearchParams()
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'save' | 'regenerate' | 'approve' | 'script' | 'delete'>(null)
  const [error, setError] = useState<string | null>(search.get('draft') === 'failed' ? 'The AI draft failed when the lesson was created. Choose Regenerate draft to try again.' : null)
  const [scriptText, setScriptText] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/tutor/lessons/${id}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setLoadError(data.error ?? 'Could not load the lesson.'); return }
    setLesson(data.lesson)
    setScriptText(JSON.stringify(data.lesson.script, null, 2))
  }, [id])
  useEffect(() => { void load() }, [load])

  const patch = async (body: object, kind: NonNullable<typeof busy>) => {
    setBusy(kind); setError(null)
    try {
      const res = await fetch(`/api/tutor/lessons/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Something went wrong.'); return false }
      setLesson(data.lesson)
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

  const steps = Array.isArray(lesson.script) ? lesson.script : []
  const validation = validateScript(steps)
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
            <button type="button" className={buttonClass('primary', 'md')} disabled={!!busy || steps.length === 0 || !validation.ok} onClick={() => patch({ action: 'approve' }, 'approve')}>
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
            <p className="text-[15px] text-ink-2">Writing a new draft…</p>
            <p className="text-[13px] text-muted">This usually takes one to three minutes.</p>
          </Card>
        ) : steps.length === 0 ? (
          <Card className="flex aspect-[16/10] items-center justify-center text-center text-[15px] text-muted">
            No script yet. Use Regenerate draft below.
          </Card>
        ) : (
          <LessonSession key={lesson.updated_at} lessonId={lesson.id} steps={validation.steps} mode="preview" />
        )}
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <ObjectivesEditor
          objectives={lesson.objectives ?? []}
          busy={busy === 'save' || busy === 'regenerate' ? busy : null}
          onSave={objectives => patch({ action: 'update', objectives }, 'save')}
          onRegenerate={async (objectives, notes) => {
            const changed = JSON.stringify(objectives) !== JSON.stringify(lesson.objectives)
            if (changed && !(await patch({ action: 'update', objectives }, 'save'))) return
            await patch({ action: 'regenerate', notes }, 'regenerate')
          }}
        />
        <AnimationsPanel lessonId={lesson.id} script={steps} onInserted={load} />
      </div>

      <details className="mt-6 rounded-[14px] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
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
      </details>
    </div>
  )
}

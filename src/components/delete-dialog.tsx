'use client'
import React, { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Trash2 } from 'lucide-react'
import { RichText, toPlainText } from './rich-text'
import { Spinner, buttonClass, cx, inputClass } from './ui'

/**
 * The one delete control in the app: a trash button and a Keep / Delete confirmation. The request goes
 * to an API route that checks ownership with the learner's session before anything is removed.
 */
export function DeleteButton({ what, title, body, endpoint, keepLabel, confirmLabel, redirectTo, onDeleted, compact = false, typeToConfirm, method = 'DELETE', payload, buttonLabel = 'Delete', className }: {
  /** "lesson", "goal", "account": used in the eyebrow and the button's accessible label. */
  what: string
  /** What is being deleted (may contain maths). */
  title: string
  body: React.ReactNode
  endpoint: string
  keepLabel: string
  confirmLabel: string
  /** Where to go once it is deleted (otherwise the page refreshes in place). */
  redirectTo?: string | ((json: Record<string, unknown>) => string | undefined)
  onDeleted?: () => void
  /** Icon-only on small screens. */
  compact?: boolean
  /** A word the user must type before the delete button enables (account deletion). */
  typeToConfirm?: string
  method?: 'DELETE'
  payload?: Record<string, unknown>
  buttonLabel?: string
  className?: string
}) {
  const router = useRouter()
  const ids = useId()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pending) setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, pending])

  const armed = !typeToConfirm || typed.trim().toUpperCase() === typeToConfirm.toUpperCase()

  const confirm = async () => {
    if (!armed || pending) return
    setError(null); setPending(true)
    try {
      const res = await fetch(endpoint, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(payload ?? {}), ...(typeToConfirm ? { confirm: typed.trim() } : {}) }) })
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) { setError(typeof json.error === 'string' ? json.error : `Could not delete the ${what}. Please try again.`); setPending(false); return }
      setOpen(false); setPending(false)
      onDeleted?.()
      const to = typeof redirectTo === 'function' ? redirectTo(json) : redirectTo
      if (to) router.replace(to)
      router.refresh()
    } catch {
      setError(`Could not delete the ${what}. Check your connection and try again.`)
      setPending(false)
    }
  }

  const plain = toPlainText(title)
  return (
    <>
      <button type="button" onClick={() => { setError(null); setTyped(''); setOpen(true) }} aria-label={`Delete ${what}${plain ? `: ${plain}` : ''}`}
        className={cx(buttonClass('ghost', 'md'), 'text-muted hover:bg-danger-soft hover:text-danger', compact && 'px-2.5 sm:px-4', className)}>
        <Trash2 className="h-4 w-4" strokeWidth={1.75} /><span className={compact ? 'hidden sm:inline' : undefined}>{buttonLabel}</span>
      </button>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" role="alertdialog" aria-modal="true" aria-labelledby={`${ids}-t`} aria-describedby={`${ids}-d`}>
            <motion.div className="absolute inset-0 bg-ink/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !pending && setOpen(false)} />
            <motion.div className="pb-safe relative w-full max-w-md rounded-t-[18px] border border-line bg-surface p-6 shadow-[var(--shadow-raised)] sm:rounded-[18px]"
              initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} transition={{ duration: 0.2 }}>
              <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-danger">Delete {what}</p>
              <h2 id={`${ids}-t`} className="mt-1.5 font-display text-[22px] leading-snug text-ink"><RichText text={title} /></h2>
              <div id={`${ids}-d`} className="mt-3 text-[15px] leading-relaxed text-ink-2">{body}</div>
              {typeToConfirm && (
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Type <span className="font-mono text-ink">{typeToConfirm}</span> to confirm</span>
                  <input value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={pending}
                    className={inputClass} aria-label={`Type ${typeToConfirm} to confirm`} onKeyDown={e => { if (e.key === 'Enter') confirm() }} />
                </label>
              )}
              {error && <p className="mt-3 text-[14px] text-danger" role="alert">{error}</p>}
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button ref={cancelRef} type="button" onClick={() => setOpen(false)} disabled={pending} className={buttonClass('secondary', 'lg', 'sm:h-10 sm:px-4 sm:text-sm')}>{keepLabel}</button>
                <button type="button" onClick={confirm} disabled={pending || !armed} className={buttonClass('danger', 'lg', 'sm:h-10 sm:px-4 sm:text-sm')}>
                  {pending ? <><Spinner />Deleting…</> : <><Trash2 className="h-4 w-4" strokeWidth={2} />{confirmLabel}</>}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}

/** Delete one of the learner's own lessons. */
export function LessonDelete({ lessonId, title, redirectTo, compact = false, inPath = false }: { lessonId: string; title: string; redirectTo?: string; compact?: boolean; inPath?: boolean }) {
  return (
    <DeleteButton what="lesson" title={title} endpoint={`/api/lessons/${lessonId}`} keepLabel="Keep lesson" confirmLabel="Delete lesson" redirectTo={redirectTo} compact={compact}
      body={<>This removes the lesson, your progress in it, its mastery check and its animations. It can’t be undone.{inPath && ' The topic stays on your path, and your tutor can write you a fresh lesson for it.'}</>} />
  )
}

/** Delete a whole goal: its path, topics, lessons, checks and animations. After the last goal, the add-goal flow opens. */
export function GoalDelete({ pathId, goal, compact = false, lessons, className }: { pathId: string; goal: string; compact?: boolean; lessons?: number; className?: string }) {
  return (
    <DeleteButton what="goal" title={goal} endpoint={`/api/paths/${pathId}`} keepLabel="Keep goal" confirmLabel="Delete goal" compact={compact} className={className}
      redirectTo={json => (json.remainingGoals === 0 ? '/start?new=1' : undefined)}
      body={<>This removes the goal and its whole path: every topic{typeof lessons === 'number' ? `, ${lessons === 1 ? 'its 1 lesson' : `its ${lessons} lessons`}` : ' and lesson'}, your progress and mastery checks, the starting check and the animations made for it. It can’t be undone. Your other goals stay as they are.</>} />
  )
}

/** Delete the account and everything in it. */
export function AccountDelete({ email }: { email: string }) {
  return (
    <DeleteButton what="account" title={email} endpoint="/api/account" keepLabel="Keep my account" confirmLabel="Delete my account" typeToConfirm="DELETE" redirectTo="/?deleted=1" buttonLabel="Delete account"
      body={<>This permanently deletes your GeniusMap account: every goal and path, all your lessons, progress, checks, check-ins and animations, and your sign-in. It can’t be undone, and you’ll be signed out.</>} />
  )
}

'use client'
/**
 * Onboarding v2 (docs/design/onboarding.md): four short screens, then a short adaptive check, then the first
 * lesson. Psychology applied on purpose and cited in the doc: Hick's law (few choices per decision, the class
 * picker is two small steps), endowed progress (the bar starts with "Account" already done), commitment via the
 * goal in their own words, a curiosity gap while the skill map builds, a fast first win (the check opens on a
 * foundation skill), reduced threat (no score, no timer, "I don't know" is welcome), autonomy (everything after
 * the goal can be skipped), warm relatedness (the tutor speaks in the first person) and a peak-end results screen.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, Lock, Sparkles } from 'lucide-react'
import { LEVELS, PURPOSES, isMinor, visibleScreens, type Answers, type IntakeScreen } from '@/lib/intake'
import { detectDistress } from '@/lib/safety'
import { RichText } from './rich-text'
import { ItemFigure } from './item-figure'
import type { PublicFigure } from '@/lib/assessment/spec'
import { SafetyPause } from './safety-pause'
import { Alert, Pending, buttonClass, cx, inputClass } from './ui'
import { InkMark, StageList } from './system/wait'

type Phase = 'intake' | 'ready' | 'building' | 'diag' | 'finishing' | 'result'

interface DiagView {
  pathId: string
  goal: string
  subject: string
  status: string
  asked: number
  min: number
  max: number
  item: { node: string; topic: string; item: number; q: string; options: string[]; figure?: PublicFigure; number: number } | null
  done: boolean
  fresh?: boolean
  known?: string[]
  next?: string[]
}
type Signals = { efficacy: number; anxious: boolean; underconfident?: boolean } | null
interface Suggestions { goals: { goal: string; subject: string; stem: boolean }[]; reflection?: string; prior?: string; contexts?: string[]; purpose?: string | null }

const STEM_GUESS = /\b(math|maths|algebra|equation|quadratic|calculus|geometry|trigonometr|statistic|physics|chemistr|solar|pv|circuit|electric|engineer|coding|code|program|python|java|data|science|biology)\b/i
const STARTERS = ['Quadratic equations', 'How electricity works', 'Python basics', 'Solar panels for a home', 'Chemistry basics']
const STAGES: { id: string; label: string; match: (v: string) => boolean }[] = [
  { id: 'primary', label: 'Primary', match: v => v.startsWith('Primary') },
  { id: 'secondary', label: 'Secondary', match: v => /^(JSS|SS)\d/.test(v) },
  { id: 'tertiary', label: 'Tertiary', match: v => /^(University|ND|Postgraduate)/.test(v) },
  { id: 'done', label: 'Not in school', match: v => v === 'Finished school' || v === 'Other' },
]

async function post<T>(url: string, body: unknown, method = 'POST'): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
  if (!res) return { ok: false, status: 0, data: {} as T }
  const data = await res.json().catch(() => ({})) as T
  return { ok: res.ok, status: res.status, data }
}

const ease = [0.2, 0, 0, 1] as const
const clock = () => Date.now()
const firstWords = (s: string, n = 9) => { const w = s.trim().replace(/[.!?]+$/, '').split(/\s+/); return w.length > n ? w.slice(0, n).join(' ') + '…' : w.join(' ') }

export function IntakeFlow({
  firstName, initialAnswers, initialItem, completed, initialPath, edit, startAt, startFresh = false,
}: {
  firstName: string
  initialAnswers: Answers
  initialItem: string | null
  completed: boolean
  initialPath: DiagView | null
  edit: boolean
  /** Screen (or item) to open on (e.g. 'goal' when adding a new goal). */
  startAt?: string
  startFresh?: boolean
}) {
  const reduce = useReducedMotion()
  const [answers, setAnswers] = useState<Answers>(initialAnswers)
  const screens = useMemo(() => visibleScreens(answers), [answers])
  const screenFor = (id: string | null | undefined, list: IntakeScreen[]) => (id ? list.findIndex(s => s.id === id || s.items.includes(id)) : -1)
  const [idx, setIdx] = useState(() => {
    const list = visibleScreens(initialAnswers)
    if (edit) return Math.max(0, screenFor(startAt, list))
    const at = screenFor(initialItem, list)
    const open = list.findIndex(s => !s.optional && s.items.some(i => i !== 'last_studied' && !initialAnswers[i]))
    return open >= 0 ? open : Math.max(0, at)
  })
  const initialPhase: Phase = edit ? 'intake'
    : initialPath?.status === 'ready' ? 'result'
    : initialPath?.status === 'diagnosing' && initialPath.item ? 'diag'
    : completed ? 'ready' : 'intake'
  const [phase, setPhase] = useState<Phase>(initialPhase)
  const [diag, setDiag] = useState<DiagView | null>(initialPath)
  const [firstLessonId, setFirstLessonId] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [safety, setSafety] = useState(false)
  const [fresh, setFresh] = useState(startFresh)
  const [signals, setSignals] = useState<Signals>(null)
  const [sugg, setSugg] = useState<Suggestions | 'loading' | 'failed' | null>(null)
  const [mapState, setMapState] = useState<'idle' | 'building' | 'ready' | 'failed'>('idle')
  const suggFor = useRef<string>('')
  const pendingPurpose = useRef<Record<string, unknown> | null>(null)
  const leftPurpose = useRef(false)
  const autoStarted = useRef(false)

  const screen = screens[Math.min(idx, screens.length - 1)]
  const minor = isMinor(answers)

  // The first lesson is drafted and voiced during the check: wake the voice and render containers now.
  useEffect(() => {
    if (initialPhase === 'result') return
    void fetch('/api/tts/warm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manim: true }), keepalive: true }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Narrowed goal suggestions, asked as soon as the goal is typed so they are ready two screens later. */
  const fetchSuggestions = useCallback((goal: string) => {
    if (!goal || suggFor.current === goal) return
    suggFor.current = goal
    setSugg('loading')
    void post<Suggestions & { safety?: boolean }>('/api/intake/ai', { kind: 'goals', goal }).then(r => {
      if (suggFor.current !== goal) return
      if (r.data.safety) { setSafety(true); setSugg('failed'); return }
      setSugg(r.ok && r.data.goals?.length ? r.data : 'failed')
    })
  }, [])
  useEffect(() => {
    const g = typeof answers.goal?.v === 'string' ? answers.goal.v : ''
    if (phase === 'intake' && screen?.id === 'goal_pick' && g && suggFor.current !== g) fetchSuggestions(g)
  }, [phase, screen, answers.goal, fetchSuggestions])

  /* ── The skill map / check (built in the background while the last screen is answered) ── */
  const applyPurpose = useCallback(async (pathId: string) => {
    const p = pendingPurpose.current
    if (!p) return
    pendingPurpose.current = null
    await post(`/api/paths/${pathId}`, p, 'PATCH')
  }, [])

  const finish = useCallback(async (inPlace = false, skip = false) => {
    if (!inPlace) setPhase('finishing')
    setError(null); setFinishing(true)
    const r = await post<{ path?: DiagView; firstLessonId?: string | null; signals?: Signals; error?: string }>('/api/diagnostic', { action: 'finish', skip })
    setFinishing(false)
    if (!r.ok || !r.data.path) { if (inPlace) setPhase('finishing'); setError(r.data.error ?? 'Could not build your path. Please try again.'); return }
    setDiag(r.data.path); setFirstLessonId(r.data.firstLessonId ?? null); setSignals(r.data.signals ?? null); setPhase('result')
  }, [])

  /** Where to go once the map exists (called when the learner leaves the last screen, or when the map lands after). */
  const enterCheck = useCallback((view: DiagView | null, lessonId?: string | null) => {
    if (!view) { setPhase('building'); return }
    if (view.status === 'ready') { setFirstLessonId(lessonId ?? null); setPhase('result'); if (!lessonId) void finish(true); return }
    setPhase(view.done ? 'finishing' : 'diag')
  }, [finish])

  const startDiag = useCallback(async (restart = false, skip = false, background = false) => {
    setError(null); setMapState('building')
    if (!background) setPhase('building')
    const r = await post<{ path?: DiagView; firstLessonId?: string | null; error?: string }>('/api/diagnostic', { action: 'start', restart, skip })
    if (!r.ok || !r.data.path) {
      setMapState('failed')
      setError(r.data.error ?? 'Could not prepare your check. Please try again.')
      if (!background || leftPurpose.current) setPhase('ready')
      return
    }
    setMapState('ready')
    setDiag(r.data.path)
    void applyPurpose(r.data.path.pathId)
    if (r.data.path.status === 'ready') setFirstLessonId(r.data.firstLessonId ?? null)
    if (!background || leftPurpose.current) enterCheck(r.data.path, r.data.firstLessonId)
  }, [applyPurpose, enterCheck])

  useEffect(() => {
    if (phase !== 'ready' || autoStarted.current || error) return
    autoStarted.current = true
    void startDiag(false)
  }, [phase, error, startDiag])

  /** Save a screen's answers together; then move on (or complete the intake and start the map in the background). */
  const submitScreen = useCallback(async (patch: Answers, extra: Record<string, unknown> = {}) => {
    setError(null)
    for (const a of Object.values(patch)) if (typeof a.v === 'string' && detectDistress(a.v)) { setSafety(true); return }
    const nextAnswers = { ...answers, ...patch }
    const list = visibleScreens(nextAnswers)
    const pos = list.findIndex(s => s.id === screen.id)
    const next = list[pos + 1]
    const completing = next?.id === 'purpose' || (!next && screen.id !== 'purpose')
    setBusy(true)
    const r = await post<{ ok?: boolean; safety?: boolean; error?: string; startFresh?: boolean }>('/api/intake', { answers: patch, currentItem: (next ?? screen).items[0], ...extra, ...(completing ? { complete: true } : {}) })
    setBusy(false)
    if (r.data.safety) { setSafety(true); return }
    if (!r.ok) { setError(r.data.error ?? 'That didn’t save. Check your connection and try again.'); return }
    setAnswers(nextAnswers)
    if (screen.id === 'goal' && typeof patch.goal?.v === 'string') fetchSuggestions(patch.goal.v)
    if (completing) {
      setFresh(!!r.data.startFresh)
      leftPurpose.current = false
      autoStarted.current = true
      void startDiag(false, false, true)
    }
    if (screen.id === 'purpose') {
      leftPurpose.current = true
      if (mapState === 'ready') enterCheck(diag, firstLessonId)
      else if (mapState === 'failed') setPhase('ready')
      else setPhase('building')
      return
    }
    if (next) setIdx(pos + 1)
  }, [answers, screen, fetchSuggestions, startDiag, mapState, diag, firstLessonId, enterCheck])

  const back = () => { setError(null); setIdx(i => Math.max(0, i - 1)) }

  const answerDiag = useCallback(async (choice: number | null, confidence: string | null, ms: number) => {
    if (!diag?.item) return
    setBusy(true); setError(null)
    const r = await post<{ path?: DiagView; firstLessonId?: string | null; signals?: Signals; error?: string }>('/api/diagnostic', { action: 'answer', node: diag.item.node, item: diag.item.item, choice, confidence, ms })
    setBusy(false)
    if (!r.ok || !r.data.path) { setError(r.data.error ?? 'That didn’t save. Try again.'); return }
    setDiag(r.data.path)
    if (!r.data.path.done) return
    setSignals(r.data.signals ?? null)
    setPhase('result')
    if (r.data.firstLessonId) setFirstLessonId(r.data.firstLessonId)
    else if (r.data.path.status !== 'ready') void finish(true)
  }, [diag, finish])

  useEffect(() => { if (phase === 'finishing' && diag?.done && diag.status !== 'ready') setTimeout(() => void finish(), 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Endowed progress: "Account" is already done, so the learner starts one step in.
  const steps = ['Account', 'Goal', 'You', 'Path', 'Check']
  const stepOf = (id?: string) => (id === 'goal' ? 1 : id === 'about' || id === 'consent' ? 2 : 3)
  const step = phase === 'intake' ? stepOf(screen?.id) + (screen?.id === 'purpose' ? 0.5 : 0) : phase === 'diag' && diag ? 4 + Math.min(0.9, diag.asked / Math.max(diag.min, 1)) : phase === 'result' ? 5 : 3.8

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="pt-safe sticky top-0 z-30 bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[640px] items-center justify-between px-5 sm:px-6">
          <Link href="/" className="inline-flex items-center gap-2 font-display text-[18px] text-ink" aria-label="Ideanimo home">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] bg-accent text-[15px] text-white">I</span>Ideanimo
          </Link>
          <Link href="/dashboard" className="-mr-2 inline-flex h-11 items-center px-2 text-[13px] font-medium text-muted hover:text-ink">Save and exit</Link>
        </div>
        <div className="mx-auto max-w-[640px] px-5 pb-3 sm:px-6">
          <div className="flex gap-1.5" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={5} aria-valuenow={Math.floor(step)}>
            {steps.map((s, i) => {
              const f = Math.max(0, Math.min(1, step - i))
              return (
                <div key={s} className="h-[5px] flex-1 overflow-hidden rounded-full bg-sunken" title={s}>
                  <motion.div className="h-full rounded-full bg-accent" initial={false} animate={{ width: `${Math.round(f * 100)}%` }} transition={{ duration: reduce ? 0 : 0.5, ease }} />
                </div>
              )
            })}
          </div>
          <div className="mt-2 flex justify-between text-[12px] text-faint">
            <span>{phase === 'result' ? 'Your map' : steps[Math.min(4, Math.floor(step))]}</span>
            <span className="tnum">{phase === 'intake' ? (screen?.id === 'goal' ? 'About a minute to set up' : screen?.id === 'purpose' ? 'Almost there' : `${Math.max(1, 4 - Math.floor(step))} quick ${4 - Math.floor(step) === 1 ? 'step' : 'steps'} left`) : phase === 'diag' ? 'Short check' : phase === 'result' ? 'Done' : ''}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col px-5 pt-3 sm:px-6 sm:pt-8">
        <AnimatePresence mode="wait" initial={false}>
          {phase === 'intake' && screen && (
            <motion.section key={screen.id} initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, x: -24 }}
              transition={{ duration: reduce ? 0.01 : 0.28, ease }} className="flex flex-1 flex-col">
              {idx > 0 && screen.id !== 'purpose' && (
                <div className="-mt-1 mb-2 flex items-center">
                  <button type="button" onClick={back} className="-ml-3 inline-flex h-11 items-center gap-1 rounded-[10px] px-3 text-[14px] text-muted hover:bg-sunken hover:text-ink"><ArrowLeft className="h-4 w-4" strokeWidth={1.75} />Back</button>
                </div>
              )}
              {screen.id === 'goal' && <GoalScreen firstName={firstName} answers={answers} busy={busy} isNewGoal={edit && startAt === 'goal' && !!answers.age} onSubmit={p => submitScreen(p)} />}
              {screen.id === 'about' && <AboutScreen answers={answers} busy={busy} onSubmit={p => submitScreen(p)} />}
              {screen.id === 'consent' && <ConsentScreen busy={busy} onSubmit={email => submitScreen({ consent: { v: true }, age: answers.age, ...(answers.level ? { level: answers.level } : {}) }, { consent: { guardianEmail: email } })} />}
              {screen.id === 'goal_pick' && <GoalPickScreen answers={answers} sugg={sugg} busy={busy} onRetry={() => { suggFor.current = ''; fetchSuggestions(String(answers.goal?.v ?? '')) }} onSubmit={p => submitScreen(p)} />}
              {screen.id === 'purpose' && (
                <PurposeScreen answers={answers} guess={sugg && typeof sugg === 'object' ? sugg.purpose ?? null : null} mapState={mapState} fresh={fresh} busy={busy}
                  onSubmit={(p, pathPatch) => { pendingPurpose.current = pathPatch; if (diag?.pathId && pathPatch) void applyPurpose(diag.pathId); void submitScreen(p) }} />
              )}
              {error && <Alert tone="danger" className="mt-4">{error}</Alert>}
            </motion.section>
          )}

          {(phase === 'ready' || phase === 'building' || phase === 'finishing') && (
            <motion.section key="building" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-1 flex-col pt-6">
              <TutorLine>{phase === 'finishing' ? 'Writing your first lesson.' : fresh ? 'Laying out your path.' : 'Mapping your path.'}</TutorLine>
              <Title>{phase === 'finishing' ? 'Your path is taking shape' : 'Your map is taking shape'}</Title>
              <MapSkeleton reduce={!!reduce} />
              {/* The real stages of the build (each tied to a server step), not a timer or a percentage. */}
              {!error && (
                <div className="mt-6" role="status" aria-live="polite">
                  <StageList stages={[
                    { label: fresh ? 'Laying out the ideas up to your goal' : 'Mapping the skills to your goal', state: phase === 'finishing' ? 'done' : 'now' },
                    { label: fresh ? 'Choosing your first idea and writing its lesson' : 'Picking where you start and writing your first lesson', state: phase === 'finishing' ? 'now' : 'next' },
                  ]} />
                  <p className="mt-3 text-[13px] text-muted">Under a minute.</p>
                </div>
              )}
              {error && (
                <div className="mt-4">
                  <Alert tone="danger">{error}</Alert>
                  <button type="button" onClick={() => (phase === 'finishing' ? finish() : startDiag(false))} className={buttonClass('primary', 'lg', 'mt-4 w-full sm:w-auto')}>Try again</button>
                </div>
              )}
            </motion.section>
          )}

          {phase === 'diag' && diag?.item && (
            <motion.div key="diag" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-1 flex-col">
              <AnimatePresence mode="wait" initial={false}>
                <DiagQuestion key={`${diag.item.node}:${diag.item.item}`} view={diag} busy={busy} error={error} reduce={!!reduce} onAnswer={answerDiag} onSkipRest={() => void finish(false, true)} />
              </AnimatePresence>
            </motion.div>
          )}

          {phase === 'result' && diag && (
            <ResultScreen key="result" diag={diag} firstLessonId={firstLessonId} finishing={finishing} signals={signals} reduce={!!reduce} onRetake={() => startDiag(true)} />
          )}
        </AnimatePresence>
      </main>

      <SafetyPause open={safety} minor={answers.age ? minor : null} onContinue={() => setSafety(false)} />
    </div>
  )
}

/* ───────────── Shared pieces ───────────── */

/** The tutor speaking in the first person: warm relatedness, kept short. */
function TutorLine({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div className={cx('flex items-start gap-3', className)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.08, ease }}>
      <span aria-hidden className="mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent font-display text-[15px] text-white shadow-[var(--shadow-card)]">I</span>
      <p className="min-w-0 rounded-[14px] rounded-tl-[4px] bg-surface px-3.5 py-2.5 text-[15px] leading-relaxed text-ink-2 shadow-[var(--shadow-card)] ring-1 ring-line">{children}</p>
    </motion.div>
  )
}

function Title({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h1 className="font-display text-[30px] leading-[1.12] tracking-[-0.01em] text-ink sm:text-[36px]">{children}</h1>
      {sub && <p className="mt-2 text-[15px] leading-relaxed text-muted">{sub}</p>}
    </div>
  )
}

/** Bottom-anchored action bar (thumb zone): one primary action, an optional quiet secondary. */
function ActionBar({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-5 mt-auto bg-canvas px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3 before:pointer-events-none before:absolute before:inset-x-0 before:-top-8 before:h-8 before:bg-gradient-to-t before:from-canvas before:to-canvas/0 sm:-mx-6 sm:px-6">
      {note && <p className="mb-3 text-center text-[12px] leading-snug text-faint">{note}</p>}
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

function Chip({ on, onClick, children, className, ...rest }: { on?: boolean; onClick?: () => void; children: React.ReactNode; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cx('inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-4 text-[15px] transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97]',
        on ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-ink-2 hover:border-line-strong', className)} {...rest}>
      {on && <Check className="h-4 w-4" strokeWidth={2.25} />}{children}
    </button>
  )
}

/* ───────────── Screen 1: the goal, in their own words ───────────── */

function GoalScreen({ firstName, answers, busy, isNewGoal, onSubmit }: { firstName: string; answers: Answers; busy: boolean; isNewGoal: boolean; onSubmit: (p: Answers) => void }) {
  const [text, setText] = useState(typeof answers.goal?.v === 'string' ? answers.goal.v : '')
  const ref = useRef<HTMLTextAreaElement>(null)
  const ok = text.trim().length >= 2
  const submit = () => { if (ok && !busy) onSubmit({ goal: { v: text.trim().slice(0, 600) } }) }
  return (
    <>
      <TutorLine>{isNewGoal ? 'Something new? Great.' : <>Hi {firstName}! Four quick steps, then we learn.</>}</TutorLine>
      <Title sub="A few words is plenty.">What do you want to learn?</Title>
      <textarea ref={ref} value={text} maxLength={600} rows={2} autoFocus aria-label="What you want to learn"
        placeholder="e.g. Solve quadratic equations without getting stuck" onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
        className="mt-6 block w-full resize-none rounded-[14px] border border-line bg-surface px-4 py-3.5 font-display text-[20px] leading-snug text-ink shadow-[var(--shadow-card)] placeholder:text-faint focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/10" />
      <p className="mt-5 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Or pick one</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {STARTERS.map(s => <Chip key={s} on={text === s} onClick={() => { setText(s); ref.current?.focus() }} className="px-3.5 text-[14px]">{s}</Chip>)}
      </div>
      <ActionBar note={<span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" strokeWidth={2} />Private to you.</span>}>
        <button type="button" disabled={!ok || busy} onClick={submit} className={buttonClass('primary', 'lg', 'w-full')}><Pending busy={busy} label="Saving">Continue<ArrowRight className="h-4 w-4" strokeWidth={2} /></Pending></button>
      </ActionBar>
    </>
  )
}

/* ───────────── Screen 2: age + class, one compact screen ───────────── */

function AboutScreen({ answers, busy, onSubmit }: { answers: Answers; busy: boolean; onSubmit: (p: Answers) => void }) {
  const [age, setAge] = useState<string | null>(typeof answers.age?.v === 'string' ? answers.age.v : null)
  const [level, setLevel] = useState<string | null>(typeof answers.level?.v === 'string' ? answers.level.v : null)
  const [stage, setStage] = useState<string | null>(() => (level ? STAGES.find(s => s.match(level))?.id ?? null : null))
  const goal = typeof answers.goal?.v === 'string' ? answers.goal.v : ''
  const options = stage ? LEVELS.filter(l => STAGES.find(s => s.id === stage)!.match(l.value)) : []
  return (
    <>
      <TutorLine>{goal ? <>“{firstWords(goal)}”. Good choice. Two taps to set your level.</> : 'Two taps to set your level.'}</TutorLine>
      <Title>A little about you</Title>
      <fieldset className="mt-7">
        <legend className="text-[13px] font-medium text-ink-2">Your age</legend>
        <div className="mt-2.5 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Age">
          {[['under13', 'Under 13'], ['13to17', '13–17'], ['18plus', '18+']].map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={age === v} onClick={() => setAge(v)}
              className={cx('h-12 rounded-[12px] border text-[16px] font-medium transition-colors active:scale-[0.98]', age === v ? 'border-accent bg-accent-soft text-accent ring-1 ring-accent' : 'border-line bg-surface text-ink hover:border-line-strong')}>{l}</button>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-7">
        <legend className="text-[13px] font-medium text-ink-2">Your class or year <span className="font-normal text-muted">(or last finished)</span></legend>
        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STAGES.map(s => (
            <button key={s.id} type="button" aria-pressed={stage === s.id} onClick={() => { setStage(s.id); if (level && !s.match(level)) setLevel(null) }}
              className={cx('h-11 rounded-[12px] border text-[15px] transition-colors', stage === s.id ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink-2 hover:border-line-strong')}>{s.label}</button>
          ))}
        </div>
        <AnimatePresence initial={false}>
          {stage && (
            <motion.div key={stage} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22, ease }} className="overflow-hidden">
              <div className="flex flex-wrap gap-2 pt-3" role="radiogroup" aria-label="Class or year">
                {options.map(o => <Chip key={o.value} on={level === o.value} role="radio" aria-checked={level === o.value} onClick={() => setLevel(o.value)}>{o.label}</Chip>)}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </fieldset>
      <ActionBar note="Never shown to anyone.">
        <button type="button" disabled={!age || !level || busy} onClick={() => onSubmit({ age: { v: age }, level: { v: level } })} className={buttonClass('primary', 'lg', 'w-full')}><Pending busy={busy} label="Saving">Continue<ArrowRight className="h-4 w-4" strokeWidth={2} /></Pending></button>
      </ActionBar>
    </>
  )
}

/* ───────────── Screen 2b: guardian consent (under-18s; NDPA 2023 s.31) ───────────── */

function ConsentScreen({ busy, onSubmit }: { busy: boolean; onSubmit: (email: string) => void }) {
  const [agree, setAgree] = useState(false)
  const [email, setEmail] = useState('')
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
  return (
    <>
      <TutorLine>Because you’re under 18, I need a parent or guardian’s okay before I save your answers.</TutorLine>
      <Title sub="Required by Nigeria’s Data Protection Act (2023, s.31). Show them this screen.">A grown-up’s okay</Title>
      <div className="mt-6 rounded-[14px] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <ul className="space-y-2.5 text-[15px] leading-relaxed text-ink-2">
          {['Answers are used only to pace lessons.', 'Mood check-ins are deleted after two weeks.', 'Answers are never shown to anyone.'].map(t => (
            <li key={t} className="flex gap-2.5"><Check className="mt-1 h-4 w-4 flex-shrink-0 text-accent" strokeWidth={2.25} />{t}</li>
          ))}
        </ul>
        <label className="mt-5 flex min-h-11 cursor-pointer items-start gap-3 text-[15px] leading-snug text-ink">
          <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5 flex-shrink-0 accent-[#1F4D3A]" />
          My parent or guardian has read this and agrees to Ideanimo saving my answers to personalise my lessons.
        </label>
        <label htmlFor="guardian-email" className="mt-4 block text-[13px] font-medium text-ink-2">Parent or guardian’s email</label>
        <input id="guardian-email" type="email" inputMode="email" autoComplete="off" className={cx(inputClass, 'mt-1.5 h-12 text-[16px]')} value={email} onChange={e => setEmail(e.target.value)} placeholder="parent@example.com" />
      </div>
      <p className="mt-4 text-[13px] text-muted">Not now? <Link href="/dashboard" className="font-medium text-accent underline-offset-4 hover:underline">Come back later</Link>. Nothing beyond your age is saved until they agree.</p>
      <ActionBar>
        <button type="button" disabled={busy || !agree || !valid} onClick={() => onSubmit(email.trim())} className={buttonClass('primary', 'lg', 'w-full')}><Pending busy={busy} label="Sending to your parent">We agree, continue<ArrowRight className="h-4 w-4" strokeWidth={2} /></Pending></button>
      </ActionBar>
    </>
  )
}

/* ───────────── Screen 3: narrow the goal + how familiar it is ───────────── */

function GoalPickScreen({ answers, sugg, busy, onRetry, onSubmit }: { answers: Answers; sugg: Suggestions | 'loading' | 'failed' | null; busy: boolean; onRetry: () => void; onSubmit: (p: Answers) => void }) {
  const own = typeof answers.goal?.v === 'string' ? answers.goal.v : ''
  const prev = answers.goal_pick?.v as { goal?: string } | undefined
  const [pick, setPick] = useState<string | null>(prev?.goal ?? null)
  const [fam, setFam] = useState<string | null>(typeof answers.last_studied?.v === 'string' && ['never', 'some', 'now'].includes(answers.last_studied.v) ? answers.last_studied.v : null)
  const data = sugg && typeof sugg === 'object' ? sugg : null
  const loading = sugg === 'loading' || sugg === null
  const goals = data?.goals ?? []
  const submit = () => {
    const g = goals.find(x => x.goal === pick)
    const prior = data?.prior ?? 'unclear'
    const v = g ? { ...g, prior, contexts: data?.contexts ?? [] } : { goal: own, subject: '', stem: STEM_GUESS.test(own), prior, contexts: data?.contexts ?? [] }
    onSubmit({ goal_pick: { v }, last_studied: fam ? { v: fam } : { skipped: true } })
  }
  return (
    <>
      <TutorLine>{data?.reflection || 'Let’s make it specific.'}</TutorLine>
      <Title>Which is closest?</Title>
      <div className="mt-5 grid gap-2" role="radiogroup" aria-label="Goal">
        {loading && [0, 1, 2].map(i => (
          <div key={i} className="flex h-[68px] items-center gap-3 rounded-[14px] border border-line bg-surface px-4" aria-hidden><span className="h-5 w-5 shrink-0 rounded-full border border-line-strong" /><span className="min-w-0 flex-1"><span className="skeleton block h-3.5 w-4/5" /><span className="skeleton mt-2.5 block h-2.5 w-1/4" /></span></div>
        ))}
        {goals.map((g, i) => (
          <motion.button key={g.goal} type="button" role="radio" aria-checked={pick === g.goal} disabled={busy} onClick={() => setPick(g.goal)}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.22, ease }}
            className={cx('flex min-h-[64px] items-center gap-3 rounded-[14px] border bg-surface px-4 py-3 text-left transition-colors', pick === g.goal ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-line-strong')}>
            <span className={cx('flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border', pick === g.goal ? 'border-accent bg-accent' : 'border-line-strong')}>{pick === g.goal && <Check className="h-3 w-3 text-white" strokeWidth={3} />}</span>
            <span className="min-w-0">
              <span className="block text-[15px] font-medium leading-snug text-ink"><RichText text={g.goal} /></span>
              {g.subject && <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{g.subject}</span>}
            </span>
          </motion.button>
        ))}
        {own && (
          <button type="button" role="radio" aria-checked={pick === own} disabled={busy} onClick={() => setPick(own)}
            className={cx('flex min-h-[56px] items-center gap-3 rounded-[14px] border border-dashed px-4 py-3 text-left text-[15px] transition-colors', pick === own ? 'border-accent bg-accent-soft' : 'border-line-strong hover:border-accent')}>
            <span className={cx('flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border', pick === own ? 'border-accent bg-accent' : 'border-line-strong')}>{pick === own && <Check className="h-3 w-3 text-white" strokeWidth={3} />}</span>
            <span className="min-w-0 text-ink-2">Keep my words: <span className="italic text-ink">“{own}”</span></span>
          </button>
        )}
        {sugg === 'failed' && <p className="text-[14px] text-muted">I couldn’t suggest goals just now. <button type="button" onClick={onRetry} className="font-medium text-accent underline-offset-4 hover:underline">Try again</button>, or keep your own words.</p>}
      </div>
      <fieldset className="mt-7">
        <legend className="text-[13px] font-medium text-ink-2">How well do you know it already? <span className="font-normal text-muted">Optional</span></legend>
        <div className="mt-2.5 grid grid-cols-3 gap-2" role="radiogroup" aria-label="How well you know it">
          {[['never', 'It’s new to me'], ['some', 'I know a bit'], ['now', 'Studying it now']].map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={fam === v} onClick={() => setFam(f => (f === v ? null : v))}
              className={cx('min-h-12 rounded-[12px] border px-2 text-[14px] leading-tight transition-colors', fam === v ? 'border-accent bg-accent-soft font-medium text-accent ring-1 ring-accent' : 'border-line bg-surface text-ink-2 hover:border-line-strong')}>{l}</button>
          ))}
        </div>
        {fam === 'never' && <p className="mt-2 text-[13px] text-muted">No check, then. We start from the first idea.</p>}
      </fieldset>
      <ActionBar>
        <button type="button" disabled={!pick || busy} onClick={submit} className={buttonClass('primary', 'lg', 'w-full')}><Pending busy={busy} label="Starting your map">Build my path<ArrowRight className="h-4 w-4" strokeWidth={2} /></Pending></button>
      </ActionBar>
    </>
  )
}

/* ───────────── Screen 4 (optional): what for / by when, shown while the map builds ───────────── */

function PurposeScreen({ answers, guess, mapState, fresh, busy, onSubmit }: {
  answers: Answers; guess: string | null; mapState: string; fresh: boolean; busy: boolean
  onSubmit: (p: Answers, pathPatch: Record<string, unknown> | null) => void
}) {
  const [purpose, setPurpose] = useState<string | null>(typeof answers.purpose?.v === 'string' ? answers.purpose.v : guess)
  const [dated, setDated] = useState(typeof answers.deadline?.v === 'string' && !!answers.deadline.v)
  const [date, setDate] = useState(typeof answers.deadline?.v === 'string' ? answers.deadline.v : '')
  const today = new Date().toISOString().slice(0, 10)
  const ready = mapState === 'ready'
  return (
    <>
      <div className="flex items-center gap-2 self-start rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-2 shadow-[var(--shadow-card)]" role="status" aria-live="polite">
        {ready ? <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.5} /> : <InkMark className="text-accent" width={16} />}
        {ready ? (fresh ? 'Your path is ready' : 'Your check is ready') : fresh ? 'Laying out your path' : 'Mapping the skills to your goal'}
      </div>
      <Title sub="Optional. It shapes your examples.">While I map it: what’s it for?</Title>
      <div className="mt-5 flex flex-wrap gap-2" role="radiogroup" aria-label="What it’s for">
        {PURPOSES.map(p => (
          <Chip key={p.value} role="radio" aria-checked={purpose === p.value} on={purpose === p.value} onClick={() => setPurpose(x => (x === p.value ? null : p.value))} title={p.hint}>
            {p.label}
            {guess === p.value && <span className={cx('ml-0.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]', purpose === p.value ? 'bg-white/20 text-white' : 'bg-accent-soft text-accent')}><Sparkles className="h-2.5 w-2.5" strokeWidth={2.5} />guess</span>}
          </Chip>
        ))}
      </div>
      <fieldset className="mt-6">
        <legend className="text-[13px] font-medium text-ink-2">Need it by a date?</legend>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Chip on={!dated} onClick={() => setDated(false)}>No date</Chip>
          <Chip on={dated} onClick={() => setDated(true)}>Pick a date</Chip>
          {dated && <input type="date" min={today} value={date} onChange={e => setDate(e.target.value)} aria-label="Date you need it by" className={cx(inputClass, 'h-11 w-auto min-w-[170px]')} />}
        </div>
      </fieldset>
      <ActionBar>
        <button type="button" disabled={busy} onClick={() => onSubmit({ purpose: { skipped: true }, deadline: { skipped: true } }, null)} className={buttonClass('ghost', 'lg', 'px-4')}>Skip</button>
        <button type="button" disabled={busy || (dated && !date)} onClick={() => {
          const d = dated && date ? date : ''
          onSubmit({ purpose: purpose ? { v: purpose } : { skipped: true }, deadline: { v: d } }, { ...(purpose ? { purpose } : {}), deadline: d || null })
        }} className={buttonClass('primary', 'lg', 'flex-1')}><Pending busy={busy} label="Saving">{ready ? (fresh ? 'See my path' : 'Start the check') : 'Continue'}<ArrowRight className="h-4 w-4" strokeWidth={2} /></Pending></button>
      </ActionBar>
    </>
  )
}

/* ───────────── While the map builds: a skeleton of the map itself (curiosity, not a spinner) ───────────── */

function MapSkeleton({ reduce }: { reduce: boolean }) {
  const rows = [0.62, 0.48, 0.7, 0.4, 0.56]
  return (
    <div className="mt-6 rounded-[14px] border border-line bg-surface p-5 shadow-[var(--shadow-card)]" aria-hidden>
      {rows.map((w, i) => (
        <motion.div key={i} className="flex items-center gap-3 py-2.5" initial={{ opacity: 0.25 }} animate={reduce ? { opacity: 0.6 } : { opacity: [0.25, 0.85, 0.25] }}
          transition={reduce ? { duration: 0 } : { duration: 1.8, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }}>
          <span className="relative flex h-6 w-6 flex-shrink-0 items-center justify-center">
            {i < rows.length - 1 && <span className="absolute top-6 h-5 w-px bg-line-strong" />}
            <span className="h-3.5 w-3.5 rounded-full border-2 border-accent bg-accent-soft" />
          </span>
          <span className="h-3 rounded-full bg-line" style={{ width: `${w * 100}%` }} />
        </motion.div>
      ))}
    </div>
  )
}

/* ───────────── The check: one question at a time, with a confidence tap (measures it implicitly) ───────────── */

function DiagQuestion({ view, busy, error, reduce, onAnswer, onSkipRest }: { view: DiagView; busy: boolean; error: string | null; reduce: boolean; onAnswer: (choice: number | null, confidence: string | null, ms: number) => void; onSkipRest: () => void }) {
  const it = view.item!
  const [choice, setChoice] = useState<number | null>(null)
  const [pressed, setPressed] = useState<string | null>(null)
  const shownAt = useRef(0)
  useEffect(() => { shownAt.current = clock() }, [])
  // Read in event handlers only (time on the question, for the hesitation signal).
  const ms = () => Math.max(0, clock() - shownAt.current)
  const first = it.number === 1 || view.asked === 0
  return (
    <motion.section initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, x: -24 }} transition={{ duration: reduce ? 0.01 : 0.26, ease }} className="flex flex-1 flex-col">
      {first ? (
        <TutorLine className="mt-1">A quick check to find your start. No score, no timer. “I don’t know” helps too.</TutorLine>
      ) : (
        <div className="mt-1 flex h-8 items-center justify-between text-[13px] text-muted">
          <span className="min-w-0 truncate pr-3"><RichText text={it.topic} /></span>
          <span className="tnum flex-shrink-0">Question {it.number} · about {view.min}</span>
        </div>
      )}
      <h1 className="mt-5 font-display text-[25px] leading-[1.25] text-ink sm:text-[29px]"><RichText text={it.q} /></h1>
      <ItemFigure figure={it.figure} />
      <div className="mt-6 grid gap-2" role="radiogroup" aria-label="Answer options">
        {it.options.map((o, i) => (
          <button key={i} type="button" role="radio" aria-checked={choice === i} disabled={busy} onClick={() => setChoice(i)}
            className={cx('flex min-h-[52px] items-center gap-3 rounded-[12px] border bg-surface px-4 py-3 text-left text-[16px] text-ink transition-colors active:scale-[0.99]', choice === i ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-line-strong')}>
            <span className={cx('flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold', choice === i ? 'border-accent bg-accent text-white' : 'border-line-strong text-muted')}>{String.fromCharCode(65 + i)}</span>
            <span className="min-w-0"><RichText text={o} /></span>
          </button>
        ))}
      </div>
      {error && <Alert tone="danger" className="mt-4">{error}</Alert>}
      <button type="button" disabled={busy} onClick={onSkipRest} className="mt-4 inline-flex min-h-11 items-center self-start text-[13px] text-muted hover:text-ink">
        Rather not finish? <span className="ml-1 font-medium text-accent">Skip the rest</span>
      </button>
      <ActionBar>
        <AnimatePresence mode="wait" initial={false}>
          {choice === null ? (
            <motion.div key="idk" className="flex w-full items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <button type="button" disabled={busy} onClick={() => onAnswer(null, null, ms())} className={buttonClass('secondary', 'lg', 'w-full')}><Pending busy={busy} label="Next question">I don’t know yet</Pending></button>
            </motion.div>
          ) : (
            <motion.div key="conf" className="w-full" initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease }}>
              <p className="mb-2 text-center text-[13px] font-medium text-ink-2">How sure are you?</p>
              <div className="grid grid-cols-3 gap-2">
                {[['guess', 'Guessing'], ['fairly', 'Fairly sure'], ['sure', 'Sure']].map(([v, l]) => (
                  <button key={v} type="button" disabled={busy} onClick={() => { setPressed(v); onAnswer(choice, v, ms()) }} className={buttonClass(v === 'sure' ? 'primary' : 'secondary', 'lg', 'px-2')}><Pending busy={busy && pressed === v} label="">{l}</Pending></button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </ActionBar>
    </motion.section>
  )
}

/* ───────────── Results: the peak and the end (competence, growth framing, one clear next step) ───────────── */

function ResultScreen({ diag, firstLessonId, finishing, signals, reduce, onRetake }: { diag: DiagView; firstLessonId: string | null; finishing: boolean; signals: Signals; reduce: boolean; onRetake: () => void }) {
  const known = diag.known ?? []
  const next = diag.next ?? []
  const items: { t: string; s: 'known' | 'start' | 'next' }[] = [...known.map(t => ({ t, s: 'known' as const })), ...next.slice(0, 3).map((t, i) => ({ t, s: i === 0 ? 'start' as const : 'next' as const }))]
  const headline = diag.fresh && !known.length ? 'A fresh start, from the first idea.'
    : known.length ? `You already know ${known.length} ${known.length === 1 ? 'skill' : 'skills'} on the way.` : 'We’ll build it from the foundations.'
  const encouragement = signals?.underconfident ? 'You know more than you think.'
    : diag.fresh && !known.length ? 'One idea at a time.'
    : 'A starting point, not a label.'
  return (
    <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="flex flex-1 flex-col">
      <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.08em] text-accent"><Sparkles className="h-3.5 w-3.5" strokeWidth={2} />Your map is ready</p>
      <h1 className="mt-2 font-display text-[30px] leading-[1.12] text-ink sm:text-[36px]">{headline}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted"><RichText text={diag.goal} /></p>
      <ol className="relative mt-6 rounded-[14px] border border-line bg-surface p-4 shadow-[var(--shadow-card)] sm:p-5">
        {items.map((x, i) => (
          <motion.li key={x.t + i} className="relative flex gap-3 py-2" initial={reduce ? { opacity: 0 } : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: reduce ? 0 : 0.15 + i * 0.09, duration: 0.3, ease }}>
            <span className="relative flex w-6 flex-shrink-0 justify-center">
              {i < items.length - 1 && <span className={cx('absolute top-7 bottom-[-12px] w-px', x.s === 'known' ? 'bg-accent-line' : 'bg-line-strong [background:repeating-linear-gradient(to_bottom,var(--color-line-strong)_0_4px,transparent_4px_8px)]')} />}
              {x.s === 'known'
                ? <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white"><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
                : x.s === 'start'
                  ? <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-clay bg-clay-soft"><span className="h-2 w-2 rounded-full bg-clay" /></span>
                  : <span className="mt-1.5 h-3.5 w-3.5 rounded-full border-2 border-line-strong bg-surface" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cx('block text-[15px] leading-snug', x.s === 'known' ? 'text-ink-2' : x.s === 'start' ? 'font-medium text-ink' : 'text-muted')}><RichText text={x.t} /></span>
              {x.s === 'start' && <span className="mt-1 inline-block rounded-full bg-clay-soft px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.06em] text-clay">Start here</span>}
            </span>
          </motion.li>
        ))}
      </ol>
      <p className="mt-4 text-[14px] leading-relaxed text-ink-2">{encouragement}</p>
      <div className="mt-4 text-[13px] text-muted">
        {diag.fresh
          ? <>Know some of this already? <button type="button" onClick={onRetake} className="inline-flex min-h-11 items-center font-medium text-accent underline-offset-4 hover:underline">Take the check</button></>
          : <>Not right? <button type="button" onClick={onRetake} className="inline-flex min-h-11 items-center font-medium text-accent underline-offset-4 hover:underline">Retake the check</button></>}
        {' · '}<Link href="/start?new=1" className="font-medium text-accent underline-offset-4 hover:underline">Add another goal</Link>
      </div>
      <ActionBar>
        {firstLessonId
          ? <Link href={`/learn/${firstLessonId}`} prefetch className={buttonClass('primary', 'lg', 'w-full')}>Start your first lesson<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>
          : finishing
            ? <span aria-live="polite" aria-busy="true" className={buttonClass('primary', 'lg', 'pointer-events-none w-full cursor-progress')}><Pending busy label="Writing your first lesson">Start your first lesson<ArrowRight className="h-4 w-4" strokeWidth={2} /></Pending></span>
            : <Link href="/learn" className={buttonClass('primary', 'lg', 'w-full')}>See your path<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>}
      </ActionBar>
    </motion.section>
  )
}


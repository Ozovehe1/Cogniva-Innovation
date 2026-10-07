'use client'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Check, RotateCcw } from 'lucide-react'
import { intelligenceLabel } from '@/components/intelligence'
import { Card, Eyebrow, RadarChart, ScoreBars, Skeleton, buttonClass, cx } from '@/components/ui'

type IntelProfile = {
  dominant_intelligence: string
  intelligence_scores: Record<string, number>
  genius_statement: string
  personality_insight: string
  study_tips: string[]
  learning_path: string[]
  career_suggestions: string[]
}

const ease = [0.2, 0, 0, 1] as const

function AssessmentResults({ profile }: { profile: IntelProfile }) {
  const studyTips = Array.isArray(profile.study_tips) ? profile.study_tips : []
  const learningPath = Array.isArray(profile.learning_path) ? profile.learning_path : []
  const careers = Array.isArray(profile.career_suggestions) ? profile.career_suggestions : []

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease }}
      className="space-y-6 md:space-y-8"
    >
      {/* Summary */}
      <header className="max-w-3xl">
        <Eyebrow className="mb-3">Your profile · strongest in {intelligenceLabel(profile.dominant_intelligence)}</Eyebrow>
        <h1 className="font-display text-[30px] leading-[1.15] text-ink md:text-[42px]">{profile.genius_statement}</h1>
        {profile.personality_insight && (
          <p className="mt-4 text-[16px] leading-relaxed text-ink-2 md:text-[17px]">{profile.personality_insight}</p>
        )}
      </header>

      {/* Scores */}
      <Card padded={false}>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="border-b border-line p-5 md:p-8 lg:border-b-0 lg:border-r">
            <Eyebrow className="mb-2">Shape of your profile</Eyebrow>
            <div className="mx-auto max-w-[360px]">
              <RadarChart scores={profile.intelligence_scores} />
            </div>
          </div>
          <div className="p-5 md:p-8">
            <Eyebrow className="mb-5">All eight intelligences</Eyebrow>
            <ScoreBars scores={profile.intelligence_scores} highlight={profile.dominant_intelligence} showRank />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {studyTips.length > 0 && (
          <Card>
            <h2 className="mb-4 text-[15px] font-semibold text-ink">How you learn best</h2>
            <ol className="space-y-3.5">
              {studyTips.slice(0, 3).map((tip, i) => (
                <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-ink-2">
                  <span className="tnum mt-[1px] font-display text-[15px] text-accent">{i + 1}.</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {learningPath.length > 0 && (
          <Card>
            <h2 className="mb-4 text-[15px] font-semibold text-ink">Suggested learning path</h2>
            <ol className="relative space-y-4 border-l border-line pl-5">
              {learningPath.map((item, i) => (
                <li key={i} className="relative text-[15px] leading-relaxed text-ink-2">
                  <span className="absolute -left-[25px] top-[7px] h-2 w-2 rounded-full border-2 border-accent bg-surface" />
                  {item}
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>

      {careers.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="text-[15px] font-semibold text-ink">Career directions to explore</h2>
            <span className="text-[13px] text-faint">Not exhaustive</span>
          </div>
          <ul className="flex flex-wrap gap-2">
            {careers.map((role, i) => (
              <li key={i} className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm text-ink-2">
                {role}
              </li>
            ))}
          </ul>
        </section>
      )}
    </motion.div>
  )
}

// 24 behavioral questions — 3 per Gardner intelligence type
// Framed around observable actions and situations, not preferences
const questions = [
  // Linguistic — language, words, memory through text/speech
  { id: 1,  text: 'When you need to remember something important, you write it out or repeat it aloud — not sketch it or draw a diagram.', type: 'linguistic' },
  { id: 2,  text: 'People ask you to help word things — an email, an argument, a speech — because you phrase things clearly and precisely.', type: 'linguistic' },
  { id: 3,  text: 'In conversation, you notice when someone uses a word imprecisely or the wrong term, even when you choose not to correct them.', type: 'linguistic' },

  // Logical-Mathematical — reasoning, systems, cause-and-effect
  { id: 4,  text: 'When something stops working, your first instinct is to trace the cause step-by-step, not try random fixes.', type: 'logicalMathematical' },
  { id: 5,  text: 'Before agreeing with a conclusion, you naturally check whether the reasoning actually supports it.', type: 'logicalMathematical' },
  { id: 6,  text: 'You find yourself estimating or calculating in your head during everyday situations — prices, time, distances — before others think to.', type: 'logicalMathematical' },

  // Spatial — navigation, visualisation, awareness of space and form
  { id: 7,  text: 'You can usually retrace a route you have only taken once, without needing directions.', type: 'spatial' },
  { id: 8,  text: 'When assembling or building something, you prefer to visualise the steps mentally rather than follow written instructions.', type: 'spatial' },
  { id: 9,  text: 'You notice visual or spatial details others miss — how a room could be rearranged, two colours clashing, or the angle of light.', type: 'spatial' },

  // Musical — rhythm, pitch, sound sensitivity
  { id: 10, text: 'You notice background music — its mood, key, or rhythm — even when everyone around you seems completely unaware of it.', type: 'musical' },
  { id: 11, text: 'You can tell almost immediately when a song is slightly off-key or when the beat is wrong.', type: 'musical' },
  { id: 12, text: 'Specific music or sound environments meaningfully change how well you think, focus, or feel.', type: 'musical' },

  // Bodily-Kinesthetic — physical learning, movement, precision
  { id: 13, text: 'You pick up physical skills — a sport, a craft, a technique — noticeably faster from doing than from watching or reading.', type: 'bodilyKinesthetic' },
  { id: 14, text: 'You think better when you are moving — pacing, gesturing, or walking — rather than sitting completely still.', type: 'bodilyKinesthetic' },
  { id: 15, text: 'You are naturally precise with your hands — handling small parts, crafting, or building — in a way that does not require much effort.', type: 'bodilyKinesthetic' },

  // Interpersonal — reading people, navigating groups
  { id: 16, text: 'You can usually tell when someone is holding something back or is upset, even when they insist they are fine.', type: 'interpersonal' },
  { id: 17, text: 'In a group with tension or conflict, people tend to turn to you — for help resolving it or for a sense of what to do next.', type: 'interpersonal' },
  { id: 18, text: 'After a gathering or meeting, you remember specific things each person said long after others have forgotten the details.', type: 'interpersonal' },

  // Intrapersonal — self-awareness, reflection, independence
  { id: 19, text: 'Before a meaningful decision, you spend considerable time examining your own feelings and motivations — more than most people expect.', type: 'intrapersonal' },
  { id: 20, text: 'You prefer to work through a problem alone before involving others, even when collaboration is readily available.', type: 'intrapersonal' },
  { id: 21, text: 'You are usually accurate when predicting in advance how a future outcome will make you feel.', type: 'intrapersonal' },

  // Naturalist — pattern recognition in living systems, environment
  { id: 22, text: 'Outdoors, you notice things most people walk past — a bird\'s specific call, the way plants cluster, or cloud formations.', type: 'naturalist' },
  { id: 23, text: 'You learn and retain information about living systems — animals, ecosystems, biology — more easily than abstract concepts.', type: 'naturalist' },
  { id: 24, text: 'Being in natural environments — outside, near water, among trees — noticeably affects your mood or your ability to think clearly.', type: 'naturalist' },
]

const options = [
  { val: 1, label: 'Not me' },
  { val: 2, label: 'Rarely' },
  { val: 3, label: 'Sometimes' },
  { val: 4, label: 'Often' },
  { val: 5, label: 'Exactly me' },
]


const analysisSteps = [
  'Reading your responses',
  'Weighing your strengths across eight intelligences',
  'Identifying your strongest area',
  'Drafting your learning path',
  'Matching career directions',
  'Writing your summary',
  'Finalising your GeniusMap',
]

function AnalyzingScreen({ done }: { done: boolean }) {
  const [activeStep, setActiveStep] = useState(0)
  const [pct, setPct] = useState(0)

  useEffect(() => {
    const stepInterval = setInterval(() => {
      setActiveStep(s => Math.min(s + 1, analysisSteps.length - 1))
    }, 1100)
    return () => clearInterval(stepInterval)
  }, [])

  useEffect(() => {
    const target = done ? 100 : 92
    const tick = setInterval(() => {
      setPct(p => {
        if (p >= target) { clearInterval(tick); return target }
        const step = done ? 2 : (target - p > 20 ? 1.5 : 0.4)
        return Math.min(p + step, target)
      })
    }, 40)
    return () => clearInterval(tick)
  }, [done])

  return (
    <motion.div
      key="analyzing"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease }}
      className="mx-auto max-w-xl pt-4 md:pt-12"
      aria-live="polite"
      aria-busy={!done}
    >
      <Eyebrow className="mb-3">{done ? 'Done' : 'Building your profile'}</Eyebrow>
      <h1 className="font-display text-[30px] leading-tight text-ink md:text-[38px]">
        {done ? 'Your profile is ready.' : 'Finalising your GeniusMap…'}
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        {done ? 'Taking you to your dashboard.' : 'This usually takes a few seconds. Please keep this page open.'}
      </p>

      <div className="mt-8">
        <div className="mb-2 flex items-center justify-between text-[13px]">
          <span className="text-muted">Progress</span>
          <span className="tnum font-medium text-ink">{Math.round(pct)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
          <motion.div
            className="h-full rounded-full bg-accent"
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          />
        </div>
      </div>

      <Card className="mt-8" padded={false}>
        <ol className="divide-y divide-line">
          {analysisSteps.map((label, i) => {
            const complete = done || i < activeStep
            const current = !done && i === activeStep
            return (
              <li key={label} className="flex items-center gap-3 px-5 py-3.5">
                <span
                  className={cx(
                    'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border transition-colors duration-200',
                    complete ? 'border-accent bg-accent text-white' : current ? 'border-accent' : 'border-line-strong',
                  )}
                >
                  {complete ? <Check className="h-3 w-3" strokeWidth={3} /> : current ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> : null}
                </span>
                <span className={cx('text-sm transition-colors duration-200', complete ? 'text-ink-2' : current ? 'font-medium text-ink' : 'text-faint')}>
                  {label}
                </span>
              </li>
            )
          })}
        </ol>
      </Card>
    </motion.div>
  )
}

function CheckingSkeleton() {
  return (
    <div className="mx-auto max-w-2xl" aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-3 h-3 w-32" />
      <Skeleton className="mb-10 h-1.5 w-full rounded-full" />
      <Skeleton className="mb-3 h-7 w-full" />
      <Skeleton className="mb-10 h-7 w-3/4" />
      <div className="space-y-2.5">
        {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 w-full rounded-[12px]" />)}
      </div>
    </div>
  )
}

const typeLabel = (t: string) => intelligenceLabel(t)

export default function AssessmentPage() {
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisDone, setAnalysisDone] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [checking, setChecking] = useState(true)
  const [existingProfile, setExistingProfile] = useState<IntelProfile | null>(null)

  useEffect(() => {
    fetch('/api/ai/assess', { method: 'GET' })
      .then(r => r.json())
      .then(d => {
        if (d.hasProfile) setExistingProfile(d.profile)
        setChecking(false)
      })
      .catch(() => setChecking(false))
  }, [])

  const current = questions[step]
  const progress = (step / questions.length) * 100

  async function submitAssessment(finalAnswers: Record<number, number>) {
    setAnalyzing(true)
    setAnalysisError('')
    const typeScores: Record<string, number[]> = {}
    questions.forEach(q => {
      if (!typeScores[q.type]) typeScores[q.type] = []
      typeScores[q.type].push(finalAnswers[q.id] || 3)
    })
    const scores: Record<string, number> = {}
    Object.entries(typeScores).forEach(([type, vals]) => {
      scores[type] = Math.round((vals.reduce((a, b) => a + b, 0) / (vals.length * 5)) * 10)
    })
    try {
      const res = await fetch('/api/ai/assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: scores }),
      })
      if (res.ok) {
        setAnalysisDone(true)
        setTimeout(() => { window.location.href = '/dashboard' }, 1800)
      } else {
        const d = await res.json().catch(() => ({}))
        setAnalysisError(d.error || 'Analysis failed. Please try again.')
        setAnalyzing(false)
      }
    } catch {
      setAnalysisError('Network error. Please check your connection and try again.')
      setAnalyzing(false)
    }
  }

  function selectAnswer(val: number) {
    const newAnswers = { ...answers, [current.id]: val }
    setAnswers(newAnswers)
    if (step < questions.length - 1) {
      setDirection(1)
      setTimeout(() => setStep(s => s + 1), 120)
    } else {
      submitAssessment(newAnswers)
    }
  }

  function goBack() {
    setDirection(-1)
    setTimeout(() => setStep(s => s - 1), 0)
  }

  // Keyboard support: 1–5 answers, ← / Backspace goes back
  useEffect(() => {
    if (checking || existingProfile || analyzing || analysisError) return
    function onKey(e: KeyboardEvent) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const n = Number(e.key)
      if (n >= 1 && n <= 5) {
        e.preventDefault()
        selectAnswer(n)
      } else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && step > 0) {
        e.preventDefault()
        goBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (checking) return <CheckingSkeleton />

  if (existingProfile) return <AssessmentResults profile={existingProfile} />

  if (analyzing) return <AnalyzingScreen done={analysisDone} />

  if (analysisError) return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease }}
      className="mx-auto max-w-xl pt-4 md:pt-12"
    >
      <Eyebrow className="mb-3 text-danger">Something went wrong</Eyebrow>
      <h1 className="font-display text-[30px] leading-tight text-ink md:text-[36px]">We couldn&apos;t finish your profile.</h1>
      <div role="alert" className="mt-5 rounded-[12px] border border-danger-line bg-danger-soft px-4 py-3 text-sm leading-relaxed text-ink-2">
        {analysisError}
      </div>
      <p className="mt-4 text-sm leading-relaxed text-muted">Your answers are still here. Retrying sends them again.</p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button onClick={() => submitAssessment(answers)} className={buttonClass('primary', 'lg')}>
          <RotateCcw className="h-4 w-4" strokeWidth={2} />
          Retry
        </button>
        <button onClick={() => setAnalysisError('')} className={buttonClass('secondary', 'lg')}>
          Review my answers
        </button>
      </div>
    </motion.div>
  )

  const answeredCount = Object.keys(answers).length

  return (
    <div className="mx-auto flex max-w-2xl flex-col md:pt-4">
      {/* Progress */}
      <div className="mb-8 md:mb-12">
        <div className="mb-3 flex items-center justify-between gap-4 text-[13px]">
          <span className="font-medium text-ink">Assessment</span>
          <span className="tnum text-muted">
            Question <span className="font-medium text-ink">{step + 1}</span> of {questions.length}
          </span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-sunken"
          role="progressbar"
          aria-label="Assessment progress"
          aria-valuemin={0}
          aria-valuemax={questions.length}
          aria-valuenow={answeredCount}
        >
          <motion.div
            className="h-full rounded-full bg-accent"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.25, ease }}
          />
        </div>
      </div>

      {/* Question */}
      <AnimatePresence mode="wait" custom={direction} initial={false}>
        <motion.div
          key={step}
          custom={direction}
          initial={{ opacity: 0, x: direction > 0 ? 12 : -12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction > 0 ? -12 : 12 }}
          transition={{ duration: 0.18, ease }}
        >
          <fieldset>
            <legend className="mb-8 w-full md:mb-10">
              <span className="mb-3 block text-[12px] font-medium uppercase tracking-[0.08em] text-muted">
                {typeLabel(current.type)}
              </span>
              <span className="block font-display text-[24px] leading-[1.3] text-ink md:text-[30px]">{current.text}</span>
            </legend>

            <div className="space-y-2.5" role="radiogroup" aria-label="How much does this sound like you?">
              {options.map(({ val, label }) => {
                const selected = answers[current.id] === val
                return (
                  <button
                    key={val}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => selectAnswer(val)}
                    className={cx(
                      'flex min-h-14 w-full items-center gap-4 rounded-[12px] border px-4 text-left text-[15px] transition-colors duration-150',
                      selected
                        ? 'border-accent bg-accent-soft font-medium text-ink ring-1 ring-accent'
                        : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:bg-[#FBFAF7] hover:text-ink',
                    )}
                  >
                    <span
                      className={cx(
                        'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2',
                        selected ? 'border-accent' : 'border-line-strong',
                      )}
                    >
                      {selected && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}
                    </span>
                    <span className="flex-1">{label}</span>
                    <kbd className="hidden h-6 min-w-6 items-center justify-center rounded-[6px] border border-line bg-canvas px-1.5 font-sans text-[12px] text-muted md:inline-flex">
                      {val}
                    </kbd>
                  </button>
                )
              })}
            </div>
          </fieldset>
        </motion.div>
      </AnimatePresence>

      <div className="mt-6 flex min-h-10 items-center justify-between gap-4">
        {step > 0 ? (
          <button type="button" onClick={goBack} className={buttonClass('ghost', 'md', '-ml-3')}>
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
            Back
          </button>
        ) : <span />}
        <p className="hidden text-[12px] text-faint md:block">
          Press <kbd className="font-sans text-muted">1</kbd>–<kbd className="font-sans text-muted">5</kbd> to answer, <kbd className="font-sans text-muted">←</kbd> to go back
        </p>
      </div>
    </div>
  )
}

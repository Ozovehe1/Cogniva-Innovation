'use client'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const intelligenceMeta: Record<string, { label: string; emoji: string; hex: string }> = {
  linguistic:          { label: 'Linguistic',    emoji: '📖', hex: '#3B82F6' },
  logicalMathematical: { label: 'Logical-Math',  emoji: '🔢', hex: '#22C55E' },
  spatial:             { label: 'Spatial',        emoji: '🗺️', hex: '#EAB308' },
  musical:             { label: 'Musical',        emoji: '🎵', hex: '#EC4899' },
  bodilyKinesthetic:   { label: 'Kinesthetic',   emoji: '🏃', hex: '#F97316' },
  interpersonal:       { label: 'Interpersonal',  emoji: '🤝', hex: '#14B8A6' },
  intrapersonal:       { label: 'Intrapersonal',  emoji: '🧘', hex: '#8B5CF6' },
  naturalist:          { label: 'Naturalist',     emoji: '🌿', hex: '#10B981' },
}

type IntelProfile = {
  dominant_intelligence: string
  intelligence_scores: Record<string, number>
  genius_statement: string
  personality_insight: string
  study_tips: string[]
  learning_path: string[]
  career_suggestions: string[]
}

function AssessmentResults({ profile }: { profile: IntelProfile }) {
  const dominant = intelligenceMeta[profile.dominant_intelligence]
  const sortedScores = Object.entries(profile.intelligence_scores).sort((a, b) => b[1] - a[1])
  const top3 = sortedScores.slice(0, 3)

  return (
    <div className="space-y-6" style={{ maxWidth: 860 }}>

      {/* Hero — full width gradient band */}
      <div className="relative rounded-2xl overflow-hidden p-7"
        style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.1) 0%, rgba(0,0,0,0) 70%)', border: '1px solid rgba(124,58,237,0.12)' }}>
        <div className="absolute right-6 top-6 select-none pointer-events-none"
          style={{ fontSize: 96, lineHeight: 1, opacity: 0.04 }}>{dominant?.emoji}</div>
        <p className="text-xs uppercase tracking-widest mb-3" style={{ color: '#6D28D9' }}>{dominant?.label} Intelligence</p>
        <h1 className="text-2xl font-bold text-white mb-3 leading-snug" style={{ maxWidth: 560 }}>
          {profile.genius_statement}
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: '#71717A', maxWidth: 540 }}>
          {profile.personality_insight}
        </p>
      </div>

      {/* Intelligence grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* All 8 bars */}
        <div className="lg:col-span-3 rounded-2xl p-6" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-xs uppercase tracking-widest mb-5" style={{ color: '#3F3F46' }}>All intelligences</p>
          <div className="space-y-3">
            {sortedScores.map(([key, val]) => {
              const meta = intelligenceMeta[key]
              const isDominant = key === profile.dominant_intelligence
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-xs flex-shrink-0 text-right" style={{ width: 80, color: isDominant ? '#E4E4E7' : '#3F3F46' }}>
                    {meta?.label}
                  </span>
                  <div className="flex-1 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${val * 10}%`, background: isDominant ? meta?.hex : `${meta?.hex}55` }} />
                  </div>
                  <span className="text-xs tabular-nums flex-shrink-0"
                    style={{ width: 18, color: isDominant ? meta?.hex : '#3F3F46' }}>{val}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Top 3 + study approach */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl p-5" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-xs uppercase tracking-widest mb-4" style={{ color: '#3F3F46' }}>Top strengths</p>
            <div className="space-y-4">
              {top3.map(([key, val], rank) => {
                const meta = intelligenceMeta[key]
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono" style={{ color: '#3F3F46' }}>0{rank + 1}</span>
                        <span className="text-sm font-medium text-white">{meta?.label}</span>
                      </div>
                      <span className="text-xs font-semibold" style={{ color: meta?.hex }}>{val}/10</span>
                    </div>
                    <div className="h-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <div className="h-full rounded-full" style={{ width: `${val * 10}%`, background: meta?.hex }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="rounded-2xl p-5" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-xs uppercase tracking-widest mb-3" style={{ color: '#3F3F46' }}>How you learn</p>
            <ol className="space-y-2.5">
              {profile.study_tips.slice(0, 3).map((tip, i) => (
                <li key={i} className="flex gap-2.5 text-xs leading-relaxed" style={{ color: '#71717A' }}>
                  <span className="flex-shrink-0 font-mono" style={{ color: '#3F3F46' }}>{i + 1}.</span>
                  {tip}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* Career paths — chip grid */}
      <div>
        <p className="text-xs uppercase tracking-widest mb-3" style={{ color: '#3F3F46' }}>Career paths</p>
        <div className="flex flex-wrap gap-2">
          {profile.career_suggestions.map((role, i) => (
            <span key={i} className="px-3 py-1.5 rounded-lg text-sm"
              style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)', color: '#A1A1AA' }}>
              {role}
            </span>
          ))}
        </div>
      </div>

    </div>
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
  'Reading your response patterns...',
  'Mapping cognitive strengths across 8 intelligences...',
  'Identifying your dominant genius type...',
  'Generating your personalised learning path...',
  'Crafting your career alignment...',
  'Writing your Genius Statement...',
  'Finalising your GeniusMap...',
]

const spring = { type: 'spring' as const, stiffness: 280, damping: 26 }

function SkeletonLine({ width, delay = 0 }: { width: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay, duration: 0.4 }}
      className="h-3 rounded-full overflow-hidden"
      style={{ width, background: '#1E1E26' }}
    >
      <motion.div
        className="h-full w-full"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(124,58,237,0.15) 50%, transparent 100%)',
          backgroundSize: '200% 100%',
        }}
        animate={{ backgroundPosition: ['200% 0', '-200% 0'] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
      />
    </motion.div>
  )
}

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
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="max-w-xl mx-auto"
    >
      {/* Status line */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <motion.div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: done ? '#22C55E' : '#7C3AED' }}
              animate={done ? { scale: 1 } : { scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
              transition={{ duration: 1.2, repeat: done ? 0 : Infinity }}
            />
            <AnimatePresence mode="wait">
              <motion.p
                key={done ? 'done' : activeStep}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.3 }}
                className="text-sm font-medium"
                style={{ color: done ? '#4ADE80' : '#A78BFA' }}
              >
                {done ? 'Your GeniusMap is ready ✓' : analysisSteps[activeStep]}
              </motion.p>
            </AnimatePresence>
          </div>
          <span className="text-sm font-semibold tabular-nums" style={{ color: done ? '#4ADE80' : '#7C3AED' }}>
            {Math.round(pct)}%
          </span>
        </div>
        <div className="h-0.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <motion.div
            className="h-full rounded-full"
            style={{ background: done ? '#22C55E' : '#7C3AED' }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Skeleton profile card */}
      <div className="p-6 rounded-2xl mb-4" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
        <SkeletonLine width="60%" delay={0.1} />
        <div className="mt-4 space-y-2">
          <SkeletonLine width="100%" delay={0.2} />
          <SkeletonLine width="85%" delay={0.3} />
          <SkeletonLine width="70%" delay={0.4} />
        </div>
      </div>

      {/* Skeleton intelligence bars */}
      <div className="p-6 rounded-2xl mb-4" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
        <SkeletonLine width="40%" delay={0.2} />
        <div className="mt-4 space-y-4">
          {[90, 75, 60, 50, 45, 38, 30, 20].map((w, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-4 h-4 rounded" style={{ background: '#1E1E26' }} />
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#1E1E26' }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: 'rgba(124,58,237,0.3)' }}
                  initial={{ width: 0 }}
                  animate={{ width: `${w}%` }}
                  transition={{ ...spring, delay: 0.3 + i * 0.08 }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Skeleton cards row */}
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map(i => (
          <div key={i} className="p-5 rounded-2xl space-y-2" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
            <SkeletonLine width="50%" delay={0.4 + i * 0.1} />
            <SkeletonLine width="100%" delay={0.5 + i * 0.1} />
            <SkeletonLine width="80%" delay={0.6 + i * 0.1} />
          </div>
        ))}
      </div>
    </motion.div>
  )
}

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

  if (checking) return null

  if (existingProfile) return <AssessmentResults profile={existingProfile} />

  if (analyzing) return <AnalyzingScreen done={analysisDone} />

  if (analysisError) return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="max-w-sm mx-auto text-center pt-16"
    >
      <div className="w-14 h-14 rounded-2xl mx-auto mb-6 flex items-center justify-center text-2xl" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>⚠</div>
      <h2 className="text-white font-semibold mb-2">Something went wrong</h2>
      <p className="text-zinc-500 text-sm mb-6 leading-relaxed">{analysisError}</p>
      <button
        onClick={() => submitAssessment(answers)}
        className="px-6 py-3 rounded-xl text-sm font-semibold text-white transition"
        style={{ background: '#7C3AED' }}
      >
        Try Again
      </button>
    </motion.div>
  )

  const slideVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
  }

  return (
    <div className="max-w-xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <span className="text-white text-sm font-medium">Intelligence Assessment</span>
          <span className="text-xs tabular-nums" style={{ color: '#52525B' }}>
            {step + 1}<span style={{ color: '#3F3F46' }}> / {questions.length}</span>

          </span>
        </div>
        {/* Animated progress bar */}
        <div className="h-0.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <motion.div
            className="h-full rounded-full"
            style={{ background: '#7C3AED' }}
            animate={{ width: `${progress}%` }}
            transition={{ ...spring }}
          />
        </div>
      </div>

      {/* Sliding question */}
      <div className="overflow-hidden mb-4">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={spring}
            className="py-6"
          >
            <p className="text-xs mb-4 uppercase tracking-wider" style={{ color: '#3F3F46' }}>
              {current.type.replace(/([A-Z])/g, ' $1').trim()}
            </p>
            <h2 className="text-white text-base font-medium leading-relaxed">{current.text}</h2>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Staggered options */}
      <motion.div
        key={`options-${step}`}
        className="space-y-1.5"
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
      >
        {options.map(({ val, label }) => {
          const selected = answers[current.id] === val
          return (
            <motion.button
              key={val}
              variants={{
                hidden: { opacity: 0, y: 6 },
                visible: { opacity: 1, y: 0, transition: spring },
              }}
              onClick={() => selectAnswer(val)}
              className="w-full text-left px-4 py-2.5 rounded-lg text-sm transition-all"
              style={{
                background: selected ? 'rgba(124,58,237,0.1)' : 'transparent',
                border: `1px solid ${selected ? 'rgba(124,58,237,0.35)' : 'rgba(255,255,255,0.06)'}`,
                color: selected ? '#C4B5FD' : '#52525B',
                fontWeight: selected ? 500 : 400,
              }}
              whileHover={{ color: '#A1A1AA', borderColor: 'rgba(255,255,255,0.12)' }}
              whileTap={{ scale: 0.995 }}
              transition={{ duration: 0.1 }}
            >
              {label}
            </motion.button>
          )
        })}
      </motion.div>

      {step > 0 && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={goBack}
          className="mt-5 text-xs transition"
          style={{ color: '#3F3F46' }}
          whileHover={{ color: '#71717A' }}
        >
          ← Back
        </motion.button>
      )}
    </div>
  )
}

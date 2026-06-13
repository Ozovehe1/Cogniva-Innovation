'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'

// 16 questions — 2 per Gardner intelligence type (as specified in GeniusMap design)
const questions = [
  // Linguistic — Thinks in language and stories
  { id: 1, text: 'When you want to explain something, do you find the right words easily and enjoy it?', type: 'linguistic' },
  { id: 2, text: 'Do you enjoy reading, writing stories, or making up your own poems in your free time?', type: 'linguistic' },

  // Logical-Mathematical — Loves patterns and reasoning
  { id: 3, text: 'Do you enjoy puzzles, number games, or figuring out exactly how something works step by step?', type: 'logicalMathematical' },
  { id: 4, text: 'When something goes wrong, do you want to find the exact cause rather than guess?', type: 'logicalMathematical' },

  // Spatial — Thinks in pictures and shapes
  { id: 5, text: 'Can you picture objects or places clearly in your mind even when they are not in front of you?', type: 'spatial' },
  { id: 6, text: 'Do you often doodle, sketch, or imagine how things would look from a different angle?', type: 'spatial' },

  // Musical — Sensitive to rhythm and sound
  { id: 7, text: 'Do you notice rhythms or background music that others seem to miss, and does it affect your mood?', type: 'musical' },
  { id: 8, text: 'Do melodies or beats stick in your head easily and help you remember things better?', type: 'musical' },

  // Bodily-Kinesthetic — Learns through movement
  { id: 9, text: 'Do you learn something best when you physically do it yourself, rather than just watching or reading?', type: 'bodilyKinesthetic' },
  { id: 10, text: 'Are you skilled with your hands — building things, playing a sport, dancing, or crafting?', type: 'bodilyKinesthetic' },

  // Interpersonal — Understands people naturally
  { id: 11, text: 'Can you usually tell how someone is feeling even before they say a word?', type: 'interpersonal' },
  { id: 12, text: 'Do people often come to you for advice, or naturally follow your lead in group situations?', type: 'interpersonal' },

  // Intrapersonal — Deeply self-aware
  { id: 13, text: 'Do you know your own strengths and weaknesses well, and think about why you react the way you do?', type: 'intrapersonal' },
  { id: 14, text: 'Do you prefer to figure things out on your own and trust your own judgment over the group?', type: 'intrapersonal' },

  // Naturalist — Observes patterns in nature
  { id: 15, text: 'Do you notice animals, plants, weather patterns, or natural details that most people walk past?', type: 'naturalist' },
  { id: 16, text: 'Do you feel more calm and focused when you are outdoors or in a natural environment?', type: 'naturalist' },
]

const options = [
  { val: 1, label: 'Not at all like me' },
  { val: 2, label: 'Rarely like me' },
  { val: 3, label: 'Sometimes like me' },
  { val: 4, label: 'Often like me' },
  { val: 5, label: 'Exactly like me' },
]

const analysisSteps = [
  'Mapping your intelligence profile...',
  'Identifying cognitive strengths...',
  'Generating learning pathways...',
  'Matching career directions...',
  'Building your GeniusMap...',
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

function AnalyzingScreen() {
  const [activeStep, setActiveStep] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep(s => (s + 1) % analysisSteps.length)
    }, 900)
    return () => clearInterval(interval)
  }, [])

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
        <div className="flex items-center gap-3 mb-3">
          <motion.div
            className="w-2 h-2 rounded-full"
            style={{ background: '#7C3AED' }}
            animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
          <AnimatePresence mode="wait">
            <motion.p
              key={activeStep}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3 }}
              className="text-sm font-medium"
              style={{ color: '#A78BFA' }}
            >
              {analysisSteps[activeStep]}
            </motion.p>
          </AnimatePresence>
        </div>
        <div className="h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
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
  const router = useRouter()

  const current = questions[step]
  const progress = (step / questions.length) * 100

  async function submitAssessment(finalAnswers: Record<number, number>) {
    setAnalyzing(true)
    const typeScores: Record<string, number[]> = {}
    questions.forEach(q => {
      if (!typeScores[q.type]) typeScores[q.type] = []
      typeScores[q.type].push(finalAnswers[q.id] || 3)
    })
    const scores: Record<string, number> = {}
    Object.entries(typeScores).forEach(([type, vals]) => {
      scores[type] = Math.round((vals.reduce((a, b) => a + b, 0) / (vals.length * 5)) * 10)
    })
    const res = await fetch('/api/ai/assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: scores }),
    })
    if (res.ok) router.push('/dashboard')
    else setAnalyzing(false)
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

  if (analyzing) return <AnalyzingScreen />

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
      <div className="overflow-hidden mb-5">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={spring}
            className="p-8 rounded-2xl"
            style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <p className="text-xs font-medium mb-5 uppercase tracking-widest" style={{ color: '#52525B' }}>
              {current.type.replace(/([A-Z])/g, ' $1').trim()}
            </p>
            <h2 className="text-white text-lg font-medium leading-relaxed">{current.text}</h2>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Staggered options */}
      <motion.div
        key={`options-${step}`}
        className="space-y-2"
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
      >
        {options.map(({ val, label }) => {
          const selected = answers[current.id] === val
          return (
            <motion.button
              key={val}
              variants={{
                hidden: { opacity: 0, x: -12 },
                visible: { opacity: 1, x: 0, transition: spring },
              }}
              onClick={() => selectAnswer(val)}
              className="w-full text-left px-5 py-3.5 rounded-xl text-sm font-medium transition-colors"
              style={{
                background: selected ? 'rgba(124,58,237,0.18)' : '#111113',
                border: `1px solid ${selected ? 'rgba(124,58,237,0.45)' : 'rgba(255,255,255,0.07)'}`,
                color: selected ? '#C4B5FD' : '#71717A',
              }}
              whileHover={{ borderColor: 'rgba(124,58,237,0.3)', color: '#A1A1AA' }}
              whileTap={{ scale: 0.99 }}
              transition={{ duration: 0.12 }}
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

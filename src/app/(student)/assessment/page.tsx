'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const questions = [
  { id: 1, text: 'I enjoy reading books, articles, and stories in my spare time.', type: 'linguistic' },
  { id: 2, text: 'I express myself well through writing or storytelling.', type: 'linguistic' },
  { id: 3, text: 'I enjoy solving puzzles, brain teasers, and logic problems.', type: 'logicalMathematical' },
  { id: 4, text: 'I think in patterns and love working with numbers.', type: 'logicalMathematical' },
  { id: 5, text: 'I can visualize objects and spaces clearly in my mind.', type: 'spatial' },
  { id: 6, text: 'I enjoy drawing, designing, or imagining how things look from different angles.', type: 'spatial' },
  { id: 7, text: 'I can easily remember and reproduce melodies or rhythms.', type: 'musical' },
  { id: 8, text: 'Music plays a big role in how I feel and think.', type: 'musical' },
  { id: 9, text: 'I learn best by doing physical activities or using my hands.', type: 'bodilyKinesthetic' },
  { id: 10, text: 'I am good at sports, dancing, or any physical skill.', type: 'bodilyKinesthetic' },
  { id: 11, text: 'I find it easy to understand and connect with other people.', type: 'interpersonal' },
  { id: 12, text: 'I am good at leading groups or helping others solve their problems.', type: 'interpersonal' },
  { id: 13, text: 'I often reflect deeply on my own feelings and motivations.', type: 'intrapersonal' },
  { id: 14, text: 'I have a clear sense of my own strengths, weaknesses, and goals.', type: 'intrapersonal' },
  { id: 15, text: 'I notice patterns and details in nature that others often miss.', type: 'naturalist' },
  { id: 16, text: 'I enjoy spending time outdoors and am curious about animals and plants.', type: 'naturalist' },
  { id: 17, text: 'I prefer to think out loud or discuss ideas with others.', type: 'linguistic' },
  { id: 18, text: 'I find scientific experiments and logical deductions exciting.', type: 'logicalMathematical' },
  { id: 19, text: 'I can sense the mood of a room as soon as I walk in.', type: 'interpersonal' },
  { id: 20, text: 'I prefer working alone and tend to follow my own inner guide.', type: 'intrapersonal' },
]

const options = [
  { val: 1, label: 'Strongly Disagree' },
  { val: 2, label: 'Disagree' },
  { val: 3, label: 'Neutral' },
  { val: 4, label: 'Agree' },
  { val: 5, label: 'Strongly Agree' },
]

export default function AssessmentPage() {
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const router = useRouter()

  const current = questions[step]

  async function handleSubmit() {
    setLoading(true)
    const typeScores: Record<string, number[]> = {}
    questions.forEach(q => {
      if (!typeScores[q.type]) typeScores[q.type] = []
      typeScores[q.type].push(answers[q.id] || 3)
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
    else setLoading(false)
  }

  function selectAnswer(val: number) {
    setAnswers(prev => ({ ...prev, [current.id]: val }))
    if (step < questions.length - 1) {
      setTimeout(() => setStep(s => s + 1), 150)
    } else {
      setDone(true)
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
        <div className="w-20 h-20 rounded-2xl mb-6 flex items-center justify-center text-4xl animate-bounce" style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.25)' }}>
          🎉
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Assessment Complete!</h2>
        <p className="text-zinc-500 text-sm mb-8 max-w-sm">Gemini AI is now analyzing your responses to build your personalised intelligence profile.</p>
        <button onClick={handleSubmit} disabled={loading}
          className="inline-flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50"
          style={{ background: '#7C3AED' }}>
          {loading ? (
            <>
              <span className="w-4 h-4 rounded-full border-2 border-violet-300 border-t-white animate-spin" />
              Building your GeniusMap...
            </>
          ) : 'Reveal My Genius →'}
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto">
      {/* Progress bar + count */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-white font-semibold">Intelligence Assessment</h1>
          <span className="text-xs text-zinc-500">{step + 1} / {questions.length}</span>
        </div>
        <div className="h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div className="h-1 rounded-full transition-all duration-300" style={{ width: `${((step + 1) / questions.length) * 100}%`, background: '#7C3AED' }} />
        </div>
      </div>

      {/* Question card */}
      <div className="p-8 rounded-2xl mb-6" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
        <p className="text-xs text-violet-400 font-medium mb-4 uppercase tracking-wider">Question {step + 1}</p>
        <h2 className="text-white text-lg font-medium leading-relaxed">{current.text}</h2>
      </div>

      {/* Options */}
      <div className="space-y-2.5">
        {options.map(({ val, label }) => (
          <button key={val} onClick={() => selectAnswer(val)}
            className="w-full text-left px-5 py-3.5 rounded-xl text-sm transition font-medium"
            style={{
              background: answers[current.id] === val ? 'rgba(124,58,237,0.2)' : '#111113',
              border: `1px solid ${answers[current.id] === val ? 'rgba(124,58,237,0.5)' : 'rgba(255,255,255,0.08)'}`,
              color: answers[current.id] === val ? '#A78BFA' : '#A1A1AA',
            }}>
            {label}
          </button>
        ))}
      </div>

      {step > 0 && (
        <button onClick={() => setStep(s => s - 1)} className="mt-4 text-xs text-zinc-600 hover:text-zinc-400 transition">
          ← Previous question
        </button>
      )}
    </div>
  )
}

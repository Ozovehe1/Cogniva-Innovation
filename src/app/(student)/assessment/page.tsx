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

export default function AssessmentPage() {
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(0)
  const router = useRouter()

  const current = questions[step]
  const progress = (step / questions.length) * 100

  async function handleSubmit() {
    setLoading(true)
    const scores: Record<string, number> = {}
    questions.forEach(q => {
      if (!scores[q.type]) scores[q.type] = 0
      scores[q.type] += (answers[q.id] || 3)
    })
    Object.keys(scores).forEach(k => { scores[k] = Math.round((scores[k] / (questions.filter(q=>q.type===k).length * 5)) * 10) })
    const res = await fetch('/api/ai/assess', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: scores }) })
    if (res.ok) router.push('/dashboard')
    setLoading(false)
  }

  function selectAnswer(val: number) {
    setAnswers(prev => ({ ...prev, [current.id]: val }))
    if (step < questions.length - 1) setStep(s => s + 1)
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Intelligence Assessment</h1>
        <p className="text-gray-400">Answer honestly — there are no right or wrong answers.</p>
        <div className="mt-4 bg-gray-800 rounded-full h-2">
          <div className="bg-purple-600 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-gray-500 text-sm mt-1">{step} of {questions.length} answered</p>
      </div>

      {step < questions.length ? (
        <div className="bg-gray-900 rounded-2xl p-8 border border-gray-800">
          <p className="text-xs text-purple-400 uppercase tracking-wide mb-4">Question {step + 1} of {questions.length}</p>
          <h2 className="text-xl text-white font-medium mb-8 leading-relaxed">{current.text}</h2>
          <div className="space-y-3">
            {[
              { val: 1, label: 'Strongly Disagree' },
              { val: 2, label: 'Disagree' },
              { val: 3, label: 'Neutral' },
              { val: 4, label: 'Agree' },
              { val: 5, label: 'Strongly Agree' },
            ].map(({ val, label }) => (
              <button key={val} onClick={() => selectAnswer(val)}
                className={`w-full text-left px-5 py-3 rounded-xl border transition ${answers[current.id] === val ? 'border-purple-500 bg-purple-900 text-white' : 'border-gray-700 text-gray-300 hover:border-purple-600 hover:bg-gray-800'}`}>
                {label}
              </button>
            ))}
          </div>
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} className="mt-4 text-gray-500 hover:text-gray-300 text-sm">
              ← Previous
            </button>
          )}
        </div>
      ) : (
        <div className="bg-gray-900 rounded-2xl p-8 border border-gray-800 text-center">
          <div className="text-5xl mb-4">🧠</div>
          <h2 className="text-2xl text-white font-bold mb-2">Assessment Complete!</h2>
          <p className="text-gray-400 mb-6">Gemini AI is now analyzing your intelligence profile...</p>
          <button onClick={handleSubmit} disabled={loading}
            className="px-8 py-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition disabled:opacity-50">
            {loading ? 'Generating your GeniusMap...' : 'Reveal My Genius'}
          </button>
        </div>
      )}
    </div>
  )
}

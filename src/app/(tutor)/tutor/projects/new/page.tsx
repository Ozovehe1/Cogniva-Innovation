'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function NewProjectPage() {
  const [form, setForm] = useState({
    title: '',
    subject: '',
    difficulty: 'beginner',
    description: '',
    objectives: '',
    steps: '',
    deliverables: '',
    estimated_hours: 2
  })
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const body = {
      ...form,
      objectives: form.objectives.split('\n').filter(Boolean),
      steps: form.steps.split('\n').filter(Boolean),
      deliverables: form.deliverables.split('\n').filter(Boolean),
      intelligence_activated: [],
    }
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) router.push('/projects')
    setLoading(false)
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-3xl font-bold text-white">Create New Project</h1>
      <form onSubmit={handleSubmit} className="bg-gray-900 rounded-2xl p-8 border border-gray-800 space-y-5">
        <div>
          <label className="block text-gray-300 text-sm mb-1">Project Title</label>
          <input type="text" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required
            className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-emerald-500"
            placeholder="e.g. Build a mini weather app" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-gray-300 text-sm mb-1">Subject</label>
            <input type="text" value={form.subject} onChange={e => setForm({...form, subject: e.target.value})} required
              className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-emerald-500"
              placeholder="e.g. Technology" />
          </div>
          <div>
            <label className="block text-gray-300 text-sm mb-1">Difficulty</label>
            <select value={form.difficulty} onChange={e => setForm({...form, difficulty: e.target.value})}
              className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-emerald-500">
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-gray-300 text-sm mb-1">Description</label>
          <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} required rows={4}
            className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-emerald-500 resize-none"
            placeholder="Describe the project in detail..." />
        </div>
        <div>
          <label className="block text-gray-300 text-sm mb-1">Objectives (one per line)</label>
          <textarea value={form.objectives} onChange={e => setForm({...form, objectives: e.target.value})} rows={3}
            className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-emerald-500 resize-none"
            placeholder={'Understand core concepts\nApply knowledge practically\nPresent findings'} />
        </div>
        <div>
          <label className="block text-gray-300 text-sm mb-1">Steps (one per line)</label>
          <textarea value={form.steps} onChange={e => setForm({...form, steps: e.target.value})} rows={4}
            className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-emerald-500 resize-none"
            placeholder={'Step 1: Research the topic\nStep 2: Plan your approach...'} />
        </div>
        <div>
          <label className="block text-gray-300 text-sm mb-1">Deliverables (one per line)</label>
          <textarea value={form.deliverables} onChange={e => setForm({...form, deliverables: e.target.value})} rows={2}
            className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-emerald-500 resize-none"
            placeholder={'Written report\nPresentation slides'} />
        </div>
        <div>
          <label className="block text-gray-300 text-sm mb-1">Estimated Hours</label>
          <input type="number" min="1" max="100" value={form.estimated_hours} onChange={e => setForm({...form, estimated_hours: +e.target.value})}
            className="w-32 px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-emerald-500" />
        </div>
        <button type="submit" disabled={loading}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl transition disabled:opacity-50">
          {loading ? 'Creating...' : 'Create Project'}
        </button>
      </form>
    </div>
  )
}

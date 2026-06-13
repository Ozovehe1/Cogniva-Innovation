'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function NewProjectPage() {
  const [form, setForm] = useState({
    title: '', subject: '', difficulty: 'beginner',
    description: '', objectives: '', steps: '', deliverables: '', estimated_hours: 2,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const body = {
      ...form,
      objectives: form.objectives.split('\n').filter(Boolean),
      steps: form.steps.split('\n').filter(Boolean),
      deliverables: form.deliverables.split('\n').filter(Boolean),
      intelligence_activated: [],
    }
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) router.push('/tutor/projects')
    else { const d = await res.json(); setError(d.error || 'Failed'); setLoading(false) }
  }

  const inputClass = "w-full px-4 py-3 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition"
  const inputStyle = { background: '#18181B', border: '1px solid rgba(255,255,255,0.1)' }
  const labelClass = "block text-xs font-medium text-zinc-400 mb-1.5"

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Create Project</h1>
        <p className="text-zinc-500 text-sm mt-1">Design a learning project for your students</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="p-6 rounded-2xl space-y-5" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 className="text-white text-sm font-semibold">Basic Info</h2>
          <div>
            <label className={labelClass}>Project Title *</label>
            <input type="text" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required
              className={inputClass} style={inputStyle} placeholder="e.g. Build a mini weather app" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Subject *</label>
              <input type="text" value={form.subject} onChange={e => setForm({...form, subject: e.target.value})} required
                className={inputClass} style={inputStyle} placeholder="e.g. Technology" />
            </div>
            <div>
              <label className={labelClass}>Difficulty *</label>
              <select value={form.difficulty} onChange={e => setForm({...form, difficulty: e.target.value})}
                className={inputClass} style={inputStyle}>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>
          </div>
          <div>
            <label className={labelClass}>Description *</label>
            <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} required rows={4}
              className={`${inputClass} resize-none`} style={inputStyle}
              placeholder="Describe what students will do and learn..." />
          </div>
        </div>

        <div className="p-6 rounded-2xl space-y-5" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 className="text-white text-sm font-semibold">Details</h2>
          <div>
            <label className={labelClass}>Learning Objectives <span className="text-zinc-600">(one per line)</span></label>
            <textarea value={form.objectives} onChange={e => setForm({...form, objectives: e.target.value})} rows={3}
              className={`${inputClass} resize-none`} style={inputStyle}
              placeholder={"Understand core concepts\nApply knowledge practically\nPresent findings clearly"} />
          </div>
          <div>
            <label className={labelClass}>Steps <span className="text-zinc-600">(one per line)</span></label>
            <textarea value={form.steps} onChange={e => setForm({...form, steps: e.target.value})} rows={4}
              className={`${inputClass} resize-none`} style={inputStyle}
              placeholder={"Step 1: Research the topic\nStep 2: Plan your approach\nStep 3: Execute\nStep 4: Review"} />
          </div>
          <div>
            <label className={labelClass}>Deliverables <span className="text-zinc-600">(one per line)</span></label>
            <textarea value={form.deliverables} onChange={e => setForm({...form, deliverables: e.target.value})} rows={2}
              className={`${inputClass} resize-none`} style={inputStyle}
              placeholder={"Written report\nPresentation slides"} />
          </div>
          <div className="w-32">
            <label className={labelClass}>Estimated Hours</label>
            <input type="number" min="1" max="200" value={form.estimated_hours} onChange={e => setForm({...form, estimated_hours: +e.target.value})}
              className={inputClass} style={inputStyle} />
          </div>
        </div>

        {error && (
          <div className="px-4 py-3 rounded-xl text-sm text-red-400" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button type="button" onClick={() => router.back()} className="px-5 py-3 rounded-xl text-sm font-medium text-zinc-400 hover:text-white transition" style={{ background: '#18181B', border: '1px solid rgba(255,255,255,0.08)' }}>
            Cancel
          </button>
          <button type="submit" disabled={loading} className="flex-1 py-3 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50" style={{ background: '#059669' }}>
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 rounded-full border-2 border-emerald-300 border-t-white animate-spin" />
                Creating...
              </span>
            ) : 'Create Project'}
          </button>
        </div>
      </form>
    </div>
  )
}

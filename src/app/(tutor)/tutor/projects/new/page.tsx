'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown } from 'lucide-react'
import { intelligenceMeta, intelligenceOrder } from '@/components/intelligence'
import { Alert, Card, PageHeader, Spinner, buttonClass, cx, inputClass as baseInput, labelClass as baseLabel, textareaClass } from '@/components/ui'

const intelligenceOptions = intelligenceOrder.map(key => ({ key, label: intelligenceMeta[key].label }))

export default function NewProjectPage() {
  const [form, setForm] = useState({
    title: '', subject: '', difficulty: 'beginner',
    description: '', objectives: '', steps: '', deliverables: '', estimated_hours: 2,
  })
  const [activated, setActivated] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  function toggleIntelligence(key: string) {
    setActivated(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const body = {
      ...form,
      objectives: form.objectives.split('\n').filter(Boolean),
      steps: form.steps.split('\n').filter(Boolean),
      deliverables: form.deliverables.split('\n').filter(Boolean),
      intelligence_activated: activated,
    }
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) router.push('/tutor/projects')
    else { const d = await res.json(); setError(d.error || 'Failed'); setLoading(false) }
  }

  const hint = 'font-normal text-faint'

  return (
    <div className="max-w-2xl">
      <PageHeader eyebrow="Projects" title="New project" description="Design a learning project you can assign to your students." />

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="space-y-5">
          <h2 className="text-[15px] font-semibold text-ink">Basics</h2>
          <div>
            <label htmlFor="title" className={baseLabel}>Title</label>
            <input id="title" type="text" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required
              className={baseInput} placeholder="e.g. Build a mini weather app" />
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="subject" className={baseLabel}>Subject</label>
              <input id="subject" type="text" value={form.subject} onChange={e => setForm({...form, subject: e.target.value})} required
                className={baseInput} placeholder="e.g. Technology" />
            </div>
            <div>
              <label htmlFor="difficulty" className={baseLabel}>Difficulty</label>
              <div className="relative">
                <select id="difficulty" value={form.difficulty} onChange={e => setForm({...form, difficulty: e.target.value})}
                  className={cx(baseInput, 'appearance-none pr-10')}>
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
                <ChevronDown aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" strokeWidth={1.75} />
              </div>
            </div>
          </div>
          <div>
            <label htmlFor="description" className={baseLabel}>Description</label>
            <textarea id="description" value={form.description} onChange={e => setForm({...form, description: e.target.value})} required rows={4}
              className={textareaClass} placeholder="What will students do, and what will they learn?" />
          </div>
        </Card>

        <Card className="space-y-5">
          <h2 className="text-[15px] font-semibold text-ink">Details</h2>
          <div>
            <label htmlFor="objectives" className={baseLabel}>Learning objectives <span className={hint}>· one per line</span></label>
            <textarea id="objectives" value={form.objectives} onChange={e => setForm({...form, objectives: e.target.value})} rows={3}
              className={textareaClass}
              placeholder={"Understand core concepts\nApply knowledge practically\nPresent findings clearly"} />
          </div>
          <div>
            <label htmlFor="steps" className={baseLabel}>Steps <span className={hint}>· one per line</span></label>
            <textarea id="steps" value={form.steps} onChange={e => setForm({...form, steps: e.target.value})} rows={4}
              className={textareaClass}
              placeholder={"Step 1: Research the topic\nStep 2: Plan your approach\nStep 3: Execute\nStep 4: Review"} />
          </div>
          <div>
            <label htmlFor="deliverables" className={baseLabel}>Deliverables <span className={hint}>· one per line</span></label>
            <textarea id="deliverables" value={form.deliverables} onChange={e => setForm({...form, deliverables: e.target.value})} rows={2}
              className={textareaClass}
              placeholder={"Written report\nPresentation slides"} />
          </div>
          <div className="w-36">
            <label htmlFor="hours" className={baseLabel}>Estimated hours</label>
            <input id="hours" type="number" inputMode="numeric" min="1" max="200" value={form.estimated_hours} onChange={e => setForm({...form, estimated_hours: +e.target.value})}
              className={cx(baseInput, 'tnum')} />
          </div>
          <fieldset>
            <legend className={baseLabel}>Intelligences this project develops</legend>
            <p className="-mt-0.5 mb-3 text-[13px] text-muted">Selected intelligences grow in a student&apos;s profile when the project is approved.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {intelligenceOptions.map(({ key, label }) => {
                const on = activated.includes(key)
                return (
                  <button key={key} type="button" onClick={() => toggleIntelligence(key)} aria-pressed={on}
                    className={cx(
                      'flex h-11 items-center gap-3 rounded-[10px] border px-3 text-left text-sm transition-colors duration-150',
                      on ? 'border-accent bg-accent-soft font-medium text-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong',
                    )}>
                    <span className={cx('flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[5px] border', on ? 'border-accent bg-accent text-white' : 'border-line-strong bg-surface')}>
                      {on && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    {label}
                  </button>
                )
              })}
            </div>
          </fieldset>
        </Card>

        {error && <Alert tone="danger">{error}</Alert>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => router.back()} className={buttonClass('secondary', 'lg')}>
            Cancel
          </button>
          <button type="submit" disabled={loading} className={buttonClass('primary', 'lg', 'sm:min-w-44')}>
            {loading ? <><Spinner /> Creating…</> : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  )
}

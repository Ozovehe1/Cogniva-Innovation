'use client'
import { AgentBlock, SvgBlock } from '@/components/agent/blocks'
import { CheckCard } from '@/components/whiteboard/check-card'
import { LessonRecap } from '@/components/whiteboard/recap'
import { ZoomHost } from '@/components/zoomable'
import { FIXTURE_HEART } from '@/lib/illustrations/fixtures'
import type { CheckStep, Step } from '@/lib/lesson-schema'

const CIRCLE = { title: 'Find sin θ = 0.5', x_range: [-1.6, 1.6], y_range: [-1.25, 1.25], sliders: [{ name: 'a', label: 'angle θ', min: 0, max: 3.14, value: 1.4 }], points: [{ name: 'O', x: 0, y: 0, draggable: false }, { name: 'P', x: 'cos(a)', y: 'sin(a)' }], circles: [{ center: 'O', radius: 1 }], segments: [{ from: 'O', to: 'P' }, { from: 'P', to: ['px', 0], dashed: true }], readouts: [{ label: 'cos θ', expr: 'px' }, { label: 'sin θ', expr: 'py' }] }
const EXPLORE = { type: 'check', kind: 'explore', prompt: 'Your turn: slide the angle until $\\sin\\theta = 0.5$.', say: '', explanation: 'At θ ≈ 0.52 (30°) the point is half way up.', goal: { readout: 'sin θ', equals: 0.5, tol: 0.03 }, figure: CIRCLE } as unknown as CheckStep
const RECAP_STEPS = [
  { type: 'write', id: 't2', text: 'cos θ = x,  sin θ = y', x: 20, y: 20, say: '' },
  { type: 'math', id: 'm1', tex: '\\cos^2\\theta + \\sin^2\\theta = 1', x: 20, y: 80, say: '' },
  { type: 'highlight', target: 't2', say: '' }, { type: 'annotate', target: 'm1', mark: 'circle', say: '' },
  { type: 'stage', kind: 'interactive', caption: '', say: '', spec: { ...CIRCLE, title: 'The unit circle', sliders: [{ name: 'a', label: 'angle θ', min: 0, max: 6.28, value: 0.8 }] } },
] as unknown as Step[]

export function MagnificaLab() {
  return (
    <div className="space-y-8">
      <ZoomHost />
      <section><h2 className="mb-2 text-[13px] font-medium uppercase tracking-[0.08em] text-muted">Explore check</h2>
        <CheckCard step={EXPLORE} resolved={false} reduced={false} onRespond={() => {}} /></section>
      <section><h2 className="mb-2 text-[13px] font-medium uppercase tracking-[0.08em] text-muted">Recap</h2>
        <LessonRecap steps={RECAP_STEPS} title="Reading sin and cos" answered={2} reduced={false} onReplay={() => {}} /></section>
      <section><h2 className="mb-2 text-[13px] font-medium uppercase tracking-[0.08em] text-muted">Animation</h2>
        <AgentBlock block={{ id: 'lab-clip', kind: 'clip', jobId: '4c60dc7e-e156-4339-b286-e5e75e80edae', status: 'rendering', caption: 'Show how a quadratic curve connects to its factored form. First draw the parabola y = x^2 - 5x + 6 on a clean set of axes. Then animate a point sliding along the curve down to the x-axis, highlighting' }} /></section>
      <section><h2 className="mb-2 text-[13px] font-medium uppercase tracking-[0.08em] text-muted">Illustration</h2>
        <SvgBlock svg={FIXTURE_HEART.svg} alt={FIXTURE_HEART.alt} credit={FIXTURE_HEART.credit} /></section>
    </div>
  )
}

'use client'
import { useSearchParams } from 'next/navigation'
import { AgentBlock } from '@/components/agent/blocks'
import { ENGINE_FIXTURE } from '@/lib/board-fixtures'
import { interactiveAlt, validateInteractive } from '@/lib/agent/interactive'

const IX: Record<string, unknown> = {
  tangent: { title: 'Tangent to $y = x^2$', explain: 'Slide P along the curve and watch the slope.', x_range: [-4, 4], y_range: [-2, 10], functions: [{ name: 'f', expr: 'x^2' }, { expr: '2*px*(x - px) + px^2', dashed: true, color: 'clay' }], gliders: [{ name: 'P', on: 'f', x: 1 }], readouts: [{ label: 'slope at P', expr: '2*px' }] },
  triangle: { title: 'Drag the triangle', x_range: [-1, 7], y_range: [-1, 5], points: [{ name: 'A', x: 0, y: 0 }, { name: 'B', x: 5, y: 0 }, { name: 'C', x: 2, y: 3 }, { name: 'M', x: '(ax+bx)/2', y: '(ay+by)/2', label: 'M' }], polygons: [{ points: ['A', 'B', 'C'] }], segments: [{ from: 'C', to: 'M', dashed: true }], readouts: [{ label: 'Area', expr: 'abs((bx-ax)*(cy-ay)-(cx-ax)*(by-ay))/2' }] },
  ode: { title: '$dy/dx = y - x$', x_range: [-4, 4], y_range: [-4, 4], field: { kind: 'slope', dy: 'y - x' }, points: [{ name: 'P', x: 0, y: 0.5 }], ode: { dydx: 'y - x', from: 'P' } },
  surface: { title: 'A saddle', x_range: [-2, 2], y_range: [-2, 2], surface: { expr: 'x^2 - k*y^2' }, sliders: [{ name: 'k', label: 'k', min: 0, max: 2, value: 1 }] },
}

export function VisualsLab() {
  const params = useSearchParams()
  const at = Number(params.get('at') ?? 0) || 0
  const only = params.get('ix')
  return (
    <div className="space-y-6">
      {!only && (
        <section data-lab="board">
          <AgentBlock block={{ kind: 'board', id: 'lab-board', title: 'Board engine', steps: ENGINE_FIXTURE, start: at || undefined }} />
        </section>
      )}
      {Object.entries(IX).filter(([k]) => !only || only === k).map(([k, raw]) => {
        const v = validateInteractive(raw)
        return v.spec
          ? <section key={k} data-lab={`ix-${k}`}><AgentBlock block={{ kind: 'interactive', id: `lab-${k}`, spec: v.spec, alt: interactiveAlt(v.spec) }} /></section>
          : <p key={k} className="text-[13px] text-clay">{k}: {v.errors.join('; ')}</p>
      })}
    </div>
  )
}

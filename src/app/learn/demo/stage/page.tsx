import { DemoPlayer } from '../demo-player'
import { expandBoardDiagrams } from '@/lib/lesson-ai'
import { validateScript, type Step } from '@/lib/lesson-schema'

// Signed-in fixture lesson for the teaching space: board write-on and motion, an exact diagram on the lesson board,
// then the stage (a live figure takes the lesson area, plays its demonstration, hands back to the board).
export const metadata = { title: 'Stage demo · GeniusMap', robots: { index: false } }
export const dynamic = 'force-dynamic'

const RAW = [
  { type: 'write', id: 't1', text: 'Reading sin and cos', x: 24, y: 24, size: 'lg', say: 'Let us read sine and cosine straight off a picture.' },
  { type: 'draw', id: 'venn', shape: { kind: 'diagram', library: 'sets', substance: 'Set A, B\\nIntersecting(A, B)\\nElement 1, 2, 3, 4\\nIn(1, A)\\nIn(2, A)\\nIn(2, B)\\nIn(3, B)\\nIn(4, B)', x: 40, y: 80, w: 330, h: 300, alt: 'Venn diagram of A and B' }, say: 'First, a warm-up: two sets that share one member.' },
  { type: 'annotate', target: 'venn', mark: 'circle', color: 'clay', say: 'The overlap holds what both sets share.' },
  { type: 'math', id: 'm1', tex: 'x^2 + y^2 = 1', x: 430, y: 120, size: 'lg', say: 'Every point on the unit circle satisfies x squared plus y squared equals one.' },
  { type: 'transform', target: 'm1', tex: '\\cos^2\\theta + \\sin^2\\theta = 1', say: 'Call the angle theta: the coordinates are cos theta and sin theta.' },
  { type: 'stage', kind: 'interactive', play: { slider: 'a', seconds: 4 }, caption: 'Watch P go round, then drag the angle yourself.', say: 'Watch the point travel round the circle: its x coordinate is the cosine, its y coordinate the sine.', spec: { title: 'The unit circle', x_range: [-1.6, 1.6], y_range: [-1.25, 1.25], sliders: [{ name: 'a', label: 'angle θ', min: 0, max: 6.28, value: 0.8 }], points: [{ name: 'O', x: 0, y: 0, draggable: false }, { name: 'P', x: 'cos(a)', y: 'sin(a)' }], circles: [{ center: 'O', radius: 1 }], segments: [{ from: 'O', to: 'P' }, { from: 'P', to: ['px', 0], dashed: true }], readouts: [{ label: 'cos θ', expr: 'px' }, { label: 'sin θ', expr: 'py' }] } },
  { type: 'write', id: 't2', text: 'cos θ = x,  sin θ = y', x: 430, y: 220, size: 'md', color: 'accent', say: 'So cosine is the x coordinate and sine is the y coordinate.' },
  { type: 'highlight', target: 't2', say: 'Keep that picture in mind.' },
  { type: 'check', kind: 'explore', prompt: 'Your turn: slide the angle until $\\sin\\theta = 0.5$.', say: 'Your turn. Find the angle where sine is one half.', explanation: 'At θ ≈ 0.52 (30°) the point is half way up: its y coordinate is 0.5.', goal: { readout: 'sin θ', equals: 0.5, tol: 0.03 }, figure: { title: 'Find sin θ = 0.5', x_range: [-1.6, 1.6], y_range: [-1.25, 1.25], sliders: [{ name: 'a', label: 'angle θ', min: 0, max: 3.14, value: 1.4 }], points: [{ name: 'O', x: 0, y: 0, draggable: false }, { name: 'P', x: 'cos(a)', y: 'sin(a)' }], circles: [{ center: 'O', radius: 1 }], segments: [{ from: 'O', to: 'P' }, { from: 'P', to: ['px', 0], dashed: true }], readouts: [{ label: 'sin θ', expr: 'py' }] } },
]

export default async function StageDemoPage() {
  const ex = (await expandBoardDiagrams({ steps: RAW })) as { steps: unknown[] }
  const v = validateScript(ex.steps)
  return (
    <main className="mx-auto w-full max-w-[760px] px-3 py-5">
      {!v.ok && <pre className="mb-3 whitespace-pre-wrap text-[12px] text-danger">{v.errors.join('\n')}</pre>}
      <DemoPlayer steps={v.steps as Step[]} title="Reading sin and cos" />
    </main>
  )
}

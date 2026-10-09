/** Fixed scenes that exercise every board cue (morph, along, pulse, annotate, rough, figure): the visuals lab page and tests. */
import type { Step } from './lesson-schema'

export const ENGINE_FIXTURE: Step[] = [
  { type: 'write', id: 'title', text: 'A ball thrown up', x: 24, y: 24, size: 'lg', say: 'Watch a ball thrown straight up.' },
  { type: 'draw', id: 'ground', shape: { kind: 'rect', x: 60, y: 420, w: 680, h: 40 }, color: 'muted', fill: true, rough: true, say: 'Here is the ground.' },
  { type: 'draw', id: 'ball', shape: { kind: 'circle', center: [140, 400], r: 16 }, color: 'clay', fill: true },
  { type: 'draw', id: 'path', shape: { kind: 'polyline', points: [[140, 400], [260, 210], [400, 140], [540, 210], [660, 400]] }, color: 'muted', dashed: true, say: 'It follows a curved path.' },
  { type: 'along', target: 'ball', via: 'path', say: 'Up it goes, slows at the top, and falls back down.' },
  { type: 'math', id: 'eq', tex: 'v = u - g t', x: 470, y: 64, size: 'md', color: 'accent', say: 'Its speed drops by $g$ every second.', cues: [{ type: 'annotate', target: 'eq', mark: 'underline', at: 'drops', color: 'clay' }] },
  { type: 'draw', id: 'top', shape: { kind: 'point', at: [400, 140], label: 'v = 0' }, color: 'navy', say: 'At the top the speed is zero.', cues: [{ type: 'pulse', target: 'top', style: 'glow', at: 'zero', times: 2 }] },
  { type: 'annotate', target: 'top', mark: 'circle', note: 'turning point', color: 'clay', say: 'This is the turning point.' },
  { type: 'draw', id: 'box', shape: { kind: 'rect', x: 80, y: 90, w: 120, h: 80 }, color: 'navy', say: 'A square of side one…' },
  { type: 'morph', target: 'box', shape: { kind: 'circle', center: [140, 130], r: 44 }, say: 'becomes a circle of the same area, roughly.' },
  { type: 'pulse', target: 'path', style: 'trace', color: 'amber', say: 'Trace the whole flight once more.' },
]

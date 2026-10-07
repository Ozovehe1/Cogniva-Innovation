import type { Step } from '@/lib/lesson-schema'

/**
 * Every kind of element the whiteboard can put on the board, each on its own narration cue. Used by the ink-under-pen
 * test (scripts/test-ink-under-pen.py via /learn/demo/ink-test): nothing in here may ever appear before the pen tip.
 * Two cues share one word on purpose (one pen: the second element follows the first).
 */
export const INK_TEST_STEPS: Step[] = [
  { type: 'write', id: 'w1', text: 'Handwritten title', x: 30, y: 24, size: 'lg', say: 'First a handwritten title on the board.' },
  { type: 'write', id: 'w2', text: 'Sans note, two lines\nsecond line here', x: 30, y: 80, size: 'sm', font: 'sans', maxWidth: 260, say: 'Then a plain note over two lines.' },
  { type: 'math', id: 'm1', tex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', x: 30, y: 150, size: 'md', say: 'Here is an equation written out.' },
  {
    type: 'draw', id: 'ln', shape: { kind: 'line', from: [330, 40], to: [460, 40] }, color: 'ink',
    say: 'A line, then an arrow, then a dashed line and a circle.', at: 'line,',
    cues: [
      { type: 'draw', id: 'ar', shape: { kind: 'arrow', from: [330, 70], to: [460, 70] }, color: 'clay', at: 'arrow,' },
      { type: 'draw', id: 'dl', shape: { kind: 'line', from: [330, 100], to: [460, 100] }, color: 'muted', dashed: true, at: 'dashed' },
      { type: 'draw', id: 'ci', shape: { kind: 'circle', center: [520, 70], r: 34 }, color: 'accent', fill: true, at: 'circle.' },
    ],
  },
  {
    type: 'draw', id: 're', shape: { kind: 'rect', x: 590, y: 36, w: 90, h: 60 }, color: 'ink', fill: true,
    say: 'A box, a zigzag, a triangle, an arc and a pie slice.', at: 'box,',
    cues: [
      { type: 'draw', id: 'pl', shape: { kind: 'polyline', points: [[700, 40], [720, 90], [740, 40], [760, 90]] }, color: 'clay', at: 'zigzag,' },
      { type: 'draw', id: 'pg', shape: { kind: 'polygon', points: [[330, 200], [400, 130], [460, 200]] }, color: 'accent', fill: true, at: 'triangle,' },
      { type: 'draw', id: 'ac', shape: { kind: 'arc', center: [530, 190], r: 40, from: 0, to: 180 }, color: 'ink', at: 'arc' },
      { type: 'draw', id: 'se', shape: { kind: 'sector', center: [640, 190], r: 44, from: 20, to: 110 }, color: 'clay', fill: true, at: 'pie' },
    ],
  },
  {
    type: 'draw', id: 'ax', shape: { kind: 'axes', frame: { x: 330, y: 250, w: 300, h: 200 }, xRange: [-1, 3], yRange: [-1, 5], xLabel: 'x', yLabel: 'y', xStep: 1, yStep: 1 },
    say: 'Now some axes, then a curve on them, a point with its label, a secant and a tangent.', at: 'axes,',
    cues: [
      { type: 'draw', id: 'fn', on: 'ax', shape: { kind: 'function', expr: 'x^2 - x', domain: [-0.8, 2.6] }, color: 'accent', width: 3, at: 'curve' },
      { type: 'draw', id: 'pt', on: 'ax', shape: { kind: 'point', at: [2, 2], label: 'P', labelPos: 'nw' }, color: 'clay', at: 'point' },
      { type: 'draw', id: 'sc', on: 'ax', shape: { kind: 'secant', expr: 'x^2 - x', x1: 0.5, x2: 2 }, color: 'muted', at: 'secant' },
      { type: 'draw', id: 'tg', on: 'ax', shape: { kind: 'tangent', expr: 'x^2 - x', at: 1.5, len: 1.6 }, color: 'ink', at: 'tangent.' },
    ],
  },
  {
    type: 'highlight', target: 'm1', style: 'box', color: 'accent',
    say: 'I box the equation and underline the title, and write two things on the same word.', at: 'box',
    cues: [
      { type: 'highlight', target: 'w1', style: 'underline', color: 'clay', at: 'underline' },
      { type: 'highlight', target: 'fn', style: 'box', color: 'accent', at: 'write' },
      { type: 'write', id: 'twinA', text: 'same', x: 30, y: 230, size: 'md', color: 'clay', at: 'same' },
      { type: 'math', id: 'twinB', tex: 'a^2 + b^2', x: 140, y: 230, size: 'md', at: 'same' },
    ],
  },
  { type: 'write', id: 'end', text: 'done', x: 30, y: 300, size: 'sm', font: 'sans', say: 'And that is every kind of mark.' },
]

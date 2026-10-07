import type { Step } from './lesson-schema'

/**
 * One generic sample lesson, shipped only as a seed/demo. Tutors write the real
 * syllabus. Its fixed id lets the migration insert it idempotently.
 */
export const SAMPLE_LESSON_ID = '00000000-0000-4000-8000-00000000d001'

export const SAMPLE_LESSON = {
  id: SAMPLE_LESSON_ID,
  title: 'What is a derivative?',
  subject: 'Mathematics',
  objectives: [
    'Describe the derivative as the slope of a curve at a single point',
    'See the tangent line as the limit of secant lines',
    'Compute the slope of y = x² at a point',
  ],
}

export const SAMPLE_SCRIPT: Step[] = [
  { type: 'write', id: 'title', text: 'What is a derivative?', x: 40, y: 30, size: 'lg', say: 'A derivative answers one question: how fast is something changing at a single instant?' },
  { type: 'write', id: 'sub', text: 'How steep is a curve at one point?', x: 42, y: 84, size: 'sm', color: 'muted', font: 'sans' },
  { type: 'draw', id: 'ax', shape: { kind: 'axes', frame: { x: 70, y: 130, w: 380, h: 320 }, xRange: [-0.5, 3], yRange: [-0.6, 6], xLabel: 'x', yLabel: 'y', xStep: 1, yStep: 2 }, say: 'Let’s take a simple curve and look closely.' },
  { type: 'draw', id: 'curve', on: 'ax', shape: { kind: 'function', expr: 'x^2' }, color: 'accent', width: 3 },
  { type: 'math', id: 'eq', tex: 'y = x^2', x: 490, y: 136, size: 'lg', color: 'accent', say: 'This is the curve $y = x^2$: square any number $x$ and you get its height.' },
  { type: 'draw', id: 'p', on: 'ax', shape: { kind: 'point', at: [1, 1], label: 'P', labelPos: 'nw' }, say: 'Pick a point P on the curve, at $x = 1$. How steep is the curve right there?' },
  { type: 'draw', id: 'q', on: 'ax', shape: { kind: 'point', at: [2, 4], label: 'Q' }, color: 'clay', say: 'A straight line has one slope. A curve doesn’t, so we start with something we can measure: a second point Q.' },
  { type: 'draw', id: 'sec', on: 'ax', shape: { kind: 'line', from: [0.4, -0.8], to: [2.6, 5.8] }, color: 'clay', dashed: true, say: 'Join P and Q with a straight line. A line that cuts a curve like this is called a secant.' },
  { type: 'math', id: 'slope', tex: '\\text{slope} = \\frac{4 - 1}{2 - 1} = 3', x: 490, y: 210, size: 'md', say: 'The line through P and Q rises 3 for every 1 across. Its slope is 3, but that is an average between P and Q.' },
  { type: 'pause', ms: 600 },
  { type: 'clear', targets: ['q', 'sec'] },
  { type: 'draw', id: 'q', on: 'ax', shape: { kind: 'point', at: [1.5, 2.25], label: 'Q' }, color: 'clay', say: 'Slide Q closer to P.' },
  { type: 'draw', id: 'sec', on: 'ax', shape: { kind: 'line', from: [0.3, -0.75], to: [2.7, 5.25] }, color: 'clay', dashed: true },
  { type: 'transform', target: 'slope', tex: '\\text{slope} = \\frac{2.25 - 1}{1.5 - 1} = 2.5', say: 'Now the slope is $2.5$. The closer Q gets, the more the line hugs the curve near P.' },
  { type: 'pause', ms: 500 },
  { type: 'transform', target: 'slope', tex: '\\text{slope} = \\frac{(1+h)^2 - 1}{h} = 2 + h', say: 'Call the gap between them $h$. The algebra simplifies to $2 + h$.' },
  { type: 'clear', targets: ['q', 'sec'] },
  { type: 'draw', id: 'tan', on: 'ax', shape: { kind: 'line', from: [0.2, -0.6], to: [3, 5] }, color: 'navy', width: 3, say: 'Now let $h$ shrink to zero. The secant settles into one line that just touches the curve at P: the tangent.' },
  { type: 'transform', target: 'slope', tex: '\\lim_{h \\to 0}\\,(2 + h) = 2', say: 'And the slope $2 + h$ becomes exactly $2$.' },
  { type: 'highlight', target: 'slope', color: 'amber' },
  { type: 'math', id: 'fp', tex: "f'(1) = 2", x: 490, y: 300, size: 'lg', color: 'navy', say: 'That limiting slope is the derivative. At $x = 1$, the curve is climbing at a rate of $2$: we write $f\'(1) = 2$.' },
  { type: 'write', id: 'def', text: 'The derivative is the slope of the tangent line.', x: 490, y: 370, size: 'sm', font: 'sans', color: 'ink', maxWidth: 280, say: 'So, in one sentence: the derivative is the slope of the tangent line.' },
  {
    type: 'check',
    id: 'c1',
    kind: 'understand',
    prompt: 'Does it make sense why the tangent’s slope is the limit of the secant slopes?',
    reteach: [
      { type: 'clear', targets: ['slope', 'fp', 'def'] },
      { type: 'write', id: 'zoom', text: 'Zoom in on P far enough and the curve looks straight.', x: 490, y: 200, size: 'sm', font: 'sans', maxWidth: 280, say: 'Here is another way to see it. Zoom in on any smooth curve and it starts to look like a straight line.' },
      { type: 'math', id: 'table', tex: '\\begin{array}{c|c} h & \\text{slope} \\\\ \\hline 1 & 3 \\\\ 0.5 & 2.5 \\\\ 0.1 & 2.1 \\\\ 0.01 & 2.01 \\end{array}', x: 520, y: 270, size: 'md', say: 'Measure the slope with smaller and smaller gaps $h$. The numbers close in on $2$.' },
      { type: 'highlight', target: 'tan', style: 'box', color: 'navy', say: 'That straight line you see when you zoom in is the tangent, and its slope, 2, is the derivative.' },
    ],
  },
  { type: 'clear' },
  { type: 'write', id: 'gen', text: 'The same idea works at any point', x: 40, y: 34, size: 'md', say: 'Do the same algebra at any point x and you get a formula for the slope everywhere.' },
  { type: 'math', id: 'rule', tex: '\\frac{d}{dx}\\, x^2 = \\lim_{h \\to 0} \\frac{(x+h)^2 - x^2}{h}', x: 400, y: 150, size: 'lg', align: 'center', say: 'Here is the slope at a general point $x$, written as a limit.' },
  { type: 'transform', target: 'rule', tex: '\\frac{d}{dx}\\, x^2 = \\lim_{h \\to 0}\\, (2x + h) = 2x', say: 'Expand, cancel, and let $h$ go to zero. The slope of $x^2$ at any point $x$ is $2x$.' },
  { type: 'highlight', target: 'rule', style: 'underline', color: 'accent' },
  {
    type: 'check',
    id: 'c2',
    kind: 'choice',
    prompt: 'What is the slope of $y = x^2$ at $x = 3$?',
    options: ['$3$', '$6$', '$9$', '$2$'],
    answer: 1,
    explanation: 'The slope is $2x$, so at $x = 3$ it is $2 \\cdot 3 = 6$.',
    reteach: [
      { type: 'math', id: 'plug', tex: "f'(x) = 2x \\;\\Rightarrow\\; f'(3) = 2 \\cdot 3", x: 400, y: 280, size: 'md', align: 'center', say: 'Careful: $9$ is the height of the curve at $x = 3$, not its slope. The slope comes from the formula $2x$.' },
      { type: 'transform', target: 'plug', tex: "f'(3) = 6", say: 'So at $x = 3$ the curve is climbing $6$ units up for every $1$ across.' },
    ],
  },
  { type: 'write', id: 'end', text: 'Derivative = instantaneous rate of change.', x: 400, y: 380, size: 'md', align: 'center', color: 'accent', say: 'That is the whole idea: a derivative is the rate of change at a single instant.' },
]

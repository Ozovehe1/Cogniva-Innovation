import type { Step } from './lesson-schema'

/**
 * The public example lesson (/learn/demo, linked from the landing page as the
 * sample lesson). Hand-written to show the product at its best: the AI tutor
 * framing, demonstrations first, voice-synced motion, handwriting, live values,
 * a narrated rendered (Manim) clip, quick checks and a "Your turn". It lives in
 * code only; nothing is seeded into the database.
 *
 * Physics: g = 9.8 m/s². Vertical throw at 15 m/s: top at 1.53 s and 11.5 m,
 * back down at 3.06 s. Forward throw at 8 m/s across and 15 m/s up: range 24.5 m.
 */
export const FLAGSHIP_LESSON = {
  title: 'Why a thrown ball comes back down',
  subject: 'Physics',
  objectives: [
    'Describe how gravity changes a ball’s velocity by 9.8 m/s every second',
    'Explain why the velocity is zero at the top while gravity still pulls',
    'See why a ball thrown forward follows a parabola',
  ],
}

/** Rendered once on the Modal Manim service (code: scripts/flagship-clip.py), timed to the clip's narration. */
export const FLAGSHIP_CLIP_URL = 'https://tyessjnrwznyizficuyp.supabase.co/storage/v1/object/public/manim-clips/examples/ball-flight/2.mp4'

const H = '15*t - 4.9*t^2'
const V = '15 - 9.8*t'

const upThenDown: Step[] = [
  {
    type: 'write', id: 'title', text: 'Why a thrown ball comes back down', x: 40, y: 30, size: 'lg',
    say: 'Hi, I’m your AI tutor. Today we’ll answer a question you’ve seen a thousand times: why does a ball you throw upward always come back down, and what path does it take on the way?',
  },
  { type: 'set', vars: { t: 0 } },
  {
    type: 'draw', id: 'lane', shape: { kind: 'axes', frame: { x: 40, y: 110, w: 110, h: 340 }, xRange: [-1, 1], yRange: [0, 14], yLabel: 'height (m)', yStep: 2 },
    say: 'Let’s start with the simplest throw there is. Picture the ball going straight up along this line, leaving your hand at fifteen metres per second.',
    until: 'line,',
    cues: [
      { type: 'draw', id: 'ball', on: 'lane', shape: { kind: 'point', at: [0, H] }, color: 'accent', at: 'ball' },
      { type: 'color', target: 'ball', color: 'accent', pulse: true, at: 'fifteen' },
    ],
  },
  {
    type: 'draw', id: 'vel', on: 'lane', shape: { kind: 'arrow', from: [0.5, H], to: [0.5, `${H} + 0.45*(${V})`] }, color: 'clay', width: 3,
    say: 'This red arrow is the ball’s velocity. It points the way the ball is moving, and its length shows how fast it’s going. Right now it’s long and pointing up.',
    at: 'red', until: 'velocity.',
    cues: [{ type: 'color', target: 'vel', color: 'clay', pulse: true, at: 'long' }],
  },
  {
    type: 'math', id: 'tv', tex: 't = {{t:2}}\\ \\text{s}', x: 470, y: 112, size: 'md',
    say: 'I’ll keep three live numbers over here: the time since you let go, the ball’s height, and its velocity. Keep an eye on them as the ball moves.',
    at: 'time', until: 'go,',
    cues: [
      { type: 'math', id: 'hv', tex: 'h = {{' + H + ':1}}\\ \\text{m}', x: 470, y: 162, size: 'md', at: 'height,' },
      { type: 'math', id: 'vv', tex: 'v = {{' + V + ':1}}\\ \\text{m/s}', x: 470, y: 212, size: 'md', color: 'clay', at: 'velocity.' },
    ],
  },
  {
    type: 'animate', var: 't', to: 1.53, ease: 'linear',
    say: 'Let it fly. Watch closely: the ball rises fast at first, then slower, and slower. The velocity arrow shrinks with every moment, and the number beside it counts down.',
    at: 'fly.', until: 'down.',
    cues: [{ type: 'highlight', target: 'vv', style: 'underline', color: 'clay', at: 'number' }],
  },
  {
    type: 'write', id: 'top', text: 'v = 0', x: 104, y: 150, size: 'sm', color: 'clay', font: 'sans',
    say: 'Here’s the top, about one and a half seconds in. The arrow has vanished. For one instant the ball isn’t moving at all: its velocity is exactly zero.',
    at: 'zero.',
    cues: [{ type: 'color', target: 'ball', color: 'clay', pulse: true, at: 'instant' }],
  },
  {
    type: 'animate', var: 't', to: 3.06, ease: 'linear',
    say: 'And then it falls. The arrow flips to point down and grows longer, faster and faster, until the ball is back at your hand moving at fifteen metres per second again, only now downward.',
    at: 'falls.', until: 'downward.',
    cues: [
      { type: 'fade', target: 'top', to: 0.35, at: 'flips' },
      { type: 'highlight', target: 'vv', style: 'underline', color: 'clay', at: 'fifteen' },
    ],
  },
  {
    type: 'write', id: 'n1', text: 'Going up: slowing down.\nComing down: speeding up.', x: 470, y: 272, size: 'sm', font: 'sans', maxWidth: 300,
    say: 'So on the way up the ball slows down, and on the way down it speeds up. Something is pulling on it the entire time.',
  },
  { type: 'set', vars: { t: 0 } },
  {
    type: 'draw', id: 'ghost', on: 'lane', shape: { kind: 'point', at: [-0.45, '15*t'] }, color: 'muted',
    say: 'What is that something? Imagine for a moment that gravity switched off. Here’s a ghost ball thrown the same way, in a world with no gravity at all.',
    at: 'ghost',
    cues: [{ type: 'fade', target: 'top', to: 0, at: 'Imagine' }],
  },
  {
    type: 'animate', var: 't', to: 0.9, ease: 'linear',
    say: 'Nothing slows the ghost down. It keeps fifteen metres per second and would sail straight off the top of the board, while the real ball has already fallen behind.',
    at: 'Nothing', until: 'board,',
    cues: [{ type: 'highlight', target: 'ball', style: 'box', color: 'accent', at: 'real' }],
  },
  {
    type: 'fade', target: 'ghost', to: 0,
    say: 'The difference between the two is gravity. Keep that ghost in mind; we’ll come back to what gravity is doing in the next part.',
    at: 'Keep',
  },
  { type: 'set', vars: { t: 0 } },
  {
    type: 'draw', id: 'hg', shape: { kind: 'axes', frame: { x: 200, y: 110, w: 240, h: 340 }, xRange: [0, 3.2], yRange: [0, 14], xLabel: 't (s)', xStep: 1, yStep: 2 },
    say: 'Let’s replay the throw, and this time draw the height against time, so we can see the whole flight at once.',
    until: 'draw',
    // One pen: the axes are drawn first, then the ball's dot goes on as "height" is said.
    cues: [{ type: 'draw', id: 'hp', on: 'hg', shape: { kind: 'point', at: ['t', H] }, color: 'accent', at: 'height' }],
  },
  {
    type: 'animate', var: 't', to: 3.06, ease: 'linear',
    say: 'Up it goes, and down it comes. The height traces a smooth hill: steep where the ball is fast, flat at the top where it’s slow.',
    at: 'Up', until: 'slow.',
    cues: [{ type: 'draw', id: 'hcurve', on: 'hg', shape: { kind: 'function', expr: '15*x - 4.9*x^2', domain: [0, 3.06] }, color: 'accent', width: 3, at: 'Up', until: 'hill:' }],
  },
  {
    type: 'draw', id: 'sym', on: 'hg', shape: { kind: 'line', from: [1.53, 0], to: [1.53, 11.5] }, color: 'muted', dashed: true,
    say: 'Notice the hill is perfectly symmetric. The ball takes exactly as long to come down as it took to go up: about one and a half seconds each way.',
    at: 'symmetric.',
    cues: [{ type: 'highlight', target: 'hcurve', style: 'box', color: 'accent', at: 'exactly' }],
  },
  {
    type: 'check', id: 'c1', kind: 'understand',
    prompt: 'Does it make sense that the ball stops for an instant at the very top?',
    reteach: [
      { type: 'set', vars: { t: 1.2 } },
      {
        type: 'animate', var: 't', to: 1.9, ease: 'linear',
        say: 'Here’s the top in slow motion. Just before it, the ball is still rising a little. Just after, it’s already falling a little. In between, there’s one moment where it’s doing neither.',
        until: 'neither.',
      },
      {
        type: 'highlight', target: 'vv', style: 'box', color: 'clay',
        say: 'Velocity can’t jump from up to down without passing through zero, just like a car reversing has to stop for a moment first.',
      },
    ],
  },
]

const gravity: Step[] = [
  { type: 'clear' },
  {
    type: 'write', id: 'title', text: 'Gravity changes velocity', x: 40, y: 30, size: 'lg',
    say: 'So what is doing the pulling? To find out, let’s stop watching the height and plot the velocity itself.',
  },
  { type: 'set', vars: { t: 0, u: 15 } },
  {
    type: 'draw', id: 'vg', shape: { kind: 'axes', frame: { x: 60, y: 110, w: 360, h: 340 }, xRange: [0, 3.2], yRange: [-16, 26], xLabel: 't (s)', yLabel: 'v (m/s)', xStep: 1, yStep: 5 },
    say: 'Time runs to the right, velocity goes up the side. Upward velocity is positive, and downward velocity is negative.',
    until: 'side.',
    cues: [{ type: 'color', target: 'vg', color: 'muted', at: 'negative.' }],
  },
  {
    type: 'draw', id: 'vline', on: 'vg', shape: { kind: 'function', expr: 'u - 9.8*x', domain: [0, 3.2] }, color: 'clay', width: 3,
    say: 'Here is the ball’s velocity through the whole flight. It starts at plus fifteen and falls in a perfectly straight line.',
    at: 'Here', until: 'line.',
    cues: [{ type: 'draw', id: 'vp', on: 'vg', shape: { kind: 'point', at: ['t', 'u - 9.8*t'] }, color: 'clay', at: 'plus' }],
  },
  {
    type: 'math', id: 'dv', tex: '\\Delta v = {{-9.8*t:1}}\\ \\text{m/s}', x: 470, y: 112, size: 'md',
    say: 'Let’s measure what one second does. In the first second the velocity drops from fifteen to about five: a change of minus nine point eight metres per second.',
    at: 'change', until: 'second.',
    cues: [
      { type: 'animate', var: 't', to: 1, ease: 'linear', at: 'first', until: 'five:' },
      { type: 'color', target: 'dv', color: 'clay', pulse: true, at: 'minus' },
    ],
  },
  {
    type: 'animate', var: 't', to: 2, ease: 'linear',
    say: 'In the next second it loses another nine point eight. On the way it passes through zero, which is the top, and keeps going negative: the ball is now falling.',
    at: 'next', until: 'zero,',
    cues: [
      { type: 'draw', id: 'zero', on: 'vg', shape: { kind: 'point', at: [1.53, 0], label: 'top', labelPos: 'ne' }, color: 'ink', at: 'zero,' },
      { type: 'highlight', target: 'dv', style: 'underline', color: 'clay', at: 'falling.' },
    ],
  },
  {
    // Cues are found in spoken order after the step's own action, so the early word ("steady") is the step's own.
    type: 'highlight', target: 'vline', style: 'box', color: 'accent',
    say: 'That steady change is gravity. Near the Earth’s surface, gravity changes the velocity of anything in free flight by nine point eight metres per second, every second. We call that number g.',
    at: 'steady',
    cues: [{ type: 'math', id: 'g', tex: 'g = 9.8\\ \\text{m/s}^2', x: 470, y: 172, size: 'lg', color: 'accent', at: 'g.' }],
  },
  {
    type: 'write', id: 'n2', text: 'Gravity never switches off, not even at the top.', x: 470, y: 238, size: 'sm', font: 'sans', maxWidth: 300,
    say: 'Here’s the idea most people get wrong. Gravity does not switch off at the top. It pulls down the whole time, and that is exactly why the velocity sails through zero and keeps on going.',
    at: 'Gravity', until: 'top.',
    cues: [{ type: 'color', target: 'zero', color: 'clay', pulse: true, at: 'sails' }],
  },
  {
    type: 'math', id: 'law', tex: 'v = 15 - 9.8\\,t', x: 470, y: 310, size: 'md',
    say: 'We can write the whole straight line as one rule: the velocity is fifteen, minus nine point eight times the time.',
    at: 'rule:',
  },
  {
    type: 'transform', target: 'law', tex: 'v = v_0 - g\\,t',
    say: 'And for any throw: the velocity is the starting speed, v nought, minus g times t.',
    at: 'any',
  },
  {
    type: 'math', id: 'ttop', tex: 't_{\\text{top}} = {{u/9.8:2}}\\ \\text{s}', x: 470, y: 372, size: 'md', color: 'navy',
    say: 'Now let’s change the throw and watch. Throw it harder, at twenty five metres per second: the whole line just starts higher, so it takes longer to reach zero, and the top comes later.',
    at: 'later.',
    cues: [
      { type: 'animate', var: 'u', to: 25, at: 'harder,', until: 'higher,' },
      { type: 'highlight', target: 'ttop', style: 'underline', color: 'navy', at: 'top' },
    ],
  },
  {
    type: 'animate', var: 'u', to: 8,
    say: 'Throw it gently, at eight, and the top comes sooner. But look at the slope: hard throw or gentle throw, it never changes. Gravity treats every throw the same.',
    at: 'gently,', until: 'sooner.',
    cues: [{ type: 'highlight', target: 'vline', style: 'box', color: 'clay', at: 'slope:' }],
  },
  { type: 'animate', var: 'u', to: 15, say: 'Let’s put it back at fifteen.', until: 'fifteen.' },
  {
    type: 'check', id: 'c2', kind: 'choice',
    prompt: 'At the very top of the flight, what are the ball’s velocity and gravity doing?',
    options: ['Velocity is 0, and gravity still pulls down at 9.8 m/s²', 'Velocity is 0, and gravity is 0 too', 'Velocity is 9.8 m/s, and gravity pulls down', 'Velocity is 15 m/s, and gravity pulls up'],
    answer: 0,
    explanation: 'At the top the velocity passes through zero, but gravity keeps pulling down at 9.8 m/s² the whole time; that is what turns the ball around.',
    reteach: [
      {
        type: 'highlight', target: 'zero', style: 'box', color: 'clay',
        say: 'If gravity were zero at the top, nothing would change the velocity there, and the ball would just hang in the air forever.',
      },
      {
        type: 'highlight', target: 'vline', style: 'underline', color: 'accent',
        say: 'Instead the line goes straight through zero with the same slope, minus nine point eight, before and after. The pull never stops.',
      },
    ],
  },
]

const parabola: Step[] = [
  { type: 'clear' },
  {
    type: 'write', id: 'title', text: 'Throw it forward', x: 40, y: 30, size: 'lg',
    say: 'Most throws aren’t straight up. So what happens when you throw the ball forward, the way you’d pass it to a friend?',
  },
  {
    type: 'manim_clip', url: FLAGSHIP_CLIP_URL, caption: 'Sideways speed stays the same; gravity bends the upward motion; together they make a parabola.',
    say: 'Here’s the idea as a short animation. Split the throw into two motions. Sideways, the ball keeps the same speed, because nothing pushes it sideways. Up and down, gravity slows it, stops it, and pulls it back, exactly as before. Put the two together, and the path is a parabola.',
  },
  { type: 'set', vars: { t: 0, a: 8, b: 15 } },
  {
    type: 'draw', id: 'pa', shape: { kind: 'axes', frame: { x: 50, y: 110, w: 390, h: 300 }, xRange: [0, 32], yRange: [0, 13], xLabel: 'distance (m)', yLabel: 'height (m)', xStep: 5, yStep: 5 },
    say: 'Let’s build it on the board. This time the ball leaves your hand at eight metres per second across, and fifteen up.',
    until: 'board.',
    cues: [{ type: 'draw', id: 'pb', on: 'pa', shape: { kind: 'point', at: ['a*t', 'b*t - 4.9*t^2'] }, color: 'accent', at: 'ball' }],
  },
  {
    type: 'draw', id: 'vx', on: 'pa', shape: { kind: 'arrow', from: ['a*t', 'b*t - 4.9*t^2'], to: ['a*t + 0.45*a', 'b*t - 4.9*t^2'] }, color: 'navy', width: 3,
    say: 'Two arrows now. The navy one is the sideways velocity, and the red one is the upward velocity.',
    at: 'navy', until: 'velocity,',
    cues: [{ type: 'draw', id: 'vy', on: 'pa', shape: { kind: 'arrow', from: ['a*t', 'b*t - 4.9*t^2'], to: ['a*t', 'b*t - 4.9*t^2 + 0.3*(b - 9.8*t)'] }, color: 'clay', width: 3, at: 'red' }],
  },
  {
    type: 'animate', var: 't', to: 3.06, ease: 'linear',
    say: 'Watch them both. The navy arrow never changes, not once. The red one shrinks, vanishes at the top, flips and grows, just like our straight-up throw. Together, they trace out this curve.',
    at: 'Watch', until: 'curve.',
    cues: [
      { type: 'draw', id: 'path', on: 'pa', shape: { kind: 'function', expr: 'b*(x/a) - 4.9*(x/a)^2' }, color: 'accent', dashed: true, at: 'Watch', until: 'curve.' },
      { type: 'color', target: 'vx', color: 'navy', pulse: true, at: 'never' },
    ],
  },
  {
    type: 'math', id: 'eq', tex: 'y = \\tfrac{15}{8}\\,x - \\tfrac{4.9}{64}\\,x^2', x: 470, y: 112, size: 'md',
    say: 'Why a parabola? Sideways distance grows steadily with time, but the drop from gravity grows with time squared. So the height is a straight-line term minus a squared term: the equation of a parabola.',
    at: 'equation',
    cues: [{ type: 'highlight', target: 'path', style: 'box', color: 'accent', at: 'parabola?' }],
  },
  {
    type: 'math', id: 'range', tex: '\\text{range} = {{2*a*b/9.8:1}}\\ \\text{m}', x: 470, y: 172, size: 'md', color: 'navy',
    say: 'It lands about twenty four and a half metres away. Now let’s change the throw and see what the parabola does.',
    at: 'lands',
  },
  { type: 'set', vars: { t: 0 } },
  {
    type: 'animate', var: 'a', to: 14,
    say: 'More speed sideways, less upward: the parabola stretches out long and low, like a line drive.',
    at: 'More', until: 'low,',
    cues: [{ type: 'animate', var: 'b', to: 8, at: 'less' }],
  },
  {
    type: 'animate', var: 'a', to: 5,
    say: 'Now almost straight up: the parabola grows tall and narrow, and the ball lands close to your feet.',
    at: 'Now', until: 'narrow,',
    cues: [{ type: 'animate', var: 'b', to: 16, at: 'straight' }],
  },
  {
    type: 'animate', var: 'a', to: 12,
    say: 'Split the same total speed evenly between across and up, and the ball goes furthest of all. That’s the famous forty five degree throw.',
    at: 'Split', until: 'up,',
    cues: [
      { type: 'animate', var: 'b', to: 12, at: 'evenly' },
      { type: 'highlight', target: 'range', style: 'underline', color: 'navy', at: 'furthest' },
    ],
  },
  {
    type: 'write', id: 'n3', text: 'Sideways: constant speed.\nUp and down: gravity.\nTogether: a parabola.', x: 470, y: 236, size: 'sm', font: 'sans', maxWidth: 300,
    say: 'So every throw is two simple motions at once: a steady glide sideways, and gravity’s pull up and down. Together they always make a parabola.',
  },
  {
    type: 'check', id: 'c3', kind: 'understand',
    prompt: 'Does it make sense why the sideways arrow never changes?',
    reteach: [
      {
        type: 'highlight', target: 'vx', style: 'box', color: 'navy',
        say: 'Gravity pulls straight down, so it can only change the up and down part of the motion. Nothing pushes the ball sideways, so its sideways speed has no reason to change.',
      },
      {
        type: 'highlight', target: 'vy', style: 'box', color: 'clay',
        say: 'All of gravity’s work shows up in the red arrow alone. That’s why the two motions can be treated separately.',
      },
    ],
  },
  { type: 'clear', targets: ['pb', 'vx', 'vy', 'path'] },
  { type: 'set', vars: { s: 0 } },
  {
    type: 'draw', id: 'da', on: 'pa', shape: { kind: 'point', at: [2, '12 - 4.9*s^2'] }, color: 'clay',
    say: 'Here’s a classic test of that idea. From twelve metres up, drop one ball, and throw another sideways at the very same instant. Which one hits the ground first?',
    at: 'drop',
    cues: [{ type: 'draw', id: 'db', on: 'pa', shape: { kind: 'point', at: ['2 + 8*s', '12 - 4.9*s^2'] }, color: 'accent', at: 'throw' }],
  },
  {
    type: 'check', id: 'c3b', kind: 'choice',
    prompt: 'Predict: which ball hits the ground first?',
    options: ['The dropped ball', 'The ball thrown sideways', 'Both land at the same moment'],
    answer: 2,
    explanation: 'Gravity pulls both down in exactly the same way, and the sideways speed doesn’t change the fall. Watch.',
  },
  {
    type: 'animate', var: 's', to: 1.56, ease: 'linear',
    say: 'Watch the dashed line between them: it stays perfectly level. They land at exactly the same moment. The sideways speed changes where the thrown ball lands, but not when.',
    at: 'Watch', until: 'moment.',
    cues: [{ type: 'draw', id: 'lvl', on: 'pa', shape: { kind: 'line', from: [2, '12 - 4.9*s^2'], to: ['2 + 8*s', '12 - 4.9*s^2'] }, color: 'muted', dashed: true, at: 'Watch' }],
  },
]

const yourTurn: Step[] = [
  { type: 'clear' },
  {
    type: 'write', id: 'title', text: 'Your turn', x: 40, y: 30, size: 'lg',
    say: 'Your turn. You throw a ball straight up at ten metres per second. How long does it take to reach the top?',
  },
  { type: 'set', vars: { t: 0 } },
  {
    type: 'draw', id: 'yg', shape: { kind: 'axes', frame: { x: 60, y: 110, w: 360, h: 320 }, xRange: [0, 2.2], yRange: [-12, 12], xLabel: 't (s)', yLabel: 'v (m/s)', xStep: 0.5, yStep: 4 },
    say: 'Here is its velocity graph, starting at ten. Think about what the velocity must be at the top, then use the rule we built.',
    until: 'ten.',
    cues: [
      { type: 'draw', id: 'yl', on: 'yg', shape: { kind: 'function', expr: '10 - 9.8*x', domain: [0, 2.04] }, color: 'clay', width: 3, at: 'velocity', until: 'ten.' },
      { type: 'math', id: 'rule', tex: 'v = v_0 - g\\,t', x: 470, y: 112, size: 'md', at: 'rule' },
    ],
  },
  {
    type: 'check', id: 'c4', kind: 'short',
    prompt: 'Your turn: how many seconds until the ball reaches the top? (to one decimal place)',
    accept: ['1', '1.0', '1.02', '1 s', '1.0 s', '1.02 s', '1s', '1.0s', 'about 1', 'about 1 second', '1 second', '1.0 seconds', '1 seconds', '≈1', '~1'],
    explanation: 'At the top the velocity is zero, so 0 = 10 − 9.8 t, which gives t = 10 ÷ 9.8 ≈ 1.0 s.',
    reteach: [
      {
        type: 'highlight', target: 'yl', style: 'box', color: 'clay',
        say: 'The top is where the velocity line crosses zero. So set v to zero in the rule and solve for t.',
      },
    ],
  },
  {
    type: 'transform', target: 'rule', tex: '0 = 10 - 9.8\\,t',
    say: 'Let’s solve it together. At the top the velocity is zero, so zero equals ten minus nine point eight t.',
    at: 'zero,',
  },
  {
    type: 'transform', target: 'rule', tex: 't = \\tfrac{10}{9.8} \\approx 1.0\\ \\text{s}',
    say: 'Move the nine point eight t across and divide: t is ten over nine point eight, which is just about one second.',
    at: 'divide:',
    cues: [
      { type: 'draw', id: 'yp', on: 'yg', shape: { kind: 'point', at: ['t', '10 - 9.8*t'] }, color: 'accent', at: 'Move' },
      { type: 'animate', var: 't', to: 1.02, ease: 'linear', at: 'divide:', until: 'second.' },
    ],
  },
  {
    type: 'draw', id: 'ytop', on: 'yg', shape: { kind: 'point', at: [1.02, 0], label: 'top: 1.0 s', labelPos: 'ne' }, color: 'accent',
    say: 'There it is on the graph: the line crosses zero at about one second. A ball thrown up at ten metres per second rises for one second, then falls for one second.',
    at: 'There',
  },
  {
    type: 'draw', id: 'area', on: 'yg', shape: { kind: 'polygon', points: [[0, 0], [0, 10], [1.02, 0]] }, color: 'accent', fill: true,
    say: 'One more question: how high does it go? The velocity falls steadily from ten to zero, so on the way up its average is five metres per second.',
    at: 'average',
    cues: [{ type: 'math', id: 'hgt', tex: 'h = \\bar v\\, t = 5 \\times 1.0', x: 470, y: 182, size: 'md', at: 'five' }],
  },
  {
    type: 'transform', target: 'hgt', tex: 'h \\approx 5\\ \\text{m}',
    say: 'Five metres per second for one second is about five metres. And look: that is exactly the area of the shaded triangle under the velocity line.',
    at: 'about',
    cues: [{ type: 'highlight', target: 'area', style: 'box', color: 'accent', at: 'area' }],
  },
  { type: 'clear', targets: ['rule', 'hgt'] },
  {
    type: 'write', id: 's1', text: 'Gravity changes velocity by 9.8 m/s every second.', x: 470, y: 112, size: 'sm', font: 'sans', maxWidth: 300,
    say: 'Let’s pull it together. One: gravity changes a ball’s velocity by nine point eight metres per second, every second, whichever way it is moving.',
  },
  {
    type: 'write', id: 's2', text: 'At the top, v = 0, but gravity still pulls.', x: 470, y: 182, size: 'sm', font: 'sans', maxWidth: 300,
    say: 'Two: at the top the velocity is zero for an instant, but gravity is still pulling. That is what turns the ball around.',
  },
  {
    type: 'write', id: 's3', text: 'Sideways speed stays the same, so the path is a parabola.', x: 470, y: 252, size: 'sm', font: 'sans', maxWidth: 300,
    say: 'Three: sideways speed stays the same, while gravity bends the up and down motion, so every thrown ball follows a parabola.',
  },
  {
    type: 'write', id: 'end', text: 'Every throw: a parabola.', x: 470, y: 340, size: 'md', color: 'accent',
    say: 'Next time you throw a ball, or watch a football fly, you’ll know exactly what shape it will trace, and why. That’s the end of this lesson. Nicely done.',
    at: 'shape',
  },
]

export const FLAGSHIP_SECTIONS: { title: string; steps: Step[] }[] = [
  { title: 'Up, then down', steps: upThenDown },
  { title: 'Gravity changes velocity', steps: gravity },
  { title: 'Throw it forward: the parabola', steps: parabola },
  { title: 'Your turn', steps: yourTurn },
]

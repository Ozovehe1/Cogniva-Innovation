import type { Step } from './lesson-schema'

/**
 * Public showcase (/learn/showcase) of the GeniusMap scene grammar (modal_app/gm_scene.py): three narrated clips in the
 * 3Blue1Brown style (one colour per quantity, equation terms linked to their objects, motion driven through the real
 * formulas), rendered on the Modal Manim service and timed to the Kokoro narration below (the `say` text must match the
 * spec's narration word for word). These three specs were written by hand as the reference for the AI composer; each
 * clip's spec is stored next to it (manim-clips/examples/showcase/<name>/1.spec.json), with pen.json for the hand.
 */
export const SHOWCASE_LESSON = {
  title: 'Three ideas, drawn the 3Blue1Brown way',
  subject: 'Linear algebra · Calculus · Physics',
}

const BASE = 'https://tyessjnrwznyizficuyp.supabase.co/storage/v1/object/public/manim-clips/examples/showcase'
export const SHOWCASE_CLIPS = {
  matrix: `${BASE}/matrix/1.mp4`,
  derivative: `${BASE}/derivative/1.mp4`,
  ball: `${BASE}/ball/1.mp4`,
}

function section(title: string, url: string, caption: string, say: string): Step[] {
  return [
    { type: 'clear' },
    { type: 'write', id: 'title', text: title, x: 40, y: 30, size: 'lg' },
    { type: 'manim_clip', url, caption, say },
  ]
}

export const SHOWCASE_SECTIONS: { title: string; steps: Step[] }[] = [
  { title: 'A matrix moves the whole plane', steps: section('A matrix moves the whole plane', SHOWCASE_CLIPS.matrix, 'The columns of a matrix are where the basis vectors land; every vector keeps its recipe.', "A matrix is a recipe for moving every point of the plane. Watch two arrows: the green one, i hat, and the red one, j hat. Here is a gold vector, one i hat plus two j hat. The first column of this matrix says where i hat lands: two right and one up. The second column says where j hat lands: one left and one up. Now apply it. The whole grid follows, and its lines stay straight, parallel and evenly spaced. And the gold vector is still one green arrow plus two red ones, so it lands at zero, three.") },
  { title: 'From secant to tangent', steps: section('From secant to tangent', SHOWCASE_CLIPS.derivative, 'As h shrinks, the secant slope 1 + h/2 falls to 1: the slope of the tangent, the derivative.', "Here is a curve, y equals one half x squared, and a point on it at x equals one. Pick a second point, a distance h further along, and draw the line through both. This secant's slope is the rise over the run: f of one plus h, minus f of one, all over h. Right now h is two, and the slope is two. Now slide the second point in. As h shrinks, the secant swings down and its slope falls: one and a half, one point two, closer and closer to one. In the limit, the secant becomes the tangent, and its slope is the derivative. f prime of one equals one.") },
  { title: 'Why a thrown ball comes back down', steps: section('Why a thrown ball comes back down', SHOWCASE_CLIPS.ball, 'Gravity removes 9.8 m/s of upward speed every second: zero at 1.22 s, back down at 2.45 s.', "Throw a ball straight up at twelve metres per second. Gravity pulls down on it with the same strength the whole time, and every second it takes away nine point eight metres per second of speed. So the green velocity arrow shrinks: from twelve, to about two after one second. At one point two two seconds it is zero, and for an instant the ball is at the top, seven point three five metres up. Gravity keeps pulling, so the velocity turns negative and grows downward. The ball falls back and lands two point four five seconds after the throw, moving at twelve metres per second again, now pointing down.") },
]

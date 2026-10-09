/**
 * Visual policy: which kind of visual fits a question or a lesson topic, when the learner did not name a tool.
 * Shared by Ask / the in-lesson tutor sheet (tool routing + a per-turn hint) and lesson drafting (beat prompts,
 * the visual refresh of older lessons), so "explain how the heart pumps blood" gets a real picture of the heart and
 * an animation of the flow, not just the hand-drawn board. The board stays the tool for working and derivations.
 *
 * Families (a text can match several):
 *   structure   a real-world object or organism (organ, cell, plant, apparatus, circuit, atom, planet) → library illustration
 *   process     something that happens in stages or cycles over time (pumping, photosynthesis, digestion) → animation
 *   motion      a body moving under forces (thrown ball, projectile, pendulum, orbit, wave) → simulation + animation
 *   function    a function / rate / graph idea (derivative, gradient, parabola, sine) → plot or live figure (+ animation)
 *   geometry    exact maths structure (triangle, angle, vectors, sets) → math diagram / live figure
 *   derivation  working a problem step by step (solve, expand, simplify) → the board
 */

export type VisualFamily = 'structure' | 'process' | 'motion' | 'function' | 'geometry' | 'derivation'

const STRUCTURE_TERMS: [RegExp, string][] = [
  [/\bheart\b|\bcardiac\b|\bventricle|\batri(um|a)\b/i, 'human heart'],
  [/\blungs?\b|\balveol|\bbreathing\b|respiratory system/i, 'human lungs'],
  [/\bkidneys?\b|\bnephron/i, 'kidney'],
  [/\bbrain\b/i, 'human brain'],
  [/\bneurons?\b|\bnerve cell|\baxon|\bsynap/i, 'neuron'],
  [/\beye\b|\bretina\b/i, 'human eye'],
  [/\bear\b|\bcochlea/i, 'human ear'],
  [/\bdigest\w*|\bstomach\b|\bintestine/i, 'digestive system'],
  [/\bskeleton\b|\bbones?\b/i, 'human skeleton'],
  [/\bteeth\b|\btooth\b/i, 'tooth structure'],
  [/\bblood (vessel|circulation)|\bcirculatory|\barter(y|ies)|\bveins?\b/i, 'human heart'],
  [/\bplant cells?\b/i, 'plant cell'],
  [/\banimal cells?\b/i, 'animal cell'],
  [/\bcell membrane|\bplasma membrane|\bphospholipid|\bion channels?\b/i, 'cell membrane'],
  [/\bmitochondri/i, 'mitochondrion'],
  [/\bchloroplast|\bphotosynthe\w*|\bleaf\b|\bleaves\b/i, 'leaf structure'],
  [/\bflowers?\b|\bpollinat/i, 'flower structure'],
  [/\bxylem|\bphloem|\broot hairs?/i, 'plant root'],
  [/\bdna\b|\bdouble helix|\bchromosome/i, 'DNA'],
  [/\bvirus(es)?\b/i, 'virus'],
  [/\bbacteri\w*/i, 'bacterium'],
  [/\b(a |the )?cells?\b/i, 'animal cell'],
  [/\batoms?\b|\bbohr\b|\belectron shell/i, 'Bohr model atom'],
  [/\bmolecules?\b|\bwater molecule/i, 'water molecule'],
  [/\b(electric )?circuits?\b|\bresistors?\b|\bbulb\b/i, 'electric circuit'],
  [/\bbattery|\bbatteries|\bcells? in series/i, 'battery'],
  [/\bsolar (panel|cell|pv)|\bphotovoltaic/i, 'solar panel'],
  [/\bmagnets?\b|\bmagnetic field/i, 'bar magnet field'],
  [/\b(electric )?motor\b/i, 'electric motor'],
  [/\bgenerator\b|\bdynamo/i, 'electric generator'],
  [/\btransformer\b/i, 'transformer'],
  [/\blevers?\b/i, 'lever'],
  [/\bpulleys?\b/i, 'pulley'],
  [/\bmicroscope/i, 'microscope'],
  [/\bvolcano/i, 'volcano'],
  [/\bearthquake|\btectonic/i, 'tectonic plates'],
  [/\bsolar system|\bplanets?\b/i, 'solar system'],
  [/\bmoon phases?|\bphases of the moon/i, 'moon phases'],
  [/\bseasons?\b.*\b(earth|sun|tilt)|\bearth'?s tilt/i, 'earth seasons'],
  [/\bwater cycle/i, 'water cycle'],
]

const PROCESS = /\b(how (does|do|is|are) .{2,60}\b(work|happen|move|flow|pump|form|grow|made|produced|travel|fire|spread)|pumps?|pumping|circulat\w*|flows?\b|flowing|cycles?\b|photosynthe\w*|respir\w*|digest\w*|diffusion|osmosis|transport\w*|mitosis|meiosis|fires?\b|action potential|signal\w*|charging|discharg\w*|reaction|erosion|evaporat\w*|condens\w*|stages?\b|process|life cycle|germinat\w*|pollinat\w*|replicat\w*|transcription|translation|heat (flow|transfer)|conduction|convection|current flows?|electrons? (flow|move))\b/i
const MOTION = /\b(thrown|throw|falls?\b|falling|dropped|projectile|trajectory|orbit\w*|swing\w*|pendulum|oscillat\w*|waves?\b|rolls?\b|rolling|accelerat\w*|decelerat\w*|velocity|speed(s)? up|momentum|collision|gravity|free fall|comes? (back )?down|goes up|spring|bounc\w*|equations of motion|suvat|kinematics|friction|newton'?s (first|second|third|laws?))\b/i
const FUNCTION = /\b(derivative|differentiat\w*|gradient|slope|rate of change|functions?\b|graphs?\b|quadratic|parabola|sine|cosine|sin\b|cos\b|tan\b|trig\w*|exponential|logarithm\w*|log\b|limit|integral|integrat\w*|area under|tangent|asymptote|inverse function|linear (graph|function)|straight line|y\s*=|f\(x\))/i
const GEOMETRY = /\b(triangle|angles?\b|circle theorem|pythag\w*|polygon|bisect\w*|perpendicular|parallel lines|congruen\w*|similar triangles|vectors?\b|resultant|venn|sets?\b|subset|union|intersection|unit circle|coordinates?\b|transformation|reflection|rotation|locus)\b/i
const DERIVATION = /\b(solve|simplify|expand|factori[sz]\w*|prove|derive|derivation|step by step|work (it )?out|calculate|evaluate|rearrange|make .{1,10} the subject|simultaneous|long division|worked example)\b/i

export interface VisualRead { families: VisualFamily[]; structure?: string }

/** Read which visual families a question or topic text belongs to (cheap, regex only). */
export function readVisual(text: string): VisualRead {
  const t = (text || '').slice(0, 1200)
  const families: VisualFamily[] = []
  const hit = STRUCTURE_TERMS.find(([re]) => re.test(t))
  if (hit) families.push('structure')
  if (PROCESS.test(t)) families.push('process')
  if (MOTION.test(t)) families.push('motion')
  if (FUNCTION.test(t)) families.push('function')
  if (GEOMETRY.test(t)) families.push('geometry')
  if (DERIVATION.test(t)) families.push('derivation')
  return { families, structure: hit?.[1] }
}

/** A conceptual ask that names no tool ("explain…", "how does…", "why does…", "what is…"). */
export const CONCEPT_ASK = /^\s*(please\s+)?(can you\s+|could you\s+)?(explain|teach( me)?|show me|help me understand|tell me( about)?|describe|how (does|do|is|are|can)|why (does|do|is|are|did)|what (is|are|does|happens)|what's)\b/i

/** Tools that fit the families, richest first (Ask / in-lesson sheet). */
export function toolsForFamilies(r: VisualRead): string[] {
  const out: string[] = []
  const add = (...n: string[]) => n.forEach(x => { if (!out.includes(x)) out.push(x) })
  const f = new Set(r.families)
  if (f.has('structure')) add('find_illustration', 'illustrate')
  if (f.has('process')) add('animate_concept')
  if (f.has('motion')) add('simulate', 'animate_concept', 'plot')
  if (f.has('function')) add('plot', 'interactive', 'animate_concept')
  if (f.has('geometry')) add('math_diagram', 'interactive')
  if (f.has('derivation')) add('draw_on_board')
  return out
}

/**
 * One line for the agent's context on this turn: the visual plan the routing policy recommends. Weak free models
 * otherwise default to the first familiar tool (the board) for every question.
 */
export function visualPlanHint(text: string): string | null {
  const r = readVisual(text)
  const f = new Set(r.families)
  const lines: string[] = []
  if (f.has('structure')) lines.push(`a real labelled picture of the ${r.structure} (find_illustration, query "${r.structure}")`)
  if (f.has('process') && !f.has('motion')) lines.push('an animation of the process unfolding in order (animate_concept: name each stage and what moves)')
  if (f.has('motion')) lines.push('the object actually moving (simulate with a motion dot and its path, sliders for what the learner can change) and/or animate_concept for the full story of the motion')
  if (f.has('function') && !f.has('motion')) lines.push('the function on axes (plot), or a live figure to drag (interactive) when the idea is about change (a tangent, a slope, a parameter); animate_concept for a secant turning into a tangent or a curve being traced')
  if (f.has('geometry')) lines.push('an exact diagram (math_diagram) or a figure to drag (interactive)')
  if (!lines.length) return null
  const board = f.has('derivation') ? ' Use draw_on_board for the step-by-step working.' : ' The board (draw_on_board) is for derivations and working; it is not the default here.'
  return `Visual plan for this question (the learner did not name a tool; pick the richest visual that fits, one or two): ${lines.join('; or ')}.${board} An animation takes 1-3 minutes to arrive, so pair it with a still visual now (a picture, plot or simulation).`
}

/** Lesson beats: a line telling the beat writer which rich visual this topic calls for (null: the board alone fits). */
export function beatVisualLine(text: string, kind: string): string | null {
  if (kind !== 'demo' && kind !== 'example' && kind !== 'wrap') return null
  const r = readVisual(text)
  const f = new Set(r.families)
  if (f.has('structure') && (kind === 'demo' || kind === 'wrap'))
    return `This beat is about a real-world structure: show the real thing with one {"type":"illustration","query":"${r.structure}", x, y, w, h, "say"} step in the diagram region (a credited textbook drawing), then point at the parts that matter with arrows and short labels beside it. Do not build the ${r.structure} out of circles and rectangles.`
  if ((f.has('function') || f.has('motion')) && kind === 'demo')
    return 'This idea is about change: let the learner explore it with one {"type":"stage","kind":"interactive",...} step (a live figure with a slider and a "play" demonstration under the narration; for motion, a point at (x(t), y(t)) moving along its path with live readouts), then continue on the board.'
  return null
}

/** A generic re-ask inside a lesson ("explain this another way", "I don't get it", "one more example"). */
export const GENERIC_REASK = /\b(another way|differently|explain (this|that|it)|don'?t (get|understand)|i'?m (lost|confused|stuck)|one more example|show me (this|that|it)|again)\b|^\s*i don'?t get/i

/** The text the visual policy reads: the learner's ask, plus the lesson topic when the ask is generic and names no subject. */
export function visualText(ask: string, topic?: string | null): string {
  if (!topic || readVisual(ask).families.length || !GENERIC_REASK.test(ask)) return ask
  return `${ask}. ${topic}`
}

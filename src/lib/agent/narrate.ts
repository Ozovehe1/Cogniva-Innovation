/**
 * Every tutor turn that shows a visual also says something about it. A turn can end with a visual and no words when
 * the free models are busy (the step after the tool call fails) or a model ends its turn right after the tool call.
 * Then: one short narration call on another free model (the slot that went quiet is skipped), and if that fails too,
 * plain sentences built from the visual's own content (its title, caption, beats, steps, alt text) plus the move
 * reason the tutor declared. A learner never gets a silent visual. Server only (worked examples are re-evaluated).
 */
import type { Block } from './types'
import type { MoveDecision } from './moves'
import { chat, type Msg } from './llm'
import { evaluateSpec, statementText } from '@/lib/examples/engine'
import { fill } from '@/lib/examples/spec'

/** Blocks a learner looks at (not citations, checks, plans or buttons). */
export const VISUAL_KINDS = new Set<Block['kind']>(['board', 'svg', 'sim', 'interactive', 'clip', 'image', 'worked_example', 'scene'])
export const isVisual = (b: Block) => VISUAL_KINDS.has(b.kind)

/** Prose words in a reply, ignoring maths, MOVE/DO lines, links and markup. */
export function proseWords(text: string): number {
  const t = text
    .split('\n').filter(l => !/^\s*(MOVE|DO)\s*:/i.test(l)).join(' ')
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, ' x ')
    .replace(/\[(\d+)\]|\(https?:[^)]*\)|https?:\S+/g, ' ')
    .replace(/[#*_`>|]/g, ' ')
  return (t.match(/[A-Za-zÀ-ÿ']{2,}/g) ?? []).length
}
/** A reply that says too little to explain a visual (less than about one real sentence). */
export const needsNarration = (text: string) => proseWords(text) < 12

const clean = (s: unknown, n = 220) => String(s ?? '').replace(/\s+/g, ' ').replace(/[{}<>]/g, '').trim().slice(0, n)
const sentence = (s: string) => { const t = clean(s, 260).replace(/[\s,;:–-]+$/, ''); return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}` : '' }
/** Lower-case the first letter; a Title Case Heading becomes plain words ("How an Electric Motor Turns" → "how an electric motor turns"), acronyms and symbols kept. */
const lower1 = (s: string) => {
  if (!s) return s
  const ws = s.split(' ')
  const long = ws.filter(w => /^[A-Za-z]{4,}$/.test(w))
  if (long.length >= 2 && long.filter(w => /^[A-Z][a-z]/.test(w)).length / long.length >= 0.6) return ws.map(w => w.split('-').map(x => (/^[A-Z][a-z]+$/.test(x) ? x.toLowerCase() : x)).join('-')).join(' ')
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s
}
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** What a visual shows, from its own content: a lower-case title, up to 4 short beats in order, and an invitation. */
export function describeVisual(b: Block): { what: string; title: string; beats: string[]; hint?: string } | null {
  switch (b.kind) {
    case 'worked_example': {
      const s = b.spec
      let problem = ''
      const beats: string[] = []
      try {
        const ev = evaluateSpec(s)
        problem = statementText(s, ev.scope)
        for (const st of s.steps.slice(0, 4)) beats.push(clean(st.title || fill(st.reason, ev.scope), 90))
      } catch { problem = '' }
      const title = lower1(clean(s.topic, 80))
      return { what: `a worked example on ${title || 'this'}${problem ? `: ${clean(problem, 220)}` : ''}`, title, beats: beats.filter(Boolean), hint: pick(title || 'we', ['Before you open the steps, make a quick prediction — what do you expect the answer to be?', 'Make your prediction first, then open the steps one at a time and see if you were right.']) }
    }
    case 'scene': {
      const title = lower1(clean(b.spec.title, 90))
      const beats = (b.spec.beats ?? []).map(x => clean(x.caption || x.say, 110)).filter(Boolean).slice(0, 4)
      const cs = (b.spec.controls ?? []).map(c => ctl((c as { label?: string }).label || c.param.replace(/_/g, ' '))).filter(Boolean).slice(0, 2)
      const hint = cs.length ? pick(title || 'scene', [`When it finishes, try the ${list(cs)} slider${cs.length > 1 ? 's' : ''} yourself — what do you expect to change?`, `Once it settles, slide the ${list(cs)} up and down and see what happens.`])
        : b.spec.drag ? 'When it finishes, it\'s your turn — drag it and see what changes.'
        : 'Which part would you like to see again?'
      return { what: `a live scene of ${title || 'the idea'}`, title, beats, hint }
    }
    case 'interactive': {
      const title = lower1(clean(b.spec.title, 90))
      const sl = (b.spec.sliders ?? []).map(x => ctl((x as { label?: string; name?: string }).label || (x as { name?: string }).name || '')).filter(Boolean).slice(0, 2)
      return { what: `a live figure of ${title || 'the idea'}`, title, beats: [clean(b.spec.explain || (b.spec.title ? '' : b.alt), 200)].filter(Boolean), hint: sl.length ? `Try moving the ${list(sl)} slider${sl.length > 1 ? 's' : ''} — what happens to the figure?` : undefined }
    }
    case 'sim': {
      const title = lower1(clean(b.spec.title, 90))
      const ps = (b.spec.params ?? []).map(p => ctl(p.label)).filter(Boolean).slice(0, 2)
      return { what: `a simulation of ${title || 'the motion'}`, title, beats: [clean(b.spec.explain, 200)].filter(Boolean), hint: ps.length ? `Change the ${list(ps)}, press play, and see what happens.` : undefined }
    }
    case 'svg': { const title = lower1(clean(b.alt.replace(/^(a |an |the )?(picture|diagram|illustration|image) of /i, ''), 140)); return { what: `a picture of ${title || 'it'}`, title, beats: [], hint: 'Go through each labelled part — which one would you like to talk about?' } }
    case 'image': return { what: b.caption ? `a picture: ${clean(b.caption, 160)}` : 'a picture of it', title: lower1(clean(b.caption, 160)), beats: [] }
    case 'clip': { const title = lower1(clean(b.caption, 120)); return b.status === 'failed' ? null : { what: `${b.status === 'done' ? 'a short animation' : 'a short animation (it is still rendering and appears here in a minute or two)'}${title ? ` of ${title}` : ''}`, title, beats: [] } }
    case 'board': {
      const says = (b.steps ?? []).map(st => clean((st as { say?: string }).say, 140)).filter(Boolean)
      const title = lower1(clean(b.title, 90))
      return { what: `the board${title ? ` showing ${title}` : ''}`, title, beats: says.slice(0, 3) }
    }
    default: return null
  }
}

/* ───────── deterministic narration (no model) ───────── */

const words = (s: string) => (s.match(/\S+/g) ?? []).length
/** A stable pick from a few phrasings so the same visual always reads the same, and different visuals vary. */
const pick = <T,>(seed: string, xs: T[]): T => { let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return xs[h % xs.length] }
/** A caption fragment as a spoken clause: lower-case start, no end stop, "X: Y" → "X — Y", no leading "So/And". */
const NO_THE = /^(a|an|the|this|that|these|those|it|its|they|their|we|you|your|each|every|no|one|two|three|more|less|most|all|some|both|now|then|here|there|when|if|as|so)$/i
const clause = (s: string) => {
  let c = lower1(clean(s, 120)).replace(/[.!?]+$/, '').replace(/^(so|and|then|now|next|finally)[,]?\s+/i, '').replace(/\s*:\s+/g, ' — ').trim()
  // Caption shorthand drops articles ("commutator flips current"); spoken, it gets one back ("the commutator flips…").
  const [w1, w2] = c.split(' ')
  if (w1 && w2 && /^[a-z]+$/.test(w1) && !NO_THE.test(w1) && !/(ing|ly|ed)$/.test(w1) && (/^[a-z]+s$/.test(w2) && !/ss$/.test(w2) || w1 === 'same')) c = `the ${c}`
  return c
}
/** Slider labels as plain words ("Cell voltage V" → "cell voltage", "Current I" → "current"). */
const ctl = (s: string) => lower1(clean(s, 30)).replace(/\s+[A-Za-zθωλμ]$/, '').trim()

/** Beats as 1-2 flowing sentences with plain connectors. */
function flow(beats: string[]): string {
  const b = beats.map(clause).filter(Boolean)
  if (!b.length) return ''
  if (b.length === 1) return sentence(b[0])
  if (b.length === 2) return `${sentence(`First, ${b[0]}`)} ${sentence(`Then ${b[1]}`)}`
  if (b.length === 3) return `${sentence(`First, ${b[0]}`)} ${sentence(`Then ${b[1]}, and finally ${b[2]}`)}`
  return `${sentence(`First, ${b[0]}, then ${b[1]}`)} ${sentence(`Next, ${b[2]}, and finally ${b[3]}`)}`
}

/** How a visual is introduced, spoken ("Watch how an electric motor keeps turning."). */
function opener(b: Block, d: NonNullable<ReturnType<typeof describeVisual>>): string {
  const t = d.title
  const howish = /^(how|why|what|where|when|which)\b/.test(t)
  switch (b.kind) {
    case 'scene': return howish ? sentence(`Watch ${t}`) : sentence(pick(t, [`Let's watch ${t || 'this'} play out`, `Watch this live scene of ${t || 'the idea'}`]))
    case 'worked_example': return sentence(`Let's work through one together${t ? ` on ${t}` : ''}`)
    case 'interactive': return howish ? sentence(`This live figure shows ${t}`) : sentence(`Here's a live figure of ${t || 'the idea'} to play with`)
    case 'sim': return sentence(`This simulation shows ${t || 'the motion'}`)
    case 'svg': return sentence(`Take a look at this picture of ${t || 'it'}`)
    case 'image': return sentence(t ? `Take a look at this picture — ${t}` : 'Take a look at this picture')
    case 'clip': return sentence(`${b.status === 'done' ? 'Here\'s a short animation' : 'A short animation is on its way (it takes a minute or two)'}${t ? ` of ${t}` : ''}`)
    case 'board': return sentence(`Follow along on the board${t ? ` as we look at ${t}` : ''}`)
    default: return ''
  }
}

/**
 * Plain narration from the visuals' own content (no model): an opener, the visual's beats as 1-2 flowing sentences,
 * and one invitation to interact or a check question. About 40-70 words. Never states why the tutor chose it.
 * `_move` is accepted for older callers and ignored on purpose (a declared reason reads as internal reasoning).
 */
export function narrationFromVisual(blocks: Block[], _move?: MoveDecision | null): string {
  void _move
  const vs = blocks.filter(isVisual).map(b => ({ b, d: describeVisual(b) })).filter((x): x is { b: Block; d: NonNullable<ReturnType<typeof describeVisual>> } => !!x.d).slice(0, 2)
  if (!vs.length) return ''
  const [{ b, d }] = vs
  const open = opener(b, d)
  const close = d.hint ?? pick(d.title || b.kind, ['Have a look, then tell me which part you would like to go over.', 'Take your time with it, and ask me about any part that feels unclear.'])
  const second = vs[1] ? sentence(`Just below, there's ${vs[1].d.what}`) : ''
  let beats = d.beats.slice(0, 4)
  const body = () => (b.kind === 'worked_example' && beats.length > 1 ? sentence(`We'll go step by step: ${list(beats.map(clause))}`) : flow(beats))
  const build = () => [open, body(), second, close].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  let out = build()
  // Keep it short: drop middle beats, then the second-visual line, until it is about 70 words.
  while (words(out) > 70 && beats.length > 2) { beats = [beats[0], ...beats.slice(2)]; out = build() }
  if (words(out) > 70 && second) out = [open, body(), close].filter(Boolean).join(' ')
  while (words(out) > 75 && beats.length > 1) { beats = beats.slice(0, -1); out = [open, body(), close].filter(Boolean).join(' ') }
  return out.slice(0, 600)
}

/** A model narration that leaks internal reasoning or reads like a system message. */
export const stiffNarration = (t: string) => /\b(you requested|you asked for a|I chose this|I chose (a|the|to)|the tutor|teaching move|here is (a|the) (live )?(scene|visual|figure|worked example)|it goes in order)\b/i.test(t)

/**
 * Narration for a turn that showed visuals with (almost) no words: one short call on another free model, else the
 * plain narration from the visual. `skipModel` when every model was just busy (no point asking again).
 */
export async function narrateVisual(o: {
  blocks: Block[]; move?: MoveDecision | null; question: string; already: string
  avoidSlots?: string[]; deadline?: number; trace: string[]; skipModel?: boolean; forceModelFail?: boolean
}): Promise<{ text: string; via: 'model' | 'visual' } | null> {
  const vis = o.blocks.filter(isVisual)
  if (!vis.length) return null
  const fallback = narrationFromVisual(vis, o.move)
  const left = (o.deadline ?? Date.now() + 15_000) - Date.now()
  if (!o.skipModel && left > 6_000) {
    try {
      if (o.forceModelFail) throw new Error('test: narration model forced to fail')
      const desc = vis.map(describeVisual).filter(Boolean).map(d => `- ${d!.what}${d!.hint ? ` [learner can: ${d!.hint}]` : ''}${d!.beats.length ? ` (in order: ${d!.beats.join(' / ')})` : ''}`).join('\n')
      const messages: Msg[] = [
        { role: 'system', content: 'You are GeniusMap, a warm tutor sitting beside a teenager in Nigeria. The visual below is already on their screen. Talk them through it the way you would out loud: 2-4 short, flowing sentences in its order, saying what to notice, then end with one natural invitation to try something on it or one quick check question. Write titles in plain lower case inside the sentence. Never say why you chose it, never say "you requested", "here is a visual" or "it goes in order". Describe only what is listed. No greeting, no JSON, no lists, at most 70 words, maths in $...$.' },
        { role: 'user', content: `Learner asked: <data>${clean(o.question, 400)}</data>\nOn screen now:\n${desc}${o.already.trim() ? `\nAlready said: ${clean(o.already, 300)}` : ''}` },
      ]
      const r = await chat({ purpose: 'light', messages, maxTokens: 220, temperature: 0.4, trace: o.trace, deadline: Math.min(o.deadline ?? Infinity, Date.now() + 12_000), avoidSlots: o.avoidSlots })
      const t = r.text.split('\n').filter(l => !/^\s*(MOVE|DO)\s*:/i.test(l)).join(' ').replace(/```[\s\S]*?```/g, '').trim()
      if (proseWords(t) >= 10 && !/[{}]/.test(t) && !stiffNarration(t)) { o.trace.push(`narration: model ${r.model}`); return { text: t.slice(0, 900), via: 'model' } }
      o.trace.push('narration: model reply too thin or stiff, using the visual')
    } catch (err) {
      o.trace.push(`narration: model failed (${err instanceof Error ? err.message.slice(0, 80) : String(err)}), using the visual`)
    }
  }
  if (!fallback) return null
  o.trace.push('narration: from the visual')
  return { text: fallback, via: 'visual' }
}

/* ───────── lesson re-teach steps ───────── */

type LooseStep = { type: string; say?: string; at?: unknown; until?: unknown; cues?: unknown[]; caption?: string; spec?: { title?: string; explain?: string }; text?: string; tex?: string; shape?: { kind?: string } }
const VISUAL_STEP = new Set(['stage', 'manim_clip', 'draw', 'write', 'math', 'animate', 'morph', 'along', 'annotate'])

/**
 * A re-teach batch that shows something but says (almost) nothing gets a spoken line on its first visual step, built
 * from what the steps show (stage caption/title/explanation, clip caption, board text) and why the tutor is
 * re-teaching. Steps with word cues are left alone (adding words would move their cues). Returns how many it filled.
 */
export function narrateSteps<T extends { type: string }>(steps: T[], why: 'explain_differently' | 'wrong_answer' | 'continue' | 'worked_example' | string): number {
  const ss = steps as unknown as LooseStep[]
  const said = ss.map(s => s.say ?? '').join(' ')
  if (!ss.some(s => VISUAL_STEP.has(s.type)) || proseWords(said) >= 12) return 0
  const target = ss.find(s => VISUAL_STEP.has(s.type) && s.at === undefined && s.until === undefined && !s.cues?.length)
  if (!target) return 0
  const stage = ss.find(s => s.type === 'stage')
  const clip = ss.find(s => s.type === 'manim_clip')
  const words = ss.filter(s => s.type === 'write' && s.text).map(s => clean(s.text, 60)).slice(0, 2)
  const what = stage ? `this live figure${stage.spec?.title ? ` of ${lower1(clean(stage.spec.title, 80))}` : ''}`
    : clip ? `this short animation${clip.caption ? ` of ${lower1(clean(clip.caption, 80))}` : ''}`
    : words.length ? `the board: ${list(words.map(w => `"${w}"`))}` : 'the new drawing on the board'
  const lead = why === 'wrong_answer' ? 'Let\'s look at that one again together.' : why === 'worked_example' ? 'Let\'s work through one together.' : 'Let\'s try it another way.'
  const body = stage?.spec?.explain ? sentence(clause(stage.spec.explain)) : stage?.caption ? sentence(clause(stage.caption)) : ''
  const close = stage ? 'Have a go with it — what do you notice?' : 'Follow it step by step, and notice what changes.'
  const line = `${lead} ${sentence(`Watch ${what}`)} ${body} ${close}`.replace(/\s+/g, ' ').trim().slice(0, 390)
  target.say = target.say ? `${line} ${target.say}`.slice(0, 400) : line
  return 1
}

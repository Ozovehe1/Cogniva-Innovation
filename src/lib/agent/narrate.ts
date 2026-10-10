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
const lower1 = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** What a visual shows, from its own content: a title and up to 4 short beats in order. */
export function describeVisual(b: Block): { what: string; beats: string[]; hint?: string } | null {
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
      return { what: `a worked example on ${clean(s.topic, 80) || 'this'}${problem ? `: ${clean(problem, 220)}` : ''}`, beats: beats.filter(Boolean), hint: 'Make your prediction first, then open the steps one at a time.' }
    }
    case 'scene': {
      const beats = (b.spec.beats ?? []).map(x => clean(x.say || x.caption, 110)).filter(Boolean).slice(0, 4)
      return { what: `a live scene of ${lower1(clean(b.spec.title, 90)) || 'the idea'}`, beats, hint: (b.spec.controls?.length ? `When it finishes, move the ${list(b.spec.controls.map(c => clean(c.label || c.param, 30)).slice(0, 2))} slider and watch what changes.` : b.spec.drag ? 'When it finishes, drag it yourself and watch what changes.' : undefined) }
    }
    case 'interactive': {
      const sl = (b.spec.sliders ?? []).map(x => clean((x as { label?: string; name?: string }).label || (x as { name?: string }).name, 24)).filter(Boolean).slice(0, 2)
      return { what: `a live figure of ${lower1(clean(b.spec.title, 90)) || 'the idea'}`, beats: [clean(b.spec.explain || (b.spec.title ? '' : b.alt), 200)].filter(Boolean), hint: sl.length ? `Move the ${list(sl)} slider${sl.length > 1 ? 's' : ''} and watch how the figure changes.` : undefined }
    }
    case 'sim': {
      const ps = (b.spec.params ?? []).map(p => clean(p.label, 24)).filter(Boolean).slice(0, 2)
      return { what: `a simulation of ${lower1(clean(b.spec.title, 90)) || 'the motion'}`, beats: [clean(b.spec.explain, 200)].filter(Boolean), hint: ps.length ? `Change the ${list(ps)} and press play to see the effect.` : undefined }
    }
    case 'svg': return { what: `a picture of ${lower1(clean(b.alt.replace(/^(a |an |the )?(picture|diagram|illustration|image) of /i, ''), 140)) || 'it'}`, beats: [], hint: 'Look at each labelled part as you read.' }
    case 'image': return { what: b.caption ? `a picture: ${clean(b.caption, 160)}` : 'a picture of it', beats: [] }
    case 'clip': return b.status === 'failed' ? null : { what: `${b.status === 'done' ? 'a short animation' : 'a short animation (it is still rendering and appears here in a minute or two)'}${b.caption ? ` of ${lower1(clean(b.caption, 120))}` : ''}`, beats: [] }
    case 'board': {
      const says = (b.steps ?? []).map(st => clean((st as { say?: string }).say, 140)).filter(Boolean)
      return { what: `the board${b.title ? ` showing ${lower1(clean(b.title, 90))}` : ''}`, beats: says.slice(0, 3) }
    }
    default: return null
  }
}

/** The declared move reason, said to the learner ("they keep mixing up…" → "you keep mixing up…"). */
function reasonLine(move?: MoveDecision | null): string {
  const r = clean(move?.reason, 180)
  if (!r || r.length < 12 || /not declared|read from what it did/i.test(r)) return ''
  const you = r
    .replace(/\b(the )?learner's\b|\btheir\b/gi, 'your').replace(/\b(the )?learner\b|\bthey\b/gi, 'you').replace(/\bthem\b/gi, 'you')
    .replace(/\byou (is|was|has|wants|asks|needs|keeps|seems|confuses|thinks|doesn't|does)\b/gi, (_, v: string) => `you ${({ is: 'are', was: 'were', has: 'have', wants: 'want', asks: 'ask', needs: 'need', keeps: 'keep', seems: 'seem', confuses: 'confuse', thinks: 'think', "doesn't": "don't", does: 'do' } as Record<string, string>)[v.toLowerCase()] ?? v}`)
  return sentence(`I chose this because ${lower1(you)}`)
}

/** Plain narration from the visuals' own content (no model). Always at least two sentences. */
export function narrationFromVisual(blocks: Block[], move?: MoveDecision | null): string {
  const ds = blocks.filter(isVisual).map(describeVisual).filter((d): d is NonNullable<ReturnType<typeof describeVisual>> => !!d).slice(0, 2)
  if (!ds.length) return ''
  const parts: string[] = []
  parts.push(sentence(`Here is ${ds[0].what}`))
  if (ds[0].beats.length) parts.push(ds[0].beats.length === 1 ? sentence(ds[0].beats[0]) : sentence(`It goes in order: ${list(ds[0].beats.map(lower1).map(x => x.replace(/[.!?]+$/, '')))}`))
  if (ds[1]) parts.push(sentence(`Below it is ${ds[1].what}`))
  const why = reasonLine(move)
  if (why) parts.push(why)
  parts.push(ds[0].hint ?? 'Look at it step by step, and ask me about any part that is not clear.')
  if (parts.length < 2) parts.push('Ask me about any part that is not clear.')
  return parts.filter(Boolean).join(' ').slice(0, 900)
}

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
      const desc = vis.map(describeVisual).filter(Boolean).map(d => `- ${d!.what}${d!.beats.length ? ` (in order: ${d!.beats.join(' / ')})` : ''}`).join('\n')
      const messages: Msg[] = [
        { role: 'system', content: 'You are GeniusMap, a warm tutor for a teenager in Nigeria. The visual below is already on the learner\'s screen. Write 2-3 short plain sentences that walk them through it in its order and say what to notice or do. Describe only what is listed. No greeting, no JSON, no lists, maths in $...$.' },
        { role: 'user', content: `Learner asked: <data>${clean(o.question, 400)}</data>\nOn screen now:\n${desc}${o.move?.reason ? `\nWhy the tutor chose it: ${clean(o.move.reason, 200)}` : ''}${o.already.trim() ? `\nAlready said: ${clean(o.already, 300)}` : ''}` },
      ]
      const r = await chat({ purpose: 'light', messages, maxTokens: 220, temperature: 0.4, trace: o.trace, deadline: Math.min(o.deadline ?? Infinity, Date.now() + 12_000), avoidSlots: o.avoidSlots })
      const t = r.text.split('\n').filter(l => !/^\s*(MOVE|DO)\s*:/i.test(l)).join(' ').replace(/```[\s\S]*?```/g, '').trim()
      if (proseWords(t) >= 10 && !/[{}]/.test(t)) { o.trace.push(`narration: model ${r.model}`); return { text: t.slice(0, 900), via: 'model' } }
      o.trace.push('narration: model reply too thin, using the visual')
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
  const lead = why === 'wrong_answer' ? 'Let us look at that one again together.' : why === 'worked_example' ? 'Here is a worked example.' : 'Let me show it another way.'
  const body = stage?.spec?.explain ? sentence(clean(stage.spec.explain, 200)) : stage?.caption ? sentence(stage.caption) : 'Follow it step by step and notice what changes.'
  const line = `${lead} ${sentence(`Look at ${what}`)} ${body}`.replace(/\s+/g, ' ').trim().slice(0, 390)
  target.say = target.say ? `${line} ${target.say}`.slice(0, 400) : line
  return 1
}

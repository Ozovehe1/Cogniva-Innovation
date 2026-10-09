/**
 * Adaptive prerequisite diagnostic (knowledge-space style, simplified).
 *
 * The AI builds a small prerequisite graph for the learner's goal (6-10 skills,
 * from just below their stated level up to the goal) with two multiple-choice
 * items per skill. The diagnostic then asks 8-15 items adaptively:
 *  - a confident correct answer marks the skill and everything under it as known;
 *  - a wrong answer (or "I don't know") marks the skill and everything that needs
 *    it as not known yet;
 *  - a correct guess asks the skill's second item before deciding.
 * Inferred states are then confirmed near the frontier until at least 8 items
 * have been asked. The result is "what you know now" (known) and "what's next"
 * (ready to learn: not known, every prerequisite known).
 *
 * Pure functions: safe on the server and in the browser. Answers live server-side only.
 */
import { normalizeMathText } from './math-text'
import { publicFigure, type ItemFigure } from './assessment/spec'

/** One question (the assessment item spec, src/lib/assessment/spec.ts, extends it). */
export interface DiagItem { q: string; options: string[]; answer: number; explain?: string; figure?: ItemFigure }
export interface DiagNode {
  id: string
  title: string
  summary: string
  prereqs: string[]
  /** Relative to the learner's stated level. */
  level: 'below' | 'at' | 'above'
  items: DiagItem[]
}
export interface DiagGraph { nodes: DiagNode[]; goalNode: string; subject: string; stem: boolean }

export type Confidence = 'guess' | 'fairly' | 'sure'
export interface DiagAnswer { node: string; item: number; choice: number | null; correct: boolean; confidence: Confidence | null; at: string; /** Time on the question (client-measured), for hesitation signals. */ ms?: number }
export type NodeState = 'known' | 'unknown'
export interface DiagState {
  asked: DiagAnswer[]
  /** Resolved state per node, and whether it was tested directly or inferred. */
  state: Record<string, { s: NodeState; tested: boolean }>
  /** Item currently shown to the learner. */
  current: { node: string; item: number } | null
  done: boolean
}

// v2 (docs/design/onboarding.md): adaptive testing reaches the same precision with roughly half the items, and the
// splitting rule below resolves most of an 8-10 skill map in 5-7 answers; extra confirmations were mostly padding.
export const MIN_ITEMS = 6
export const MAX_ITEMS = 10

export function emptyState(): DiagState {
  return { asked: [], state: {}, current: null, done: false }
}

function byId(g: DiagGraph) { return new Map(g.nodes.map(n => [n.id, n])) }

/** All prerequisites of a node, transitively. */
export function ancestors(g: DiagGraph, id: string): Set<string> {
  const m = byId(g); const out = new Set<string>(); const stack = [...(m.get(id)?.prereqs ?? [])]
  while (stack.length) { const x = stack.pop()!; if (out.has(x) || !m.has(x)) continue; out.add(x); stack.push(...(m.get(x)?.prereqs ?? [])) }
  return out
}

/** All nodes that need this one, transitively. */
export function descendants(g: DiagGraph, id: string): Set<string> {
  const out = new Set<string>(); let frontier = [id]
  while (frontier.length) {
    const next: string[] = []
    for (const n of g.nodes) if (!out.has(n.id) && n.prereqs.some(p => frontier.includes(p))) { out.add(n.id); next.push(n.id) }
    frontier = next
  }
  return out
}

/** Nodes in prerequisite order (Kahn); cycles are broken by original order. */
export function topoOrder(g: DiagGraph): DiagNode[] {
  const m = byId(g); const done = new Set<string>(); const out: DiagNode[] = []
  let guard = 0
  while (out.length < g.nodes.length && guard++ < 100) {
    let progressed = false
    for (const n of g.nodes) {
      if (done.has(n.id)) continue
      if (n.prereqs.every(p => done.has(p) || !m.has(p))) { done.add(n.id); out.push(n); progressed = true }
    }
    if (!progressed) { const n = g.nodes.find(x => !done.has(x.id))!; done.add(n.id); out.push(n) }
  }
  return out
}

/** Clean an AI-written graph: unique ids, known prereqs only, 2 valid items per node (none with noItems). */
export function cleanGraph(raw: unknown, fallbackSubject: string, opts: { noItems?: boolean } = {}): DiagGraph {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const nodesRaw = Array.isArray(r.nodes) ? r.nodes : []
  const nodes: DiagNode[] = []
  const seen = new Set<string>()
  for (const x of nodesRaw.slice(0, 12)) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    let id = typeof o.id === 'string' ? o.id.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40) : ''
    const title = typeof o.title === 'string' ? o.title.trim().slice(0, 90) : ''
    if (!title) continue
    if (!id || seen.has(id)) id = `n${nodes.length + 1}`
    seen.add(id)
    const items: DiagItem[] = []
    for (const it of Array.isArray(o.items) ? o.items : []) {
      if (!it || typeof it !== 'object') continue
      const q = (it as Record<string, unknown>).q
      const options = (it as Record<string, unknown>).options
      const answer = (it as Record<string, unknown>).answer
      if (typeof q !== 'string' || !Array.isArray(options) || typeof answer !== 'number') continue
      const opts = options.filter((s): s is string => typeof s === 'string' && !!s.trim()).map(s => s.trim().slice(0, 200)).slice(0, 5)
      if (opts.length < 3 || answer < 0 || answer >= opts.length || new Set(opts).size !== opts.length) continue
      const explain = (it as Record<string, unknown>).explain
      const o = it as Record<string, unknown>
      // Spec fields the gate added (figure, objective, difficulty, why) ride along with the item.
      items.push({ ...(o.figure && typeof o.figure === 'object' ? { figure: o.figure as ItemFigure } : {}), ...(typeof o.objective === 'string' ? { objective: o.objective } : {}), ...(typeof o.difficulty === 'number' ? { difficulty: o.difficulty } : {}), ...(o.verified === true ? { verified: true } : {}), q: q.trim().slice(0, 500), options: opts, answer: Math.floor(answer), explain: typeof explain === 'string' ? explain.slice(0, 400) : undefined } as DiagItem)
    }
    // A path planned without a check (learner new to the topic) has no question bank.
    if (items.length === 0 && !opts.noItems) continue
    const level = o.level === 'below' || o.level === 'above' ? o.level : 'at'
    nodes.push({ id, title, summary: typeof o.summary === 'string' ? o.summary.trim().slice(0, 300) : '', prereqs: Array.isArray(o.prereqs) ? o.prereqs.filter((p): p is string => typeof p === 'string') : [], level, items: items.slice(0, 3) })
  }
  const ids = new Set(nodes.map(n => n.id))
  for (const n of nodes) n.prereqs = [...new Set(n.prereqs.map(p => p.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')).filter(p => ids.has(p) && p !== n.id))]
  if (nodes.length < 3) throw new Error('The AI returned too small a skill map')
  let goalNode = typeof r.goalNode === 'string' ? r.goalNode.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-') : ''
  if (!ids.has(goalNode)) goalNode = topoOrder({ nodes, goalNode: '', subject: '', stem: false }).slice(-1)[0].id
  return {
    nodes, goalNode,
    subject: typeof r.subject === 'string' && r.subject.trim() ? r.subject.trim().slice(0, 60) : fallbackSubject,
    stem: r.stem === true,
  }
}

function itemsLeft(g: DiagGraph, st: DiagState, id: string) {
  const n = g.nodes.find(x => x.id === id)
  const used = new Set(st.asked.filter(a => a.node === id).map(a => a.item))
  return (n?.items ?? []).map((_, i) => i).filter(i => !used.has(i))
}

/** Which item to ask next, or null when the diagnostic is finished. */
export function nextItem(g: DiagGraph, st: DiagState): { node: string; item: number } | null {
  if (st.asked.length >= MAX_ITEMS) return null
  const order = topoOrder(g)
  const pos = new Map(order.map((n, i) => [n.id, i]))
  const last = st.asked[st.asked.length - 1]

  // A correct guess: confirm with the same skill's next item.
  if (last && last.correct && last.confidence === 'guess' && st.asked.filter(a => a.node === last.node).length === 1) {
    const left = itemsLeft(g, st, last.node)
    if (left.length) return { node: last.node, item: left[0] }
  }

  const unresolved = order.filter(n => !st.state[n.id])
  // A fast first win: open with a foundation skill (just below their level) that also splits the map well, so
  // the first answer is usually a confident success (lower threat, competence signal) without wasting a question.
  if (st.asked.length === 0) {
    const below = unresolved.filter(n => n.level === 'below' && itemsLeft(g, st, n.id).length)
    let first: DiagNode | null = null; let best = -Infinity
    for (const n of below) {
      const score = [...descendants(g, n.id)].length - (pos.get(n.id) ?? 0) * 0.01
      if (score > best) { best = score; first = n }
    }
    if (first) return { node: first.id, item: itemsLeft(g, st, first.id)[0] }
  }
  if (unresolved.length) {
    // Prefer the skill that splits the remaining graph best, nudged toward the stated level.
    const prior = (n: DiagNode) => (n.level === 'below' ? 0.7 : n.level === 'at' ? 0.5 : 0.3)
    let best: DiagNode | null = null; let bestScore = -Infinity
    for (const n of unresolved) {
      if (!itemsLeft(g, st, n.id).length) continue
      const up = [...ancestors(g, n.id)].filter(x => !st.state[x]).length
      const down = [...descendants(g, n.id)].filter(x => !st.state[x]).length
      const p = prior(n)
      // Expected number of nodes resolved by asking this one.
      const gain = p * (up + 1) + (1 - p) * (down + 1)
      const score = gain - Math.abs(p - 0.5) * 0.5 - (pos.get(n.id) ?? 0) * 0.01
      if (score > bestScore) { bestScore = score; best = n }
    }
    if (best) return { node: best.id, item: itemsLeft(g, st, best.id)[0] }
  }

  if (st.asked.length >= MIN_ITEMS) return null
  // Confirm inferred states near the frontier: untested known skills that ready skills depend on,
  // then a second item on tested frontier skills.
  const ready = new Set(readyToLearn(g, st))
  const frontierPrereqs = new Set<string>()
  for (const r of ready) for (const p of g.nodes.find(n => n.id === r)?.prereqs ?? []) frontierPrereqs.add(p)
  const candidates = [
    ...order.filter(n => st.state[n.id]?.s === 'known' && !st.state[n.id].tested && frontierPrereqs.has(n.id)),
    ...order.filter(n => st.state[n.id]?.s === 'known' && !st.state[n.id].tested),
    ...order.filter(n => ready.has(n.id)),
    ...order.filter(n => frontierPrereqs.has(n.id)),
    ...order.filter(n => st.state[n.id]?.s === 'known'),
    // Still short of the minimum: confirm misses with a second item, then the nearest inferred gaps.
    ...order.filter(n => st.state[n.id]?.s === 'unknown' && st.state[n.id].tested),
    ...order.filter(n => st.state[n.id]?.s === 'unknown' && !st.state[n.id].tested),
  ]
  for (const n of candidates) {
    const left = itemsLeft(g, st, n.id)
    if (left.length) return { node: n.id, item: left[0] }
  }
  return null
}

/** Record an answer and update the knowledge state. */
export function applyAnswer(g: DiagGraph, st: DiagState, ans: Omit<DiagAnswer, 'at'>): DiagState {
  const next: DiagState = { ...st, asked: [...st.asked, { ...ans, at: new Date().toISOString() }], state: { ...st.state } }
  const prevForNode = st.asked.filter(a => a.node === ans.node)
  const strongCorrect = ans.correct && ans.confidence !== 'guess'
  const confirmedGuess = ans.correct && prevForNode.some(a => a.correct)
  if (strongCorrect || confirmedGuess) {
    next.state[ans.node] = { s: 'known', tested: true }
    for (const a of ancestors(g, ans.node)) if (!next.state[a] || !next.state[a].tested) next.state[a] = { s: 'known', tested: next.state[a]?.tested ?? false }
  } else if (ans.correct && ans.confidence === 'guess' && prevForNode.length === 0 && itemsLeft(g, next, ans.node).length) {
    // Undecided: the next call asks the second item.
  } else if (!ans.correct) {
    next.state[ans.node] = { s: 'unknown', tested: true }
    for (const d of descendants(g, ans.node)) if (!next.state[d]?.tested) next.state[d] = { s: 'unknown', tested: false }
  } else {
    // Correct guess with no second item, or a guess after a wrong answer: count as not known yet.
    next.state[ans.node] = { s: 'unknown', tested: true }
  }
  next.current = nextItem(g, next)
  next.done = next.current === null
  return next
}

export function knownSkills(g: DiagGraph, st: DiagState): string[] {
  return topoOrder(g).filter(n => st.state[n.id]?.s === 'known').map(n => n.id)
}

/** Not known, and every prerequisite known. Unresolved skills count as not known. */
export function readyToLearn(g: DiagGraph, st: DiagState): string[] {
  const known = new Set(knownSkills(g, st))
  const order = topoOrder(g)
  const ready = order.filter(n => !known.has(n.id) && n.prereqs.every(p => known.has(p))).map(n => n.id)
  if (ready.length) return ready
  // Everything is known: the goal itself is the next step (practice and extension).
  return [g.goalNode]
}

/** A path planned without a check (new to the topic): the first few skills in learning order, from the very first. */
export function firstSkills(g: DiagGraph, n = 3): string[] {
  const onPath = new Set([...ancestors(g, g.goalNode), g.goalNode])
  return topoOrder(g).filter(x => onPath.has(x.id)).slice(0, n).map(x => x.id)
}

/** Client-safe view of the current item (no answer). */
export function publicItem(g: DiagGraph, st: DiagState) {
  if (!st.current) return null
  const n = g.nodes.find(x => x.id === st.current!.node)
  const it = n?.items[st.current.item]
  if (!n || !it) return null
  // Normalised on read: older stored items may hold bare or broken LaTeX.
  return { node: n.id, topic: normalizeMathText(n.title), item: st.current.item, q: normalizeMathText(it.q), options: it.options.map(o => normalizeMathText(o)), figure: publicFigure(it.figure), number: st.asked.length + 1 }
}

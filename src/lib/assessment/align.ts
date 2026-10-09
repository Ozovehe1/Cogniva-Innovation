/**
 * Alignment (docs/design/assessment.md §3): an item may only assess what the tutor actually taught this learner, in
 * the same notation, terms, methods, representations and diagram style. "Taught" is read from the lesson itself
 * (its steps: narration, board text, maths, checks, figures) or from the lesson digest used by the mastery writer.
 *
 * Deterministic and pure (no model): safe anywhere.
 */
import type { Step } from '../lesson-schema'
import { toPlainText } from '../math-text'
import type { AssessItem } from './spec'

export interface Taught {
  /** Plain text of what was taught (narration, board, maths), lower-cased. */
  text: string
  /** Lesson aims / key ideas when known. */
  objectives: string[]
  /** Word stems used in the lesson. */
  vocab: Set<string>
  /** Notation used: TeX commands for quantities (\mu, \chi, \omega), sub/superscripted symbols (V_{out}), units. */
  symbols: Set<string>
  /** Representations the lesson used for pictures. */
  figureKinds: Set<'graph' | 'diagram' | 'illustration' | 'interactive' | 'drawing'>
  /** Labels on the lesson's figures and board (point names, part names). */
  labels: Set<string>
}

export interface AlignFinding { code: 'untaught-notation' | 'untaught-terms' | 'objective-not-taught' | 'no-objective' | 'figure-style' | 'figure-labels'; severity: 'block' | 'warn'; detail: string }

/* ───────────── what was taught ───────────── */

const STRUCT_TEX = new Set(['frac', 'dfrac', 'tfrac', 'sqrt', 'times', 'cdot', 'div', 'left', 'right', 'text', 'mathrm', 'textrm', 'mathbf', 'quad', 'qquad', 'approx', 'neq', 'leq', 'geq', 'le', 'ge', 'pm', 'mp', 'circ', 'degree', 'implies', 'Rightarrow', 'rightarrow', 'to', 'infty', 'ldots', 'dots', 'cdots', 'begin', 'end', 'hline', 'boxed', 'overline', 'underline', 'hat', 'vec', 'bar', 'dot', 'prime', 'displaystyle', 'operatorname', 'mbox', 'big', 'Big', 'bigg', 'Bigg', 'equiv', 'sim', 'propto', 'percent', 'unit', 'lt', 'gt'])

/** Quantity notation in a piece of text: \commands that are symbols (greek letters, operators like \sum, \int). */
const GREEK: Record<string, string> = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω' }

export function notationOf(text: string): Set<string> {
  const out = new Set<string>()
  // Greek letters compare as letters whether written \mu or μ (digests carry plain text, items carry TeX).
  for (const m of text.matchAll(/\\([a-zA-Z]+)/g)) if (!STRUCT_TEX.has(m[1])) out.add(GREEK[m[1]] ?? '\\' + m[1])
  // π is a number, not notation a lesson has to introduce.
  out.delete('π')
  // Unicode greek used directly.
  for (const m of text.matchAll(/[\u0391-\u03c9]/g)) if (m[0] !== 'π') out.add(m[0])
  return out
}

const stem = (w: string) => w.toLowerCase().replace(/(?:ies)$/, 'y').replace(/(?:es|s|ed|ing|ly)$/, '').slice(0, 9)
export const wordsOf = (text: string) => (toPlainText(text).toLowerCase().match(/[a-z][a-z'-]{1,}/g) ?? [])

/** Everyday and question words (7+ letters) that are never "untaught terms". */
const COMMON = new Set(`ability absolute account actually addition address advance against already although amount another anything appear applied apply approach approximately around arrange arrangement article attention available average balance battery because become becomes before beginning behind believe belongs between bottom breakfast brother building business calculate calculated calculation capacity carefully centimetre centimetres certain chance change changes chapter cheaper children choice choose circle clearly closest collect college combine company compare compared complete completely computer condition connect consider contain container contains continue correct correctly costs country course create current customer daily decide decrease deeper describe description determine difference different difficult direction distance divide divided double during earlier easiest eighteen eleven energy enough entire equation equals equivalent estimate evening everyone everything exactly example examples expect explain expression farmer farther fifteen figure final finally finish follow following football forward fourteen friend friends further garden general getting given gives greater greatest ground growth happen happens height highest however hundred identify imagine important include including increase increases information inside instead interest interval kilogram kilograms kilometre kilometres kitchen largest learner learning length lesson letter levels likely litres longer longest machine market measure measured measurement method metres middle million minute minutes missing morning mother multiply multiplied natural nearest negative network nothing number numbers object offers option options order original others outside overall package passes pattern people percent perhaps period person picture placed player players pocket position positive possible practice predict present pressure previous probably problem problems produce product property quantity question questions quickly rather reaches reading reason recorded rectangle reduce relationship remaining remember result results return school second seconds section separate several shared shopping should showing similar simple simplest single smaller smallest someone something sometimes special speed spend square standard started station statement straight student students subtract subtracted suppose surface system teacher temperature thousand through together tomorrow total towards travel triangle twelve twenty typical usually value values variable various vehicle weight whether which within without worked working writes written yesterday represent represents matches matching context depends describes describe statement statements correct incorrect happens happened explains explanation results suitable options following describes compared minimum maximum consider considered remains unchanged greater increases decreases`.split(/\s+/).map(stem))

export function taughtFromText(text: string, objectives: string[] = []): Taught {
  const plain = toPlainText(text).toLowerCase()
  const t: Taught = { text: plain, objectives, vocab: new Set(wordsOf(text).map(stem)), symbols: notationOf(text), figureKinds: new Set(), labels: new Set() }
  if (/\b(graph|axes|plot|curve|parabola)\b/.test(plain)) t.figureKinds.add('graph')
  if (/\b(diagram|venn|triangle|angle|construction|vector)\b/.test(plain)) t.figureKinds.add('diagram')
  if (/\b(picture|illustration|labelled)\b/.test(plain)) t.figureKinds.add('illustration')
  for (const o of objectives) for (const w of wordsOf(o)) t.vocab.add(stem(w))
  return t
}

/** What a lesson taught, from its own steps (narration, board, maths, figures, earlier checks). */
export function taughtFromSteps(steps: Step[], objectives: string[] = []): Taught {
  const parts: string[] = []
  const kinds = new Set<Taught['figureKinds'] extends Set<infer K> ? K : never>()
  const labels = new Set<string>()
  const walk = (s: Step) => {
    const o = s as unknown as Record<string, unknown>
    for (const k of ['say', 'text', 'tex', 'prompt', 'explanation', 'label', 'title', 'alt']) if (typeof o[k] === 'string') parts.push(o[k] as string)
    if (Array.isArray(o.options)) parts.push(...(o.options as unknown[]).filter((x): x is string => typeof x === 'string'))
    const shape = (o.shape ?? null) as Record<string, unknown> | null
    if (s.type === 'stage' || (s.type === 'check' && o.figure)) {
      kinds.add('interactive'); kinds.add('graph')
      const spec = (s.type === 'stage' ? o.spec : o.figure) as Record<string, unknown> | undefined
      for (const p of [...((spec?.points as Record<string, unknown>[]) ?? []), ...((spec?.gliders as Record<string, unknown>[]) ?? [])]) { if (typeof p.name === 'string') labels.add(p.name); if (typeof p.label === 'string') labels.add(p.label) }
      if (typeof spec?.title === 'string') parts.push(spec.title as string)
    }
    if (shape) {
      const k = String(shape.kind ?? '')
      if (k === 'figure') kinds.add(typeof shape.src === 'string' ? 'illustration' : 'diagram')
      else if (/axes|plot|curve|function/.test(k)) kinds.add('graph')
      else if (k) kinds.add('drawing')
      for (const key of ['label', 'text', 'alt']) if (typeof shape[key] === 'string') { parts.push(shape[key] as string); if (key === 'label') labels.add(shape[key] as string) }
    }
    if (s.type === 'draw' && /axes/.test(String(shape?.kind ?? ''))) kinds.add('graph')
    if (s.type === 'check' && Array.isArray(o.reteach)) (o.reteach as Step[]).forEach(walk)
  }
  steps.forEach(walk)
  const t = taughtFromText(parts.join('\n'), objectives)
  for (const k of kinds) t.figureKinds.add(k)
  for (const l of labels) t.labels.add(l)
  return t
}

/** Objectives out of a lesson digest ("aim: …" in its head, "Key idea:" lines). */
export function objectivesFromDigest(digest: string): string[] {
  const out: string[] = []
  for (const m of digest.matchAll(/\(aim: ([^)]+)\)/g)) out.push(m[1])
  for (const m of digest.matchAll(/(?:key idea|objective|aim|goal)s?:\s*([^\n]+)/gi)) out.push(m[1])
  for (const m of digest.matchAll(/^\s*(?:beat|section)[^:]*:\s*([^\n]{8,120})/gim)) out.push(m[1])
  return [...new Set(out.map(s => s.trim()).filter(Boolean))].slice(0, 20)
}

/* ───────────── checking an item against it ───────────── */

const contentWords = (s: string) => wordsOf(s).filter(w => w.length >= 4).map(stem).filter(w => !COMMON.has(w))

/** Untaught technical words in a piece of item text (7+ letter content words the lesson never used). */
export function untaughtTerms(text: string, taught: Taught): string[] {
  const seen = new Set<string>()
  for (const w of wordsOf(text)) {
    if (w.length < 7) continue
    const s = stem(w)
    if (COMMON.has(s) || taught.vocab.has(s) || taught.text.includes(w.slice(0, 5))) continue
    seen.add(w)
  }
  return [...seen]
}

export function alignItem(item: AssessItem, taught: Taught): AlignFinding[] {
  const out: AlignFinding[] = []
  const all = [item.q, ...item.options, item.explain ?? ''].join('\n')
  // 1. Notation: every quantity symbol must be one the lesson used.
  const unknown = [...notationOf(all)].filter(s => !taught.symbols.has(s))
  if (unknown.length) out.push({ code: 'untaught-notation', severity: 'block', detail: `uses notation the lesson did not use: ${unknown.slice(0, 4).join(', ')}` })
  // 2. Terms: technical words the lesson never said (a distractor with an unfamiliar word is also a cue).
  const terms = untaughtTerms([item.q, ...item.options].join(' '), taught)
  if (terms.length >= 3) out.push({ code: 'untaught-terms', severity: 'block', detail: `uses terms the lesson did not teach: ${terms.slice(0, 5).join(', ')}` })
  else if (terms.length) out.push({ code: 'untaught-terms', severity: 'warn', detail: `terms not in the lesson: ${terms.join(', ')}` })
  // 3. Objective: it must be one the lesson taught.
  if (item.objective) {
    const ow = contentWords(item.objective)
    const covered = ow.filter(w => taught.vocab.has(w)).length
    const match = taught.objectives.some(o => { const tw = new Set(contentWords(o)); return ow.filter(w => tw.has(w)).length >= Math.max(1, Math.ceil(ow.length * 0.4)) })
    if (ow.length && !match && covered < Math.ceil(ow.length * 0.6)) out.push({ code: 'objective-not-taught', severity: 'block', detail: `objective "${item.objective.slice(0, 80)}" is not something the lesson taught` })
  } else out.push({ code: 'no-objective', severity: 'warn', detail: 'no objective given' })
  // 4. Representation: a figure in the item uses a kind of picture the lesson used (graph for graphs, diagram for diagrams).
  const f = item.figure
  if (f && taught.figureKinds.size) {
    const ok = f.kind === 'graph' ? taught.figureKinds.has('graph') || taught.figureKinds.has('interactive')
      : f.kind === 'diagram' ? taught.figureKinds.has('diagram') || taught.figureKinds.has('drawing')
      : taught.figureKinds.has('illustration') || taught.figureKinds.has('diagram')
    if (!ok) out.push({ code: 'figure-style', severity: 'warn', detail: `the item uses a ${f.kind} but the lesson showed ${[...taught.figureKinds].join('/')}` })
  }
  return out
}

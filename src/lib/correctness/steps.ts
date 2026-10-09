/**
 * Correctness guard for board/lesson steps, before a learner sees them. Deterministic and fast (no model call):
 *   maths       numeric claims in narration, board text, TeX lines and explanations (claims.ts): corrected in place
 *               when the fix is unambiguous, else reported so the generator regenerates
 *   answer-leak a check whose answer is stated before the learner answers (in the check's narration, its prompt or the
 *               step just before it): the leaking sentence is removed from narration; a leaking prompt is reported
 *   pythagoras  a right triangle whose three numeric side labels break a² + b² = c², or whose labels sit on sides of
 *               the wrong relative length
 *   refraction  a refracted ray on the same side of the normal as the incident ray, back in the first medium, or bent
 *               the wrong way for the media named on the board (into glass/water bends towards the normal)
 *   vectors     a resultant whose endpoints are not the head-to-tail (or parallelogram) sum of the two vectors
 *   circle      a circle on axes with unequal x/y units (drawn as an ellipse): the axes ranges are evened out
 *   venn        region counts that do not match the stated problem ("20 play football, 15 chess, 6 both" → 14 / 6 / 9)
 */
import type { CheckStep, DrawStep, Step } from '../lesson-schema'
import { correctText, formatNumber } from './claims'

export type GuardKind = 'maths' | 'answer-leak' | 'pythagoras' | 'refraction' | 'vectors' | 'circle-ellipse' | 'venn'
export interface GuardIssue { kind: GuardKind; step: number; detail: string; fixed: boolean }
export interface GuardResult { steps: Step[]; issues: GuardIssue[]; claims: number }

type P = [number, number]
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null)
const pt = (p: unknown): P | null => (Array.isArray(p) && p.length === 2 && num(p[0]) !== null && num(p[1]) !== null ? [num(p[0])!, num(p[1])!] : null)
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]]
const len = (a: P) => Math.hypot(a[0], a[1])
const dist = (a: P, b: P) => len(sub(a, b))
const cross = (a: P, b: P) => a[0] * b[1] - a[1] * b[0]
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1]
const mid = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

/* ───────────── Text claims ───────────── */

function fixField(s: string | undefined, tex: boolean, at: number, where: string, issues: GuardIssue[], counter: { n: number }): string | undefined {
  if (!s || !/\d/.test(s) || !/[=≈]|\\approx|\bof\b/.test(s)) return s
  const r = correctText(s, { tex })
  counter.n += r.claims
  for (const f of r.fixed) issues.push({ kind: 'maths', step: at, detail: `${where}: ${f.source} → ${formatNumber(f.computed)}`, fixed: true })
  for (const u of r.unfixed) issues.push({ kind: 'maths', step: at, detail: `${where}: ${u.source}${Number.isFinite(u.computed) ? ` (is ${formatNumber(u.computed)})` : ' does not satisfy the equations stated'}`, fixed: false })
  return r.text
}

/* ───────────── Answer leaks ───────────── */

const REVEAL = /\b(answer|solution|result|equals|gives|get|so|therefore|thus|that's|it's|is|makes|comes to)\b|=/i
function sentences(s: string) { return s.match(/[^.!?]+[.!?]*/g) ?? [s] }
function normTok(s: string) { return s.toLowerCase().replace(/\$|\\,|\s+/g, ' ').replace(/[“”"']/g, '').trim() }
export function answerOf(c: CheckStep): string | null {
  if (c.kind === 'choice' && Array.isArray(c.options) && typeof c.answer === 'number') return c.options[c.answer] ?? null
  if (c.kind === 'short' && c.accept?.length) return c.accept[0]
  if (c.kind === 'explore' && c.goal) return String(c.goal.equals)
  return null
}
function mentions(sentence: string, answer: string): boolean {
  const a = normTok(answer)
  if (!a) return false
  const s = normTok(sentence)
  // A number counts as stated only when it is the result: "= 5", "is 5", "answer is x = 5", "gives 5".
  if (/^-?\d+(\.\d+)?$/.test(a)) return new RegExp(`(=|\\bis\\b|\\banswer\\b[^.\\d]{0,12}|\\bgives\\b|\\bget\\b|\\bmakes\\b|\\bequals\\b)\\s*(\\w\\s*=\\s*)?${a.replace('.', '\\.')}(?![\\d]|\\.\\d)`).test(s)
  if (a.length < 3) return false
  return s.includes(a)
}
/** Sentences that state the check's answer before the learner has answered. */
export function leakIn(text: string | undefined, answer: string, question = false): string[] {
  if (!text) return []
  return sentences(text).filter(sn => mentions(sn, answer) && REVEAL.test(sn) && !(question && /\?\s*$/.test(sn.trim())))
}

/* ───────────── Geometry helpers ───────────── */

interface Label { text: string; at: P; step: number }
function labels(steps: Step[]): Label[] {
  const out: Label[] = []
  steps.forEach((s, i) => {
    if (s.type === 'write' || s.type === 'math') {
      const text = s.type === 'write' ? s.text : s.tex
      const w = Math.min(260, text.length * (s.size === 'lg' ? 13 : s.size === 'sm' ? 7 : 9.5))
      const cx = s.align === 'center' ? s.x : s.align === 'right' ? s.x - w / 2 : s.x + w / 2
      out.push({ text, at: [cx, s.y + 10], step: i })
    } else if (s.type === 'draw' && s.shape.kind === 'point' && s.shape.label) {
      const p = pt(s.shape.at)
      if (p) out.push({ text: s.shape.label, at: p, step: i })
    }
  })
  return out
}
const nearest = (ls: Label[], p: P, max: number, filter: (l: Label) => boolean = () => true) =>
  ls.filter(filter).map(l => ({ l, d: dist(l.at, p) })).filter(x => x.d <= max).sort((a, b) => a.d - b.d)[0]?.l ?? null
const numberIn = (t: string) => { const m = /(-?\d+(?:\.\d+)?)/.exec(t.replace(/\\text\{[^}]*\}/g, '')); return m ? Number(m[1]) : null }

interface Seg { a: P; b: P; step: number; id?: string; arrow: boolean; dashed: boolean; on?: string }
function segs(steps: Step[]): Seg[] {
  const out: Seg[] = []
  steps.forEach((s, i) => {
    if (s.type !== 'draw') return
    const sh = s.shape
    if (sh.kind === 'line' || sh.kind === 'arrow') {
      const a = pt(sh.from), b = pt(sh.to)
      if (a && b && dist(a, b) > 1e-6) out.push({ a, b, step: i, id: s.id, arrow: sh.kind === 'arrow', dashed: !!s.dashed, on: s.on })
    }
  })
  return out
}

/* ───────────── Pythagoras ───────────── */

function triangles(steps: Step[]): { pts: P[]; step: number }[] {
  const out: { pts: P[]; step: number }[] = []
  steps.forEach((s, i) => {
    if (s.type === 'draw' && s.shape.kind === 'polygon' && s.shape.points.length === 3) {
      const pts = s.shape.points.map(pt)
      if (pts.every(Boolean)) out.push({ pts: pts as P[], step: i })
    }
  })
  // Three lines closing a triangle.
  const ls = segs(steps).filter(x => !x.arrow)
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) for (let k = j + 1; k < ls.length; k++) {
    const ends = [ls[i], ls[j], ls[k]].flatMap(s => [s.a, s.b])
    const uniq: P[] = []
    for (const e of ends) if (!uniq.some(u => dist(u, e) < 4)) uniq.push(e)
    if (uniq.length === 3 && ends.every(e => uniq.filter(u => dist(u, e) < 4).length === 1)) out.push({ pts: uniq, step: Math.max(ls[i].step, ls[j].step, ls[k].step) })
  }
  return out
}

function checkPythagoras(steps: Step[], issues: GuardIssue[], allText: string) {
  if (!/pythag|hypotenuse|right[- ]angled? triangle/i.test(allText)) return
  const ls = labels(steps)
  for (const t of triangles(steps)) {
    const [A, B, C] = t.pts
    const sides: { p: P; q: P; opp: P }[] = [{ p: B, q: C, opp: A }, { p: A, q: C, opp: B }, { p: A, q: B, opp: C }]
    const lens = sides.map(s => dist(s.p, s.q))
    const angleAt = (v: P, o1: P, o2: P) => Math.acos(Math.max(-1, Math.min(1, dot(sub(o1, v), sub(o2, v)) / (len(sub(o1, v)) * len(sub(o2, v)))))) * 180 / Math.PI
    const angles = [angleAt(A, B, C), angleAt(B, A, C), angleAt(C, A, B)]
    const right = angles.findIndex(a => Math.abs(a - 90) < 2.5)
    // A numeric label per side: the nearest label to the side's midpoint, and nearer that side than the others.
    const vals = sides.map((s, k) => {
      const m = mid(s.p, s.q)
      const l = nearest(ls, m, Math.max(60, lens[k] * 0.6), x => numberIn(x.text) !== null && !/°|\\circ|deg/.test(x.text))
      if (!l) return null
      const dOwn = dist(l.at, m)
      if (sides.some((o, j) => j !== k && dist(l.at, mid(o.p, o.q)) < dOwn - 1)) return null
      return numberIn(l.text)
    })
    if (right < 0 || vals.filter(v => v !== null && v > 0).length < 3) continue
    const v = vals as number[]
    if (right >= 0) {
      const hyp = v[right]
      const legs = v.filter((_, k) => k !== right)
      const ok = Math.abs(legs[0] ** 2 + legs[1] ** 2 - hyp ** 2) <= 0.02 * hyp ** 2
      if (!ok) issues.push({ kind: 'pythagoras', step: t.step, detail: `right triangle labelled ${legs[0]}, ${legs[1]} and hypotenuse ${hyp}: ${legs[0]}² + ${legs[1]}² = ${formatNumber(legs[0] ** 2 + legs[1] ** 2)}, not ${formatNumber(hyp ** 2)}`, fixed: false })
      else if (Math.max(...v) !== hyp) issues.push({ kind: 'pythagoras', step: t.step, detail: `the longest label (${Math.max(...v)}) is not on the hypotenuse`, fixed: false })
    }
    // Labels must order like the drawn sides (a 5 on the shortest side reads wrong).
    const byLen = [0, 1, 2].sort((a, b) => lens[a] - lens[b]), byVal = [0, 1, 2].sort((a, b) => v[a] - v[b])
    const ratio = v.map((x, k) => x / lens[k])
    const spread = Math.max(...ratio) / Math.min(...ratio)
    if (byLen.join() !== byVal.join() && spread > 1.35) issues.push({ kind: 'pythagoras', step: t.step, detail: `side labels ${v.join(', ')} do not match the drawn side lengths (${lens.map(x => Math.round(x)).join(', ')})`, fixed: false })
  }
}

/* ───────────── Refraction ───────────── */

const ROLE = { incident: /incident|incoming|\bi\b|in ray/i, refracted: /refract|\br\b|bent ray|out ray/i, normal: /normal/i }
function roleOf(s: Seg, ls: Label[]): keyof typeof ROLE | null {
  const id = s.id ?? ''
  for (const k of ['normal', 'refracted', 'incident'] as const) if (ROLE[k].test(id.replace(/[_-]/g, ' '))) return k
  const l = nearest(ls, mid(s.a, s.b), 120, x => /incident|refract|normal|ray/i.test(x.text))
  if (l) for (const k of ['normal', 'refracted', 'incident'] as const) if (ROLE[k].test(l.text)) return k
  return null
}
function checkRefraction(steps: Step[], issues: GuardIssue[], allText: string) {
  if (!/refract|snell|normal|glass|prism/i.test(allText)) return
  const ls = labels(steps)
  const all = segs(steps)
  const role = all.map(s => ({ s, r: roleOf(s, ls) }))
  const inc = role.find(x => x.r === 'incident')?.s, ref = role.find(x => x.r === 'refracted')?.s
  let nor = role.find(x => x.r === 'normal')?.s
  if (!inc || !ref) return
  // The point of incidence: where the incident ray ends and the refracted ray starts.
  const ends: [P, P][] = [[inc.b, ref.a], [inc.b, ref.b], [inc.a, ref.a], [inc.a, ref.b]]
  const [pair] = ends.map(([x, y]) => ({ x, y, d: dist(x, y) })).sort((a, b) => a.d - b.d)
  if (pair.d > 16) return
  const P0 = pair.x
  const A = dist(inc.a, P0) < dist(inc.b, P0) ? inc.b : inc.a
  const B = dist(ref.a, pair.y) < dist(ref.b, pair.y) ? ref.b : ref.a
  if (!nor) nor = all.find(s => s.dashed && s !== inc && s !== ref && Math.abs(cross(sub(s.b, s.a), sub(P0, s.a))) / len(sub(s.b, s.a)) < 8)
  if (!nor) return
  const n = sub(nor.b, nor.a)
  const nu: P = [n[0] / len(n), n[1] / len(n)]
  const a = sub(A, P0), b = sub(B, P0)
  const sideNormalA = Math.sign(cross(nu, a)), sideNormalB = Math.sign(cross(nu, b))
  const sideSurfA = Math.sign(dot(nu, a)), sideSurfB = Math.sign(dot(nu, b))
  if (sideSurfA !== 0 && sideSurfA === sideSurfB) { issues.push({ kind: 'refraction', step: ref.step, detail: 'the refracted ray stays in the first medium (it should cross the boundary)', fixed: false }); return }
  if (sideNormalA !== 0 && sideNormalA === sideNormalB) { issues.push({ kind: 'refraction', step: ref.step, detail: 'the refracted ray is on the same side of the normal as the incident ray (it should continue to the other side)', fixed: false }); return }
  const th1 = Math.acos(Math.abs(dot(nu, a)) / len(a)) * 180 / Math.PI, th2 = Math.acos(Math.abs(dot(nu, b)) / len(b)) * 180 / Math.PI
  // Which medium is on which side: labels in each half-plane of the boundary.
  const dense = /glass|water|perspex|prism|block|denser|diamond|oil/i, rare = /\bair\b|vacuum|less dense/i
  const sideOf = (l: Label) => Math.sign(dot(nu, sub(l.at, P0)))
  const medA = ls.filter(l => sideOf(l) === sideSurfA).map(l => l.text).join(' '), medB = ls.filter(l => sideOf(l) === sideSurfB).map(l => l.text).join(' ')
  const intoDenser = rare.test(medA) && dense.test(medB) && !dense.test(medA)
  const intoRarer = dense.test(medA) && rare.test(medB) && !dense.test(medB)
  if (intoDenser && th2 >= th1 - 1) issues.push({ kind: 'refraction', step: ref.step, detail: `going into the denser medium the ray must bend towards the normal (drawn ${Math.round(th1)}° → ${Math.round(th2)}°)`, fixed: false })
  if (intoRarer && th2 <= th1 + 1) issues.push({ kind: 'refraction', step: ref.step, detail: `going into the less dense medium the ray must bend away from the normal (drawn ${Math.round(th1)}° → ${Math.round(th2)}°)`, fixed: false })
}

/** Snell's law in text: "n1 = 1, θ1 = 30°, n2 = 1.5, θ2 = 19.5°". */
function checkSnellText(text: string, issues: GuardIssue[]) {
  const g = (re: RegExp) => { const m = re.exec(text); return m ? Number(m[1]) : null }
  const n1 = g(/n_?\{?1\}?\s*=\s*(\d+(?:\.\d+)?)/), n2 = g(/n_?\{?2\}?\s*=\s*(\d+(?:\.\d+)?)/)
  const t1 = g(/(?:θ|\\theta)_?\{?1\}?\s*=\s*(\d+(?:\.\d+)?)/), t2 = g(/(?:θ|\\theta)_?\{?2\}?\s*=\s*(\d+(?:\.\d+)?)/)
  if ([n1, n2, t1, t2].some(v => v === null)) return
  const lhs = n1! * Math.sin(t1! * Math.PI / 180), rhs = n2! * Math.sin(t2! * Math.PI / 180)
  const want = Math.asin(Math.min(1, lhs / n2!)) * 180 / Math.PI
  if (Math.abs(lhs - rhs) > 0.02 * Math.max(lhs, rhs)) issues.push({ kind: 'refraction', step: -1, detail: `Snell's law: ${n1} sin ${t1}° ≠ ${n2} sin ${t2}° (θ2 should be ${formatNumber(want, 1)}°)`, fixed: false })
}

/* ───────────── Vectors ───────────── */

function checkVectors(steps: Step[], issues: GuardIssue[], allText: string) {
  if (!/vector|resultant|displacement|force|velocity|head.to.tail/i.test(allText)) return
  const ls = labels(steps)
  const arrows = segs(steps).filter(s => s.arrow)
  if (arrows.length !== 3 || new Set(arrows.map(a => a.on ?? '')).size !== 1) return
  // Jumps along a number line are not a vector sum.
  if (arrows.every(a => Math.abs(cross(sub(a.b, a.a), sub(arrows[0].b, arrows[0].a))) < 1e-6 * Math.max(1, len(sub(a.b, a.a)) * len(sub(arrows[0].b, arrows[0].a))))) return
  const isSum = (s: Seg) => /\+|resultant|sum|\bR\b/.test(`${s.id ?? ''} ${nearest(ls, mid(s.a, s.b), 90)?.text ?? ''}`)
  const res = arrows.filter(isSum)
  if (res.length !== 1) return
  const R = res[0]
  const [u, v] = arrows.filter(s => s !== R)
  const tol = 0.06 * Math.max(dist(u.a, u.b), dist(v.a, v.b), dist(R.a, R.b)) + 3
  const sumTo = (x: Seg, y: Seg): P => [x.a[0] + (x.b[0] - x.a[0]) + (y.b[0] - y.a[0]), x.a[1] + (x.b[1] - x.a[1]) + (y.b[1] - y.a[1])]
  const headToTail = (x: Seg, y: Seg) => dist(x.b, y.a) <= tol && dist(R.a, x.a) <= tol && dist(R.b, y.b) <= tol
  const parallelogram = dist(u.a, v.a) <= tol && dist(R.a, u.a) <= tol && dist(R.b, sumTo(u, v)) <= tol
  if (headToTail(u, v) || headToTail(v, u) || parallelogram) return
  const want = dist(u.b, v.a) <= tol ? sumTo(u, v) : dist(v.b, u.a) <= tol ? sumTo(v, u) : sumTo(u, v)
  const from = dist(u.b, v.a) <= tol ? u.a : dist(v.b, u.a) <= tol ? v.a : u.a
  issues.push({ kind: 'vectors', step: R.step, detail: `the resultant runs ${fmtP(R.a)} → ${fmtP(R.b)} but the sum of the two vectors runs ${fmtP(from)} → ${fmtP(want)}`, fixed: false })
}
const fmtP = (p: P) => `(${formatNumber(p[0], 1)}, ${formatNumber(p[1], 1)})`

/* ───────────── Circles on axes ───────────── */

function fixCircleAxes(steps: Step[], issues: GuardIssue[]): Step[] {
  const onAxes = new Set(steps.filter((s): s is DrawStep => s.type === 'draw' && s.shape.kind === 'circle' && !!s.on).map(s => s.on!))
  if (!onAxes.size) return steps
  return steps.map((s, i) => {
    if (s.type !== 'draw' || s.shape.kind !== 'axes' || !s.id || !onAxes.has(s.id)) return s
    const { frame, xRange, yRange } = s.shape
    const ux = frame.w / (xRange[1] - xRange[0]), uy = frame.h / (yRange[1] - yRange[0])
    if (!(ux > 0 && uy > 0) || Math.abs(ux / uy - 1) < 0.03) return s
    // Only a real circle shows the squash (a small dot on a number line does not).
    const rmax = Math.max(0, ...steps.filter((c): c is DrawStep => c.type === 'draw' && c.on === s.id && c.shape.kind === 'circle').map(c => (c.shape as { r: number }).r * Math.min(ux, uy)))
    if (rmax < 24) return s
    // Even out the units by widening the range of the more stretched axis (everything stays in graph units).
    let xr: [number, number] = [...xRange], yr: [number, number] = [...yRange]
    if (ux > uy) { const span = frame.w / uy, c = (xRange[0] + xRange[1]) / 2; xr = [c - span / 2, c + span / 2] }
    else { const span = frame.h / ux, c = (yRange[0] + yRange[1]) / 2; yr = [c - span / 2, c + span / 2] }
    issues.push({ kind: 'circle-ellipse', step: i, detail: `axes ${s.id} had unequal units (${ux.toFixed(1)} vs ${uy.toFixed(1)} px per unit): a circle on it drew as an ellipse; ranges evened out`, fixed: true })
    return { ...s, shape: { ...s.shape, xRange: xr.map(v => Number(v.toFixed(4))) as [number, number], yRange: yr.map(v => Number(v.toFixed(4))) as [number, number] } }
  })
}

/* ───────────── Venn counts ───────────── */

/** "20 students play football, 15 play chess and 6 play both" → { a: 20, b: 15, both: 6, words }. */
export function parseVennProblem(text: string): { a: number; b: number; both: number; wa: string; wb: string } | null {
  const t = text.replace(/\$/g, '')
  const both = /(\d+)\s+(?:\w+\s+){0,3}?(?:both|all two)\b|both\b[^.\d]{0,30}?(\d+)/i.exec(t)
  if (!both) return null
  const nb = Number(both[1] ?? both[2])
  const counts = [...t.matchAll(/(\d+)\s+(?:\w+\s+){0,3}?(?:play|like|study|take|have|own|speak|read|watch|eat|drink|chose|choose|prefer|in|are in|do)\s+(\w+)/gi)].filter(m => !/both/i.test(m[2]))
  if (counts.length < 2) return null
  return { a: Number(counts[0][1]), b: Number(counts[1][1]), both: nb, wa: counts[0][2].toLowerCase(), wb: counts[1][2].toLowerCase() }
}
function checkVenn(steps: Step[], problem: string, issues: GuardIssue[]) {
  const pb = parseVennProblem(problem)
  if (!pb) return
  const circles = steps.map((s, i) => ({ s, i })).filter(x => x.s.type === 'draw' && (x.s as DrawStep).shape.kind === 'circle' && !(x.s as DrawStep).on)
    .map(x => { const sh = (x.s as DrawStep).shape as { center: [number, number]; r: number }; return { c: sh.center as P, r: sh.r, step: x.i } })
  if (circles.length !== 2) return
  const [c1, c2] = circles
  if (dist(c1.c, c2.c) >= c1.r + c2.r) return
  const ls = labels(steps)
  // Which circle is which set: the set word written nearest each circle.
  const nameNear = (c: { c: P; r: number }) => ls.filter(l => numberIn(l.text) === null && dist(l.at, c.c) < c.r * 1.6).map(l => ({ l, d: dist(l.at, c.c) })).sort((a, b) => a.d - b.d)
  const n1 = nameNear(c1).find(x => new RegExp(`${pb.wa}|${pb.wb}`, 'i').test(x.l.text))
  const aIs1 = n1 ? new RegExp(pb.wa, 'i').test(n1.l.text) : null
  const region = (p: P) => { const i1 = dist(p, c1.c) <= c1.r, i2 = dist(p, c2.c) <= c2.r; return i1 && i2 ? 'both' : i1 ? 'c1' : i2 ? 'c2' : 'out' }
  const nums = ls.filter(l => /^\s*\$?\s*\d+\s*\$?\s*$/.test(l.text)).map(l => ({ v: Number(numberIn(l.text)), r: region(l.at), step: l.step }))
  const inBoth = nums.filter(x => x.r === 'both'), in1 = nums.filter(x => x.r === 'c1'), in2 = nums.filter(x => x.r === 'c2')
  if (!inBoth.length || !in1.length || !in2.length) return
  const onlyA = pb.a - pb.both, onlyB = pb.b - pb.both
  if (inBoth[0].v !== pb.both) issues.push({ kind: 'venn', step: inBoth[0].step, detail: `the overlap shows ${inBoth[0].v}; ${pb.both} are in both`, fixed: false })
  const want1 = aIs1 === null ? null : aIs1 ? onlyA : onlyB, want2 = aIs1 === null ? null : aIs1 ? onlyB : onlyA
  if (want1 !== null && want2 !== null) {
    if (in1[0].v !== want1) issues.push({ kind: 'venn', step: in1[0].step, detail: `the "${aIs1 ? pb.wa : pb.wb} only" region shows ${in1[0].v}; it should be ${want1} (${aIs1 ? pb.a : pb.b} − ${pb.both})`, fixed: false })
    if (in2[0].v !== want2) issues.push({ kind: 'venn', step: in2[0].step, detail: `the "${aIs1 ? pb.wb : pb.wa} only" region shows ${in2[0].v}; it should be ${want2} (${aIs1 ? pb.b : pb.a} − ${pb.both})`, fixed: false })
  } else if ([in1[0].v, in2[0].v].sort().join() !== [onlyA, onlyB].sort().join()) {
    issues.push({ kind: 'venn', step: in1[0].step, detail: `the "only" regions show ${in1[0].v} and ${in2[0].v}; they should be ${onlyA} and ${onlyB} (totals minus the ${pb.both} in both)`, fixed: false })
  }
}

/* ───────────── Entry point ───────────── */

/**
 * Guard a list of steps (a lesson section, a re-teach, a chat board scene). `problem`: the stated problem (the learner's
 * message, the beat's goal) so values on the board can be matched against it.
 */
export function guardSteps(input: Step[], opts: { problem?: string } = {}): GuardResult {
  const issues: GuardIssue[] = []
  const counter = { n: 0 }
  // Board lines written while testing a guess ("we test whether x = -3 is a root": (-3)² − 5(-3) + 6 = 0 … 30 ≠ 0)
  // are hypotheses, not claims: skipped for a few steps after the narration says so.
  const HYPO = /\b(test(ing)?|check(ing)?)\b.{0,30}\bwhether\b|\bwhether\b.{0,40}\b(root|solution|true|works|equal)|\bis .{0,25}\ba (root|solution)\b|\bsuppose\b|\bguess\b/i
  const hypothesis = (i: number) => {
    for (let k = i; k >= 0 && k > i - 6; k--) {
      const st = input[k] as Step & { say?: string }
      if (st.type === 'clear' && !(st as { targets?: unknown }).targets) return false
      if (st.say && HYPO.test(st.say)) return true
    }
    return false
  }
  let steps = input.map((s, i) => {
    const o = { ...s } as Step & { say?: string }
    o.say = fixField(o.say, false, i, 'narration', issues, counter)
    const hyp = (o.type === 'write' || o.type === 'math') && hypothesis(i)
    if (o.type === 'write' && !hyp) o.text = fixField(o.text, false, i, 'board text', issues, counter) ?? o.text
    if (o.type === 'math' && !hyp) o.tex = fixField(o.tex, true, i, 'board maths', issues, counter) ?? o.tex
    if (o.type === 'transform' && !hypothesis(i)) {
      if (o.tex) o.tex = fixField(o.tex, true, i, 'board maths', issues, counter)
      if (o.text) o.text = fixField(o.text, false, i, 'board text', issues, counter)
    }
    if (o.type === 'annotate' && o.note) o.note = fixField(o.note, false, i, 'note', issues, counter)
    if (o.type === 'check' && o.explanation) o.explanation = fixField(o.explanation, false, i, 'explanation', issues, counter)
    if (o.say === undefined) delete o.say
    return o as Step
  })
  // Answers shown before the learner answers.
  steps = steps.map((s, i) => {
    if (s.type !== 'check') return s
    const ans = answerOf(s)
    if (!ans) return s
    let out = s
    const leakSay = leakIn(s.say, ans, true)
    if (leakSay.length) {
      out = { ...out, say: sentences(s.say!).filter(x => !leakSay.includes(x)).join('').trim() || 'Have a go.' }
      issues.push({ kind: 'answer-leak', step: i, detail: `check narration stated the answer ("${leakSay[0].trim().slice(0, 80)}"); removed`, fixed: true })
    }
    const leakPrompt = leakIn(s.prompt, ans, true)
    if (leakPrompt.length) issues.push({ kind: 'answer-leak', step: i, detail: `check prompt gives the answer away ("${leakPrompt[0].trim().slice(0, 80)}")`, fixed: false })
    return out
  })
  // The step right before a check must not state its answer either.
  steps = steps.map((s, i) => {
    const next = steps[i + 1]
    if (!next || next.type !== 'check' || s.type === 'check' || !s.say) return s
    const ans = answerOf(next)
    if (!ans) return s
    // Only when the step is about the same problem (every number in the check's prompt appears in it): a worked example
    // of another problem may well share the answer.
    const pn = next.prompt.match(/\d+(\.\d+)?/g) ?? []
    const own = `${s.say} ${s.type === 'write' ? s.text : s.type === 'math' ? s.tex : ''}`
    if (pn.length < 2 || !pn.every(n => new RegExp(`(^|[^\\d.])${n.replace('.', '\\.')}(?!\\d)`).test(own))) return s
    const leak = leakIn(s.say, ans)
    if (!leak.length) return s
    issues.push({ kind: 'answer-leak', step: i, detail: `narration before the check stated its answer ("${leak[0].trim().slice(0, 80)}"); removed`, fixed: true })
    const kept = sentences(s.say).filter(x => !leak.includes(x)).join('').trim()
    return { ...s, say: kept || undefined } as Step
  })
  steps = fixCircleAxes(steps, issues)
  // Drawings are judged one board scene at a time (a full clear starts a new one), with that scene's own words.
  const textOf = (list: Step[]) => list.map(s => [(s as { say?: string }).say, s.type === 'write' ? s.text : s.type === 'math' ? s.tex : ''].filter(Boolean).join(' ')).join(' ')
  let start = 0
  for (let i = 0; i <= steps.length; i++) {
    const end = i === steps.length || (steps[i].type === 'clear' && !(steps[i] as { targets?: unknown }).targets)
    if (!end) continue
    if (i > start) {
      const scene = steps.slice(start, i)
      const local: GuardIssue[] = []
      const text = textOf(scene)
      checkPythagoras(scene, local, text)
      checkRefraction(scene, local, text)
      checkSnellText(text, local)
      checkVectors(scene, local, text)
      checkVenn(scene, `${opts.problem ?? ''} ${text}`, local)
      issues.push(...local.map(x => ({ ...x, step: x.step >= 0 ? x.step + start : x.step })))
    }
    start = i + 1
  }
  return { steps, issues, claims: counter.n }
}

/** One line per issue, for a regeneration prompt or a trace. */
export function issueLines(issues: GuardIssue[]): string[] {
  return issues.filter(i => !i.fixed).map(i => `${i.kind}${i.step >= 0 ? ` (step ${i.step + 1})` : ''}: ${i.detail}`)
}

/**
 * Exact maths diagrams with Penrose (@penrose/core): the model writes only a Substance program (what exists and how
 * it relates); the Domain and Style come from a small vetted library, so layout, colours and labels are always ours.
 *   sets      Venn / Euler diagrams: sets, subsets, disjoint and intersecting sets, elements in sets
 *   geometry  points, triangles, right angles, angle marks, bisectors, midpoints, segments, perpendicular foot
 *   graph     graphs and rooted trees: nodes, edges, arrows, parent → child
 *   vectors   vectors from one origin, sums (head to tail + resultant), orthogonal pairs, scaled copies
 * Compiled and optimised on the server (Penrose needs a DOM for its SVG writer: a small linkedom shim with estimated
 * text metrics). The result is sanitised SVG + a PNG check. Server only.
 */
import { createHash } from 'node:crypto'
import { sanitizeSvg } from './visual'

export type DiagramLibrary = 'sets' | 'geometry' | 'graph' | 'vectors'

const INK = '#14141A', GREEN = '#1F4D3A', CLAY = '#A4502A', NAVY = '#23406A', AMBER = '#8A5A00'
const rgba = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${((n >> 16) & 255) / 255}, ${((n >> 8) & 255) / 255}, ${(n & 255) / 255}, ${a})` }
const FONT = `fontFamily: "DejaVu Sans, Inter, sans-serif"`
const CANVAS = `canvas {\n  width = 640\n  height = 400\n}\n`

interface Lib { domain: string; style: string; help: string; example: string }

export const LIBRARY: Record<DiagramLibrary, Lib> = {
  sets: {
    help: 'Set A, B, ... ; Element x, y ... ; Subset(A, B) (A inside B); Disjoint(A, B); Intersecting(A, B); In(x, A) (element x in set A); NotIn(x, A). Label A "Students" (short plain text; unlabelled objects show their name).',
    example: 'Set A, B, C\nIntersecting(A, B)\nSubset(C, A)\nElement x\nIn(x, C)\nLabel A "Football"\nLabel B "Chess"\nLabel C "Captains"',
    domain: `type Set
type Element
predicate Subset(Set s1, Set s2)
predicate Disjoint(Set s1, Set s2)
predicate Intersecting(Set s1, Set s2)
predicate In(Element e, Set s)
predicate NotIn(Element e, Set s)`,
    style: `${CANVAS}
forall Set x {
  x.icon = Circle {
    r : ?
    strokeWidth : 2.2
    strokeColor : ${rgba(INK, 1)}
    fillColor : ${rgba(GREEN, 0.14)}
  }
  x.text = Text {
    string : x.label
    fontSize : "20px"
    ${FONT}
    fillColor : ${rgba(INK, 1)}
  }
  ensure lessThan(46, x.icon.r)
  ensure lessThan(x.icon.r, 170)
  ensure contains(x.icon, x.text, 6)
  ensure onCanvas(x.icon, canvas.width, canvas.height)
  encourage near(x.text, x.icon)
  x.icon below x.text
}
forall Element e {
  e.icon = Circle {
    r : 5
    fillColor : ${rgba(CLAY, 1)}
    strokeWidth : 0
  }
  e.text = Text {
    string : e.label
    fontSize : "17px"
    ${FONT}
    fillColor : ${rgba(CLAY, 1)}
  }
  ensure disjoint(e.text, e.icon, 3)
  encourage near(e.text, e.icon)
  ensure onCanvas(e.icon, canvas.width, canvas.height)
}
forall Set x; Set y where Subset(x, y) {
  ensure contains(y.icon, x.icon, 8)
  ensure lessThan(x.icon.r, y.icon.r * 0.75)
  ensure disjoint(y.text, x.icon, 8)
  x.icon above y.icon
}
forall Set x; Set y where Disjoint(x, y) {
  ensure disjoint(x.icon, y.icon, 24)
}
forall Set x; Set y where Intersecting(x, y) {
  ensure overlapping(x.icon, y.icon, 40)
  ensure disjoint(y.text, x.icon, 6)
  ensure disjoint(x.text, y.icon, 6)
  ensure lessThan(vdist(x.icon.center, y.icon.center), (x.icon.r + y.icon.r) * 0.82)
  y.icon.fillColor = ${rgba(CLAY, 0.14)}
}
forall Element e; Set s where In(e, s) {
  ensure contains(s.icon, e.icon, 10)
  ensure contains(s.icon, e.text, 4)
  ensure disjoint(s.text, e.text, 4)
}
forall Element e; Set s where NotIn(e, s) {
  ensure disjoint(s.icon, e.icon, 10)
  ensure disjoint(s.icon, e.text, 4)
}
forall Element e1; Element e2 {
  ensure disjoint(e1.text, e2.text, 6)
  ensure disjoint(e1.icon, e2.text, 4)
}`,
  },
  geometry: {
    help: 'Point A, B, C, ... ; Triangle(A, B, C); Segment(A, B); RightAngle(A, B, C) (right angle at B); AngleMark(A, B, C) (arc at B); Bisector(A, B, C, D) (D on AC with BD bisecting angle ABC); Midpoint(M, A, B); Foot(D, A, B, C) (D on BC with AD perpendicular to BC); Label A "A".',
    example: 'Point A, B, C, D\nTriangle(A, B, C)\nBisector(A, B, C, D)\nAngleMark(A, B, D)\nAngleMark(D, B, C)',
    domain: `type Point
predicate Triangle(Point a, Point b, Point c)
predicate Segment(Point a, Point b)
predicate RightAngle(Point a, Point b, Point c)
predicate AngleMark(Point a, Point b, Point c)
predicate Bisector(Point a, Point b, Point c, Point d)
predicate Midpoint(Point m, Point a, Point b)
predicate Foot(Point d, Point a, Point b, Point c)`,
    style: `${CANVAS}
forall Point p {
  p.pos = (?, ?)
  p.icon = Circle {
    center : p.pos
    r : 4.5
    fillColor : ${rgba(INK, 1)}
    strokeWidth : 0
  }
  p.text = Text {
    string : p.label
    fontSize : "24px"
    ${FONT}
    fillColor : ${rgba(INK, 1)}
  }
  ensure disjoint(p.text, p.icon, 5)
  ensure inRange(vdist(p.text.center, p.pos), 20, 34)
  ensure inRange(p.pos[0], -260, 260)
  ensure inRange(p.pos[1], -160, 160)
}
forall Point p; Point q {
  ensure lessThan(70, vdist(p.pos, q.pos))
  ensure disjoint(p.text, q.text, 4)
  ensure disjoint(p.text, q.icon, 6)
}
forall Point a; Point b; Point c where Triangle(a, b, c) {
  t_ab = Line { start : a.pos
    end : b.pos
    strokeWidth : 2.4
    strokeColor : ${rgba(INK, 1)} }
  t_bc = Line { start : b.pos
    end : c.pos
    strokeWidth : 2.4
    strokeColor : ${rgba(INK, 1)} }
  t_ca = Line { start : c.pos
    end : a.pos
    strokeWidth : 2.4
    strokeColor : ${rgba(INK, 1)} }
  t_fill = Polygon { points : [a.pos, b.pos, c.pos]
    fillColor : ${rgba(GREEN, 0.1)}
    strokeWidth : 0 }
  t_fill below t_ab
  ensure disjoint(a.text, t_fill, 3)
  ensure disjoint(b.text, t_fill, 3)
  ensure disjoint(c.text, t_fill, 3)
  ensure inRange(vdist(a.pos, b.pos), 170, 420)
  ensure inRange(vdist(b.pos, c.pos), 170, 420)
  ensure inRange(vdist(c.pos, a.pos), 170, 420)
  ensure lessThan(0.62, angleBetween(b.pos - a.pos, c.pos - a.pos))
  ensure lessThan(0.62, angleBetween(a.pos - b.pos, c.pos - b.pos))
  ensure lessThan(0.62, angleBetween(a.pos - c.pos, b.pos - c.pos))
  encourage nearVec(a.text.center, a.pos + 26 * unit(a.pos - (b.pos + c.pos) / 2), 0)
  encourage nearVec(b.text.center, b.pos + 26 * unit(b.pos - (a.pos + c.pos) / 2), 0)
  encourage nearVec(c.text.center, c.pos + 26 * unit(c.pos - (a.pos + b.pos) / 2), 0)
}
forall Point p; Point a; Point b; Point c where Triangle(a, b, c) {
  ensure lessThan(16, signedDistanceLine(a.pos, b.pos, p.text.center))
  ensure lessThan(16, signedDistanceLine(b.pos, c.pos, p.text.center))
  ensure lessThan(16, signedDistanceLine(c.pos, a.pos, p.text.center))
}
forall Point a; Point b where Segment(a, b) {
  s_line = Line { start : a.pos
    end : b.pos
    strokeWidth : 2.2
    strokeColor : ${rgba(NAVY, 1)} }
}
forall Point p; Point a; Point b where Segment(a, b) {
  ensure lessThan(16, signedDistanceLine(a.pos, b.pos, p.text.center))
}
forall Point a; Point b; Point c where RightAngle(a, b, c) {
  ensure equal(dot(a.pos - b.pos, c.pos - b.pos), 0)
  r_mark = Polyline { points : [b.pos + 16 * unit(a.pos - b.pos), b.pos + 16 * unit(a.pos - b.pos) + 16 * unit(c.pos - b.pos), b.pos + 16 * unit(c.pos - b.pos)]
    strokeWidth : 1.8
    strokeColor : ${rgba(CLAY, 1)} }
  ensure lessThan(24, vdist(b.text.center, b.pos + 11 * unit(a.pos - b.pos) + 11 * unit(c.pos - b.pos)))
}
forall Point a; Point b; Point c where AngleMark(a, b, c) {
  m_arc = Path { d : circularArc("open", b.pos, 30, angleOf(a.pos - b.pos), angleOf(a.pos - b.pos) + angleFrom(a.pos - b.pos, c.pos - b.pos))
    strokeWidth : 2
    strokeColor : ${rgba(CLAY, 1)}
    fillColor : none() }
  ensure lessThan(26, vdist(b.text.center, b.pos + 30 * unit(unit(a.pos - b.pos) + unit(c.pos - b.pos))))
}
forall Point a; Point b; Point c; Point d where Bisector(a, b, c, d) {
  ensure collinearOrdered(a.pos, d.pos, c.pos)
  ensure lessThan(50, vdist(a.pos, d.pos))
  ensure lessThan(50, vdist(c.pos, d.pos))
  ensure equal(angleBetween(a.pos - b.pos, d.pos - b.pos), angleBetween(d.pos - b.pos, c.pos - b.pos))
  bi_line = Line { start : b.pos
    end : d.pos
    strokeWidth : 2.2
    strokeColor : ${rgba(GREEN, 1)}
    style : "dashed" }
  bi_arc1 = Path { d : circularArc("open", b.pos, 30, angleOf(a.pos - b.pos), angleOf(a.pos - b.pos) + angleFrom(a.pos - b.pos, d.pos - b.pos))
    strokeWidth : 2
    strokeColor : ${rgba(CLAY, 1)}
    fillColor : none() }
  bi_arc2 = Path { d : circularArc("open", b.pos, 30, angleOf(d.pos - b.pos), angleOf(d.pos - b.pos) + angleFrom(d.pos - b.pos, c.pos - b.pos))
    strokeWidth : 2
    strokeColor : ${rgba(CLAY, 1)}
    fillColor : none() }
  bi_tick1 = Line { start : b.pos + 24 * unit(unit(a.pos - b.pos) + unit(d.pos - b.pos))
    end : b.pos + 37 * unit(unit(a.pos - b.pos) + unit(d.pos - b.pos))
    strokeWidth : 2
    strokeColor : ${rgba(CLAY, 1)} }
  bi_tick2 = Line { start : b.pos + 24 * unit(unit(d.pos - b.pos) + unit(c.pos - b.pos))
    end : b.pos + 37 * unit(unit(d.pos - b.pos) + unit(c.pos - b.pos))
    strokeWidth : 2
    strokeColor : ${rgba(CLAY, 1)} }
  ensure lessThan(16, signedDistanceLine(b.pos, d.pos, b.text.center))
  ensure lessThan(16, signedDistanceLine(b.pos, d.pos, d.text.center))
}
forall Point m; Point a; Point b where Midpoint(m, a, b) {
  ensure collinearOrdered(a.pos, m.pos, b.pos)
  ensure equal(vdist(a.pos, m.pos), vdist(m.pos, b.pos))
  ensure lessThan(16, signedDistanceLine(a.pos, b.pos, m.text.center))
  tick1 = Line { start : (a.pos + m.pos) / 2 + 7 * rot90(unit(b.pos - a.pos))
    end : (a.pos + m.pos) / 2 - 7 * rot90(unit(b.pos - a.pos))
    strokeWidth : 2
    strokeColor : ${rgba(CLAY, 1)} }
  tick2 = Line { start : (m.pos + b.pos) / 2 + 7 * rot90(unit(b.pos - a.pos))
    end : (m.pos + b.pos) / 2 - 7 * rot90(unit(b.pos - a.pos))
    strokeWidth : 2
    strokeColor : ${rgba(CLAY, 1)} }
}
forall Point d; Point a; Point b; Point c where Foot(d, a, b, c) {
  ensure collinearOrdered(b.pos, d.pos, c.pos)
  ensure equal(dot(a.pos - d.pos, c.pos - b.pos), 0)
  ensure lessThan(60, vdist(d.pos, b.pos))
  ensure lessThan(60, vdist(d.pos, c.pos))
  f_line = Line { start : a.pos
    end : d.pos
    strokeWidth : 2.2
    strokeColor : ${rgba(NAVY, 1)}
    style : "dashed" }
  f_mark = Polyline { points : [d.pos + 13 * unit(a.pos - d.pos), d.pos + 13 * unit(a.pos - d.pos) + 13 * unit(c.pos - d.pos), d.pos + 13 * unit(c.pos - d.pos)]
    strokeWidth : 1.6
    strokeColor : ${rgba(CLAY, 1)} }
  ensure lessThan(16, signedDistanceLine(a.pos, d.pos, d.text.center))
  ensure lessThan(16, signedDistanceLine(b.pos, c.pos, d.text.center))
  ensure lessThan(16, signedDistanceLine(a.pos, d.pos, a.text.center))
}`,
  },
  graph: {
    help: 'Node a, b, c, ... ; Edge(a, b) (undirected); Arrow(a, b) (directed a → b); Parent(p, c) (rooted tree: p above c, joined); Highlight(a) (key node); Label a "root".',
    example: 'Node r, a, b, c, d\nParent(r, a)\nParent(r, b)\nParent(a, c)\nParent(a, d)\nHighlight(r)\nLabel r "root"',
    domain: `type Node
predicate Edge(Node a, Node b)
predicate Arrow(Node a, Node b)
predicate Parent(Node p, Node c)
predicate Highlight(Node a)`,
    style: `${CANVAS}
forall Node n {
  n.icon = Circle {
    r : max(22, n.text.width / 2 + 13)
    fillColor : ${rgba('#FFFFFF', 1)}
    strokeColor : ${rgba(INK, 1)}
    strokeWidth : 2.2
  }
  n.text = Text {
    string : n.label
    center : n.icon.center
    fontSize : "18px"
    ${FONT}
    fillColor : ${rgba(INK, 1)}
  }
  ensure onCanvas(n.icon, canvas.width, canvas.height)
  n.text above n.icon
}
forall Node a; Node b {
  ensure disjoint(a.icon, b.icon, 36)
  encourage notTooClose(a.icon, b.icon, 120)
}
forall Node a; Node b where Edge(a, b) {
  e_line = Line { start : a.icon.center
    end : b.icon.center
    strokeWidth : 2.2
    strokeColor : ${rgba(NAVY, 1)} }
  e_line below a.icon
  e_line below b.icon
  encourage near(a.icon, b.icon, 90)
}
forall Node a; Node b where Arrow(a, b) {
  w_line = Line { start : a.icon.center + 24 * unit(b.icon.center - a.icon.center)
    end : b.icon.center - 27 * unit(b.icon.center - a.icon.center)
    strokeWidth : 2.2
    strokeColor : ${rgba(CLAY, 1)}
    endArrowhead : "straight"
    endArrowheadSize : 0.6 }
  encourage near(a.icon, b.icon, 100)
}
forall Node p; Node c where Parent(p, c) {
  pc_line = Line { start : p.icon.center
    end : c.icon.center
    strokeWidth : 2.2
    strokeColor : ${rgba(NAVY, 1)} }
  pc_line below p.icon
  pc_line below c.icon
  ensure lessThan(c.icon.center[1] + 85, p.icon.center[1])
  encourage equal(p.icon.center[1] - c.icon.center[1], 95)
  encourage equal(abs(p.icon.center[0] - c.icon.center[0]), 90)
}
forall Node p; Node a; Node b where Parent(p, a); Parent(p, b) {
  ensure equal(a.icon.center[1], b.icon.center[1])
  ensure lessThan(110, abs(a.icon.center[0] - b.icon.center[0]))
  encourage equal(p.icon.center[0], (a.icon.center[0] + b.icon.center[0]) / 2)
}
forall Node a where Highlight(a) {
  override a.icon.fillColor = ${rgba(GREEN, 0.18)}
  override a.icon.strokeColor = ${rgba(GREEN, 1)}
}`,
  },
  vectors: {
    help: 'Vector u, v, w, ... (drawn from one origin O); Sum(w, u, v) (w = u + v: v drawn again from the tip of u, w as the resultant); Orthogonal(u, v); Scaled(v, u) (v a positive multiple of u, drawn along it); Label u "u".',
    example: 'Vector u, v, w\nSum(w, u, v)\nLabel u "a"\nLabel v "b"\nLabel w "a + b"',
    domain: `type Vector
predicate Sum(Vector c, Vector a, Vector b)
predicate Orthogonal(Vector a, Vector b)
predicate Scaled(Vector b, Vector a)`,
    style: `${CANVAS}
global {
  origin = (-180, -110)
  oDot = Circle { center : origin
    r : 4
    fillColor : ${rgba(INK, 1)}
    strokeWidth : 0 }
  oText = Text { string : "O"
    center : origin + (-14, -14)
    fontSize : "18px"
    ${FONT}
    fillColor : ${rgba(INK, 1)} }
}
forall Vector v {
  v.vec = (?, ?)
  v.arrow = Line { start : global.origin
    end : global.origin + v.vec
    strokeWidth : 3
    strokeColor : ${rgba(NAVY, 1)}
    endArrowhead : "straight"
    endArrowheadSize : 0.55 }
  v.text = Text { string : v.label
    fontSize : "20px"
    ${FONT}
    fillColor : ${rgba(NAVY, 1)} }
  ensure inRange(norm(v.vec), 110, 300)
  v.tip = global.origin + v.vec
  ensure inRange(v.tip[0], -290, 290)
  ensure inRange(v.tip[1], -180, 180)
  encourage nearVec(v.text.center, global.origin + 0.55 * v.vec + 20 * rot90(unit(v.vec)), 0)
  ensure disjoint(v.text, v.arrow, 3)
  ensure disjoint(global.oText, v.arrow, 3)
}
forall Vector a; Vector b {
  ensure lessThan(0.35, angleBetween(a.vec, b.vec))
  ensure disjoint(a.text, b.text, 6)
}
forall Vector c; Vector a; Vector b where Sum(c, a, b) {
  override c.vec = a.vec + b.vec
  override c.arrow.strokeColor = ${rgba(GREEN, 1)}
  override c.text.fillColor = ${rgba(GREEN, 1)}
  s_ghost = Line { start : global.origin + a.vec
    end : global.origin + a.vec + b.vec
    strokeWidth : 2.2
    strokeColor : ${rgba(NAVY, 0.55)}
    style : "dashed"
    endArrowhead : "straight"
    endArrowheadSize : 0.6 }
}
forall Vector a; Vector b where Orthogonal(a, b) {
  ensure equal(dot(a.vec, b.vec), 0)
  o_mark = Polyline { points : [global.origin + 14 * unit(a.vec), global.origin + 14 * unit(a.vec) + 14 * unit(b.vec), global.origin + 14 * unit(b.vec)]
    strokeWidth : 1.6
    strokeColor : ${rgba(CLAY, 1)} }
}
forall Vector b; Vector a where Scaled(b, a) {
  b.k = ?
  ensure inRange(b.k, 0.4, 2.2)
  override b.vec = b.k * a.vec
  override b.arrow.strokeColor = ${rgba(CLAY, 1)}
  override b.arrow.strokeWidth = 2.2
}`,
  },
}

/* ───────────── DOM shim (Penrose writes SVG through document.createElementNS and measures text on a canvas) ───────────── */

let shimLock: Promise<void> = Promise.resolve()

async function withDom<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const { parseHTML } = await import('linkedom')
    const w = parseHTML('<!doctype html><html><body></body></html>')
    const doc = w.document as unknown as Document
    const create = doc.createElement.bind(doc)
    ;(doc as unknown as { createElement: (t: string) => unknown }).createElement = (t: string) => t === 'canvas'
      ? { getContext: () => ({ font: '', textBaseline: '', measureText(s: string) { const px = parseFloat(String(this.font).match(/([\d.]+)px/)?.[1] ?? '16'); const wd = s.length * px * 0.58; return { width: wd, actualBoundingBoxLeft: 0, actualBoundingBoxRight: wd, actualBoundingBoxAscent: px * 0.74, actualBoundingBoxDescent: px * 0.22 } } }), remove() {} }
      : create(t)
    const g = globalThis as Record<string, unknown>
    const saved = { document: g.document, window: g.window }
    g.document = doc
    if (g.window === undefined) g.window = w.window
    try { return await fn() } finally { g.document = saved.document; if (saved.window === undefined) delete g.window }
  }
  // One diagram at a time per instance (the shim is global).
  const p = shimLock.then(run, run)
  shimLock = p.then(() => undefined, () => undefined)
  return p
}

/* ───────────── Compile ───────────── */

/** Keep only Substance statements the model may write (no Domain/Style keywords, bounded size). */
export function cleanSubstance(src: string): { substance: string; errors: string[] } {
  const errors: string[] = []
  const lines = String(src ?? '').replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 60)
  const ok: string[] = []
  for (const l of lines) {
    if (/^(--|\/\/|#)/.test(l)) continue
    if (/^(type|predicate|function|forall|canvas|global|ensure|encourage|import)\b|[{}]/.test(l)) { errors.push(`not Substance: "${l.slice(0, 40)}"`); continue }
    if (!/^[A-Za-z_][\w ,()"'$.\\+\-−=^*/<>:;!?&]*$/.test(l)) { errors.push(`unexpected characters in "${l.slice(0, 40)}"`); continue }
    ok.push(l.replace(/−/g, '-').replace(/^Label\s+(\w+)\s+'([^']*)'$/, 'Label $1 "$2"'))
  }
  if (!ok.length) errors.push('empty Substance program')
  return { substance: ok.join('\n'), errors }
}

/**
 * Fix the small slips models make before checking: a name used in a relation but never declared gets declared with the
 * type the predicate expects; a name that differs only in case from a declared one is renamed; labels of unknown names go.
 */
export function repairSubstance(library: DiagramLibrary, substance: string): string {
  const lib = LIBRARY[library]
  if (!lib) return substance
  const types = new Set([...lib.domain.matchAll(/^type\s+(\w+)/gm)].map(m => m[1]))
  const preds = new Map([...lib.domain.matchAll(/^predicate\s+(\w+)\(([^)]*)\)/gm)].map(m => [m[1], m[2].split(',').map(x => x.trim().split(/\s+/)[0])]))
  const declared = new Map<string, string>()
  const lines = substance.split('\n').map(l => l.trim()).filter(Boolean)
  for (const l of lines) { const m = l.match(/^(\w+)\s+([\w\s,]+)$/); if (m && types.has(m[1])) for (const n of m[2].split(',').map(x => x.trim()).filter(Boolean)) declared.set(n, m[1]) }
  const lower = new Map([...declared.keys()].map(n => [n.toLowerCase(), n]))
  const fixName = (n: string) => (declared.has(n) ? n : lower.get(n.toLowerCase()) ?? n)
  const extra: string[] = []
  const out = lines.map(l => {
    const m = l.match(/^(\w+)\(([^)]*)\)$/)
    if (m && preds.has(m[1])) {
      const sig = preds.get(m[1])!
      const args = m[2].split(',').map(x => fixName(x.trim()))
      args.forEach((a, i) => { if (/^[A-Za-z_]\w*$/.test(a) && !declared.has(a) && sig[i]) { declared.set(a, sig[i]); lower.set(a.toLowerCase(), a); extra.push(`${sig[i]} ${a}`) } })
      return `${m[1]}(${args.join(', ')})`
    }
    const lb = l.match(/^Label\s+(\w+)\s+(".*")$/)
    if (lb) return `Label ${fixName(lb[1])} ${lb[2]}`
    return l
  })
  // Labels may come before the relation that declares their name: resolve them after.
  return [...extra, ...out].filter(l => { const lb = l.match(/^Label\s+(\w+)\s/); return !lb || declared.has(lb[1]) }).join('\n')
}

/** Check a Substance program against a vetted library's Domain: known types and predicates, right arity, declared names. */
export function checkSubstance(library: DiagramLibrary, substance: string): string[] {
  const lib = LIBRARY[library]
  if (!lib) return [`unknown library "${library}" (sets, geometry, graph, vectors)`]
  const types = new Set([...lib.domain.matchAll(/^type\s+(\w+)/gm)].map(m => m[1]))
  const preds = new Map([...lib.domain.matchAll(/^predicate\s+(\w+)\(([^)]*)\)/gm)].map(m => [m[1], m[2].split(',').map(x => x.trim().split(/\s+/)[0])]))
  const declared = new Map<string, string>()
  const errors: string[] = []
  for (const line of substance.split('\n')) {
    const l = line.trim()
    if (!l || /^AutoLabel\b/.test(l)) continue
    let m: RegExpMatchArray | null
    if ((m = l.match(/^Label\s+(\w+)\s+"[^"]{0,40}"$/))) { if (!declared.has(m[1])) errors.push(`Label of undeclared "${m[1]}"`); continue }
    if ((m = l.match(/^(\w+)\s+([\w\s,]+)$/)) && types.has(m[1])) { for (const n of m[2].split(',').map(x => x.trim()).filter(Boolean)) declared.set(n, m[1]); continue }
    if ((m = l.match(/^(\w+)\(([^)]*)\)$/))) {
      const sig = preds.get(m[1])
      if (!sig) { errors.push(`unknown predicate ${m[1]} (allowed: ${[...preds.keys()].join(', ')})`); continue }
      const args = m[2].split(',').map(x => x.trim()).filter(Boolean)
      if (args.length !== sig.length) { errors.push(`${m[1]} takes ${sig.length} arguments (${sig.join(', ')})`); continue }
      args.forEach((a, i) => { const t = declared.get(a); if (!t) errors.push(`${m![1]}: "${a}" is not declared`); else if (t !== sig[i]) errors.push(`${m![1]}: "${a}" is a ${t}, expected ${sig[i]}`) })
      continue
    }
    errors.push(`cannot read "${l.slice(0, 50)}" (declare objects as "${[...types][0]} a, b", relations as Pred(a, b), labels as Label a "text")`)
  }
  if (!declared.size) errors.push(`declare at least one object (${[...types].join(', ')})`)
  if (declared.size > 14) errors.push('at most 14 objects')
  return errors
}

export class SubstanceError extends Error {}

export interface DiagramResult { svg: string; width: number; height: number; ms: number; library: DiagramLibrary; unmet: number }

export async function renderMathDiagram(library: DiagramLibrary, substanceSrc: string, opts: { timeoutMs?: number } = {}): Promise<DiagramResult> {
  const lib = LIBRARY[library]
  if (!lib) throw new Error(`unknown library "${library}" (sets, geometry, graph, vectors)`)
  const { substance, errors } = cleanSubstance(substanceSrc)
  if (!substance) throw new Error(errors.join('; '))
  const fixed = repairSubstance(library, substance)
  const bad = checkSubstance(library, fixed)
  if (bad.length) throw new SubstanceError(bad.slice(0, 6).join('; '))
  const t0 = Date.now()
  const hasLabels = /^AutoLabel\b/m.test(fixed)
  const program = hasLabels ? fixed : `AutoLabel All\n${fixed}`
  const seed = createHash('sha1').update(library + fixed).digest('hex').slice(0, 10)
  const P = await import('@penrose/core')
  return withDom(async () => {
    let last = ''
    let best: { state: unknown; bad: number } | null = null
    for (const variation of [seed, `${seed}b`, `${seed}c`, `${seed}d`, `${seed}e`]) {
      if (best && Date.now() - t0 > (opts.timeoutMs ?? 9_000)) break
      const compiled = await P.compile({ domain: lib.domain, style: lib.style, substance: program, variation, excludeWarnings: [] })
      if (compiled.isErr()) throw new Error(`Penrose: ${P.showError(compiled.error).slice(0, 400)}`)
      const optimized = P.optimize(compiled.value)
      if (optimized.isErr()) { last = P.showError(optimized.error).slice(0, 200); continue }
      // Hard constraints still violated after optimisation (each "ensure" has an energy; 0 when satisfied).
      const { constrEngs } = P.evalFns(optimized.value)
      const bad = constrEngs.filter(e => e > 0.05).length
      if (process.env.PENROSE_DEBUG) console.log('penrose', variation, 'violated', bad, '/', constrEngs.length, constrEngs.map((e, i) => e > 0.5 ? `${i}:${e.toFixed(1)}` : '').filter(Boolean).join(' '))
      if (!best || bad < best.bad) best = { state: optimized.value, bad }
      if (bad === 0) break
    }
    if (best) {
      if (best.bad > 0) last = `${best.bad} layout constraints unmet`
      const svgEl = await P.toSVG(best.state as Parameters<typeof P.toSVG>[0], async () => undefined, 'gm')
      const raw = (svgEl as unknown as { outerHTML: string }).outerHTML
      // Penrose ids hold backticks and dots; make them plain so url(#id) references survive the sanitiser.
      const safe = raw.replace(/id="([^"]+)"/g, (_, id: string) => `id="${id.replace(/[^\w-]/g, '_')}"`).replace(/orient="auto-start-reverse"/g, 'orient="auto"').replace(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${id.replace(/[^\w-]/g, '_')})`)
      const crop = safe.match(/<croppedViewBox>([^<]+)<\/croppedViewBox>/)?.[1]?.split(/\s+/).map(Number)
      let vb = [0, 0, 640, 400]
      if (crop && crop.length === 4 && crop.every(Number.isFinite) && crop[2] > 40 && crop[3] > 40) {
        const m = 22
        vb = [crop[0] - m, crop[1] - m, crop[2] + 2 * m, crop[3] + 2 * m]
        // Never zoom a small layout up: keep at least 560x340 so label sizes match across diagrams.
        if (vb[2] < 560) { vb[0] -= (560 - vb[2]) / 2; vb[2] = 560 }
        if (vb[3] < 340) { vb[1] -= (340 - vb[3]) / 2; vb[3] = 340 }
      }
      const body = safe.replace(/<penrose>[\s\S]*?<\/penrose>/, '').replace(/<title>[\s\S]*?<\/title>/g, '').replace(/<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(v => Math.round(v * 10) / 10).join(' ')}">`)
      const clean = sanitizeSvg(body)
      if (clean.svg) return { svg: clean.svg, width: vb[2], height: vb[3], ms: Date.now() - t0, library, unmet: best.bad }
      last = 'sanitiser rejected the SVG'
    }
    throw new Error(`Penrose could not lay it out${last ? `: ${last}` : ''}`)
  })
}

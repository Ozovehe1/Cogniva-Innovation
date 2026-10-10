/**
 * Circuits: DC resistor networks with one battery. The model writes only the netlist (parts and the junctions they
 * join); code checks the wiring (no dangling terminal, connected, one source), writes the solution itself as
 * series/parallel reduction + back-substitution (generic calc steps over the part values, so a dragged value
 * re-solves everything), and cross-checks every current and voltage against an exact rational nodal (MNA) solve,
 * plus KCL at every junction and the power balance. The schematic is drawn from the topology.
 */
import { Q } from '../rational'
import type { DiagramSpec, ExampleSpec, Given, SolStep } from '../spec'
import type { Plugin, DiagramView } from '../plugin'
import { ACC, CLAY, FLOW, HL, INK, SOFT, arrow, f1, frame, sub, text } from '../svgkit'

export interface Part { id: string; type: 'R' | 'V'; nodes: [string, string]; value?: number }
interface Net { parts: Part[]; ground: string }

function netOf(d: DiagramSpec): Net {
  const parts = (Array.isArray(d.components) ? d.components : []).slice(0, 10).map((c: Record<string, unknown>) => ({
    id: String(c.id ?? ''), type: (String(c.type ?? 'R').toUpperCase() === 'V' ? 'V' : 'R') as 'R' | 'V',
    nodes: (Array.isArray(c.nodes) ? c.nodes.slice(0, 2).map(String) : []) as [string, string],
    value: typeof c.value === 'number' ? c.value : typeof c.value === 'string' && Q.isPlain(c.value) ? Number(c.value) : undefined,
  }))
  const src = parts.find(p => p.type === 'V')
  return { parts, ground: String(d.ground ?? src?.nodes[1] ?? '0') }
}

export function validateNet(net: Net): string[] {
  const errs: string[] = []
  const ids = new Set<string>(), deg = new Map<string, number>()
  for (const c of net.parts) {
    if (!/^[RV][0-9]{1,2}$/.test(c.id)) errs.push(`part id "${c.id}" must be R1, R2… or V1`)
    if (ids.has(c.id)) errs.push(`duplicate part ${c.id}`)
    ids.add(c.id)
    if (c.nodes.length !== 2 || c.nodes[0] === c.nodes[1]) errs.push(`${c.id} needs two different junction names in "nodes"`)
    for (const n of c.nodes) deg.set(n, (deg.get(n) ?? 0) + 1)
  }
  if (net.parts.filter(p => p.type === 'V').length !== 1) errs.push('use exactly one battery (type "V")')
  if (net.parts.filter(p => p.type === 'R').length < 2) errs.push('use at least two resistors')
  for (const [n, k] of deg) if (k < 2) errs.push(`junction "${n}" has only one connection (a dangling wire)`)
  const adj = new Map<string, string[]>([...deg.keys()].map(n => [n, []]))
  for (const c of net.parts) if (c.nodes.length === 2) { adj.get(c.nodes[0])!.push(c.nodes[1]); adj.get(c.nodes[1])!.push(c.nodes[0]) }
  const start = net.parts[0]?.nodes[0]
  const seen = new Set<string>(start ? [start] : []), st = start ? [start] : []
  while (st.length) for (const m of adj.get(st.pop()!) ?? []) if (!seen.has(m)) { seen.add(m); st.push(m) }
  for (const n of deg.keys()) if (!seen.has(n)) errs.push(`junction "${n}" is not connected to the rest of the circuit`)
  return errs
}

/* ───────── exact nodal analysis (solver B) ───────── */

export function solveMNA(net: Net, val: (id: string) => Q) {
  const ground = net.ground
  const nodes = [...new Set(net.parts.flatMap(c => c.nodes))].filter(n => n !== ground)
  const idx = new Map(nodes.map((n, i) => [n, i]))
  const vs = net.parts.filter(c => c.type === 'V')
  const N = nodes.length + vs.length
  const A = Array.from({ length: N }, () => Array.from({ length: N }, () => Q.zero))
  const b = Array.from({ length: N }, () => Q.zero)
  const at = (n: string) => idx.get(n) ?? -1
  for (const c of net.parts) if (c.type === 'R') {
    const [p, m] = c.nodes.map(at); const g = Q.one.div(val(c.id))
    if (p >= 0) A[p][p] = A[p][p].add(g)
    if (m >= 0) A[m][m] = A[m][m].add(g)
    if (p >= 0 && m >= 0) { A[p][m] = A[p][m].sub(g); A[m][p] = A[m][p].sub(g) }
  }
  vs.forEach((c, k) => {
    const r = nodes.length + k; const [p, m] = c.nodes.map(at)
    if (p >= 0) { A[p][r] = A[p][r].add(1); A[r][p] = A[r][p].add(1) }
    if (m >= 0) { A[m][r] = A[m][r].sub(1); A[r][m] = A[r][m].sub(1) }
    b[r] = val(c.id)
  })
  for (let col = 0; col < N; col++) {
    const piv = A.findIndex((row, r) => r >= col && !row[col].isZero())
    if (piv < 0) throw new Error('the circuit has no unique solution (a short circuit or a floating part)')
    ;[A[col], A[piv]] = [A[piv], A[col]]; [b[col], b[piv]] = [b[piv], b[col]]
    for (let r = 0; r < N; r++) if (r !== col && !A[r][col].isZero()) {
      const f = A[r][col].div(A[col][col])
      for (let k = col; k < N; k++) A[r][k] = A[r][k].sub(f.mul(A[col][k]))
      b[r] = b[r].sub(f.mul(b[col]))
    }
  }
  const x = b.map((v, i) => v.div(A[i][i]))
  const V: Record<string, Q> = { [ground]: Q.zero }
  nodes.forEach((n, i) => { V[n] = x[i] })
  const I: Record<string, Q> = {}, Vd: Record<string, Q> = {}
  for (const c of net.parts) { Vd[c.id] = V[c.nodes[0]].sub(V[c.nodes[1]]); if (c.type === 'R') I[c.id] = Vd[c.id].div(val(c.id)) }
  vs.forEach((c, k) => { I[c.id] = x[nodes.length + k].neg() })
  return { V, I, Vd }
}

/* ───────── series/parallel reduction (solver A, and the textbook steps) ───────── */

export type Tree = { leaf: string; u: string; v: string } | { ser: Tree[]; u: string; v: string; name?: string } | { par: Tree[]; u: string; v: string; name?: string }
export interface Reduction { op: 'series' | 'parallel'; parts: string[]; members: string[]; name: string }

export function reduceSP(net: Net): { tree: Tree; steps: Reduction[]; source: Part } | null {
  const src = net.parts.find(c => c.type === 'V')!
  const [tp, tm] = src.nodes
  type E = { u: string; v: string; name: string; members: string[]; tree: Tree }
  let edges: E[] = net.parts.filter(c => c.type === 'R').map(c => ({ u: c.nodes[0], v: c.nodes[1], name: c.id, members: [c.id], tree: { leaf: c.id, u: c.nodes[0], v: c.nodes[1] } }))
  const steps: Reduction[] = []
  const nm = (ms: string[]) => 'R' + ms.map(m => m.replace(/^R/, '')).join('')
  let changed = true
  while (changed && edges.length > 1) {
    changed = false
    for (let i = 0; i < edges.length && !changed; i++) for (let j = i + 1; j < edges.length && !changed; j++) {
      const a = edges[i], c = edges[j]
      if ((a.u === c.u && a.v === c.v) || (a.u === c.v && a.v === c.u)) {
        const members = [...a.members, ...c.members], name = nm(members)
        steps.push({ op: 'parallel', parts: [a.name, c.name], members, name })
        edges = edges.filter(e => e !== a && e !== c).concat({ u: a.u, v: a.v, name, members, tree: { par: [a.tree, c.tree], u: a.u, v: a.v, name } }); changed = true
      }
    }
    if (changed) continue
    const touch = new Map<string, E[]>()
    for (const e of edges) for (const n of [e.u, e.v]) touch.set(n, [...(touch.get(n) ?? []), e])
    for (const [n, es] of touch) {
      if (n === tp || n === tm || es.length !== 2) continue
      const [a, c] = es
      const x = a.u === n ? a.v : a.u, y = c.u === n ? c.v : c.u
      const members = [...a.members, ...c.members], name = nm(members)
      steps.push({ op: 'series', parts: [a.name, c.name], members, name })
      edges = edges.filter(e => e !== a && e !== c).concat({ u: x, v: y, name, members, tree: { ser: [a.tree, c.tree], u: x, v: y, name } }); changed = true; break
    }
  }
  if (edges.length !== 1) return null
  const e = edges[0]
  if (!((e.u === tp && e.v === tm) || (e.u === tm && e.v === tp))) return null
  if (steps.length) steps[steps.length - 1].name = 'R_eq'
  const tree = reorient(e.tree, tp)
  if ('name' in tree && steps.length) (tree as { name?: string }).name = 'R_eq'
  return { tree, steps, source: src }
}
function reorient(t: Tree, from: string): Tree {
  if ('leaf' in t) return t.u === from ? t : { ...t, u: t.v, v: t.u }
  if ('par' in t) return { par: t.par.map(c => reorient(c, from)), u: from, v: t.u === from ? t.v : t.u, name: t.name }
  let list = t.ser
  if (!(list[0].u === from || list[0].v === from)) list = [...list].reverse()
  let cur = from; const kids: Tree[] = []
  for (const c of list) { const o = reorient(c, cur); kids.push(o); cur = o.v }
  return { ser: kids, u: from, v: cur, name: t.name }
}
/** flatten nested series nodes so a chain draws left to right */
function flat(t: Tree): Tree {
  if ('leaf' in t) return t
  if ('par' in t) return { ...t, par: t.par.map(flat) }
  const kids: Tree[] = []
  for (const k of t.ser.map(flat)) if ('ser' in k && !k.name?.startsWith('R_eq')) kids.push(...k.ser); else kids.push(k)
  return { ...t, ser: kids }
}
const leaves = (t: Tree): string[] => ('leaf' in t ? [t.leaf] : ('par' in t ? t.par : t.ser).flatMap(leaves))
/** replace the subtree whose leaves are exactly `members` with one equivalent leaf */
function collapse(t: Tree, members: string[], name: string): Tree {
  const ls = leaves(t)
  if (!('leaf' in t) && ls.length === members.length && ls.every(l => members.includes(l))) return { leaf: name, u: t.u, v: t.v }
  if ('leaf' in t) return t
  if ('par' in t) return { ...t, par: t.par.map(k => collapse(k, members, name)) }
  // a series reduction may cover a run of kids inside a flattened chain
  const idx = t.ser.map(k => leaves(k).every(l => members.includes(l)))
  const run = t.ser.filter((_, i) => idx[i])
  if (run.length >= 2 && run.flatMap(leaves).length === members.length && run.length < t.ser.length) {
    const first = idx.indexOf(true)
    const kids = t.ser.filter((_, i) => !idx[i]); kids.splice(first, 0, { leaf: name, u: run[0].u, v: run[run.length - 1].v })
    return { ...t, ser: kids }
  }
  return { ...t, ser: t.ser.map(k => collapse(k, members, name)) }
}

/* ───────── derive the textbook solution as generic calc steps ───────── */

const T = (id: string) => id === 'R_eq' ? 'R_{eq}' : id.replace(/^([A-Z])(\d+)$/, '$1_{$2}')

export function deriveSteps(net: Net) {
  const sp = reduceSP(net)
  if (!sp) return null
  const V = sp.source.id
  const steps: SolStep[] = []
  for (const r of sp.steps) {
    const [a, b] = r.parts
    if (r.op === 'parallel') steps.push({ title: r.name === 'R_eq' ? 'One equivalent resistor' : `${sub(a)} and ${sub(b)} are in parallel`, claim: `${T(r.name)} = \\frac{${T(a)}\\,${T(b)}}{${T(a)} + ${T(b)}}`, reason: `${a} and ${b} join the same two junctions, so they are in parallel: product over sum.`, calc: { name: r.name, expr: `${a}*${b}/(${a}+${b})`, unit: 'Ω' }, diagram: { highlight: [a, b], collapsed: steps.length } })
    else steps.push({ title: r.name === 'R_eq' ? 'One equivalent resistor' : `${sub(a)} and ${sub(b)} are in series`, claim: `${T(r.name)} = ${T(a)} + ${T(b)}`, reason: `${a} and ${b} are on one path with nothing branching between them, so they are in series: resistances add.`, calc: { name: r.name, expr: `${a}+${b}`, unit: 'Ω' }, diagram: { highlight: [a, b], collapsed: steps.length } })
  }
  const nRed = sp.steps.length
  const Req = nRed ? 'R_eq' : leaves(sp.tree)[0]
  steps.push({ title: 'Current from the battery', claim: `I = \\frac{${T(V)}}{${T(Req)}}`, reason: 'Ohm’s law for the whole network: the battery sees one resistor.', calc: { name: 'I', expr: `${V}/${Req}`, unit: 'A' }, diagram: { collapsed: nRed, currents: ['I'] } })
  // back-substitute through the tree (series: same current; parallel: same voltage)
  const sumsKVL: string[] = []
  const kcl: { node: string; parts: string[] }[] = []
  const walk = (t: Tree, Iname: string, onLoop: boolean, name: string) => {
    if ('leaf' in t) {
      if (Iname !== `I_${t.leaf}`) steps.push({ title: `Voltage across ${sub(t.leaf)}`, claim: `V_{${t.leaf.replace(/^R/, 'R')}} = ${Iname === 'I' ? 'I' : `I_{${Iname.slice(2)}}`}\\,${T(t.leaf)}`, reason: `Ohm’s law: the current through ${t.leaf} times its resistance.`, calc: { name: `V_${t.leaf}`, expr: `${Iname}*${t.leaf}`, unit: 'V' }, diagram: { highlight: [t.leaf], currents: 'all', flow: true } })
      if (onLoop) sumsKVL.push(`V_${t.leaf}`)
      return
    }
    if ('ser' in t) { t.ser.forEach((k, i) => walk(k, Iname, onLoop, `${name}.${i}`)); return }
    // parallel group: the voltage across it, then each branch current
    const gname = t.name ?? `R${leaves(t).map(l => l.slice(1)).join('')}`
    const Vg = `V_${gname}`
    const sum = leaves(t).length === 2 || !t.name ? gname : gname
    steps.push({ title: 'Voltage across the parallel part', claim: `V_{${gname === 'R_eq' ? 'eq' : gname}} = ${Iname === 'I' ? 'I' : `I_{${Iname.slice(2)}}`}\\,${T(sum)}`, reason: 'The whole current passes through the parallel part as if it were its one equivalent resistor.', calc: { name: Vg, expr: `${Iname}*${gname}`, unit: 'V' }, diagram: { highlight: leaves(t), currents: 'all', flow: true } })
    if (onLoop) sumsKVL.push(Vg)
    const branchCurrents: string[] = []
    t.par.forEach((k, i) => {
      const kname = 'leaf' in k ? k.leaf : (k as { name?: string }).name ?? `R${leaves(k).map(l => l.slice(1)).join('')}`
      const Ik = `I_${kname}`
      steps.push({ title: `Current through ${sub(kname)}`, claim: `I_{${kname}} = \\frac{V_{${gname === 'R_eq' ? 'eq' : gname}}}{${T(kname)}}`, reason: `Parallel branches share the same voltage, so ${kname} gets that voltage divided by its own resistance.`, calc: { name: Ik, expr: `${Vg}/${kname}`, unit: 'A' }, diagram: { highlight: leaves(k), currents: 'all', flow: true } })
      branchCurrents.push(Ik)
      if (!('leaf' in k)) walk(k, Ik, false, `${name}.${i}`)
    })
    kcl.push({ node: t.u, parts: branchCurrents })
    void Iname
  }
  walk(flat(sp.tree), 'I', true, 't')
  // the two checks a learner should always do
  if (sumsKVL.length >= 2) steps.push({ title: 'Check: the loop rule (KVL)', claim: `${T(V)} - ${sumsKVL.map(n => `V_{${n.slice(2)}}`).join(' - ')} = 0`, reason: 'Going once round the loop, the voltage drops add up to the battery voltage.', check: { kind: 'zero', expr: `${V} - ${sumsKVL.join(' - ')}` }, diagram: { kvl: true, currents: 'all' } })
  const k0 = kcl[0]
  if (k0) steps.push({ title: 'Check: the junction rule (KCL)', claim: `I = ${k0.parts.map(p => `I_{${p.slice(2)}}`).join(' + ')}`, reason: 'Current that flows into a junction must all flow out again.', check: { kind: 'zero', expr: `I - ${k0.parts.join(' - ')}` }, diagram: { kcl: true, currents: 'all' } })
  // common mistakes, as expressions over the part values
  const Rs = net.parts.filter(p => p.type === 'R').map(p => p.id)
  const S = Rs.join('+')
  const mistakes: Record<string, { expr: string; why: string }[]> = {
    R_eq: [{ expr: S, why: 'added the parallel resistors as if they were in series' }],
    I: [{ expr: `${V}/(${S})`, why: 'added the parallel resistors directly instead of combining them' }, { expr: `${V}/${Rs[0]}`, why: 'used only one resistor' }],
  }
  return { steps, mistakes, sp }
}

function mistakesFor(answer: string | undefined, net: Net, derived: ReturnType<typeof deriveSteps>): { expr: string; why: string }[] {
  if (!answer || !derived) return []
  if (derived.mistakes[answer]) return derived.mistakes[answer]
  const V = derived.sp.source.id
  const m = /^I_(R\d+)$/.exec(answer)
  if (m) return [{ expr: 'I', why: 'forgot that the current splits at the junction' }, { expr: 'I/2', why: 'assumed the current splits equally' }, { expr: `${V}/${m[1]}`, why: `used the whole battery voltage across ${m[1]}` }]
  if (/^V_/.test(answer)) return [{ expr: V, why: 'used the whole battery voltage' }, { expr: `${V}/2`, why: 'assumed the voltage splits equally' }]
  void net
  return []
}

/* ───────── schematic ───────── */

const LEAF_W = 112, UP = 50, DOWN = 46, RAIL = 22, GAP = 30

export function renderCircuit(net: Net, scope: Record<string, number>, view: DiagramView, spec?: ExampleSpec): string {
  const sp = reduceSP(net)
  if (!sp) return frame(300, 80, text(150, 45, 'This circuit is not series–parallel.'))
  let tree = flat(sp.tree)
  const a = view.action ?? {}
  const nCollapse = typeof a.collapsed === 'number' ? a.collapsed : 0
  for (const r of sp.steps.slice(0, nCollapse)) tree = flat(collapse(tree, r.members, r.name))
  const hl = new Set<string>(Array.isArray(a.highlight) ? a.highlight.map(String) : [])
  const answersOn = view.answers !== false
  const showI = answersOn && (a.currents === 'all' || view.reveal) ? 'all' : answersOn && Array.isArray(a.currents) ? 'some' : 'none'
  const flow = answersOn && (a.flow === true || view.reveal)
  const kvl = a.kvl === true, kcl = a.kcl === true
  const loopLeaves = new Set<string>()
  const markLoop = (t: Tree) => { if ('leaf' in t) loopLeaves.add(t.leaf); else if ('par' in t) markLoop(t.par[0]); else t.ser.forEach(markLoop) }
  if (kvl) markLoop(tree)
  const valueOf = (id: string) => scope[id]
  const unknownR = new Set((spec?.unknowns ?? []).map(u => u.name))
  const I = (id: string) => scope[`I_${id}`] ?? (id === 'top' ? scope.I : undefined)

  type M = Tree & { w: number; up: number; down: number; kids?: M[] }
  function measure(t: Tree): M {
    if ('leaf' in t) return { ...t, w: LEAF_W, up: UP, down: DOWN }
    if ('ser' in t) { const k = t.ser.map(measure); return { ...t, kids: k, w: k.reduce((s, c) => s + c.w, 0), up: Math.max(...k.map(c => c.up)), down: Math.max(...k.map(c => c.down)) } }
    const k = t.par.map(measure); const inner = Math.max(...k.map(c => c.w))
    let down = k[0].down; for (let i = 1; i < k.length; i++) down += GAP + k[i].up + k[i].down
    return { ...t, kids: k, w: inner + 2 * RAIL, up: k[0].up, down }
  }
  const parts: string[] = [], over: string[] = [], dots: [number, number][] = [], flows: string[] = []
  const L = (x1: number, y1: number, x2: number, y2: number) => parts.push(`<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}"/>`)
  const Imax = Math.max(1e-9, ...Object.entries(scope).filter(([k]) => /^I(_|$)/.test(k)).map(([, v]) => Math.abs(v)))
  const flowPath = (d: string, cur: number | undefined) => {
    if (!flow || cur === undefined || !(Math.abs(cur) > 1e-9)) return
    const dur = Math.min(4, Math.max(0.5, 0.9 * Imax / Math.abs(cur)))
    flows.push(`<path class="flow" d="${d}" style="animation-duration:${dur.toFixed(2)}s"/>`)
  }
  function leafAt(id: string, x: number, y: number, dir: 1 | -1) {
    const lead = 26, body = LEAF_W - 2 * lead
    const eq = !net.parts.some(p => p.id === id)
    const on = hl.has(id) || (eq && hl.size === 0 && false)
    const loop = loopLeaves.has(id)
    parts.push(`<g data-el="${id}">`)
    if (on) parts.push(`<rect x="${f1(x + lead - 9)}" y="${f1(y - 17)}" width="${f1(body + 18)}" height="34" rx="9" fill="${HL}" fill-opacity="0.6"/>`)
    if (loop) parts.push(`<rect x="${f1(x + 4)}" y="${f1(y - 17)}" width="${f1(LEAF_W - 8)}" height="34" rx="9" fill="${SOFT}" stroke="${ACC}" stroke-width="1.4" stroke-dasharray="4 4"/>`)
    L(x, y, x + lead, y); L(x + LEAF_W - lead, y, x + LEAF_W, y)
    if (eq) parts.push(`<rect x="${f1(x + lead)}" y="${f1(y - 11)}" width="${body}" height="22" rx="3" fill="${SOFT}" stroke="${ACC}" stroke-width="2.6"/>`)
    else {
      const zz: string[] = []; const n = 6
      for (let i = 0; i <= n * 2; i++) { const px = x + lead + body * i / (n * 2); const py = i === 0 || i === n * 2 ? y : y + (i % 2 ? -10 : 10); zz.push(`${f1(px)},${f1(py)}`) }
      parts.push(`<polyline points="${zz.join(' ')}" fill="none" stroke="${on ? CLAY : INK}" stroke-width="${on ? 3 : 2.4}" stroke-linejoin="round"/>`)
    }
    const v = valueOf(id)
    const lab = unknownR.has(id) && !view.reveal ? `${sub(id)} = ?` : v === undefined ? sub(id) : `${sub(id)} = ${fmt(v)} Ω`
    parts.push(text(x + LEAF_W / 2, y - 24, lab, eq ? 'acc' : 'lbl'))
    const cur = I(id)
    flowPath(dir === 1 ? `M${f1(x)},${f1(y)} H${f1(x + LEAF_W)}` : `M${f1(x + LEAF_W)},${f1(y)} H${f1(x)}`, cur)
    if ((showI === 'all') && cur !== undefined) {
      const ax = x + LEAF_W / 2, ay = y + 26
      parts.push(arrow(ax - 14 * dir, ay, ax + 14 * dir, ay, ACC, 2.2, 8))
      parts.push(text(ax, ay + 19, `${fmt(Math.abs(cur))} A`, 'acc'))
    }
    parts.push('</g>')
  }
  function draw(t: M, x: number, y: number) {
    if ('leaf' in t) return leafAt(t.leaf, x, y, 1)
    if ('ser' in t) { let cx = x; for (const k of t.kids!) { draw(k, cx, y); cx += k.w } return }
    const inner = t.w - 2 * RAIL; let cy = y; const ys: number[] = []
    t.kids!.forEach((k, i) => {
      if (i > 0) cy += t.kids![i - 1].down + GAP + k.up
      ys.push(cy)
      const off = (inner - k.w) / 2
      L(x + RAIL, cy, x + RAIL + off, cy); L(x + RAIL + off + k.w, cy, x + t.w - RAIL, cy)
      const kc = 'leaf' in k ? I(k.leaf) : I((k as { name?: string }).name ?? '')
      if (i > 0) { flowPath(`M${f1(x + RAIL)},${f1(ys[0])} V${f1(cy)} H${f1(x + RAIL + off)}`, kc); flowPath(`M${f1(x + RAIL + off + k.w)},${f1(cy)} H${f1(x + t.w - RAIL)} V${f1(ys[0])}`, kc) }
      draw(k, x + RAIL + off, cy)
    })
    L(x, y, x + RAIL, y); L(x + t.w - RAIL, y, x + t.w, y)
    L(x + RAIL, ys[0], x + RAIL, ys[ys.length - 1]); L(x + t.w - RAIL, ys[0], x + t.w - RAIL, ys[ys.length - 1])
    dots.push([x + RAIL, ys[0]], [x + t.w - RAIL, ys[0]])
    if (kcl && !over.length) {
      const jx = x + RAIL, jy = ys[0]
      over.push(`<circle cx="${f1(jx)}" cy="${f1(jy)}" r="15" fill="none" stroke="${CLAY}" stroke-width="2.6"/>`)
      const kids = t.kids!.map(k => ('leaf' in k ? k.leaf : (k as { name?: string }).name ?? ''))
      const inI = scope.I, outs = kids.map(k => I(k))
      if (answersOn && inI !== undefined && outs.every(o => o !== undefined)) over.push(text(jx, jy - 40 - 0, `${fmt(inI)} = ${outs.map(o => fmt(o!)).join(' + ')} ✓`, 'acc', `style="fill:${CLAY}"`))
    }
  }
  // fold trailing single resistors of a long chain onto the bottom wire so the drawing stays narrow on a phone
  let bottom: string[] = []
  let topTree: Tree = tree
  const MAXW = 420
  if ('ser' in tree) {
    const kids = [...tree.ser]
    const width = (ts: Tree[]) => ts.reduce((s, k) => s + measure(k).w, 0)
    while (kids.length > 1 && width(kids) > MAXW && 'leaf' in kids[kids.length - 1]) bottom.unshift((kids.pop() as { leaf: string }).leaf)
    topTree = kids.length === 1 ? kids[0] : { ...tree, ser: kids }
  }
  bottom = bottom.reverse()
  const m = measure(topTree)
  const PAD = 16, SRC_X = PAD + 84, NET_X = SRC_X + 34
  const bottomW = bottom.length * LEAF_W
  const netW = Math.max(m.w, bottomW)
  const yTop = PAD + m.up + 6
  const yBot = yTop + Math.max(m.down + 28, 120) + (bottom.length ? 30 : 0)
  const xR = NET_X + netW + 30
  const W = xR + PAD + 6, H = yBot + (bottom.length ? DOWN + 8 : 34) + PAD
  draw(m, NET_X + (netW - m.w) / 2, yTop)
  const top = scope.I
  L(SRC_X, yTop, NET_X + (netW - m.w) / 2, yTop); L(NET_X + (netW - m.w) / 2 + m.w, yTop, xR, yTop); L(xR, yTop, xR, yBot)
  flowPath(`M${f1(SRC_X)},${f1(yTop)} H${f1(NET_X + (netW - m.w) / 2)}`, top)
  flowPath(`M${f1(NET_X + (netW - m.w) / 2 + m.w)},${f1(yTop)} H${f1(xR)} V${f1(yBot)}`, top)
  if (bottom.length) {
    const bx0 = NET_X + (netW - bottomW) / 2
    L(xR, yBot, bx0 + bottomW, yBot); L(bx0, yBot, SRC_X, yBot)
    flowPath(`M${f1(xR)},${f1(yBot)} H${f1(bx0 + bottomW)}`, top)
    bottom.forEach((id, i) => leafAt(id, bx0 + bottomW - (i + 1) * LEAF_W, yBot, -1))
    flowPath(`M${f1(bx0)},${f1(yBot)} H${f1(SRC_X)} V${f1(yTop)}`, top)
  } else { L(xR, yBot, SRC_X, yBot); flowPath(`M${f1(xR)},${f1(yBot)} H${f1(SRC_X)} V${f1(yTop)}`, top) }
  // battery on the left
  const src = sp.source, mid = (yTop + yBot) / 2
  const sOn = hl.has(src.id)
  parts.push(`<g data-el="${src.id}">`)
  L(SRC_X, yTop, SRC_X, mid - 7); L(SRC_X, mid + 7, SRC_X, yBot)
  if (sOn) parts.push(`<rect x="${SRC_X - 30}" y="${mid - 18}" width="60" height="36" rx="9" fill="${HL}" fill-opacity="0.6"/>`)
  parts.push(`<line x1="${SRC_X - 22}" y1="${mid - 7}" x2="${SRC_X + 22}" y2="${mid - 7}" style="stroke-width:2.8"/><line x1="${SRC_X - 11}" y1="${mid + 7}" x2="${SRC_X + 11}" y2="${mid + 7}" style="stroke-width:6"/>`)
  parts.push(text(SRC_X + 30, mid - 12, '+', 'lbl'))
  parts.push(text(SRC_X - 34, mid - 2, sub(src.id), 'lbl', 'text-anchor="end" style="text-anchor:end"'))
  parts.push(text(SRC_X - 34, mid + 19, `${fmt(valueOf(src.id) ?? 0)} V`, 'lbl', 'style="text-anchor:end"'))
  if (showI !== 'none' && top !== undefined) {
    const ay = (yTop + mid) / 2 + 4
    parts.push(arrow(SRC_X + 14, ay + 14, SRC_X + 14, ay - 14, ACC, 2.2, 8))
    parts.push(text(SRC_X + 22, ay + 6, `I = ${fmt(top)} A`, 'acc', 'style="text-anchor:start"'))
  }
  parts.push('</g>')
  if (kvl) {
    const cx = NET_X + 52, cy = Math.max(mid + 18, yTop + 92)
    over.push(`<path d="M${f1(cx + 16)},${f1(cy - 8)} A17,17 0 1 1 ${f1(cx + 2)},${f1(cy - 17)}" fill="none" stroke="${CLAY}" stroke-width="2.6"/><path d="M${f1(cx + 2)},${f1(cy - 17)} l9,-5 l-1,10 z" fill="${CLAY}"/>`)
  }
  const dotSvg = dots.map(([x, y]) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="4" fill="${INK}"/>`).join('')
  void FLOW
  return frame(W, H, `${parts.join('\n')}\n${flows.join('')}\n${dotSvg}${over.join('')}`)
}
const fmt = (v: number) => { const r = Math.round(v * 1000) / 1000; return Number.isInteger(r) ? String(r) : String(Number(r.toPrecision(3))) }

/* ───────── plugin ───────── */

export const circuitPlugin: Plugin = {
  type: 'circuit',
  match: /\b(circuit|resistor|ohm'?s?|series|parallel|kirchhoff|current|voltage|battery|emf)\b/i,
  prompt: `"circuit": DC resistor network with ONE battery. {"type":"circuit","components":[{"id":"V1","type":"V","nodes":["a","0"],"value":12},{"id":"R1","type":"R","nodes":["a","b"],"value":4},{"id":"R2","type":"R","nodes":["b","0"],"value":6},{"id":"R3","type":"R","nodes":["b","0"],"value":12}]} — ids V1, R1, R2…; "nodes" name the two junctions each part joins (two parts on the same pair = parallel); battery + terminal first. Series–parallel only (no bridges), 2–5 resistors, values in volts/ohms giving tidy answers. CODE WRITES THE SOLUTION STEPS: leave "steps": [] and "givens": []. "answer.name" must be one of: "R_eq", "I" (battery current), "I_R2" (current through R2), "V_R2" (voltage across R2). Unknowns use the same names.`,
  prepare(d, spec) {
    const net = netOf(d)
    const errs = validateNet(net)
    if (errs.length) return errs
    for (const p of net.parts) {
      if (p.value === undefined || !(p.value > 0)) { errs.push(`${p.id} needs a positive "value"`); continue }
      if (!spec.givens.some(g => g.name === p.id)) spec.givens.push({ name: p.id, value: p.value, unit: p.type === 'V' ? 'V' : 'Ω', label: p.type === 'V' ? 'battery' : `resistor ${p.id}`, vary: p.type === 'V' ? { min: 3, max: 24, step: 1.5 } : { min: 1, max: Math.max(24, p.value * 2), step: 1 } } as Given)
    }
    if (!reduceSP(net)) errs.push('the circuit must be series–parallel (no bridge)')
    const ids = new Set(net.parts.map(p => p.id))
    const extra = spec.givens.filter(g => !ids.has(g.name))
    if (extra.length) errs.push(`givens must be the part ids only (${[...ids].join(', ')}); remove ${extra.map(g => g.name).join(', ')} and write {{${net.parts[0].id}}} etc. in the statement`)
    return errs
  },
  derive(d, spec) {
    const net = netOf(d)
    const r = deriveSteps(net)
    if (!r) return null
    return { steps: r.steps, mistakes: mistakesFor(spec.answer.name, net, r) }
  },
  facts(d, scope) {
    const net = netOf(d)
    const sol = solveMNA(net, id => Q.of(Number((scope[id] ?? 0).toPrecision(12))))
    const out: Record<string, number> = {}
    for (const p of net.parts) { out[`mna_I_${p.id}`] = sol.I[p.id].abs().num(); out[`mna_V_${p.id}`] = sol.Vd[p.id].abs().num() }
    return out
  },
  crossCheck(d, _spec, scope, _answer, strict) {
    const net = netOf(d)
    const issues: string[] = []
    const src = net.parts.find(p => p.type === 'V')!
    const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
    if ('I' in scope && !close(scope.I, scope[`mna_I_${src.id}`])) issues.push(`series–parallel current ${scope.I} disagrees with nodal analysis ${scope[`mna_I_${src.id}`]}`)
    for (const p of net.parts.filter(p => p.type === 'R')) {
      if (`I_${p.id}` in scope && !close(scope[`I_${p.id}`], scope[`mna_I_${p.id}`])) issues.push(`I_${p.id} disagrees with nodal analysis`)
      if (`V_${p.id}` in scope && !close(scope[`V_${p.id}`], scope[`mna_V_${p.id}`])) issues.push(`V_${p.id} disagrees with nodal analysis`)
    }
    // school circuits: tidy answers (at most 2 decimals) for every current and voltage the steps show
    const untidy = Object.entries(scope).filter(([k, v]) => /^(I|R_eq|I_R\d+|V_R\d+)$/.test(k) && Math.abs(v * 1000 - Math.round(v * 1000)) > 1e-6)
    if (strict && untidy.length && net.parts.every(p => Number.isInteger(scope[p.id] ?? 0.5))) issues.push(`pick part values that give tidy answers: ${untidy.slice(0, 3).map(([k, v]) => `${k} = ${Math.round(v * 1000) / 1000}…`).join(', ')}`)
    // power balance
    let pr = 0; for (const p of net.parts.filter(p => p.type === 'R')) pr += scope[`mna_I_${p.id}`] ** 2 * scope[p.id]
    if (!close(pr, scope[src.id] * scope[`mna_I_${src.id}`])) issues.push('power balance fails')
    return issues
  },
  render: (d, scope, view, spec) => renderCircuit(netOf(d), scope, view, spec),
}

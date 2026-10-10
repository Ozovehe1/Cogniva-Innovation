/**
 * Series / parallel circuits for the Falstad CircuitJS1 embed: a small spec the tutor writes (a battery and a loop of
 * parts, each part one resistor or a parallel group of arms, each arm a series of resistors) → a CircuitJS netlist
 * laid out on its 16-px grid, plus an exact solution (equivalent resistance, every resistor's V and I) that the tutor
 * talks from and that the browser compares with the simulator's own live read-back (the self-check). Shared.
 */

export interface CircuitR { label: string; ohms: number }
export type CircuitPart = { r: CircuitR } | { parallel: CircuitR[][] }
export interface CircuitSpec { volts: number; parts: CircuitPart[]; title?: string }

export interface CircuitSolution {
  req: number
  current: number
  resistors: { label: string; ohms: number; volts: number; amps: number }[]
  topology: 'series' | 'parallel' | 'mixed'
}

const r4 = (x: number) => Number(x.toPrecision(4))

/** Validate and normalise a spec from the model (labels R1.., ohms 0.1..1e6, ≤ 8 resistors, ≤ 4 arms). */
export function parseCircuit(a: Record<string, unknown>): { spec?: CircuitSpec; error?: string } {
  const volts = Number(a.volts ?? a.voltage ?? a.battery)
  if (!Number.isFinite(volts) || volts <= 0 || volts > 1000) return { error: 'volts must be a number between 0 and 1000' }
  const raw = Array.isArray(a.parts) ? a.parts : null
  if (!raw?.length) return { error: 'parts: give the loop in order, e.g. [{"r":{"label":"R1","ohms":4}},{"parallel":[[{"label":"R2","ohms":6}],[{"label":"R3","ohms":3}]]}]' }
  let n = 0
  const res = (x: unknown): CircuitR | null => {
    const o = (x ?? {}) as Record<string, unknown>
    const ohms = Number(o.ohms ?? o.R ?? o.r ?? o.value)
    if (!Number.isFinite(ohms) || ohms <= 0 || ohms > 1e6) return null
    n++
    return { label: String(o.label ?? `R${n}`).slice(0, 8), ohms }
  }
  const parts: CircuitPart[] = []
  for (const p of raw.slice(0, 6)) {
    const o = (p ?? {}) as Record<string, unknown>
    if (Array.isArray(o.parallel)) {
      const arms = (o.parallel as unknown[]).slice(0, 4).map(arm => (Array.isArray(arm) ? arm : [arm]).slice(0, 3).map(res))
      if (arms.length < 2 || arms.some(arm => !arm.length || arm.some(x => !x))) return { error: 'a parallel group needs 2-4 arms, each a list of resistors with ohms > 0' }
      parts.push({ parallel: arms as CircuitR[][] })
    } else {
      const r = res(o.r ?? o)
      if (!r) return { error: 'each series part is {"r":{"label":"R1","ohms":4}} with ohms > 0' }
      parts.push({ r })
    }
  }
  if (n > 8) return { error: 'at most 8 resistors' }
  return { spec: { volts, parts, title: typeof a.title === 'string' ? a.title.slice(0, 80) : undefined } }
}

export function solveCircuit(c: CircuitSpec): CircuitSolution {
  const armR = (arm: CircuitR[]) => arm.reduce((s, r) => s + r.ohms, 0)
  const partR = (p: CircuitPart) => ('r' in p ? p.r.ohms : 1 / p.parallel.reduce((s, arm) => s + 1 / armR(arm), 0))
  const req = c.parts.reduce((s, p) => s + partR(p), 0)
  const current = c.volts / req
  const resistors: CircuitSolution['resistors'] = []
  for (const p of c.parts) {
    if ('r' in p) resistors.push({ label: p.r.label, ohms: p.r.ohms, volts: r4(current * p.r.ohms), amps: r4(current) })
    else {
      const vp = current * partR(p)
      for (const arm of p.parallel) { const ia = vp / armR(arm); for (const r of arm) resistors.push({ label: r.label, ohms: r.ohms, volts: r4(ia * r.ohms), amps: r4(ia) }) }
    }
  }
  const hasPar = c.parts.some(p => 'parallel' in p)
  const topology = !hasPar ? 'series' : c.parts.length === 1 ? 'parallel' : 'mixed'
  return { req: r4(req), current: r4(current), resistors, topology }
}

/** The CircuitJS netlist: battery on the left, the parts left→right along the top, the return along the bottom. */
export function circuitNetlist(c: CircuitSpec): string {
  const G = 16, W = 8 * G, TOP = 6 * G, ARM = 6 * G, X0 = 6 * G
  const L: string[] = ['$ 1 0.000005 10.20027730826997 50 5 50 5e-11']
  const wire = (x1: number, y1: number, x2: number, y2: number) => { if (x1 !== x2 || y1 !== y2) L.push(`w ${x1} ${y1} ${x2} ${y2} 0`) }
  const resistor = (x1: number, y: number, r: CircuitR) => {
    L.push(`r ${x1} ${y} ${x1 + W} ${y} 0 ${r.ohms}`)
    L.push(`x ${x1 + W / 2 - 10} ${y - 22} ${x1 + W / 2 + 10} ${y - 18} 4 14 ${r.label.replace(/\s/g, '\\s')}`)
  }
  let x = X0
  let maxArms = 1
  for (const p of c.parts) {
    wire(x, TOP, x + 2 * G, TOP); x += 2 * G
    if ('r' in p) { resistor(x, TOP, p.r); x += W }
    else {
      const span = Math.max(...p.parallel.map(arm => arm.length)) * W
      maxArms = Math.max(maxArms, p.parallel.length)
      p.parallel.forEach((arm, k) => {
        const y = TOP + k * ARM
        let ax = x
        for (const r of arm) { resistor(ax, y, r); ax += W }
        wire(ax, y, x + span, y)
        if (k > 0) { wire(x, y - ARM, x, y); wire(x + span, y - ARM, x + span, y) }
      })
      x += span
    }
  }
  wire(x, TOP, x + 2 * G, TOP); x += 2 * G
  const BOTTOM = TOP + maxArms * ARM + 2 * G
  wire(x, TOP, x, BOTTOM)
  wire(x, BOTTOM, X0, BOTTOM)
  // DC source: from the bottom (−) up to the top (+).
  L.push(`v ${X0} ${BOTTOM} ${X0} ${TOP} 0 0 40 ${c.volts} 0 0 0.5`)
  return `${L.join('\n')}\n`
}

/** Compare the simulator's read-back (resistor V and I, any order) with the exact solution. */
export function checkReadings(sol: CircuitSolution, readings: { type: string; v: number; a: number }[], tol = 0.03): { ok: boolean; issues: string[] } {
  const rs = readings.filter(r => /Resistor/i.test(r.type))
  const issues: string[] = []
  if (rs.length !== sol.resistors.length) issues.push(`simulator shows ${rs.length} resistors, the circuit has ${sol.resistors.length}`)
  const want = sol.resistors.map(r => Math.abs(r.amps)).sort((a, b) => a - b)
  const got = rs.map(r => Math.abs(r.a)).sort((a, b) => a - b)
  for (let i = 0; i < Math.min(want.length, got.length); i++) {
    if (Math.abs(want[i] - got[i]) > tol * Math.max(want[i], 1e-6)) { issues.push(`current ${got[i].toFixed(3)} A where ${want[i].toFixed(3)} A was expected`); break }
  }
  return { ok: issues.length === 0, issues }
}

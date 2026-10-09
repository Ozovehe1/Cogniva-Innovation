/**
 * A triangle with known side lengths is drawn to scale, not laid out by Penrose (whose geometry library treats lengths
 * and labels as free layout: a "3-4-5" triangle came out 3 : 3.6 : 4.7 with "5" next to a leg). Read from the Substance
 * program: Triangle(A, B, C), side lengths as Length(A, B, 3) or as a numeric Label on a Midpoint of that side, and an
 * optional RightAngle(X, Y, Z). Each side label sits outside its own side, each vertex label outside its own vertex.
 */
export interface ExactTriangle { svg: string; width: number; height: number; warnings: string[]; sides: Record<string, number> }

type P = [number, number]
const key = (a: string, b: string) => [a, b].sort().join('')
const NUM = /^-?\d+(?:\.\d+)?$/

export function parseTriangle(substance: string): { tri: [string, string, string]; len: Map<string, number>; right: string | null; labels: Map<string, string>; lengthLines: boolean } | null {
  const lines = substance.split('\n').map(l => l.trim()).filter(Boolean)
  let tri: [string, string, string] | null = null
  const len = new Map<string, number>()
  const mids = new Map<string, string>()
  const labels = new Map<string, string>()
  let right: string | null = null
  let lengthLines = false
  for (const l of lines) {
    let m: RegExpMatchArray | null
    if ((m = l.match(/^Triangle\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)$/))) tri = [m[1], m[2], m[3]]
    else if ((m = l.match(/^Length\(\s*(\w+)\s*,\s*(\w+)\s*,\s*"?(-?\d+(?:\.\d+)?)"?\s*\)$/))) { len.set(key(m[1], m[2]), Number(m[3])); lengthLines = true }
    else if ((m = l.match(/^Midpoint\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)$/))) mids.set(m[1], key(m[2], m[3]))
    else if ((m = l.match(/^RightAngle\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)$/))) right = m[2]
    else if ((m = l.match(/^Label\s+(\w+)\s+"([^"]*)"$/))) labels.set(m[1], m[2])
  }
  if (!tri) return null
  for (const [mid, side] of mids) {
    const t = labels.get(mid)?.trim()
    if (t && NUM.test(t) && !len.has(side)) len.set(side, Number(t))
  }
  return { tri, len, right, labels, lengthLines }
}

const fmt = (v: number) => String(Number(v.toPrecision(6)))

/** Exact SVG of the triangle, or null when the program is not a triangle with enough known lengths. */
export function exactTriangle(substance: string): ExactTriangle | null {
  const p = parseTriangle(substance)
  if (!p) return null
  const [A, B, C] = p.tri
  const warnings: string[] = []
  let ab = p.len.get(key(A, B)), bc = p.len.get(key(B, C)), ca = p.len.get(key(C, A))
  // Two legs and a right angle give the hypotenuse.
  if (p.right) {
    const legs: Record<string, [number | undefined, number | undefined, 'ab' | 'bc' | 'ca']> = { [A]: [ab, ca, 'bc'], [B]: [ab, bc, 'ca'], [C]: [bc, ca, 'ab'] }
    const g = legs[p.right]
    if (g && g[0] && g[1]) {
      const h = Math.hypot(g[0], g[1])
      if (g[2] === 'bc' && !bc) bc = h
      if (g[2] === 'ca' && !ca) ca = h
      if (g[2] === 'ab' && !ab) ab = h
    }
  }
  if (!ab || !bc || !ca || ab <= 0 || bc <= 0 || ca <= 0) return null
  if (ab + bc <= ca || bc + ca <= ab || ca + ab <= bc) return null
  // Vertex positions (maths axes, y up). Right angle: its legs lie along the axes. Otherwise the longest side is the base.
  const sides: Record<string, number> = { [key(A, B)]: ab, [key(B, C)]: bc, [key(C, A)]: ca }
  const L = (u: string, v: string) => sides[key(u, v)]
  let rightOk = false
  if (p.right && [A, B, C].includes(p.right)) {
    const [u, v] = [A, B, C].filter(x => x !== p.right)
    const hyp = L(u, v), a = L(p.right, u), b = L(p.right, v)
    rightOk = Math.abs(a * a + b * b - hyp * hyp) <= 1e-6 * hyp * hyp + 1e-9
    if (!rightOk) warnings.push(`sides ${fmt(a)}, ${fmt(b)}, ${fmt(hyp)} do not make a right angle at ${p.right} (${fmt(a)}² + ${fmt(b)}² = ${fmt(a * a + b * b)}, ${fmt(hyp)}² = ${fmt(hyp * hyp)}); drawn to the given lengths without a right-angle mark`)
  }
  const pos: Record<string, P> = {}
  if (rightOk) {
    const r = p.right!
    const [u, v] = [A, B, C].filter(x => x !== r)
    // The longer leg along the bottom (a stable, familiar orientation).
    const [h, w] = L(r, u) >= L(r, v) ? [v, u] : [u, v]
    pos[r] = [0, 0]; pos[w] = [L(r, w), 0]; pos[h] = [0, L(r, h)]
  } else {
    const pairs: [string, string, string][] = [[A, B, C], [B, C, A], [C, A, B]]
    const [u, v, w] = pairs.reduce((best, q) => (L(q[0], q[1]) > L(best[0], best[1]) ? q : best))
    const c = L(u, v), b = L(u, w), a = L(v, w)
    const x = (b * b + c * c - a * a) / (2 * c)
    pos[u] = [0, 0]; pos[v] = [c, 0]; pos[w] = [x, Math.sqrt(Math.max(0, b * b - x * x))]
  }
  // To SVG units: the longest extent maps to 360, with a margin for labels.
  const xs = Object.values(pos).map(q => q[0]), ys = Object.values(pos).map(q => q[1])
  const ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  const k = 360 / ext, M = 64
  const minX = Math.min(...xs), maxY = Math.max(...ys)
  const S = (q: P): P => [M + (q[0] - minX) * k, M + (maxY - q[1]) * k]
  const sp: Record<string, P> = Object.fromEntries(Object.entries(pos).map(([n, q]) => [n, S(q)]))
  const W = Math.round((Math.max(...xs) - minX) * k + 2 * M), H = Math.round((maxY - Math.min(...ys)) * k + 2 * M)
  const cen: P = [(sp[A][0] + sp[B][0] + sp[C][0]) / 3, (sp[A][1] + sp[B][1] + sp[C][1]) / 3]
  const out = (q: P, d: number): P => { const vx = q[0] - cen[0], vy = q[1] - cen[1], n = Math.hypot(vx, vy) || 1; return [q[0] + vx / n * d, q[1] + vy / n * d] }
  const INK = '#14141A', NAVY = '#23406A', CLAY = '#A4502A'
  const parts: string[] = []
  parts.push(`<polygon points="${[A, B, C].map(n => sp[n].map(v => v.toFixed(1)).join(',')).join(' ')}" fill="rgba(31,77,58,0.08)" stroke="${NAVY}" stroke-width="3" stroke-linejoin="round"/>`)
  if (rightOk) {
    const r = sp[p.right!]
    const [u, v] = [A, B, C].filter(x => x !== p.right).map(n => sp[n])
    const unit = (q: P): P => { const dx = q[0] - r[0], dy = q[1] - r[1], n = Math.hypot(dx, dy); return [dx / n, dy / n] }
    const e1 = unit(u), e2 = unit(v), s = 22
    parts.push(`<polyline points="${(r[0] + e1[0] * s).toFixed(1)},${(r[1] + e1[1] * s).toFixed(1)} ${(r[0] + (e1[0] + e2[0]) * s).toFixed(1)},${(r[1] + (e1[1] + e2[1]) * s).toFixed(1)} ${(r[0] + e2[0] * s).toFixed(1)},${(r[1] + e2[1] * s).toFixed(1)}" fill="none" stroke="${CLAY}" stroke-width="2.2"/>`)
  }
  const text = (q: P, t: string, color: string, size: number) => `<text x="${q[0].toFixed(1)}" y="${(q[1] + size * 0.35).toFixed(1)}" text-anchor="middle" font-size="${size}" font-family="Inter, system-ui, sans-serif" fill="${color}">${t.replace(/[<&>]/g, '')}</text>`
  // Side labels: outside the side, on the perpendicular through its midpoint.
  for (const [u, v] of [[A, B], [B, C], [C, A]] as [string, string][]) {
    const m: P = [(sp[u][0] + sp[v][0]) / 2, (sp[u][1] + sp[v][1]) / 2]
    let nx = -(sp[v][1] - sp[u][1]), ny = sp[v][0] - sp[u][0]
    const n = Math.hypot(nx, ny) || 1; nx /= n; ny /= n
    if ((m[0] - cen[0]) * nx + (m[1] - cen[1]) * ny < 0) { nx = -nx; ny = -ny }
    parts.push(text([m[0] + nx * 26, m[1] + ny * 26], fmt(L(u, v)), INK, 30))
  }
  for (const n of [A, B, C]) parts.push(text(out(sp[n], 26), (p.labels.get(n) ?? n).slice(0, 6), NAVY, 26))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`
  return { svg, width: W, height: H, warnings, sides: { [`${A}${B}`]: ab, [`${B}${C}`]: bc, [`${C}${A}`]: ca } }
}

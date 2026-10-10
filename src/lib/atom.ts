/**
 * Exact school atom diagrams (Bohr / shell model) for atomic structure: protons, neutrons, electrons, shells, isotopes
 * and ions. Deterministic: the shell counts come from the element's atomic number (school rule 2, 8, 8, 2 up to
 * calcium; ground-state shell totals beyond it), so a drawing can never show 11 electrons for beryllium.
 * Used by the atom_diagram tool (live tutor, sheet, Ask) and by lesson drafting (lesson-beats.ts) when a beat names an
 * element or isotope. Shared (no server imports).
 */

/** [symbol, name, most common mass number] for Z = 1..36. */
export const ELEMENTS: [string, string, number][] = [
  ['H', 'hydrogen', 1], ['He', 'helium', 4], ['Li', 'lithium', 7], ['Be', 'beryllium', 9], ['B', 'boron', 11],
  ['C', 'carbon', 12], ['N', 'nitrogen', 14], ['O', 'oxygen', 16], ['F', 'fluorine', 19], ['Ne', 'neon', 20],
  ['Na', 'sodium', 23], ['Mg', 'magnesium', 24], ['Al', 'aluminium', 27], ['Si', 'silicon', 28], ['P', 'phosphorus', 31],
  ['S', 'sulfur', 32], ['Cl', 'chlorine', 35], ['Ar', 'argon', 40], ['K', 'potassium', 39], ['Ca', 'calcium', 40],
  ['Sc', 'scandium', 45], ['Ti', 'titanium', 48], ['V', 'vanadium', 51], ['Cr', 'chromium', 52], ['Mn', 'manganese', 55],
  ['Fe', 'iron', 56], ['Co', 'cobalt', 59], ['Ni', 'nickel', 58], ['Cu', 'copper', 63], ['Zn', 'zinc', 64],
  ['Ga', 'gallium', 69], ['Ge', 'germanium', 74], ['As', 'arsenic', 75], ['Se', 'selenium', 80], ['Br', 'bromine', 79], ['Kr', 'krypton', 84],
]
/** Ground-state electrons per shell (K, L, M, N) for Z 21..36 (d-block fills M after N starts). */
const SHELLS_21_36: number[][] = [
  [2, 8, 9, 2], [2, 8, 10, 2], [2, 8, 11, 2], [2, 8, 13, 1], [2, 8, 13, 2], [2, 8, 14, 2], [2, 8, 15, 2], [2, 8, 16, 2],
  [2, 8, 18, 1], [2, 8, 18, 2], [2, 8, 18, 3], [2, 8, 18, 4], [2, 8, 18, 5], [2, 8, 18, 6], [2, 8, 18, 7], [2, 8, 18, 8],
]

/** Electrons per shell for a neutral atom (z) or an ion with `electrons` electrons (filled in the same order). */
export function shellConfig(electrons: number, z = electrons): number[] {
  const e = Math.max(0, Math.min(36, Math.round(electrons)))
  if (z >= 21 && z <= 36 && e === z) return [...SHELLS_21_36[z - 21]]
  const caps = [2, 8, 8, 18]
  const out: number[] = []
  let left = e
  for (const c of caps) { if (left <= 0) break; const n = Math.min(c, left); out.push(n); left -= n }
  return out
}

export function elementOf(x: string | number | undefined | null): { z: number; symbol: string; name: string; mass: number } | null {
  if (x === undefined || x === null || x === '') return null
  const s = String(x).trim()
  let z = /^\d+$/.test(s) ? Number(s) : 0
  if (!z) {
    const k = ELEMENTS.findIndex(([sym, name]) => sym.toLowerCase() === s.toLowerCase() || name === s.toLowerCase() || (name === 'aluminium' && s.toLowerCase() === 'aluminum') || (name === 'sulfur' && s.toLowerCase() === 'sulphur'))
    z = k + 1
  }
  if (z < 1 || z > ELEMENTS.length) return null
  const [symbol, name, mass] = ELEMENTS[z - 1]
  return { z, symbol, name, mass }
}

export interface AtomSpec {
  z: number
  symbol: string
  name: string
  protons: number
  neutrons: number
  electrons: number
  shells: number[]
  mass: number
  charge: number
  /** Optional shells to highlight (1-based), e.g. the valence shell. */
  highlight?: number[]
}

/** Resolve an atom from an element (name, symbol or Z) and optional mass number / neutrons / charge. */
export function atomSpec(a: { element?: string | number; mass?: number; neutrons?: number; charge?: number; highlightValence?: boolean }): { spec?: AtomSpec; error?: string } {
  const el = elementOf(a.element)
  if (!el) return { error: 'element must be a name, symbol or atomic number from 1 to 36' }
  const charge = Number.isFinite(a.charge) ? Math.max(-4, Math.min(4, Math.round(a.charge!))) : 0
  const neutrons = Number.isFinite(a.neutrons) ? Math.round(a.neutrons!) : Number.isFinite(a.mass) ? Math.round(a.mass!) - el.z : el.mass - el.z
  if (neutrons < 0 || neutrons > 60) return { error: `neutrons must be 0-60 (mass number ${el.z + neutrons} is not possible for ${el.name})` }
  const electrons = el.z - charge
  if (electrons < 0) return { error: 'too large a positive charge' }
  const shells = shellConfig(electrons, el.z)
  return { spec: { z: el.z, symbol: el.symbol, name: el.name, protons: el.z, neutrons, electrons, shells, mass: el.z + neutrons, charge, highlight: a.highlightValence && shells.length ? [shells.length] : undefined } }
}

const esc = (s: string) => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!))

/** A clean labelled Bohr diagram: nucleus (p+, n), shells with the right number of electrons, configuration line. */
export function atomSvg(s: AtomSpec, opts: { w?: number; h?: number } = {}): string {
  const W = opts.w ?? 470, H = opts.h ?? 340
  const cx = 170, cy = H / 2
  const n = s.shells.length
  const rN = 30
  const step = n ? Math.min(42, (Math.min(cx, cy) - rN - 12) / n) : 0
  const parts: string[] = []
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`)
  s.shells.forEach((count, i) => {
    const r = rN + step * (i + 1)
    const hl = s.highlight?.includes(i + 1)
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="${hl ? '#d97706' : '#94a3b8'}" stroke-width="${hl ? 3 : 1.6}" stroke-dasharray="${hl ? '' : '5 4'}"/>`)
    for (let k = 0; k < count; k++) {
      // Pairs sit together (school drawing), spread evenly round the shell, starting at the top.
      const pair = Math.floor(k / 2), slots = Math.ceil(count / 2)
      const base = -Math.PI / 2 + (2 * Math.PI * pair) / slots
      const paired = 2 * pair + 1 < count
      const spread = Math.min(0.14, Math.PI / slots / 2.5)
      const ang = count <= 2 ? -Math.PI / 2 + Math.PI * k : paired ? base + (k % 2 ? spread : -spread) : base
      parts.push(`<circle class="e" cx="${(cx + r * Math.cos(ang)).toFixed(1)}" cy="${(cy + r * Math.sin(ang)).toFixed(1)}" r="5.5" fill="#2563eb"/>`)
    }
  })
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${rN}" fill="#fee2e2" stroke="#b91c1c" stroke-width="2"/>`)
  parts.push(`<text x="${cx}" y="${cy - 3}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="12" fill="#7f1d1d">${s.protons} p⁺</text>`)
  parts.push(`<text x="${cx}" y="${cy + 12}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="12" fill="#7f1d1d">${s.neutrons} n</text>`)
  const tx = 395
  const ion = s.charge ? `${Math.abs(s.charge) > 1 ? Math.abs(s.charge) : ''}${s.charge > 0 ? '+' : '−'}` : ''
  const lines = [
    [`${s.name[0].toUpperCase()}${s.name.slice(1)}${ion ? ` ion` : ''}`, 18, '#0f172a', 'bold'],
    [`${s.symbol}${ion ? ` ${ion}` : ''}, mass ${s.mass}`, 13, '#334155', 'normal'],
    [`${s.protons} protons`, 13, '#b91c1c', 'normal'],
    [`${s.neutrons} neutrons`, 13, '#7f1d1d', 'normal'],
    [`${s.electrons} electrons`, 13, '#2563eb', 'normal'],
    [`Shells: ${s.shells.join(', ')}`, 13, '#0f172a', 'bold'],
    ...(s.highlight?.length ? [[`Outer shell: ${s.shells[s.shells.length - 1]}`, 13, '#d97706', 'bold']] : []),
  ] as [string, number, string, string][]
  lines.forEach(([t, size, color, weight], i) => parts.push(`<text x="${tx}" y="${46 + i * 24}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(t)}</text>`))
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join('')}</svg>`
}

/** Count of electrons drawn in an atomSvg (the self-check). */
export const drawnElectrons = (svg: string) => (svg.match(/class="e"/g) ?? []).length

/** An element or isotope a text is about ("sodium", "carbon-14", "atomic number 12"), else null. First match wins. */
export function elementInText(text: string): { element: string; mass?: number } | null {
  const t = text.toLowerCase()
  const iso = /\b([a-z]+)[- ](\d{1,3})\b/.exec(t)
  if (iso && elementOf(iso[1]) && Number(iso[2]) >= elementOf(iso[1])!.z) return { element: iso[1], mass: Number(iso[2]) }
  const zm = /atomic number (?:of )?(\d{1,2})\b/.exec(t)
  if (zm && elementOf(zm[1])) return { element: zm[1] }
  let best: { i: number; name: string } | null = null
  for (const [, name] of ELEMENTS) {
    const m = new RegExp(`\\b${name}\\b`).exec(t)
    if (m && (!best || m.index < best.i)) best = { i: m.index, name }
  }
  return best ? { element: best.name } : null
}

/**
 * atom_diagram: an exact Bohr / shell diagram of an element, isotope or ion (lib/atom.ts). Protons, neutrons, electrons
 * and electrons per shell are computed from the atomic number, never written by a model, and the drawing is
 * self-checked (electrons drawn = electrons computed). For atomic structure, shells, valence electrons, isotopes, ions.
 */
import { randomUUID } from 'node:crypto'
import type { ToolSpec } from '@/lib/agent/tools'
import { atomSpec, atomSvg, drawnElectrons } from '@/lib/atom'

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })

export const atomTool: ToolSpec = {
  def: {
    name: 'atom_diagram',
    description: 'An exact labelled Bohr (shell) diagram of an atom: protons and neutrons in the nucleus, the right number of electrons on each shell, from the element (Z 1-36). Isotopes via masses (e.g. carbon [12, 14]), ions via charge. Returns the exact counts to talk from.',
    parameters: obj({
      element: { type: 'string', description: 'name, symbol or atomic number, e.g. "sodium", "Cl", "12"' },
      masses: { type: 'array', items: { type: 'number' }, description: 'mass numbers to compare isotopes, e.g. [12, 14] (max 3)' },
      charge: { type: 'number', description: 'ion charge, e.g. 1 for Na+, -1 for Cl-' },
      highlight_valence: { type: 'boolean' },
    }, ['element']),
  },
  tier: 'visual', modes: ['chat'], label: 'Drawing the atom',
  run: async (a, ctx) => {
    const masses = Array.isArray(a.masses) ? a.masses.map(Number).filter(Number.isFinite).slice(0, 3) : []
    const out: unknown[] = []
    for (const mass of masses.length ? masses : [undefined]) {
      const r = atomSpec({ element: a.element as string, mass, charge: Number(a.charge), highlightValence: a.highlight_valence !== false })
      if (!r.spec) return { error: r.error }
      const s = r.spec
      const svg = atomSvg(s)
      if (drawnElectrons(svg) !== s.electrons) return { error: 'atom drawing check failed' }
      const ion = s.charge ? ` ${s.charge > 0 ? '+' : '−'}${Math.abs(s.charge)} ion` : ''
      const alt = `Bohr diagram of ${s.name}${masses.length ? `-${s.mass}` : ''}${ion}: ${s.protons} protons and ${s.neutrons} neutrons in the nucleus, ${s.electrons} electrons in shells ${s.shells.join(', ')}`
      ctx.emit({ kind: 'svg', id: `a${randomUUID().slice(0, 8)}`, svg, alt })
      out.push({ element: s.name, symbol: s.symbol, atomic_number: s.z, mass_number: s.mass, protons: s.protons, neutrons: s.neutrons, electrons: s.electrons, shells: s.shells, valence_electrons: s.shells[s.shells.length - 1] ?? 0, charge: s.charge })
    }
    return { shown: true, atoms: out, note: 'Counts are exact (from the atomic number). Talk from them; point at the outer shell for valence.' }
  },
}

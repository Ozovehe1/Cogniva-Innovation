/**
 * Genetics: a Punnett square computed from the two parents' genotypes (one or two genes, complete dominance).
 * Code forms the gametes, fills every cell, and supplies the fractions as facts (p_AA, p_Aa, p_aa for one gene;
 * ph_dom / ph_rec for one gene, ph_DD, ph_Dr, ph_rD, ph_rr for two genes), so an answer like "3/4 purple" is
 * recomputed from the parents, never typed.
 */
import type { DiagramSpec } from '../spec'
import type { Plugin, DiagramView } from '../plugin'
import { ACC, CLAY, HL, INK, MUTED, SOFT, f1, frame, text } from '../svgkit'

function genes(g: string): string[] {
  const s = g.replace(/\s+/g, '')
  if (!/^[A-Za-z]{2}([A-Za-z]{2})?$/.test(s)) throw new Error(`genotype "${g}" must be 2 or 4 letters like Aa or AaBb`)
  const out: string[] = []
  for (let i = 0; i < s.length; i += 2) { if (s[i].toLowerCase() !== s[i + 1].toLowerCase()) throw new Error(`genotype "${g}": each gene is two letters of the same kind (Aa, BB)`); out.push(s.slice(i, i + 2)) }
  return out
}
function gametes(g: string): string[] {
  return genes(g).reduce<string[]>((acc, pair) => acc.flatMap(p => [p + pair[0], p + pair[1]]), [''])
}
const order = (a: string, b: string) => (a < b ? a + b : b + a) // uppercase sorts first: "Aa"
function child(g1: string, g2: string) { let s = ''; for (let i = 0; i < g1.length; i++) s += order(g1[i], g2[i]); return s }
function cross(d: DiagramSpec) {
  const p1 = String(d.p1 ?? ''), p2 = String(d.p2 ?? '')
  const a = genes(p1), b = genes(p2)
  if (a.length !== b.length || a.some((x, i) => x[0].toLowerCase() !== b[i][0].toLowerCase())) throw new Error('both parents must carry the same genes')
  const g1 = gametes(p1), g2 = gametes(p2)
  const cells = g1.map(x => g2.map(y => child(x, y)))
  return { p1, p2, g1, g2, cells, n: a.length }
}
const dom = (geno: string, i: number) => geno[2 * i] === geno[2 * i].toUpperCase()

export const punnettPlugin: Plugin = {
  type: 'punnett',
  match: /\b(punnett|genotype|phenotype|allele|dominant|recessive|heterozygous|homozygous|monohybrid|dihybrid|offspring|inherit\w*|cross)\b/i,
  prompt: `"punnett": {"type":"punnett","p1":"Aa","p2":"Aa","traits":{"A":"purple flowers","a":"white flowers"}} — one gene (Aa) or two (AaBb), complete dominance. Code fills the square and supplies fractions as facts: p_AA, p_Aa, p_aa (one gene; genotype letters in Aa order), ph_dom and ph_rec (fraction showing the dominant / recessive phenotype); for two genes ph_DD, ph_Dr, ph_rD, ph_rr (D = dominant, r = recessive for gene 1 then gene 2). Answer with these names (or a calc like "ph_rec*n" for a count). Step actions: {"fill":true} complete the square, {"highlight":"aa"} cells of one genotype, {"highlight":"dom"} or {"highlight":"rec"} cells of a phenotype.`,
  prepare(d) { try { cross(d); return [] } catch (e) { return [e instanceof Error ? e.message : String(e)] } },
  facts(d) {
    const c = cross(d)
    const flat = c.cells.flat(); const N = flat.length
    const out: Record<string, number> = {}
    for (const g of flat) out[`p_${g}`] = (out[`p_${g}`] ?? 0) + 1 / N
    if (c.n === 1) { out.ph_dom = flat.filter(g => dom(g, 0)).length / N; out.ph_rec = 1 - out.ph_dom }
    else for (const [k, f] of [['DD', [1, 1]], ['Dr', [1, 0]], ['rD', [0, 1]], ['rr', [0, 0]]] as const) out[`ph_${k}`] = flat.filter(g => (dom(g, 0) ? 1 : 0) === f[0] && (dom(g, 1) ? 1 : 0) === f[1]).length / N
    // make sure the usual genotype spellings exist (0 when absent)
    const L = String(d.p1 ?? 'Aa')[0].toUpperCase(), l = L.toLowerCase()
    if (c.n === 1) for (const g of [L + L, L + l, l + l]) out[`p_${g}`] = out[`p_${g}`] ?? 0
    return out
  },
  render(d, _scope, view: DiagramView) {
    const c = cross(d)
    const k = c.g1.length, cell = k === 2 ? 92 : 64
    const ox = 80, oy = 70
    const W = Math.max(400, ox + cell * k + 40), H = oy + cell * k + 60
    const traits = (d.traits && typeof d.traits === 'object' ? d.traits : {}) as Record<string, string>
    const fill = view.reveal || view.action?.fill === true || view.step >= 0 && Boolean(view.action?.highlight)
    const hi = typeof view.action?.highlight === 'string' ? String(view.action.highlight) : null
    const isHit = (g: string) => hi === g || (hi === 'dom' && dom(g, 0)) || (hi === 'rec' && !dom(g, 0)) || (hi !== null && /^[Dr]{2}$/.test(hi) && (dom(g, 0) === (hi[0] === 'D')) && (dom(g, 1) === (hi[1] === 'D')))
    const b: string[] = []
    b.push(text(ox + cell * k / 2, 24, `${c.p1}  ×  ${c.p2}`, 'lbl', 'style="font-size:20px;font-weight:700"'))
    c.g2.forEach((g, j) => b.push(text(ox + cell * j + cell / 2, oy - 12, g, 'acc', 'style="font-size:19px"')))
    c.g1.forEach((g, i) => b.push(text(ox - 14, oy + cell * i + cell / 2 + 7, g, 'acc', 'style="font-size:19px;text-anchor:end"')))
    b.push(text(ox - 40, oy - 30, 'gametes', 'lbl-s'))
    c.cells.forEach((row, i) => row.forEach((g, j) => {
      const x = ox + cell * j, y = oy + cell * i
      const hit = hi && isHit(g)
      const recessive = !dom(g, 0) && (c.n === 1 || !dom(g, 1))
      b.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${hit ? HL : fill ? (dom(g, 0) ? SOFT : '#F7EAE2') : '#FFFFFF'}" stroke="${INK}" stroke-width="2"/>`)
      if (fill) b.push(text(x + cell / 2, y + cell / 2 + 8, g, 'lbl', `style="font-size:${k === 2 ? 24 : 18}px;fill:${recessive ? CLAY : INK}"`))
    }))
    const tr = Object.entries(traits).slice(0, 4)
    if (tr.length) b.push(text(ox, oy + cell * k + 30, tr.map(([a, t]) => `${a}: ${t}`).join('   ').slice(0, 70), 'lbl-s', `style="text-anchor:start;fill:${MUTED}"`))
    void ACC; void f1
    return frame(W, H, b.join('\n'))
  },
}

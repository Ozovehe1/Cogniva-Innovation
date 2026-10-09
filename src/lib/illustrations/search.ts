/**
 * Keyword search over the free illustration library (src/lib/illustrations/library.json, built offline by
 * scripts/build-illustration-index.mjs): Bioicons, Servier Medical Art and Wikimedia Commons SVGs, each with its
 * own licence, author and source page. Server only.
 */
import type { LibraryItem } from './types'

let LIB: { items: LibraryItem[]; idf: Map<string, number>; toks: { t: Set<string>; k: Set<string> }[] } | null = null

const STOP = new Set('a an the of and or in on to for with by from at as is are be this that diagram diagrams illustration image picture labelled labeled label labels draw drawing show me simple structure parts part showing human svg icon vector its how what'.split(' '))
/** Labels in another language make a diagram useless to an English-speaking learner. */
const NEUTRAL = new Set('simple basic schematic model detailed complete drawing numbered clean version standalone cropped generic overview general whole'.split(' '))
const LANG = new Set('as my ne frp mul br ln oc an ast co fy gd gv kw li mt nap nds rm sc scn wa yi zu xh st tn si km am yo ha ig es fr de it pt ru nl pl ca cs sk sl hu ro sv da no nb fi et lv lt el tr ar fa he hi bn ta te ml kn mr gu pa ur zh ja ko vi th id ms uk bg sr hr mk sq eu gl cy ga eo la az kk uz be hy ka is lb af sw tl'.split(' '))
const FOREIGN = /\b(spanish|french|german|italian|portuguese|russian|chinese|japanese|arabic|hindi|dutch|polish|catalan|swedish|español|deutsch|français|corazón|coeur|herz|cuore|pulmón|poumon|lunge|circuito|sistema|célula|cellule|zelle|planetas|planètes|atomo|átomo|leva|hebel|levier|fotosíntesis|photosynthèse|fotosintesi|esquema|schéma|kreislauf|aparato|appareil)\b/i

/** School words and what illustrations are usually titled instead. */
const SYN: Record<string, string[]> = {
  heart: ['cardiac', 'coeur'], lung: ['lungs', 'pulmonary', 'respiratory', 'poumon'], lungs: ['lung', 'respiratory', 'pulmonary'],
  cell: ['cellular', 'cells'], plant: ['plants', 'vegetal'], animal: ['animals'],
  dna: ['deoxyribonucleic', 'helix', 'double'], atom: ['atomic', 'bohr', 'atoms'], circuit: ['circuits', 'electric', 'electrical'],
  lever: ['levers', 'fulcrum'], solar: ['planets', 'sun'], photosynthesis: ['photosynthetic', 'chloroplast'],
  kidney: ['kidneys', 'renal', 'nephron'], brain: ['cerebral', 'cerebrum'], eye: ['eyeball', 'ocular'], skeleton: ['skeletal', 'bones'],
  neuron: ['neurone', 'nerve'], blood: ['circulation', 'circulatory'], digestive: ['digestion', 'gut'], tooth: ['teeth', 'dental'],
}

/**
 * Hand-checked textbook pictures for the commonest school topics, best first. Ranking alone picks well-labelled but
 * off-level drawings for these (an H-bridge for "circuit", a cell-membrane close-up for "cell"), so a bare school query
 * ("circuit", "electric circuit", "atom structure") gets the picture a teacher would draw. Titles are exact library titles.
 */
const SCHOOL_PICK: Record<string, { also: string[]; titles: string[] }> = {
  circuit: { also: ['electric', 'electrical', 'simple', 'basic', 'school'], titles: ["Ohm's law simple circuit", 'Simple electric circuit with voltmeter same potential', 'Series and parallel circuits'] },
  atom: { also: ['atomic', 'model', 'bohr', 'school', 'basic'], titles: ['Bohr atom model', 'Bohr atom model mul', 'Schematic atom en'] },
  lever: { also: ['simple', 'machine', 'fulcrum', 'effort', 'load', 'class', 'classe', 'school'], titles: ['Lever PSF', 'Classes of levers'] },
  cell: { also: ['animal', 'school', 'basic', 'organelle'], titles: ['Animal cell structure en'] },
  dna: { also: ['double', 'helix', 'structure', 'base', 'pair', 'school', 'basic'], titles: ['DNA simple2', '201812 DNA double strand A'] },
  lung: { also: ['respiratory', 'system', 'human', 'breathing', 'school', 'basic'], titles: ['Respiratory system complete en', 'Lungs diagram detailed'] },
  // Titles say "induced voltage"/"generator", never "induction", and the word search found an electromagnetic pump.
  induction: { also: ['electromagnetic', 'magnetic', 'electromagnet', 'faraday', 'faraday\'s', 'law', 'current', 'induced', 'coil', 'magnet', 'field', 'changing', 'flux', 'emf', 'school', 'basic', 'simple', 'mutual', 'self'], titles: ['Induced voltage generator', 'Electric generator 3D with voltmeter'] },
  generator: { also: ['electric', 'electrical', 'ac', 'dc', 'dynamo', 'simple', 'basic', 'school', 'electricity'], titles: ['Electric generator 3D with voltmeter', 'Induced voltage generator'] },
  motor: { also: ['electric', 'electrical', 'dc', 'simple', 'basic', 'school', 'electricity'], titles: ['Rudimentary electric motor', 'Electric Motor with Slip Rings'] },
}

const norm = (w: string) => {
  const s = w.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  if (s.length > 4 && s.endsWith('ies')) return s.slice(0, -3) + 'y'
  if (s.length > 3 && s.endsWith('es') && /(ss|x|ch|sh)es$/.test(s)) return s.slice(0, -2)
  if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss') && !s.endsWith('us') && !s.endsWith('is')) return s.slice(0, -1)
  return s
}
export const tokens = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map(norm).filter(w => w.length > 1)

/** Tests and scripts can hand the index in directly (Node needs an import attribute for JSON). */
export function setLibraryData(data: { items: LibraryItem[] }) { LIB = null; preset = data }
let preset: { items: LibraryItem[] } | null = null

async function lib() {
  if (LIB) return LIB
  const data = preset ?? ((await import('./library.json')).default as unknown as { items: LibraryItem[] })
  const items = data.items
  const toks = items.map(i => ({ t: new Set(tokens(i.t)), k: new Set(tokens(`${i.k} ${i.d ?? ''}`)) }))
  const df = new Map<string, number>()
  for (const t of toks) for (const w of new Set([...t.t, ...t.k])) df.set(w, (df.get(w) ?? 0) + 1)
  const idf = new Map([...df].map(([w, n]) => [w, Math.log(1 + items.length / n)]))
  LIB = { items, idf, toks }
  return LIB
}

export interface Hit { item: LibraryItem; score: number; coverage: number }

/**
 * Best library matches for a topic. `extra` are alternative words the model offers (synonyms, the formal name).
 * A hit must match the main words of the query; English-labelled, labelled-diagram titles rank first.
 */
export async function searchLibrary(query: string, opts: { extra?: string[]; limit?: number; want?: 'diagram' | 'icon' | 'any' } = {}): Promise<Hit[]> {
  const L = await lib()
  const main = [...new Set(tokens(query).filter(w => !STOP.has(w)))].slice(0, 8)
  if (!main.length) return []
  const alt = new Set<string>()
  for (const e of opts.extra ?? []) for (const w of tokens(e)) if (!STOP.has(w) && !main.includes(w)) alt.add(w)
  const wantLabels = /label|diagram|parts|structure/i.test(query) || opts.want === 'diagram'
  const pick = schoolPick(main)
  const hits: Hit[] = []
  for (let i = 0; i < L.items.length; i++) {
    const it = L.items[i], tk = L.toks[i]
    let score = 0, matched = 0, mainWeight = 0
    for (const w of main) {
      const idf = L.idf.get(w) ?? 0.5
      mainWeight += idf
      const syn = (SYN[w] ?? []).map(norm)
      if (tk.t.has(w)) { score += 3 * idf; matched += idf }
      else if (syn.some(s => tk.t.has(s))) { score += 2.2 * idf; matched += idf * 0.85 }
      else if (tk.k.has(w)) { score += 1.1 * idf; matched += idf * 0.7 }
      else if (syn.some(s => tk.k.has(s))) { score += 0.8 * idf; matched += idf * 0.5 }
    }
    if (!matched) continue
    for (const w of alt) if (tk.t.has(w)) score += 0.8 * (L.idf.get(w) ?? 0.5); else if (tk.k.has(w)) score += 0.3 * (L.idf.get(w) ?? 0.5)
    const coverage = matched / mainWeight
    // Precision: how much of the title is about the query ("Photosynthesis en" beats "Anoxygenic photosynthesis in green sulfur bacteria").
    const tt = [...tk.t].filter(w => !STOP.has(w) && !NEUTRAL.has(w) && !LANG.has(w) && w !== 'en' && !/^\d+$/.test(w))
    const syns = new Set(main.flatMap(w => [w, ...(SYN[w] ?? []).map(norm)]))
    const precision = tt.length ? tt.filter(w => syns.has(w) || alt.has(w)).length / tt.length : 0
    score *= 0.55 + 0.45 * precision
    // Prefer short, on-topic titles; avoid other-language labels, logos and heraldry.
    const titleToks = it.t.toLowerCase().split(/\s+/)
    if (titleToks.some(w => LANG.has(w)) || FOREIGN.test(it.t) || /[^\u0000-\u024f\s*]/.test(it.t)) score *= 0.35
    if (/\b(logo|arms|coat|flag|stamp|emblem|seal)\b/i.test(it.t)) score *= 0.2
    // Abstract charts of a topic (an Euler diagram of solar system bodies) are not a picture of it.
    const qs = main.join(' ')
    if (/\b(euler|venn|graph|chart|map|barycent|statistic|timeline|flowchart|torque|firearm|heraldry)\w*/i.test(it.t) && !/(euler|venn|graph|chart|map|flow|torque)/.test(qs)) score *= 0.45
    // A second school word for the same thing in the title ("Bohr atom model") marks a textbook picture.
    for (const w of main) if ((SYN[w] ?? []).some(x => tk.t.has(norm(x))) && tk.t.has(w)) score *= 1.15
    // Detailed Commons drawings beat bare sketches, mildly.
    if (it.src === 'commons' && it.bytes) score *= Math.min(1.2, Math.max(0.85, 1 + 0.1 * Math.log10(it.bytes / 20_000)))
    if (/\ben\b/i.test(it.t)) score *= 1.15
    if (wantLabels && it.src === 'commons' && /label|diagram|structure|anatomy|parts/i.test(it.t)) score *= 1.25
    if (opts.want === 'icon' && it.src === 'bio') score *= 1.3
    if (/blank|without text|no text|unlabel/i.test(it.t)) score *= wantLabels ? 0.8 : 1.1
    if (pick) { const r = pick.titles.indexOf(it.t); if (r >= 0) score = score * 0.5 + 40 - 8 * r }
    hits.push({ item: it, score, coverage })
  }
  // The school pick is in even when its title shares no word with the query.
  if (pick) pick.titles.forEach((title, r) => {
    if (hits.some(h => h.item.t === title && h.coverage >= 0.66)) return
    const i = L.items.findIndex(it => it.t === title)
    if (i >= 0) { const k = hits.findIndex(h => h.item === L.items[i]); const h = { item: L.items[i], score: 40 - 8 * r, coverage: 1 }; if (k >= 0) hits[k] = h; else hits.push(h) }
  })
  return hits.filter(h => h.coverage >= 0.66).sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 5)
}

/** Hand-checked school picture for a query (its title is trusted by the title guard; the vision check still runs). */
export function isSchoolPick(query: string, title: string) {
  const p = schoolPick([...new Set(tokens(query).filter(w => !STOP.has(w)))])
  return !!p && p.titles.includes(title)
}

/** The school-canon entry when the query is only a core topic plus generic school words. */
function schoolPick(main: string[]) {
  for (const [topic, p] of Object.entries(SCHOOL_PICK)) {
    if (!main.includes(topic)) continue
    const also = new Set([topic, ...p.also, ...(SYN[topic] ?? []).map(norm)])
    if (main.every(w => also.has(w))) return p
  }
  return null
}

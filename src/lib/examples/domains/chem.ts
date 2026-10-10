/**
 * Chemistry: a reaction with coefficients. Code parses every formula (brackets, hydrates with '.'), counts atoms on
 * both sides (the balance check), and supplies molar masses from IUPAC standard atomic weights as facts (M_H2O, …),
 * so stoichiometry steps only multiply and divide numbers code already knows. Drawn as the equation with an atom
 * tally per element (the learner sees why it balances).
 */
import type { DiagramSpec, ExampleSpec } from '../spec'
import type { Plugin, DiagramView } from '../plugin'
import { ACC, CLAY, HL, INK, MUTED, esc, f1, frame, text } from '../svgkit'
import { fmtNum } from '../spec'

// IUPAC 2021 abridged standard atomic weights (conventional values for school use)
export const ATOMIC: Record<string, number> = {
  H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Ne: 20.180, Na: 22.990, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.95, K: 39.098, Ca: 40.078,
  Ti: 47.867, Cr: 51.996, Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Br: 79.904, Ag: 107.87, Sn: 118.71, I: 126.90, Ba: 137.33, Pt: 195.08, Au: 196.97, Hg: 200.59, Pb: 207.2, Sr: 87.62, Rb: 85.468, Cs: 132.91, Se: 78.971, As: 74.922, U: 238.03,
}

export function atoms(formula: string): Record<string, number> {
  const f = formula.replace(/\s+/g, '').replace(/[⁺⁻+-]\d*$/, '').replace(/\((s|l|g|aq)\)$/i, '')
  const total: Record<string, number> = {}
  for (const part of f.split(/[.·*]/)) {
    const m = /^(\d*)(.*)$/.exec(part)!; const mult = m[1] ? Number(m[1]) : 1
    const stack: Record<string, number>[] = [{}]
    const re = /([A-Z][a-z]?)(\d*)|([([])|([)\]])(\d*)/g
    let x: RegExpExecArray | null, consumed = 0
    while ((x = re.exec(m[2]))) {
      if (x.index !== consumed) throw new Error(`cannot read the formula "${formula}"`)
      consumed = re.lastIndex
      if (x[1]) { if (!(x[1] in ATOMIC)) throw new Error(`unknown element ${x[1]} in ${formula}`); const top = stack[stack.length - 1]; top[x[1]] = (top[x[1]] ?? 0) + (x[2] ? Number(x[2]) : 1) }
      else if (x[3]) stack.push({})
      else { const g = stack.pop(); if (!g || !stack.length) throw new Error(`unbalanced brackets in ${formula}`); const k = x[5] ? Number(x[5]) : 1; const top = stack[stack.length - 1]; for (const [e, n] of Object.entries(g)) top[e] = (top[e] ?? 0) + n * k }
    }
    if (consumed !== m[2].length || stack.length !== 1) throw new Error(`cannot read the formula "${formula}"`)
    for (const [e, n] of Object.entries(stack[0])) total[e] = (total[e] ?? 0) + n * mult
  }
  if (!Object.keys(total).length) throw new Error(`empty formula "${formula}"`)
  return total
}
export const molarMass = (formula: string) => Object.entries(atoms(formula)).reduce((s, [e, n]) => s + ATOMIC[e] * n, 0)
export const factName = (formula: string) => 'M_' + formula.replace(/\((s|l|g|aq)\)$/i, '').replace(/[^A-Za-z0-9]/g, '')

interface Species { formula: string; coef: number }
function sides(d: DiagramSpec): { L: Species[]; R: Species[] } {
  const rd = (v: unknown) => (Array.isArray(v) ? v : []).slice(0, 6).map((s: Record<string, unknown>) => ({ formula: String(s.formula ?? '').trim(), coef: Number.isInteger(Number(s.coef)) && Number(s.coef) > 0 ? Number(s.coef) : 1 }))
  return { L: rd(d.reactants), R: rd(d.products) }
}
function tally(list: Species[]) { const t: Record<string, number> = {}; for (const s of list) for (const [e, n] of Object.entries(atoms(s.formula))) t[e] = (t[e] ?? 0) + n * s.coef; return t }

export function balanceIssues(L: Species[], R: Species[]): string[] {
  try {
    const a = tally(L), b = tally(R)
    const out: string[] = []
    for (const e of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[e] ?? 0) !== (b[e] ?? 0)) out.push(`${e}: ${a[e] ?? 0} on the left, ${b[e] ?? 0} on the right — the equation is not balanced`)
    const all = [...L, ...R].map(s => s.coef)
    const g = all.reduce((x, y) => { while (y) [x, y] = [y, x % y]; return x })
    if (g > 1) out.push('the coefficients share a common factor: use the smallest whole numbers')
    return out
  } catch (e) { return [e instanceof Error ? e.message : String(e)] }
}

/** "2H2 + O2 -> 2H2O" → sides */
export function parseEquation(s: string): { L: Species[]; R: Species[] } | null {
  const parts = s.replace(/\s+/g, ' ').split(/->|→|=|⟶/)
  if (parts.length !== 2) return null
  const side = (x: string) => x.split(/\s\+\s|\s*\+\s+/).map(t => t.trim()).filter(Boolean).map(t => { const m = /^(\d*)\s*(.+)$/.exec(t)!; return { formula: m[2], coef: m[1] ? Number(m[1]) : 1 } })
  return { L: side(parts[0]), R: side(parts[1]) }
}

const subDigits = (f: string) => f.replace(/(\d+)/g, d => [...d].map(c => '₀₁₂₃₄₅₆₇₈₉'[Number(c)]).join(''))

export const reactionPlugin: Plugin = {
  type: 'reaction',
  match: /\b(balanc\w*|equation|stoichiometr\w*|mole|moles|molar|mass of|grams? of|yield|limiting|reactant|product|react|combust\w*|titrat\w*)\b/i,
  prompt: `"reaction": {"type":"reaction","reactants":[{"formula":"CH4","coef":1},{"formula":"O2","coef":2}],"products":[{"formula":"CO2","coef":1},{"formula":"H2O","coef":2}]} — the BALANCED equation (code checks every element). Code supplies molar masses as facts named M_<formula> (M_CH4, M_O2, M_CO2, M_H2O; brackets dropped: Ca(OH)2 -> M_CaOH2) in g/mol — never type a molar mass, use these names. For a balancing problem set "answer.text" to the balanced equation like "CH4 + 2O2 -> CO2 + 2H2O" (no calc needed; each step may name the element it balances: {"highlight":"O"}). Step actions: {"show":["counts"]} atom tally, {"highlight":"O"} one element, {"show":["masses"]}.`,
  prepare(d) {
    const { L, R } = sides(d)
    if (!L.length || !R.length) return ['reaction needs reactants and products']
    const errs: string[] = []
    for (const s of [...L, ...R]) { try { atoms(s.formula) } catch (e) { errs.push(e instanceof Error ? e.message : String(e)) } }
    return errs.length ? errs : balanceIssues(L, R)
  },
  facts(d) {
    const { L, R } = sides(d)
    const out: Record<string, number> = {}
    for (const s of [...L, ...R]) { out[factName(s.formula)] = Math.round(molarMass(s.formula) * 1000) / 1000; out[`n_${factName(s.formula).slice(2)}`] = s.coef }
    return out
  },
  checkText(d, spec) {
    const eq = parseEquation(spec.answer.text ?? '')
    if (!eq) return []
    const issues = balanceIssues(eq.L, eq.R).map(x => `answer.text: ${x}`)
    const { L, R } = sides(d)
    const key = (l: Species[]) => l.map(s => `${s.coef}${s.formula}`).sort().join('+')
    if (!issues.length && (key(eq.L) !== key(L) || key(eq.R) !== key(R))) issues.push('answer.text does not match the diagram reaction')
    return issues
  },
  render(d, _scope, view: DiagramView, spec: ExampleSpec) {
    const { L, R } = sides(d)
    const W = 400
    const ans = view.answers !== false
    const balanced = view.reveal || (ans && view.step >= 0 && (view.step >= (spec.steps.length - 1) || Boolean(view.action?.show)))
    const terms: { t: string; coef: number; f: string }[] = []
    L.forEach((s, i) => terms.push({ t: i ? '+' : '', coef: s.coef, f: s.formula }))
    terms.push({ t: '→', coef: 0, f: '' })
    R.forEach((s, i) => terms.push({ t: i ? '+' : '', coef: s.coef, f: s.formula }))
    // layout the equation in one or two rows
    const widthOf = (x: { t: string; f: string; coef: number }) => (x.f ? subDigits(x.f).length * 13 + 26 : 0) + (x.t ? 26 : 0)
    const total = terms.reduce((s, x) => s + widthOf(x), 0)
    const scale = Math.min(1, (W - 30) / total)
    let x = (W - total * scale) / 2
    const y = 52
    const b: string[] = []
    const hiEl = typeof view.action?.highlight === 'string' ? String(view.action.highlight) : null
    for (const tm of terms) {
      if (tm.t) { b.push(text(x + 13 * scale, y, tm.t, 'lbl', `style="font-size:${f1(22 * scale)}px"`)); x += 26 * scale }
      if (!tm.f) continue
      const cw = 22 * scale
      const coefShown = balanced ? (tm.coef > 1 ? String(tm.coef) : '') : '□'
      b.push(`<text x="${f1(x + cw / 2)}" y="${y}" class="lbl" style="font-size:${f1(22 * scale)}px;fill:${balanced ? ACC : MUTED};font-weight:700">${coefShown}</text>`)
      const fw = subDigits(tm.f).length * 13 * scale
      const hit = hiEl && (() => { try { return hiEl in atoms(tm.f) } catch { return false } })()
      if (hit) b.push(`<rect x="${f1(x + cw - 2)}" y="${y - 22}" width="${f1(fw + 8)}" height="30" rx="6" fill="${HL}" fill-opacity="0.6"/>`)
      b.push(`<text x="${f1(x + cw + 2)}" y="${y}" style="font-size:${f1(22 * scale)}px;fill:${INK}">${esc(subDigits(tm.f))}</text>`)
      x += cw + fw + 8 * scale
    }
    // atom tally
    const showCounts = view.step >= 0 || view.reveal
    let h = 80
    if (showCounts) {
      const withCoefs = (l: Species[]) => balanced ? l : l.map(s => ({ ...s, coef: 1 }))
      let tl: Record<string, number> = {}, tr: Record<string, number> = {}
      try { tl = tally(withCoefs(L)); tr = tally(withCoefs(R)) } catch { /* drawn without counts */ }
      const els = [...new Set([...Object.keys(tl), ...Object.keys(tr)])]
      const top = 86
      b.push(text(120, top, 'left', 'lbl-s'), text(280, top, 'right', 'lbl-s'))
      els.forEach((e, i) => {
        const yy = top + 30 + i * 30
        const ok = tl[e] === tr[e]
        if (hiEl === e) b.push(`<rect x="40" y="${yy - 21}" width="320" height="28" rx="6" fill="${HL}" fill-opacity="0.5"/>`)
        b.push(text(200, yy, e, 'lbl', 'style="font-weight:700"'), text(120, yy, String(tl[e] ?? 0), 'lbl'), text(280, yy, String(tr[e] ?? 0), 'lbl'), text(340, yy, ok ? '✓' : '✗', 'lbl', `style="fill:${ok ? ACC : CLAY};font-weight:700"`))
      })
      h = top + 30 + els.length * 30
    }
    if (Array.isArray(view.action?.show) && (view.action!.show as unknown[]).includes('masses')) {
      const all = [...L, ...R]
      all.forEach((s, i) => { try { b.push(text(20, h + 24 + i * 22, `M(${subDigits(s.formula)}) = ${fmtNum(molarMass(s.formula), 4)} g/mol`, 'lbl-s', 'style="text-anchor:start"')) } catch { /* skip */ } })
      h += 24 + all.length * 22
    }
    return frame(W, h + 18, b.join('\n'))
  },
}

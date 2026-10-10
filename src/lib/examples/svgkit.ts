/** Shared look for every worked-example diagram: cream paper, dark ink, deep-green current/answer accents, clay highlights. */
export const PAPER = '#FBF8F2'
export const INK = '#14141A'
export const MUTED = '#66666F'
export const ACC = '#1F4D3A'
export const FLOW = '#2E7D5B'
export const CLAY = '#A4502A'
export const HL = '#F4D35E'
export const SOFT = '#E7EFEA'

export const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const f1 = (n: number) => (Math.round(n * 10) / 10).toString()

/** Wrap an SVG body in the standard paper frame. Text sizes are in viewBox units chosen so ~16 px at 360 px wide. */
export function frame(w: number, h: number, body: string, extraCss = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f1(w)} ${f1(h)}" width="${f1(w)}" height="${f1(h)}" font-family="Inter, 'DejaVu Sans', Arial, sans-serif">
<style>line,.w{stroke:${INK};stroke-width:2.4;stroke-linecap:round;fill:none}.lbl{font-size:17px;fill:${INK};text-anchor:middle}.lbl-s{font-size:14px;fill:${MUTED};text-anchor:middle}.acc{font-size:16px;fill:${ACC};font-weight:600;text-anchor:middle}.clay{fill:${CLAY}}.flow{stroke:${FLOW};stroke-width:3.4;stroke-dasharray:1 15;stroke-linecap:round;fill:none;animation:gmflow 1s linear infinite}@keyframes gmflow{to{stroke-dashoffset:-32}}@media (prefers-reduced-motion:reduce){.flow{animation:none;stroke-dasharray:none;opacity:.35}}${extraCss}</style>
<rect width="100%" height="100%" fill="${PAPER}"/>
${body}
</svg>`
}

export function arrow(x1: number, y1: number, x2: number, y2: number, color = ACC, width = 2.6, head = 9) {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const hx = x2 - head * Math.cos(a), hy = y2 - head * Math.sin(a)
  const p1 = [hx + head * 0.5 * Math.sin(a), hy - head * 0.5 * Math.cos(a)], p2 = [hx - head * 0.5 * Math.sin(a), hy + head * 0.5 * Math.cos(a)]
  return `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(hx)}" y2="${f1(hy)}" style="stroke:${color};stroke-width:${width}"/><path d="M${f1(x2)},${f1(y2)} L${f1(p1[0])},${f1(p1[1])} L${f1(p2[0])},${f1(p2[1])} z" fill="${color}"/>`
}

export function text(x: number, y: number, s: string, cls = 'lbl', extra = '') {
  return `<text x="${f1(x)}" y="${f1(y)}" class="${cls}" ${extra}>${esc(s)}</text>`
}

/** Unicode subscript for labels in SVG (R23 -> R₂₃, R_eq -> R_eq kept readable). */
export function sub(id: string) {
  const m = /^([A-Za-z]+)_?([0-9]+)$/.exec(id)
  if (!m) return id.replace(/_eq$/, 'ₑq')
  return m[1] + [...m[2]].map(c => '₀₁₂₃₄₅₆₇₈₉'[Number(c)]).join('')
}

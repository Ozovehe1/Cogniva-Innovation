/**
 * Server-side snapshot of the chat board: the scene as a plain SVG (shapes from the lesson exporter, text as <text>,
 * teacher marks from the same perfect-freehand geometry as the board) rendered to PNG with resvg, for the vision
 * critique and board_inspect. Also renders any standalone SVG (math diagrams) to PNG. Server only.
 */
import path from 'node:path'
import { BOARD_H, BOARD_W, type Step } from '../lesson-schema'
import { INK_HEX, SIZE_PX, buildBoard, estimateTextBox, fillTemplates, shapeBox, type BoardEl, type Box } from '@/components/whiteboard/board-state'
import { markGeometry, MARK_NOTE_PX } from '@/components/whiteboard/marks'
import { shapeSvg } from '../lesson-export'
import { texToPlain } from '../math-text'

const FONT = path.join(process.cwd(), 'src/lib/agent/fonts/DejaVuSans.ttf')
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const f1 = (n: number) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : 0)

export function boardSnapshotSvg(steps: Step[], opts: { ids?: boolean } = {}): string {
  const state = buildBoard(steps, steps.length)
  const boxes = new Map<string, Box>()
  const parts: string[] = []
  const boxOf = (el: BoardEl): Box | null => {
    if (el.kind === 'text' || el.kind === 'math') { const b = estimateTextBox(el); return el.fx ? { ...b, x: b.x + el.fx.dx, y: b.y + el.fx.dy } : b }
    return null
  }
  for (const el of state.els) {
    let inner = ''
    if (el.kind === 'shape') {
      try { inner = shapeSvg(el, state.vars) } catch { inner = '' }
    } else if (el.kind === 'text' || el.kind === 'math') {
      const b = boxOf(el)!
      if (el.id) boxes.set(el.id, b)
      const px = SIZE_PX[el.size] * (el.kind === 'math' ? 0.9 : 1)
      const text = el.kind === 'math' ? texToPlain(fillTemplates(el.content, state.vars)) : fillTemplates(el.content, state.vars)
      inner = `<text x="${f1(b.x)}" y="${f1(b.y + px * 0.85)}" font-size="${f1(px)}" textLength="${f1(b.w)}" lengthAdjust="spacingAndGlyphs" fill="${INK_HEX[el.color]}" font-family="DejaVu Sans"${el.kind === 'math' ? ' font-style="italic"' : ''}>${esc(text)}</text>`
    }
    if (el.kind === 'shape' && el.fx && (el.fx.dx || el.fx.dy)) inner = `<g transform="translate(${f1(el.fx.dx)} ${f1(el.fx.dy)})">${inner}</g>`
    if (el.fx && el.fx.opacity < 1) inner = `<g opacity="${el.fx.opacity}">${inner}</g>`
    parts.push(inner)
  }
  // Marks and highlights last (they sit over what they mark).
  for (const el of state.els) {
    if (el.kind !== 'mark' && el.kind !== 'highlight') continue
    const t = state.els.find(e => e.id === el.target && e.kind !== 'mark' && e.kind !== 'highlight')
    let b: Box | null = null
    if (t?.kind === 'text' || t?.kind === 'math') b = boxes.get(t.id!) ?? null
    else if (t?.kind === 'shape') b = shapeBox(t, state.vars)
    if (!b) continue
    const c = INK_HEX[el.color]
    if (el.kind === 'highlight') {
      parts.push(el.style === 'underline'
        ? `<line x1="${f1(b.x)}" y1="${f1(b.y + b.h + 4)}" x2="${f1(b.x + b.w)}" y2="${f1(b.y + b.h + 4)}" stroke="${c}" stroke-width="3"/>`
        : `<rect x="${f1(b.x - 8)}" y="${f1(b.y - 6)}" width="${f1(b.w + 16)}" height="${f1(b.h + 12)}" rx="8" fill="${c}" fill-opacity="0.09" stroke="${c}" stroke-width="2.2"/>`)
    } else {
      const g = markGeometry(el.mark, b, el.key, el.note)
      parts.push(g.outlines.map(d => `<path d="${d}" fill="${c}"/>`).join(''))
      if (el.note && g.note) parts.push(`<text x="${f1(g.note.x)}" y="${f1(g.note.y + g.note.box.h * 0.8)}" font-size="${MARK_NOTE_PX}" font-style="italic" fill="${c}" font-family="DejaVu Sans">${esc(el.note)}</text>`)
    }
  }
  // Optional id tags (for the vision model to name elements).
  if (opts.ids) {
    for (const el of state.els) {
      if (!el.id || el.kind === 'highlight' || el.kind === 'mark') continue
      const b = el.kind === 'shape' ? null : boxes.get(el.id)
      const at = b ? [b.x, b.y - 2] : null
      if (at) parts.push(`<text x="${f1(at[0])}" y="${f1(at[1])}" font-size="10" fill="#C0392B" font-family="DejaVu Sans">${esc(el.id)}</text>`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOARD_W} ${BOARD_H}" width="${BOARD_W}" height="${BOARD_H}"><rect width="${BOARD_W}" height="${BOARD_H}" fill="#FBFAF7"/>${parts.join('')}</svg>`
}

/** Render an SVG document to PNG (base64). Width in pixels. Null when resvg is unavailable. */
export async function svgToPng(svg: string, width = 800): Promise<string | null> {
  try {
    const { Resvg } = await import('@resvg/resvg-js')
    const r = new Resvg(svg, { background: '#FBFAF7', fitTo: { mode: 'width', value: width }, font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans', sansSerifFamily: 'DejaVu Sans', serifFamily: 'DejaVu Sans' } })
    return Buffer.from(r.render().asPng()).toString('base64')
  } catch (err) {
    console.warn('svgToPng failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function boardSnapshotPng(steps: Step[], width = 800) {
  return svgToPng(boardSnapshotSvg(steps), width)
}

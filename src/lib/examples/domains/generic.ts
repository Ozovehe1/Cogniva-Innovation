/**
 * Structure (biology, anatomy, apparatus): a credited library illustration found by the server (find_illustration)
 * with the step's labels listed beside it; and the plain board (algebra and anything without a picture), which has no
 * diagram: the step list itself is the board.
 */
import type { Plugin, DiagramView } from '../plugin'
import type { DiagramSpec } from '../spec'
import { ACC, HL, INK, esc, f1, frame, text } from '../svgkit'

export const illustrationPlugin: Plugin = {
  type: 'illustration',
  match: /\b(cell|organ|heart|lung|kidney|leaf|flower|anatomy|structure of|parts of|apparatus|microscope)\b/i,
  prompt: `"illustration": {"type":"illustration","query":"human heart","labels":["left ventricle","aorta"]} — a real credited textbook drawing (2-5 word query) for structure questions; numbers still go through calc. Step actions: {"label":"aorta"} brings that label forward.`,
  prepare(d) { return String(d.query ?? '').trim() ? [] : ['illustration needs "query"'] },
  render(d: DiagramSpec, _scope, view: DiagramView) {
    const labels = (Array.isArray(d.labels) ? d.labels : []).slice(0, 8).map(String)
    const src = typeof d.src === 'string' && /^https:\/\//.test(d.src) ? d.src : null
    const W = 400, IH = 250
    const b: string[] = []
    if (src) b.push(`<image href="${esc(src)}" x="10" y="10" width="${W - 20}" height="${IH}" preserveAspectRatio="xMidYMid meet"/>`)
    else b.push(text(W / 2, IH / 2, esc(String(d.query ?? '')), 'lbl'))
    const on = typeof view.action?.label === 'string' ? String(view.action.label).toLowerCase() : null
    labels.forEach((l, i) => {
      const y = IH + 34 + i * 26
      const hit = on && l.toLowerCase() === on
      if (hit) b.push(`<rect x="12" y="${y - 19}" width="${W - 24}" height="26" rx="6" fill="${HL}" fill-opacity="0.6"/>`)
      b.push(`<circle cx="26" cy="${y - 6}" r="10" fill="${hit ? ACC : '#FFFFFF'}" stroke="${ACC}" stroke-width="1.6"/>`, text(26, y - 1, String(i + 1), 'lbl-s', `style="fill:${hit ? '#FFFFFF' : INK};font-size:12px"`), text(44, y, l, 'lbl', 'style="text-anchor:start"'))
    })
    if (typeof d.credit === 'string') b.push(text(W - 12, IH + 20 + labels.length * 26 + 22, d.credit.slice(0, 70), 'lbl-s', 'style="text-anchor:end;font-size:11px"'))
    void f1
    return frame(W, IH + 40 + labels.length * 26 + 16, b.join('\n'))
  },
}

export const boardPlugin: Plugin = {
  type: 'board',
  match: /\b(solve|simplify|expand|factori[sz]e|equation|algebra|percentage|ratio|fraction|interest|probability)\b/i,
  prompt: `"board": {"type":"board"} — no picture: the working itself is the board (algebra, percentages, probability without a tree). Every step still has a calc or a check.`,
  render() { return '' },
}

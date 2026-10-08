/**
 * Offline copies of a lesson (server only, pure: no network, no rendering service).
 *
 * - lessonHtml: one self-contained HTML file. Each chapter gets its narration as a transcript,
 *   every board the tutor filled (snapshotted just before it was wiped, and at the end) as an inline
 *   SVG, Manim clips as <video> elements with a direct mp4 link, and the in-lesson checks with
 *   answers folded away. Maths is MathML (no fonts or CSS needed), so it renders offline.
 * - lessonText: a plain-text transcript.
 */
import katex from 'katex'
import type { CheckStep, DrawStep, Ink, Num, Step } from './lesson-schema'
import { BOARD_H, BOARD_W } from './lesson-schema'
import type { Chapter } from './lesson-sections'
import { prepareMathText, repairTex, texToPlain, toPlainText, validateTex } from './math-text'
import { INK_HEX, SIZE_PX, applyStep, emptyBoard, evalFn, evalNum, fillTemplates, toBoard, xScale, type BoardEl, type BoardState, type ShapeEl, type TextEl } from '@/components/whiteboard/board-state'
import { elementBox } from './lesson-layout'

export interface ExportLesson {
  title: string
  subject: string
  objectives: string[]
  steps: Step[]
  chapters: Chapter[]
  url?: string
}

type Block =
  | { t: 'say'; text: string }
  | { t: 'board'; state: BoardState }
  | { t: 'clip'; url: string; caption?: string }
  | { t: 'check'; step: CheckStep }

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function texMathml(tex: string, display = false): string {
  const fixed = repairTex(tex.replace(/\*/g, ' \\times '))
  if (!validateTex(fixed)) return esc(texToPlain(fixed))
  try {
    return katex.renderToString(fixed, { throwOnError: false, displayMode: display, output: 'mathml', strict: 'ignore' })
  } catch {
    return esc(texToPlain(fixed))
  }
}

/** Narration / notes with $...$ maths -> HTML. */
function richHtml(s: string): string {
  return prepareMathText(s).map(seg => (seg.t === 'text' ? esc(seg.v) : seg.ok ? texMathml(seg.v, seg.display) : esc(texToPlain(seg.v)))).join('')
}

/** Walk the script once: narration, clips, checks, and a board snapshot whenever a full board is about to be wiped. */
function blocksFor(steps: Step[], from: number, to: number, start: BoardState): { blocks: Block[]; state: BoardState } {
  const blocks: Block[] = []
  let state = start
  const snap = () => { if (state.els.length) blocks.push({ t: 'board', state }) }
  for (let i = from; i < to; i++) {
    const st = steps[i]
    if (st.type === 'clear' && !st.targets) { snap(); state = applyStep(state, st, i); state = { ...emptyBoard(state.vars) } }
    else if (st.type !== 'check' && st.type !== 'manim_clip' && st.type !== 'pause') {
      try { state = applyStep(state, st, i) } catch { /* a step the board cannot apply is skipped in the copy */ }
    }
    if (st.type === 'manim_clip' && st.url) blocks.push({ t: 'clip', url: st.url, caption: st.caption })
    if (st.say?.trim()) {
      const last = blocks[blocks.length - 1]
      if (last?.t === 'say') last.text += ' ' + st.say.trim()
      else blocks.push({ t: 'say', text: st.say.trim() })
    }
    if (st.type === 'check') blocks.push({ t: 'check', step: st })
  }
  snap()
  return { blocks, state: emptyBoard(state.vars) }
}

/* ───────────── Board -> SVG ───────────── */

const fmt = (n: number) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : 0)

function shapeSvg(el: ShapeEl, vars: BoardState['vars']): string {
  const step: DrawStep = el.step
  const sh = step.shape
  const color = INK_HEX[(step.color ?? 'ink') as Ink] ?? INK_HEX.ink
  const width = step.width ?? (sh.kind === 'axes' ? 1.6 : 2.6)
  const dash = step.dashed ? ' stroke-dasharray="7 6"' : ''
  const stroke = `stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${dash}`
  const fill = step.fill ? `fill="${color}" fill-opacity="0.12"` : 'fill="none"'
  const ax = el.axes
  const P = (p: [Num, Num]) => toBoard(ax, [evalNum(p[0], vars), evalNum(p[1], vars)])
  const k = xScale(ax)
  const line = (a: number[], b: number[], extra = '') => `<line x1="${fmt(a[0])}" y1="${fmt(a[1])}" x2="${fmt(b[0])}" y2="${fmt(b[1])}" ${stroke}${extra}/>`
  const head = (a: number[], b: number[]) => {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = 12
    const p1 = [b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45)]
    const p2 = [b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45)]
    return `<polyline points="${fmt(p1[0])},${fmt(p1[1])} ${fmt(b[0])},${fmt(b[1])} ${fmt(p2[0])},${fmt(p2[1])}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  const arcPath = (cx: number, cy: number, r: number, a0: number, a1: number, sector: boolean) => {
    const rad = (d: number) => (d * Math.PI) / 180
    const x0 = cx + r * Math.cos(rad(a0)), y0 = cy - r * Math.sin(rad(a0))
    const x1 = cx + r * Math.cos(rad(a1)), y1 = cy - r * Math.sin(rad(a1))
    const large = Math.abs(a1 - a0) % 360 > 180 ? 1 : 0
    const sweep = a1 > a0 ? 0 : 1
    const d = `M ${fmt(x0)} ${fmt(y0)} A ${fmt(r)} ${fmt(r)} 0 ${large} ${sweep} ${fmt(x1)} ${fmt(y1)}`
    return sector ? `<path d="M ${fmt(cx)} ${fmt(cy)} L ${fmt(x0)} ${fmt(y0)} ${d.slice(d.indexOf('A'))} Z" ${stroke} ${fill}/>` : `<path d="${d}" ${stroke} fill="none"/>`
  }
  const curve = (f: (x: number) => number, x0: number, x1: number) => {
    if (!ax) return ''
    const [ylo, yhi] = ax.yRange
    const span = yhi - ylo
    let d = '', pen = false
    for (let i = 0; i <= 240; i++) {
      const x = x0 + ((x1 - x0) * i) / 240
      const y = f(x)
      if (!Number.isFinite(y) || y < ylo - span * 0.02 || y > yhi + span * 0.02) { pen = false; continue }
      const [bx, by] = toBoard(ax, [x, y])
      d += `${pen ? 'L' : 'M'} ${fmt(bx)} ${fmt(by)} `
      pen = true
    }
    return d ? `<path d="${d.trim()}" ${stroke} fill="none"/>` : ''
  }
  const lineThrough = (x1: number, y1: number, m: number, half: number) => {
    if (!ax || !Number.isFinite(m) || !Number.isFinite(y1)) return ''
    const a = toBoard(ax, [x1 - half, y1 - m * half]), b = toBoard(ax, [x1 + half, y1 + m * half])
    return line(a, b)
  }
  switch (sh.kind) {
    case 'line': return line(P(sh.from), P(sh.to))
    case 'arrow': { const a = P(sh.from), b = P(sh.to); return line(a, b) + head(a, b) }
    case 'circle': { const [cx, cy] = toBoard(ax, sh.center); return `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(sh.r * k)}" ${stroke} ${fill}/>` }
    case 'rect': {
      const a = toBoard(ax, [sh.x, sh.y]), b = toBoard(ax, [sh.x + sh.w, sh.y + sh.h])
      return `<rect x="${fmt(Math.min(a[0], b[0]))}" y="${fmt(Math.min(a[1], b[1]))}" width="${fmt(Math.abs(b[0] - a[0]))}" height="${fmt(Math.abs(b[1] - a[1]))}" rx="3" ${stroke} ${fill}/>`
    }
    case 'polyline':
    case 'polygon': {
      const pts = sh.points.map(p => toBoard(ax, p)).map(p => `${fmt(p[0])},${fmt(p[1])}`).join(' ')
      return sh.kind === 'polygon' ? `<polygon points="${pts}" ${stroke} ${fill}/>` : `<polyline points="${pts}" ${stroke} fill="none"/>`
    }
    case 'arc':
    case 'sector': { const [cx, cy] = toBoard(ax, sh.center); return arcPath(cx, cy, sh.r * k, sh.from, sh.to, sh.kind === 'sector') }
    case 'point': {
      const [x, y] = P(sh.at)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return ''
      const pos = sh.labelPos ?? 'ne'
      const lx = x + (pos.endsWith('e') ? 9 : -9), ly = y + (pos.startsWith('n') ? -9 : 20)
      const label = sh.label ? `<text x="${fmt(lx)}" y="${fmt(ly)}" font-size="18" fill="${color}" text-anchor="${pos.endsWith('e') ? 'start' : 'end'}" font-family="Georgia, serif">${esc(fillTemplates(sh.label, vars))}</text>` : ''
      return `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="5" fill="${color}"/>${label}`
    }
    case 'axes': {
      const f = sh.frame
      const [x0, x1] = sh.xRange, [y0, y1] = sh.yRange
      const ox = x0 <= 0 && x1 >= 0 ? 0 : x0, oy = y0 <= 0 && y1 >= 0 ? 0 : y0
      const def = { id: '', frame: f, xRange: sh.xRange, yRange: sh.yRange }
      const xa = [toBoard(def, [x0, oy]), toBoard(def, [x1, oy])], ya = [toBoard(def, [ox, y0]), toBoard(def, [ox, y1])]
      let out = line(xa[0], xa[1]) + head(xa[0], xa[1]) + line(ya[0], ya[1]) + head(ya[0], ya[1])
      const ticks = (step0: number | undefined, lo: number, hi: number, isX: boolean) => {
        if (!step0 || step0 <= 0 || (hi - lo) / step0 > 40) return ''
        let t = ''
        for (let v = Math.ceil(lo / step0) * step0; v <= hi + 1e-9; v += step0) {
          if (Math.abs(v) < 1e-9) continue
          const [bx, by] = isX ? toBoard(def, [v, oy]) : toBoard(def, [ox, v])
          const lbl = String(Math.round(v * 1000) / 1000)
          t += isX
            ? `<line x1="${fmt(bx)}" y1="${fmt(by - 4)}" x2="${fmt(bx)}" y2="${fmt(by + 4)}" stroke="${color}" stroke-width="1.2"/><text x="${fmt(bx)}" y="${fmt(by + 20)}" font-size="13" text-anchor="middle" fill="${INK_HEX.muted}" font-family="system-ui, sans-serif">${lbl}</text>`
            : `<line x1="${fmt(bx - 4)}" y1="${fmt(by)}" x2="${fmt(bx + 4)}" y2="${fmt(by)}" stroke="${color}" stroke-width="1.2"/><text x="${fmt(bx - 8)}" y="${fmt(by + 4)}" font-size="13" text-anchor="end" fill="${INK_HEX.muted}" font-family="system-ui, sans-serif">${lbl}</text>`
        }
        return t
      }
      out += ticks(sh.xStep, x0, x1, true) + ticks(sh.yStep, y0, y1, false)
      if (sh.xLabel) out += `<text x="${fmt(xa[1][0] + 6)}" y="${fmt(xa[1][1] + 5)}" font-size="16" fill="${color}" font-family="Georgia, serif">${esc(toPlainText(sh.xLabel))}</text>`
      if (sh.yLabel) out += `<text x="${fmt(ya[1][0])}" y="${fmt(ya[1][1] - 10)}" font-size="16" text-anchor="middle" fill="${color}" font-family="Georgia, serif">${esc(toPlainText(sh.yLabel))}</text>`
      return out
    }
    case 'function': {
      if (!ax) return ''
      const [d0, d1] = sh.domain ?? ax.xRange
      return curve(evalFn(sh.expr, vars), d0, d1)
    }
    case 'secant': {
      if (!ax) return ''
      const f = evalFn(sh.expr, vars)
      const a = evalNum(sh.x1, vars), b = evalNum(sh.x2, vars)
      const m = (f(b) - f(a)) / (b - a)
      const half = Math.max(Math.abs(b - a) / 2 + (sh.extend ?? (ax.xRange[1] - ax.xRange[0]) * 0.15), 0.1)
      return lineThrough((a + b) / 2, (f(a) + f(b)) / 2, m, half)
    }
    case 'tangent': {
      if (!ax) return ''
      const f = evalFn(sh.expr, vars)
      const x = evalNum(sh.at, vars), h = 1e-4
      const m = (f(x + h) - f(x - h)) / (2 * h)
      return lineThrough(x, f(x), m, (sh.len ?? (ax.xRange[1] - ax.xRange[0])) / 2)
    }
    default: return ''
  }
}

function textSvg(el: TextEl, vars: BoardState['vars']): string {
  const content = el.dyn ? fillTemplates(el.content, vars) : el.content
  const px = SIZE_PX[el.size] * (el.kind === 'math' ? 0.86 : 1)
  const box = elementBox(el, vars) ?? { x: el.x, y: el.y, w: 200, h: px * 1.3 }
  const w = Math.max(40, Math.min(BOARD_W, el.maxWidth ?? Math.max(box.w * 1.35, 60)))
  const x = el.align === 'center' ? el.x - w / 2 : el.align === 'right' ? el.x - w : el.x
  const h = Math.max(box.h * 1.6, px * 1.6)
  const html = el.kind === 'math' ? texMathml(content, true) : richHtml(content)
  const font = el.kind === 'math' || el.font === 'serif' ? 'Georgia, \'Times New Roman\', serif' : 'system-ui, -apple-system, sans-serif'
  return `<foreignObject x="${fmt(x)}" y="${fmt(el.y)}" width="${fmt(w)}" height="${fmt(h)}"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:${fmt(px)}px;line-height:1.18;color:${INK_HEX[el.color]};font-family:${font};text-align:${el.align};white-space:${el.maxWidth ? 'pre-line' : 'pre'}">${html}</div></foreignObject>`
}

function wrapFx(el: BoardEl, inner: string, vars: BoardState['vars']): string {
  const fx = el.fx
  if (!fx || (fx.dx === 0 && fx.dy === 0 && fx.scale === 1 && fx.opacity === 1)) return inner
  if (fx.opacity <= 0) return ''
  const b = elementBox(el, vars)
  const cx = b ? b.x + b.w / 2 : 0, cy = b ? b.y + b.h / 2 : 0
  const t = `translate(${fmt(fx.dx)} ${fmt(fx.dy)})${fx.scale !== 1 ? ` translate(${fmt(cx)} ${fmt(cy)}) scale(${fx.scale}) translate(${fmt(-cx)} ${fmt(-cy)})` : ''}`
  return `<g transform="${t}" opacity="${fx.opacity}">${inner}</g>`
}

function boardSvg(state: BoardState, label: string): string {
  const vars = state.vars
  const byId = new Map<string, BoardEl>()
  for (const el of state.els) if (el.id && el.kind !== 'highlight') byId.set(el.id, el)
  const parts: string[] = []
  for (const el of state.els) {
    let inner = ''
    if (el.kind === 'shape') inner = shapeSvg(el, vars)
    else if (el.kind === 'text' || el.kind === 'math') inner = textSvg(el, vars)
    else if (el.kind === 'highlight') {
      const target = byId.get(el.target)
      const b = target ? elementBox(target, vars) : null
      if (b) {
        const c = INK_HEX[el.color] ?? INK_HEX.accent
        inner = el.style === 'underline'
          ? `<line x1="${fmt(b.x)}" y1="${fmt(b.y + b.h + 4)}" x2="${fmt(b.x + b.w)}" y2="${fmt(b.y + b.h + 4)}" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`
          : `<rect x="${fmt(b.x - 8)}" y="${fmt(b.y - 6)}" width="${fmt(b.w + 16)}" height="${fmt(b.h + 12)}" rx="6" fill="none" stroke="${c}" stroke-width="2.4"/>`
      }
    }
    try { parts.push(wrapFx(el, inner, vars)) } catch { parts.push(inner) }
  }
  return `<svg class="board" viewBox="0 0 ${BOARD_W} ${BOARD_H}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg"><rect width="${BOARD_W}" height="${BOARD_H}" fill="#FFFFFF"/>${parts.join('')}</svg>`
}

/* ───────────── Documents ───────────── */

function checkHtml(c: CheckStep): string {
  let body = `<p class="q">${richHtml(c.prompt)}</p>`
  if (c.kind === 'choice' && c.options?.length) body += `<ol class="opts" type="A">${c.options.map(o => `<li>${richHtml(o)}</li>`).join('')}</ol>`
  const ans: string[] = []
  if (c.kind === 'choice' && typeof c.answer === 'number' && c.options?.[c.answer] !== undefined) ans.push(`Answer: ${String.fromCharCode(65 + c.answer)}. ${richHtml(c.options[c.answer])}`)
  if (c.kind === 'short' && c.accept?.length) ans.push(`Answer: ${c.accept.map(richHtml).join(' / ')}`)
  if (c.explanation) ans.push(richHtml(c.explanation))
  if (ans.length) body += `<details><summary>Show answer</summary><p>${ans.join('<br/>')}</p></details>`
  return `<aside class="check"><div class="tag">${c.kind === 'understand' ? 'Pause and think' : 'Quick check'}</div>${body}</aside>`
}

function chapterList(l: ExportLesson): Chapter[] {
  return l.chapters.length ? l.chapters : [{ title: l.title, start: 0, count: l.steps.length }]
}

export function lessonHtml(l: ExportLesson): string {
  const chapters = chapterList(l)
  let state = emptyBoard()
  let boardNo = 0
  const sections = chapters.map((ch, ci) => {
    const end = Math.min(l.steps.length, ch.start + ch.count)
    const { blocks, state: next } = blocksFor(l.steps, ch.start, end, state)
    state = next
    const body = blocks.map(b => {
      if (b.t === 'say') return `<p>${richHtml(b.text)}</p>`
      if (b.t === 'board') { boardNo++; return `<figure>${boardSvg(b.state, `Board ${boardNo}`)}<figcaption>Board ${boardNo}</figcaption></figure>` }
      if (b.t === 'clip') return `<figure class="clip"><video controls preload="none" playsinline src="${esc(b.url)}"></video><figcaption>${b.caption ? richHtml(b.caption) + ' · ' : ''}<a href="${esc(b.url)}" download>Download clip (mp4)</a></figcaption></figure>`
      return checkHtml(b.step)
    }).join('\n')
    return `<section id="ch${ci + 1}"><h2><span class="n">${String(ci + 1).padStart(2, '0')}</span>${richHtml(ch.title)}</h2>\n${body}</section>`
  }).join('\n')
  const toc = chapters.length > 1 ? `<nav><h2>Sections</h2><ol>${chapters.map((c, i) => `<li><a href="#ch${i + 1}">${richHtml(c.title)}</a></li>`).join('')}</ol></nav>` : ''
  const objectives = l.objectives.length ? `<div class="obj"><h2>In this lesson</h2><ul>${l.objectives.map(o => `<li>${richHtml(o)}</li>`).join('')}</ul></div>` : ''
  const saved = new Date().toISOString().slice(0, 10)
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(toPlainText(l.title))} · GeniusMap</title>
<style>
:root{--ink:#14141A;--ink2:#3D3D47;--muted:#66666F;--faint:#8E8C86;--line:#E5E1D8;--canvas:#F7F5F0;--accent:#1F4D3A;--soft:#E7EFEA;--accent-line:#C5D7CC}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:860px;margin:0 auto;padding:28px 18px 64px}
.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);font-weight:600}
h1{font-family:Georgia,"Times New Roman",serif;font-weight:500;font-size:clamp(28px,6vw,38px);line-height:1.1;margin:6px 0 6px}
.meta{color:var(--muted);font-size:13px;margin:0 0 24px}
h2{font-family:Georgia,"Times New Roman",serif;font-weight:500;font-size:22px;line-height:1.25;margin:40px 0 12px}
h2 .n{font:600 13px system-ui,sans-serif;color:var(--faint);margin-right:10px;vertical-align:middle}
nav,.obj{background:#fff;border:1px solid var(--line);border-radius:14px;padding:4px 20px 12px;margin:0 0 12px}
nav h2,.obj h2{font:600 15px system-ui,sans-serif;margin:14px 0 6px}nav a{color:var(--accent);text-decoration:none}nav a:hover{text-decoration:underline}
p{margin:0 0 14px;color:var(--ink2)}
figure{margin:18px 0 22px}figcaption{font-size:12px;color:var(--faint);margin-top:6px}figcaption a{color:var(--accent)}
.board{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:12px;background:#fff;box-shadow:0 1px 2px rgba(20,20,26,.04)}
.clip video{display:block;width:100%;border-radius:12px;background:#111;aspect-ratio:16/9}
.check{background:var(--soft);border:1px solid var(--accent-line);border-radius:14px;padding:14px 18px;margin:18px 0}
.check .tag{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin-bottom:6px}
.check .q{color:var(--ink);font-weight:500}.opts{margin:0 0 10px;padding-left:22px}
details summary{cursor:pointer;color:var(--accent);font-weight:500;font-size:14px}details p{margin:8px 0 0}
footer{margin-top:48px;border-top:1px solid var(--line);padding-top:14px;font-size:12px;color:var(--faint)}footer a{color:var(--accent)}
math{font-size:1.05em}
@media print{body{background:#fff}main{padding:0}.clip video{display:none}details{display:block}details>*{display:block}nav{page-break-after:avoid}figure,.check{break-inside:avoid}}
</style></head>
<body><main>
<div class="eyebrow">${esc(l.subject || 'Lesson')}</div>
<h1>${richHtml(l.title)}</h1>
<p class="meta">Offline copy from GeniusMap · saved ${saved} · ${boardNo} board${boardNo === 1 ? '' : 's'}${chapters.length > 1 ? ` · ${chapters.length} sections` : ''}</p>
${objectives}
${toc}
${sections}
<footer>Clips stream from GeniusMap's storage and need a connection; everything else works offline. Print this page to save it as a PDF.${l.url ? ` Watch the full lesson: <a href="${esc(l.url)}">${esc(l.url)}</a>` : ''}</footer>
</main></body></html>`
}

export function lessonText(l: ExportLesson): string {
  const out: string[] = [toPlainText(l.title), l.subject ? toPlainText(l.subject) : '', '']
  if (l.objectives.length) out.push('In this lesson:', ...l.objectives.map(o => `  - ${toPlainText(o)}`), '')
  chapterList(l).forEach((ch, ci) => {
    out.push(`${ci + 1}. ${toPlainText(ch.title)}`, '-'.repeat(Math.min(60, toPlainText(ch.title).length + 4)), '')
    const end = Math.min(l.steps.length, ch.start + ch.count)
    let para: string[] = []
    const flush = () => { if (para.length) { out.push(para.join(' '), ''); para = [] } }
    for (let i = ch.start; i < end; i++) {
      const st = l.steps[i]
      if (st.type === 'manim_clip') { flush(); out.push(`[Animation${st.caption ? `: ${toPlainText(st.caption)}` : ''}] ${st.url}`, '') }
      if (st.say?.trim()) para.push(toPlainText(st.say.trim()))
      if (st.type === 'check') {
        flush()
        out.push(`Check: ${toPlainText(st.prompt)}`)
        if (st.kind === 'choice' && st.options) st.options.forEach((o, k) => out.push(`  ${String.fromCharCode(65 + k)}. ${toPlainText(o)}`))
        if (st.kind === 'choice' && typeof st.answer === 'number' && st.options?.[st.answer] !== undefined) out.push(`  Answer: ${String.fromCharCode(65 + st.answer)}`)
        if (st.kind === 'short' && st.accept?.length) out.push(`  Answer: ${st.accept.map(toPlainText).join(' / ')}`)
        if (st.explanation) out.push(`  ${toPlainText(st.explanation)}`)
        out.push('')
      }
    }
    flush()
  })
  if (l.url) out.push(`Full lesson: ${l.url}`)
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

export function exportFileName(title: string, ext: string) {
  const base = toPlainText(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'lesson'
  return `${base}.${ext}`
}

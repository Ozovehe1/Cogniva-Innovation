'use client'
/**
 * Handwriting on the board.
 *
 *  - HandText: plain text set in a single-line handwriting font (EMS Casual Hand,
 *    OFL, bundled in ./fonts) as SVG strokes. Each stroke is drawn with
 *    stroke-dashoffset, glyph by glyph, left to right, at a natural, slightly
 *    varied pace, with the pen lifting between strokes and words.
 *  - useInkReveal: anything else (KaTeX maths, text with inline maths, live
 *    values) is revealed symbol by symbol along the writing direction through a
 *    clip path made of the glyph boxes, so it reads as written, not faded in.
 *
 * Both hand their strokes to the board's pen (./pen), which drives them on one
 * clock and keeps the marker tip on the stroke being drawn. Writing always ends
 * inside the time it is given (the cue window), and reduced motion shows it at once.
 */
import React, { useLayoutEffect, useMemo, useRef } from 'react'
import FONT from './fonts/ems-casual-hand.json'
import { usePen, type PenSegment, type Pt } from './pen'

interface FontData { upm: number; cap: number; adv: number; glyphs: Record<string, [number, string[]]> }
const font = FONT as unknown as FontData

/** Typographic characters drawn with the nearest glyph the font has. */
const SUBST: Record<string, string> = { '’': "'", '‘': "'", '′': "'", '−': '-', '‐': '-', '…': '...', '\u00a0': ' ' }

function normalize(text: string) {
  let out = ''
  for (const ch of text) out += SUBST[ch] ?? ch
  return out
}

/** True when the text can be drawn with the handwriting font (no maths, no live values, every glyph present). */
export function canHandwrite(text: string): boolean {
  if (!text.trim() || /\$|\{\{/.test(text)) return false
  for (const ch of normalize(text)) if (ch !== '\n' && ch !== ' ' && !font.glyphs[ch]) return false
  return true
}

/** Cap height as a fraction of the font size: matches the serif used elsewhere. */
const CAP_EM = 0.66
const NUM_RE = /-?\d+(?:\.\d+)?/g

interface Placed { d: string; len: number; glyph: number; word: number; line: number }

interface Layout { w: number; h: number; strokes: Placed[]; sw: number }

function layoutText(text: string, px: number, maxWidth: number | undefined, align: 'left' | 'center' | 'right'): Layout {
  const s = (CAP_EM * px) / font.cap
  const lineH = px * 1.32
  const top = px * 0.98 // first baseline
  const space = (font.glyphs[' ']?.[0] ?? font.adv) * s
  const adv = (ch: string) => (font.glyphs[ch]?.[0] ?? font.adv) * s
  // Word wrap (explicit newlines kept).
  const lines: string[][] = []
  for (const para of normalize(text).split('\n')) {
    const words = para.split(/ +/).filter(Boolean)
    let cur: string[] = []
    let w = 0
    for (const word of words) {
      const ww = [...word].reduce((a, c) => a + adv(c), 0)
      if (maxWidth && cur.length && w + space + ww > maxWidth) { lines.push(cur); cur = []; w = 0 }
      w += (cur.length ? space : 0) + ww
      cur.push(word)
    }
    lines.push(cur)
  }
  const widths = lines.map(l => l.reduce((a, word, i) => a + (i ? space : 0) + [...word].reduce((b, c) => b + adv(c), 0), 0))
  const W = Math.max(1, ...widths)
  const strokes: Placed[] = []
  let glyph = 0, wordN = 0
  lines.forEach((words, li) => {
    let x = align === 'center' ? (W - widths[li]) / 2 : align === 'right' ? W - widths[li] : 0
    const base = top + li * lineH
    words.forEach((word, wi) => {
      if (wi) x += space
      for (const ch of word) {
        const g = font.glyphs[ch]
        if (g) {
          for (const d of g[1]) {
            // Font units (y up) to px (y down), placed at the pen position.
            let k = 0
            const td = d.replace(NUM_RE, n => {
              const v = Number(n)
              const out = k++ % 2 === 0 ? x + v * s : base - v * s
              return (Math.round(out * 100) / 100).toString()
            })
            strokes.push({ d: td, len: 0, glyph, word: wordN, line: li })
          }
        }
        x += adv(ch)
        glyph++
      }
      wordN++
    })
  })
  const h = top + (lines.length - 1) * lineH + px * 0.42
  return { w: W + px * 0.1, h, strokes, sw: Math.max(1.3, px * 0.072) }
}

/** Seeded jitter so a line is written the same way every time it is replayed. */
function jitter(i: number) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** Natural writing schedule: per-stroke durations from their length, lifts between strokes, words and lines. */
function schedule(lens: number[], meta: Placed[], px: number, available: number | undefined): { start: number; dur: number }[] {
  const speed = px * 15 / 1000 // px of stroke per ms
  const out: { start: number; dur: number }[] = []
  let t = 0
  meta.forEach((m, i) => {
    if (i) {
      const p = meta[i - 1]
      t += m.line !== p.line ? 260 : m.word !== p.word ? 130 : m.glyph !== p.glyph ? 45 : 35
    }
    const dur = Math.max(40, (lens[i] / speed) * (0.85 + jitter(i) * 0.3))
    out.push({ start: t, dur })
    t += dur
  })
  const lead = Math.min(220, (available ?? t) * 0.12)
  const natural = t
  const room = available !== undefined ? Math.max(120, available - lead - 60) : natural
  const k = natural > room ? room / natural : 1
  return out.map(o => ({ start: lead + o.start * k, dur: o.dur * k }))
}

export function HandText({
  text,
  px,
  color,
  maxWidth,
  align = 'left',
  animate,
  reduced,
  duration,
  className,
}: {
  text: string
  /** Font size in the element's own px (board units on the board). */
  px: number
  color: string
  maxWidth?: number
  align?: 'left' | 'center' | 'right'
  /** Write it on now (otherwise it is shown complete). */
  animate: boolean
  reduced: boolean
  /** Time it must be written within (ms): the cue window. */
  duration?: number
  className?: string
}) {
  const pen = usePen()
  const svgRef = useRef<SVGSVGElement>(null)
  const lay = useMemo(() => layoutText(text, px, maxWidth, align), [text, px, maxWidth, align])
  const write = animate && !reduced
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg || !write) return
    const paths = Array.from(svg.querySelectorAll<SVGPathElement>('path[data-s]'))
    const lens = paths.map(p => { try { return p.getTotalLength() } catch { return 0 } })
    paths.forEach((p, i) => { p.style.strokeDasharray = `${lens[i] + 1} ${lens[i] + 1}`; p.style.strokeDashoffset = `${lens[i] + 1}` })
    const times = schedule(lens, lay.strokes, px, duration)
    const toClient = (p: SVGPathElement, l: number): Pt | null => {
      const r = svg.getBoundingClientRect()
      if (!r.width) return null
      const pt = p.getPointAtLength(l)
      return { x: r.left + (pt.x / lay.w) * r.width, y: r.top + (pt.y / lay.h) * r.height }
    }
    const segs: PenSegment[] = paths.map((p, i) => ({
      start: times[i].start,
      dur: times[i].dur,
      apply: q => { p.style.strokeDashoffset = q >= 1 ? '0' : `${(lens[i] + 1) * (1 - q)}` },
      point: q => toClient(p, lens[i] * q),
    }))
    const cancel = pen.run(segs)
    return () => {
      cancel()
      paths.forEach(p => { p.style.strokeDasharray = ''; p.style.strokeDashoffset = '' })
    }
  }, [write, lay, px, duration, pen])
  return (
    <span className={className} style={{ display: 'inline-block', lineHeight: 0 }}>
      <span className="sr-only">{text}</span>
      <svg ref={svgRef} aria-hidden width={lay.w} height={lay.h} viewBox={`0 0 ${lay.w} ${lay.h}`} overflow="visible" style={{ display: 'block', overflow: 'visible' }}>
        <g fill="none" stroke={color} strokeWidth={lay.sw} strokeLinecap="round" strokeLinejoin="round">
          {lay.strokes.map((st, i) => <path key={i} data-s="" d={st.d} />)}
        </g>
      </svg>
    </span>
  )
}

/* ───────────── Symbol-by-symbol reveal for maths and mixed text ───────────── */

interface Box { x: number; y: number; w: number; h: number }

/** Boxes of everything visible inside `root`, in writing (DOM) order, in root-local px. */
function inkBoxes(root: HTMLElement): Box[] {
  const rr = root.getBoundingClientRect()
  const k = root.offsetWidth ? rr.width / root.offsetWidth : 1
  if (!rr.width || !k) return []
  const out: Box[] = []
  const push = (r: DOMRect) => {
    if (r.width < 0.5 && r.height < 0.5) return
    out.push({ x: (r.left - rr.left) / k, y: (r.top - rr.top) / k, w: Math.max(r.width / k, 1), h: Math.max(r.height / k, 1) })
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: n => {
      if (n.nodeType === 1) {
        const el = n as Element
        if (el.classList.contains('katex-mathml') || el.classList.contains('sr-only')) return NodeFilter.FILTER_REJECT
        if (el.tagName.toLowerCase() !== 'svg' && el.closest('svg')) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const range = document.createRange()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3) {
      const t = n.textContent ?? ''
      for (let i = 0; i < t.length; i++) {
        if (!t[i].trim()) continue
        range.setStart(n, i)
        range.setEnd(n, i + 1)
        const r = range.getBoundingClientRect()
        push(r)
      }
    } else {
      const el = n as Element
      // Fraction bars, roots, arrows and other drawn parts of KaTeX.
      if (el.classList.contains('frac-line') || el.classList.contains('overline-line') || el.classList.contains('underline-line') || el.classList.contains('hline')) push(el.getBoundingClientRect())
      else if (el.tagName.toLowerCase() === 'svg') push(el.getBoundingClientRect())
    }
  }
  return out
}

/**
 * Reveal `ref`'s content symbol by symbol when `active` (once per mount): a clip
 * path grows glyph box by glyph box, left to right, and the pen follows the
 * leading edge with a small writing motion.
 */
export function useInkReveal(ref: React.RefObject<HTMLElement | null>, active: boolean, px: number, duration: number | undefined) {
  const pen = usePen()
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !active) return
    const boxes = inkBoxes(el)
    if (!boxes.length) return
    const padY = px * 0.35, padX = px * 0.06
    const rect = (b: Box, f: number) => {
      const x0 = b.x - padX, y0 = b.y - padY, x1 = x0 + (b.w + 2 * padX) * f, y1 = b.y + b.h + padY
      return `M${x0.toFixed(1)} ${y0.toFixed(1)}H${x1.toFixed(1)}V${y1.toFixed(1)}H${x0.toFixed(1)}Z`
    }
    let done = ''
    let doneN = 0
    const setClip = (k: number, f: number) => {
      while (doneN < k) { done += rect(boxes[doneN], 1); doneN++ }
      const d = done + (f > 0 && boxes[k] ? rect(boxes[k], f) : '')
      const v = d ? `path('${d}')` : 'inset(0 100% 0 0)'
      el.style.clipPath = v
      el.style.setProperty('-webkit-clip-path', v)
    }
    setClip(0, 0)
    // Durations from glyph widths, a breath between symbols, scaled into the cue window.
    let t = 0
    const raw = boxes.map((b, i) => {
      const dur = Math.max(70, (b.w / px) * 230) * (0.85 + ((Math.sin(i * 7.31) + 1) / 2) * 0.3)
      const r = { start: t, dur }
      t += dur + 45
      return r
    })
    const lead = Math.min(200, (duration ?? t) * 0.12)
    const room = duration !== undefined ? Math.max(120, duration - lead - 60) : t
    const k = t > room ? room / t : 1
    const toClient = (b: Box, f: number, i: number): Pt | null => {
      const rr = el.getBoundingClientRect()
      const sc = el.offsetWidth ? rr.width / el.offsetWidth : 1
      if (!rr.width) return null
      const x = b.x + b.w * f
      const y = b.y + b.h * (0.62 + 0.16 * Math.sin(f * Math.PI * 3 + i))
      return { x: rr.left + x * sc, y: rr.top + y * sc }
    }
    const segs: PenSegment[] = boxes.map((b, i) => ({
      start: lead + raw[i].start * k,
      dur: raw[i].dur * k,
      apply: f => {
        if (f <= 0) return
        if (i === boxes.length - 1 && f >= 1) { el.style.clipPath = ''; el.style.removeProperty('-webkit-clip-path'); return }
        setClip(f >= 1 ? i + 1 : i, f >= 1 ? 0 : f)
      },
      point: f => toClient(b, f, i),
    }))
    const cancel = pen.run(segs)
    return () => {
      cancel()
      el.style.clipPath = ''
      el.style.removeProperty('-webkit-clip-path')
    }
    // Once per mount of a newly written element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}

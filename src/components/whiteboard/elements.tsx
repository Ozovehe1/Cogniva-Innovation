'use client'
import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import katex from 'katex'
import type { Num, Shape, Vars } from '@/lib/lesson-schema'
import {
  INK_HEX,
  SIZE_PX,
  animMs,
  evalFn,
  evalNum,
  fillTemplates,
  shapeBox,
  toBoard,
  xScale,
  type AxesDef,
  type Box,
  type Fx,
  type HighlightEl,
  type ShapeEl,
  type TextEl,
} from './board-state'
import { useLiveVars } from './live-vars'
import { HandText, canHandwrite, useInkReveal } from './handwriting'
import { usePen, type Pt } from './pen'

const NO_VARS: Vars = {}

/** Smooth, slightly front-loaded ease used for strokes (close to 3Blue1Brown's "smooth"). */
export const EASE_SMOOTH: [number, number, number, number] = [0.45, 0.05, 0.25, 1]

/**
 * Screen pixels per board unit. Labels drawn inside the board use it to keep a
 * minimum on-screen size when the board is scaled down on a phone.
 */
export const BoardScale = createContext(1)

/** A board-unit font size that renders at least `minPx` screen pixels. */
export function useMinUnits(units: number, minPx: number) {
  const s = useContext(BoardScale)
  return Math.max(units, minPx / (s || 1))
}

/** On-screen sizes (px) of reflowed notes under the diagram on a phone. */
export const FLOW_PX: Record<TextEl['size'], number> = { sm: 17, md: 19, lg: 23, xl: 27 }

export function renderTex(tex: string, display = false): string {
  try {
    return katex.renderToString(display ? `\\displaystyle ${tex}` : tex, { throwOnError: false, displayMode: false, output: 'html', strict: 'ignore' })
  } catch {
    return tex
  }
}

function Content({ kind, content }: { kind: TextEl['kind']; content: string }) {
  const html = useMemo(() => (kind === 'math' ? renderTex(content, true) : null), [kind, content])
  if (html !== null) return <span className="wb-math" dangerouslySetInnerHTML={{ __html: html }} />
  return <>{content}</>
}

/** Text in the handwriting font when it can be drawn with it, otherwise the regular rendering. */
function Ink({ el, content, px, animate, reduced, duration, maxWidth }: {
  el: TextEl; content: string; px: number; animate: boolean; reduced: boolean; duration?: number; maxWidth?: number
}) {
  const color = INK_HEX[el.color]
  if (el.kind === 'text' && !el.dyn && canHandwrite(content)) {
    return <HandText text={content} px={px} color={color} maxWidth={maxWidth} align={el.align ?? 'left'} animate={animate} reduced={reduced} duration={duration} />
  }
  return <Reveal kind={el.kind} content={content} px={px} animate={animate && !reduced} duration={duration} />
}

/** Maths and mixed text, written symbol by symbol when it first appears. */
function Reveal({ kind, content, px, animate, duration }: { kind: TextEl['kind']; content: string; px: number; animate: boolean; duration?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useInkReveal(ref, animate, px, duration)
  return <div ref={ref}><Content kind={kind} content={content} /></div>
}

/* ───────────── Text & math ───────────── */

export function TextElement({
  el,
  animate,
  reduced,
  registerRef,
  flow,
  mark,
  duration,
  vars = NO_VARS,
}: {
  el: TextEl
  /** 'enter' when this element was just created, 'morph' when it was just transformed. */
  animate: 'enter' | 'morph' | null
  reduced: boolean
  registerRef: (id: string, node: HTMLElement | null) => void
  /** Render as a reflowed note (phone layout) instead of at board coordinates. */
  flow?: boolean
  /** Highlight drawn around a reflowed note. */
  mark?: { style: 'box' | 'underline'; color: TextEl['color']; fresh: boolean } | null
  /** Length of the write-on / morph in ms (timed to the narration by the player). */
  duration?: number
  /** Board variables, for {{...}} live values. */
  vars?: Vars
}) {
  const boardPx = SIZE_PX[el.size] * (el.kind === 'math' ? 0.86 : 1)
  const labelPx = useMinUnits(boardPx, 15)
  const live = useLiveVars(!!el.dyn, vars)
  const shown = el.dyn ? { ...el, content: fillTemplates(el.content, live), prevContent: el.prevContent !== undefined ? fillTemplates(el.prevContent, live) : undefined } : el
  if (flow) return <FlowText el={shown} animate={animate} reduced={reduced} registerRef={registerRef} mark={mark ?? null} duration={duration} />
  return <BoardText el={shown} animate={animate} reduced={reduced} registerRef={registerRef} fontPx={labelPx} duration={duration} />
}

function BoardText({ el, animate, reduced, registerRef, fontPx, duration }: {
  el: TextEl; animate: 'enter' | 'morph' | null; reduced: boolean; registerRef: (id: string, node: HTMLElement | null) => void; fontPx: number; duration?: number
}) {
  const translateX = el.align === 'center' ? '-50%' : el.align === 'right' ? '-100%' : '0%'
  const enterMs = duration ?? animMs({ type: el.kind === 'math' ? 'math' : 'write', text: el.content, tex: el.content, x: 0, y: 0 } as never)
  const morphS = Math.max(0.5, Math.min(2.4, (duration ?? 950) / 1000))
  const style: React.CSSProperties = {
    fontSize: fontPx,
    color: INK_HEX[el.color],
    maxWidth: el.maxWidth,
    whiteSpace: el.maxWidth ? 'pre-line' : 'pre',
  }
  const cls = el.font === 'sans' && el.kind === 'text' ? 'font-sans tracking-[-0.01em]' : 'font-display'

  const morphing = animate === 'morph'
  const from = morphing ? { left: el.prevX ?? el.x, top: el.prevY ?? el.y } : { left: el.x, top: el.y }

  return (
    <motion.div
      className="absolute"
      initial={from}
      animate={{ left: el.x, top: el.y }}
      exit={{ opacity: 0, transition: { duration: reduced ? 0.01 : 0.28 } }}
      transition={{ duration: reduced || !morphing ? 0 : morphS, ease: EASE_SMOOTH }}
      style={{ ...from }}
    >
      <div
        ref={node => { if (el.id) registerRef(el.id, node) }}
        className={`relative leading-[1.18] ${cls}`}
        style={{ ...style, transform: `translateX(${translateX})` }}
      >
        {morphing && el.prevContent !== undefined && el.kind === 'math' && !reduced ? (
          <MorphMath from={el.prevContent} to={el.content} ms={morphS * 1000} />
        ) : morphing && el.prevContent !== undefined ? (
          <>
            <motion.div
              aria-hidden
              className="pointer-events-none absolute left-0 top-0"
              initial={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              animate={{ opacity: 0, y: reduced ? 0 : -8, filter: reduced ? 'blur(0px)' : 'blur(2px)' }}
              transition={{ duration: reduced ? 0.15 : morphS * 0.6, ease: EASE_SMOOTH }}
              style={{ whiteSpace: style.whiteSpace }}
            >
              <Ink el={el} content={el.prevContent} px={fontPx} animate={false} reduced={reduced} maxWidth={el.maxWidth} />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: reduced ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduced ? 0.15 : morphS * 0.65, delay: reduced ? 0 : morphS * 0.3, ease: EASE_SMOOTH }}
            >
              <Ink el={el} content={el.content} px={fontPx} animate={false} reduced={reduced} maxWidth={el.maxWidth} />
            </motion.div>
          </>
        ) : animate === 'enter' && !reduced ? (
          // Written by the pen: stroke by stroke (handwriting) or symbol by symbol (maths).
          <Ink el={el} content={el.content} px={fontPx} animate reduced={reduced} duration={enterMs} maxWidth={el.maxWidth} />
        ) : (
          <motion.div
            initial={animate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ duration: reduced ? 0.2 : 0.18 }}
          >
            <Ink el={el} content={el.content} px={fontPx} animate={false} reduced={reduced} maxWidth={el.maxWidth} />
          </motion.div>
        )}
      </div>
    </motion.div>
  )
}

/** A board text/math element shown as a readable note in normal document flow (phone layout). */
function FlowText({
  el,
  animate,
  reduced,
  registerRef,
  mark,
  duration,
}: {
  el: TextEl
  animate: 'enter' | 'morph' | null
  reduced: boolean
  registerRef: (id: string, node: HTMLElement | null) => void
  mark: { style: 'box' | 'underline'; color: TextEl['color']; fresh: boolean } | null
  duration?: number
}) {
  const px = FLOW_PX[el.size] * (el.kind === 'math' ? 1.08 : 1)
  const cls = el.font === 'sans' && el.kind === 'text' ? 'font-sans tracking-[-0.01em]' : 'font-display'
  const color = INK_HEX[el.color]
  const markColor = mark ? INK_HEX[mark.color] : undefined
  const enterMs = duration ?? animMs({ type: el.kind === 'math' ? 'math' : 'write', text: el.content, tex: el.content, x: 0, y: 0 } as never)
  const morphing = animate === 'morph'
  // Width the handwriting may wrap to (the notes column).
  const outerRef = useRef<HTMLDivElement>(null)
  const [avail, setAvail] = useState(0)
  useLayoutEffect(() => {
    const node = outerRef.current
    if (!node) return
    const read = () => setAvail(Math.max(80, node.clientWidth - (mark?.style === 'box' ? 18 : 2)))
    read()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null
    ro?.observe(node)
    return () => ro?.disconnect()
  }, [mark?.style])
  const hand = el.kind === 'text' && !el.dyn && canHandwrite(el.content)
  return (
    <motion.div
      ref={outerRef}
      layout={reduced ? false : 'position'}
      initial={animate === 'enter' ? { opacity: 0, y: reduced ? 0 : 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: reduced ? 0.01 : 0.2 } }}
      transition={{ duration: reduced ? 0.01 : 0.35, ease: EASE_SMOOTH }}
      className={el.align === 'center' ? 'text-center' : el.align === 'right' ? 'text-right' : 'text-left'}
    >
      <div
        ref={node => { if (el.id) registerRef(el.id, node) }}
        className={`wb-flow relative inline-block max-w-full leading-[1.3] ${cls}`}
        style={{
          fontSize: px,
          color,
          whiteSpace: 'pre-line',
          overflowWrap: 'anywhere',
          padding: mark?.style === 'box' ? '2px 8px' : undefined,
          margin: mark?.style === 'box' ? '-2px -8px' : undefined,
          borderRadius: 8,
          boxShadow: mark?.style === 'box' ? `inset 0 0 0 2px ${markColor}` : undefined,
          background: mark?.style === 'box' ? `${markColor}17` : undefined,
          textDecoration: mark?.style === 'underline' ? 'underline' : undefined,
          textDecorationColor: markColor,
          textDecorationThickness: mark?.style === 'underline' ? 3 : undefined,
          textUnderlineOffset: mark?.style === 'underline' ? 6 : undefined,
          transition: 'box-shadow 300ms, background-color 300ms',
        }}
      >
        <motion.div
          key={morphing ? `m-${el.morphAct ?? el.content}` : 'c'}
          initial={morphing ? { opacity: 0, y: reduced ? 0 : 6 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: morphing ? (reduced ? 0.15 : 0.6) : 0.2, ease: EASE_SMOOTH }}
          className={el.kind === 'math' ? 'max-w-full overflow-x-auto overflow-y-hidden py-1' : undefined}
        >
          {hand && !avail ? null : (
            <Ink el={el} content={el.content} px={px} animate={animate === 'enter'} reduced={reduced} duration={enterMs} maxWidth={hand ? avail : undefined} />
          )}
        </motion.div>
      </div>
    </motion.div>
  )
}


/* ───────────── Equation morph (like Manim's TransformMatchingTex) ───────────── */

function glyphLeaves(root: HTMLElement): HTMLElement[] {
  const html = root.querySelector('.katex-html') ?? root
  return Array.from(html.querySelectorAll<HTMLElement>('span')).filter(n => n.childElementCount === 0 && !!n.textContent?.trim())
}

/**
 * Morphs one rendered equation into the next: glyphs that appear in both slide
 * from their old place to their new place (and resize), glyphs that disappear
 * fade out, and new glyphs fade in. Pure DOM measurement plus the Web Animations
 * API, so KaTeX's own layout is never disturbed (the moving glyphs are clones).
 */
function MorphMath({ from, to, ms }: { from: string; to: string; ms: number }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const oldRef = useRef<HTMLDivElement>(null)
  const newRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const oldHtml = useMemo(() => renderTex(from, true), [from])
  const newHtml = useMemo(() => renderTex(to, true), [to])
  useLayoutEffect(() => {
    const host = hostRef.current, oldEl = oldRef.current, newEl = newRef.current, overlay = overlayRef.current
    if (!host || !oldEl || !newEl || !overlay || typeof host.animate !== 'function') return
    const hr = host.getBoundingClientRect()
    const k = host.offsetWidth ? hr.width / host.offsetWidth : 1
    const olds = glyphLeaves(oldEl), news = glyphLeaves(newEl)
    const used = new Set<number>()
    const anims: Animation[] = []
    const clones: HTMLElement[] = []
    const easing = 'cubic-bezier(0.45, 0.05, 0.25, 1)'
    news.forEach((n, ni) => {
      const txt = n.textContent
      // Prefer the unused old glyph with the same text nearest in relative position.
      let best = -1, bestD = Infinity
      olds.forEach((o, oi) => {
        if (used.has(oi) || o.textContent !== txt) return
        const d = Math.abs(oi / Math.max(1, olds.length) - ni / Math.max(1, news.length))
        if (d < bestD) { bestD = d; best = oi }
      })
      if (best < 0 || bestD > 0.6) return
      used.add(best)
      const o = olds[best]
      const or = o.getBoundingClientRect(), nr = n.getBoundingClientRect()
      if (!or.width || !nr.width) return
      const cs = getComputedStyle(o)
      const c = document.createElement('span')
      c.textContent = txt
      Object.assign(c.style, {
        position: 'absolute', left: `${(or.left - hr.left) / k}px`, top: `${(or.top - hr.top) / k}px`,
        fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontStyle: cs.fontStyle, fontWeight: cs.fontWeight,
        lineHeight: `${or.height / k}px`, height: `${or.height / k}px`, whiteSpace: 'pre', color: cs.color, transformOrigin: '0 0', margin: '0', padding: '0',
      })
      overlay.appendChild(c)
      clones.push(c)
      o.style.visibility = 'hidden'
      n.style.visibility = 'hidden'
      const dx = (nr.left - or.left) / k, dy = (nr.top - or.top) / k, sc = nr.height / or.height || 1
      const a = c.animate([{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${dx}px, ${dy}px) scale(${sc})` }], { duration: ms * 0.85, easing, fill: 'forwards' })
      a.onfinish = () => { n.style.visibility = ''; c.remove() }
      anims.push(a)
    })
    anims.push(oldEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.4, easing, fill: 'forwards' }))
    anims.push(newEl.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], { duration: ms, easing, fill: 'forwards' }))
    return () => {
      anims.forEach(a => { try { a.cancel() } catch { /* ignore */ } })
      clones.forEach(c => c.remove())
      news.forEach(n => { n.style.visibility = '' })
    }
  }, [oldHtml, newHtml, ms])
  return (
    <div ref={hostRef} className="relative">
      <div ref={oldRef} aria-hidden className="pointer-events-none absolute left-0 top-0" style={{ whiteSpace: 'pre' }}>
        <span className="wb-math" dangerouslySetInnerHTML={{ __html: oldHtml }} />
      </div>
      <div ref={newRef}>
        <span className="wb-math" dangerouslySetInnerHTML={{ __html: newHtml }} />
      </div>
      <div ref={overlayRef} aria-hidden className="katex pointer-events-none absolute inset-0" style={{ fontSize: 'inherit' }} />
    </div>
  )
}

/* ───────────── Motion applied after drawing (move / fade / scale / pulse) ───────────── */

/** Wraps an element so move / fade / scale / colour pulses animate over the action's duration. */
export function FxWrap({ fx, ms, reduced, svg, children }: { fx?: Fx; ms: number; reduced: boolean; svg?: boolean; children: React.ReactNode }) {
  if (!fx) return <>{children}</>
  const t = { duration: reduced ? 0.15 : Math.max(0.2, ms / 1000), ease: EASE_SMOOTH }
  const anim = { x: reduced ? fx.dx : fx.dx, y: fx.dy, scale: fx.scale, opacity: fx.opacity }
  const pulse = fx.pulse && !reduced
    ? { scale: [1, 1.16, 1], transition: { duration: Math.min(1.1, Math.max(0.5, ms / 1000)), ease: EASE_SMOOTH } }
    : undefined
  if (svg) {
    return (
      <motion.g initial={false} animate={anim} transition={t} style={{ transformBox: 'fill-box', originX: 0.5, originY: 0.5 }}>
        <motion.g key={fx.pulse ?? 'p'} animate={pulse} style={{ transformBox: 'fill-box', originX: 0.5, originY: 0.5 }}>{children}</motion.g>
      </motion.g>
    )
  }
  return (
    <motion.div initial={false} animate={anim} transition={t} className="absolute left-0 top-0" style={{ width: 0, height: 0, overflow: 'visible' }}>
      <motion.div key={fx.pulse ?? 'p'} animate={pulse} style={{ width: 0, height: 0, overflow: 'visible' }}>{children}</motion.div>
    </motion.div>
  )
}

/* ───────────── Shapes (SVG) ───────────── */

function pathFromPoints(pts: [number, number][]) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ')
}

function arrowHead(from: [number, number], to: [number, number], size = 13) {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0])
  const l: [number, number] = [to[0] - size * Math.cos(a - 0.42), to[1] - size * Math.sin(a - 0.42)]
  const r: [number, number] = [to[0] - size * Math.cos(a + 0.42), to[1] - size * Math.sin(a + 0.42)]
  return `M${l[0].toFixed(2)} ${l[1].toFixed(2)} L${to[0].toFixed(2)} ${to[1].toFixed(2)} L${r[0].toFixed(2)} ${r[1].toFixed(2)}`
}

function functionPath(expr: string, axes: AxesDef, domain: [number, number] | undefined, vars: Vars) {
  const fn = evalFn(expr, vars)
  const c = { fn }
  const [x0, x1] = domain ?? axes.xRange
  const [y0, y1] = axes.yRange
  const span = y1 - y0
  const N = 260
  let d = ''
  let pen = false
  for (let i = 0; i <= N; i++) {
    const gx = x0 + ((x1 - x0) * i) / N
    const gy = c.fn(gx)
    if (!Number.isFinite(gy) || gy < y0 - span * 0.6 || gy > y1 + span * 0.6) { pen = false; continue }
    const [bx, by] = toBoard(axes, [gx, gy])
    d += `${pen ? 'L' : 'M'}${bx.toFixed(2)} ${by.toFixed(2)} `
    pen = true
  }
  return d.trim()
}

function niceTicks(lo: number, hi: number, step?: number) {
  if (!step) return []
  const out: number[] = []
  const start = Math.ceil(lo / step) * step
  for (let v = start; v <= hi + 1e-9 && out.length < 40; v += step) {
    if (Math.abs(v) > 1e-9) out.push(Math.round(v * 1e6) / 1e6)
  }
  return out
}

interface StrokeProps {
  d: string
  color: string
  width: number
  dashed?: boolean
  animate: boolean
  reduced: boolean
  duration: number
  delay?: number
  clipId?: string
  fill?: string
  maskId: string
}

/** cubic-bezier(x1, y1, x2, y2) as a function of time (same curve framer-motion uses). */
function bezier([x1, y1, x2, y2]: [number, number, number, number]) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const sy = (t: number) => ((ay * t + by) * t + cy) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 6; i++) { const e = sx(t) - x; const d = dx(t); if (Math.abs(e) < 1e-4 || !d) break; t -= e / d }
    return sy(Math.min(1, Math.max(0, t)))
  }
}
const easeSmooth = bezier(EASE_SMOOTH)

/** Client position of a point at length `l` along a path inside the board's SVG (handles CSS scaling and group transforms). */
function pathPoint(path: SVGPathElement, l: number): Pt | null {
  const svg = path.ownerSVGElement
  if (!svg) return null
  const r = svg.getBoundingClientRect()
  const w = svg.width.baseVal.value || svg.clientWidth
  if (!r.width || !w) return null
  let pt = path.getPointAtLength(l)
  const m = path.getCTM()
  if (m) pt = pt.matrixTransform(m)
  const k = r.width / w
  return { x: r.left + pt.x * k, y: r.top + pt.y * k }
}

/** Has the board's pen follow a path while framer-motion draws it on. */
function usePenFollow(ref: React.RefObject<SVGPathElement | null>, active: boolean, duration: number, delay: number) {
  const pen = usePen()
  useEffect(() => {
    const p = ref.current
    if (!p || !active || duration <= 0) return
    let len = 0
    try { len = p.getTotalLength() } catch { return }
    if (len < 2) return
    return pen.run([{ start: delay * 1000, dur: duration * 1000, point: f => pathPoint(p, len * easeSmooth(f)) }])
    // Once per mount of a newly drawn stroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}

/** A path drawn on with a stroke animation. Dashed paths are revealed through a mask so the dashes survive. */
function Stroke({ d, color, width, dashed, animate, reduced, duration, delay = 0, clipId, fill = 'none', maskId }: StrokeProps) {
  const draw = animate && !reduced
  const pathRef = useRef<SVGPathElement>(null)
  usePenFollow(pathRef, draw, duration, delay)
  const common = {
    fill,
    stroke: color,
    strokeWidth: width,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    clipPath: clipId ? `url(#${clipId})` : undefined,
  }
  if (dashed) {
    return (
      <g>
        {draw && (
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x="-100" y="-100" width="1000" height="700">
              <motion.path
                d={d}
                fill="none"
                stroke="#fff"
                strokeWidth={width + 6}
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration, delay, ease: EASE_SMOOTH }}
              />
            </mask>
          </defs>
        )}
        <path ref={pathRef} d={d} {...common} strokeDasharray={`${width * 3} ${width * 2.6}`} mask={draw ? `url(#${maskId})` : undefined} />
      </g>
    )
  }
  return (
    <motion.path
      ref={pathRef}
      d={d}
      {...common}
      initial={draw ? { pathLength: 0, opacity: 0 } : animate ? { opacity: 0 } : false}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{
        pathLength: { duration, delay, ease: EASE_SMOOTH },
        opacity: { duration: reduced ? 0.15 : 0.12, delay },
      }}
    />
  )
}

function FadeIn({ children, animate, delay = 0, reduced }: { children: React.ReactNode; animate: boolean; delay?: number; reduced: boolean }) {
  return (
    <motion.g
      initial={animate ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0.15 : 0.4, delay: reduced ? 0 : delay }}
    >
      {children}
    </motion.g>
  )
}

/** Slope of f at x (central difference). */
function slopeAt(f: (x: number) => number, x: number) {
  const h = 1e-4
  return (f(x + h) - f(x - h)) / (2 * h)
}

export function ShapeElement({ el, animate, reduced, duration, vars: boardVars = NO_VARS }: { el: ShapeEl; animate: boolean; reduced: boolean; duration?: number; vars?: Vars }) {
  const vars = useLiveVars(!!el.dyn, boardVars)
  const { step } = el
  const tickPx = useMinUnits(14, 11.5)
  const axisLabelPx = useMinUnits(20, 15)
  const pointLabelPx = useMinUnits(22, 15)
  const shape: Shape = step.shape
  const color = INK_HEX[step.color ?? 'ink']
  const width = step.width ?? (shape.kind === 'axes' ? 1.6 : 2.6)
  const dur = (duration ?? animMs(step)) / 1000
  const clipId = el.axes ? `wb-clip-${el.axes.id}` : undefined
  const maskId = `wb-mask-${el.key.replace(/[^\w-]/g, '_')}`
  const P = (p: [Num, Num]) => toBoard(el.axes, [evalNum(p[0], vars), evalNum(p[1], vars)])
  const base = { color, width, dashed: step.dashed, animate, reduced, maskId }
  // 8-digit hex: the stroke colour at ~12% opacity.
  const fillTint = step.fill ? `${color}1F` : 'none'

  switch (shape.kind) {
    case 'line':
      return <Stroke {...base} d={pathFromPoints([P(shape.from), P(shape.to)])} duration={dur} clipId={clipId} />
    case 'arrow': {
      const a = P(shape.from), b = P(shape.to)
      return (
        <g>
          <Stroke {...base} d={pathFromPoints([a, b])} duration={dur * 0.8} clipId={clipId} />
          <Stroke {...base} maskId={`${maskId}-h`} dashed={false} d={arrowHead(a, b, 9 + width * 1.6)} duration={dur * 0.25} delay={dur * 0.75} />
        </g>
      )
    }
    case 'polyline':
      return <Stroke {...base} d={pathFromPoints(shape.points.map(P))} duration={dur} clipId={clipId} />
    case 'polygon': {
      const pts = shape.points.map(P)
      return <Stroke {...base} d={`${pathFromPoints(pts)} Z`} duration={dur} clipId={clipId} fill={fillTint} />
    }
    case 'arc':
    case 'sector': {
      const [cx, cy] = P(shape.center)
      const r = shape.r * xScale(el.axes)
      let a0 = shape.from, a1 = shape.to
      if (a1 < a0) [a0, a1] = [a1, a0]
      const sweep = Math.min(359.99, a1 - a0)
      const pt = (deg: number) => [cx + r * Math.cos((deg * Math.PI) / 180), cy - r * Math.sin((deg * Math.PI) / 180)] as const
      const [sx, sy] = pt(a0), [ex, ey] = pt(a0 + sweep)
      const large = sweep > 180 ? 1 : 0
      const arc = `M${sx.toFixed(2)} ${sy.toFixed(2)} A${r} ${r} 0 ${large} 0 ${ex.toFixed(2)} ${ey.toFixed(2)}`
      const d = shape.kind === 'sector' ? `M${cx} ${cy} L${sx.toFixed(2)} ${sy.toFixed(2)} A${r} ${r} 0 ${large} 0 ${ex.toFixed(2)} ${ey.toFixed(2)} Z` : arc
      return <Stroke {...base} d={d} duration={dur} clipId={clipId} fill={shape.kind === 'sector' ? fillTint : 'none'} />
    }
    case 'rect': {
      const [x, y] = P([shape.x, shape.y])
      const [x2, y2] = P([shape.x + shape.w, shape.y + shape.h])
      const pts: [number, number][] = [[x, y], [x2, y], [x2, y2], [x, y2], [x, y]]
      return <Stroke {...base} d={pathFromPoints(pts)} duration={dur} clipId={clipId} fill={fillTint} />
    }
    case 'circle': {
      const [cx, cy] = P(shape.center)
      const r = shape.r * xScale(el.axes)
      const d = `M${cx + r} ${cy} A${r} ${r} 0 1 1 ${cx - r} ${cy} A${r} ${r} 0 1 1 ${cx + r} ${cy}`
      return <Stroke {...base} d={d} duration={dur} clipId={clipId} fill={fillTint} />
    }
    case 'point': {
      const [x, y] = P(shape.at)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      return (
        <FadeIn animate={animate} reduced={reduced}>
          <motion.circle
            cx={x}
            cy={y}
            r={5.5}
            fill={color}
            initial={animate && !reduced ? { scale: 0 } : false}
            animate={{ scale: 1 }}
            transition={{ duration: 0.35, ease: EASE_SMOOTH }}
            style={{ transformOrigin: `${x}px ${y}px` }}
          />
          {shape.label && (
            <text
              x={x + (shape.labelPos === 'nw' || shape.labelPos === 'sw' ? -12 : 12)}
              y={y + (shape.labelPos === 'se' || shape.labelPos === 'sw' ? 26 : -12)}
              textAnchor={shape.labelPos === 'nw' || shape.labelPos === 'sw' ? 'end' : 'start'}
              fontSize={pointLabelPx} fill={color} fontStyle="italic" style={{ fontFamily: 'var(--font-serif)' }}>
              {shape.label}
            </text>
          )}
        </FadeIn>
      )
    }
    case 'axes': {
      const { frame, xRange, yRange } = shape
      const ax: AxesDef = { id: step.id ?? 'axes', frame, xRange, yRange }
      const originX = xRange[0] <= 0 && xRange[1] >= 0 ? 0 : xRange[0]
      const originY = yRange[0] <= 0 && yRange[1] >= 0 ? 0 : yRange[0]
      const xa = toBoard(ax, [xRange[0], originY]), xb = toBoard(ax, [xRange[1], originY])
      const ya = toBoard(ax, [originX, yRange[0]]), yb = toBoard(ax, [originX, yRange[1]])
      const xticks = niceTicks(xRange[0], xRange[1] - (xRange[1] - xRange[0]) * 0.04, shape.xStep)
      const yticks = niceTicks(yRange[0], yRange[1] - (yRange[1] - yRange[0]) * 0.04, shape.yStep)
      const axisColor = INK_HEX[step.color ?? 'muted']
      return (
        <g>
          <Stroke {...base} color={axisColor} d={pathFromPoints([xa, xb])} duration={dur * 0.55} />
          <Stroke {...base} color={axisColor} maskId={`${maskId}-y`} d={pathFromPoints([ya, yb])} duration={dur * 0.55} delay={dur * 0.2} />
          <FadeIn animate={animate} reduced={reduced} delay={dur * 0.55}>
            <path d={arrowHead(xa, xb, 10)} fill="none" stroke={axisColor} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
            <path d={arrowHead(ya, yb, 10)} fill="none" stroke={axisColor} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
            {xticks.map(v => {
              const [tx, ty] = toBoard(ax, [v, originY])
              return (
                <g key={`x${v}`}>
                  <line x1={tx} y1={ty - 4} x2={tx} y2={ty + 4} stroke={axisColor} strokeWidth={1.2} />
                  <text x={tx} y={ty + 6 + tickPx} fontSize={tickPx} textAnchor="middle" fill={INK_HEX.muted} style={{ fontFamily: 'var(--font-sans)' }}>{v}</text>
                </g>
              )
            })}
            {yticks.map(v => {
              const [tx, ty] = toBoard(ax, [originX, v])
              return (
                <g key={`y${v}`}>
                  <line x1={tx - 4} y1={ty} x2={tx + 4} y2={ty} stroke={axisColor} strokeWidth={1.2} />
                  <text x={tx - 9} y={ty + tickPx * 0.36} fontSize={tickPx} textAnchor="end" fill={INK_HEX.muted} style={{ fontFamily: 'var(--font-sans)' }}>{v}</text>
                </g>
              )
            })}
            {shape.xLabel && (
              <text x={xb[0] - 2} y={xb[1] + 4 + axisLabelPx} fontSize={axisLabelPx} textAnchor="end" fontStyle="italic" fill={INK_HEX.ink} style={{ fontFamily: 'var(--font-serif)' }}>
                {shape.xLabel}
              </text>
            )}
            {shape.yLabel && (
              <text x={yb[0] + 12} y={yb[1] + axisLabelPx * 0.4} fontSize={axisLabelPx} fontStyle="italic" fill={INK_HEX.ink} style={{ fontFamily: 'var(--font-serif)' }}>
                {shape.yLabel}
              </text>
            )}
          </FadeIn>
        </g>
      )
    }
    case 'function': {
      if (!el.axes) return null
      const d = functionPath(shape.expr, el.axes, shape.domain, vars)
      if (!d) return null
      return <Stroke {...base} width={step.width ?? 3} d={d} duration={dur} clipId={clipId} />
    }
    case 'secant':
    case 'tangent': {
      if (!el.axes) return null
      const f = evalFn(shape.expr, vars)
      const [xr0, xr1] = el.axes.xRange
      let xa: number, xb: number, m: number, x0: number
      if (shape.kind === 'secant') {
        xa = evalNum(shape.x1, vars); xb = evalNum(shape.x2, vars)
        m = Math.abs(xb - xa) < 1e-6 ? slopeAt(f, xa) : (f(xb) - f(xa)) / (xb - xa)
        x0 = xa
        const ext = shape.extend ?? (xr1 - xr0) * 0.35
        xa = Math.min(xa, xb) - ext; xb = Math.max(evalNum(shape.x1, vars), xb) + ext
      } else {
        x0 = evalNum(shape.at, vars)
        m = slopeAt(f, x0)
        const half = (shape.len ?? (xr1 - xr0) * 2) / 2
        xa = x0 - half; xb = x0 + half
      }
      const y0 = f(x0)
      if (![xa, xb, m, y0].every(Number.isFinite)) return null
      const d = pathFromPoints([P([xa, y0 + m * (xa - x0)]), P([xb, y0 + m * (xb - x0)])])
      return <Stroke {...base} d={d} duration={dur} clipId={clipId} />
    }
  }
}

/* ───────────── Highlight ───────────── */

export function HighlightElement({
  el,
  animate,
  reduced,
  measure,
}: {
  el: HighlightEl
  animate: boolean
  reduced: boolean
  measure: (id: string) => Box | null
}) {
  const [box, setBox] = useState<Box | null>(null)
  useLayoutEffect(() => {
    let frame = 0
    const update = () => setBox(measure(el.target))
    update()
    // Re-measure once fonts/KaTeX have settled.
    const t = setTimeout(update, 120)
    const onResize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update) }
    window.addEventListener('resize', onResize)
    return () => { clearTimeout(t); cancelAnimationFrame(frame); window.removeEventListener('resize', onResize) }
  }, [el.target, measure])

  if (!box) return null
  const color = INK_HEX[el.color]
  const pad = 8
  const x = box.x - pad, y = box.y - pad / 1.5, w = box.w + pad * 2, h = box.h + (pad / 1.5) * 2
  const dur = reduced ? 0 : 0.6
  if (el.style === 'underline') {
    const d = `M${x + 4} ${y + h + 2} Q${x + w / 2} ${y + h + 6} ${x + w - 4} ${y + h + 1}`
    return (
      <motion.path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={3.5}
        strokeLinecap="round"
        initial={animate && !reduced ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: dur, ease: EASE_SMOOTH }}
      />
    )
  }
  const r = 8
  const d = `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`
  return (
    <motion.g exit={{ opacity: 0 }}>
      <motion.path
        d={d}
        fill={color}
        stroke="none"
        initial={animate ? { opacity: 0 } : false}
        animate={{ opacity: 0.09 }}
        transition={{ duration: reduced ? 0.15 : 0.5, delay: reduced ? 0 : 0.35 }}
      />
      <motion.path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2.2}
        strokeLinejoin="round"
        initial={animate && !reduced ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: dur, ease: EASE_SMOOTH }}
      />
    </motion.g>
  )
}

export function shapeBoxOf(el: ShapeEl) {
  return shapeBox(el)
}

'use client'
import { openZoom } from '@/components/zoomable'
import React, { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import katex from 'katex'
import { repairTex, texToPlain, validateTex } from '@/lib/math-text'
import { RichText } from '../rich-text'
import { BOARD_H, type Num, type Shape, type Vars } from '@/lib/lesson-schema'
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
import { PenCueContext, usePen, usePenCue, type PenCue, type Pt } from './pen'
import { RoughGenerator } from 'roughjs/bin/generator'
import { loadGsap } from './gsap-fx'
import { MARK_NOTE_PX, centerPath, markGeometry } from './marks'
import { shapeOutline, type MarkEl } from './board-state'

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

/** A highlight on a reflowed note (phone layout): drawn by the pen like any other highlight. */
export interface NoteMarkSpec { style: 'box' | 'underline'; color: TextEl['color']; fresh: boolean; cue?: PenCue | null }

/** On-screen sizes (px) of reflowed notes under the diagram on a phone. */
export const FLOW_PX: Record<TextEl['size'], number> = { sm: 17, md: 19, lg: 23, xl: 27 }

/** Multiplication typed as * (AI-written maths, live expressions) is shown as ×, never KaTeX's ∗. */
export function texTimes(tex: string): string {
  return tex.replace(/\^\s*\*|\^\{\s*\*\s*\}|\*/g, m => (m === '*' ? ' \\times ' : m))
}

export function renderTex(tex: string, display = false): string {
  // Repaired and validated first; maths KaTeX still cannot parse is shown as plain Unicode, never as raw LaTeX.
  const fixed = repairTex(texTimes(tex))
  if (!validateTex(fixed)) return escapeHtml(texToPlain(fixed))
  try {
    return katex.renderToString(display ? `\\displaystyle ${fixed}` : fixed, { throwOnError: false, displayMode: false, output: 'html', strict: 'ignore' })
  } catch {
    return escapeHtml(texToPlain(fixed))
  }
}

function escapeHtml(s: string) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!) }

function Content({ kind, content }: { kind: TextEl['kind']; content: string }) {
  const html = useMemo(() => (kind === 'math' ? renderTex(content, true) : null), [kind, content])
  if (html !== null) return <span className="wb-math" dangerouslySetInnerHTML={{ __html: html }} />
  // Notes may carry inline maths ($...$ or bare LaTeX): the shared renderer.
  return <RichText text={content} />
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
  mark?: NoteMarkSpec | null
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
        data-wb-text={el.key}
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
  mark: NoteMarkSpec | null
  duration?: number
}) {
  const px = FLOW_PX[el.size] * (el.kind === 'math' ? 1.08 : 1)
  const cls = el.font === 'sans' && el.kind === 'text' ? 'font-sans tracking-[-0.01em]' : 'font-display'
  const color = INK_HEX[el.color]
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
          transition: 'box-shadow 300ms, background-color 300ms',
        }}
      >
        {mark && <NoteMark mark={mark} reduced={reduced} />}
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
/** Moves, scales and fades an element. `origin` (board units) is what HTML text scales about: its anchor, so a text
 *  scaled in place stays where it is (the wrapper itself sits at the board's corner). */
export function FxWrap({ fx, ms, reduced, svg, origin, children }: { fx?: Fx; ms: number; reduced: boolean; svg?: boolean; origin?: [number, number]; children: React.ReactNode }) {
  if (!fx) return <>{children}</>
  // A glide along a path jumps the wrapper to the end at once; the GSAP layer inside runs the path into it.
  const gliding = !!fx.along && fx.along.act === fx.act
  const t = { duration: reduced || gliding ? (gliding ? 0 : 0.15) : Math.max(0.2, ms / 1000), ease: EASE_SMOOTH }
  const anim = { x: reduced ? fx.dx : fx.dx, y: fx.dy, scale: fx.scale, opacity: fx.opacity }
  const pulse = fx.pulse && !reduced
    ? { scale: [1, 1.16, 1], transition: { duration: Math.min(1.1, Math.max(0.5, ms / 1000)), ease: EASE_SMOOTH } }
    : undefined
  const inner = <GsapFx fx={fx} reduced={reduced} svg={svg} origin={origin}>{children}</GsapFx>
  if (svg) {
    return (
      <motion.g initial={false} animate={anim} transition={t} style={{ transformBox: 'fill-box', originX: 0.5, originY: 0.5 }}>
        <motion.g key={fx.pulse ?? 'p'} animate={pulse} style={{ transformBox: 'fill-box', originX: 0.5, originY: 0.5 }}>{inner}</motion.g>
      </motion.g>
    )
  }
  return (
    <motion.div initial={false} animate={anim} transition={t} className="absolute left-0 top-0" style={{ width: 0, height: 0, overflow: 'visible', originX: origin ? `${origin[0]}px` : undefined, originY: origin ? `${origin[1]}px` : undefined }}>
      <motion.div key={fx.pulse ?? 'p'} animate={pulse} style={{ width: 0, height: 0, overflow: 'visible', originX: origin ? `${origin[0]}px` : undefined, originY: origin ? `${origin[1]}px` : undefined }}>{inner}</motion.div>
    </motion.div>
  )
}

/** Duration (ms) the player gives an action; set by the player so GSAP cues fill their narration window. */
export const ActDurations = createContext<ReadonlyMap<string, number>>(new Map())

/** GSAP motion cues on an element: glide along a path (MotionPath) and beat / glow pulses. Off with reduced motion. */
function GsapFx({ fx, reduced, svg, origin, children }: { fx: Fx; reduced: boolean; svg?: boolean; origin?: [number, number]; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement & SVGGElement>(null)
  const durs = useContext(ActDurations)
  const along = fx.along && fx.along.act === fx.act ? fx.along : null
  const alongKey = along?.act
  useLayoutEffect(() => {
    const node = ref.current
    if (!node || !along || reduced) return
    const first = along.pts[0]
    // Start at the beginning of the path before GSAP has loaded (no flash at the end point).
    node.style.transform = `translate(${first[0]}px, ${first[1]}px)`
    let tween: { kill: () => void } | null = null
    let dead = false
    const ms = durs.get(along.act) ?? 1600
    loadGsap().then(gsap => {
      if (dead) return
      node.style.transform = ''
      tween = gsap.fromTo(node, { x: first[0], y: first[1] }, {
        motionPath: { path: along.pts.map(([x, y]) => ({ x, y })), curviness: along.pts.length > 2 ? 0.8 : 0, autoRotate: !!along.rotate },
        duration: Math.max(0.3, ms / 1000), ease: 'power1.inOut',
        onComplete: () => { gsap.set(node, { x: 0, y: 0, rotation: 0 }) },
      })
    }).catch(() => { node.style.transform = '' })
    return () => { dead = true; tween?.kill(); node.style.transform = '' }
    // Once per glide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alongKey, reduced])
  const beat = fx.beat
  const beatKey = beat?.act
  useLayoutEffect(() => {
    const node = ref.current
    if (!node || !beat || reduced || beat.style === 'trace') return
    let tween: { kill: () => void } | null = null
    let dead = false
    const ms = durs.get(beat.act) ?? 1100
    const n = Math.max(1, Math.min(4, beat.times))
    loadGsap().then(gsap => {
      if (dead) return
      const each = Math.max(0.12, ms / 1000 / (n * 2))
      const color = INK_HEX[beat.color]
      tween = beat.style === 'glow'
        ? gsap.fromTo(node, { filter: `drop-shadow(0 0 0px ${color})` }, { filter: `drop-shadow(0 0 9px ${color})`, duration: each, yoyo: true, repeat: n * 2 - 1, ease: 'sine.inOut', onComplete: () => { node.style.filter = '' } })
        : gsap.to(node, { scale: 1.14, duration: each, yoyo: true, repeat: n * 2 - 1, ease: 'sine.inOut', transformOrigin: svg ? '50% 50%' : origin ? `${origin[0]}px ${origin[1]}px` : '0 0', svgOrigin: undefined })
    }).catch(() => undefined)
    return () => { dead = true; tween?.kill(); node.style.filter = ''; node.style.scale = '' }
    // Once per pulse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatKey, reduced])
  if (svg) return <g ref={ref}>{children}</g>
  return <div ref={ref} style={{ width: 0, height: 0, overflow: 'visible' }}>{children}</div>
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
  duration?: number
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
/** A pen stroke's pace along its path: a gentle start and finish. */
const easeStroke = bezier([0.3, 0.05, 0.4, 1])

/** Client position of a board-SVG point (handles CSS scaling, the camera and group transforms). */
function svgToClient(el: SVGGraphicsElement, x: number, y: number): Pt | null {
  const svg = el.ownerSVGElement
  if (!svg) return null
  const r = svg.getBoundingClientRect()
  const w = svg.width.baseVal.value || svg.clientWidth
  if (!r.width || !w) return null
  let pt = new DOMPoint(x, y)
  const m = el.getCTM()
  if (m) pt = pt.matrixTransform(m)
  const k = r.width / w
  return { x: r.left + pt.x * k, y: r.top + pt.y * k }
}

/** Board speed of the pen on diagrams (board units per ms) and the pause between strokes (ms). */
const DRAW_SPEED = 0.42
const DRAW_GAP = 90

type InkItem = { weight: number; min: number; apply: (p: number) => void; point: (p: number) => Pt | null; reset: () => void }

/** The inkable parts of a drawn element, in drawing order (each tagged data-ink). */
function inkItems(root: SVGGElement): InkItem[] {
  const out: InkItem[] = []
  let lastPoint: (p: number) => Pt | null = () => null
  root.querySelectorAll<SVGGraphicsElement>('[data-ink]').forEach(node => {
    const kind = node.dataset.ink
    if (kind === 'path' || kind === 'dash') {
      const g = node as unknown as SVGGeometryElement
      let len = 0
      try { len = g.getTotalLength() } catch { len = 0 }
      if (!(len > 0.5)) return
      // Dashed lines are revealed through their mask path (the dashes stay); solid ones by their own dash offset.
      const target = kind === 'dash' ? (root.querySelector<SVGPathElement>(`#${CSS.escape(node.dataset.mask ?? '')} path`)) : g
      if (!target) return
      const L = len + 1
      target.style.strokeDasharray = `${L} ${L}`
      target.style.strokeDashoffset = `${L}`
      const point = (p: number) => { const q = g.getPointAtLength(len * easeStroke(p)); return svgToClient(g, q.x, q.y) }
      out.push({
        weight: len, min: 110,
        apply: p => {
          if (p >= 1) { target.style.strokeDasharray = ''; target.style.strokeDashoffset = ''; return }
          target.style.strokeDasharray = `${L} ${L}`
          target.style.strokeDashoffset = `${L * (1 - easeStroke(p))}`
        },
        point,
        reset: () => { target.style.strokeDasharray = ''; target.style.strokeDashoffset = '' },
      })
      lastPoint = point
    } else if (kind === 'figure') {
      // A finished picture is wiped in left to right, with the pen tip riding along its bottom edge: the hand hangs
      // below and to the right of the tip, so it never sits over the picture's labels while they appear.
      let bb: DOMRect
      try { bb = node.getBBox() } catch { return }
      if (!bb.width) return
      const clip = (p: number) => `polygon(-2% -2%, ${(-2 + p * 104).toFixed(1)}% -2%, ${(-2 + p * 104).toFixed(1)}% 102%, -2% 102%)`
      node.style.clipPath = clip(0)
      const point = (p: number) => svgToClient(node, bb.x + bb.width * p, bb.y + bb.height + 4)
      out.push({
        weight: bb.width * 1.2, min: 400,
        apply: p => { node.style.clipPath = p >= 1 ? '' : clip(p) },
        point,
        reset: () => { node.style.clipPath = '' },
      })
      lastPoint = point
    } else if (kind === 'text') {
      // Written left to right: a clip that opens as the tip crosses it.
      let bb: DOMRect
      try { bb = node.getBBox() } catch { return }
      if (!bb.width) return
      const clip = (p: number) => `polygon(-20% -60%, ${(-2 + p * 104).toFixed(1)}% -60%, ${(-2 + p * 104).toFixed(1)}% 160%, -20% 160%)`
      node.style.clipPath = clip(0)
      const point = (p: number) => svgToClient(node, bb.x + bb.width * p, bb.y + bb.height * (0.62 + 0.18 * Math.sin(p * Math.PI * 2 * Math.max(1, bb.width / 14))))
      out.push({
        weight: bb.width * 1.4, min: 140,
        apply: p => { node.style.clipPath = p >= 1 ? '' : clip(p) },
        point,
        reset: () => { node.style.clipPath = '' },
      })
      lastPoint = point
    } else if (kind === 'dot') {
      // A dot: the pen presses and it grows under the tip.
      const c = node as unknown as SVGCircleElement
      const cx = c.cx.baseVal.value, cy = c.cy.baseVal.value
      node.style.transformBox = 'fill-box'
      node.style.transformOrigin = 'center'
      node.style.transform = 'scale(0)'
      const point = () => svgToClient(node, cx, cy)
      out.push({ weight: 10, min: 160, apply: p => { node.style.transform = p >= 1 ? '' : `scale(${easeStroke(p).toFixed(3)})` }, point, reset: () => { node.style.transform = '' } })
      lastPoint = point
    } else if (kind === 'sweep') {
      // Tick marks and their numbers along an axis: each appears as the tip passes it.
      const [x1, y1, x2, y2] = (node.dataset.sweep ?? '').split(',').map(Number)
      if (![x1, y1, x2, y2].every(Number.isFinite)) return
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1
      const kids = Array.from(node.children) as SVGGraphicsElement[]
      const at = kids.map(k => { try { const b = k.getBBox(); return ((b.x + b.width / 2 - x1) * dx + (b.y + b.height / 2 - y1) * dy) / (len * len) } catch { return 0 } })
      kids.forEach(k => { k.style.opacity = '0' })
      const point = (p: number) => svgToClient(node, x1 + dx * p, y1 + dy * p)
      out.push({
        weight: len * 0.8, min: 200,
        apply: p => kids.forEach((k, i) => { k.style.opacity = p >= 1 || at[i] <= p ? '' : '0' }),
        point,
        reset: () => kids.forEach(k => { k.style.opacity = '' }),
      })
      lastPoint = point
    } else if (kind === 'fill') {
      // A shape's tint washes in as its outline closes; the pen rests at the end of the outline meanwhile.
      node.style.opacity = '0'
      const point = lastPoint
      out.push({ weight: 0, min: 160, apply: p => { node.style.opacity = p >= 1 ? '' : String(p) }, point: p => point(1) ?? point(p), reset: () => { node.style.opacity = '' } })
    }
  })
  return out
}

/**
 * Draws everything tagged data-ink inside `ref` with the board's pen, on the element's narration cue: every stroke,
 * tick and label appears only under the marker tip, in order, within `durationMs`.
 */
function useInkGroup(ref: React.RefObject<SVGGElement | null>, active: boolean, durationMs: number, tag: string, ready = true) {
  const pen = usePen()
  const cue = usePenCue()
  useLayoutEffect(() => {
    const root = ref.current
    if (!root || !active || !ready) return
    const items = inkItems(root)
    if (!items.length) return
    const natural = items.map(it => Math.max(it.min, it.weight / DRAW_SPEED))
    const gaps = DRAW_GAP * (items.length - 1)
    const sum = natural.reduce((a, b) => a + b, 0) + gaps
    const room = Math.max(160, durationMs - 40)
    // Never slower than a relaxed hand (1.6x natural), never longer than the cue window.
    const k = Math.min(room / sum, 1.6)
    let t = 0
    const segs = items.map((it, i) => {
      const seg = { start: t, dur: natural[i] * k, apply: it.apply, point: it.point }
      t += natural[i] * k + DRAW_GAP * k
      return seg
    })
    const cancel = pen.run(segs, cue, tag)
    return () => { cancel(); items.forEach(it => it.reset()) }
    // Once per newly drawn element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ready])
}

/** A path drawn by the pen (see useInkGroup). Dashed paths are revealed through a mask so the dashes survive. */
function Stroke({ d, color, width, dashed, animate, reduced, clipId, fill = 'none', maskId }: StrokeProps) {
  const draw = animate && !reduced
  const common = {
    stroke: color,
    strokeWidth: width,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    clipPath: clipId ? `url(#${clipId})` : undefined,
  }
  const fillPath = fill !== 'none' ? <path d={d} fill={fill} stroke="none" clipPath={common.clipPath} data-ink={draw ? 'fill' : undefined} /> : null
  if (dashed) {
    return (
      <g>
        {draw && (
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x="-100" y="-100" width="1000" height="700">
              <path d={d} fill="none" stroke="#fff" strokeWidth={width + 6} strokeLinecap="round" />
            </mask>
          </defs>
        )}
        <path d={d} fill="none" {...common} strokeDasharray={`${width * 3} ${width * 2.6}`} mask={draw ? `url(#${maskId})` : undefined}
          data-ink={draw ? 'dash' : undefined} data-mask={draw ? maskId : undefined} />
        {fillPath}
      </g>
    )
  }
  return (
    <>
      <path d={d} fill="none" {...common} data-ink={draw ? 'path' : undefined} />
      {fillPath}
    </>
  )
}

/** Slope of f at x (central difference). */
function slopeAt(f: (x: number) => number, x: number) {
  const h = 1e-4
  return (f(x + h) - f(x - h)) / (2 * h)
}

type ShapeProps = { el: ShapeEl; animate: boolean; reduced: boolean; duration?: number; vars?: Vars; morphMs?: number }

/** One outline path of a shape (board units), for morphs and traces. */
function outlineD(el: ShapeEl, shape: Shape, vars: Vars) {
  const pts = shapeOutline({ ...el, step: { ...el.step, shape } }, vars)
  if (pts.length < 2) return ''
  const closed = ['circle', 'polygon', 'rect'].includes(shape.kind)
  return `${pathFromPoints(pts)}${closed ? ' Z' : ''}`
}

/** A drawn shape: everything in it is inked by the board's pen on the shape's cue (see useInkGroup). */
export function ShapeElement(props: ShapeProps) {
  const ref = useRef<SVGGElement>(null)
  const morphRef = useRef<SVGPathElement>(null)
  const traceRef = useRef<SVGPathElement>(null)
  const draw = props.animate && !props.reduced
  useInkGroup(ref, draw, props.duration ?? animMs(props.el.step), `draw:${props.el.step.shape.kind}:${props.el.key}`)
  const { el, reduced, morphMs } = props
  const vars = props.vars ?? NO_VARS
  // Morph (GSAP MorphSVG): while it runs, one outline path tweens from the old shape to the new one.
  const morphing = morphMs !== undefined && !reduced && !!el.prevShape && !!el.morphAct
  const [morphDone, setMorphDone] = useState<string | null>(null)
  const showMorph = morphing && morphDone !== el.morphAct
  const fromD = showMorph && el.prevShape ? outlineD(el, el.prevShape, vars) : ''
  const toD = showMorph ? outlineD(el, el.step.shape, vars) : ''
  useLayoutEffect(() => {
    const path = morphRef.current
    if (!showMorph || !path || !fromD || !toD) { if (showMorph && (!fromD || !toD)) setMorphDone(el.morphAct ?? null); return }
    let dead = false
    let tween: { kill: () => void } | null = null
    path.setAttribute('d', fromD)
    loadGsap().then(gsap => {
      if (dead) return
      tween = gsap.to(path, { morphSVG: { shape: toD, type: 'rotational' }, duration: Math.max(0.35, (morphMs ?? 1200) / 1000), ease: 'power2.inOut', onComplete: () => setMorphDone(el.morphAct ?? null) })
    }).catch(() => setMorphDone(el.morphAct ?? null))
    return () => { dead = true; tween?.kill() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el.morphAct, showMorph])
  // Trace (GSAP DrawSVG): a bright pen runs once along the outline, then fades.
  const beat = el.fx?.beat
  const traceKey = beat?.style === 'trace' ? beat.act : null
  const traceD = traceKey ? outlineD(el, el.step.shape, vars) : ''
  const durs = useContext(ActDurations)
  useLayoutEffect(() => {
    const path = traceRef.current
    if (!traceKey || !path || reduced) return
    let dead = false
    let tl: { kill: () => void } | null = null
    const ms = durs.get(traceKey) ?? 1100
    loadGsap().then(gsap => {
      if (dead) return
      tl = gsap.timeline()
        .fromTo(path, { drawSVG: '0% 0%', opacity: 1 }, { drawSVG: '0% 100%', duration: Math.max(0.4, ms / 1000 * 0.75), ease: 'power1.inOut' })
        .to(path, { opacity: 0, duration: 0.35 })
    }).catch(() => undefined)
    return () => { dead = true; tl?.kill() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceKey, reduced])
  const color = INK_HEX[el.step.color ?? 'ink']
  return (
    <g ref={ref}>
      {showMorph
        ? <path ref={morphRef} d={fromD} fill="none" stroke={color} strokeWidth={el.step.width ?? 2.6} strokeLinecap="round" strokeLinejoin="round" clipPath={el.axes ? `url(#wb-clip-${el.axes.id})` : undefined} />
        : <ShapeBody {...props} />}
      {traceKey && traceD && !reduced && (
        <path ref={traceRef} d={traceD} fill="none" stroke={INK_HEX[beat?.color ?? 'amber']} strokeWidth={(el.step.width ?? 2.6) + 3.5} strokeLinecap="round" strokeLinejoin="round" opacity={0} style={{ filter: `drop-shadow(0 0 4px ${INK_HEX[beat?.color ?? 'amber']})` }} />
      )}
    </g>
  )
}

const roughGen = new RoughGenerator()
function seedOf(key: string) { let h = 7; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 2147483647; return h || 1 }

/** Rough.js paths for a shape (sketchy outline; hachure for fills). Null for shapes it has no look for. */
function roughPaths(shape: Shape, P: (p: [Num, Num]) => [number, number], scale: number, color: string, width: number, fill: boolean, key: string) {
  const o = { seed: seedOf(key), roughness: 1.1, bowing: 0.9, stroke: color, strokeWidth: width, fill: fill ? `${color}8C` : undefined, fillStyle: 'hachure', hachureGap: 7, hachureAngle: -41, fillWeight: 1.2, preserveVertices: true }
  let d
  switch (shape.kind) {
    case 'rect': { const [x, y] = P([shape.x, shape.y]); const [x2, y2] = P([shape.x + shape.w, shape.y + shape.h]); d = roughGen.rectangle(Math.min(x, x2), Math.min(y, y2), Math.abs(x2 - x), Math.abs(y2 - y), o); break }
    case 'circle': { const [cx, cy] = P(shape.center); d = roughGen.circle(cx, cy, shape.r * scale * 2, o); break }
    case 'polygon': d = roughGen.polygon(shape.points.map(p => P(p)), o); break
    case 'polyline': d = roughGen.linearPath(shape.points.map(p => P(p)), o); break
    case 'line': case 'arrow': { const a = P(shape.from), b = P(shape.to); d = roughGen.line(a[0], a[1], b[0], b[1], o); break }
    default: return null
  }
  // Outline strokes first, then the hachure, as a hand would draw it.
  return roughGen.toPaths(d).sort((a, b) => (a.fill === 'none' ? 0 : 1) - (b.fill === 'none' ? 0 : 1) || (a.stroke === color ? -1 : 1))
}

function ShapeBody({ el, animate, reduced, vars: boardVars = NO_VARS }: ShapeProps) {
  const vars = useLiveVars(!!el.dyn, boardVars)
  const { step } = el
  const tickPx = useMinUnits(14, 11.5)
  const axisLabelPx = useMinUnits(20, 15)
  const pointLabelPx = useMinUnits(22, 15)
  const shape: Shape = step.shape
  const color = INK_HEX[step.color ?? 'ink']
  const width = step.width ?? (shape.kind === 'axes' ? 1.6 : 2.6)
  const clipId = el.axes ? `wb-clip-${el.axes.id}` : undefined
  const maskId = `wb-mask-${el.key.replace(/[^\w-]/g, '_')}`
  const P = (p: [Num, Num]) => toBoard(el.axes, [evalNum(p[0], vars), evalNum(p[1], vars)])
  const base = { color, width, dashed: step.dashed, animate, reduced, maskId }
  // 8-digit hex: the stroke colour at ~12% opacity.
  const fillTint = step.fill ? `${color}1F` : 'none'
  const ink = animate && !reduced

  if (step.rough) {
    const paths = roughPaths(shape, P, xScale(el.axes), color, width, !!step.fill, el.key)
    if (paths) {
      return (
        <g clipPath={clipId ? `url(#${clipId})` : undefined}>
          {paths.map((p, i) => <path key={i} d={p.d} fill="none" stroke={p.stroke === 'none' ? color : p.stroke} strokeWidth={p.strokeWidth} strokeLinecap="round" strokeLinejoin="round" data-ink={ink ? 'path' : undefined} />)}
          {shape.kind === 'arrow' && (() => { const a = P(shape.from), b = P(shape.to); return <path d={arrowHead(a, b, 9 + width * 1.6)} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" data-ink={ink ? 'path' : undefined} /> })()}
        </g>
      )
    }
  }

  switch (shape.kind) {
    case 'figure': {
      // A finished picture (sanitised SVG), shown as an image: nothing inside it can run. Wiped in left to right.
      const href = shape.src || `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shape.svg)}`
      // Tap to zoom (small textbook labels on phones): opens the shared zoom view (ZoomHost in the app shell).
      return <image href={href} x={shape.x} y={shape.y} width={shape.w} height={shape.h} preserveAspectRatio="xMidYMid meet" data-ink={ink ? 'figure' : undefined}
        role="button" tabIndex={0} aria-label={`${shape.alt ?? 'Diagram'}. Open larger`} style={{ cursor: 'zoom-in', pointerEvents: 'auto' }}
        onClick={() => openZoom(href, shape.alt ?? 'Diagram')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openZoom(href, shape.alt ?? 'Diagram') } }}><title>{shape.alt ?? 'diagram'}</title></image>
    }
    case 'line':
      return <Stroke {...base} d={pathFromPoints([P(shape.from), P(shape.to)])} clipId={clipId} />
    case 'arrow': {
      const a = P(shape.from), b = P(shape.to)
      return (
        <g>
          <Stroke {...base} d={pathFromPoints([a, b])} clipId={clipId} />
          <Stroke {...base} maskId={`${maskId}-h`} dashed={false} d={arrowHead(a, b, 9 + width * 1.6)} />
        </g>
      )
    }
    case 'polyline':
      return <Stroke {...base} d={pathFromPoints(shape.points.map(P))} clipId={clipId} />
    case 'polygon': {
      const pts = shape.points.map(P)
      return <Stroke {...base} d={`${pathFromPoints(pts)} Z`} clipId={clipId} fill={fillTint} />
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
      return <Stroke {...base} d={d} clipId={clipId} fill={shape.kind === 'sector' ? fillTint : 'none'} />
    }
    case 'rect': {
      const [x, y] = P([shape.x, shape.y])
      const [x2, y2] = P([shape.x + shape.w, shape.y + shape.h])
      const pts: [number, number][] = [[x, y], [x2, y], [x2, y2], [x, y2], [x, y]]
      return <Stroke {...base} d={pathFromPoints(pts)} clipId={clipId} fill={fillTint} />
    }
    case 'circle': {
      const [cx, cy] = P(shape.center)
      const r = shape.r * xScale(el.axes)
      const d = `M${cx + r} ${cy} A${r} ${r} 0 1 1 ${cx - r} ${cy} A${r} ${r} 0 1 1 ${cx + r} ${cy}`
      return <Stroke {...base} d={d} clipId={clipId} fill={fillTint} />
    }
    case 'point': {
      const [x, y] = P(shape.at)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      const ink = animate && !reduced
      return (
        <g>
          <circle cx={x} cy={y} r={5.5} fill={color} data-ink={ink ? 'dot' : undefined} />
          {shape.label && (
            <text
              data-ink={ink ? 'text' : undefined}
              x={x + (shape.labelPos === 'nw' || shape.labelPos === 'sw' ? -12 : 12)}
              y={y + (shape.labelPos === 'se' || shape.labelPos === 'sw' ? 26 : -12)}
              textAnchor={shape.labelPos === 'nw' || shape.labelPos === 'sw' ? 'end' : 'start'}
              fontSize={pointLabelPx} fill={color} fontStyle="italic" style={{ fontFamily: 'var(--font-serif)' }}>
              {shape.label}
            </text>
          )}
        </g>
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
      // The x label never sits on the tick numbers (e.g. "t (s)" over the 3): it goes on its own row
      // under them when that fits on the board, otherwise tick numbers under the label are left out.
      const belowY = xb[1] + 10 + tickPx + axisLabelPx
      const labelBelow = !!shape.xLabel && belowY <= BOARD_H - 4
      const xLabelY = labelBelow ? belowY : xb[1] + 4 + axisLabelPx
      const ink = animate && !reduced
      const labelLeft = shape.xLabel && !labelBelow ? xb[0] - 2 - shape.xLabel.length * axisLabelPx * 0.5 - tickPx * 0.6 : Infinity
      return (
        <g>
          {/* Drawn in pen order: x axis, its arrow, ticks and name; then the same for y. */}
          <Stroke {...base} color={axisColor} d={pathFromPoints([xa, xb])} />
          <path d={arrowHead(xa, xb, 10)} fill="none" stroke={axisColor} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" data-ink={ink ? 'path' : undefined} />
          <g data-ink={ink && xticks.length ? 'sweep' : undefined} data-sweep={`${xa[0]},${xa[1]},${xb[0]},${xb[1]}`}>
            {xticks.map(v => {
              const [tx, ty] = toBoard(ax, [v, originY])
              return (
                <g key={`x${v}`}>
                  <line x1={tx} y1={ty - 4} x2={tx} y2={ty + 4} stroke={axisColor} strokeWidth={1.2} />
                  {tx < labelLeft && <text x={tx} y={ty + 6 + tickPx} fontSize={tickPx} textAnchor="middle" fill={INK_HEX.muted} style={{ fontFamily: 'var(--font-sans)' }}>{v}</text>}
                </g>
              )
            })}
          </g>
          {shape.xLabel && (
            <text data-ink={ink ? 'text' : undefined} x={xb[0] - 2} y={xLabelY} fontSize={axisLabelPx} textAnchor="end" fontStyle="italic" fill={INK_HEX.ink} style={{ fontFamily: 'var(--font-serif)' }}>
              {shape.xLabel}
            </text>
          )}
          <Stroke {...base} color={axisColor} maskId={`${maskId}-y`} d={pathFromPoints([ya, yb])} />
          <path d={arrowHead(ya, yb, 10)} fill="none" stroke={axisColor} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" data-ink={ink ? 'path' : undefined} />
          <g data-ink={ink && yticks.length ? 'sweep' : undefined} data-sweep={`${ya[0]},${ya[1]},${yb[0]},${yb[1]}`}>
            {yticks.map(v => {
              const [tx, ty] = toBoard(ax, [originX, v])
              return (
                <g key={`y${v}`}>
                  <line x1={tx - 4} y1={ty} x2={tx + 4} y2={ty} stroke={axisColor} strokeWidth={1.2} />
                  <text x={tx - 9} y={ty + tickPx * 0.36} fontSize={tickPx} textAnchor="end" fill={INK_HEX.muted} style={{ fontFamily: 'var(--font-sans)' }}>{v}</text>
                </g>
              )
            })}
          </g>
          {shape.yLabel && (
            <text data-ink={ink ? 'text' : undefined} x={yb[0] + 12} y={yb[1] + axisLabelPx * 0.4} fontSize={axisLabelPx} fontStyle="italic" fill={INK_HEX.ink} style={{ fontFamily: 'var(--font-serif)' }}>
              {shape.yLabel}
            </text>
          )}
        </g>
      )
    }
    case 'function': {
      if (!el.axes) return null
      const d = functionPath(shape.expr, el.axes, shape.domain, vars)
      if (!d) return null
      return <Stroke {...base} width={step.width ?? 3} d={d} clipId={clipId} />
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
      return <Stroke {...base} d={d} clipId={clipId} />
    }
  }
}

/* ───────────── Highlight ───────────── */

export function HighlightElement({
  el,
  animate,
  reduced,
  measure,
  duration,
}: {
  el: HighlightEl
  animate: boolean
  reduced: boolean
  measure: (id: string) => Box | null
  /** Cue window (ms). */
  duration?: number
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

  const ink = animate && !reduced
  const ref = useRef<SVGGElement>(null)
  useInkGroup(ref, ink, duration ?? 650, `highlight:${el.target}`, !!box)
  if (!box) return null
  const color = INK_HEX[el.color]
  const pad = 8
  const x = box.x - pad, y = box.y - pad / 1.5, w = box.w + pad * 2, h = box.h + (pad / 1.5) * 2
  if (el.style === 'underline') {
    const d = `M${x + 4} ${y + h + 2} Q${x + w / 2} ${y + h + 6} ${x + w - 4} ${y + h + 1}`
    return (
      <motion.g ref={ref} exit={{ opacity: 0 }}>
        <path d={d} fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" data-ink={ink ? 'path' : undefined} />
      </motion.g>
    )
  }
  const r = 8
  const d = `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`
  return (
    <motion.g ref={ref} exit={{ opacity: 0 }}>
      <path d={d} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" data-ink={ink ? 'path' : undefined} />
      <path d={d} fill={color} fillOpacity={0.09} stroke="none" data-ink={ink ? 'fill' : undefined} />
    </motion.g>
  )
}

export function shapeBoxOf(el: ShapeEl) {
  return shapeBox(el)
}

/** The box or underline around a reflowed note, as an SVG drawn by the pen on the highlight's own cue. */
function NoteMark({ mark, reduced }: { mark: NoteMarkSpec; reduced: boolean }) {
  const ref = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const host = ref.current?.parentElement
    if (!host) return
    const read = () => setSize({ w: host.offsetWidth, h: host.offsetHeight })
    read()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null
    ro?.observe(host)
    return () => ro?.disconnect()
  }, [])
  const color = INK_HEX[mark.color]
  const ink = mark.fresh && !reduced && !!mark.cue
  let body: React.ReactNode = null
  if (size) {
    const { w, h } = size
    if (mark.style === 'underline') {
      body = <path d={`M2 ${h + 3} Q${w / 2} ${h + 7} ${w - 2} ${h + 2}`} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" data-ink={ink ? 'path' : undefined} />
    } else {
      const r = 8
      const d = `M${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${h - r} Q${w} ${h} ${w - r} ${h} H${r} Q0 ${h} 0 ${h - r} V${r} Q0 0 ${r} 0 Z`
      body = (
        <>
          <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" data-ink={ink ? 'path' : undefined} />
          <path d={d} fill={color} fillOpacity={0.09} stroke="none" data-ink={ink ? 'fill' : undefined} />
        </>
      )
    }
  }
  return (
    <svg ref={ref} aria-hidden className="pointer-events-none absolute left-0 top-0" width={size?.w ?? 0} height={size?.h ?? 0} style={{ overflow: 'visible' }}>
      <PenCueContext.Provider value={ink ? mark.cue ?? null : null}>
        <NoteMarkInk active={ink} ready={!!size}>{body}</NoteMarkInk>
      </PenCueContext.Provider>
    </svg>
  )
}

function NoteMarkInk({ active, ready, children }: { active: boolean; ready: boolean; children: React.ReactNode }) {
  const ref = useRef<SVGGElement>(null)
  useInkGroup(ref, active, 650, 'highlight:note', ready)
  return <g ref={ref}>{children}</g>
}


/* ───────────── Hand-drawn marks (annotate) ───────────── */

/**
 * A teacher's mark on an element: perfect-freehand ink revealed by the pen along its centre line (the hand follows
 * it), plus an optional handwritten note. The target's box is measured on the board, like highlights.
 */
export function MarkElement({ el, animate, reduced, measure, duration }: {
  el: MarkEl
  animate: boolean
  reduced: boolean
  measure: (id: string) => Box | null
  duration?: number
}) {
  const [box, setBox] = useState<Box | null>(null)
  useLayoutEffect(() => {
    const update = () => setBox(measure(el.target))
    update()
    const t = setTimeout(update, 120)
    return () => clearTimeout(t)
  }, [el.target, measure])
  const ink = animate && !reduced
  const ref = useRef<SVGGElement>(null)
  useInkGroup(ref, ink, duration ?? 900, `mark:${el.target}`, !!box)
  const geo = useMemo(() => (box ? markGeometry(el.mark, box, el.key, el.note) : null), [box, el.mark, el.key, el.note])
  const notePx = useMinUnits(MARK_NOTE_PX, 14)
  if (!geo) return null
  const color = INK_HEX[el.color]
  const base = `wb-mk-${el.key.replace(/[^\w-]/g, '_')}`
  return (
    <motion.g ref={ref} exit={{ opacity: 0 }}>
      {geo.strokes.map((pts, i) => {
        const id = `${base}-${i}`
        return (
          <g key={i}>
            {ink && (
              <defs>
                <mask id={id} maskUnits="userSpaceOnUse" x="-100" y="-100" width="1000" height="700">
                  <path d={centerPath(pts)} fill="none" stroke="#fff" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" />
                </mask>
              </defs>
            )}
            {/* The pen follows this (invisible) centre line; the ink shows through its growing mask. */}
            <path d={centerPath(pts)} fill="none" stroke="none" data-ink={ink ? 'dash' : undefined} data-mask={ink ? id : undefined} />
            <path d={geo.outlines[i]} fill={color} stroke="none" mask={ink ? `url(#${id})` : undefined} />
          </g>
        )
      })}
      {el.note && geo.note && (
        <text data-ink={ink ? 'text' : undefined} x={geo.note.x} y={geo.note.y + geo.note.box.h * 0.8} fontSize={notePx} fill={color} style={{ fontFamily: 'var(--font-hand, var(--font-serif))', fontStyle: 'italic' }}>{el.note}</text>
      )}
    </motion.g>
  )
}

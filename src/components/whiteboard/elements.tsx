'use client'
import React, { createContext, useContext, useLayoutEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import katex from 'katex'
import { compileExpr } from '@/lib/lesson-schema'
import type { Shape } from '@/lib/lesson-schema'
import {
  INK_HEX,
  SIZE_PX,
  animMs,
  shapeBox,
  toBoard,
  xScale,
  type AxesDef,
  type Box,
  type HighlightEl,
  type ShapeEl,
  type TextEl,
} from './board-state'

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

/* ───────────── Text & math ───────────── */

export function TextElement({
  el,
  animate,
  reduced,
  registerRef,
  flow,
  mark,
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
}) {
  const boardPx = SIZE_PX[el.size] * (el.kind === 'math' ? 0.86 : 1)
  const labelPx = useMinUnits(boardPx, 15)
  if (flow) return <FlowText el={el} animate={animate} reduced={reduced} registerRef={registerRef} mark={mark ?? null} />
  const fontPx = labelPx
  const translateX = el.align === 'center' ? '-50%' : el.align === 'right' ? '-100%' : '0%'
  const enterMs = animMs({ type: el.kind === 'math' ? 'math' : 'write', text: el.content, tex: el.content, x: 0, y: 0 } as never)
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
      transition={{ duration: reduced || !morphing ? 0 : 0.9, ease: EASE_SMOOTH }}
      style={{ ...from }}
    >
      <div
        ref={node => { if (el.id) registerRef(el.id, node) }}
        className={`relative leading-[1.18] ${cls}`}
        style={{ ...style, transform: `translateX(${translateX})` }}
      >
        {morphing && el.prevContent !== undefined ? (
          <>
            <motion.div
              aria-hidden
              className="pointer-events-none absolute left-0 top-0"
              initial={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              animate={{ opacity: 0, y: reduced ? 0 : -8, filter: reduced ? 'blur(0px)' : 'blur(2px)' }}
              transition={{ duration: reduced ? 0.15 : 0.55, ease: EASE_SMOOTH }}
              style={{ whiteSpace: style.whiteSpace }}
            >
              <Content kind={el.kind} content={el.prevContent} />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: reduced ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduced ? 0.15 : 0.6, delay: reduced ? 0 : 0.28, ease: EASE_SMOOTH }}
            >
              <Content kind={el.kind} content={el.content} />
            </motion.div>
          </>
        ) : animate === 'enter' && !reduced ? (
          // Handwriting-like reveal: a left-to-right wipe with a soft leading edge.
          <motion.div
            initial={{ clipPath: 'inset(-20% 100% -20% -2%)', opacity: 0.2 }}
            animate={{ clipPath: 'inset(-20% -2% -20% -2%)', opacity: 1 }}
            transition={{ duration: enterMs / 1000, ease: 'linear', opacity: { duration: 0.25 } }}
          >
            <Content kind={el.kind} content={el.content} />
          </motion.div>
        ) : (
          <motion.div
            initial={animate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
          >
            <Content kind={el.kind} content={el.content} />
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
}: {
  el: TextEl
  animate: 'enter' | 'morph' | null
  reduced: boolean
  registerRef: (id: string, node: HTMLElement | null) => void
  mark: { style: 'box' | 'underline'; color: TextEl['color']; fresh: boolean } | null
}) {
  const px = FLOW_PX[el.size] * (el.kind === 'math' ? 1.08 : 1)
  const cls = el.font === 'sans' && el.kind === 'text' ? 'font-sans tracking-[-0.01em]' : 'font-display'
  const color = INK_HEX[el.color]
  const markColor = mark ? INK_HEX[mark.color] : undefined
  const enterMs = animMs({ type: el.kind === 'math' ? 'math' : 'write', text: el.content, tex: el.content, x: 0, y: 0 } as never)
  const morphing = animate === 'morph'
  return (
    <motion.div
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
          key={morphing ? `m-${el.content}` : 'c'}
          initial={morphing ? { opacity: 0, y: reduced ? 0 : 6 } : animate === 'enter' && !reduced ? { clipPath: 'inset(-20% 100% -20% -2%)' } : false}
          animate={{ opacity: 1, y: 0, clipPath: 'inset(-20% -2% -20% -2%)' }}
          transition={{ duration: morphing ? (reduced ? 0.15 : 0.6) : enterMs / 1000, ease: morphing ? EASE_SMOOTH : 'linear' }}
          className={el.kind === 'math' ? 'max-w-full overflow-x-auto overflow-y-hidden py-1' : undefined}
        >
          <Content kind={el.kind} content={el.content} />
        </motion.div>
      </div>
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

function functionPath(expr: string, axes: AxesDef, domain?: [number, number]) {
  const c = compileExpr(expr)
  if (!c.ok) return ''
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

/** A path drawn on with a stroke animation. Dashed paths are revealed through a mask so the dashes survive. */
function Stroke({ d, color, width, dashed, animate, reduced, duration, delay = 0, clipId, fill = 'none', maskId }: StrokeProps) {
  const draw = animate && !reduced
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
        <path d={d} {...common} strokeDasharray={`${width * 3} ${width * 2.6}`} mask={draw ? `url(#${maskId})` : undefined} />
      </g>
    )
  }
  return (
    <motion.path
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

export function ShapeElement({ el, animate, reduced }: { el: ShapeEl; animate: boolean; reduced: boolean }) {
  const { step } = el
  const tickPx = useMinUnits(14, 11.5)
  const axisLabelPx = useMinUnits(20, 15)
  const pointLabelPx = useMinUnits(22, 15)
  const shape: Shape = step.shape
  const color = INK_HEX[step.color ?? 'ink']
  const width = step.width ?? (shape.kind === 'axes' ? 1.6 : 2.6)
  const dur = animMs(step) / 1000
  const clipId = el.axes ? `wb-clip-${el.axes.id}` : undefined
  const maskId = `wb-mask-${el.key.replace(/[^\w-]/g, '_')}`
  const P = (p: [number, number]) => toBoard(el.axes, p)
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
      const d = functionPath(shape.expr, el.axes, shape.domain)
      if (!d) return null
      return <Stroke {...base} width={step.width ?? 3} d={d} duration={dur} clipId={clipId} />
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

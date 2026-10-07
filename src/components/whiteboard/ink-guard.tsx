'use client'
/**
 * Nothing appears on the board unhanded.
 *
 * Every element drawn on a cue is wrapped in an InkGuard. Its writer (handwriting, the maths reveal, the diagram
 * strokes) claims the cue when it hands its strokes to the pen. If nothing claims it by the time the element has
 * settled (a few frames: some writers measure first), the guard draws the element itself with the generic fallback:
 * the pen sweeps left to right across the element's box and the element is revealed behind the tip, on the same
 * narration cue. Until one of the two takes over, the element stays hidden, so ink can never show before the tip.
 */
import React, { useLayoutEffect, useMemo, useRef } from 'react'
import { PenCueContext, usePen, type PenCue, type PenSegment, type Pt } from './pen'

/** Frames to wait for a writer to claim the cue before the fallback draws the element. */
const CLAIM_FRAMES = 4

interface Rect { x: number; y: number; w: number; h: number }

/** Union of the visible boxes inside an HTML node, in client px. */
function contentRect(node: Element): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const all = [node, ...Array.from(node.querySelectorAll('*'))]
  for (const el of all) {
    if (el.children.length && el !== node && !(el instanceof SVGSVGElement)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 0.5 || r.height < 0.5) continue
    x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom)
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

let clipSeq = 0

export function InkGuard({ cue: shared, svg = false, tag = 'element', children }: { cue: PenCue | null; svg?: boolean; tag?: string; children: React.ReactNode }) {
  const pen = usePen()
  // The guard's own copy of the cue: a claim made inside this element is this element's alone (several elements can
  // share one action's cue).
  const cue = useMemo<PenCue | null>(() => (shared ? { at: shared.at, dur: shared.dur, epoch: shared.epoch } : null), [shared])
  const htmlRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGGElement>(null)
  useLayoutEffect(() => {
    const node: Element | null = svg ? svgRef.current : htmlRef.current
    if (!node || !cue || cue.claimed) return
    // Hidden until a writer claims the cue or the fallback reveals it.
    let setReveal: (f: number) => void
    let cleanup: () => void
    let measure: () => { rect: Rect; toClient: (x: number, y: number) => Pt | null } | null
    if (svg) {
      const g = node as SVGGElement
      const root = g.ownerSVGElement
      if (!root) return
      const id = `wb-ink-guard-${++clipSeq}`
      const ns = 'http://www.w3.org/2000/svg'
      const cp = document.createElementNS(ns, 'clipPath')
      cp.setAttribute('id', id)
      cp.setAttribute('clipPathUnits', 'userSpaceOnUse')
      const rect = document.createElementNS(ns, 'rect')
      cp.appendChild(rect)
      root.appendChild(cp)
      g.setAttribute('clip-path', `url(#${id})`)
      let box = { x: 0, y: 0, width: 0, height: 0 }
      setReveal = f => {
        rect.setAttribute('x', String(box.x - 8)); rect.setAttribute('y', String(box.y - 8))
        rect.setAttribute('width', String(Math.max(0, (box.width + 16) * f))); rect.setAttribute('height', String(box.height + 16))
      }
      measure = () => {
        try { box = g.getBBox() } catch { return null }
        if (!box.width && !box.height) return null
        const svgR = root.getBoundingClientRect()
        const k = svgR.width / (root.width.baseVal.value || svgR.width || 1)
        const m = g.getCTM()
        return {
          rect: { x: box.x, y: box.y, w: box.width, h: box.height },
          toClient: (x, y) => { let p = new DOMPoint(x, y); if (m) p = p.matrixTransform(m); return { x: svgR.left + p.x * k, y: svgR.top + p.y * k } },
        }
      }
      cleanup = () => { g.removeAttribute('clip-path'); cp.remove() }
    } else {
      const el = node as HTMLDivElement
      let local: Rect = { x: 0, y: 0, w: 0, h: 0 }
      setReveal = f => {
        const v = `polygon(${local.x - 8}px ${local.y - 8}px, ${local.x - 8 + (local.w + 16) * f}px ${local.y - 8}px, ${local.x - 8 + (local.w + 16) * f}px ${local.y + local.h + 8}px, ${local.x - 8}px ${local.y + local.h + 8}px)`
        el.style.clipPath = v
        el.style.setProperty('-webkit-clip-path', v)
      }
      measure = () => {
        const r = contentRect(el)
        const er = el.getBoundingClientRect()
        if (!r) return null
        const k = el.offsetWidth ? er.width / el.offsetWidth : 1
        local = { x: (r.x - er.left) / k, y: (r.y - er.top) / k, w: r.w / k, h: r.h / k }
        return { rect: r, toClient: (x, y) => ({ x, y }) }
      }
      cleanup = () => { el.style.clipPath = ''; el.style.removeProperty('-webkit-clip-path') }
    }
    setReveal(0)
    let raf = 0
    let frames = 0
    let cancel: (() => void) | null = null
    const check = () => {
      if (cue.claimed) { cleanup(); return }
      if (++frames < CLAIM_FRAMES) { raf = requestAnimationFrame(check); return }
      const m = measure()
      if (!m) { cleanup(); return } // nothing visible to draw
      setReveal(0)
      const { rect, toClient } = m
      const dur = Math.max(300, Math.min(cue.dur - 40, 350 + rect.w * 5))
      const seg: PenSegment = {
        start: 0,
        dur,
        apply: f => { if (f >= 1) cleanup(); else setReveal(f) },
        point: f => toClient(rect.x + rect.w * f, rect.y + rect.h * (0.6 + 0.12 * Math.sin(f * Math.PI * 2 * Math.max(1, rect.w / 18)))),
      }
      cancel = pen.run([seg], cue, `fallback:${tag}`)
    }
    raf = requestAnimationFrame(check)
    return () => { cancelAnimationFrame(raf); cancel?.(); cleanup() }
  }, [cue, svg, pen, tag])
  const body = <PenCueContext.Provider value={cue}>{children}</PenCueContext.Provider>
  if (svg) return <g ref={svgRef}>{body}</g>
  return <div ref={htmlRef}>{body}</div>
}

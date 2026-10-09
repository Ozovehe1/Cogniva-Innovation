'use client'
/**
 * Live interactive figure (JSXGraph, loaded only when one appears). Draws a validated IxSpec: draggable points,
 * gliders, functions that follow points and sliders, segments, polygons, circles, vector/slope fields, ODE solution
 * curves from a draggable start, and 3D surfaces. Every formula is compiled by the app's safe expression parser;
 * nothing from the model runs as code. Sliders are native range inputs (big touch targets); one finger on an empty
 * part of the board scrolls the page (browserPan), on a point it drags.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import './jsxgraph.css'
import { Hand, Pause, Play, RotateCcw, Target } from 'lucide-react'
import { RichText } from '@/components/rich-text'
import { buttonClass, cx } from '@/components/ui'
import { IX_HEX, compileSpec, figureGeom, initialEnv, odeCurve, type IxEnv, type IxSpec } from '@/lib/agent/interactive'
import { chargeDriftSvg, magnetCoilSvg, stepChargeDrift, stepMagnetCoil, stepWireField, wireFieldSvg, type SceneKind, type SceneLive } from '@/lib/agent/scenes'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Board = any

const fmt = (v: number) => (!Number.isFinite(v) ? '—' : Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : String(Number(v.toFixed(3))))

/** Skeleton shaped like the coming figure: the frame at its final aspect ratio with faint axes (no spinner). */
export function FigureSkeleton({ aspect = '3 / 2' }: { aspect?: string }) {
  return (
    <div className="relative mt-3 w-full overflow-hidden rounded-[10px] bg-[#FBFAF7]" style={{ border: '1px solid #E5E1D8', aspectRatio: aspect, maxWidth: Math.round(440 * (Number(aspect) || 1.5)), marginInline: 'auto' }} aria-hidden="true">
      <div className="absolute inset-x-4 top-1/2 h-px bg-line-strong/70" />
      <div className="absolute inset-y-4 left-1/2 w-px bg-line-strong/70" />
      <div className="skeleton absolute inset-0 rounded-none opacity-60" />
    </div>
  )
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const buzz = () => { try { navigator.vibrate?.(8) } catch { /* not supported */ } }

/** A tidy snapping step for a range: about 1/40 of it, rounded to 1, 2 or 5 × 10^k. */
const niceStep = (span: number) => { const raw = span / 40, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p }

export default function InteractiveFigure({ spec, alt, play, demo = false, onHandOver, onReadouts, task, goalReadout = -1 }: {
  spec: IxSpec; alt: string
  /** What the learner is asked to do with the figure (an explore check's goal). Replaces the generic footer hint so the
   * task stays in view next to the controls (spatial contiguity, goal salience). */
  task?: React.ReactNode
  /** Index of the readout the task is about: it gets the emphasis ring (signalling). */
  goalReadout?: number
  /** A slider that can play itself min→max (the stage's demonstration; the learner can replay it). */
  play?: { slider: string; seconds?: number }
  /** Run the demonstration once as soon as the figure is ready. */
  demo?: boolean
  /** Called when the demonstration ends and the learner has control. */
  onHandOver?: () => void
  /** Live readout values (in the spec's order), e.g. for a check that is answered by moving the figure. */
  onReadouts?: (values: number[]) => void
}) {
  const k = useMemo(() => compileSpec(spec), [spec])
  const geom = useMemo(() => figureGeom(spec), [spec])
  const boxRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<Board>(null)
  const sliders = useRef<IxEnv>(Object.fromEntries(spec.sliders.map(s => [s.name.toLowerCase(), s.value])))
  const [vals, setVals] = useState<IxEnv>(() => ({ ...sliders.current }))
  const [reads, setReads] = useState<number[]>(() => { const { env } = initialEnv(spec, k); return k.readouts.map(f => f(0, env)) })
  const [failed, setFailed] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [ready, setReady] = useState(false)
  const [touched, setTouched] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)
  const playRaf = useRef(0)
  const demoDone = useRef(false)
  const ids = useMemo(() => `ix-${Math.random().toString(36).slice(2, 9)}`, [])

  useEffect(() => {
    let cancelled = false
    let board: Board = null
    let jxg: any = null
    if (spec.scene) { setReady(true); return () => { cancelled = true } }
    ;(async () => {
      try {
        const mod: any = await import('jsxgraph')
        const JXG = mod.default ?? mod
        jxg = JXG
        if (cancelled || !boxRef.current) return
        const is3d = !!spec.surface
        board = JXG.JSXGraph.initBoard(boxRef.current.id, {
          boundingbox: geom.bbox,
          axis: !is3d, grid: false, keepAspectRatio: false, showCopyright: false, showNavigation: false, showInfobox: false,
          pan: { enabled: true, needTwoFingers: true }, browserPan: true, zoom: { enabled: false },
          defaultAxes: { x: { ticks: { label: { fontSize: 11, color: '#66666F' } } }, y: { ticks: { label: { fontSize: 11, color: '#66666F' } } } },
        })
        boardRef.current = board
        const pts: Record<string, any> = {}
        const initial = initialEnv(spec, k)
        // The live environment: slider values plus every point's current coordinates.
        const env = (): IxEnv => {
          const e: IxEnv = { ...sliders.current }
          for (const [n, p] of Object.entries(pts)) { e[`${n.toLowerCase()}x`] = p.X(); e[`${n.toLowerCase()}y`] = p.Y() }
          return e
        }
        const pointStyle = (color: string, drag: boolean, label: string) => ({ name: label, size: drag ? 6 : 3.5, fillColor: color, strokeColor: drag ? '#ffffff' : color, strokeWidth: drag ? 2 : 0, fixed: !drag, showInfobox: false, label: { fontSize: 15, color, offset: [10, 10], autoPosition: true, autoPositionMinDistance: 14, autoPositionMaxDistance: 40 }, highlightFillColor: color, precision: { touch: 30, mouse: 6 } })
        if (is3d) {
          const zf = k.surface!
          const zr = spec.surface!.z ?? (() => { const vs: number[] = []; for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) vs.push(zf(spec.x[0] + (spec.x[1] - spec.x[0]) * i / 12, { ...sliders.current, y: spec.y[0] + (spec.y[1] - spec.y[0]) * j / 12 })); const f = vs.filter(Number.isFinite); const lo = Math.min(...f), hi = Math.max(...f); return [lo, hi > lo ? hi : lo + 1] as [number, number] })()
          const view = board.create('view3d', [[-5.5, -5], [10, 10], [spec.x, spec.y, zr]], { xPlaneRear: { visible: false }, yPlaneRear: { visible: false }, projection: 'parallel', trackball: { enabled: true } })
          view.create('functiongraph3d', [(x: number, y: number) => zf(x, { ...sliders.current, y }), spec.x, spec.y], { strokeWidth: 0.7, strokeColor: IX_HEX.accent, strokeOpacity: 0.75, stepsU: 20, stepsV: 20 })
        } else {
          for (const p of spec.points) {
            const k2 = k
            const coords = p.xExpr || p.yExpr ? [() => (p.xExpr ? k2.px[p.name](0, env()) : p.x), () => (p.yExpr ? k2.py[p.name](0, env()) : p.y)] : [p.x, p.y]
            pts[p.name] = board.create('point', coords, { ...pointStyle(IX_HEX[p.color], p.drag, p.label), visible: !p.hidden, withLabel: !p.hidden })
          }
          const curves: Record<string, any> = {}
          for (const f of spec.functions) curves[f.name] = board.create('functiongraph', [(x: number) => k.fn[f.name](x, env())], { strokeColor: IX_HEX[f.color], strokeWidth: 2.6, dash: f.dashed ? 2 : 0, withLabel: false, highlight: false })
          for (const g of spec.gliders.filter(q => q.circle === undefined)) pts[g.name] = board.create('glider', [g.x, k.fn[g.on](g.x, env()), curves[g.on]], pointStyle(IX_HEX[g.color], true, g.label))
          // Circles before circle gliders (a point on the unit circle) and before polygons that may use those points.
          const circs = spec.circles.map((c, i) => board.create('circle', c.through ? [pts[c.center], pts[c.through]] : [pts[c.center], () => Math.abs(k.radius[i]!(0, env()))], { strokeColor: IX_HEX[c.color], strokeWidth: 2.2, highlight: false }))
          for (const g of spec.gliders.filter(q => q.circle !== undefined)) {
            const p0 = initial.pos[g.name] ?? [0, 0]
            pts[g.name] = board.create('glider', [p0[0], p0[1], circs[g.circle!]], pointStyle(IX_HEX[g.color], true, g.label))
          }
          for (const pg of spec.polygons) board.create('polygon', pg.points.map(n => pts[n]), { fillColor: IX_HEX[pg.color], fillOpacity: 0.12, highlight: false, borders: { strokeColor: IX_HEX[pg.color], strokeWidth: 2, highlight: false }, vertices: { visible: false } })
          for (const s of spec.segments) board.create(s.arrow ? 'arrow' : s.line ? 'line' : 'segment', [pts[s.from], pts[s.to]], { strokeColor: IX_HEX[s.color], strokeWidth: 2.2, dash: s.dashed ? 2 : 0, highlight: false })
          if (spec.field) {
            const n = 14, xr = [spec.x[0], n, spec.x[1]], yr = [spec.y[0], Math.round(n * 0.7), spec.y[1]]
            if (spec.field.kind === 'slope') board.create('slopefield', [(x: number, y: number) => k.fieldDy!(x, { ...env(), y }), xr, yr], { strokeColor: '#8C8C99', strokeWidth: 1.2, highlight: false })
            else board.create('vectorfield', [[(x: number, y: number) => k.fieldDx!(x, { ...env(), y }), (x: number, y: number) => k.fieldDy!(x, { ...env(), y })], xr, yr], { strokeColor: '#8C8C99', strokeWidth: 1.2, highlight: false, scale: 0.35 * (spec.x[1] - spec.x[0]) / n })
          }
          if (spec.ode) {
            const from = pts[spec.ode.from]
            const curve = board.create('curve', [[0], [0]], { strokeColor: IX_HEX[spec.ode.color], strokeWidth: 2.6, highlight: false })
            curve.updateDataArray = function (this: any) {
              const d = odeCurve(k.ode!, env(), from.X(), from.Y(), spec.x, spec.y, 200)
              this.dataX = d.map(p => p[0]); this.dataY = d.map(p => p[1])
            }
          }
          // Keep draggable points on screen; on release they settle onto a tidy grid (readable values) with a tick.
          const sx = niceStep(spec.x[1] - spec.x[0]), sy = niceStep(spec.y[1] - spec.y[0])
          for (const p of spec.points.filter(q => q.drag)) {
            pts[p.name].on('drag', () => { const q = pts[p.name]; const x = Math.min(spec.x[1], Math.max(spec.x[0], q.X())), y = Math.min(spec.y[1], Math.max(spec.y[0], q.Y())); if (x !== q.X() || y !== q.Y()) q.moveTo([x, y]) })
            pts[p.name].on('up', () => { const q = pts[p.name]; const x = Math.round(q.X() / sx) * sx, y = Math.round(q.Y() / sy) * sy; if (Math.abs(x - q.X()) > 1e-9 || Math.abs(y - q.Y()) > 1e-9) { q.moveTo([x, y], reducedMotion() ? 0 : 120); buzz() } })
          }
        }
        let raf = 0
        board.on('update', () => {
          if (raf || !k.readouts.length) return
          raf = requestAnimationFrame(() => { raf = 0; const e = env(); setReads(k.readouts.map(f => f(0, e))) })
        })
        board.update()
        if (!cancelled) setReady(true)
      } catch (err) {
        if (!cancelled) setFailed(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      try { if (board && jxg) jxg.JSXGraph.freeBoard(board) } catch { /* already gone */ }
      boardRef.current = null
    }
  }, [spec, k, geom, nonce])

  const setSlider = (name: string, v: number) => {
    sliders.current = { ...sliders.current, [name.toLowerCase()]: v }
    setVals(s => ({ ...s, [name.toLowerCase()]: v }))
    boardRef.current?.update()
    if (spec.scene && k.readouts.length) setReads(k.readouts.map(f => f(0, { ...sliders.current })))
  }
  /** Glide one slider from its min to its max (ease-in-out), narrated by the lesson; reduced motion jumps to the end. */
  const runPlay = (name: string, seconds = 4, done?: () => void) => {
    const sl = spec.sliders.find(x => x.name === name)
    if (!sl) return
    cancelAnimationFrame(playRaf.current)
    if (reducedMotion()) { setSlider(sl.name, sl.max); setPlaying(null); done?.(); return }
    setPlaying(sl.name)
    const t0 = performance.now(), ms = Math.max(800, seconds * 1000)
    const tick = (now: number) => {
      const u = Math.min(1, (now - t0) / ms)
      const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2
      setSlider(sl.name, sl.min + (sl.max - sl.min) * e)
      if (u < 1) playRaf.current = requestAnimationFrame(tick)
      else { setPlaying(null); done?.() }
    }
    playRaf.current = requestAnimationFrame(tick)
  }
  const stopPlay = () => { cancelAnimationFrame(playRaf.current); setPlaying(null) }
  useEffect(() => () => cancelAnimationFrame(playRaf.current), [])
  const onReadoutsRef = useRef(onReadouts)
  useEffect(() => { onReadoutsRef.current = onReadouts })
  useEffect(() => { onReadoutsRef.current?.(reads) }, [reads])
  // The demonstration runs once, when the figure is ready; then the learner has control (a small buzz on phones).
  useEffect(() => {
    if (!ready || demoDone.current) return
    if (!demo || !play) { if (demo) { demoDone.current = true; onHandOver?.() } return }
    demoDone.current = true
    const t = setTimeout(() => runPlay(play.slider, play.seconds, () => { buzz(); onHandOver?.() }), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, demo, play])
  const dragAll = [...spec.points.filter(p => p.drag).map(p => p.label), ...spec.gliders.map(g => g.label)].filter(Boolean)
  // A scene with many handles (a magnet and coil turns) reads "Drag the points", not a list of internal names.
  const dragNames = dragAll.length > 3 ? ['the points'] : dragAll

  return (
    <div>
      {failed ? (
        <p className="rounded-[10px] bg-sunken px-3 py-2 text-[13px] text-muted">The live figure could not load here. {alt}</p>
      ) : (
        <div className="relative">
          {!ready && <div className="pointer-events-none absolute inset-0 z-[1] -mt-3"><FigureSkeleton aspect={String(geom.aspect)} /></div>}
          {spec.scene ? <SceneView key={nonce} kind={spec.scene} spec={spec} vals={vals} alt={alt} onTouch={() => setTouched(true)} /> : <div id={`${ids}-${nonce}`} ref={boxRef} onPointerDown={() => setTouched(true)} className="jxgbox mt-3 w-full overflow-hidden rounded-[10px] bg-[#FBFAF7]" style={{ border: '1px solid #E5E1D8', aspectRatio: String(geom.aspect), maxWidth: Math.round(440 * geom.aspect), marginInline: "auto" }} role="img" aria-label={alt} />}
          {/* Drag affordance: a hint chip that fades after the first touch. */}
          {ready && !touched && !spec.surface && dragNames.length > 0 && (
            <div className={cx('pointer-events-none absolute bottom-2 left-2 z-[2] inline-flex items-center gap-1.5 rounded-full bg-ink/85 px-2.5 py-1 text-[12px] font-medium text-white shadow-[var(--shadow-raised)]', !reducedMotion() && 'animate-[pulse_2.4s_ease-in-out_3]')}>
              <Hand className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />Drag {dragNames.join(', ')}
            </div>
          )}
        </div>
      )}
      {/* Curve names as a legend under the board: labels drawn on the board pile up at its right edge on a phone. */}
      {!failed && spec.functions.some(f => f.label) && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {spec.functions.filter(f => f.label).map((f, i) => (
            <li key={i} className="flex items-center gap-1.5" style={{ color: IX_HEX[f.color] }}>
              <svg width="20" height="8" aria-hidden="true"><line x1="1" y1="4" x2="19" y2="4" stroke={IX_HEX[f.color]} strokeWidth="2.6" strokeDasharray={f.dashed ? '4 3' : undefined} strokeLinecap="round" /></svg>
              <RichText text={f.label} />
            </li>
          ))}
        </ul>
      )}
      {spec.sliders.length > 0 && (
        <div className="mt-3 space-y-3">
          {spec.sliders.map(s => (
            <div key={s.name} className="flex items-end gap-2">
              <label className="block min-w-0 flex-1">
                <span className="flex items-baseline justify-between text-[13px]"><span className="text-ink-2"><RichText text={s.label} /></span><span className="tnum text-[15px] font-medium text-ink">{fmt(vals[s.name.toLowerCase()])}</span></span>
                <input type="range" min={s.min} max={s.max} step={s.step} value={vals[s.name.toLowerCase()]} onChange={e => { stopPlay(); setSlider(s.name, Number(e.target.value)) }} aria-label={s.label} className="mt-1 h-11 w-full accent-[#1F4D3A]" />
              </label>
              <button type="button" onClick={() => (playing === s.name ? stopPlay() : runPlay(s.name, play?.slider === s.name ? play.seconds : 4))} aria-label={playing === s.name ? `Pause ${s.label}` : `Play ${s.label} from ${fmt(s.min)} to ${fmt(s.max)}`}
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-line bg-surface text-accent shadow-[var(--shadow-card)] transition-colors hover:border-accent-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                {playing === s.name ? <Pause className="h-4 w-4" fill="currentColor" strokeWidth={0} /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" strokeWidth={0} />}
              </button>
            </div>
          ))}
        </div>
      )}
      {spec.readouts.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-2">
          {spec.readouts.map((r, i) => <div key={i} className={cx('rounded-[10px] px-3 py-2', i === goalReadout ? 'bg-clay-soft ring-1 ring-clay-line' : 'bg-sunken')}><dt className={cx('text-[12px]', i === goalReadout ? 'font-medium text-clay' : 'text-muted')}><RichText text={r.label} /></dt><dd className="tnum text-[17px] font-medium text-ink">{fmt(reads[i])}{r.unit ? <span className="text-[13px] font-normal text-muted"> {r.unit}</span> : null}</dd></div>)}
        </dl>
      )}
      <div className="mt-3 flex items-center justify-between gap-3">
        {task
          ? <span className="flex min-w-0 items-start gap-1.5 text-[13.5px] font-medium leading-snug text-ink"><Target className="mt-px h-4 w-4 flex-shrink-0 text-clay" strokeWidth={2} aria-hidden />{task}</span>
          : <span className="text-[13px] leading-snug text-muted">{spec.surface ? 'Drag the surface to turn it.' : dragNames.length ? `Drag ${dragNames.join(', ')}.` : spec.sliders.length ? `Move ${spec.sliders.length === 1 ? 'the slider' : 'the sliders'} and watch what changes.` : 'Watch how it changes.'}</span>}
        <button type="button" aria-label="Reset the figure" onClick={() => { stopPlay(); setTouched(false); setReady(false); sliders.current = Object.fromEntries(spec.sliders.map(s => [s.name.toLowerCase(), s.value])); setVals({ ...sliders.current }); setNonce(n => n + 1) }} className={cx(buttonClass('ghost', 'md'), 'h-11 flex-shrink-0')}><RotateCcw className="h-3.5 w-3.5" />Reset</button>
      </div>
    </div>
  )
}

/** A hand-built animated scene (lib/agent/scenes.ts): redrawn every frame from the slider value and its own live state
 * (time, the magnet's speed), so the field flows, the meter swings and the charges drift as the learner watches. */
function SceneView({ kind, spec, vals, alt, onTouch }: { kind: SceneKind; spec: IxSpec; vals: IxEnv; alt: string; onTouch: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const valsRef = useRef(vals)
  useEffect(() => { valsRef.current = vals }, [vals])
  useEffect(() => {
    const sl = spec.sliders[0]
    if (!sl || !ref.current) return
    const name = sl.name.toLowerCase()
    const range = { min: sl.min, max: sl.max }
    let live: SceneLive = { t: 0 }
    let prev = valsRef.current[name] ?? sl.value
    let last = performance.now(), raf = 0
    const still = reducedMotion()
    const draw = () => {
      const v = valsRef.current[name] ?? sl.value
      const html = kind === 'magnet_coil' || kind === 'bar_magnet' ? magnetCoilSvg(v, live, range, kind === 'magnet_coil') : kind === 'wire_field' ? wireFieldSvg(v, live, range) : chargeDriftSvg(v, live, range)
      if (ref.current) ref.current.innerHTML = html
    }
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      const v = valsRef.current[name] ?? sl.value
      live = kind === 'magnet_coil' || kind === 'bar_magnet' ? stepMagnetCoil(live, v, prev, dt) : kind === 'wire_field' ? stepWireField(live, v, Math.max(Math.abs(sl.min), Math.abs(sl.max)), dt) : stepChargeDrift(live, v, still ? 0 : dt)
      prev = v
      draw()
      raf = requestAnimationFrame(tick)
    }
    if (still) { live = kind === 'wire_field' ? stepWireField(live, prev, Math.max(Math.abs(sl.min), Math.abs(sl.max)), 1) : live; draw() }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [kind, spec])
  return <div ref={ref} onPointerDown={onTouch} className="mt-3 w-full overflow-hidden rounded-[10px] bg-[#FBFAF7]" style={{ border: '1px solid #E5E1D8', maxWidth: 560, marginInline: 'auto', minHeight: 120 }} role="img" aria-label={alt} />
}

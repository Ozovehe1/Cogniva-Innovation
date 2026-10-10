'use client'
/**
 * The live scene on screen: a DPR-scaled canvas at the kind's fixed aspect (no layout jumps), the beat timeline
 * playing once with captions, then the learner owns it (drag the handle, move the sliders). Pauses off screen;
 * prefers-reduced-motion steps through the beats as still key frames. `seek` renders one deterministic frame (tests,
 * screenshots, lesson stills). Loaded with next/dynamic so the engine never weighs on pages without a scene.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react'
import { Scene, type SceneUi } from '@/lib/scene/engine'
import { KINDS } from '@/lib/scene/kinds'
import { stageAspect } from '@/lib/scene/aspect'
import type { SceneSpec } from '@/lib/scene/types'

const fmt = (v: number, step?: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : step && step >= 1 ? v.toFixed(0) : v.toFixed(Math.abs(v) >= 10 ? 1 : 2))

export interface SceneStageProps {
  spec: SceneSpec
  /** Render one frame at this time (seconds) and stop: deterministic still. */
  seek?: number
  /** An outside control drives this param (an older lesson's slider). */
  drive?: { param: string; value: number }
  /** Hide the slider rows (the host shows its own). */
  hideControls?: boolean
  className?: string
  onUi?: (ui: SceneUi) => void
  /** Called once when the timeline ends and the learner has control. */
  onHandOver?: () => void
}

export default function SceneStage(props: SceneStageProps) {
  // A new spec is a new scene (fresh state, fresh timeline).
  const key = useMemo(() => JSON.stringify(props.spec), [props.spec])
  return <StageInner key={key} {...props} />
}

function makeScene(spec: SceneSpec) { const sc = new Scene(spec, KINDS[spec.kind]); sc.layout(358); return sc }

function StageInner({ spec, seek, drive, hideControls, className, onUi, onHandOver }: SceneStageProps) {
  const kind = KINDS[spec.kind]
  const sceneRef = useRef<Scene | null>(null)
  if (sceneRef.current === null) sceneRef.current = makeScene(spec)
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ui, setUi] = useState<SceneUi>(() => makeScene(spec).ui())
  const [reduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const handed = useRef(false)
  const visible = useRef(true)
  const aspect = stageAspect(spec)

  useEffect(() => {
    const scene = sceneRef.current!
    const canvas = canvasRef.current, box = boxRef.current
    if (!canvas || !box) return
    const c = canvas.getContext('2d')
    if (!c) return
    let raf = 0, last = performance.now(), lastUi = 0, W = 0
    const size = () => {
      const w = Math.round(box.clientWidth)
      if (!w || w === W) return
      W = w
      scene.layout(w)
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(scene.v.H * dpr)
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    size()
    if (!W) return
    scene.reduced = reduced
    const push = (force = false) => {
      const now = performance.now()
      if (!force && now - lastUi < 120) return
      lastUi = now
      const u = scene.ui()
      setUi(u); onUi?.(u)
      if (u.done && !handed.current) { handed.current = true; onHandOver?.() }
    }
    if (seek !== undefined) {
      scene.seek(seek)
      scene.playing = false
      scene.draw(c)
      push(true)
      ;(window as unknown as { __sceneReady?: boolean }).__sceneReady = true
      return
    }
    if (reduced) {
      // Key frames: the end of each beat, one tap at a time; no continuous motion.
      scene.seek(Math.max(0.05, scene.tl.starts[1] ?? scene.tl.total) - 0.02)
      scene.playing = false
      scene.draw(c); push(true)
    }
    const ro = new ResizeObserver(() => { size(); scene.draw(c) })
    ro.observe(box)
    const io = new IntersectionObserver(es => { visible.current = es[0]?.isIntersecting ?? true }, { threshold: 0.05 })
    io.observe(box)
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      if (visible.current && !document.hidden) {
        if (!reduced || scene.owned) scene.step(dt)
        scene.draw(c)
        push()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect() }
  }, [seek, reduced, onUi, onHandOver])

  // An outside slider (older lessons) drives a param directly.
  const dParam = drive?.param, dValue = drive?.value
  useEffect(() => { if (dParam && dValue !== undefined && Number.isFinite(dValue)) sceneRef.current!.setParam(dParam, dValue) }, [dParam, dValue])

  const toPx = (e: React.PointerEvent) => { const r = canvasRef.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const }
  const onDown = (e: React.PointerEvent) => {
    const scene = sceneRef.current!
    const [x, y] = toPx(e)
    if (scene.pointerDown(x, y)) { canvasRef.current?.setPointerCapture(e.pointerId); e.preventDefault() }
    else if (scene.waitAsk >= 0) scene.continueAsk()
  }
  const onMove = (e: React.PointerEvent) => { const scene = sceneRef.current!; if (!scene.dragging) return; const [x, y] = toPx(e); scene.pointerMove(x, y) }
  const onUp = () => sceneRef.current!.pointerUp()

  const togglePlay = () => {
    const scene = sceneRef.current!
    if (reduced && !scene.owned) {
      // Next key frame.
      const i = scene.tl.beatAt(scene.t)
      const nextEnd = (scene.tl.starts[i + 1] ?? scene.tl.total) + (spec.beats[i + 1]?.dur ?? 0) - 0.02
      if (i >= spec.beats.length - 1) scene.handOver(); else scene.seek(Math.min(scene.tl.total - 0.02, nextEnd))
      const c = canvasRef.current?.getContext('2d'); if (c) scene.draw(c)
      setUi(scene.ui())
      return
    }
    if (scene.waitAsk >= 0) { scene.continueAsk(); return }
    if (scene.owned) { scene.restart(); handed.current = false; return }
    scene.playing = !scene.playing
    setUi(scene.ui())
  }

  const controls = hideControls ? [] : spec.controls
  const btnLabel = ui.done ? 'Replay' : reduced ? 'Next step' : ui.asking ? 'Continue' : ui.playing ? 'Pause' : 'Play'
  return (
    <div className={className}>
      <div className="overflow-hidden rounded-[14px] bg-[#0E1322] shadow-[0_10px_30px_rgba(20,20,40,0.18)]">
        <div ref={boxRef} className="relative w-full" style={{ aspectRatio: `1 / ${aspect}` }}>
          <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" style={{ touchAction: 'pan-y' }} role="img" aria-label={spec.alt}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        </div>
        <div className="flex h-[52px] items-center gap-3 bg-[#0B0F1B] px-3">
          <button type="button" onClick={togglePlay} aria-label={btnLabel}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#1F4D3A] text-white transition-colors hover:bg-[#2A6450] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFD166]">
            {ui.done ? <RotateCcw className="h-4 w-4" strokeWidth={2.2} /> : reduced ? <SkipForward className="h-4 w-4" fill="currentColor" strokeWidth={0} /> : ui.playing && !ui.asking ? <Pause className="h-4 w-4" fill="currentColor" strokeWidth={0} /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" strokeWidth={0} />}
          </button>
          <div className="flex min-w-0 flex-1 gap-1.5" aria-hidden="true">
            {spec.beats.map((_, i) => <i key={i} className="h-1 flex-1 rounded-full transition-colors duration-300" style={{ background: ui.done || i <= ui.beat ? '#FFD166' : '#2A3350' }} />)}
          </div>
          <span className="flex-shrink-0 text-[12px] text-[#8E9AB5]" aria-live="polite">{ui.done ? (spec.drag ? 'Your turn: drag' : controls.length ? 'Your turn' : 'Replay') : `${Math.max(1, ui.beat + 1)} / ${spec.beats.length}`}</span>
        </div>
      </div>
      {ui.readouts.length > 0 && (
        <dl className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(3, ui.readouts.length)}, minmax(0, 1fr))` }}>
          {ui.readouts.slice(0, 3).map((r, i) => (
            <div key={i} className="h-[50px] min-w-0 rounded-[10px] bg-sunken px-2.5 py-1.5">
              <dt className="truncate text-[11.5px] text-muted">{r.label}</dt>
              <dd className="tnum truncate text-[15px] font-medium text-ink">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {controls.length > 0 && (
        <div className="mt-2 space-y-1">
          {controls.map(ct => {
            const d = kind.info.params[ct.param]
            if (!d || d.type !== 'number') return null
            const val = Number(ui.params[ct.param] ?? d.default)
            return (
              <label key={ct.param} className="block">
                <span className="flex items-baseline justify-between text-[13px]"><span className="text-ink-2">{ct.label ?? d.label}</span><span className="tnum text-[14px] font-medium text-ink">{fmt(val, d.step)}{d.unit ? ` ${d.unit}` : ''}</span></span>
                <input type="range" min={d.min} max={d.max} step={d.step ?? (d.max - d.min) / 100} value={val} aria-label={ct.label ?? d.label}
                  onChange={e => { const sc = sceneRef.current!; sc.setParam(ct.param, Number(e.target.value)); setUi(sc.ui()) }} className="h-9 w-full accent-[#1F4D3A]" />
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

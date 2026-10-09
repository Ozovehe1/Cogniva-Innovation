'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import { ArrowRight, Check, ExternalLink, ImageOff, Pause, Play, RotateCcw, Volume2, X } from 'lucide-react'
import { WhiteboardPlayer } from '@/components/whiteboard'
import { RichText } from '@/components/rich-text'
import { ItemFigure } from '../item-figure'
import { buttonClass, cx, Skeleton } from '@/components/ui'
import { compileExpr } from '@/lib/lesson-schema'
import type { Block } from '@/lib/agent/types'
import type { SimSpec } from '@/lib/agent/visual'
import type { Credit } from '@/lib/illustrations/types'
import { genie } from '@/components/genie/presence'
import { speakerForAudio } from '@/components/genie/lipsync'
import { ConfirmBlock } from './confirm'
import { ZoomableImage } from '@/components/zoomable'
import { PaperSketch, Pending, StageList, WaitNote, WhileYouWait, useElapsed } from '@/components/system/wait'

// JSXGraph (~1 MB) loads only when an interactive figure is on screen.
const InteractiveFigure = dynamic(() => import('./interactive'), { ssr: false, loading: () => <FigureSkeletonLite /> })
/** Same shape as the figure that is coming (no spinner). */
function FigureSkeletonLite() {
  return <div className="relative mt-3 aspect-[3/2] w-full overflow-hidden rounded-[10px] border border-line bg-[#FBFAF7]" aria-hidden="true"><div className="absolute inset-x-4 top-1/2 h-px bg-line-strong/70" /><div className="absolute inset-y-4 left-1/2 w-px bg-line-strong/70" /><div className="skeleton absolute inset-0 rounded-none opacity-60" /></div>
}

const frame = 'overflow-hidden rounded-[14px] border border-line bg-surface shadow-[var(--shadow-card)]'
const label = 'text-[11px] font-medium uppercase tracking-[0.08em] text-muted'

export function AgentBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case 'board': return <BoardBlock block={block} />
    case 'svg': return <SvgBlock svg={block.svg} alt={block.alt} credit={block.credit} url={block.url} />
    case 'sim': return <SimBlock spec={block.spec} />
    case 'interactive': return (
      <div className={cx(frame, 'p-4')}>
        <p className={label}>Interactive</p>
        <h3 className="mt-1 font-display text-[20px] leading-snug text-ink"><RichText text={block.spec.title} /></h3>
        {block.spec.explain && <p className="mt-1 text-[14px] leading-relaxed text-ink-2"><RichText text={block.spec.explain} /></p>}
        <InteractiveFigure spec={block.spec} alt={block.alt} play={block.play} demo={!!block.play} />
      </div>
    )
    case 'clip': return <ClipBlock block={block} />
    case 'image': return <figure className={cx(frame, 'bg-white p-2')}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={`data:image/png;base64,${block.png}`} alt={block.caption ?? 'Figure from Python'} className="mx-auto h-auto max-w-full" />{block.caption && <figcaption className="px-2 pb-1 pt-2 text-[13px] text-muted">{block.caption}</figcaption>}</figure>
    case 'code': return <CodeBlock block={block} />
    case 'practice': return <PracticeBlock block={block} />
    case 'confirm': return <ConfirmBlock block={block} />
    case 'sources': return <SourcesBlock items={block.items} />
    case 'lesson': return (
      <Link href={`/learn/${block.lessonId}`} className={cx(frame, 'flex items-center gap-3 border-accent-line bg-accent-soft p-4 hover:bg-[#dde9e2]')}>
        <span className="min-w-0 flex-1"><span className={cx(label, 'text-accent')}>Lesson</span><span className="mt-0.5 block font-display text-[19px] leading-snug text-ink"><RichText text={block.title} /></span><span className="mt-0.5 block text-[13px] text-ink-2">{block.note}</span></span>
        <ArrowRight className="h-4 w-4 flex-shrink-0 text-accent" strokeWidth={2} />
      </Link>
    )
    case 'audio': return <AudioBlock text={block.text} />
    case 'checked': return (
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
        <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.5} /><span>Checked with exact maths:</span>
        {block.items.slice(0, 4).map((x, i) => <code key={i} className="rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[11.5px] text-ink-2">{x.expression.slice(0, 40)} → {x.result.slice(0, 40)}</code>)}
      </div>
    )
    case 'plan': return (
      <div className={cx(frame, 'p-4')}>
        <p className={label}>Today’s plan, updated</p>
        <ol className="mt-2 space-y-1.5 text-[14px] text-ink">{block.items.map((it, i) => <li key={i} className="flex gap-2"><span className="tnum w-4 text-faint">{i + 1}</span><span className="min-w-0 flex-1"><RichText text={it.title} />{it.why && <span className="block text-[12.5px] text-muted">{it.why}</span>}</span></li>)}</ol>
        <Link href="/dashboard" className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-accent">See it on Home <ArrowRight className="h-3.5 w-3.5" /></Link>
      </div>
    )
  }
}

function BoardBlock({ block }: { block: Extract<Block, { kind: 'board' }> }) {
  // An edited board (board_edit bumps rev) replays from the first changed step with the pen, and the frame gives one
  // soft accent pulse plus an "Updated" tag, so the learner sees *that* it changed and *where* (signalling).
  const edited = (block.rev ?? 0) > 0
  return (
    <motion.div key={`${block.id}:${block.rev ?? 0}`} className={cx(frame, 'p-0')}
      initial={edited ? { boxShadow: '0 0 0 0 rgba(31,77,58,0)' } : false}
      animate={edited ? { boxShadow: ['0 0 0 0 rgba(31,77,58,0)', '0 0 0 4px rgba(31,77,58,0.18)', '0 0 0 0 rgba(31,77,58,0)'] } : undefined}
      transition={{ duration: 1.4, ease: 'easeInOut' }}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="flex items-center gap-2">
          <span className={label}>{block.plot ? 'Graph' : block.diagram ? 'Diagram' : 'Whiteboard'}</span>
          {edited && <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25 }} className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">Updated</motion.span>}
        </span>
        <span className="truncate pl-3 text-[13px] text-ink-2"><RichText text={block.title} /></span>
      </div>
      <div className="p-2 sm:p-3">
        <WhiteboardPlayer key={`${block.id}:${block.rev ?? 0}`} steps={block.steps} title={block.title} autoPlay={!!block.plot || !!block.diagram || !!block.start} initialIndex={block.start ?? 0} allowSkipChecks embedded />
      </div>
    </motion.div>
  )
}

export function SvgBlock({ svg, alt, credit, url, forceState }: { svg: string; alt: string; credit?: Credit; url?: string; /** lab page only: hold one state */ forceState?: 'loading' | 'error' }) {
  // Sanitised on the server, and shown as an image: nothing inside an <img> SVG can run or load anything.
  // Library illustrations come from our public bucket by URL; drawn ones are inline.
  const [attempt, setAttempt] = useState(0)
  const src = useMemo(() => url ? (attempt ? `${url}${url.includes('?') ? '&' : '?'}r=${attempt}` : url) : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, [svg, url, attempt])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(forceState ?? (url ? 'loading' : 'ready'))
  const img = useRef<HTMLImageElement | null>(null)
  // The image may finish (or fail) before hydration attaches onLoad/onError: read its state once mounted.
  useEffect(() => {
    const el = img.current
    if (forceState || !el || !el.complete) return
    setState(el.naturalWidth > 0 ? 'ready' : 'error')
  }, [forceState, src])
  return (
    <figure className={cx(frame, 'group')}>
      <div className="relative bg-white">
        {state === 'loading' && (
          <div className="absolute inset-0 flex flex-col justify-center gap-3 p-6" aria-hidden>
            <Skeleton className="mx-auto h-[46%] w-[58%] rounded-[12px]" />
            <Skeleton className="mx-auto h-3 w-[40%]" />
          </div>
        )}
        {state === 'error' ? (
          <div role="img" aria-label={alt} className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 bg-sunken px-6 text-center">
            <ImageOff className="h-6 w-6 text-faint" strokeWidth={1.75} aria-hidden />
            <p className="text-[14px] font-medium text-ink-2">This picture didn’t load</p>
            <p className="max-w-[34ch] text-[13px] leading-snug text-muted">{alt}</p>
            {url && !forceState && (
              <button type="button" onClick={() => { setState('loading'); setAttempt(a => a + 1) }} className={cx(buttonClass('ghost', 'sm'), 'mt-1 min-h-11')}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />Try again
              </button>
            )}
          </div>
        ) : (
          // Tap to zoom: textbook labels are small on a phone (docs/design/app-ui.md, "Illustrations").
          <ZoomableImage imgRef={img} src={src} alt={alt} loading="lazy" onLoad={() => { if (!forceState) setState('ready') }} onError={() => { if (!forceState) setState('error') }}
            imgClassName={cx('mx-auto block h-auto w-full max-w-[640px] p-3 transition-opacity duration-300 ease-out', state === 'loading' ? 'aspect-[4/3] opacity-0' : 'opacity-100')} />
        )}
      </div>
      {credit ? (
        // Library illustrations: title, author, source and licence, each linked (what CC BY asks for).
        <figcaption className="flex items-center gap-2 border-t border-line bg-surface px-1.5">
          <a href={credit.url} target="_blank" rel="noopener noreferrer"
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2 text-[12.5px] leading-snug text-muted transition-colors hover:bg-sunken hover:text-ink-2 focus-visible:outline-2 focus-visible:outline-accent">
            <span className="min-w-0 truncate"><span className="font-medium text-ink-2">{credit.title.replace(/\s+(en|EN|eng)$/, '')}</span> · {credit.author}{credit.source !== credit.author ? `, ${credit.source}` : ''}{credit.changes ? ` · ${credit.changes}` : ''}</span>
            <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 opacity-60" strokeWidth={2} aria-hidden />
            <span className="sr-only">(opens the source page)</span>
          </a>
          {credit.licenseUrl ? (
            <a href={credit.licenseUrl} target="_blank" rel="noopener noreferrer license" aria-label={`Licence: ${credit.license}`}
              className="inline-flex min-h-11 flex-shrink-0 items-center rounded-[10px] px-1.5 focus-visible:outline-2 focus-visible:outline-accent">
              <span className="rounded-full border border-accent-line bg-accent-soft px-2 py-0.5 text-[11px] font-medium tracking-wide text-accent">{credit.license}</span>
            </a>
          ) : <span className="mr-2 flex-shrink-0 rounded-full border border-line bg-sunken px-2 py-0.5 text-[11px] font-medium text-muted">{credit.license}</span>}
        </figcaption>
      ) : <figcaption className="border-t border-line px-3.5 py-2.5 text-[13px] leading-snug text-muted">{alt}</figcaption>}
    </figure>
  )
}

/* ───────────── Simulation ───────────── */

function SimBlock({ spec }: { spec: SimSpec }) {
  const [vals, setVals] = useState<Record<string, number>>(() => Object.fromEntries(spec.params.map(p => [p.name, p.value])))
  // The spec never changes for a block, so everything compiled from it is memoised on the spec alone.
  const compiled = useMemo(() => {
    const names = spec.params.map(p => p.name)
    return {
      outputs: spec.outputs.map(o => ({ ...o, c: compileExpr(o.expr, names, false) })),
      curves: (spec.plot?.curves ?? []).map(c => ({ ...c, c: compileExpr(c.expr, names, true) })),
      motion: spec.motion ? { x: compileExpr(spec.motion.x, [...names, 't'], false), y: compileExpr(spec.motion.y, [...names, 't'], false), tMax: compileExpr(spec.motion.tMax, names, false), anchor: spec.motion.anchor ? spec.motion.anchor.map(e => compileExpr(e, names, false)) : null } : null,
    }
  }, [spec])
  const { outputs, curves, motion } = compiled
  const [t, setT] = useState(0)
  const [running, setRunning] = useState(false)
  const raf = useRef<number | null>(null)
  const tMax = motion?.tMax.ok ? motion.tMax.fn(0, vals) : 0
  useEffect(() => {
    if (!running || !motion) return
    const t0 = performance.now() - t * 1000
    const tick = (now: number) => {
      const tt = (now - t0) / 1000
      if (!Number.isFinite(tMax) || tMax <= 0 || tt >= tMax) { setT(Math.max(0, Number.isFinite(tMax) ? tMax : 0)); setRunning(false); return }
      setT(tt)
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [running]) // eslint-disable-line react-hooks/exhaustive-deps
  const W = 600, H = 340, P = 44
  const plot = spec.plot
  const sx = (x: number) => plot ? P + (x - plot.xRange[0]) / (plot.xRange[1] - plot.xRange[0]) * (W - 2 * P) : 0
  const sy = (y: number) => plot ? H - P - (y - plot.yRange[0]) / (plot.yRange[1] - plot.yRange[0]) * (H - 2 * P) : 0
  const colors = ['#1F4D3A', '#A4502A', '#23406A']
  const fmt = (v: number, d = 3) => !Number.isFinite(v) ? '—' : Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : String(Number(v.toFixed(d)))
  const path = (fn: (x: number, v: Record<string, number>) => number) => {
    if (!plot) return ''
    let d = '', pen = false
    for (let i = 0; i <= 200; i++) {
      const x = plot.xRange[0] + (plot.xRange[1] - plot.xRange[0]) * i / 200
      const y = fn(x, vals)
      if (!Number.isFinite(y) || y < plot.yRange[0] - (plot.yRange[1] - plot.yRange[0]) * 2 || y > plot.yRange[1] + (plot.yRange[1] - plot.yRange[0]) * 2) { pen = false; continue }
      d += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`
      pen = true
    }
    return d
  }
  const ticks = (a: number, b: number) => { const step = niceStep((b - a) / 5); const out: number[] = []; for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(Number(v.toPrecision(6))); return out }
  const dot = motion && motion.x.ok && motion.y.ok ? { x: motion.x.fn(0, { ...vals, t }), y: motion.y.fn(0, { ...vals, t }) } : null
  const pv = motion?.anchor
  const pivot = pv && pv[0].ok && pv[1].ok ? { x: pv[0].fn(0, vals), y: pv[1].fn(0, vals) } : null
  return (
    <div className={cx(frame, 'p-4')}>
      <p className={label}>Simulation</p>
      <h3 className="mt-1 font-display text-[20px] leading-snug text-ink"><RichText text={spec.title} /></h3>
      {spec.explain && <p className="mt-1 text-[14px] leading-relaxed text-ink-2"><RichText text={spec.explain} /></p>}
      {plot && (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-auto w-full rounded-[10px] bg-[#FBFAF7]" role="img" aria-label={`Graph for ${spec.title}`}>
          {ticks(plot.xRange[0], plot.xRange[1]).map(v => <g key={`x${v}`}><line x1={sx(v)} x2={sx(v)} y1={P} y2={H - P} stroke="#E5E1D8" /><text x={sx(v)} y={H - P + 16} fontSize="11" textAnchor="middle" fill="#66666F">{v}</text></g>)}
          {ticks(plot.yRange[0], plot.yRange[1]).map(v => <g key={`y${v}`}><line x1={P} x2={W - P} y1={sy(v)} y2={sy(v)} stroke="#E5E1D8" /><text x={P - 6} y={sy(v) + 4} fontSize="11" textAnchor="end" fill="#66666F">{v}</text></g>)}
          {plot.yRange[0] <= 0 && plot.yRange[1] >= 0 && <line x1={P} x2={W - P} y1={sy(0)} y2={sy(0)} stroke="#14141A" strokeWidth="1.2" />}
          {plot.xRange[0] <= 0 && plot.xRange[1] >= 0 && <line x1={sx(0)} x2={sx(0)} y1={P} y2={H - P} stroke="#14141A" strokeWidth="1.2" />}
          {curves.map((c, i) => c.c.ok ? <path key={i} d={path(c.c.fn)} fill="none" stroke={colors[i % 3]} strokeWidth="2.5" /> : null)}
          {dot && pivot && Number.isFinite(dot.x) && Number.isFinite(dot.y) && Number.isFinite(pivot.x) && Number.isFinite(pivot.y) && <g><line x1={sx(pivot.x)} y1={sy(pivot.y)} x2={sx(dot.x)} y2={sy(dot.y)} stroke="#14141A" strokeWidth="2" /><circle cx={sx(pivot.x)} cy={sy(pivot.y)} r="3.5" fill="#14141A" /></g>}
          {dot && Number.isFinite(dot.x) && Number.isFinite(dot.y) && <circle cx={sx(dot.x)} cy={sy(dot.y)} r="9" fill="#A4502A" />}
          {plot.xLabel && <text x={W - P} y={H - 8} fontSize="12" textAnchor="end" fill="#3D3D47">{plot.xLabel}</text>}
          {plot.yLabel && <text x={8} y={P - 14} fontSize="12" fill="#3D3D47">{plot.yLabel}</text>}
          {curves.map((c, i) => c.label ? <text key={`l${i}`} x={W - P - 4} y={P + 14 + i * 16} fontSize="12" textAnchor="end" fill={colors[i % 3]}>{c.label}</text> : null)}
        </svg>
      )}
      <div className="mt-4 space-y-3">
        {spec.params.map(p => (
          <label key={p.name} className="block">
            <span className="flex items-baseline justify-between text-[13px]"><span className="text-ink-2">{p.label}</span><span className="tnum font-medium text-ink">{fmt(vals[p.name])}{p.unit ? ` ${p.unit}` : ''}</span></span>
            <input type="range" min={p.min} max={p.max} step={p.step} value={vals[p.name]} onChange={e => { setVals(v => ({ ...v, [p.name]: Number(e.target.value) })); setT(0) }} className="mt-1 w-full accent-[#1F4D3A]" />
          </label>
        ))}
      </div>
      {outputs.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-2">
          {outputs.map((o, i) => <div key={i} className="rounded-[10px] bg-sunken px-3 py-2"><dt className="text-[12px] text-muted">{o.label}</dt><dd className="tnum text-[17px] font-medium text-ink">{o.c.ok ? fmt(o.c.fn(0, vals), o.digits ?? 3) : '—'}{o.unit ? <span className="text-[13px] font-normal text-muted"> {o.unit}</span> : null}</dd></div>)}
        </dl>
      )}
      {motion && (
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={() => { if (t >= tMax) setT(0); setRunning(r => !r) }} className={buttonClass('secondary', 'sm')}>{running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{running ? 'Pause' : t > 0 && t < tMax ? 'Resume' : 'Play'}</button>
          <button type="button" onClick={() => { setRunning(false); setT(0) }} className={buttonClass('ghost', 'sm')}><RotateCcw className="h-3.5 w-3.5" />Reset</button>
          <span className="tnum text-[13px] text-muted">t = {fmt(t, 2)} s</span>
        </div>
      )}
    </div>
  )
}
function niceStep(raw: number) {
  if (!(raw > 0)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const m = raw / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
}

/* ───────────── Rendered animation (async) ───────────── */

function ClipBlock({ block }: { block: Extract<Block, { kind: 'clip' }> }) {
  const [state, setState] = useState<{ status: string; url: string | null; verified?: boolean; phase?: string; attempts?: number }>({ status: block.status, url: block.url ?? null })
  useEffect(() => {
    // A finished clip from history is asked once whether the scene verifier checked it.
    if (state.status === 'done' && state.verified === undefined) {
      fetch(`/api/agent/clip/${block.jobId}`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(j => { if (j) setState(s => ({ ...s, verified: !!j.verified })) }).catch(() => {})
    }
    if (state.status !== 'rendering') return
    let stop = false
    let id: ReturnType<typeof setTimeout> | undefined
    const started = Date.now()
    const poll = async () => {
      if (stop) return
      try {
        const r = await fetch(`/api/agent/clip/${block.jobId}`, { cache: 'no-store' })
        if (r.ok) {
          const j = await r.json()
          if (j.status !== 'rendering') { setState({ status: j.status, url: j.url, verified: !!j.verified }); return }
          setState(s => (s.phase === j.phase && s.attempts === j.attempts ? s : { ...s, phase: j.phase, attempts: j.attempts }))
        }
      } catch { /* retry */ }
      if (Date.now() - started < 12 * 60_000) id = setTimeout(poll, 6000)
      else setState(s => ({ ...s, status: 'failed' }))
    }
    id = setTimeout(poll, 2500)
    return () => { stop = true; if (id) clearTimeout(id) }
  }, [block.jobId, state.status, state.verified])
  return (
    <figure className={frame} role="region" aria-label={block.caption ? `Animation: ${block.caption}` : 'Animation'}>
      {state.status === 'done' && state.url
        ? <ClipPlayer url={state.url} label={block.caption ?? 'Animation'} />
        : state.status === 'failed'
          ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-sunken px-6 text-center">
              <X className="h-5 w-5 text-clay" aria-hidden />
              <p className="text-[14px] text-ink-2">This animation couldn’t be drawn. The explanation above still holds.</p>
            </div>
          )
          : <ClipWait phase={state.phase} attempts={state.attempts ?? 0} />}
      {block.caption && <ClipCaption text={block.caption} />}
      {/* Honest status (correctness guard): only a scene the deterministic verifier passed counts as checked. */}
      {state.status === 'done' && state.verified === false && <p className="border-t border-line px-4 py-2 text-[12.5px] text-muted">Not machine-checked. If something looks off, tap Report a mistake.</p>}
    </figure>
  )
}

/**
 * While a clip renders: the 16:9 frame it will play in, a pen sketching the kind of scene that is coming, and the
 * real stages from the render service (queued = planning and checking; rendering = drawing frames; a second attempt
 * is said plainly). No clock: a ticking timer adds pressure and nothing to do with it (low threat). After a real
 * threshold the line says it is slower than usual, so the learner knows it has not stalled. A prediction prompt (there from the start, so nothing shifts) makes
 * the wait useful (generation effect; pretesting primes what to notice when it plays).
 */
export function ClipWait({ phase, attempts }: { phase?: string; attempts: number }) {
  const elapsed = useElapsed(true, 5000)
  const rendering = phase === 'rendering'
  return (
    <div data-wait="clip">
      <PaperSketch bare kind="clip" aspect="16 / 9" progress="none" live={false} />
      <div className="border-t border-line px-4 pb-3.5 pt-3" role="status" aria-live="polite">
        {/* Stages are shown only when the status route reports the render phase; otherwise one honest line. */}
        {phase
          ? <StageList stages={[
              { label: attempts > 1 ? 'Re-planning the scene after a check failed' : 'Planning the scene and checking every number', state: rendering ? 'done' : 'now' },
              { label: 'Drawing the frames', state: rendering ? 'now' : 'next' },
              { label: 'Ready to play here', state: 'next' },
            ]} />
          : <WaitNote live={false}>Planning the scene, checking every number, then drawing it</WaitNote>}
        <p className="mt-2.5 text-[12.5px] leading-snug text-muted">{elapsed > 200 ? 'Taking longer than usual, still working. You can keep going; it appears here by itself.' : 'Usually 1 to 3 minutes. Keep reading; it appears here by itself.'}</p>
        <WhileYouWait className="mt-3">Before it plays: what do you expect to change first, and why?</WhileYouWait>
      </div>
    </div>
  )
}

/** The rendered clip with large (44px) bottom controls: play/pause and replay; the frame keeps its 16:9 size while it loads. */
function ClipPlayer({ url, label }: { url: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0)
  const toggle = () => { const v = ref.current; if (!v) return; if (v.paused) void v.play(); else v.pause() }
  const replay = () => { const v = ref.current; if (!v) return; v.currentTime = 0; void v.play() }
  // The controls sit in their own strip under the picture, never on it: Manim scenes put readouts and axis numbers at
  // the bottom edge, and a 390 px phone has no spare pixels to cover (nothing the learner must read is ever hidden).
  return (
    <div>
      <div className="relative aspect-video w-full bg-surface">
        {!ready && <div className="skeleton absolute inset-0 rounded-none" aria-hidden />}
        <video ref={ref} src={url} autoPlay muted playsInline preload="auto" aria-label={label}
          onLoadedData={() => setReady(true)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
          onTimeUpdate={e => { const v = e.currentTarget; setProgress(v.duration ? v.currentTime / v.duration : 0) }}
          onClick={toggle} className="absolute inset-0 h-full w-full cursor-pointer object-contain" />
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-[#FBFAF7] px-1.5 py-0.5">
        <button type="button" onClick={toggle} aria-label={playing ? 'Pause animation' : 'Play animation'}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-accent transition-colors hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          {playing ? <Pause className="h-4 w-4" fill="currentColor" strokeWidth={0} /> : <Play className="h-4 w-4 translate-x-[1px]" fill="currentColor" strokeWidth={0} />}
        </button>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Animation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(progress * 1000) / 10}%` }} />
        </div>
        <button type="button" onClick={replay} aria-label="Replay animation"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/**
 * A clip caption that ends cleanly: a caption cut off mid-sentence upstream ("…highlighting") is trimmed back to its
 * last full sentence, or to a word boundary with an ellipsis. Pure; exported for tests.
 */
export function cleanCaption(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim()
  if (!t || /[.!?…)\]"”]$/.test(t)) return t
  const lastStop = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '))
  if (lastStop >= 40) return t.slice(0, lastStop + 1)
  return t.replace(/[\s,;:–—-]+\S*$/, '').replace(/[\s,;:–—-]+$/, '') + '…'
}

function ClipCaption({ text }: { text: string }) {
  const clean = cleanCaption(text)
  const [open, setOpen] = useState(false)
  const long = clean.length > 140
  return (
    <figcaption className="border-t border-line px-4 py-2.5 text-[13.5px] leading-relaxed text-muted">
      <span className={cx(long && !open && 'line-clamp-2')}>{clean}</span>
      {long && <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="-my-2 -ml-1 inline-flex min-h-11 items-center px-1 text-[13px] font-medium text-accent">{open ? 'Show less' : 'Show more'}</button>}
    </figcaption>
  )
}

function CodeBlock({ block }: { block: Extract<Block, { kind: 'code' }> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={cx(frame, 'text-[13px]')}>
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between px-4 py-2.5 text-left">
        <span className={label}>Python {block.engine === 'groq' ? '(interpreter)' : '(sandbox)'}</span>
        <span className="text-[12px] text-accent">{open ? 'Hide code' : 'Show code'}</span>
      </button>
      {open && <pre className="max-h-64 overflow-auto border-t border-line bg-sunken px-4 py-3 font-mono text-[12px] leading-relaxed text-ink-2">{block.code}</pre>}
      {(block.stdout || block.error) && <pre className={cx('max-h-56 overflow-auto border-t border-line px-4 py-3 font-mono text-[12px] leading-relaxed', block.error ? 'text-danger' : 'text-ink')}>{block.stdout}{block.error ? `\n${block.error}` : ''}</pre>}
    </div>
  )
}

/* ───────────── Practice (hints before answers) ───────────── */

function PracticeBlock({ block }: { block: Extract<Block, { kind: 'practice' }> }) {
  const [state, setState] = useState<Record<number, { picked: number[]; done: boolean; correct?: boolean; hint?: string; answer?: number; explain?: string | null }>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const [review, setReview] = useState<{ score?: number; rating?: string; next_review?: string } | null>(null)
  const answer = async (i: number, c: number) => {
    setBusy(i)
    try {
      const r = await fetch('/api/agent/practice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionId: block.actionId, index: i, choice: c }) })
      const j = await r.json()
      setState(s => ({ ...s, [i]: { picked: [...(s[i]?.picked ?? []), c], done: !!j.done, correct: j.correct, hint: j.hint, answer: j.answer, explain: j.explain } }))
      if (typeof j.correct === 'boolean') genie.react(j.correct ? 'happy' : 'encouraging')
      if (j.review && typeof j.review === 'object') setReview(j.review)
    } finally { setBusy(null) }
  }
  const done = Object.values(state).filter(x => x.done).length
  return (
    <div className={cx(frame, 'p-4')}>
      <div className="flex items-baseline justify-between gap-3"><p className={label}>Practice</p><span className="tnum text-[12px] text-muted">{done} of {block.items.length}</span></div>
      <h3 className="mt-1 font-display text-[19px] leading-snug text-ink"><RichText text={block.title} /></h3>
      <ol className="mt-3 space-y-5">
        {block.items.map((it, i) => {
          const st = state[i]
          return (
            <li key={i}>
              <p className="text-[15px] leading-relaxed text-ink"><span className="tnum mr-1.5 text-faint">{i + 1}.</span><RichText text={it.q} /></p>
              <ItemFigure figure={it.figure} className="mt-2" />
              <div className="mt-2 grid gap-1.5">
                {it.options.map((o, k) => {
                  const picked = st?.picked.includes(k)
                  const right = st?.done && (st.answer === k || (st.correct && picked))
                  const wrong = picked && !right
                  return (
                    <button key={k} type="button" disabled={!!st?.done || picked || busy === i} onClick={() => answer(i, k)}
                      className={cx('flex min-h-11 items-center gap-2.5 rounded-[10px] border px-3 py-2 text-left text-[14px] transition-colors',
                        right ? 'border-accent bg-accent-soft text-ink' : wrong ? 'border-clay-line bg-clay-soft text-ink-2' : 'border-line bg-surface text-ink hover:border-line-strong disabled:opacity-100')}>
                      <span className={cx('flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border text-[12px] font-medium', right ? 'border-accent bg-accent text-white' : wrong ? 'border-clay text-clay' : 'border-line text-muted')}>{right ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : String.fromCharCode(65 + k)}</span>
                      <RichText text={o} className="min-w-0 flex-1" />
                    </button>
                  )
                })}
              </div>
              {st && !st.done && st.hint && <p className="mt-2 rounded-[10px] border border-amber-line bg-amber-soft px-3 py-2 text-[13.5px] leading-relaxed text-ink"><span className="font-medium">Hint: </span><RichText text={st.hint} /> Try again.</p>}
              {st?.done && st.explain && <p className={cx('mt-2 text-[13.5px] leading-relaxed', st.correct ? 'text-accent' : 'text-ink-2')}>{st.correct ? 'Right. ' : 'Here’s the key step: '}<RichText text={st.explain} /></p>}
            </li>
          )
        })}
      </ol>
      {review && typeof review.score === 'number' && (
        <p className="mt-4 border-t border-line pt-3 text-[13.5px] text-ink-2">Score {Math.round(review.score * 100)}% on the first try.{review.next_review ? ` Next review: ${new Date(review.next_review).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}.` : ''}</p>
      )}
    </div>
  )
}

function SourcesBlock({ items }: { items: { title: string; url: string; source: string }[] }) {
  return (
    <div className="rounded-[12px] border border-line bg-[#FBFAF7] px-4 py-3">
      <p className={label}>Sources</p>
      <ol className="mt-1.5 space-y-1">
        {items.map((s, i) => (
          <li key={i} className="text-[13px] leading-snug"><a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-start gap-1 text-accent hover:underline"><span className="tnum text-faint">[{i + 1}]</span><span>{s.title}</span><ExternalLink className="mt-0.5 h-3 w-3 flex-shrink-0" /></a><span className="ml-1 text-faint">{s.source}</span></li>
        ))}
      </ol>
    </div>
  )
}

function AudioBlock({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const audio = useRef<HTMLAudioElement | null>(null)
  const play = async () => {
    if (state === 'playing') { audio.current?.pause(); setState('idle'); return }
    setState('loading')
    if (!audio.current) {
      audio.current = new Audio(`/api/tts?text=${encodeURIComponent(text.slice(0, 600))}`)
      speakerForAudio(audio.current)
      audio.current.onended = () => setState('idle')
      audio.current.onerror = () => setState('idle')
    }
    try { await audio.current.play(); setState('playing') } catch { setState('idle') }
  }
  return (
    <button type="button" onClick={play} disabled={state === 'loading'} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink shadow-[var(--shadow-card)] hover:border-line-strong">
      <Pending busy={state === 'loading'} label="Preparing voice">
        {state === 'playing' ? <Pause className="h-3.5 w-3.5 text-accent" /> : <Volume2 className="h-3.5 w-3.5 text-accent" />}
        {state === 'playing' ? 'Pause' : 'Listen'}
      </Pending>
    </button>
  )
}

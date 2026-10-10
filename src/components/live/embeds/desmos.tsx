'use client'
/**
 * Desmos graphing calculator (API v1.11, key from NEXT_PUBLIC_DESMOS_API_KEY; trial tier, non-commercial). The tutor
 * sets expressions and bounds; HelperExpressions read watched values back; observeEvent('change') sends the
 * learner's graph edits as signals; asyncScreenshot gives the visual check a picture of what is drawn.
 */
import React, { useEffect, useRef, useState } from 'react'
import { emitSignal } from '@/lib/live/signals'
import { EmbedFrame } from './shell'
import { loadScript } from './load-script'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function DesmosEmbed({ id, title, spec }: { id: string; title: string; spec: { expressions: { id: string; latex: string; min?: number; max?: number }[]; bounds?: { left?: number; right?: number; bottom?: number; top?: number }; watch?: string[] } }) {
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const key = process.env.NEXT_PUBLIC_DESMOS_API_KEY
  useEffect(() => {
    if (!key) { setStatus({ ok: false, text: 'Desmos is not configured' }); return }
    let calc: any = null, dead = false
    let timer: ReturnType<typeof setTimeout> | undefined
    loadScript(`https://www.desmos.com/api/v1.11/calculator.js?apiKey=${encodeURIComponent(key)}`).then(() => {
      if (dead || !host.current) return
      const D = (window as any).Desmos
      calc = D.GraphingCalculator(host.current, { expressionsCollapsed: true, settingsMenu: false, zoomButtons: true, keypad: false, border: false })
      for (const e of spec.expressions) calc.setExpression({ id: e.id, latex: e.latex, ...(e.min !== undefined && e.max !== undefined ? { sliderBounds: { min: e.min, max: e.max } } : {}) })
      if (spec.bounds && [spec.bounds.left, spec.bounds.right, spec.bounds.bottom, spec.bounds.top].every(v => typeof v === 'number')) calc.setMathBounds(spec.bounds)
      const helpers = (spec.watch ?? []).slice(0, 4).map(w => ({ name: w, h: calc.HelperExpression({ latex: w }) }))
      const read = () => helpers.map(x => `${x.name}=${Number.isFinite(x.h.numericValue) ? Number(x.h.numericValue.toFixed(3)) : '?'}`).join(', ')
      setTimeout(() => {
        const errs = (calc.getExpressions() as { id: string }[]).map(e => calc.expressionAnalysis?.[e.id]).filter((a: any) => a?.isError).map((a: any) => a.errorMessage)
        const ok = errs.length === 0
        setStatus(ok ? { ok: true, text: 'Edit or drag to explore' } : { ok: false, text: 'An expression did not plot' })
        calc.asyncScreenshot({ width: 320, height: 220, targetPixelRatio: 1 }, (png: string) => emitSignal({ kind: 'stage', where: `desmos ${id}`, correct: ok, detail: ok ? `graph drawn${helpers.length ? `: ${read()}` : ''} (screenshot ${Math.round(png.length / 1024)} KB)` : `Desmos errors: ${errs.slice(0, 3).join(' | ')}` }))
      }, 900)
      let before = JSON.stringify(calc.getState().expressions)
      calc.observeEvent('change', () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          const now = JSON.stringify(calc.getState().expressions)
          if (now === before) return
          before = now
          const exprs = (calc.getExpressions() as { latex?: string }[]).map(e => e.latex).filter(Boolean).slice(0, 4).join('; ')
          emitSignal({ kind: 'slider', where: `desmos ${id}`, param: 'graph', detail: `graph now: ${exprs}${helpers.length ? ` (${read()})` : ''}`, value: 1 })
        }, 1500)
      })
    }).catch(err => { setStatus({ ok: false, text: 'Desmos did not load' }); emitSignal({ kind: 'stage', where: `desmos ${id}`, correct: false, detail: String(err).slice(0, 120) }) })
    return () => { dead = true; clearTimeout(timer); try { calc?.destroy() } catch { /* gone */ } }
  }, [id, key, spec])
  return (
    <EmbedFrame title={title} status={status} credit={<>Graph: <a className="underline" href="https://www.desmos.com" target="_blank" rel="noreferrer">Desmos</a></>}>
      <div ref={host} className="h-[300px] w-full sm:h-[360px]" />
    </EmbedFrame>
  )
}

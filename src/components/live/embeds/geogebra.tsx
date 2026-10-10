'use client'
/**
 * GeoGebra Apps API (deployggb.js): free for non-commercial use with attribution ("Made with GeoGebra®"); switch it
 * off with GEOGEBRA_ENABLED=0. The tutor's commands run through evalCommand; rejected commands are reported back as a
 * failed stage check; the learner's drags read back through getValue / getXcoord / getYcoord and an update listener.
 */
import React, { useEffect, useRef, useState } from 'react'
import { emitSignal } from '@/lib/live/signals'
import { EmbedFrame } from './shell'
import { loadScript } from './load-script'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function GeoGebraEmbed({ id, title, spec }: { id: string; title: string; spec: { app: string; commands: string[]; watch?: string[] } }) {
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const elId = `ggb-${id}`
  useEffect(() => {
    let dead = false
    let timer: ReturnType<typeof setTimeout> | undefined
    loadScript('https://www.geogebra.org/apps/deployggb.js').then(() => {
      if (dead || !host.current) return
      const w = host.current.clientWidth || 360
      const params = {
        appName: spec.app === '3d' ? '3d' : spec.app === 'geometry' ? 'geometry' : 'graphing',
        width: w, height: Math.round(w * 0.75), showToolBar: false, showAlgebraInput: false, showMenuBar: false, enableShiftDragZoom: true, showResetIcon: true, language: 'en',
        appletOnLoad: (api: any) => {
          const bad: string[] = []
          for (const c of spec.commands) { try { if (!api.evalCommand(c)) bad.push(c) } catch { bad.push(c) } }
          const names: string[] = (spec.watch?.length ? spec.watch : api.getAllObjectNames()).slice(0, 6)
          const read = () => names.map(n => {
            const t = api.getObjectType(n)
            return t === 'point' ? `${n}=(${Number(api.getXcoord(n)).toFixed(2)}, ${Number(api.getYcoord(n)).toFixed(2)})` : `${n}=${Number(api.getValue(n)).toFixed(3)}`
          }).join(', ')
          const ok = bad.length === 0
          setStatus(ok ? { ok: true, text: 'Drag the points and sliders' } : { ok: false, text: `${bad.length} command(s) not understood` })
          emitSignal({ kind: 'stage', where: `geogebra ${id}`, correct: ok, detail: ok ? `construction drawn: ${read()}` : `GeoGebra rejected: ${bad.slice(0, 3).join(' | ')}` })
          let before = read()
          api.registerUpdateListener(() => {
            clearTimeout(timer)
            timer = setTimeout(() => { const now = read(); if (now !== before) { emitSignal({ kind: 'slider', where: `geogebra ${id}`, param: names.join('/'), detail: `values now ${now} (were ${before})`, value: 1 }); before = now } }, 1200)
          })
        },
      }
      const applet = new (window as any).GGBApplet(params, true)
      applet.inject(elId)
    }).catch(err => { setStatus({ ok: false, text: 'GeoGebra did not load' }); emitSignal({ kind: 'stage', where: `geogebra ${id}`, correct: false, detail: String(err).slice(0, 120) }) })
    return () => { dead = true; clearTimeout(timer) }
  }, [id, elId, spec])
  return (
    <EmbedFrame title={title} status={status} credit={<>Made with <a className="underline" href="https://www.geogebra.org" target="_blank" rel="noreferrer">GeoGebra®</a></>}>
      <div ref={host} className="w-full"><div id={elId} /></div>
    </EmbedFrame>
  )
}

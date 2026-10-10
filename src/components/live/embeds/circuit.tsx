'use client'
/**
 * Falstad CircuitJS1 (GPL-2+) in its own iframe (/circuitjs/, unmodified build + a postMessage bridge). The tutor's
 * netlist is loaded; live readings come back once a second and are compared with the server's exact solution (the
 * self-check, reported as a 'stage' signal); the learner's changes are read back as signals.
 */
import React, { useEffect, useRef, useState } from 'react'
import { emitSignal } from '@/lib/live/signals'
import { checkReadings, type CircuitSolution } from '@/lib/live/tools/circuit-net'
import { EmbedFrame } from './shell'

export default function CircuitEmbed({ id, title, spec }: { id: string; title: string; spec: { netlist: string; solution: CircuitSolution } }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [readings, setReadings] = useState<{ type: string; v: number; a: number }[]>([])
  const checked = useRef(false)
  const lastSig = useRef('')
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin || ev.source !== ref.current?.contentWindow || ev.data?.source !== 'ideanimo-circuit') return
      const d = ev.data
      if (d.op === 'ready') ref.current?.contentWindow?.postMessage({ target: 'ideanimo-circuit', op: 'load', netlist: spec.netlist }, window.location.origin)
      if (d.op === 'readings' && Array.isArray(d.elements)) {
        const rs = (d.elements as { type: string; v: number; a: number }[]).filter(r => /Resistor/.test(r.type))
        setReadings(rs)
        if (!checked.current && (d.t ?? 0) > 0.0005 && rs.length) {
          checked.current = true
          const c = checkReadings(spec.solution, d.elements)
          setStatus(c.ok ? { ok: true, text: 'Simulator matches the worked numbers' } : { ok: false, text: c.issues[0] })
          emitSignal({ kind: 'stage', where: `circuit ${id}`, correct: c.ok, detail: c.ok ? 'circuit simulator readings match the solution' : `circuit check failed: ${c.issues.join('; ')}` })
        } else if (checked.current) {
          // The learner edited the circuit (values changed after the check): read it back.
          const sig = rs.map(r => r.a.toFixed(3)).join(',')
          if (lastSig.current && sig !== lastSig.current) emitSignal({ kind: 'slider', where: `circuit ${id}`, param: 'circuit', detail: `currents now ${rs.map(r => `${Math.abs(r.a).toFixed(3)} A`).join(', ')}`, value: Math.abs(rs[0]?.a ?? 0) })
          lastSig.current = sig
        }
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [id, spec])
  return (
    <EmbedFrame title={title} status={status} credit={<>Circuit simulator: <a className="underline" href="https://github.com/pfalstad/circuitjs1" target="_blank" rel="noreferrer">CircuitJS1</a> by Paul Falstad &amp; Iain Sharp (GPL)</>}>
      <iframe ref={ref} title={title} src="/circuitjs/index.html?hideMenu=true&hideSidebar=true&hideInfoBox=false&whiteBackground=true&editable=true&running=true" className="block h-[300px] w-full border-0 sm:h-[360px]" />
      {readings.length > 0 && (
        <div className="tnum grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-line px-3.5 py-2 text-[12.5px] text-ink-2 sm:grid-cols-3">
          {spec.solution.resistors.map((r, i) => <span key={i}>{r.label} {r.ohms} Ω: {r.volts} V, {r.amps} A</span>)}
          <span className="font-medium">Total {spec.solution.req} Ω, {spec.solution.current} A</span>
        </div>
      )}
    </EmbedFrame>
  )
}

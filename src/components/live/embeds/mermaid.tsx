'use client'
/** Mermaid (MIT) diagrams; a parse/render error goes back to the tutor as a failed stage check. */
import React, { useEffect, useState } from 'react'
import { emitSignal } from '@/lib/live/signals'
import { EmbedFrame } from './shell'

let seq = 0
export default function MermaidEmbed({ id, title, spec }: { id: string; title: string; spec: { code: string } }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    let dead = false
    ;(async () => {
      const mermaid = (await import('mermaid')).default
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', fontFamily: 'inherit', flowchart: { htmlLabels: false } })
      try {
        // Phones: a long left-to-right chain becomes unreadably small, so it is laid out top-down instead.
        const narrow = (typeof window !== 'undefined' ? window.innerWidth : 800) < 560
        const code = narrow ? spec.code.replace(/^(flowchart|graph)\s+(LR|RL)\b/, '$1 TD') : spec.code
        await mermaid.parse(code)
        const { svg } = await mermaid.render(`mm-${id}-${seq++}`, code)
        if (dead) return
        setSvg(svg)
        const nodes = (svg.match(/class="node( |")/g) ?? []).length
        setStatus({ ok: true, text: nodes ? `${nodes} nodes` : 'Diagram' })
        emitSignal({ kind: 'stage', where: `diagram ${id}`, correct: true, detail: `diagram rendered${nodes ? ` with ${nodes} nodes` : ''}` })
      } catch (err) {
        if (dead) return
        setStatus({ ok: false, text: 'This diagram did not draw' })
        emitSignal({ kind: 'stage', where: `diagram ${id}`, correct: false, detail: `Mermaid could not draw it: ${String(err instanceof Error ? err.message : err).slice(0, 200)}` })
      }
    })()
    return () => { dead = true }
  }, [id, spec.code])
  return (
    <EmbedFrame title={title} status={status} credit={<>Diagram: <a className="underline" href="https://mermaid.js.org" target="_blank" rel="noreferrer">Mermaid</a></>}>
      {svg ? <div className="mermaid-embed flex w-full justify-center overflow-x-auto p-3 [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="h-[200px] w-full" />}
    </EmbedFrame>
  )
}

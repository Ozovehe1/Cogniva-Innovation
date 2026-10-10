'use client'
import React, { useEffect, useState } from 'react'
import { AgentBlock } from '@/components/agent/blocks'
import type { Block } from '@/lib/agent/types'
import { circuitNetlist, parseCircuit, solveCircuit } from '@/lib/live/tools/circuit-net'
import { phetSim } from '@/lib/live/tools/embed-meta'

function circuit(id: string, a: Record<string, unknown>): Block {
  const c = parseCircuit(a).spec!
  return { kind: 'embed', id, tool: 'circuit', title: String(a.title), alt: String(a.title), spec: { netlist: circuitNetlist(c), solution: solveCircuit(c), circuit: c } }
}
const SAMPLES: Record<string, Block[]> = {
  circuit: [
    circuit('lab-ser', { title: 'Series: 9 V, 3 Ω + 6 Ω', volts: 9, parts: [{ r: { label: 'R1', ohms: 3 } }, { r: { label: 'R2', ohms: 6 } }] }),
    circuit('lab-par', { title: 'Series–parallel: 12 V, 4 Ω then 6 Ω ∥ 3 Ω', volts: 12, parts: [{ r: { label: 'R1', ohms: 4 } }, { parallel: [[{ label: 'R2', ohms: 6 }], [{ label: 'R3', ohms: 3 }]] }] }),
  ],
  molecule: [{ kind: 'embed', id: 'lab-mol', tool: 'molecule', title: 'Water (H2O)', alt: 'water', spec: { cid: 962, name: 'water', style: 'ballstick', labels: true } }],
  mermaid: [{ kind: 'embed', id: 'lab-mm', tool: 'mermaid', title: 'The Krebs cycle (simplified)', alt: 'Krebs cycle', spec: { code: 'flowchart LR\n  A[Acetyl-CoA] --> B[Citrate]\n  B --> C[Isocitrate]\n  C -->|CO2, NADH| D[alpha-Ketoglutarate]\n  D -->|CO2, NADH| E[Succinyl-CoA]\n  E -->|ATP| F[Succinate]\n  F -->|FADH2| G[Fumarate]\n  G --> H[Malate]\n  H -->|NADH| I[Oxaloacetate]\n  I --> B' } }],
  physics: [{ kind: 'embed', id: 'lab-phy', tool: 'physics', title: 'A block on a ramp', alt: 'incline', spec: { kind: 'incline', params: { angle: 30, friction: 0.2, mass: 2 } } }],
  geogebra: [{ kind: 'embed', id: 'lab-ggb', tool: 'geogebra', title: 'A triangle you can drag', alt: 'triangle', spec: { app: 'geometry', commands: ['A=(0,0)', 'B=(4,0)', 'C=(1,3)', 'poly=Polygon(A,B,C)', 'alpha=Angle(B,A,C)'], watch: ['A', 'C', 'alpha'] } }],
  phet: [{ kind: 'embed', id: 'lab-phet', tool: 'phet', title: "Ohm's Law", alt: 'phet', spec: { ...phetSim('ohms-law')!, task: 'Make the current as big as you can. What did you change?' } }],
  desmos: [{ kind: 'embed', id: 'lab-des', tool: 'desmos', title: 'y = a x²', alt: 'parabola', spec: { expressions: [{ id: 'a', latex: 'a=1', min: -3, max: 3 }, { id: 'f', latex: 'y=ax^2' }], bounds: { left: -5, right: 5, bottom: -5, top: 10 }, watch: ['a'] } }],
}

interface Decision { run_id: string; summary: string; created_at: string; args: Record<string, unknown> }

export function AgentLab({ tool }: { tool?: string }) {
  const [signals, setSignals] = useState<string[]>([])
  const [trace, setTrace] = useState<Decision[] | null>(null)
  useEffect(() => {
    const on = (e: Event) => setSignals(s => [...s.slice(-12), JSON.stringify((e as CustomEvent).detail)])
    window.addEventListener('ideanimo:learner', on)
    fetch('/api/tutor/live?limit=30').then(r => (r.ok ? r.json() : null)).then(j => setTrace(j?.decisions ?? null)).catch(() => undefined)
    return () => window.removeEventListener('ideanimo:learner', on)
  }, [])
  const blocks = tool ? SAMPLES[tool] ?? [] : Object.values(SAMPLES).flat()
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="font-display text-[26px] text-ink">Live tutor lab</h1>
      <p className="mt-1 text-[14px] text-muted">External stage tools as the tutor mounts them. Signals they send back appear below.</p>
      <div className="mt-4 space-y-4">{blocks.map(b => <div key={b.id} data-lab-block={b.id}><AgentBlock block={b} /></div>)}</div>
      <h2 className="mt-6 text-[15px] font-medium text-ink">Signals from the stage</h2>
      <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-[10px] border border-line bg-surface p-2 text-[11px]" data-lab-signals>{signals.join('\n') || '—'}</pre>
      {trace && (
        <>
          <h2 className="mt-6 text-[15px] font-medium text-ink">Your live tutor decisions</h2>
          <ol className="mt-2 space-y-2 text-[12.5px]" data-lab-trace>
            {trace.map(d => {
              const a = d.args as { signal?: { line?: string }; move?: string; reason?: string; plan?: string[]; tools?: string[]; outcome?: string; checks?: { ok: boolean; issues: string[] }[]; revised?: boolean; models?: string[]; ms?: number; text?: string }
              return (
                <li key={d.run_id} className="rounded-[10px] border border-line bg-surface p-2.5 font-mono leading-snug">
                  <div>{new Date(d.created_at).toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos' })} · signal: {a.signal?.line}</div>
                  <div>decide: {a.move} — {a.reason}</div>
                  {a.plan?.length ? <div>plan: {a.plan.join(' → ')}</div> : null}
                  <div>tools: {a.tools?.join(', ') || 'none'}{a.checks?.length ? ` · self-check: ${a.checks.map(c => (c.ok ? 'ok' : `FAIL ${c.issues.join('/')}`)).join(', ')}` : ''}{a.revised ? ' · revised' : ''}</div>
                  <div>outcome: {a.outcome} · {a.models?.join(' → ')} · {a.ms ? `${(a.ms / 1000).toFixed(1)} s` : ''}</div>
                  {a.text && <div className="mt-1 font-sans text-ink-2">“{a.text}”</div>}
                </li>
              )
            })}
          </ol>
        </>
      )}
    </main>
  )
}

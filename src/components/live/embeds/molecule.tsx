'use client'
/** 3Dmol.js (BSD-3) viewer; the structure comes from PubChem (3D record, else 2D). Rotations are read back as taps. */
import React, { useEffect, useRef, useState } from 'react'
import { emitSignal } from '@/lib/live/signals'
import { EmbedFrame } from './shell'

export default function MoleculeEmbed({ id, title, spec }: { id: string; title: string; spec: { cid: number; name: string; style: string; labels: boolean } }) {
  const el = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    let dead = false
    let viewer: { clear: () => void } | null = null
    ;(async () => {
      const $3Dmol = await import('3dmol')
      let sdf = ''
      let dim = '3D'
      const r = await fetch(`/api/tutor/pubchem?cid=${spec.cid}`).catch(() => null)
      if (r?.ok) { sdf = await r.text(); dim = (r.headers.get('X-Record-Type') ?? '3d').toUpperCase() }
      if (dead || !el.current) return
      if (!sdf) { setStatus({ ok: false, text: 'Structure not available' }); emitSignal({ kind: 'stage', where: `molecule ${id}`, correct: false, detail: `PubChem had no structure file for ${spec.name}` }); return }
      const v = $3Dmol.createViewer(el.current, { backgroundColor: 'white' })
      viewer = v as unknown as { clear: () => void }
      v.addModel(sdf, 'sdf')
      const style = spec.style === 'sphere' ? { sphere: { scale: 0.9 } } : spec.style === 'stick' ? { stick: { radius: 0.18 } } : { stick: { radius: 0.15 }, sphere: { scale: 0.28 } }
      v.setStyle({}, style as never)
      if (spec.labels) v.addPropertyLabels('elem', {}, { fontSize: 12, showBackground: false, fontColor: 'black', alignment: 'center' } as never)
      v.zoomTo(); v.render()
      const atoms = (v.getModel() as unknown as { selectedAtoms: (s: object) => unknown[] }).selectedAtoms({}).length
      setStatus({ ok: atoms > 0, text: `${dim} model · ${atoms} atoms · drag to rotate` })
      emitSignal({ kind: 'stage', where: `molecule ${id}`, correct: atoms > 0, detail: `${dim} structure of ${spec.name} with ${atoms} atoms shown` })
    })().catch(err => { setStatus({ ok: false, text: 'Could not load the 3D viewer' }); emitSignal({ kind: 'stage', where: `molecule ${id}`, correct: false, detail: String(err).slice(0, 120) }) })
    return () => { dead = true; try { viewer?.clear() } catch { /* gone */ } }
  }, [id, spec])
  return (
    <EmbedFrame title={title} status={status} credit={<>3D: <a className="underline" href="https://3dmol.csb.pitt.edu" target="_blank" rel="noreferrer">3Dmol.js</a> · structure: <a className="underline" href={`https://pubchem.ncbi.nlm.nih.gov/compound/${spec.cid}`} target="_blank" rel="noreferrer">PubChem</a></>}>
      <div ref={el} className="relative h-[280px] w-full sm:h-[340px]" onPointerUp={() => emitSignal({ kind: 'tap', where: `molecule ${id}`, detail: 'rotated the 3D model' })} />
    </EmbedFrame>
  )
}

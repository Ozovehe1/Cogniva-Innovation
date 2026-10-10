'use client'
/** One entry for every external stage tool; each adapter loads only when its block is on screen. */
import React from 'react'
import dynamic from 'next/dynamic'
import type { Block } from '@/lib/agent/types'

const Skel = () => <div className="h-[260px] w-full rounded-[14px] border border-line bg-[#FBFAF7]" aria-hidden="true"><div className="skeleton h-full w-full rounded-[14px] opacity-60" /></div>
const Circuit = dynamic(() => import('./circuit'), { ssr: false, loading: Skel })
const Molecule = dynamic(() => import('./molecule'), { ssr: false, loading: Skel })
const Mermaid = dynamic(() => import('./mermaid'), { ssr: false, loading: Skel })
const Physics = dynamic(() => import('./physics'), { ssr: false, loading: Skel })
const GeoGebra = dynamic(() => import('./geogebra'), { ssr: false, loading: Skel })
const Phet = dynamic(() => import('./phet'), { ssr: false, loading: Skel })
const Desmos = dynamic(() => import('./desmos'), { ssr: false, loading: Skel })

export function EmbedBlock({ block }: { block: Extract<Block, { kind: 'embed' }> }) {
  const p = { id: block.id, title: block.title, spec: block.spec as never }
  switch (block.tool) {
    case 'circuit': return <Circuit {...p} />
    case 'molecule': return <Molecule {...p} />
    case 'mermaid': return <Mermaid {...p} />
    case 'physics': return <Physics {...p} />
    case 'geogebra': return <GeoGebra {...p} />
    case 'phet': return <Phet {...p} />
    case 'desmos': return <Desmos {...p} />
    default: return null
  }
}

'use client'
/** PhET simulation, embed only (no PhET-iO: no control or read-back). Attribution as PhET asks. */
import React from 'react'
import { emitSignal } from '@/lib/live/signals'
import { PHET_CREDIT } from '@/lib/live/tools/embed-meta'
import { EmbedFrame } from './shell'

export default function PhetEmbed({ id, title, spec }: { id: string; title: string; spec: { slug: string; url: string; task?: string; licence?: string } }) {
  return (
    <EmbedFrame title={title} credit={<>{PHET_CREDIT.split(', https')[0]}, <a className="underline" href="https://phet.colorado.edu" target="_blank" rel="noreferrer">phet.colorado.edu</a> · {spec.licence ?? 'CC BY'}</>}>
      <iframe title={title} src={spec.url} allowFullScreen className="block aspect-[4/3] w-full border-0" onLoad={() => emitSignal({ kind: 'stage', where: `phet ${id}`, correct: true, detail: `${title} loaded (embed only, no read-back)` })} onPointerDown={() => emitSignal({ kind: 'tap', where: `phet ${id}`, detail: 'is exploring the PhET sim' })} />
      {spec.task && <p className="border-t border-line px-3.5 py-2 text-[13.5px] font-medium text-ink">{spec.task}</p>}
    </EmbedFrame>
  )
}

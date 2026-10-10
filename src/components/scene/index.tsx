'use client'
/**
 * Lazy entry points: the engine loads only when a scene is on screen. The placeholder reserves the scene's exact box
 * (stage aspect, control bar, readouts, sliders), so nothing below moves when the chunk arrives.
 */
import dynamic from 'next/dynamic'
import React from 'react'
import { hasReadouts, stageAspect } from '@/lib/scene/aspect'
import type { SceneSpec } from '@/lib/scene/types'
import type { SceneStageProps } from './scene-stage'

function SceneSkeleton({ spec, hideControls }: { spec: SceneSpec; hideControls?: boolean }) {
  return (
    <div aria-hidden="true">
      <div className="overflow-hidden rounded-[14px] bg-[#0E1322]">
        <div className="w-full" style={{ aspectRatio: `1 / ${stageAspect(spec)}` }} />
        <div className="h-[52px] bg-[#0B0F1B]" />
      </div>
      {hasReadouts(spec) && <div className="mt-2 h-[50px]" />}
      {!hideControls && spec.controls.length > 0 && <div className="mt-2 space-y-1">{spec.controls.map((c, i) => <div key={i} className="h-[56px]" />)}</div>}
    </div>
  )
}

const Stage = dynamic(() => import('./scene-stage'), { ssr: false, loading: () => null })
const Card = dynamic(() => import('./scene-card'), { ssr: false, loading: () => null })

/** Reserve the box, then mount the real stage. */
export function LazySceneStage(props: SceneStageProps) {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => { let on = true; import('./scene-stage').then(() => { if (on) setReady(true) }); return () => { on = false } }, [])
  return ready ? <Stage {...props} /> : <div className={props.className}><SceneSkeleton spec={props.spec} hideControls={props.hideControls} /></div>
}

export function LazySceneCard({ spec }: { spec: SceneSpec }) {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => { let on = true; import('./scene-card').then(() => { if (on) setReady(true) }); return () => { on = false } }, [])
  if (ready) return <Card spec={spec} />
  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-surface p-3 shadow-[var(--shadow-card)] sm:p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Live scene</p>
      <h3 className="mb-2.5 mt-0.5 font-display text-[19px] leading-snug text-ink">{spec.title}</h3>
      <SceneSkeleton spec={spec} />
    </div>
  )
}

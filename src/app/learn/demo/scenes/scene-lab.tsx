'use client'
import React, { useMemo } from 'react'
import SceneStage from '@/components/scene/scene-stage'
import { KIND_IDS } from '@/lib/scene/kinds'
import { legacySceneSpec, templateSpec } from '@/lib/scene/templates'
import type { SceneKindId, SceneSpec } from '@/lib/scene/types'

export function SceneLab({ kind, t, spec, legacy }: { kind?: string; t?: string; spec?: string; legacy?: string }) {
  const specs: SceneSpec[] = useMemo(() => {
    if (spec) { try { return [JSON.parse(spec) as SceneSpec] } catch { return [] } }
    if (legacy) { const l = legacySceneSpec(legacy); return l ? [l.spec] : [] }
    if (kind && (KIND_IDS as string[]).includes(kind)) return [templateSpec(kind as SceneKindId)]
    return KIND_IDS.map(k => templateSpec(k))
  }, [kind, spec, legacy])
  const seek = t !== undefined && t !== '' && Number.isFinite(Number(t)) ? Number(t) : undefined
  return (
    <main className="mx-auto w-full max-w-[440px] px-4 py-5">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted">Explore · live scene</p>
      {specs.map((s, i) => (
        <section key={i} className="mb-8 mt-1">
          <h1 className="mb-3 font-display text-[22px] leading-snug text-ink">{s.title}</h1>
          <SceneStage spec={s} seek={seek} />
        </section>
      ))}
    </main>
  )
}

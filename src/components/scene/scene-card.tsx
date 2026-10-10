'use client'
/** A live scene in the Ask / tutor answer stream: the card header (eyebrow + title) and the stage. */
import React from 'react'
import { RichText } from '@/components/rich-text'
import SceneStage from './scene-stage'
import type { SceneSpec } from '@/lib/scene/types'

export default function SceneCard({ spec }: { spec: SceneSpec }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-surface p-3 shadow-[var(--shadow-card)] sm:p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Live scene</p>
      <h3 className="mb-2.5 mt-0.5 font-display text-[19px] leading-snug text-ink"><RichText text={spec.title} /></h3>
      <SceneStage spec={spec} />
    </div>
  )
}

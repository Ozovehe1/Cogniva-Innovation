'use client'
/** A real live scene (the same engine Ask and lessons use) as the product visual on the public pages. */
import { LazySceneCard } from '@/components/scene'
import { templateSpec } from '@/lib/scene/templates'
import type { SceneKindId } from '@/lib/scene/types'

export function SiteScene({ kind }: { kind: SceneKindId }) {
  return <LazySceneCard spec={templateSpec(kind)} />
}

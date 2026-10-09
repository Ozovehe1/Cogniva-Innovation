'use client'
import { useSearchParams } from 'next/navigation'
import { AgentBlock } from '@/components/agent/blocks'
import { ENGINE_FIXTURE } from '@/lib/board-fixtures'

export function VisualsLab() {
  const params = useSearchParams()
  const at = Number(params.get('at') ?? 0) || 0
  return (
    <div className="space-y-6">
      <section data-lab="board">
        <AgentBlock block={{ kind: 'board', id: 'lab-board', title: 'Board engine', steps: ENGINE_FIXTURE, start: at || undefined }} />
      </section>
    </div>
  )
}

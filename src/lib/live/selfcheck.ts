/**
 * The tutor sees its own work: every new visual is checked before the agent moves on, and the verdict goes back into
 * the loop as part of the tool result (observe → revise once).
 *   1. geometry / bounds (deterministic, instant): board elements on the board, points inside their axes, labels not
 *      cut off; live-figure points inside their ranges; circuit numbers obey Ohm's law and KVL;
 *   2. a vision pass on a rendered snapshot (board / SVG) when a vision model has room: "does this show X? what is wrong?".
 * Browser-rendered embeds (circuit sim, Mermaid, 3D, GeoGebra, Desmos) report their own check as a 'stage' signal.
 * Server only.
 */
import type { Block } from '@/lib/agent/types'
import type { Step } from '@/lib/lesson-schema'
import { BOARD_H, BOARD_W } from '@/lib/lesson-schema'
import { buildBoard, shapeBox, type ShapeEl } from '@/components/whiteboard/board-state'
import { boardSnapshotPng, svgToPng } from '@/lib/agent/board-render'
import { visionJson } from '@/lib/agent/llm'
import type { CircuitSolution } from './tools/circuit-net'

export interface SelfCheck { ok: boolean; issues: string[]; vision: 'ok' | 'issues' | 'skipped' }

/** Deterministic checks (no model). */
export function geometryCheck(b: Block): string[] {
  const issues: string[] = []
  if (b.kind === 'board') {
    const st = buildBoard(b.steps as Step[], b.steps.length)
    for (const e of st.els) {
      if (e.kind !== 'shape') continue
      const box = shapeBox(e as ShapeEl)
      if (!box) continue
      if (box.x < -4 || box.y < -4 || box.x + box.w > BOARD_W + 4 || box.y + box.h > BOARD_H + 4) issues.push(`${e.id ?? e.step.shape.kind} goes off the board`)
      const ax = (e as ShapeEl).axes
      if (ax && e.step.shape.kind !== 'axes' && e.step.shape.kind !== 'function') {
        const f = ax.frame
        if (box.x + box.w < f.x - 2 || box.x > f.x + f.w + 2 || box.y + box.h < f.y - 2 || box.y > f.y + f.h + 2) issues.push(`${e.id ?? e.step.shape.kind} sits outside its axes`)
      }
    }
  } else if (b.kind === 'interactive') {
    const s = b.spec as unknown as { x?: [number, number]; y?: [number, number]; points?: { name: string; x?: unknown; y?: unknown }[] }
    if (s.x && s.y) for (const p of s.points ?? []) {
      const x = Number(p.x), y = Number(p.y)
      if (Number.isFinite(x) && Number.isFinite(y) && (x < s.x[0] || x > s.x[1] || y < s.y[0] || y > s.y[1])) issues.push(`point ${p.name} (${x}, ${y}) is outside the figure's range`)
    }
  } else if (b.kind === 'embed' && b.tool === 'circuit') {
    const sol = b.spec.solution as CircuitSolution | undefined
    const c = b.spec.circuit as { volts: number } | undefined
    if (sol && c) {
      const ohm = sol.resistors.find(r => Math.abs(r.volts - r.amps * r.ohms) > 0.02 * Math.max(1, r.volts))
      if (ohm) issues.push(`${ohm.label}: V ≠ I·R`)
      if (Math.abs(sol.req * sol.current - c.volts) > 0.02 * c.volts) issues.push('battery current × equivalent resistance ≠ battery voltage')
    }
  } else if (b.kind === 'svg') {
    if (!/viewBox=/.test(b.svg)) issues.push('picture has no viewBox (may be cut off on phones)')
  }
  return issues
}

/** Geometry + one vision pass (board / SVG only, when time allows). */
export async function selfCheck(b: Block, intent: string, opts: { deadline?: number; trace?: string[]; vision?: boolean } = {}): Promise<SelfCheck> {
  const issues = geometryCheck(b)
  let vision: SelfCheck['vision'] = 'skipped'
  const left = (opts.deadline ?? Date.now() + 15_000) - Date.now()
  if (opts.vision !== false && left > 9000 && (b.kind === 'board' || (b.kind === 'svg' && !b.credit))) {
    try {
      const png = b.kind === 'board' ? await boardSnapshotPng(b.steps as Step[], 800) : await svgToPng(b.svg, 800)
      const pngB64 = typeof png === 'string' ? png : (png as { png?: string } | null)?.png ?? null
      if (pngB64) {
        const v = await visionJson(`You check a tutor's picture before a learner sees it. It is meant to show: ${intent.slice(0, 300)}.\nLook at the image. Reply JSON {"ok": boolean, "problems": [short strings]}: wrong or missing object, labels cut off or overlapping, points outside their axes, numbers that contradict the intent. ok=true only if it clearly shows the intent.`, pngB64, { deadline: Math.min(opts.deadline ?? Infinity, Date.now() + 12_000), trace: opts.trace, priority: 'live' }) as { ok?: boolean; problems?: unknown[] } | null
        if (v && typeof v === 'object') {
          vision = v.ok === false ? 'issues' : 'ok'
          if (v.ok === false) issues.push(...(Array.isArray(v.problems) ? v.problems.map(String).slice(0, 4) : ['vision check: does not show the intent']))
        }
      }
    } catch (err) { opts.trace?.push(`selfcheck vision: ${err instanceof Error ? err.message.slice(0, 80) : err}`) }
  }
  return { ok: issues.length === 0, issues: issues.slice(0, 6), vision }
}

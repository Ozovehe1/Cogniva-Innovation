'use client'
/**
 * What the tutor is doing during an Ask turn, before and between the parts of its answer
 * (docs/design/app-ui.md §Waiting states):
 * - TurnStatus: one honest line tied to real stream events: "Reading your question" until the first event, the label
 *   of the tool that is running now ("Drawing on the board"), "Writing the answer" once tools are done and words are
 *   due. The line changes only when the server says something changed (uncertainty reduction, no fake stages).
 * - VisualPlaceholder: while a visual tool runs, its frame is already on the page at the size of what is coming, with
 *   the same header strip, so the eye knows where to look and nothing jumps when it lands (signalling, no layout shift).
 */
import React from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { PaperSketch, WaitNote, useElapsed, type SketchKind } from '@/components/system/wait'
import type { ToolState } from './tool-chips'

/** Which visual a running tool will produce, its frame label and its final aspect ratio. */
export const VISUAL_TOOL: Record<string, { kind: SketchKind; label: string; aspect: string; note: string }> = {
  draw_on_board: { kind: 'board', label: 'Whiteboard', aspect: '16 / 10', note: 'Planning each step before the pen starts' },
  board_edit: { kind: 'board', label: 'Whiteboard', aspect: '16 / 10', note: 'Changing only the part that needs it' },
  plot: { kind: 'graph', label: 'Graph', aspect: '16 / 10', note: 'Working out the axes and the key points' },
  interactive: { kind: 'graph', label: 'Interactive', aspect: '3 / 2', note: 'Setting up the parts you can drag' },
  math_diagram: { kind: 'diagram', label: 'Diagram', aspect: '16 / 10', note: 'Placing every point exactly' },
  illustrate: { kind: 'diagram', label: 'Diagram', aspect: '4 / 3', note: 'Drawing it and placing the labels' },
  find_illustration: { kind: 'picture', label: 'Picture', aspect: '4 / 3', note: 'Looking through the illustration library' },
  simulate: { kind: 'sim', label: 'Simulation', aspect: '3 / 2', note: 'Wiring the sliders to the formulas' },
  run_python: { kind: 'graph', label: 'Figure', aspect: '4 / 3', note: 'Running the calculation' },
}

export function TurnStatus({ tools, hasText, hasBlocks }: { tools: ToolState[]; hasText: boolean; hasBlocks: boolean }) {
  const running = tools.filter(t => t.state === 'start')
  const now = running[running.length - 1]
  const elapsed = useElapsed(!now && !hasText && !tools.length)
  const reduce = useReducedMotion()
  let line: string | null = null
  let sub: string | undefined
  if (now) {
    line = now.label
    sub = VISUAL_TOOL[now.name] ? undefined : now.name === 'compute' ? 'Exact maths, so every number is right' : undefined
  } else if (!hasText && !tools.length) {
    line = 'Reading your question'
    // A real threshold, not a timer: nothing has come back yet, so say what that means.
    if (elapsed >= 8) sub = 'Working out the best way to show it'
  } else if (!hasText && !hasBlocks) {
    line = 'Writing the answer'
  }
  return (
    <div className="min-h-[1.75rem]">
      <AnimatePresence mode="wait" initial={false}>
        {line && (
          <motion.div key={line} initial={reduce ? false : { opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -3 }} transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}>
            <WaitNote sub={sub}>{line}</WaitNote>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** The frame of the visual a running tool is about to produce. */
export function VisualPlaceholder({ tool }: { tool: ToolState }) {
  const v = VISUAL_TOOL[tool.name]
  if (!v) return null
  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-[var(--shadow-card)]" data-wait="visual" aria-busy="true">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{v.label}</span>
        <span className="skeleton h-3 w-28" aria-hidden />
      </div>
      <PaperSketch bare kind={v.kind} aspect={v.aspect} progress="none" live={false}
        caption={<span className="text-[13px] text-muted">{v.note}</span>} />
    </div>
  )
}

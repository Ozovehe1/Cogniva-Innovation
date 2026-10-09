/**
 * Hiding a reported artefact for the learner who reported it (client-safe: used by the lesson page on load and by the
 * player the moment the report is sent). Pictures, live figures and clips are swapped for a calm placeholder; text
 * stays (the lesson would not read without it) and is marked by the flagged notice instead.
 */
import type { Step } from '../lesson-schema'

const PLACEHOLDER = (w: number, h: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="14" fill="#F4F1EA" stroke="#C9C3B6" stroke-width="2" stroke-dasharray="8 7"/><text x="${w / 2}" y="${h / 2 - 6}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${Math.max(13, Math.min(22, w / 18))}" fill="#3D3D47">Picture hidden — you reported it</text><text x="${w / 2}" y="${h / 2 + 20}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${Math.max(11, Math.min(16, w / 26))}" fill="#66666F">Thanks. We’re checking it.</text></svg>`

/** Whether a step is a visual that can be hidden. */
export function isHideable(s: Step | undefined): boolean {
  return !!s && ((s.type === 'draw' && s.shape.kind === 'figure') || s.type === 'stage' || s.type === 'manim_clip')
}

export function hiddenStep(s: Step): Step {
  if (s.type === 'draw' && s.shape.kind === 'figure') {
    const { x, y, w, h } = s.shape
    return { ...s, shape: { kind: 'figure', x, y, w, h, svg: PLACEHOLDER(Math.round(w), Math.round(h)), alt: 'Picture hidden after your report' } }
  }
  if (s.type === 'stage' || s.type === 'manim_clip') {
    return { type: 'write', id: s.id, text: s.type === 'stage' ? 'Live figure hidden — you reported it. Thanks!' : 'Animation hidden — you reported it. Thanks!', x: 24, y: 452, size: 'sm', color: 'muted', say: s.say } as Step
  }
  return s
}

/** The step to hide for a report: a picture complaint targets the last visual on the board, anything else the current step. */
export function reportTarget(steps: Step[], current: number, category: string | null): number {
  if (category === 'wrong_picture' || !isHideable(steps[current])) {
    for (let k = current; k >= 0 && k > current - 40; k--) {
      if (isHideable(steps[k])) return category === 'wrong_picture' || k === current ? k : current
      if (steps[k]?.type === 'clear' && !(steps[k] as { targets?: unknown }).targets) break
    }
  }
  return current
}

/** A hidden placeholder and the visual it replaced count as the same step (so a lesson still being written keeps playing). */
function compareKey(s: Step): string {
  if (isHideable(s) || (s.type === 'write' && /you reported it/.test(s.text))) return `visual:${s.id ?? ''}`
  return JSON.stringify(s)
}
export function sameScript(a: Step[], b: Step[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (compareKey(a[i]) !== compareKey(b[i])) return false
  return true
}

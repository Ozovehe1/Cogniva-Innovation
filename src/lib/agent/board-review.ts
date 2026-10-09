/**
 * Review pass after anything is drawn on the chat board, before the learner sees it:
 *   1. deterministic checks on the scene graph: text overlapping text or marks over labels, anything off the board,
 *      diagram labels too small once the diagram is zoomed to a 360 px-wide phone, low contrast;
 *   2. automatic repairs for what can be fixed safely (text nudged into free space or back onto the board);
 *   3. one critique of the rendered snapshot by a vision model (when one is available in time), whose position
 *      fixes are applied once; then the deterministic checks run again.
 * Only steps added in this call are ever changed (what the learner already saw stays put). Server only.
 */
import { BOARD_H, BOARD_W, type Ink, type Step } from '../lesson-schema'
import { INK_HEX, SIZE_PX, compactPartition } from '@/components/whiteboard/board-state'
import { boardState, sceneOf, sceneText, type BoardDoc, type SceneElement } from './board-scene'
import { boardSnapshotSvg, svgToPng } from './board-render'
import { visionJson } from './llm'

export interface ReviewIssue { id: string; kind: 'overlap' | 'off-canvas' | 'too-small' | 'contrast' | 'vision'; detail: string; fixed?: boolean }
export interface ReviewResult { steps: Step[]; issues: ReviewIssue[]; vision: 'ok' | 'fixed' | 'skipped' | 'issues'; repaired: number }

const PHONE_W = 340 // a 360 px phone minus the chat padding
const MIN_LABEL_PX = 10
const BG = '#FBFAF7'

function lum(hex: string) {
  const v = hex.replace('#', '').slice(0, 6)
  const c = [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
export function contrast(a: string, b: string) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

const inter = (a: number[], b: number[]) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])
  return w > 0 && h > 0 ? w * h : 0
}
const isText = (e: SceneElement) => e.type === 'text' || e.type === 'math'

/** Deterministic checks. `fresh`: ids drawn in this call (only they are reported as fixable). */
export function checkScene(doc: BoardDoc, fresh?: Set<string>): ReviewIssue[] {
  const scene = sceneOf(doc)
  const issues: ReviewIssue[] = []
  const els = scene.elements
  const mine = (e: SceneElement) => !fresh || fresh.has(e.id)
  for (const e of els) {
    if (!mine(e)) continue
    const [x, y, w, h] = e.bbox
    if (x < -2 || y < -2 || x + w > BOARD_W + 2 || y + h > BOARD_H + 2) issues.push({ id: e.id, kind: 'off-canvas', detail: `box ${e.bbox.join(',')} leaves the ${BOARD_W}x${BOARD_H} board` })
  }
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i], b = els[j]
    if (!mine(a) && !mine(b)) continue
    if (a.layer === 'note' || b.layer === 'note') {
      // Notes reflow under the diagram on phones, but on a wide board they still must not collide with each other.
      if (!(isText(a) && isText(b))) continue
    }
    const ab = inter(a.bbox, b.bbox)
    if (!ab) continue
    const small = Math.min(a.bbox[2] * a.bbox[3], b.bbox[2] * b.bbox[3]) || 1
    if (isText(a) && isText(b) && ab > 0.12 * small) issues.push({ id: mine(b) ? b.id : a.id, kind: 'overlap', detail: `${a.id} and ${b.id} overlap` })
    else if ((a.type === 'mark' && isText(b)) || (b.type === 'mark' && isText(a))) {
      const [m, t] = a.type === 'mark' ? [a, b] : [b, a]
      // A mark's note colliding with another label (its own target is meant to sit under the mark).
      if (!m.label.includes(` on ${t.id}`) && ab > 0.2 * (t.bbox[2] * t.bbox[3])) issues.push({ id: m.id, kind: 'overlap', detail: `${m.id} covers ${t.id}` })
    } else if ((isText(a) && b.type === 'figure') || (isText(b) && a.type === 'figure')) {
      const t = isText(a) ? a : b
      if (ab > 0.3 * t.bbox[2] * t.bbox[3]) issues.push({ id: t.id, kind: 'overlap', detail: `${t.id} sits on the figure ${t === a ? b.id : a.id}` })
    }
  }
  // Phone: the diagram (shapes + short labels) is zoomed to the screen width.
  const state = boardState(doc.steps)
  const layout = compactPartition(state)
  if (layout.region) {
    const k = PHONE_W / Math.max(layout.region.w, 1)
    for (const el of state.els) {
      if ((el.kind === 'text' || el.kind === 'math') && el.id && layout.labels.has(el.key) && (!fresh || fresh.has(el.id))) {
        const px = SIZE_PX[el.size] * k
        if (px < MIN_LABEL_PX) issues.push({ id: el.id, kind: 'too-small', detail: `label renders at ${px.toFixed(1)} px on a 360 px phone (diagram ${Math.round(layout.region.w)} units wide)` })
      }
    }
  }
  for (const e of els) {
    if (!mine(e) || !e.color) continue
    const ratio = contrast(INK_HEX[e.color as Ink] ?? '#14141A', BG)
    if (ratio < (isText(e) ? 4.5 : 3)) issues.push({ id: e.id, kind: 'contrast', detail: `contrast ${ratio.toFixed(1)}:1 on the board` })
  }
  return issues
}

/** Steps (by index) that create each id, for repairs. */
function creators(steps: Step[], from: number) {
  const m = new Map<string, number>()
  steps.forEach((s, i) => { if (i >= from && 'id' in s && s.id && (s.type === 'write' || s.type === 'math')) m.set(s.id, i) })
  return m
}

/** Safe automatic repairs: move fresh text that overlaps or leaves the board; enlarge labels that are too small. */
function autoRepair(doc: BoardDoc, from: number, issues: ReviewIssue[]): number {
  const made = creators(doc.steps, from)
  let n = 0
  const scene = sceneOf(doc)
  const boxOf = (id: string) => scene.elements.find(e => e.id === id)?.bbox
  for (const is of issues) {
    const k = made.get(is.id)
    if (k === undefined) continue
    const s = doc.steps[k] as Extract<Step, { type: 'write' | 'math' }>
    const b = boxOf(is.id)
    if (!b) continue
    if (is.kind === 'off-canvas') {
      const dx = b[0] < 12 ? 12 - b[0] : b[0] + b[2] > BOARD_W - 12 ? BOARD_W - 12 - (b[0] + b[2]) : 0
      const dy = b[1] < 12 ? 12 - b[1] : b[1] + b[3] > BOARD_H - 12 ? BOARD_H - 12 - (b[1] + b[3]) : 0
      if (dx || dy) { s.x = Math.max(0, Math.min(BOARD_W, s.x + dx)); s.y = Math.max(0, Math.min(BOARD_H, s.y + dy)); is.fixed = true; n++ }
    } else if (is.kind === 'overlap') {
      // Find the first free slot below, then above, then right.
      const others = scene.elements.filter(e => e.id !== is.id && (e.type === 'text' || e.type === 'math' || e.type === 'figure' || e.type === 'mark' || e.type === 'point'))
      const tryAt = (nx: number, ny: number) => {
        const box = [nx - (s.x - b[0]), ny, b[2], b[3]]
        if (box[0] < 8 || box[1] < 8 || box[0] + box[2] > BOARD_W - 8 || box[1] + box[3] > BOARD_H - 8) return false
        return !others.some(o => inter(box, o.bbox) > 0)
      }
      const cands: [number, number][] = []
      for (let d = 1; d <= 6; d++) cands.push([s.x, s.y + d * (b[3] * 0.6 + 6)], [s.x, s.y - d * (b[3] * 0.6 + 6)], [s.x + d * 40, s.y])
      const hit = cands.find(([x, y]) => tryAt(x, y))
      if (hit) { s.x = Math.round(hit[0]); s.y = Math.round(hit[1]); is.fixed = true; n++ }
    } else if (is.kind === 'too-small' && (s.size === 'sm' || s.size === undefined)) {
      s.size = s.size === 'sm' ? 'md' : 'lg'; is.fixed = true; n++
    }
  }
  return n
}

const VISION_PROMPT = (scene: string) => `You are checking a teaching whiteboard (800x500 units, x right, y down) before a student sees it on a phone.
Elements on it (id [type] "label" box x,y,w,h):
${scene}
Look at the image. Report only real problems: labels or text overlapping each other or a drawing so they are hard to read, an arrow or label pointing at the wrong thing, things cut off at the edge, cramped or unbalanced layout, a diagram that is wrong for what the labels say.
Return JSON {"ok": true|false, "issues": [{"id": element id, "problem": "short", "move_to": [x, y] or null}]}, at most 4 issues. "move_to" is a new top-left for a text or math element that would fix it (inside the board, in empty space). If it looks good, return {"ok": true, "issues": []}.`

/**
 * Review the steps added from index `from` (whole scene: from = 0) and repair once. Mutates nothing it was given:
 * returns the (possibly repaired) full step list.
 */
export async function reviewBoard(doc: BoardDoc, from: number, opts: { deadline?: number; trace?: string[]; vision?: boolean } = {}): Promise<ReviewResult> {
  const work: BoardDoc = { ...doc, steps: structuredClone(doc.steps) }
  const fresh = new Set(work.steps.slice(from).flatMap(s => [s, ...(((s as { cues?: Step[] }).cues) ?? [])]).map(s => (s as { id?: string }).id).filter((x): x is string => !!x))
  const first = checkScene(work, fresh)
  let repaired = autoRepair(work, from, first)
  let vision: ReviewResult['vision'] = 'skipped'
  const visionIssues: ReviewIssue[] = []
  if (opts.vision !== false && (opts.deadline ?? Infinity) - Date.now() > 8000 && fresh.size) {
    const png = await svgToPng(boardSnapshotSvg(work.steps), 800)
    if (png) {
      const raw = await visionJson(VISION_PROMPT(sceneText(sceneOf(work))), png, { deadline: Math.min(opts.deadline ?? Date.now() + 15_000, Date.now() + 15_000), trace: opts.trace }) as { ok?: boolean; issues?: { id?: string; problem?: string; move_to?: unknown }[] } | null
      if (raw && typeof raw === 'object') {
        const made = creators(work.steps, from)
        vision = raw.ok || !raw.issues?.length ? 'ok' : 'issues'
        for (const it of (Array.isArray(raw.issues) ? raw.issues : []).slice(0, 4)) {
          const id = String(it?.id ?? '')
          const issue: ReviewIssue = { id, kind: 'vision', detail: String(it?.problem ?? '').slice(0, 160) }
          const k = made.get(id)
          const mt = Array.isArray(it?.move_to) && it.move_to.length === 2 ? it.move_to.map(Number) : null
          if (k !== undefined && mt && mt.every(Number.isFinite) && mt[0] >= 8 && mt[0] <= BOARD_W - 40 && mt[1] >= 8 && mt[1] <= BOARD_H - 20) {
            const s = work.steps[k] as Extract<Step, { type: 'write' | 'math' }>
            const before = { x: s.x, y: s.y }
            const box = sceneOf(work).elements.find(e => e.id === id)?.bbox
            // Keep alignment: move the anchor by how far the box moves.
            s.x = Math.round(s.x + (mt[0] - (box?.[0] ?? before.x)))
            s.y = Math.round(mt[1])
            // Only keep the vision fix if it does not create a new overlap.
            if (checkScene(work, new Set([id])).some(x => x.kind === 'overlap' || x.kind === 'off-canvas')) { s.x = before.x; s.y = before.y }
            else { issue.fixed = true; repaired++ }
          }
          visionIssues.push(issue)
        }
        if (visionIssues.some(i => i.fixed)) vision = 'fixed'
      }
    }
  }
  const after = checkScene(work, fresh)
  const remaining = [...after, ...visionIssues.filter(v => !v.fixed)]
  const fixedNotes = [...first.filter(i => i.fixed), ...visionIssues.filter(i => i.fixed)]
  return { steps: work.steps, issues: [...fixedNotes, ...remaining.filter(r => !fixedNotes.some(f => f.id === r.id && f.kind === r.kind))], vision, repaired }
}

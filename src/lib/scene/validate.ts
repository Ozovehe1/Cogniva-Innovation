/**
 * The gate every scene spec passes before it renders: zod for shape, then semantic checks against the kind (params,
 * targets, ranges, beat grammar, caption length for 390 px, timeline length), then a layout check that runs the real
 * engine headless at phone widths and places the labels exactly as the renderer will. Errors are short, specific and
 * written for a model to repair (show_scene returns them; 1 repair round, then the kind template).
 */
import { z } from 'zod'
import { KINDS, KIND_IDS } from './kinds'
import { Scene, estTextW, placeLabels } from './engine'
import { compileFx } from './expr'
import { CAPTION_MAX, LABEL_MAX } from './tokens'
import type { SceneSpec } from './types'

const VERBS = ['reveal', 'move', 'set', 'play', 'hold', 'pulse', 'highlight', 'ask'] as const
const EASES = ['linear', 'inOut', 'out', 'in', 'spring'] as const

const Beat = z.object({
  do: z.enum(VERBS),
  target: z.string().max(40).optional(),
  param: z.string().max(40).optional(),
  to: z.number().finite().optional(),
  dur: z.number().min(0.3).max(8),
  ease: z.enum(EASES).optional(),
  caption: z.string().trim().min(1).max(120),
  say: z.string().max(400).optional(),
})

export const SceneSpecSchema = z.object({
  version: z.literal(1).default(1),
  kind: z.enum(KIND_IDS as [string, ...string[]]),
  title: z.string().trim().min(1).max(90),
  params: z.record(z.string(), z.union([z.number().finite(), z.string().max(120), z.boolean()])).default({}),
  beats: z.array(Beat).min(1).max(8),
  controls: z.array(z.object({ param: z.string(), label: z.string().max(40).optional() })).max(4).default([]),
  labels: z.array(z.object({ target: z.string(), text: z.string().trim().min(1).max(60) })).max(8).default([]),
  drag: z.boolean().default(false),
  alt: z.string().max(500).default(''),
})

export interface SceneCheck { spec?: SceneSpec; errors: string[]; warnings: string[] }

/** Phone widths the layout check runs at (390 px screen: card stage ≈ 358; narrow 320 screen ≈ 288). */
const WIDTHS = [358, 300]

export function validateScene(raw: unknown): SceneCheck {
  const errors: string[] = [], warnings: string[] = []
  // Friendly coercions models often need: string numbers, "beats" given as one object.
  const r = (raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}) as Record<string, unknown>
  if (typeof r.kind === 'string') r.kind = r.kind.trim().toLowerCase().replace(/[\s-]+/g, '_')
  const parsed = SceneSpecSchema.safeParse(r)
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 8)) errors.push(`${i.path.join('.') || 'spec'}: ${i.message}`)
    if (errors.some(e => e.startsWith('kind'))) errors.push(`kind must be one of: ${KIND_IDS.join(', ')}`)
    return { errors, warnings }
  }
  const s = parsed.data as SceneSpec
  const kind = KINDS[s.kind]
  const info = kind.info
  // Params.
  const numeric = new Set(Object.entries(info.params).filter(([, d]) => d.type === 'number').map(([k]) => k))
  for (const [k, val] of Object.entries(s.params)) {
    const d = info.params[k]
    if (!d) { errors.push(`params.${k}: not a parameter of ${s.kind}. Allowed: ${Object.keys(info.params).join(', ')}`); continue }
    if (d.type === 'number') {
      const n = typeof val === 'string' && val.trim() !== '' && Number.isFinite(Number(val)) ? Number(val) : val
      if (typeof n !== 'number') errors.push(`params.${k}: must be a number (${d.min}…${d.max})`)
      else if (n < d.min || n > d.max) errors.push(`params.${k}=${n} is outside ${d.min}…${d.max}`)
      else s.params[k] = n
    } else if (d.type === 'enum') {
      if (typeof val !== 'string' || !d.options.includes(val)) errors.push(`params.${k}: one of ${d.options.join(' | ')}`)
    } else if (d.type === 'bool') {
      if (typeof val !== 'boolean') errors.push(`params.${k}: true or false`)
    } else if (d.type === 'expr') {
      if (typeof val !== 'string' || !compileFx(val)) errors.push(`params.${k}: "${String(val).slice(0, 40)}" is not a valid f(x) (use x, numbers, + - * / ^, sin cos tan exp ln sqrt abs, pi)`)
    }
  }
  if (s.kind === 'tangent' && typeof s.params.x_min === 'number' && typeof s.params.x_max === 'number' && s.params.x_max - s.params.x_min < 1) errors.push('params.x_max must be at least 1 more than x_min')
  // Beats.
  let total = 0
  const vals: Record<string, number> = {}
  for (const [k, d] of Object.entries(info.params)) if (d.type === 'number') vals[k] = Number(s.params[k] ?? d.default)
  s.beats.forEach((b, i) => {
    const at = `beats[${i}]`
    total += b.dur
    if (b.caption.length > CAPTION_MAX) errors.push(`${at}.caption is ${b.caption.length} chars; max ${CAPTION_MAX} to fit one line at 390 px: "${b.caption.slice(0, 30)}…"`)
    if (['reveal', 'pulse', 'highlight'].includes(b.do)) {
      if (!b.target) errors.push(`${at}: "${b.do}" needs a target (${info.targets.join(', ')})`)
      else if (!info.targets.includes(b.target)) errors.push(`${at}.target "${b.target}" is not in ${s.kind}. Targets: ${info.targets.join(', ')}`)
    }
    if (b.do === 'ask') {
      if (b.target && !info.targets.includes(b.target)) errors.push(`${at}.target "${b.target}" is not in ${s.kind}`)
      if (!/\?\s*$/.test(b.caption)) errors.push(`${at}: an "ask" caption is a question (ends with ?)`)
    }
    if (b.do === 'move' || b.do === 'set') {
      if (!b.param || !numeric.has(b.param)) errors.push(`${at}: "${b.do}" needs param, a number parameter of ${s.kind}: ${[...numeric].join(', ')}`)
      else if (typeof b.to !== 'number') errors.push(`${at}: "${b.do}" needs "to" (a number)`)
      else { const d = info.params[b.param] as { min: number; max: number }; if (b.to < d.min || b.to > d.max) errors.push(`${at}.to=${b.to} is outside ${b.param}'s range ${d.min}…${d.max}`); else if (Math.abs(vals[b.param] - b.to) < 1e-9 && b.do === 'move') warnings.push(`${at}: ${b.param} is already ${b.to}; nothing moves`); vals[b.param] = b.to }
    }
    if (b.do === 'play' && !info.playParam) errors.push(`${at}: "play" is only for kinds with a clock (projectile); use move/set/hold for ${s.kind}`)
  })
  if (total > 30) errors.push(`the timeline is ${total.toFixed(1)} s; keep it ≤ 30 s (4–6 beats of 1.2–3 s)`)
  if (s.beats.every(b => b.do === 'hold')) errors.push('beats: nothing happens; use reveal / move / highlight / pulse to direct the eye')
  // Controls.
  const seen = new Set<string>()
  for (const [i, c] of s.controls.entries()) {
    if (!numeric.has(c.param)) errors.push(`controls[${i}].param "${c.param}" must be a number parameter of ${s.kind}: ${[...numeric].join(', ')}`)
    if (seen.has(c.param)) errors.push(`controls[${i}]: duplicate ${c.param}`)
    seen.add(c.param)
  }
  if (s.controls.length > 3) errors.push('controls: at most 3 sliders')
  if (s.drag && !info.dragParam) { warnings.push(`drag: ${s.kind} has no handle to drag; ignored`); s.drag = false }
  // Labels.
  if (s.labels.length > 4) errors.push(`labels: at most 4 (got ${s.labels.length})`)
  for (const [i, l] of s.labels.entries()) {
    if (!info.targets.includes(l.target)) errors.push(`labels[${i}].target "${l.target}" is not in ${s.kind}. Targets: ${info.targets.join(', ')}`)
    if (l.text.length > LABEL_MAX) errors.push(`labels[${i}].text is ${l.text.length} chars; max ${LABEL_MAX}`)
  }
  if (!s.alt.trim()) s.alt = info.example.alt
  if (errors.length) return { errors, warnings }
  // Layout: run the engine headless at phone widths, sample the timeline, place labels as the renderer will.
  try {
    for (const W of WIDTHS) {
      const sc = new Scene(s, kind)
      sc.layout(W)
      const T = sc.tl.total
      for (const t of [0.05, T * 0.5, Math.max(0.1, T - 0.05)]) {
        sc.seek(t)
        const P = sc.params
        const anchors = kind.anchors(sc.s, P, sc.v)
        for (const [k, a] of Object.entries(anchors)) if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) errors.push(`layout: ${k} has no position (check params)`)
        const placed = placeLabels(s.labels, anchors, sc.v, kind.keepouts?.(sc.s, P, sc.v))
        for (const l of placed) if (!l.ok) {
          // At 390 px a label that cannot be placed is an error; on narrower phones the renderer drops it (warning).
          const m = `layout: label "${l.text}" has no free space next to ${l.target} on a ${W + 32} px phone; shorten it, pick another target, or drop it`
          const list = W === WIDTHS[0] ? errors : warnings
          if (!list.includes(m)) list.push(m)
        }
        const cap = s.beats[sc.tl.beatAt(t)]?.caption ?? ''
        if (estTextW(cap, 13) + 26 > W - 8 && W === WIDTHS[0]) { const m = `layout: caption "${cap.slice(0, 30)}…" is too wide for 390 px; shorten it`; if (!errors.includes(m)) errors.push(m) }
      }
    }
  } catch (err) {
    errors.push(`layout: the scene failed to lay out (${err instanceof Error ? err.message.slice(0, 80) : 'error'})`)
  }
  return errors.length ? { errors, warnings } : { spec: s, errors, warnings }
}

/** The kinds in a compact form for the tool description. */
export function kindsForPrompt(): string {
  return KIND_IDS.map(id => {
    const i = KINDS[id].info
    const ps = Object.entries(i.params).map(([k, d]) => (d.type === 'number' ? `${k} ${d.min}..${d.max}` : d.type === 'enum' ? `${k} ${d.options.join('|')}` : d.type === 'expr' ? `${k} f(x)` : `${k} bool`)).join(', ')
    return `${id}: ${i.blurb}. params: ${ps}. targets: ${i.targets.join(', ')}${i.playParam ? `. play runs ${i.playParam}` : ''}${i.dragParam ? `. drag moves ${i.dragParam}` : ''}`
  }).join('\n')
}

/**
 * The agent tool `show_scene`: the model picks a scene kind, its parameters and a short beat timeline (what and when);
 * the validator checks it (zod + kind semantics + a headless layout check at 390 px) and the engine owns how it looks.
 * Invalid specs come back as a list of fixes (1 repair round; caption length and dur are tidied here); a second invalid spec shows the kind's ready template.
 */
import { randomUUID } from 'node:crypto'
import type { AgentCtx, ToolSpec } from '../agent/tools'
import { KINDS, KIND_IDS } from './kinds'
import { templateSpec } from './templates'
import { validateScene } from './validate'
import type { SceneKindId, SceneSpec } from './types'

/** Failed attempts per run (repair rounds). */
const fails = new WeakMap<AgentCtx, number>()

function kindsLine(): string {
  return KIND_IDS.map(id => {
    const i = KINDS[id].info
    const ps = Object.entries(i.params).filter(([k]) => k !== 'time').map(([k, d]) => (d.type === 'number' ? `${k} ${d.min}..${d.max}` : d.type === 'enum' ? `${k} ${d.options.join('|')}` : d.type === 'expr' ? `${k} "f(x)"` : `${k} bool`)).join(', ')
    return `- ${id}: params ${ps}; targets ${i.targets.join(', ')}${i.dragParam ? `; drag moves ${i.dragParam}` : ''}`
  }).join('\n')
}

const PARAM_NAMES = [...new Set(KIND_IDS.flatMap(k => Object.keys(KINDS[k].info.params)))]

export const sceneTool: ToolSpec = {
  def: {
    name: 'show_scene',
    description: `Show a LIVE animated scene that starts instantly: real physics/biology (field lines traced from the real field, induced current from the changing flux, a motor's forces and commutator, electrons drifting at I = V/R, a projectile's velocity components, blood moving through the heart's chambers as valves open and shut, a tangent becoming the derivative), one premium look, a short directed timeline with captions, then the learner drags or slides to explore. PREFER it (over animate_concept, which takes minutes, and over interactive/simulate/find_illustration) whenever the idea is one of: how an electric motor works (motor); electromagnetic induction, a magnet moving in a coil, a bar magnet's field (em_induction; show_coil false for the field alone); the magnetic field of a wire or solenoid (field_wire); current and charge flow, Ohm's law, a simple circuit (circuit); projectile motion / equations of motion (projectile); blood flow through the heart (heart); plant or animal cell structure (cell); derivative, gradient, tangent to a curve (tangent). You choose WHAT and WHEN; the engine does layout and look (never coordinates or colours). 3-6 beats, each {do, dur 0.8-3 s, caption <= 44 chars}: reveal | highlight | pulse {target}, move | set {param, to}, play (projectile flight; optional to = seconds), hold, ask (a prediction question ending in ?). Optional controls [{param}] (sliders, max 3), labels [{target, text <= 22 chars}] (max 4), drag true. Omit beats to get the kind's tuned default lesson. Errors come back as fixes: correct and call again (2 tries). Kinds:\n${kindsLine()}`,
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: KIND_IDS },
        title: { type: 'string', description: 'short title shown above the scene' },
        params: { type: 'object', description: 'the kind\'s parameters (see the list)', properties: Object.fromEntries(PARAM_NAMES.map(n => [n, { description: n }])) },
        beats: {
          type: 'array', maxItems: 6,
          items: { type: 'object', properties: { do: { type: 'string', enum: ['reveal', 'move', 'set', 'play', 'hold', 'pulse', 'highlight', 'ask'] }, target: { type: 'string' }, param: { type: 'string' }, to: { type: 'number' }, dur: { type: 'number' }, caption: { type: 'string' } }, required: ['do', 'dur', 'caption'] },
        },
        controls: { type: 'array', maxItems: 3, items: { type: 'object', properties: { param: { type: 'string' }, label: { type: 'string' } }, required: ['param'] } },
        labels: { type: 'array', maxItems: 4, items: { type: 'object', properties: { target: { type: 'string' }, text: { type: 'string' } }, required: ['target', 'text'] } },
        drag: { type: 'boolean' },
        alt: { type: 'string', description: 'one sentence describing what the scene shows (screen readers)' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
  },
  tier: 'visual', modes: ['chat'], label: 'Building a live scene',
  run: async (a, ctx: AgentCtx) => {
    if (ctx.blocks.some(b => (b as { kind: string }).kind === 'scene')) return { shown: false, note: 'A live scene is already in this answer; refer to it instead of adding another.' }
    const kind = String(a.kind ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_') as SceneKindId
    const known = (KIND_IDS as string[]).includes(kind)
    // No beats: the kind's tuned default timeline (with the model's title / params where they fit).
    const raw: Record<string, unknown> = { ...a, version: 1, kind }
    if (known && (!Array.isArray(a.beats) || a.beats.length === 0)) {
      const t = templateSpec(kind)
      Object.assign(raw, { beats: t.beats, labels: a.labels ?? t.labels, controls: a.controls ?? t.controls, drag: a.drag ?? t.drag, alt: a.alt ?? t.alt, params: { ...t.params, ...((a.params as object) ?? {}) }, title: a.title ?? t.title })
    }
    if (known && !raw.title) raw.title = KINDS[kind].info.example.title
    // Mechanical slips are fixed here, not sent back for a repair round (a production turn spent both rounds on a
    // 46-char caption and a missing dur, then ended with "Let's watch this" and no scene).
    if (Array.isArray(raw.beats)) raw.beats = (raw.beats as Record<string, unknown>[]).map(b => {
      if (!b || typeof b !== 'object') return b
      const o = { ...b }
      if (typeof o.caption === 'string' && o.caption.length > 44) {
        // The full line is kept as the beat's spoken line (narration reads it); the pill gets a cut at a word
        // boundary that never ends on a dangling little word ("reverses the", "forces in opposite").
        if (typeof o.say !== 'string' || !o.say.trim()) o.say = o.caption.slice(0, 400)
        const c = o.caption.slice(0, 45); const k = c.lastIndexOf(' ')
        let t = (k > 20 ? c.slice(0, k) : c.slice(0, 44)).replace(/[\s,;:–-]+$/, '')
        for (let i = 0; i < 3 && /\s(the|a|an|in|of|to|and|or|with|for|on|at|by|from|into|its|their|opposite|each|every|one|this|that|is|are|as|so)$/i.test(t); i++) t = t.replace(/\s+\S+$/, '').replace(/[\s,;:–-]+$/, '')
        o.caption = t
      }
      const d = Number(o.dur)
      o.dur = Number.isFinite(d) ? Math.min(8, Math.max(0.3, d)) : 2.5
      return o
    })
    const v = validateScene(raw)
    let spec: SceneSpec | undefined = v.spec
    let fallback = false
    if (!spec) {
      const n = (fails.get(ctx) ?? 0) + 1
      fails.set(ctx, n)
      ctx.trace.push(`show_scene invalid (${n}): ${v.errors.slice(0, 3).join(' | ').slice(0, 300)}`)
      // One repair round; a second invalid spec shows the kind's ready scene at once (models often stop calling after
      // a second error, leaving words about a scene that never appeared).
      if (n < 2 || !known) return { error: `The scene spec needs fixes: ${v.errors.slice(0, 8).join('; ')}. Fix exactly these and call show_scene again (if it is still invalid, the ready-made scene for the kind is shown).` }
      // Out of repair rounds: the kind's ready template, titled as the model asked.
      const t = templateSpec(kind, typeof a.title === 'string' && a.title.trim() ? { title: a.title.trim().slice(0, 90) } : {})
      const tv = validateScene(t)
      spec = tv.spec ?? t
      fallback = true
    }
    ctx.emit({ kind: 'scene', id: randomUUID().slice(0, 8), spec, alt: spec.alt })
    return {
      shown: true,
      fallback: fallback || undefined,
      title: spec.title,
      timeline: spec.beats.map(b => b.caption),
      learner_controls: [...spec.controls.map(c => c.param), ...(spec.drag && KINDS[spec.kind].info.dragParam ? [`drag ${KINDS[spec.kind].info.dragParam}`] : [])],
      warnings: v.warnings.length ? v.warnings.slice(0, 3) : undefined,
      note: 'The learner now watches this scene play its beats with these captions, then explores it. Explain the idea in 2-5 short sentences that follow the beats in order and say what to try afterwards. Describe only what the scene shows.',
    }
  },
}

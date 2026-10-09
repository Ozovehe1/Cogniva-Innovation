/**
 * Reflector (ACE generator → REFLECTOR → curator; ReasoningBank: strategies from successes, preventative lessons from
 * failures; MNL: one batch of clustered failures → shared, generalisable notes). A cheap model turns a batch of
 * anonymised signals for one target into delta ops: new specific, actionable bullets tagged by subject/topic/skill,
 * and helpful/harmful tags on bullets that were in use. It never sees learner ids, names, notes or typed answers
 * (signals are scrubbed at write time and again here), and every proposed bullet is privacy-checked by the curator.
 */
import { scrubForReflection } from './privacy'
import { pbJson } from './llm'
import type { Bullet, DeltaOp, SignalForReflection, Target } from './types'
import { TARGETS } from './types'

const TARGET_DESC: Record<Target, string> = {
  lesson: 'the LESSON WRITER (whiteboard lesson steps: narration, board text, diagrams, motion, checks)',
  ask: 'the ASK TUTOR (chat answers, hints-before-answers, practice questions, numbers in explanations)',
  diagram: 'the DIAGRAM tools (exact maths diagrams and draggable interactive figures)',
  illustration: 'ILLUSTRATION RANKING (which library picture is chosen for a topic; give hints.prefer / hints.avoid words found in picture titles)',
  manim: 'the MANIM PLANNER (short 3Blue1Brown-style animations: scene plan, labels, motion, layout)',
}

const SYSTEM = `You are the reflector of a self-improving AI tutor. You turn evidence from real lessons into a teaching playbook: short, specific, actionable rules the tutor's writers follow next time.

HARD PRIVACY RULE: the playbook is shared by all learners. Write ONLY abstract teaching rules. Never include any learner's words, answers, names, ages, schools, places, ids, or anything about one person. Do not write "this learner", "the student said", quotes of what was said, or details of one specific problem's numbers unless they are a general fact (e.g. "a 3-4-5 triangle has hypotenuse 5").

Good bullets:
- name the situation and the action: "When drawing a right triangle with side labels, put the longest label on the side opposite the right angle and make the lengths satisfy a² + b² = c²."
- prevent a whole class of mistakes, not one instance; one idea per bullet; 12-300 characters
- strategies (kind "strategy") come from successes: what to KEEP doing; preventative rules (kind "avoid") come from failures
- external evidence (confirmed reports, guard catches, verifier failures, learner outcomes) outweighs guesses; if the evidence is too thin or vague, propose nothing
- each new bullet has "check": a yes/no question a reviewer can ask of a written output, phrased so YES means the mistake IS present (for a strategy: YES means the output fails to do it)
- each new bullet has "probes": two short curriculum topics (not from any learner) where the rule matters, e.g. ["Pythagoras' theorem", "Distance between two points"]
- topic: the curriculum topic in general words ("" if the rule applies to every topic); skill: the specific skill or move (e.g. "labelling triangle sides")

Return JSON only: {"ops": [ ... ]} with at most 4 "add" ops:
{"op":"add","target":"lesson|ask|diagram|illustration|manim","kind":"avoid|strategy","subject":"","topic":"","skill":"","text":"","check":"","probes":["",""],"hints":{"prefer":[],"avoid":[]},"evidence":[signal ids]}
and optional tags on bullets that were IN USE when a failure happened, only if the bullet plausibly caused it (or helped avoid it):
{"op":"harmful","id":"<bullet id>","evidence":[...]} / {"op":"helpful","id":"<bullet id>","evidence":[...]}
Do not re-add a rule that is already in the existing playbook list; return {"ops": []} when nothing new is warranted.`

export function reflectionPrompt(target: Target, signals: SignalForReflection[], existing: Pick<Bullet, 'id' | 'text' | 'topic' | 'status'>[], used: Pick<Bullet, 'id' | 'text'>[]): string {
  const ev = signals.slice(0, 14).map(s => ({ id: s.id, source: s.source, external: s.external, weight: s.weight, subject: s.subject, topic: s.topic, skill: s.skill, evidence: scrubForReflection(s.payload) }))
  return `Target: ${TARGET_DESC[target]}.

Evidence batch (anonymised):
${JSON.stringify(ev, null, 1).slice(0, 9000)}

Existing playbook rules for this target (do not duplicate):
${existing.slice(0, 25).map(b => `- [${b.status}] ${b.text}`).join('\n') || '(none)'}

Rules that were in use in the lessons this evidence came from (tag only if clearly implicated):
${used.slice(0, 12).map(b => `- ${b.id}: ${b.text}`).join('\n') || '(none)'}

Return {"ops": [...]}.`
}

export function parseOps(raw: unknown, target: Target, signalIds: Set<number>, usedIds: Set<string>): DeltaOp[] {
  const ops = Array.isArray((raw as { ops?: unknown })?.ops) ? (raw as { ops: unknown[] }).ops : []
  const out: DeltaOp[] = []
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '')
  const evid = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter(n => signalIds.has(n)).slice(0, 12) : [])
  for (const o of ops.slice(0, 10) as Record<string, unknown>[]) {
    if (o?.op === 'add') {
      const text = str(o.text, 400)
      if (text.length < 12) continue
      const t = TARGETS.includes(o.target as Target) ? (o.target as Target) : target
      const words = (v: unknown) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').map(x => (x as string).toLowerCase().trim().slice(0, 30)).filter(Boolean).slice(0, 6) : [])
      const hints = o.hints && typeof o.hints === 'object' ? { prefer: words((o.hints as { prefer?: unknown }).prefer), avoid: words((o.hints as { avoid?: unknown }).avoid) } : undefined
      out.push({
        op: 'add', target: t, kind: o.kind === 'strategy' ? 'strategy' : 'avoid', subject: str(o.subject, 60), topic: str(o.topic, 100), skill: str(o.skill, 100), text,
        check: str(o.check, 240) || undefined, probes: Array.isArray(o.probes) ? o.probes.map(p => str(p, 80)).filter(Boolean).slice(0, 3) : [], hints, evidence: evid(o.evidence),
      })
    } else if ((o?.op === 'helpful' || o?.op === 'harmful') && typeof o.id === 'string' && usedIds.has(o.id)) {
      out.push({ op: o.op, id: o.id, evidence: evid(o.evidence) })
    }
  }
  return out.filter((o, i) => o.op !== 'add' || out.findIndex(x => x.op === 'add' && x.text === o.text) === i).slice(0, 8)
}

export async function reflect(target: Target, signals: SignalForReflection[], existing: Pick<Bullet, 'id' | 'text' | 'topic' | 'status'>[], used: Pick<Bullet, 'id' | 'text'>[], opts: { deadline?: number; trace?: string[] } = {}): Promise<{ ops: DeltaOp[]; model: string }> {
  if (!signals.length) return { ops: [], model: '' }
  const { json, model } = await pbJson(reflectionPrompt(target, signals, existing, used), { system: SYSTEM, purpose: 'light', maxTokens: 2200, deadline: opts.deadline, trace: opts.trace })
  return { ops: parseOps(json, target, new Set(signals.map(s => s.id)), new Set(used.map(b => b.id))), model }
}

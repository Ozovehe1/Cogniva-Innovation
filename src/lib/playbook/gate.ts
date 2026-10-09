/**
 * Gate (Mistake Notebook Learning, arXiv 2512.11485: commit a memory update only when batch performance does not get
 * worse). A candidate bullet goes live only if, on a small probe batch for its target, outputs written WITH it (plus the
 * live playbook) are no worse than outputs written WITHOUT it, and the relevant regression checks still pass.
 * Stages (first failure decides):
 *   privacy     the hard rule again (bullet text, check, probes, hints)
 *   lint        known-harmful teaching patterns (say the answer before the check, skip checks, text instead of
 *               visuals, timers/threat, exam boards, wrong maths conventions) → rejected outright
 *   batch       per probe topic: baseline vs candidate arm. Score = guard issues (lesson steps: correctness/steps.ts;
 *               Ask: numeric claims) + invalid output + the judge's verdict on the bullet's own check question.
 *               cand > base → fails (kept as candidate, not live); any arm unavailable → inconclusive (retried later)
 *   regression  Ask: the hint-first giveaway case with the bullet in the system prompt; illustration: the seed
 *               illustration queries' top picks with the hints applied must still match
 * Model calls run at background priority. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { privacyCheck, stringsOf } from './privacy'
import { pbJson, pbText } from './llm'
import { clearPlaybookCache, loadBullets, logEvent } from './store'
import { renderBlock } from './retrieve'
import type { Bullet, GateProbe, GateVerdict, Target } from './types'
import { guardSteps } from '../correctness/steps'
import { checkText } from '../correctness/claims'
import { validateScript, SCRIPT_SCHEMA_PROMPT } from '../lesson-schema'
import { LAYOUT_RULES, SHOW_DONT_TELL, TUTOR_VOICE } from '../lesson-ai'

/* ───────────── Lint ───────────── */

/** [pattern, why, negatable]: a negatable pattern is fine when its sentence negates it ("never state the answer before…"). */
const HARMFUL: [RegExp, string, boolean][] = [
  [/\b(say|state|tell|give|reveal|show|announce|read out)\b[^.]{0,50}\b(answer|solution|result)\b[^.]{0,50}\b(before|first|ahead of|prior to|then ask)\b/i, 'gives the answer before the learner tries', true],
  [/\b(give|tell|show)\b[^.]{0,25}\b(answers?|solutions?)\b[^.]{0,25}\b(straight away|immediately|right away|directly|up front|upfront)\b/i, 'gives answers away', true],
  [/\b(skip|remove|drop|leave out|avoid|omit)\s+(the\s+|all\s+|any\s+)?(check questions?|checks?|practice questions?|practice|retrieval)\b(?!\s+(questions?|that|which|whose|with|where|of|on|in|about))/i, 'removes checks / retrieval practice', false],
  [/\b(avoid|skip|omit|leave out|don't use|do not use|no|without|instead of)\s+(any\s+|the\s+|using\s+)?(diagrams?|pictures?|visuals?|animations?|drawings?|illustrations?)\b(?!\s+(that|which|whose|with|where|of|on|in|labels?|unless|until))/i, 'removes visuals (show, don\'t tell)', false],
  [/\b(use|write|prefer)\b[^.]{0,20}\b(long paragraphs|more text|text instead|dense text|walls? of text)\b/i, 'text over visuals', true],
  [/\b(add|use|show|start|set)\b[^.]{0,20}\b(timers?|countdowns?|time limits?)\b/i, 'adds time pressure', true],
  [/\b(tell|say to)\b[^.]{0,30}\b(they are|they're|you are|you're)\b[^.]{0,10}\b(wrong|bad|stupid|slow|lazy)\b/i, 'threatening feedback', true],
  [/\bhypotenuse\b[^.]{0,40}\b(shortest|is (side )?a\b|is (side )?b\b|label(l)?ed a\b|label(l)?ed b\b)/i, 'wrong maths convention (hypotenuse)', true],
  [/\b(unequal|different)\b[^.]{0,15}\b(axis|axes|units|scales?)\b[^.]{0,30}\bcircles?\b/i, 'draws circles on unequal axes', true],
  [/\b(WAEC|NECO|JAMB|GCSE|IGCSE|SAT|A-level)\b/, 'exam-board reference (global audience)', false],
  [/\b(reuse|share|copy)\b[^.]{0,30}\b(another|other|previous) (learner|student)/i, 'shares content across learners', true],
]
const NEGATION = /\b(never|don't|do not|doesn't|avoid|not|no longer|stop|instead of)\b/i

export function lintBullet(text: string): string[] {
  const out = new Set<string>()
  for (const sentence of text.split(/(?<=[.;!?])\s+/)) {
    for (const [re, why, negatable] of HARMFUL) {
      const m = re.exec(sentence)
      if (!m) continue
      if (negatable && NEGATION.test(sentence.slice(0, m.index + m[0].length))) continue
      out.add(why)
    }
  }
  return [...out]
}

/* ───────────── Probe generation ───────────── */

interface Arm { score: number; notes: string[]; ok: boolean; model?: string; output?: string }

const PROBE_LESSON = (topic: string, block: string) => `Write a short whiteboard teaching segment (8 to 14 steps, about 90 seconds) that teaches "${topic}" to a secondary-school learner. Draw the key picture, make something move, and end with ONE check question (type "check", kind "choice", with options and the answer index) about what was just taught.
${block ? `\n${block}\n` : ''}
${SCRIPT_SCHEMA_PROMPT}

${LAYOUT_RULES}
${SHOW_DONT_TELL}
Return {"steps": [...]} only.`

const PROBE_TEXT: Record<Exclude<Target, 'lesson' | 'illustration'>, (t: string) => string> = {
  ask: t => `Can you explain ${t} to me with one worked example? Keep it short.`,
  diagram: t => `As a numbered plan, describe the exact diagram or draggable interactive figure you would build to teach "${t}": every element, its label, the values used, and what the learner can drag.`,
  manim: t => `As a numbered plan, describe a 15-25 second animation that teaches "${t}": each scene, the objects and their labels, the motion, and where things sit on screen.`,
}

const JUDGE = (check: string, output: string) => `You review a tutor's output for ONE specific problem. Read the output carefully before answering; do not guess.

Output:
${output.slice(0, 7000)}

Question (YES means the problem IS present in this output): ${check}

Reply {"yes": true|false, "evidence": "the exact words or element in the output that show the problem (empty if none)", "why": "one short sentence"}.`

async function judgeOnce(check: string, output: string, deadline: number, purpose: 'light' | 'json'): Promise<{ yes: boolean | null; why: string }> {
  const { json } = await pbJson(JUDGE(check, output), { purpose, maxTokens: 400, deadline, temperature: 0 })
  const j = json as { yes?: unknown; why?: unknown; evidence?: unknown }
  return { yes: typeof j.yes === 'boolean' ? j.yes : null, why: `${String(j.why ?? '').slice(0, 120)}${j.evidence ? ` [${String(j.evidence).slice(0, 60)}]` : ''}` }
}

/**
 * The judge answers the bullet's own check question. A YES (problem present) must be confirmed by a second, different
 * model before it counts: single LLM judgements are noisy and the gate must not reject good rules on one misreading.
 */
async function judge(check: string | null, output: string, deadline: number): Promise<{ yes: boolean | null; why: string }> {
  if (!check) return { yes: null, why: 'no check question' }
  try {
    const a = await judgeOnce(check, output, deadline, 'light')
    if (a.yes !== true) return a
    const b = await judgeOnce(check, output, deadline, 'json').catch(() => ({ yes: null as boolean | null, why: 'second judge unavailable' }))
    return b.yes === true ? { yes: true, why: a.why } : { yes: false, why: `not confirmed by a second judge (${a.why})` }
  } catch (err) { return { yes: null, why: `judge unavailable: ${err instanceof Error ? err.message.slice(0, 80) : err}` } }
}

export async function runArm(target: Target, topic: string, rules: string[], check: string | null, deadline: number): Promise<Arm> {
  const block = rules.length ? renderBlock(rules, [], target) : ''
  const notes: string[] = []
  let score = 0, output = '', model = ''
  try {
    if (target === 'lesson') {
      const r = await pbJson(PROBE_LESSON(topic, block), { system: TUTOR_VOICE, purpose: 'json', maxTokens: 5000, deadline, temperature: 0.4 })
      model = r.model
      const v = validateScript(r.json, { maxSteps: 40 })
      // Invalid steps are dropped by the validator; an unusable output (most steps invalid) counts as a fault.
      if (!v.steps.length || v.steps.length < v.total / 2) { score += 2; notes.push(`invalid steps (${v.steps.length}/${v.total} valid): ${v.errors[0]?.slice(0, 80) ?? ''}`) }
      else if (!v.ok) notes.push(`${v.total - v.steps.length} step(s) dropped: ${v.errors[0]?.slice(0, 60) ?? ''}`)
      const g = guardSteps(v.steps)
      score += g.issues.length
      notes.push(...g.issues.slice(0, 4).map(i => `guard ${i.kind}: ${i.detail.slice(0, 80)}`))
      output = JSON.stringify(v.steps).slice(0, 7000)
    } else if (target !== 'illustration') {
      const { CHAT_SYSTEM } = await import('../agent/run')
      const sys = target === 'ask' ? `${CHAT_SYSTEM}\n\n(You cannot call tools in this reply: answer in text.)${block ? `\n${block}` : ''}` : `${TUTOR_VOICE}${block ? `\n\n${block}` : ''}`
      const r = await pbText(sys, PROBE_TEXT[target](topic), { purpose: target === 'ask' ? 'chat' : 'json', maxTokens: 900, deadline })
      model = r.model
      output = r.text
      const wrong = checkText(r.text).wrong
      score += wrong.length
      notes.push(...wrong.slice(0, 3).map(w => `wrong claim: ${w.source.slice(0, 60)}`))
    }
  } catch (err) {
    return { score: 0, notes: [`unavailable: ${err instanceof Error ? err.message.slice(0, 100) : err}`], ok: false }
  }
  const j = await judge(check, output, deadline)
  if (j.yes === true) { score += 1; notes.push(`judge: problem present (${j.why})`) }
  else if (j.yes === null && check) notes.push(j.why)
  return { score, notes, ok: true, model, output }
}

/* ───────────── Regression checks per target ───────────── */

async function regressionFor(b: Bullet, rules: string[], deadline: number): Promise<{ passed: number; total: number; notes: string[] }> {
  if (b.target === 'ask') {
    const { SEED_CASES } = await import('../correctness/seeds')
    const c = SEED_CASES.find(x => x.kind === 'giveaway')
    if (!c) return { passed: 0, total: 0, notes: [] }
    try {
      const block = renderBlock(rules, [], 'ask')
      const { CHAT_SYSTEM } = await import('../agent/run')
      const r = await pbText(`${CHAT_SYSTEM}\n\n(Answer in text only.)\n${block}`, String(c.input.msg), { purpose: 'chat', maxTokens: 700, deadline })
      const gave = new RegExp(String(c.input.answer), 'i').test(r.text.replace(/\*\*/g, ''))
      return { passed: gave ? 0 : 1, total: 1, notes: [gave ? 'giveaway case: GAVE THE ANSWER' : 'giveaway case: hinted'] }
    } catch { return { passed: 0, total: 0, notes: ['giveaway case unavailable'] } }
  }
  if (b.target === 'illustration') {
    const { SEED_CASES } = await import('../correctness/seeds')
    const { searchLibrary } = await import('../illustrations/search')
    const { applyIllustrationHints } = await import('./retrieve')
    let passed = 0, total = 0
    const notes: string[] = []
    for (const c of SEED_CASES.filter(x => x.kind === 'illustration')) {
      const hits = await searchLibrary(String(c.input.query), { want: 'diagram', limit: 8 })
      if (!hits.length) continue
      const top = applyIllustrationHints(hits, { prefer: b.hints.prefer ?? [], avoid: b.hints.avoid ?? [] })[0]
      total++
      const okT = c.expect.titleMatches ? new RegExp(String(c.expect.titleMatches), 'i').test(top.item.t) : true
      const okN = c.expect.notMatches ? !new RegExp(String(c.expect.notMatches), 'i').test(top.item.t) : true
      if (okT && okN) passed++; else notes.push(`${c.id}: top pick became "${top.item.t.slice(0, 50)}"`)
    }
    return { passed, total, notes }
  }
  return { passed: 0, total: 0, notes: [] }
}

/* ───────────── The gate ───────────── */

export async function gateBullet(admin: SupabaseClient, b: Bullet, opts: { deadline?: number; skipLint?: boolean; probes?: number; actor?: string; dryRun?: boolean } = {}): Promise<GateVerdict> {
  const deadline = opts.deadline ?? Date.now() + 150_000
  const at = new Date().toISOString()
  const finish = async (v: GateVerdict, status?: Bullet['status']) => {
    if (opts.dryRun) return v
    const upd: Record<string, unknown> = { gate: v, gated_at: at, gate_attempts: b.gate_attempts + 1, updated_at: at }
    if (status) upd.status = status
    if (status === 'live') upd.live_at = at
    await admin.from('playbook_bullets').update(upd).eq('id', b.id)
    await logEvent(admin, b.id, status === 'live' ? 'live' : status === 'rejected' ? 'reject' : `gate_${v.stage}${v.pass ? '_pass' : '_fail'}`, { stage: v.stage, reason: v.reason, probes: v.probes?.map(p => ({ topic: p.topic, base: p.base, cand: p.cand })) }, opts.actor)
    clearPlaybookCache()
    return v
  }

  const pv = privacyCheck(stringsOf({ t: b.text, c: b.check_q, p: b.probes, h: b.hints, s: b.subject, o: b.topic, k: b.skill }).join('\n'))
  if (!pv.ok) return finish({ pass: false, stage: 'privacy', reason: pv.problems.join('; '), at }, 'rejected')
  if (!opts.skipLint) {
    const lint = lintBullet(b.text)
    if (lint.length) return finish({ pass: false, stage: 'lint', reason: lint.join('; '), at }, 'rejected')
  }

  // The live playbook for this target is in both arms (we test the change, not the whole playbook).
  const live = (await loadBullets(admin, b.target, { scope: b.scope, fresh: true })).filter(x => x.id !== b.id).slice(0, 6).map(x => x.text)
  const topics = (b.probes.length ? b.probes : [b.topic || b.skill || 'a core school topic']).slice(0, opts.probes ?? 2)
  const probes: GateProbe[] = []
  let model: string | null = null
  if (b.target !== 'illustration') {
    for (const topic of topics) {
      if (Date.now() > deadline - 20_000) break
      const [base, cand] = await Promise.all([runArm(b.target, topic, live, b.check_q, deadline), runArm(b.target, topic, [...live, b.text], b.check_q, deadline)])
      if (!base.ok || !cand.ok) return finish({ pass: false, stage: 'inconclusive', reason: `probe "${topic}": ${[...base.notes, ...cand.notes].filter(n => /unavailable/.test(n)).join('; ').slice(0, 200)}`, probes, at, model })
      model = cand.model ?? model
      probes.push({ topic, base: base.score, cand: cand.score, baseNotes: base.notes.slice(0, 4), candNotes: cand.notes.slice(0, 4) })
    }
    if (!probes.length) return finish({ pass: false, stage: 'inconclusive', reason: 'no time left for a probe', at })
  }
  const sb = probes.reduce((s, p) => s + p.base, 0), sc = probes.reduce((s, p) => s + p.cand, 0)
  if (sc > sb) {
    // Worse on the batch: not live. A second failed gate (or a lint-free but clearly harmful rule) is rejected.
    const status: Bullet['status'] | undefined = b.gate_attempts >= 2 || sc - sb >= 2 ? 'rejected' : undefined
    return finish({ pass: false, stage: 'batch', reason: `worse with the bullet: ${sc} faults vs ${sb} without`, probes, at, model }, status)
  }
  const reg = await regressionFor(b, [...live, b.text], deadline)
  if (reg.total && reg.passed < reg.total) return finish({ pass: false, stage: 'regression', reason: reg.notes.join('; ').slice(0, 300), probes, regression: { passed: reg.passed, total: reg.total }, at, model })
  return finish({ pass: true, stage: 'batch', reason: b.target === 'illustration' ? `illustration seed picks unchanged (${reg.passed}/${reg.total})` : `no worse: ${sc} faults with vs ${sb} without${reg.total ? `; regression ${reg.passed}/${reg.total}` : ''}`, probes, regression: reg.total ? { passed: reg.passed, total: reg.total } : undefined, at, model }, 'live')
}

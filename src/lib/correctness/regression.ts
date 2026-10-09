/**
 * The regression eval group: seed cases for mistakes GeniusMap has made (seeds.ts) plus anonymised cases promoted from
 * confirmed learner reports (table regression_cases). Each case asserts one correctness property.
 * Run: POST /api/agent/eval?group=regression&student=<test profile> (Bearer AGENT_SECRET), or scripts/agent-eval.mjs.
 * `only=seed` runs just the seeds; `only=db` just the promoted reports.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CaseResult } from '../agent/eval'
import type { Step } from '../lesson-schema'
import { checkText, correctText } from './claims'
import { guardSteps } from './steps'
import { clipBlocked, clipState } from './clip'
import { recheck } from './reports'
import { SEED_CASES, type RegressionCase } from './seeds'

type Run = { pass: boolean; detail: string; model?: string | null }

async function runOne(c: RegressionCase, admin: SupabaseClient, studentId: string): Promise<Run> {
  const inp = c.input, exp = c.expect
  switch (c.kind as string) {
    case 'text': {
      const t = String(inp.text ?? '')
      const found = checkText(t).wrong
      const fixed = correctText(t)
      const wantFix = typeof exp.fixedTo === 'string' ? fixed.text.includes(exp.fixedTo) : true
      return { pass: (exp.flags === false ? found.length === 0 : found.length > 0) && wantFix, detail: `${found.length} wrong claim(s): ${found.map(f => f.source).join(' | ').slice(0, 120)} → "${fixed.text.slice(0, 120)}"` }
    }
    case 'steps': {
      const kinds = (Array.isArray(exp.issue) ? exp.issue : [exp.issue]).map(String)
      const bad = guardSteps(inp.bad as Step[], { problem: String(inp.problem ?? '') })
      const good = inp.good ? guardSteps(inp.good as Step[], { problem: String(inp.problem ?? '') }) : null
      const caught = kinds.every(k => bad.issues.some(i => i.kind === k))
      const fixedOk = exp.fixed === true ? bad.issues.filter(i => kinds.includes(i.kind)).every(i => i.fixed) : true
      const clean = good ? good.issues.filter(i => !i.fixed).length === 0 : true
      return { pass: caught && fixedOk && clean, detail: `bad → ${bad.issues.map(i => `${i.kind}${i.fixed ? '(fixed)' : ''}`).join(', ') || 'nothing caught'}; good → ${good ? good.issues.map(i => i.kind).join(', ') || 'clean' : 'n/a'}; ${bad.issues[0]?.detail.slice(0, 120) ?? ''}` }
    }
    case 'illustration': {
      const { findIllustration } = await import('../illustrations/find')
      const trace: string[] = []
      const f = await findIllustration({ topic: String(inp.query) }, admin, trace)
      if (!f) return { pass: !exp.titleMatches, detail: `nothing chosen (drawn fallback); ${trace.slice(-3).join(' · ').slice(0, 160)}` }
      const notIds = (exp.notIds as string[] | undefined) ?? []
      const okId = !notIds.includes(f.item.id)
      const okTitle = exp.titleMatches ? new RegExp(String(exp.titleMatches), 'i').test(f.item.t) : true
      const okNot = exp.notMatches ? !new RegExp(String(exp.notMatches), 'i').test(f.item.t) : true
      return { pass: okId && okTitle && okNot, detail: `chose "${f.item.t}" (${f.item.id}); ${trace.filter(t => t.startsWith('guard')).slice(-2).join(' · ').slice(0, 160)}` }
    }
    case 'interactive': {
      const { validateInteractive, interactiveSvg } = await import('../agent/interactive')
      const v = validateInteractive(inp.spec)
      if (!v.spec) return { pass: false, detail: `spec invalid: ${v.errors.join('; ').slice(0, 120)}` }
      const svg = interactiveSvg(v.spec)
      const e = /<ellipse[^>]*rx="([\d.]+)"[^>]*ry="([\d.]+)"/.exec(svg)
      return { pass: !!e && Math.abs(Number(e[1]) - Number(e[2])) < 1.5, detail: e ? `rx ${e[1]} ry ${e[2]}` : 'no circle drawn' }
    }
    case 'diagram': {
      const { renderMathDiagram } = await import('../agent/math-diagram')
      const d = await renderMathDiagram(inp.library as never, String(inp.substance), { timeoutMs: 8_000 })
      return { pass: d.unmet === Number(exp.unmet ?? 0) && /^<svg[\s>]/.test(d.svg), detail: `unmet ${d.unmet}, ${d.svg.length} chars, ${d.ms} ms` }
    }
    case 'giveaway': {
      const { runAgent, CHAT_SYSTEM, MAX_WRITES } = await import('../agent/run')
      const ctx = {
        mode: 'chat' as const, studentId, admin, userDb: null, runId: `reg_${Date.now().toString(36)}`, writes: 0, maxWrites: MAX_WRITES, restricted: true, practiceMode: false,
        emit: () => {}, blocks: [], trace: [] as string[], searchUrls: new Set<string>(), computeCalls: 0, sources: [],
        limits: { animations: 0, miniLessons: 0, practiceSets: 3, webSearches: 6, pythonRuns: 6 },
      }
      const r = await runAgent({ ctx, system: CHAT_SYSTEM, messages: [{ role: 'user', content: String(inp.msg) }], deadline: Date.now() + 60_000 })
      const gave = new RegExp(String(inp.answer), 'i').test(r.text.replace(/\*\*/g, ''))
      return { pass: !gave, detail: `${gave ? 'GAVE ANSWER' : 'hinted'}: ${r.text.replace(/\s+/g, ' ').slice(0, 140)}`, model: r.model }
    }
    case 'clip': {
      const job = { status: String(inp.status ?? 'done'), verdict: inp.verdict }
      const state = clipState(job)
      return { pass: exp.blocked ? clipBlocked(job.verdict) && state === 'failed' : state === 'done', detail: `verdict ${JSON.stringify(inp.verdict).slice(0, 100)} → learner sees "${state}"` }
    }
    case 'artefact': {
      const r = recheck((inp.artefact ?? {}) as Record<string, unknown>, String(inp.problem ?? ''))
      return { pass: exp.guardFlags === false ? !r.flagged : r.flagged, detail: r.flagged ? r.issues.slice(0, 3).join(' | ').slice(0, 200) : 'guard does not catch this yet (add a check, then this case passes)' }
    }
  }
  return { pass: false, detail: `unknown case kind ${c.kind}` }
}

export async function loadDbCases(admin: SupabaseClient): Promise<RegressionCase[]> {
  const { data } = await admin.from('regression_cases').select('id, kind, title, input, expect, source').eq('active', true).order('created_at').limit(300)
  return ((data ?? []) as RegressionCase[]).map(c => ({ ...c, id: `report-${c.id.slice(0, 8)}` }))
}

export async function regressionCases(admin: SupabaseClient, studentId: string, only?: string[]): Promise<CaseResult[]> {
  const cases = [
    ...(only?.includes('db') ? [] : SEED_CASES.filter(c => !only || only.includes('seed') || only.includes(c.id))),
    ...(only && !only.includes('db') ? [] : await loadDbCases(admin)),
  ]
  const out: CaseResult[] = []
  for (const c of cases) {
    const t0 = Date.now()
    try {
      const r = await runOne(c, admin, studentId)
      out.push({ id: c.id, group: 'regression', pass: r.pass, detail: `${c.title} — ${r.detail}`, model: r.model ?? null, ms: Date.now() - t0 })
    } catch (err) {
      out.push({ id: c.id, group: 'regression', pass: false, detail: `${c.title} — error: ${err instanceof Error ? err.message.slice(0, 160) : err}`, ms: Date.now() - t0 })
    }
  }
  return out
}

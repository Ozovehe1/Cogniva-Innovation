import { createAdminClient } from '@/lib/supabase/admin'
import { agentSecretOk } from '@/lib/agent/secret'
import { regressionCases } from '@/lib/correctness/regression'
import { poolCases } from '@/lib/agent/pool-eval'
import { assessmentCases } from '@/lib/assessment/eval'
import { playbookCases } from '@/lib/playbook/eval'
import { turnCase, routingCases, lessonCases, giveawayCases, injectionCases, staticAsyncCases, staticCases, summarise, toolCases, visualCases, type CaseResult } from '@/lib/agent/eval'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

/**
 * POST /api/agent/eval?group=static|tools|routing|lesson|giveaway|injection|visual|regression|assessment|playbook&student=<profile id>   (Bearer AGENT_SECRET)
 * Runs the agent eval set on production (real models, budgets and services). Writes only to the given test student.
 */
export async function POST(request: Request) {
  if (!agentSecretOk(request)) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const url = new URL(request.url)
  const group = url.searchParams.get('group') ?? 'static'
  const student = url.searchParams.get('student') ?? ''
  if (group !== 'static' && group !== 'pool' && !/^[0-9a-f-]{36}$/i.test(student)) return Response.json({ error: 'student (a test profile id) is required' }, { status: 400 })
  const admin = createAdminClient()
  const only = url.searchParams.get('only')?.split(',')
  let results: CaseResult[] = []
  if (group === 'static') results = [...staticCases(), ...(await staticAsyncCases())]
  else if (group === 'tools') results = await toolCases(admin, student, only)
  else if (group === 'turn') results = await turnCase(admin, student, url.searchParams.get('msg') ?? '')
  else if (group === 'routing') results = await routingCases(admin, student, only)
  else if (group === 'lesson') results = await lessonCases(admin, student, only)
  else if (group === 'giveaway') results = await giveawayCases(admin, student)
  else if (group === 'injection') results = await injectionCases(admin, student)
  else if (group === 'visual') results = await visualCases(admin, student)
  else if (group === 'regression') results = await regressionCases(admin, student, only)
  else if (group === 'pool') results = await poolCases()
  else if (group === 'assessment') results = await assessmentCases(admin, student, only)
  else if (group === 'playbook') results = await playbookCases(admin, student, only)
  else return Response.json({ error: 'unknown group' }, { status: 400 })
  return Response.json({ group, summary: summarise(results), results, groq: !!process.env.GROQ_API_KEY })
}

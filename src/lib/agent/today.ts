/**
 * Data for the Home "Today" card: the plan the Learning Director wrote, proposals waiting for a tap, and
 * recent changes that can still be undone. SQL only: opening Home never calls a model. When no plan exists
 * yet today, a rule-based one is written (and the next Director turn replaces it).
 */
import { createAdminClient } from '../supabase/admin'
import type { TodayData } from '@/components/agent/today-card'
import type { PlanItem } from './types'
import { todayWAT, UNDO_WINDOW_MS } from './actions'
import { rulePlan } from './director'
import { dueReviews } from './learner-model'

export async function loadToday(studentId: string): Promise<TodayData | null> {
  let admin
  try { admin = createAdminClient() } catch { return null }
  const day = todayWAT()
  let { data: plan } = await admin.from('daily_plans').select('items, note, light, source').eq('student_id', studentId).eq('plan_date', day).maybeSingle()
  if (!plan) {
    const r = await rulePlan(admin, studentId, `home_${day}`)
    plan = { items: r.items, note: r.note, light: false, source: 'rule' }
  }
  const since = new Date(Date.now() - UNDO_WINDOW_MS).toISOString()
  const [{ data: props }, { data: recent }, due] = await Promise.all([
    admin.from('agent_actions').select('id, summary, args, created_at').eq('student_id', studentId).eq('status', 'proposed').gt('created_at', new Date(Date.now() - 7 * 86400_000).toISOString()).order('created_at', { ascending: false }).limit(3),
    admin.from('agent_actions').select('id, summary, tool, run_id, created_at, decided_at').eq('student_id', studentId).eq('status', 'done').not('undo', 'is', null).or(`created_at.gt.${since},decided_at.gt.${since}`).order('created_at', { ascending: false }).limit(6),
    dueReviews(admin, studentId, new Date(Date.now() + 6 * 3600_000), 20),
  ])
  return {
    items: (plan.items ?? []) as PlanItem[], note: plan.note ?? null, light: !!plan.light, source: plan.source ?? 'rule', due: due.length,
    proposals: (props ?? []).map(p => ({ id: p.id, title: p.summary ?? 'A suggestion from your tutor', detail: String((p.args as { reason?: string })?.reason ?? '') })),
    recent: (recent ?? []).filter(r => !(r.tool === 'set_today_plan' && String(r.run_id ?? '').startsWith('home_'))).map(r => ({ id: r.id, summary: r.summary ?? r.tool, at: r.decided_at ?? r.created_at })),
  }
}

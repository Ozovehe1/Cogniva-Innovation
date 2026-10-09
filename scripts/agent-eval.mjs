#!/usr/bin/env node
/**
 * Runs the agent eval set against a deployment, group by group, and prints the scores.
 *   AGENT_SECRET=... node scripts/agent-eval.mjs [baseUrl] [studentProfileId]
 * Groups: static (no model), tools, routing, giveaway, injection, visual. Writes only to the test student.
 */
const base = (process.argv[2] || 'https://cogniva-innovation.vercel.app').replace(/\/$/, '')
const student = process.argv[3] || '3c15fbeb-56b3-4699-b7c5-1eff51a5cadd'
const secret = process.env.AGENT_SECRET
if (!secret) { console.error('Set AGENT_SECRET'); process.exit(1) }
const all = []
for (const group of ['static', 'tools', 'routing', 'giveaway', 'injection', 'visual']) {
  const r = await fetch(`${base}/api/agent/eval?group=${group}&student=${student}`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` } })
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
  if (!j.results) { console.log(group, 'ERROR', j.error); continue }
  console.log(`\n== ${group}: ${j.summary.passed}/${j.summary.total}`)
  for (const c of j.results) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(34)} ${(c.model ?? '').padEnd(22)} ${String(c.ms ?? '').padStart(6)}  ${c.detail.slice(0, 140)}`)
  all.push(...j.results)
  if (group !== 'static') await new Promise(r => setTimeout(r, 45_000)) // let the per-minute token windows refill
}
const pass = all.filter(c => c.pass).length
console.log(`\nTOTAL ${pass}/${all.length}`)

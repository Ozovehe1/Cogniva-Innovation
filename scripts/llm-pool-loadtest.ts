/**
 * Load test for the LLM pool with MOCKED providers that enforce the real free-tier limits (Groq: 30 RPM / 1K RPD /
 * 8K TPM / 200K TPD per model per org; Gemini: flash 5 RPM / 20 RPD, flash-lite 15 RPM / 500 RPD, per project).
 * Virtual clock: N concurrent learners for M minutes; each learner-minute makes live, Ask and background calls.
 * Also injects faults: one Gemini key returns 500 on 10 % of calls, gemini-3.8-flash is overloaded (503 high demand,
 * every key) for 2 minutes, qwen is slow (first token > timeout) on 20 % of calls, and a whole Groq org is
 * rate-limited for 3 minutes mid-run.
 *
 * Run:  node scripts/llm-pool-loadtest.mjs [learners=20] [minutes=30] [mode=after|before]
 * (the .mjs wrapper loads this file through jiti). No network, no database.
 */
import * as P from '../src/lib/agent/pool'

type Mode = 'after' | 'before'
interface Result {
  mode: Mode; learners: number; minutes: number
  calls: Record<P.Priority, { total: number; ok: number; busy: number; deferred: number; trimmed: number; lighter: number }>
  reserveMinHeld: number; reserveSamples: number; reserveBrokenTicks: number
  bgOnReserved: number
  providerRejects: number
  failovers: number
  tokens: { estimated: number; billed: number; cached: number; trimmedSaved: number }
  slotsUsed: Record<string, number>
}

export async function simulate(learners: number, minutes: number, mode: Mode, seed = 7, startUtc = '2026-10-09T13:00:00Z'): Promise<Result> {
  // Inventory: after = 2 Groq orgs + 5 Gemini projects; before = what v1 read (1 Groq key, Gemini keys 1-4).
  for (const k of Object.keys(process.env)) if (/^(GROQ|GEMINI)_API_KEY/.test(k)) delete process.env[k]
  process.env.GROQ_API_KEY = 'mock-groq-1'
  if (mode === 'after') process.env.GROQ_API_KEY_2 = 'mock-groq-2'
  process.env.GEMINI_API_KEY = 'mock-gem-1'
  for (const n of mode === 'after' ? [2, 3, 4, 5] : [2, 3, 4]) process.env[`GEMINI_API_KEY_${n}`] = `mock-gem-${n}`
  // v1 had no learner reserve and no background pacing.
  process.env.POOL_RESERVE_SLOTS = mode === 'after' ? '2' : '0.0001'
  process.env.POOL_BG_SHARE = mode === 'after' ? '0.6' : '1'
  process.env.POOL_BG_HEADSTART = mode === 'after' ? '0.2' : '1'
  P.resetInventory()

  let t = Date.parse(startUtc)
  P.setPoolClock(() => t)
  const store = new P.MemoryStore(() => t)
  P.setPoolStore(store)
  const slots = P.inventory()

  // Provider-side truth (independent of the pool's own accounting).
  const prov = new Map<string, { m: string; mReq: number; mTok: number; dReq: number; dTok: number }>()
  const orgDown = { until: 0 }
  const overload = { from: Date.parse(startUtc) + (minutes * 60_000) / 3 }
  let rnd = seed
  const rand = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648 }

  const res: Result = {
    mode, learners, minutes,
    calls: { live: z(), ask: z(), background: z() },
    reserveMinHeld: 99, reserveSamples: 0, reserveBrokenTicks: 0, bgOnReserved: 0, providerRejects: 0, failovers: 0,
    tokens: { estimated: 0, billed: 0, cached: 0, trimmedSaved: 0 }, slotsUsed: {},
  }
  function z() { return { total: 0, ok: 0, busy: 0, deferred: 0, trimmed: 0, lighter: 0 } }

  const attempt = (est: number) => async (s: P.SlotDef, o: { timeoutMs: number; trimmed: boolean }) => {
    const key = s.id
    const minute = new Date(t).toISOString().slice(0, 16)
    let p = prov.get(key)
    if (!p) { p = { m: minute, mReq: 0, mTok: 0, dReq: 0, dTok: 0 }; prov.set(key, p) }
    if (p.m !== minute) { p.m = minute; p.mReq = 0; p.mTok = 0 }
    if (s.provider === 'groq' && s.key === 1 && t < orgDown.until) { res.providerRejects++; throw new Error('Groq 429: rate limit reached for organization (try again in 20s)') }
    const L = s.limits
    const input = Math.round(est * 0.72), output = Math.round(est * 0.18)
    const cached = s.provider === 'groq' && /gpt-oss/.test(s.model) ? Math.round(input * 0.35) : 0
    const counted = input + output - cached
    if (p.mReq + 1 > L.rpm || p.mTok + counted > L.tpm || p.dReq + 1 > L.rpd || p.dTok + counted > L.tpd) { res.providerRejects++; throw new Error(`${s.provider} 429 RESOURCE_EXHAUSTED quota (try again in 12s)`) }
    if (s.provider === 'gemini' && s.key === 3 && rand() < 0.1) throw new Error('500 INTERNAL: an internal error has occurred')
    // Google-side "high demand" on one model (all keys) for 2 minutes, a third of the way in.
    if (s.model === 'gemini-3.8-flash' && t >= overload.from && t < overload.from + 120_000 && rand() < 0.7) throw new Error('503 UNAVAILABLE: This model is currently experiencing high demand.')
    if (s.model.includes('qwen') && rand() < 0.2) throw new Error(`timed out waiting ${Math.round(o.timeoutMs / 1000)} s for the first token`)
    p.mReq++; p.mTok += counted; p.dReq++; p.dTok += counted
    res.tokens.billed += input + output; res.tokens.cached += cached
    res.slotsUsed[key] = (res.slotsUsed[key] ?? 0) + 1
    return { value: s.id, usage: { input, output, cached } }
  }

  async function call(priority: P.Priority, purpose: P.PoolPurpose, est: number, learner: string, opts: { trim?: boolean; providers?: P.Provider[] } = {}) {
    const c = res.calls[priority]; c.total++
    res.tokens.estimated += est
    const trimmedEst = opts.trim ? Math.round(est * 0.6) : undefined
    try {
      const reserved = P.reservedSlots(slots, await store.state(slots.map(s => ({ id: s.id, day: P.quotaDay(s.resetTz) }))), t, P.laneOf(purpose))
      const r = await P.runOnPool({ purpose, priority, learnerId: learner, estTokens: est, trimmedEstTokens: trimmedEst, providers: opts.providers }, attempt(est))
      c.ok++
      if (r.trimmed) { c.trimmed++; res.tokens.trimmedSaved += est - (trimmedEst ?? est) }
      if (r.lighter && P.quality(purpose, r.slot) < 0.8) c.lighter++
      if (priority === 'background' && reserved.includes(r.slot.id)) res.bgOnReserved++
    } catch (err) {
      if (err instanceof P.PoolDeferredError) c.deferred++
      else if (err instanceof P.PoolBusyError) c.busy++
      else throw err
    }
  }

  // Workload per active learner per minute (from Ask/lesson telemetry, rounded up):
  //   live:  0.3 tutor steps / lesson openings (Gemini 'lesson', ~3.5K tokens)
  //   ask:   0.6 chat model steps (~3K tokens with tools; 0.6 of a message × ~2 steps / 2 learners in Ask at once)
  //          + 0.5 next-beat drafts while in a lesson (Gemini 'lesson', ~4K)
  //   background: 0.6 drafting-ahead beats (~4K) + 0.08 Director turns (~3K) + 0.05 visual critiques (~2K)
  const perMin: { priority: P.Priority; purpose: P.PoolPurpose; est: number; rate: number; trim?: boolean; providers?: P.Provider[] }[] = [
    { priority: 'live', purpose: 'lesson', est: 3500, rate: 0.3, providers: ['gemini'] },
    { priority: 'ask', purpose: 'chat', est: 3000, rate: 0.6, trim: true },
    { priority: 'ask', purpose: 'lesson', est: 4000, rate: 0.5, providers: ['gemini'] },
    { priority: 'background', purpose: 'lesson', est: 4000, rate: 0.6, providers: ['gemini'] },
    { priority: 'background', purpose: 'director', est: 3000, rate: 0.08 },
    { priority: 'background', purpose: 'json', est: 2000, rate: 0.05 },
  ]
  const TICK = 5_000
  for (let tick = 0; tick < (minutes * 60_000) / TICK; tick++) {
    if (tick === Math.round((minutes * 60_000) / TICK / 2)) orgDown.until = t + 3 * 60_000 // Groq org 1 throttled mid-run
    const batch: Promise<void>[] = []
    for (let l = 0; l < learners; l++) {
      for (const w of perMin) {
        if (rand() < w.rate * (TICK / 60_000)) batch.push(call(w.priority, w.purpose, w.est, `learner-${l}`, { trim: w.trim, providers: w.providers }))
      }
    }
    await Promise.all(batch)
    // Reserve check: chat-capable healthy slots with headroom, after this tick's traffic.
    const st = await store.state(slots.map(s => ({ id: s.id, day: P.quotaDay(s.resetTz) })))
    const held = Math.min(P.reservedSlots(slots, st, t, 'chat').length, P.reservedSlots(slots, st, t, 'lesson').length)
    res.reserveSamples++
    res.reserveMinHeld = Math.min(res.reserveMinHeld, held)
    if (mode === 'after' && held < 2) res.reserveBrokenTicks++
    t += TICK
  }
  res.failovers = (await store.counters())['failover'] ?? 0
  return res
}

export async function main(argv: string[]) {
  const learners = Number(argv[0] ?? 20), minutes = Number(argv[1] ?? 30), mode = (argv[2] ?? 'after') as Mode
  const r = await simulate(learners, minutes, mode)
  console.log(JSON.stringify(r))
}

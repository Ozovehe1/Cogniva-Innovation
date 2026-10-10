/**
 * The LLM pool: every free API key × model is one slot with its own real free-tier limits, and every caller in the
 * app (Ask chat, the Learning Director, lesson drafting, diagnostics, visuals, vision, web/python helpers) draws
 * from the same pool. Server only.
 *
 * - Keys are discovered from the environment on every cold start: GEMINI_API_KEY, GEMINI_API_KEY_2…n,
 *   GROQ_API_KEY, GROQ_API_KEY_2…n (any n, gaps allowed, duplicate values ignored). A key added in Vercel is in
 *   the pool on the next deploy with no code change.
 * - Budget (RPM / RPD / TPM / TPD per slot) and health (429 cooldowns, circuit breaker, rolling latency and error
 *   rate) live in Postgres (agent_budget_take / agent_budget_adjust / llm_slot_report / llm_pool_state), shared by
 *   every server instance. When the database is unreachable the pool falls back to in-instance accounting.
 * - Routing: score = quality(purpose, model) × headroom × health × speed. Priority classes: live (a learner is
 *   waiting inside a lesson / onboarding) > ask (the Ask tab) > background (drafting ahead, Director, critiques,
 *   evals). The RESERVE healthiest chat-capable slots are kept for learner traffic: background never uses them,
 *   and background is paced against each provider's daily reset (it may only spend the share of the day that
 *   has elapsed).
 * - Degradation ladder for learner traffic: preferred models → trimmed context / max_tokens → lighter models →
 *   PoolBusyError with retryAfterMs (the UI shows a friendly retry), never a dead app. Background is shed first
 *   (PoolDeferredError with retryAfterMs; drafting pauses and resumes).
 * - HARD RULE: nothing here caches or shares generated content. Provider-side prompt caching only ever sees the
 *   static instruction prefix; per-learner counters are keyed by learner id.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export type Priority = 'live' | 'ask' | 'background'
export type Provider = 'groq' | 'gemini'
export type PoolPurpose = 'chat' | 'director' | 'light' | 'json' | 'lesson' | 'vision' | 'builtin'

export interface Limits { rpm: number; rpd: number; tpm: number; tpd: number }
export interface SlotDef {
  id: string
  provider: Provider
  /** 1-based key number (GROQ_API_KEY = 1, GROQ_API_KEY_2 = 2 …). */
  key: number
  keyEnv: string
  apiKey: string
  model: string
  limits: Limits
  /** Which clock the provider's daily quota resets on. */
  resetTz: 'UTC' | 'America/Los_Angeles'
}

/* ───────────── Request context (priority + learner) carried through deep call chains ───────────── */

export interface LlmContext { priority?: Priority; learnerId?: string | null; label?: string }
const als = new AsyncLocalStorage<LlmContext>()
/** Run `fn` with a priority / learner attached to every pool call inside it (lesson drafting, Director, routes). */
export function withLlmContext<T>(ctx: LlmContext, fn: () => T): T {
  return als.run({ ...(als.getStore() ?? {}), ...ctx }, fn)
}
export function llmContext(): LlmContext { return als.getStore() ?? {} }

/* ───────────── Inventory ───────────── */

const num = (v: string | undefined, d: number) => { const n = Number((v ?? '').trim()); return Number.isFinite(n) && n > 0 ? n : d }

/** Groq free plan, per model per organisation (console.groq.com/docs/rate-limits, checked 2026-10-09). */
export const GROQ_FREE: Limits = { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200_000 }
/**
 * Gemini free tier, per model per Google Cloud project (AI Studio rate-limit page, read 2026-10-07; Google's docs
 * no longer publish the numbers). Flash: 5 RPM / 20 RPD; flash-lite: 15 RPM / 500 RPD; 250K input TPM.
 * Gemini quotas are per PROJECT, not per key: two keys from one project share one slot's quota.
 */
export function geminiLimits(model: string): Limits {
  return /lite/.test(model) ? { rpm: 15, rpd: 500, tpm: 250_000, tpd: 1e9 } : { rpm: 5, rpd: 20, tpm: 250_000, tpd: 1e9 }
}

const envModel = (k: string, d: string) => (process.env[k] ?? '').trim() || d
export function groqModels() {
  return {
    qwen: envModel('GROQ_MODEL_CHAT', 'qwen/qwen3.8-27b'),
    big: envModel('GROQ_MODEL_DIRECTOR', 'openai/gpt-oss-120b'),
    small: envModel('GROQ_MODEL_LIGHT', 'openai/gpt-oss-20b'),
  }
}
/** Gemini text models with a free quota (verified 2026-10-07; 2.0-flash and 2.5-flash-lite are retired). */
export const GEMINI_TEXT_MODELS = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'] as const

/** API keys for a provider prefix in key-number order: PREFIX, PREFIX_2, PREFIX_3 … (any number, gaps allowed, duplicates dropped). */
export function discoverKeys(prefix: string, env: Record<string, string | undefined> = process.env): { n: number; env: string; value: string }[] {
  const out: { n: number; env: string; value: string }[] = []
  const seen = new Set<string>()
  const re = new RegExp(`^${prefix}(?:_(\\d+))?$`)
  for (const [k, v] of Object.entries(env)) {
    const m = re.exec(k)
    const value = (v ?? '').trim()
    if (!m || !value) continue
    out.push({ n: m[1] ? Number(m[1]) : 1, env: k, value })
  }
  out.sort((a, b) => a.n - b.n)
  return out.filter(k => (seen.has(k.value) ? false : (seen.add(k.value), true)))
}

let inventoryCache: SlotDef[] | null = null
/** Every slot in the pool (cached per instance; env is fixed for a deployment). */
export function inventory(env: Record<string, string | undefined> = process.env): SlotDef[] {
  if (inventoryCache && env === process.env) return inventoryCache
  const slots: SlotDef[] = []
  const gm = groqModels()
  const groqOverride: Partial<Limits> = { rpm: num(env.GROQ_RPM, GROQ_FREE.rpm), rpd: num(env.GROQ_RPD, GROQ_FREE.rpd), tpm: num(env.GROQ_TPM, GROQ_FREE.tpm), tpd: num(env.GROQ_TPD, GROQ_FREE.tpd) }
  for (const k of discoverKeys('GROQ_API_KEY', env)) {
    for (const model of [gm.qwen, gm.big, gm.small]) {
      // Key 1 keeps the v1 slot id (the bare model name) so today's counters carry over.
      slots.push({ id: k.n === 1 ? model : `groq${k.n}:${model}`, provider: 'groq', key: k.n, keyEnv: k.env, apiKey: k.value, model, limits: { ...GROQ_FREE, ...groqOverride }, resetTz: 'UTC' })
    }
  }
  for (const k of discoverKeys('GEMINI_API_KEY', env)) {
    for (const model of GEMINI_TEXT_MODELS) {
      // gemini-2.5-flash answers 404 "no longer available" on every project created after its retirement (keys 2+, seen 2026-10-09).
      if (model === 'gemini-2.5-flash' && k.n > 1 && env.GEMINI_25_ALL_KEYS !== '1') continue
      slots.push({ id: `gem${k.n}:${model}`, provider: 'gemini', key: k.n, keyEnv: k.env, apiKey: k.value, model, limits: geminiLimits(model), resetTz: 'America/Los_Angeles' })
    }
  }
  if (env === process.env) inventoryCache = slots
  return slots
}
/** For tests: forget the cached inventory (after changing env). */
export function resetInventory() { inventoryCache = null }

/* ───────────── Model quality / capability per purpose ───────────── */

/** 0..1, how well a model does this job (from the evals and lesson tests run on 2026-10-07/08). 0 = never. */
export function quality(purpose: PoolPurpose, s: Pick<SlotDef, 'provider' | 'model'>): number {
  const m = s.model
  const lite = /lite/.test(m)
  const gemFlash = s.provider === 'gemini' && !lite
  const gm = groqModels()
  switch (purpose) {
    case 'chat': // tool-calling tutor turns
      return m === gm.qwen ? 1 : m === gm.big ? 0.95 : m === gm.small ? 0.6 : gemFlash ? 0.8 : 0.65
    case 'director':
      return m === gm.big ? 1 : m === gm.qwen ? 0.9 : m === gm.small ? 0.6 : gemFlash ? 0.8 : 0.6
    case 'light': // classification, summaries, guards, titles, short JSON: small and fast first
      return m === gm.small ? 1 : lite ? 0.9 : m === gm.qwen ? 0.75 : m === gm.big ? 0.7 : 0.5
    case 'json': // visual sub-generation (big JSON)
      return m === gm.big ? 1 : m === gm.qwen ? 0.85 : gemFlash ? 0.85 : lite ? 0.7 : 0.5
    case 'lesson': // long structured lesson content (Gemini only: long outputs, LaTeX-heavy JSON)
      return s.provider !== 'gemini' ? 0 : /3\.8/.test(m) ? 1 : lite ? 0.75 : 0.9
    case 'vision':
      return s.provider !== 'gemini' ? 0 : lite ? 1 : 0.9
    case 'builtin': // Groq server-side browser_search / code_interpreter (gpt-oss only)
      return s.provider === 'groq' && /gpt-oss/.test(m) ? (m === gm.small ? 1 : 0.9) : 0
  }
}
/** The quality a purpose prefers before the pool falls back to lighter models. */
const PREFERRED: Record<PoolPurpose, number> = { chat: 0.8, director: 0.8, light: 0, json: 0.8, lesson: 0, vision: 0, builtin: 0 }

/** Typical response latency per model family (ms), used until real measurements exist. */
function priorLatency(s: SlotDef) { return s.provider === 'groq' ? (/20b/.test(s.model) ? 1500 : 3000) : /lite/.test(s.model) ? 4000 : 9000 }

/* ───────────── Shared state ───────────── */

export interface SlotState {
  m_req: number; m_tok: number; d_req: number; d_tok: number
  cooldown_until: string | null; breaker_until: string | null; consecutive_fail: number
  lat_ewma_ms: number | null; err_ewma: number
  ok_count: number; err_count: number; quota_count: number
  tokens_in: number; tokens_out: number; tokens_cached: number
  last_error: string | null; last_ok_at: string | null
}
export type ReportKind = 'ok' | 'quota' | 'missing' | 'overload' | 'error' | 'timeout'
export interface PoolStore {
  state(slots: { id: string; day: string }[]): Promise<Map<string, SlotState>>
  take(a: { slot: string; tokens: number; limits: Limits; day: string; dayCap: number; user?: string | null; userTpm?: number; userTpd?: number }): Promise<boolean>
  adjust(slot: string, delta: number, day: string, user?: string | null, reqDelta?: number): Promise<void>
  report(slot: string, kind: ReportKind, r: { latencyMs?: number; cooldownMs?: number; input?: number; output?: number; cached?: number; error?: string }): Promise<void>
  count(key: string, n?: number): Promise<void>
  counters?(): Promise<Record<string, number>>
}

const blank = (): SlotState => ({ m_req: 0, m_tok: 0, d_req: 0, d_tok: 0, cooldown_until: null, breaker_until: null, consecutive_fail: 0, lat_ewma_ms: null, err_ewma: 0, ok_count: 0, err_count: 0, quota_count: 0, tokens_in: 0, tokens_out: 0, tokens_cached: 0, last_error: null, last_ok_at: null })

/** In-memory store: the fallback when Postgres is unreachable, and the store the load test runs on. */
export class MemoryStore implements PoolStore {
  private usage = new Map<string, { req: number; tok: number }>()
  private health = new Map<string, SlotState>()
  private ctr = new Map<string, number>()
  constructor(private now: () => number = Date.now) {}
  private minute() { return 'm:' + new Date(this.now()).toISOString().slice(0, 16) }
  private utcDay() { return new Date(this.now()).toISOString().slice(0, 10) }
  private u(k: string) { let v = this.usage.get(k); if (!v) { v = { req: 0, tok: 0 }; this.usage.set(k, v) } return v }
  private h(slot: string) { let v = this.health.get(slot); if (!v) { v = blank(); this.health.set(slot, v) } return v }
  async state(slots: { id: string; day: string }[]) {
    const out = new Map<string, SlotState>()
    for (const s of slots) {
      const m = this.u(`${s.id}|${this.minute()}`), d = this.u(`${s.id}|d:${s.day}`)
      out.set(s.id, { ...this.h(s.id), m_req: m.req, m_tok: m.tok, d_req: d.req, d_tok: d.tok })
    }
    return out
  }
  async take(a: Parameters<PoolStore['take']>[0]) {
    const m = this.u(`${a.slot}|${this.minute()}`), d = this.u(`${a.slot}|d:${a.day}`)
    const cap = Math.min(1, Math.max(0, a.dayCap))
    if (m.req + 1 > a.limits.rpm || m.tok + a.tokens > a.limits.tpm || d.req + 1 > Math.floor(a.limits.rpd * cap) || d.tok + a.tokens > Math.floor(a.limits.tpd * cap)) return false
    if (a.user) {
      const um = this.u(`u:${a.user}|${this.minute()}`), ud = this.u(`u:${a.user}|d:${this.utcDay()}`)
      if ((a.userTpm && um.tok + a.tokens > a.userTpm) || (a.userTpd && ud.tok + a.tokens > a.userTpd)) return false
      um.req++; um.tok += a.tokens; ud.req++; ud.tok += a.tokens
    }
    m.req++; m.tok += a.tokens; d.req++; d.tok += a.tokens
    return true
  }
  async adjust(slot: string, delta: number, day: string, user?: string | null, reqDelta = 0) {
    for (const k of [`${slot}|${this.minute()}`, `${slot}|d:${day}`, ...(user ? [`u:${user}|${this.minute()}`, `u:${user}|d:${this.utcDay()}`] : [])]) { const v = this.u(k); v.tok = Math.max(0, v.tok + delta); v.req = Math.max(0, v.req + reqDelta) }
  }
  async report(slot: string, kind: ReportKind, r: Parameters<PoolStore['report']>[2]) {
    const h = this.h(slot), now = this.now()
    if (kind === 'ok') {
      h.consecutive_fail = 0; h.breaker_until = null; h.ok_count++
      h.lat_ewma_ms = h.lat_ewma_ms == null ? (r.latencyMs ?? null) : h.lat_ewma_ms * 0.8 + (r.latencyMs ?? h.lat_ewma_ms) * 0.2
      h.err_ewma *= 0.9; h.tokens_in += r.input ?? 0; h.tokens_out += r.output ?? 0; h.tokens_cached += r.cached ?? 0; h.last_ok_at = new Date(now).toISOString()
    } else if (kind === 'quota' || kind === 'missing' || kind === 'overload') {
      if (kind === 'quota') h.quota_count++
      const until = now + (r.cooldownMs ?? 30_000)
      h.cooldown_until = new Date(Math.max(until, h.cooldown_until ? Date.parse(h.cooldown_until) : 0)).toISOString(); h.last_error = r.error ?? null
    } else {
      h.consecutive_fail++; h.err_count++; h.err_ewma = h.err_ewma * 0.9 + 0.1; h.last_error = r.error ?? null
      if (kind === 'timeout' && r.latencyMs) h.lat_ewma_ms = h.lat_ewma_ms == null ? r.latencyMs : h.lat_ewma_ms * 0.8 + r.latencyMs * 0.2
      if (h.consecutive_fail >= 3) h.breaker_until = new Date(now + Math.min(300, 30 * 2 ** Math.min(h.consecutive_fail - 3, 4)) * 1000).toISOString()
    }
  }
  async count(key: string, n = 1) { this.ctr.set(key, (this.ctr.get(key) ?? 0) + n) }
  async counters() { return Object.fromEntries(this.ctr) }
}

/** Postgres store (service role), shared by every instance. Each call fails over to the in-memory store. */
export class PgStore implements PoolStore {
  private mem = new MemoryStore()
  private db: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> } | null = null
  private async client() {
    if (!this.db) { const { createAdminClient } = await import('../supabase/admin'); this.db = createAdminClient() as unknown as NonNullable<PgStore['db']> }
    return this.db
  }
  async state(slots: { id: string; day: string }[]) {
    try {
      const { data, error } = await (await this.client()).rpc('llm_pool_state', { p_slots: slots.map(s => s.id), p_days: slots.map(s => s.day) })
      if (error || !Array.isArray(data)) throw new Error('state')
      const out = new Map<string, SlotState>()
      for (const r of data as (SlotState & { slot: string })[]) out.set(r.slot, { ...blank(), ...r })
      return out
    } catch { return this.mem.state(slots) }
  }
  async take(a: Parameters<PoolStore['take']>[0]) {
    try {
      const { data, error } = await (await this.client()).rpc('agent_budget_take', {
        p_model: a.slot, p_tokens: Math.max(1, Math.round(a.tokens)), p_rpm: a.limits.rpm, p_rpd: a.limits.rpd, p_tpm: a.limits.tpm, p_tpd: Math.min(a.limits.tpd, 2e9),
        p_day: a.day, p_day_cap: a.dayCap, p_user: a.user ?? null, p_user_tpm: a.userTpm ?? null, p_user_tpd: a.userTpd ?? null,
      })
      if (error) throw new Error('take')
      return data !== false
    } catch { return this.mem.take(a) }
  }
  async adjust(slot: string, delta: number, day: string, user?: string | null, reqDelta = 0) {
    if (!delta && !reqDelta) return
    try { await (await this.client()).rpc('agent_budget_adjust', { p_model: slot, p_delta: Math.round(delta), p_day: day, p_user: user ?? null, p_req: reqDelta }) } catch { /* best effort */ }
  }
  async report(slot: string, kind: ReportKind, r: Parameters<PoolStore['report']>[2]) {
    void this.mem.report(slot, kind, r)
    try {
      await (await this.client()).rpc('llm_slot_report', { p_slot: slot, p_kind: kind, p_latency_ms: r.latencyMs != null ? Math.round(r.latencyMs) : null, p_cooldown_ms: r.cooldownMs != null ? Math.round(r.cooldownMs) : null, p_in: r.input ?? 0, p_out: r.output ?? 0, p_cached: r.cached ?? 0, p_error: r.error?.slice(0, 300) ?? null })
    } catch { /* best effort */ }
  }
  async count(key: string, n = 1) {
    if (!n) return
    try { await (await this.client()).rpc('llm_pool_count', { p_key: key, p_n: Math.round(n) }) } catch { /* best effort */ }
  }
}

let store: PoolStore = new PgStore()
/** For tests and the load test. */
export function setPoolStore(s: PoolStore) { store = s; snapshot = null }
export function poolStore() { return store }

/* ───────────── Clock helpers ───────────── */

let clock: () => number = Date.now
export function setPoolClock(fn: () => number) { clock = fn }
export const now = () => clock()

const dayFmt = new Map<string, Intl.DateTimeFormat>()
const hmFmt = new Map<string, Intl.DateTimeFormat>()
function fmtFor(m: Map<string, Intl.DateTimeFormat>, tz: string, o: Intl.DateTimeFormatOptions, loc: string) {
  let f = m.get(tz)
  if (!f) { f = new Intl.DateTimeFormat(loc, { timeZone: tz, ...o }); m.set(tz, f) }
  return f
}
/** The provider's quota day ('YYYY-MM-DD' in its reset time zone). */
export function quotaDay(tz: SlotDef['resetTz'], t = now()) {
  return fmtFor(dayFmt, tz, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA').format(new Date(t))
}
/** Fraction of the provider's quota day already elapsed (0 at reset, →1 before the next). */
export function dayElapsed(tz: SlotDef['resetTz'], t = now()) {
  const parts = fmtFor(hmFmt, tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, 'en-GB').formatToParts(new Date(t))
  let h = 0, mi = 0
  for (const x of parts) { if (x.type === 'hour') h = Number(x.value); else if (x.type === 'minute') mi = Number(x.value) }
  return (h * 60 + mi) / 1440
}
/** ms until the next quota-day reset. */
export function msToReset(tz: SlotDef['resetTz'], t = now()) { return Math.max(60_000, Math.round((1 - dayElapsed(tz, t)) * 86_400_000)) }

/* ───────────── Tunables ───────────── */

export const POOL = {
  /** Healthy chat-capable slots kept for learner traffic. */
  reserve: () => num(process.env.POOL_RESERVE_SLOTS, 2),
  /** Background may spend at most this share of a slot's daily quota… */
  bgShare: () => Math.min(1, num(process.env.POOL_BG_SHARE, 0.6)),
  /** …and only the part of it that matches the elapsed share of the day (plus this head start). */
  bgHeadStart: () => Math.min(1, num(process.env.POOL_BG_HEADSTART, 0.2)),
  /** Ask leaves this share of each slot's daily quota for live lessons. */
  askShare: () => Math.min(1, num(process.env.POOL_ASK_SHARE, 0.9)),
  /** Per-learner fair share: tokens per minute (all slots) and Groq tokens per UTC day; background gets half. */
  userTpm: () => num(process.env.POOL_USER_TPM, 30_000),
  userTpd: () => num(process.env.POOL_USER_TPD, 150_000),
  snapshotMs: 1500,
}

/** Daily cap fraction a priority may use on a slot right now. */
export function dayCapFor(priority: Priority, s: SlotDef, t = now()) {
  if (priority === 'live') return 1
  if (priority === 'ask') return POOL.askShare()
  return Math.min(POOL.bgShare(), POOL.bgShare() * Math.min(1, dayElapsed(s.resetTz, t) + POOL.bgHeadStart()))
}

/* ───────────── Snapshot (one RPC, reused for 1.5 s) ───────────── */

let snapshot: { at: number; map: Map<string, SlotState> } | null = null
let inflight: Promise<Map<string, SlotState>> | null = null
async function loadState(slots: SlotDef[]): Promise<Map<string, SlotState>> {
  if (snapshot && now() - snapshot.at < POOL.snapshotMs && slots.every(s => snapshot!.map.has(s.id))) return snapshot.map
  if (inflight) return inflight
  inflight = store.state(slots.map(s => ({ id: s.id, day: quotaDay(s.resetTz) }))).then(map => { snapshot = { at: now(), map }; return map }).finally(() => { inflight = null })
  return inflight
}
/** Reflect our own take/report in the cached snapshot immediately. */
function bump(id: string, f: (s: SlotState) => void) { const s = snapshot?.map.get(id); if (s) f(s) }
function slotsOfKey(s: SlotDef) { return inventory().filter(x => x.keyEnv === s.keyEnv && x.provider === s.provider) }
/** Process-local cooldowns (instant, before the shared row is re-read). */
const localCooldown = new Map<string, number>()

/* ───────────── Routing ───────────── */

export interface Candidate { slot: SlotDef; score: number; headroom: number; reason?: string }
export interface Plan {
  ordered: Candidate[]
  reserved: string[]
  /** Why nothing fits (for the error and the dashboard). */
  blocked: { slot: string; why: string }[]
  /** Soonest time anything frees up (ms from now). */
  retryAfterMs: number
}

export interface RouteRequest {
  purpose: PoolPurpose
  priority: Priority
  estTokens: number
  providers?: Provider[]
  models?: readonly string[]
  /** Quality floor: preferred (normal) or 0 (lighter models allowed). */
  minQuality?: number
  preferFast?: boolean
}

function health(s: SlotDef, st: SlotState | undefined, t: number): { ok: boolean; why?: string; wait?: number } {
  const lc = localCooldown.get(s.id) ?? 0
  if (lc > t) return { ok: false, why: 'cooldown', wait: lc - t }
  if (!st) return { ok: true }
  const cd = st.cooldown_until ? Date.parse(st.cooldown_until) : 0
  if (cd > t) return { ok: false, why: 'cooldown', wait: cd - t }
  const br = st.breaker_until ? Date.parse(st.breaker_until) : 0
  if (br > t) return { ok: false, why: 'breaker open', wait: br - t }
  return { ok: true }
}
const secsToNextMinute = (t: number) => 60_000 - (t % 60_000) + 50

function headroomOf(s: SlotDef, st: SlotState | undefined, est: number, dayCap: number) {
  const L = s.limits, x = st ?? blank()
  const minute = Math.min(1 - (x.m_req + 1) / L.rpm, 1 - (x.m_tok + est) / L.tpm)
  const day = Math.min(1 - (x.d_req + 1) / (L.rpd * dayCap), 1 - (x.d_tok + est) / (L.tpd * dayCap))
  return { minute, day }
}

/** Learner traffic competes with background in two lanes: tutor chat (Groq-first) and lesson content (Gemini). */
export function laneOf(purpose: PoolPurpose): 'chat' | 'lesson' { return purpose === 'lesson' || purpose === 'vision' ? 'lesson' : 'chat' }

/**
 * The healthy slots with the most headroom in a lane, kept for learner traffic: background never uses them, and Ask
 * uses them only while they are less than half full this minute (live lessons come first).
 */
export function reservedSlots(slots: SlotDef[], state: Map<string, SlotState>, t = now(), lane: 'chat' | 'lesson' = 'chat'): string[] {
  const purpose: PoolPurpose = lane === 'lesson' ? 'lesson' : 'chat'
  const floor = lane === 'lesson' ? 0.7 : PREFERRED.chat
  const live = slots
    .filter(s => quality(purpose, s) >= floor && health(s, state.get(s.id), t).ok)
    .map(s => ({ s, h: headroomOf(s, state.get(s.id), 2500, 1) }))
    .filter(x => x.h.day > 0.05 && x.h.minute >= 0)
    .sort((a, b) => (b.h.day + b.h.minute) * quality(purpose, b.s) - (a.h.day + a.h.minute) * quality(purpose, a.s))
  return live.slice(0, POOL.reserve()).map(x => x.s.id)
}

export async function route(req: RouteRequest, slots = inventory()): Promise<Plan> {
  const t = now()
  const pool = slots.filter(s => (!req.providers || req.providers.includes(s.provider)) && (!req.models || req.models.includes(s.model)) && quality(req.purpose, s) > 0)
  const state = await loadState(slots)
  const reserved = reservedSlots(slots, state, t, laneOf(req.purpose))
  const blocked: Plan['blocked'] = []
  const ordered: Candidate[] = []
  let retryAfterMs = Infinity
  const floor = req.minQuality ?? PREFERRED[req.purpose]
  for (const s of pool) {
    const q = quality(req.purpose, s)
    if (q < floor) { blocked.push({ slot: s.id, why: 'below quality floor' }); continue }
    const st = state.get(s.id)
    const h = health(s, st, t)
    if (!h.ok) { blocked.push({ slot: s.id, why: h.why! }); retryAfterMs = Math.min(retryAfterMs, h.wait ?? 30_000); continue }
    // Eval runs (label 'eval') go at Ask priority so they test the real routing, but never take a learner-reserved slot.
    if ((req.priority === 'background' || llmContext().label === 'eval') && reserved.includes(s.id)) { blocked.push({ slot: s.id, why: 'reserved for learners' }); continue }
    const cap = dayCapFor(req.priority, s, t)
    const hr = headroomOf(s, st, req.estTokens, cap)
    if (req.priority === 'ask' && reserved.includes(s.id) && hr.minute < 0.5) { blocked.push({ slot: s.id, why: 'reserved for live lessons' }); continue }
    if (hr.day < 0) {
      blocked.push({ slot: s.id, why: req.priority === 'background' && cap < 1 ? 'background pacing (daily share)' : 'daily quota used' })
      retryAfterMs = Math.min(retryAfterMs, req.priority === 'background' ? 20 * 60_000 : msToReset(s.resetTz, t))
      continue
    }
    if (hr.minute < 0) {
      // A request bigger than the whole per-minute token budget can never fit this slot.
      if (req.estTokens > s.limits.tpm) { blocked.push({ slot: s.id, why: 'request larger than TPM' }); continue }
      blocked.push({ slot: s.id, why: 'minute window full' }); retryAfterMs = Math.min(retryAfterMs, secsToNextMinute(t)); continue
    }
    const lat = st?.lat_ewma_ms ?? priorLatency(s)
    const speed = req.priority === 'background' ? 1 : 1 / (1 + lat / (req.preferFast ? 4000 : 12_000))
    const err = 1 - Math.min(0.8, st?.err_ewma ?? 0)
    // Live traffic spreads by minute headroom (latency, 429s); background by daily headroom (pacing).
    const head = req.priority === 'background' ? 0.2 + 0.8 * hr.day : (0.35 + 0.65 * Math.max(0, hr.minute)) * (0.5 + 0.5 * Math.max(0, hr.day))
    const fast = req.preferFast && /lite|20b/.test(s.model) ? 1.3 : 1
    ordered.push({ slot: s, score: q * head * speed * err * fast, headroom: Math.min(hr.minute, hr.day) })
  }
  ordered.sort((a, b) => b.score - a.score)
  return { ordered, reserved, blocked, retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : 60_000 }
}

/* ───────────── Execution ───────────── */

export class PoolBusyError extends Error {
  retryAfterMs: number
  constructor(msg: string, retryAfterMs: number) { super(msg); this.name = 'PoolBusyError'; this.retryAfterMs = retryAfterMs }
}
/** Background work deferred so learners keep the capacity (retry after retryAfterMs). */
export class PoolDeferredError extends PoolBusyError {
  constructor(msg: string, retryAfterMs: number) { super(msg, retryAfterMs); this.name = 'PoolDeferredError' }
}

export interface Attempt<T> {
  /** Perform the provider call on this slot. `timeoutMs` is the attempt budget (fast failover for live turns). */
  (slot: SlotDef, opts: { timeoutMs: number; trimmed: boolean }): Promise<{ value: T; usage?: { input: number; output: number; cached?: number } }>
}
export interface RunOptions {
  purpose: PoolPurpose
  priority?: Priority
  learnerId?: string | null
  estTokens: number
  /** Tokens the trimmed variant would need (when the caller can trim context / max_tokens). */
  trimmedEstTokens?: number
  providers?: Provider[]
  models?: readonly string[]
  preferFast?: boolean
  /** Absolute deadline (ms since epoch). */
  deadline?: number
  /** Per-attempt timeout. Without it live/ask attempts get a tight budget (fast failover). */
  timeoutMs?: number
  /** Timeout for the first attempt only (cap latency, then fail over). */
  firstTimeoutMs?: number
  trace?: string[]
  /** Called when an attempt fails; return true to stop trying (e.g. text already streamed). */
  stopOn?: (err: unknown) => boolean
  /** Max slots to try. */
  maxAttempts?: number
  /** Slots to skip (e.g. the one that just answered with nothing). */
  avoid?: readonly string[]
}

export function classify(err: unknown): { kind: ReportKind; cooldownMs?: number; keyWide?: boolean; modelWide?: boolean } {
  const msg = err instanceof Error ? err.message : String(err)
  if (/API key not valid|API_KEY_INVALID|invalid[_ ]api[_ ]key|Invalid API Key|\b401\b|organization_restricted|PERMISSION_DENIED.*(key|project)/i.test(msg)) return { kind: 'missing', cooldownMs: 6 * 3600_000, keyWide: true }
  if (/\b429\b|rate.?limit|RESOURCE_EXHAUSTED|quota|Too Many Requests/i.test(msg)) {
    const m = /(?:try again in|retry(?:Delay)?["'\s:]*(?:in\s*)?["']?)\s*([\d.]+)\s*s/i.exec(msg)
    const daily = /PerDay|per day|daily|RPD|TPD|tokens per day|requests per day/i.test(msg)
    return { kind: 'quota', cooldownMs: daily ? 15 * 60_000 : Math.min(120_000, m ? Number(m[1]) * 1000 + 500 : 30_000) }
  }
  // Google's "high demand" 503 is about the model, not the key: rest that model on every key for a short while.
  if (/\b503\b|UNAVAILABLE|overloaded|high demand/i.test(msg)) return { kind: 'overload', cooldownMs: 20_000, modelWide: true }
  if (/\b404\b|NOT_FOUND|not found|does not exist|decommissioned|not supported|unsupported model/i.test(msg)) return { kind: 'missing', cooldownMs: 6 * 3600_000 }
  if (/timed? ?out|aborted|AbortError|TimeoutError|deadline/i.test(msg)) return { kind: 'timeout' }
  return { kind: 'error' }
}

const LIVE_TIMEOUT = { groq: 14_000, gemini: 22_000 }

/**
 * Run one model call on the best slot for the request, failing over across slots. Learner traffic walks the
 * degradation ladder (preferred → trimmed → lighter); background is deferred when only reserved or
 * over-paced slots remain.
 */
export async function runOnPool<T>(o: RunOptions, attempt: Attempt<T>): Promise<{ value: T; slot: SlotDef; trimmed: boolean; lighter: boolean }> {
  const ctx = llmContext()
  const priority = o.priority ?? ctx.priority ?? 'ask'
  const learner = o.learnerId !== undefined ? o.learnerId : ctx.learnerId ?? null
  const errors: string[] = []
  const tried = new Set<string>(o.avoid ?? [])
  let skippedTakes = tried.size
  const maxAttempts = o.maxAttempts ?? 8
  // Rungs of the ladder. Background never trims or goes lighter: it waits for capacity instead.
  const rungs: { trimmed: boolean; lighter: boolean }[] = priority === 'background'
    ? [{ trimmed: false, lighter: false }]
    : [{ trimmed: false, lighter: false }, ...(o.trimmedEstTokens ? [{ trimmed: true, lighter: false }] : []), { trimmed: !!o.trimmedEstTokens, lighter: true }]
  let lastPlan: Plan | null = null
  for (const rung of rungs) {
    const est = rung.trimmed && o.trimmedEstTokens ? o.trimmedEstTokens : o.estTokens
    const plan = await route({ purpose: o.purpose, priority, estTokens: est, providers: o.providers, models: o.models, minQuality: rung.lighter ? 0 : undefined, preferFast: o.preferFast })
    lastPlan = plan
    let rungFailures = 0
    for (const c of plan.ordered) {
      if (tried.has(c.slot.id)) continue
      // Learner traffic does not grind through a failing tier: after 2 real failures it moves down the ladder.
      if (priority !== 'background' && rungFailures >= 2 && rung !== rungs[rungs.length - 1]) break
      if (tried.size - skippedTakes >= maxAttempts || tried.size >= 40) break
      if (o.deadline && now() > o.deadline - 2500) throw new PoolBusyError(`Deadline reached (${errors.slice(0, 4).join(' | ')})`, 30_000)
      const s = c.slot
      const day = quotaDay(s.resetTz)
      // Fair share per learner: a per-minute token cap everywhere (one learner cannot drain a minute window), and a
      // daily cap on Groq tokens, the scarce resource (200K a model a day). Gemini's scarce resource is requests,
      // which the per-minute cap already spreads. Background gets half.
      // A learner's own lesson being written while they watch (plan + opening + next beats, ~10K tokens each) must not
      // starve on the same per-minute share as their chat: lesson content gets 3x (measured: fresh lessons paused on
      // "fair share" right after the opening beat, so the learner saw one beat and then "Lesson complete").
      const half = (priority === 'background' ? 0.5 : 1) * (o.purpose === 'lesson' && priority !== 'background' ? 3 : 1)
      const userCap = !learner ? {} : s.provider === 'groq'
        ? { user: `g:${learner}`, userTpm: POOL.userTpm() * half, userTpd: POOL.userTpd() * half }
        : { user: learner, userTpm: POOL.userTpm() * half }
      const ok = await store.take({ slot: s.id, tokens: est, limits: s.limits, day, dayCap: dayCapFor(priority, s), ...userCap })
      if (!ok) {
        tried.add(s.id)
        skippedTakes++
        // The shared counter says this slot is full right now: reflect it locally so the next calls skip it.
        bump(s.id, x => { x.m_req = Math.max(x.m_req, s.limits.rpm) })
        o.trace?.push(`${s.id}: over its budget (or this learner's fair share), skipped`)
        // Distinguish "this learner used their fair share" from slot limits: try once without user caps? No: fair share is a rule.
        continue
      }
      tried.add(s.id)
      bump(s.id, x => { x.m_req++; x.m_tok += est; x.d_req++; x.d_tok += est })
      let timeoutMs = o.timeoutMs ?? (priority === 'background' ? 60_000 : LIVE_TIMEOUT[s.provider])
      if (tried.size - skippedTakes === 1 && o.firstTimeoutMs) timeoutMs = Math.min(timeoutMs, o.firstTimeoutMs)
      if (o.deadline) timeoutMs = Math.max(2000, Math.min(timeoutMs, o.deadline - now()))
      const t0 = now()
      try {
        const r = await attempt(s, { timeoutMs, trimmed: rung.trimmed })
        const used = r.usage ? r.usage.input + r.usage.output - (s.provider === 'groq' ? r.usage.cached ?? 0 : 0) : est
        void store.adjust(s.id, used - est, day, learner ? (s.provider === 'groq' ? `g:${learner}` : learner) : null)
        bump(s.id, x => { x.m_tok += used - est; x.d_tok += used - est; x.consecutive_fail = 0; x.breaker_until = null })
        void store.report(s.id, 'ok', { latencyMs: now() - t0, input: r.usage?.input, output: r.usage?.output, cached: r.usage?.cached })
        if (r.usage?.cached) void store.count('saved_cached_tokens', r.usage.cached)
        if (rung.trimmed) void store.count('trimmed')
        if (rung.lighter && quality(o.purpose, s) < PREFERRED[o.purpose]) void store.count('lighter_model')
        if (tried.size - skippedTakes > 1) void store.count('failover')
        return { value: r.value, slot: s, trimmed: rung.trimmed, lighter: rung.lighter }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`${s.id}: ${msg.slice(0, 140)}`)
        o.trace?.push(`${s.id}: ${msg.slice(0, 160)}`)
        const cl = classify(err)
        // The request never ran (or failed): give the estimate back.
        // The provider did not serve it (quota, bad key, missing model): give the request and tokens back.
        const unserved = cl.kind === 'quota' || cl.kind === 'missing' || cl.kind === 'overload'
        const pending: Promise<unknown>[] = [store.adjust(s.id, -est, day, learner ? (s.provider === 'groq' ? `g:${learner}` : learner) : null, unserved ? -1 : 0)]
        bump(s.id, x => { x.m_tok = Math.max(0, x.m_tok - est); x.d_tok = Math.max(0, x.d_tok - est); if (unserved) { x.m_req = Math.max(0, x.m_req - 1); x.d_req = Math.max(0, x.d_req - 1) } })
        // An invalid / revoked key fails every model on it: cool the whole key down at once.
        const sameKey = cl.keyWide ? slotsOfKey(s) : cl.modelWide ? inventory().filter(x => x.model === s.model && x.provider === s.provider) : [s]
        for (const k of sameKey) {
          if (cl.cooldownMs) localCooldown.set(k.id, now() + cl.cooldownMs)
          pending.push(store.report(k.id, cl.kind, { latencyMs: k === s ? now() - t0 : undefined, cooldownMs: cl.cooldownMs, error: msg }))
          if (k !== s) tried.add(k.id)
        }
        // Failures are rare: wait for the shared ledger so other instances see the cooldown at once.
        await Promise.allSettled(pending)
        if (cl.kind === 'timeout' && priority !== 'background') void store.count('slow_failover')
        rungFailures++
        if (o.stopOn?.(err)) throw err
      }
    }
  }
  const plan = lastPlan!
  const why = summarise(plan, errors)
  if (priority === 'background') {
    void store.count('deferred_background')
    throw new PoolDeferredError(`Background work deferred to keep capacity for learners (${why})`, Math.max(15_000, Math.min(plan.retryAfterMs, 30 * 60_000)))
  }
  void store.count('busy')
  throw new PoolBusyError(`No model could answer (${why})`, Math.max(5_000, Math.min(plan.retryAfterMs, 10 * 60_000)))
}

function summarise(plan: Plan, errors: string[]) {
  const counts = new Map<string, number>()
  for (const b of plan.blocked) counts.set(b.why, (counts.get(b.why) ?? 0) + 1)
  const parts = [...counts].map(([k, v]) => `${v} ${k}`)
  return [...parts, ...errors.slice(0, 3)].join('; ') || 'no slot'
}

/** Rough token estimate (≈3.6 characters per token for English + JSON). */
export function estTokens(s: string) { return Math.ceil(s.length / 3.6) }

/* ───────────── Health view (admin endpoint + dashboard) ───────────── */

export interface PoolHealth {
  at: string
  keys: { provider: Provider; env: string; key: number }[]
  slots: {
    id: string; provider: Provider; key: number; model: string; limits: Limits; day: string
    minute: { req: number; tok: number }; dayUsed: { req: number; tok: number }
    headroom: { minute: number; day: number }; state: 'healthy' | 'cooldown' | 'breaker' | 'exhausted'
    reserved: boolean; latencyMs: number | null; errRate: number; ok: number; errors: number; quota429: number
    tokensIn: number; tokensOut: number; tokensCached: number; lastError: string | null; lastOkAt: string | null
    bgCap: number
  }[]
  reserve: { wanted: number; held: string[]; chat: string[]; lesson: string[]; holding: boolean }
  capacity: { liveRpmNow: number; dailyRequestsLeft: number; dailyTokensLeftGroq: number }
  counters: Record<string, number>
}

export async function poolHealth(): Promise<PoolHealth> {
  const slots = inventory()
  snapshot = null
  const state = await loadState(slots)
  const t = now()
  const reservedChat = reservedSlots(slots, state, t, 'chat')
  const reservedLesson = reservedSlots(slots, state, t, 'lesson')
  const reserved = [...reservedChat, ...reservedLesson]
  let counters: Record<string, number> = {}
  try {
    if (store.counters) counters = await store.counters()
    else {
      const { createAdminClient } = await import('../supabase/admin')
      const { data } = await createAdminClient().from('llm_pool_counters').select('key, n').eq('day', new Date(t).toISOString().slice(0, 10))
      counters = Object.fromEntries((data ?? []).map((r: { key: string; n: number }) => [r.key, Number(r.n)]))
    }
  } catch { /* none */ }
  const rows = slots.map(s => {
    const st = state.get(s.id) ?? blank()
    const h = health(s, st, t)
    const hr = headroomOf(s, st, 0, 1)
    const exhausted = hr.day <= 0.02
    return {
      id: s.id, provider: s.provider, key: s.key, model: s.model, limits: s.limits, day: quotaDay(s.resetTz, t),
      minute: { req: st.m_req, tok: st.m_tok }, dayUsed: { req: st.d_req, tok: st.d_tok },
      headroom: { minute: Math.max(0, hr.minute), day: Math.max(0, hr.day) },
      state: (!h.ok ? (h.why === 'breaker open' ? 'breaker' : 'cooldown') : exhausted ? 'exhausted' : 'healthy') as PoolHealth['slots'][number]['state'],
      reserved: reserved.includes(s.id), latencyMs: st.lat_ewma_ms, errRate: st.err_ewma, ok: st.ok_count, errors: st.err_count, quota429: st.quota_count,
      tokensIn: st.tokens_in, tokensOut: st.tokens_out, tokensCached: st.tokens_cached, lastError: st.last_error, lastOkAt: st.last_ok_at,
      bgCap: dayCapFor('background', s, t),
    }
  })
  const healthy = rows.filter(r => r.state === 'healthy')
  const keys = [...new Map(slots.map(s => [s.keyEnv, { provider: s.provider, env: s.keyEnv, key: s.key }])).values()]
  return {
    at: new Date(t).toISOString(), keys, slots: rows,
    reserve: { wanted: POOL.reserve(), held: reserved, chat: reservedChat, lesson: reservedLesson, holding: reservedChat.length >= POOL.reserve() && reservedLesson.length >= POOL.reserve() },
    capacity: {
      liveRpmNow: healthy.reduce((a, r) => a + Math.max(0, r.limits.rpm - r.minute.req), 0),
      dailyRequestsLeft: healthy.reduce((a, r) => a + Math.max(0, r.limits.rpd - r.dayUsed.req), 0),
      dailyTokensLeftGroq: rows.filter(r => r.provider === 'groq' && r.state !== 'breaker').reduce((a, r) => a + Math.max(0, r.limits.tpd - r.dayUsed.tok), 0),
    },
    counters,
  }
}

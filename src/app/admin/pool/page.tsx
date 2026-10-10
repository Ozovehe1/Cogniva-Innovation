import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Logo, cx } from '@/components/ui'
import { poolAdmin } from '@/lib/pool-admin'
import { poolHealth, type PoolHealth } from '@/lib/agent/pool'
import { Refresher } from './refresher'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Model pool · Ideanimo', robots: { index: false } }

type Slot = PoolHealth['slots'][number]

const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n))
const pct = (x: number) => `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`

/* One meaning per colour (lesson-ui.md §5): accent = healthy capacity, clay = the thing to look at now, amber = brief
   caution, never red fills for a normal state. Headroom bars carry the number beside them (never colour alone). */
const STATE: Record<Slot['state'], { label: string; cls: string }> = {
  healthy: { label: 'Healthy', cls: 'border-accent-line bg-accent-soft text-accent' },
  cooldown: { label: 'Cooling down', cls: 'border-amber-line bg-amber-soft text-amber' },
  breaker: { label: 'Paused (errors)', cls: 'border-clay-line bg-clay-soft text-clay' },
  exhausted: { label: 'Used up today', cls: 'border-line bg-sunken text-muted' },
}

function Bar({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[12px] text-muted"><span>{label}</span><span className="tabular-nums text-ink-2">{pct(value)}</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <div className={cx('h-full rounded-full', value > 0.35 ? 'bg-accent' : value > 0.1 ? 'bg-amber' : 'bg-clay')} style={{ width: pct(value) }} />
      </div>
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-3.5 shadow-card sm:p-4">
      <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className="mt-1.5 font-display text-[26px] leading-none text-ink tabular-nums sm:text-[30px]">{value}</p>
      <p className="mt-2 text-[12px] leading-snug text-muted sm:text-[13px]">{note}</p>
    </div>
  )
}

function SlotRow({ s }: { s: Slot }) {
  const st = STATE[s.state]
  return (
    <li className="grid grid-cols-1 gap-3 border-t border-line px-4 py-3.5 first:border-t-0 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)] md:items-center md:gap-5">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[15px] font-medium text-ink">{s.model}</span>
          <span className={cx('rounded-full border px-2 py-0.5 text-[12px]', st.cls)}>{st.label}</span>
          {s.reserved && <span className="rounded-full border border-navy-line bg-navy-soft px-2 py-0.5 text-[12px] text-navy">Reserved for learners</span>}
        </p>
        <p className="mt-0.5 text-[12px] text-muted tabular-nums">{s.limits.rpm} RPM · {fmt(s.limits.rpd)} RPD · {fmt(s.limits.tpm)} TPM{s.limits.tpd < 1e8 ? ` · ${fmt(s.limits.tpd)} TPD` : ''}</p>
        {s.lastError && s.state !== 'healthy' && <p className="mt-1 line-clamp-2 text-[12px] text-ink-2">{s.lastError}</p>}
      </div>
      <Bar label={`This minute · ${s.minute.req} req`} value={Math.min(1 - s.minute.req / s.limits.rpm, 1 - s.minute.tok / s.limits.tpm)} />
      <Bar label={`Today (${s.day}) · ${fmt(s.dayUsed.req)} req · ${fmt(s.dayUsed.tok)} tok`} value={Math.min(1 - s.dayUsed.req / s.limits.rpd, 1 - s.dayUsed.tok / s.limits.tpd)} />
      <div className="grid grid-cols-3 gap-2 text-[12px] text-muted md:text-right">
        <p><span className="block text-[15px] text-ink tabular-nums">{s.latencyMs != null ? `${(s.latencyMs / 1000).toFixed(1)} s` : '—'}</span>latency</p>
        <p><span className="block text-[15px] text-ink tabular-nums">{pct(s.errRate)}</span>errors</p>
        <p><span className="block text-[15px] text-ink tabular-nums">{s.quota429}</span>429s</p>
      </div>
    </li>
  )
}

export default async function PoolPage() {
  if (!(await poolAdmin())) notFound()
  const h = await poolHealth()
  const c = h.counters
  const saved = (c.saved_cached_tokens ?? 0) + (c.saved_trim_tokens ?? 0) + (c.saved_history_tokens ?? 0)
  const groups = new Map<string, Slot[]>()
  for (const s of h.slots) { const k = `${s.provider === 'groq' ? 'Groq' : 'Gemini'} · key ${s.key}`; groups.set(k, [...(groups.get(k) ?? []), s]) }
  const healthy = h.slots.filter(s => s.state === 'healthy').length
  const headline = !h.reserve.holding ? 'Under pressure: fewer than the reserved learner slots are healthy.' : healthy < h.slots.length / 3 ? 'Busy: background work is being held back for learners.' : 'Healthy: learners have their reserved capacity.'
  const ladder: [string, number, string][] = [
    ['Background deferred', c.deferred_background ?? 0, 'drafting ahead, Director, critiques, evals waited for capacity'],
    ['Context trimmed', c.trimmed ?? 0, 'learner turns answered with a shorter prompt'],
    ['Lighter model', c.lighter_model ?? 0, 'learner turns answered by a smaller model'],
    ['Failovers', c.failover ?? 0, 'calls that moved to another slot'],
    ['Slow-turn failovers', c.slow_failover ?? 0, 'live turns cut over after a slow first token'],
    ['Retry card shown', c.busy ?? 0, 'every slot busy: the calm “answer in a moment” card'],
  ]
  return (
    <main className="min-h-dvh bg-canvas">
      <Refresher seconds={20} />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <Logo href="/dashboard" />
          <p className="flex items-center gap-2 text-[12px] text-muted sm:text-[13px]"><span className="h-2 w-2 rounded-full bg-accent motion-safe:animate-pulse" aria-hidden />Live · refreshes every 20 s</p>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-8 md:py-12">
        <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Admin · LLM pool</p>
        <h1 className="mt-2 font-display text-[34px] leading-tight text-ink md:text-[42px]">Model pool</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-2">{headline} {h.keys.filter(k => k.provider === 'groq').length} Groq and {h.keys.filter(k => k.provider === 'gemini').length} Gemini keys, {h.slots.length} slots. Updated {new Date(h.at).toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', second: '2-digit' })} WAT.</p>

        <section className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Capacity">
          <Stat label="Live capacity" value={`${fmt(h.capacity.liveRpmNow)}`} note="requests a minute free right now on healthy slots" />
          <Stat label="Requests left today" value={fmt(h.capacity.dailyRequestsLeft)} note="across healthy slots, before each provider's daily reset" />
          <Stat label="Groq tokens left" value={fmt(h.capacity.dailyTokensLeftGroq)} note="the usual binding limit (200K a model a day)" />
          <Stat label="Tokens saved today" value={fmt(saved)} note={`${fmt(c.saved_cached_tokens ?? 0)} cached · ${fmt(c.saved_history_tokens ?? 0)} history · ${fmt(c.saved_trim_tokens ?? 0)} trimmed`} />
        </section>

        <section className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="rounded-[14px] border border-line bg-surface p-5 shadow-card">
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Learner reserve</p>
            <p className="mt-2 font-display text-[22px] text-ink">{h.reserve.holding ? 'Holding' : 'Thin'} · {h.reserve.wanted} per lane</p>
            <p className="mt-1 text-[13px] text-muted">Background work never uses these; Ask uses them only while they are under half full. They move to whichever slots have the most room.</p>
            {([['Tutor chat', h.reserve.chat], ['Lesson content', h.reserve.lesson]] as const).map(([lane, ids]) => (
              <div key={lane} className="mt-3">
                <p className="text-[12px] text-muted">{lane} · {ids.length} of {h.reserve.wanted}</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">{ids.map(id => <li key={id} className="rounded-full border border-navy-line bg-navy-soft px-2.5 py-1 text-[12px] text-navy">{id}</li>)}</ul>
              </div>
            ))}
          </div>
          <div className="rounded-[14px] border border-line bg-surface p-5 shadow-card">
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Degradation ladder today</p>
            <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {ladder.map(([k, n, note]) => (
                <li key={k} className="flex items-start gap-3">
                  <span className={cx('mt-0.5 min-w-[3ch] font-display text-[22px] leading-none tabular-nums', n ? 'text-ink' : 'text-faint')}>{fmt(n)}</span>
                  <span><span className="block text-[14px] text-ink">{k}</span><span className="block text-[12px] leading-snug text-muted">{note}</span></span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Progressive disclosure: a key whose slots are all healthy starts folded; one with a problem starts open. */}
        {[...groups].map(([name, slots]) => {
          const ok = slots.filter(s => s.state === 'healthy').length
          const reserved = slots.filter(s => s.reserved).length
          return (
            <details key={name} open={ok < slots.length || reserved > 0} className="group mt-6 overflow-hidden rounded-[14px] border border-line bg-surface shadow-card">
              <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <span className="font-display text-[19px] text-ink">{name}</span>
                <span className="flex items-center gap-2 text-[13px] text-muted">
                  <span className="tabular-nums">{ok}/{slots.length} healthy{reserved ? ` · ${reserved} reserved` : ''}</span>
                  <span aria-hidden className="text-faint transition-transform group-open:rotate-90">›</span>
                </span>
              </summary>
              <ul className="border-t border-line">{slots.map(s => <SlotRow key={s.id} s={s} />)}</ul>
            </details>
          )
        })}
        <p className="mt-8 text-[12px] text-muted">Gemini quotas are per Google Cloud project: two keys from the same project share one quota. Limits can be overridden with GROQ_RPM / GROQ_RPD / GROQ_TPM / GROQ_TPD; reserve and pacing with POOL_RESERVE_SLOTS / POOL_BG_SHARE / POOL_ASK_SHARE.</p>
      </div>
    </main>
  )
}

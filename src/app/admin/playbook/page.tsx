import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdmin } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { Eyebrow, Logo, cx } from '@/components/ui'
import { BULLET_COLS, rowToBullet } from '@/lib/playbook/store'
import type { Bullet, Target } from '@/lib/playbook/types'
import { BulletActions } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Teaching playbook · Ideanimo admin', robots: { index: false } }

const STATUSES = ['live', 'candidate', 'rejected', 'retired'] as const
const TARGET: Record<Target, string> = { lesson: 'Lesson writer', ask: 'Ask tutor', diagram: 'Diagrams', illustration: 'Illustrations', manim: 'Animations' }
const STATUS_TONE: Record<string, string> = { live: 'border-accent-line bg-accent-soft text-accent', candidate: 'border-amber-line bg-amber-soft text-amber', rejected: 'border-clay-line bg-clay-soft text-clay', retired: 'border-line bg-sunken text-muted' }
const SOURCE: Record<string, string> = { report: 'Confirmed report', guard: 'Guard catch', clip: 'Animation verifier', outcome: 'Missed checks', reexplain: 'Re-explain request', confusion: 'Low confidence', success: 'Strong lesson' }
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '—'

/**
 * /admin/playbook — the Teaching Playbook (admins only: ADMIN_EMAILS). Global teaching rules learned from real lessons:
 * see each bullet's evidence, gate verdict (with vs without, per probe) and lifecycle; approve, retire, reject, re-gate or
 * reword. Global bullets hold no learner data (enforced at write time); per-learner notes are not shown here.
 * Design (docs/design/lesson-ui.md §0): one primary action per bullet state (Hick), status colour as the only signal
 * (salience), evidence and history behind disclosure (cognitive load), 44 px targets (Fitts).
 */
export default async function PlaybookPage({ searchParams }: { searchParams: Promise<{ status?: string; target?: string; id?: string }> }) {
  const who = await getAdmin()
  if (!who) notFound()
  const sp = await searchParams
  const status = (STATUSES as readonly string[]).includes(sp.status ?? '') ? sp.status! : 'live'
  const target = sp.target && sp.target in TARGET ? sp.target as Target : null
  const admin = createAdminClient()
  let q = admin.from('playbook_bullets').select(BULLET_COLS).eq('scope', 'global').eq('status', status).order('updated_at', { ascending: false }).limit(80)
  if (target) q = q.eq('target', target)
  const [{ data: rows }, counts, { count: newSignals }, { count: allSignals }, { data: state }, { data: recentSources }] = await Promise.all([
    q,
    Promise.all(STATUSES.map(async s => [s, (await admin.from('playbook_bullets').select('id', { count: 'exact', head: true }).eq('scope', 'global').eq('status', s)).count ?? 0] as const)),
    admin.from('playbook_signals').select('id', { count: 'exact', head: true }).eq('scope', 'global').eq('status', 'new'),
    admin.from('playbook_signals').select('id', { count: 'exact', head: true }).eq('scope', 'global'),
    admin.from('playbook_state').select('updated_at').eq('key', 'harvest').maybeSingle(),
    admin.from('playbook_signals').select('source').eq('scope', 'global').order('created_at', { ascending: false }).limit(200),
  ])
  const list = (rows ?? []).map(r => rowToBullet(r as Record<string, unknown>))
  const n = Object.fromEntries(counts)
  const bySource = ((recentSources ?? []) as { source: string }[]).reduce<Record<string, number>>((a, r) => { a[r.source] = (a[r.source] ?? 0) + 1; return a }, {})
  const sel = sp.id && /^[0-9a-f-]{36}$/i.test(sp.id)
    ? await admin.from('playbook_bullets').select(BULLET_COLS).eq('id', sp.id).maybeSingle().then(r => (r.data ? rowToBullet(r.data as Record<string, unknown>) : null))
    : null
  const { data: events } = sel ? await admin.from('playbook_events').select('op, detail, actor, created_at').eq('bullet_id', sel.id).order('created_at', { ascending: false }).limit(30) : { data: [] }
  const href = (o: { status?: string; target?: string | null; id?: string }) => {
    const p = new URLSearchParams()
    p.set('status', o.status ?? status)
    const t = o.target === undefined ? target : o.target
    if (t) p.set('target', t)
    if (o.id) p.set('id', o.id)
    return `/admin/playbook?${p}`
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-surface/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1100px] items-center justify-between px-4 md:px-8">
          <Logo href="/dashboard" />
          <nav className="flex items-center gap-3 pl-3 text-[12.5px]">
            <Link href="/admin/reports" className="inline-flex min-h-11 items-center text-muted hover:text-ink">Reports</Link>
            <span className="hidden truncate text-muted sm:inline">{who.email}</span>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1100px] px-4 pb-16 pt-6 md:px-8 md:pt-10">
        <div className={cx(sel && 'hidden lg:block')}>
        <Eyebrow>Admin · teaching playbook</Eyebrow>
        <h1 className="mt-1 font-display text-[30px] leading-[1.1] text-ink md:text-[38px]">What the tutor has learned</h1>
        <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-muted">Rules distilled from real lessons: confirmed reports, guard catches, animation checks and how learners did. A rule goes live only when lessons written with it are no worse than without it. Rules never contain learner data.</p>
        <div className="mt-4 flex flex-wrap gap-2 text-[12.5px] text-ink-2">
          <span className="rounded-full border border-line bg-surface px-3 py-1"><span className="tnum">{allSignals ?? 0}</span> signals · <span className="tnum">{newSignals ?? 0}</span> waiting</span>
          <span className="rounded-full border border-line bg-surface px-3 py-1">Last harvest {when((state as { updated_at?: string } | null)?.updated_at ?? null)}</span>
          {Object.entries(bySource).slice(0, 4).map(([k, v]) => <span key={k} className="hidden rounded-full border border-line bg-surface px-3 py-1 text-muted sm:inline">{SOURCE[k] ?? k} <span className="tnum">{v}</span></span>)}
        </div>
        </div>

        <nav aria-label="Bullet status" className={cx('gap-1 overflow-x-auto border-b border-line', sel ? 'hidden lg:mt-6 lg:flex' : 'mt-6 flex')}>
          {STATUSES.map(s => (
            <Link key={s} href={href({ status: s })} className={cx('-mb-px inline-flex min-h-11 flex-shrink-0 items-center gap-2 border-b-2 px-3 text-[14px] font-medium', status === s ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')}>
              {s[0].toUpperCase() + s.slice(1)}<span className="tnum rounded-full bg-sunken px-1.5 text-[11.5px] text-muted">{n[s]}</span>
            </Link>
          ))}
        </nav>
        <div className={cx('mt-3 gap-1.5 overflow-x-auto pb-1', sel ? 'hidden lg:flex' : 'flex')} role="group" aria-label="Filter by where the rule is used">
          {[null, ...Object.keys(TARGET) as Target[]].map(t => (
            <Link key={t ?? 'all'} href={href({ target: t })} className={cx('inline-flex min-h-9 flex-shrink-0 items-center rounded-full border px-3 text-[12.5px]', target === t ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink-2 hover:border-line-strong')}>{t ? TARGET[t] : 'All'}</Link>
          ))}
        </div>

        <div className="mt-4 grid gap-5 lg:grid-cols-[400px_1fr]">
          <ol className={cx('space-y-2', sel && 'hidden lg:block')} aria-label="Rules">
            {list.length === 0 && <li className="rounded-[14px] border border-dashed border-line-strong bg-surface px-4 py-8 text-center text-[14px] text-muted">{status === 'live' ? 'No live rules yet. Candidates appear as evidence comes in.' : 'Nothing here.'}</li>}
            {list.map(b => (
              <li key={b.id}>
                <Link href={href({ id: b.id })} className={cx('block rounded-[14px] border bg-surface px-4 py-3 shadow-[var(--shadow-card)] transition-colors', sel?.id === b.id ? 'border-accent' : 'border-line hover:border-line-strong')}>
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="font-medium text-ink-2">{TARGET[b.target]}{b.topic ? <span className="font-normal text-muted"> · {b.topic}</span> : <span className="font-normal text-muted"> · every topic</span>}</span>
                    <span className="flex-shrink-0 text-faint">{b.kind === 'strategy' ? 'Keep doing' : 'Avoid'}</span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-[14.5px] leading-snug text-ink">{b.text}</p>
                  <Counters b={b} />
                </Link>
              </li>
            ))}
          </ol>
          {sel ? <Detail b={sel} events={(events ?? []) as Ev[]} back={href({})} /> : (
            <section className="hidden rounded-[16px] border border-dashed border-line-strong bg-surface/60 p-10 text-center text-[14px] text-muted lg:block">Pick a rule to see its evidence, its gate result and its history.</section>
          )}
        </div>
      </main>
    </div>
  )
}

type Ev = { op: string; detail: Record<string, unknown>; actor: string; created_at: string }

function Counters({ b }: { b: Bullet }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px]">
      <span className="tnum rounded-full border border-accent-line bg-accent-soft px-2 py-0.5 text-accent" title="Lessons that went well with this rule in use">▲ {b.helpful} helpful</span>
      <span className={cx('tnum rounded-full border px-2 py-0.5', b.harmful ? 'border-clay-line bg-clay-soft text-clay' : 'border-line text-muted')} title="Times it was implicated in a mistake">▼ {b.harmful} harmful</span>
      <span className="tnum rounded-full border border-line px-2 py-0.5 text-muted" title="Signals behind it">{b.evidence} evidence</span>
      {b.gate && <span className={cx('rounded-full border px-2 py-0.5', b.gate.pass ? 'border-accent-line text-accent' : b.gate.stage === 'inconclusive' ? 'border-line text-muted' : 'border-clay-line text-clay')}>{b.gate.pass ? 'gate passed' : b.gate.stage === 'inconclusive' ? 'gate pending' : `gate: ${b.gate.stage}`}</span>}
    </div>
  )
}

const OP: Record<string, string> = { add: 'Proposed by the reflector', merge: 'Same rule seen again (merged)', live: 'Went live', reject: 'Rejected', retire: 'Retired', helpful: 'Marked helpful', harmful: 'Marked harmful', edit: 'Reworded', restore: 'Restored to candidate', gate_batch_fail: 'Gate: worse with it', gate_inconclusive_fail: 'Gate: models busy, will retry', gate_regression_fail: 'Gate: regression failed', privacy_reject: 'Withheld (privacy)' }

function Detail({ b, events, back }: { b: Bullet; events: Ev[]; back: string }) {
  return (
    <section aria-label="Rule" className="min-w-0 rounded-[16px] border border-line bg-surface p-4 shadow-[var(--shadow-card)] md:p-6">
      <Link href={back} className="-ml-1 mb-2 inline-flex min-h-11 items-center text-[13px] text-muted hover:text-ink lg:hidden">← All {b.status} rules</Link>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx('rounded-full border px-2.5 py-0.5 text-[12px] font-medium', STATUS_TONE[b.status])}>{b.status}</span>
        <span className="text-[13px] text-muted">{TARGET[b.target]} · {b.kind === 'strategy' ? 'keep doing' : 'avoid'} · v{b.version}</span>
      </div>
      <p className="mt-3 font-display text-[21px] leading-snug text-ink md:text-[23px]">{b.text}</p>
      <Counters b={b} />
      <dl className="mt-4 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-muted">Topic</dt><dd className="text-ink-2">{[b.subject, b.topic].filter(Boolean).join(' · ') || 'Every topic'}</dd>
        {b.skill && <><dt className="text-muted">Skill</dt><dd className="text-ink-2">{b.skill}</dd></>}
        {b.check_q && <><dt className="text-muted">Check</dt><dd className="text-ink-2">{b.check_q}</dd></>}
        {b.probes.length > 0 && <><dt className="text-muted">Probes</dt><dd className="text-ink-2">{b.probes.join(' · ')}</dd></>}
        {b.target === 'illustration' && (b.hints.prefer?.length || b.hints.avoid?.length) ? <><dt className="text-muted">Picture hints</dt><dd className="text-ink-2">{b.hints.prefer?.length ? `prefer ${b.hints.prefer.join(', ')}` : ''}{b.hints.avoid?.length ? ` · avoid ${b.hints.avoid.join(', ')}` : ''}</dd></> : null}
        <dt className="text-muted">Live since</dt><dd className="text-ink-2">{when(b.live_at)}{b.decided_by ? ` · by ${b.decided_by}` : ''}</dd>
      </dl>
      <BulletActions id={b.id} status={b.status} text={b.text} />

      <h3 className="mb-2 mt-6 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Gate</h3>
      {b.gate ? (
        <div className="rounded-[12px] border border-line p-3">
          <p className="text-[14px] text-ink-2"><span className={cx('font-medium', b.gate.pass ? 'text-accent' : 'text-clay')}>{b.gate.pass ? 'Passed' : 'Not passed'}</span> · {b.gate.stage} · {when(b.gate.at)}{b.gate.model ? ` · ${b.gate.model}` : ''}</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{b.gate.reason}</p>
          {b.gate.probes?.length ? (
            <table className="mt-3 w-full text-left text-[13px]">
              <thead className="text-[11.5px] uppercase tracking-[0.05em] text-faint"><tr><th className="py-1 font-medium">Probe</th><th className="py-1 pl-3 text-right font-medium">Without</th><th className="py-1 pl-3 text-right font-medium">With</th></tr></thead>
              <tbody>{b.gate.probes.map((p, i) => (
                <tr key={i} className="border-t border-line align-top">
                  <td className="py-1.5 pr-2 text-ink-2">{p.topic}<p className="mt-0.5 text-[12px] text-muted">{(p.candNotes.length ? p.candNotes : ['clean']).join('; ')}</p></td>
                  <td className="tnum py-1.5 pl-3 text-right text-ink-2">{p.base}</td>
                  <td className={cx('tnum py-1.5 pl-3 text-right font-medium', p.cand > p.base ? 'text-clay' : 'text-accent')}>{p.cand}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : null}
        </div>
      ) : <p className="text-[14px] text-muted">Not gated yet: the next background run tries it.</p>}

      <details className="mt-4 rounded-[12px] border border-line bg-[#FBFAF7]">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-[13px] font-medium text-ink-2">History ({events.length})</summary>
        <ol className="space-y-2 border-t border-line px-3 py-3">
          {events.map((e, i) => (
            <li key={i} className="text-[13px]">
              <span className="text-ink-2">{OP[e.op] ?? e.op}</span><span className="text-faint"> · {when(e.created_at)}{e.actor !== 'system' ? ` · ${e.actor}` : ''}</span>
              {typeof e.detail?.reason === 'string' && <p className="text-[12.5px] text-muted">{e.detail.reason}</p>}
              {typeof e.detail?.proposed === 'string' && <p className="text-[12.5px] text-muted">Proposed wording: {e.detail.proposed}</p>}
            </li>
          ))}
        </ol>
      </details>
      <details className="mt-2 rounded-[12px] border border-line bg-[#FBFAF7]">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-[13px] font-medium text-ink-2">Evidence ({b.sources.length} signals)</summary>
        <p className="border-t border-line px-3 py-2 font-mono text-[11.5px] text-muted">{b.sources.map(s => `#${s.signal}`).join(' ') || '—'}</p>
      </details>
    </section>
  )
}

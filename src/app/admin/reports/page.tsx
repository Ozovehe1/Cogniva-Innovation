import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdmin } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { Eyebrow, Logo, cx } from '@/components/ui'
import type { ReportRow } from '@/lib/correctness/reports'
import { TriageActions, ArtefactView } from './triage'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mistake reports · GeniusMap admin', robots: { index: false } }

const SURFACE: Record<string, string> = { lesson_step: 'Lesson', stage: 'Live figure', diagram: 'Diagram', illustration: 'Picture', animation: 'Animation', ask: 'Ask', check: 'Check', practice: 'Practice', mastery: 'Mastery check' }
const CATEGORY: Record<string, string> = { wrong_maths: 'Wrong maths', wrong_picture: 'Wrong picture', confusing: 'Confusing', typo: 'Typo', other: 'Other' }
const STATUS_TONE: Record<string, string> = { open: 'border-amber-line bg-amber-soft text-amber', confirmed: 'border-accent-line bg-accent-soft text-accent', invalid: 'border-line bg-sunken text-muted' }
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })

/**
 * /admin/reports — triage of learners' "Report a mistake" reports (admins only: ADMIN_EMAILS).
 * List by status, open one to see the exact artefact the learner saw (rendered as they saw it, plus the raw JSON),
 * the guard's re-check, model and tool trace; confirm (feeds the blocklist), mark invalid, or add to the regression set.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ status?: string; id?: string }> }) {
  const who = await getAdmin()
  if (!who) notFound()
  const { status = 'open', id } = await searchParams
  const admin = createAdminClient()
  const [{ data: rows }, counts, { count: cases }, { count: blocks }] = await Promise.all([
    admin.from('mistake_reports').select('*').eq('status', ['open', 'confirmed', 'invalid'].includes(status) ? status : 'open').order('created_at', { ascending: false }).limit(60),
    Promise.all(['open', 'confirmed', 'invalid'].map(async s => [s, (await admin.from('mistake_reports').select('id', { count: 'exact', head: true }).eq('status', s)).count ?? 0] as const)),
    admin.from('regression_cases').select('id', { count: 'exact', head: true }).eq('active', true),
    admin.from('correctness_blocklist').select('id', { count: 'exact', head: true }),
  ])
  const list = (rows ?? []) as ReportRow[]
  const { data: one } = id && /^[0-9a-f-]{36}$/i.test(id) ? await admin.from('mistake_reports').select('*').eq('id', id).maybeSingle() : { data: null }
  const sel = (one as ReportRow | null) ?? null
  const n = Object.fromEntries(counts)

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-surface/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1100px] items-center justify-between px-4 md:px-8">
          <Logo href="/dashboard" />
          <span className="truncate pl-3 text-[12.5px] text-muted">{who.email}</span>
        </div>
      </header>
      <main className="mx-auto max-w-[1100px] px-4 pb-16 pt-6 md:px-8 md:pt-10">
        <Eyebrow>Admin · correctness</Eyebrow>
        <h1 className="mt-1 font-display text-[30px] leading-[1.1] text-ink md:text-[38px]">Mistake reports</h1>
        <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-muted">What learners flagged. Confirm real mistakes (wrong pictures go on the blocklist), dismiss the rest, and turn each confirmed one into a regression case.</p>
        <div className="mt-4 flex flex-wrap gap-2 text-[12.5px] text-ink-2">
          <span className="rounded-full border border-line bg-surface px-3 py-1">{cases ?? 0} regression cases from reports</span>
          <span className="rounded-full border border-line bg-surface px-3 py-1">{blocks ?? 0} blocklist entries</span>
        </div>
        <nav aria-label="Report status" className="mt-6 flex gap-0 overflow-x-auto border-b border-line sm:gap-1">
          {(['open', 'confirmed', 'invalid'] as const).map(s => (
            <Link key={s} href={`/admin/reports?status=${s}`} className={cx('-mb-px inline-flex min-h-11 flex-shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 text-[14px] font-medium sm:gap-2 sm:px-3', status === s ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')}>
              {s === 'invalid' ? 'Not a mistake' : s[0].toUpperCase() + s.slice(1)}<span className="tnum rounded-full bg-sunken px-1.5 text-[11.5px] text-muted">{n[s]}</span>
            </Link>
          ))}
        </nav>
        <div className="mt-5 grid gap-5 lg:grid-cols-[380px_1fr]">
          <ol className={cx('space-y-2', sel && 'hidden lg:block')} aria-label="Reports">
            {list.length === 0 && <li className="rounded-[14px] border border-dashed border-line-strong bg-surface px-4 py-8 text-center text-[14px] text-muted">Nothing here.</li>}
            {list.map(r => (
              <li key={r.id}>
                <Link href={`/admin/reports?status=${status}&id=${r.id}`} className={cx('block rounded-[14px] border bg-surface px-4 py-3 shadow-[var(--shadow-card)] transition-colors', sel?.id === r.id ? 'border-accent' : 'border-line hover:border-line-strong')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-ink">{SURFACE[r.surface] ?? r.surface}{r.category ? <span className="font-normal text-muted"> · {CATEGORY[r.category]}</span> : null}</span>
                    <span className="tnum flex-shrink-0 text-[12px] text-faint">{when(r.created_at)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[14px] leading-snug text-ink-2">{r.note || summary(r) || 'No note'}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11.5px]">
                    {(r.guard as { flagged?: boolean } | null)?.flagged && <span className="rounded-full border border-clay-line bg-clay-soft px-2 py-0.5 text-clay">guard agrees</span>}
                    {r.regression_case_id && <span className="rounded-full border border-accent-line bg-accent-soft px-2 py-0.5 text-accent">in regression set</span>}
                    {r.model && <span className="rounded-full border border-line px-2 py-0.5 text-muted">{r.model}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ol>
          {sel ? (
            <section aria-label="Report" className="min-w-0 rounded-[16px] border border-line bg-surface p-4 shadow-[var(--shadow-card)] md:p-6">
              <Link href={`/admin/reports?status=${status}`} className="-ml-1 mb-2 inline-flex min-h-11 items-center text-[13px] text-muted hover:text-ink lg:hidden">← All {status} reports</Link>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cx('rounded-full border px-2.5 py-0.5 text-[12px] font-medium', STATUS_TONE[sel.status])}>{sel.status === 'invalid' ? 'Not a mistake' : sel.status}</span>
                <span className="text-[13px] text-muted">{SURFACE[sel.surface] ?? sel.surface} · {when(sel.created_at)}</span>
              </div>
              <h2 className="mt-2 font-display text-[24px] leading-tight text-ink">{sel.category ? CATEGORY[sel.category] : 'Mistake reported'}</h2>
              {sel.note && <blockquote className="mt-2 border-l-2 border-accent-line pl-3 text-[15px] leading-relaxed text-ink-2">“{sel.note}”</blockquote>}
              <dl className="mt-4 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                {sel.query && <><dt className="text-muted">Query</dt><dd className="text-ink-2">{sel.query}</dd></>}
                {sel.illustration_id && <><dt className="text-muted">Illustration</dt><dd className="break-all font-mono text-[12px] text-ink-2">{sel.illustration_id}</dd></>}
                {sel.lesson_id && <><dt className="text-muted">Lesson step</dt><dd className="font-mono text-[12px] text-ink-2">{sel.step_index ?? '—'}</dd></>}
                {sel.clip_job_id && <><dt className="text-muted">Clip job</dt><dd className="break-all font-mono text-[12px] text-ink-2">{sel.clip_job_id}</dd></>}
                <dt className="text-muted">Model</dt><dd className="text-ink-2">{sel.model ?? '—'}</dd>
                <dt className="text-muted">Guard now</dt><dd className="text-ink-2">{guardLine(sel.guard)}</dd>
              </dl>
              <TriageActions id={sel.id} status={sel.status} inRegression={!!sel.regression_case_id} />
              <h3 className="mb-2 mt-6 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">What the learner saw</h3>
              <ArtefactView artefact={sel.artefact} />
              <details className="mt-4 rounded-[12px] border border-line bg-[#FBFAF7]">
                <summary className="flex min-h-11 cursor-pointer items-center px-3 text-[13px] font-medium text-ink-2">Raw artefact and trace</summary>
                <pre className="max-h-[420px] overflow-auto border-t border-line px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink-2">{JSON.stringify({ artefact: sel.artefact, trace: sel.trace, guard: sel.guard }, (k, v) => (k === 'svg' && typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}… (${v.length} chars)` : v), 2).slice(0, 60_000)}</pre>
              </details>
            </section>
          ) : (
            <section className="hidden rounded-[16px] border border-dashed border-line-strong bg-surface/60 p-10 text-center text-[14px] text-muted lg:block">Pick a report to see exactly what the learner saw.</section>
          )}
        </div>
      </main>
    </div>
  )
}

function summary(r: ReportRow): string {
  const a = r.artefact as { text?: string; question?: string; step?: { say?: string; text?: string; prompt?: string }; block?: { kind?: string; title?: string; alt?: string } }
  return (a.block ? `${a.block.kind}: ${a.block.title ?? a.block.alt ?? ''}` : a.step ? a.step.prompt ?? a.step.text ?? a.step.say ?? '' : a.text ?? a.question ?? '').slice(0, 140)
}
function guardLine(g: unknown): string {
  const x = g as { flagged?: boolean; issues?: string[] } | null
  if (!x) return '—'
  return x.flagged ? `flags it: ${(x.issues ?? []).slice(0, 2).join('; ')}` : 'does not catch this (a regression case will fail until it does)'
}

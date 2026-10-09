import React from 'react'
import { RichText } from '@/components/rich-text'
import Link from 'next/link'
import clsx, { type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cx(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/* ───────────── Brand ───────────── */

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex h-7 w-7 items-center justify-center rounded-[8px] bg-accent text-[15px] leading-none text-white font-display',
        className,
      )}
    >
      G
    </span>
  )
}

export function Logo({ href = '/', className, inverted = false }: { href?: string; className?: string; inverted?: boolean }) {
  return (
    <Link href={href} className={cx('inline-flex items-center gap-2.5 rounded-md', className)}>
      <LogoMark className={inverted ? 'bg-white text-accent' : undefined} />
      <span className={cx('font-display text-[19px] font-medium tracking-tight', inverted ? 'text-white' : 'text-ink')}>
        GeniusMap
      </span>
    </Link>
  )
}

/* ───────────── Buttons & inputs ───────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
type ButtonSize = 'sm' | 'md' | 'lg'

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-[10px] font-medium whitespace-nowrap select-none',
    'transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45',
    {
      'h-8 px-3 text-[13px]': size === 'sm',
      'h-10 px-4 text-sm': size === 'md',
      'h-12 px-6 text-[15px]': size === 'lg',
      'bg-accent text-white hover:bg-accent-hover': variant === 'primary',
      'bg-surface text-ink border border-line hover:border-line-strong hover:bg-[#FBFAF7] shadow-[var(--shadow-card)]': variant === 'secondary',
      'text-ink-2 hover:text-ink hover:bg-sunken': variant === 'ghost',
      'bg-sunken text-ink hover:bg-[#E9E5DC]': variant === 'subtle',
      'bg-danger text-white hover:bg-[#8A1F16]': variant === 'danger',
    },
    className,
  )
}

export const inputClass =
  'block w-full h-11 rounded-[10px] border border-line bg-surface px-3.5 text-[15px] text-ink placeholder:text-faint ' +
  'transition-colors duration-150 hover:border-line-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15'

export const textareaClass =
  'block w-full rounded-[10px] border border-line bg-surface px-3.5 py-3 text-[15px] leading-relaxed text-ink placeholder:text-faint ' +
  'transition-colors duration-150 hover:border-line-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15 resize-y'

export const labelClass = 'mb-1.5 block text-[13px] font-medium text-ink-2'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx('inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent opacity-70', className)}
    />
  )
}

/* ───────────── Layout primitives ───────────── */

export function Card({
  children,
  className,
  as: Tag = 'div',
  padded = true,
}: {
  children: React.ReactNode
  className?: string
  as?: React.ElementType
  padded?: boolean
}) {
  return (
    <Tag className={cx('rounded-[14px] border border-line bg-surface shadow-[var(--shadow-card)]', padded && 'p-5 md:p-6', className)}>
      {children}
    </Tag>
  )
}

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cx('text-[12px] font-medium uppercase tracking-[0.08em] text-muted', className)}>{children}</p>
}

export function SectionTitle({ children, className, action }: { children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <div className={cx('mb-3 flex items-center justify-between gap-4', className)}>
      <h2 className="text-[15px] font-semibold text-ink">{children}</h2>
      {action}
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <Eyebrow className="mb-2">{eyebrow}</Eyebrow>}
        <h1 className="font-display text-[30px] leading-[1.1] text-ink md:text-[38px]">{title}</h1>
        {description && <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">{typeof description === 'string' ? <RichText text={description} /> : description}</p>}
      </div>
      {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: React.ReactNode
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex flex-col items-center rounded-[14px] border border-dashed border-line-strong bg-surface/60 px-6 py-12 text-center', className)}>
      {icon && (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-muted">
          {icon}
        </div>
      )}
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {children && <div className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Alert({
  tone = 'danger',
  title,
  children,
  action,
  className,
}: {
  tone?: 'danger' | 'info' | 'warning' | 'success'
  title?: React.ReactNode
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  const tones = {
    danger: 'bg-danger-soft border-danger-line text-danger',
    info: 'bg-navy-soft border-navy-line text-navy',
    warning: 'bg-amber-soft border-amber-line text-amber',
    success: 'bg-accent-soft border-accent-line text-accent',
  }
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex flex-col gap-3 rounded-[12px] border px-4 py-3 sm:flex-row sm:items-center', tones[tone], className)}>
      <div className="min-w-0 flex-1 text-sm leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(title && 'mt-0.5', 'text-ink-2')}>{children}</div>}
      </div>
      {action}
    </div>
  )
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cx('skeleton', className)} style={style} />
}

export function Avatar({ initials, size = 'md', className }: { initials: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex flex-shrink-0 items-center justify-center rounded-full border border-accent-line bg-accent-soft font-medium text-accent',
        { 'h-8 w-8 text-[12px]': size === 'sm', 'h-10 w-10 text-[13px]': size === 'md', 'h-14 w-14 text-base': size === 'lg' },
        className,
      )}
    >
      {initials}
    </span>
  )
}

export function initialsOf(name?: string | null) {
  if (!name) return '·'
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

/* ───────────── Status ───────────── */

export const statusConfig: Record<string, { label: string; className: string; dot: string }> = {
  assigned:       { label: 'Assigned',     className: 'bg-amber-soft text-amber border-amber-line', dot: 'bg-amber' },
  in_progress:    { label: 'In progress',  className: 'bg-navy-soft text-navy border-navy-line',    dot: 'bg-navy' },
  pending_review: { label: 'In review',    className: 'bg-clay-soft text-clay border-clay-line',    dot: 'bg-clay' },
  completed:      { label: 'Approved',     className: 'bg-accent-soft text-accent border-accent-line', dot: 'bg-accent' },
}

export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[12px] font-medium', className)}>
      {children}
    </span>
  )
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const sc = statusConfig[status] ?? statusConfig.assigned
  return (
    <Badge className={sc.className}>
      <span className={cx('h-1.5 w-1.5 rounded-full', sc.dot)} />
      {label ?? sc.label}
    </Badge>
  )
}

export function DifficultyBadge({ difficulty }: { difficulty?: string | null }) {
  if (!difficulty) return null
  return <Badge className="border-line bg-sunken capitalize text-ink-2">{difficulty}</Badge>
}

export function gradeTone(score: number) {
  if (score >= 8) return 'text-accent'
  if (score >= 6) return 'text-amber'
  return 'text-danger'
}

/* ───────────── Data viz ───────────── */

export function ProgressBar({
  value,
  max = 100,
  className,
  label,
  tone = 'accent',
}: {
  value: number
  max?: number
  className?: string
  label?: string
  tone?: 'accent' | 'ink'
}) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cx('h-1.5 w-full overflow-hidden rounded-full bg-sunken', className)}
    >
      <div
        className={cx('h-full rounded-full transition-[width] duration-500 ease-out', tone === 'accent' ? 'bg-accent' : 'bg-ink')}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function Stat({ label, value, hint, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <p className="text-[13px] text-muted">{label}</p>
      <p className="tnum mt-1 font-display text-[30px] leading-none text-ink">{value}</p>
      {hint && <p className="mt-1.5 text-[12px] text-faint">{hint}</p>}
    </div>
  )
}

/* ───────────── Sheets ───────────── */

/** The small handle at the top of a bottom sheet: it says "this slides away" (affordance) and anchors the eye. */
export function SheetGrabber({ className }: { className?: string }) {
  return <div aria-hidden className={cx('mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong sm:hidden', className)} />
}

/* ───────────── System pages (404, errors) ───────────── */

/**
 * A calm full-page message for "not found" and "something went wrong": what happened in plain words, that nothing the
 * learner did is lost, and one clear way forward (one primary action, Hick's law). Never a bare status code.
 */
export function SystemMessage({ eyebrow, title, children, actions, art }: {
  eyebrow: string
  title: React.ReactNode
  children?: React.ReactNode
  actions?: React.ReactNode
  art?: React.ReactNode
}) {
  return (
    <div className="mx-auto flex min-h-[62vh] w-full max-w-md flex-col justify-center px-1 py-10">
      {art && <div className="mb-6">{art}</div>}
      <Eyebrow className="mb-3">{eyebrow}</Eyebrow>
      <h1 className="font-display text-[32px] leading-[1.1] text-ink md:text-[38px]">{title}</h1>
      {children && <div className="mt-3 text-[15px] leading-relaxed text-muted">{children}</div>}
      {actions && <div className="mt-8 flex flex-col gap-2 sm:flex-row">{actions}</div>}
    </div>
  )
}

/** A tiny board sketch for system pages: a dashed path that wanders off the map (on-brand, not a stock illustration). */
export function LostMapArt() {
  return (
    <svg viewBox="0 0 220 120" className="h-auto w-[180px]" role="img" aria-label="A dotted path on a map that ends at a question mark">
      <rect x="1" y="1" width="218" height="118" rx="14" fill="#FDFCF9" stroke="#E5E1D8" />
      <path d="M22 94 C 52 94, 52 52, 86 56 S 120 92, 150 70" fill="none" stroke="#1F4D3A" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 9" />
      <circle cx="22" cy="94" r="6" fill="#1F4D3A" />
      <text x="176" y="80" fontSize="44" fill="#A4502A" fontFamily="var(--font-serif), Georgia, serif" fontStyle="italic" textAnchor="middle">?</text>
    </svg>
  )
}

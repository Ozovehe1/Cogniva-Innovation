import Link from 'next/link'
import { Logo, buttonClass } from '@/components/ui'

/** The sample lesson at /learn/demo (noindex) is public. */
export const demoAvailable = false

export function SiteHeader() {
  return (
    <header className="pt-safe sticky top-0 z-40 border-b border-line/80 bg-canvas/90 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between gap-3 px-5 md:px-8">
        <Logo />
        <nav className="flex items-center gap-0.5 sm:gap-2" aria-label="Main">
          <Link href="/about" className={buttonClass('ghost', 'md')}>About</Link>
          <span className="hidden sm:contents">
            <Link href="/login" className={buttonClass('ghost', 'md')}>Sign in</Link>
          </span>
          <Link href="/signup" className={buttonClass('primary', 'md')}>Get started</Link>
        </nav>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="pb-safe mx-auto flex max-w-[1120px] flex-col gap-4 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between md:px-8">
        <Logo />
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-1 [&>a]:inline-flex [&>a]:min-h-11 [&>a]:items-center" aria-label="Footer">
          <Link href="/about" className="hover:text-ink">About</Link>
          {demoAvailable && <Link href="/learn/demo" className="hover:text-ink">Sample lesson</Link>}
          <Link href="/credits" className="hover:text-ink">Credits</Link>
          <Link href="/login" className="hover:text-ink">Sign in</Link>
          <span>© {new Date().getFullYear()} Ideanimo</span>
        </nav>
      </div>
    </footer>
  )
}

/**
 * A static picture of a lesson: the board, a line of the transcript
 * and a quick check. Illustration only; the real player is in components/whiteboard.
 */
export function LessonIllustration() {
  // Parabola y = x^2 on x in [-0.5, 2.6], drawn into a 260 x 200 frame.
  const fx = (x: number) => 20 + ((x + 0.5) / 3.1) * 240
  const fy = (y: number) => 190 - ((y + 0.5) / 6.5) * 180
  const curve = Array.from({ length: 41 }, (_, i) => {
    const x = -0.5 + (i / 40) * 2.95
    return `${i ? 'L' : 'M'}${fx(x).toFixed(1)} ${fy(x * x).toFixed(1)}`
  }).join(' ')
  return (
    <div className="rounded-[18px] border border-line bg-surface p-3 shadow-[var(--shadow-raised)] sm:p-4">
      <div className="rounded-[12px] border border-line bg-[#FDFCF9] p-4 sm:p-5">
        <p className="font-display text-[22px] leading-tight text-ink">What is a derivative?</p>
        <div className="mt-3 grid items-center gap-3 sm:grid-cols-[1.25fr_1fr]">
          <svg viewBox="0 0 280 200" className="mx-auto h-auto w-full max-w-[320px]" role="img" aria-label="The curve y equals x squared with its tangent line at the point P">
            <line x1={fx(-0.5)} y1={fy(0)} x2={fx(2.6)} y2={fy(0)} stroke="#66666F" strokeWidth="1.4" />
            <line x1={fx(0)} y1={fy(-0.5)} x2={fx(0)} y2={fy(6)} stroke="#66666F" strokeWidth="1.4" />
            <path d={curve} fill="none" stroke="#1F4D3A" strokeWidth="3" strokeLinecap="round" />
            <line x1={fx(0.25)} y1={fy(-0.5)} x2={fx(2.5)} y2={fy(4)} stroke="#23406A" strokeWidth="2.6" strokeLinecap="round" />
            <circle cx={fx(1)} cy={fy(1)} r="5" fill="#14141A" />
            <text x={fx(1) - 12} y={fy(1) - 8} fontSize="20" fontStyle="italic" textAnchor="end" fill="#14141A" style={{ fontFamily: 'var(--font-serif)' }}>P</text>
            <text x={fx(2.6)} y={fy(0) + 20} fontSize="18" fontStyle="italic" textAnchor="end" fill="#14141A" style={{ fontFamily: 'var(--font-serif)' }}>x</text>
          </svg>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 font-display text-ink sm:block sm:space-y-2">
            <p className="text-[19px] text-accent">y = x²</p>
            <p className="text-[19px] text-[#23406A]">f′(1) = 2</p>
            <p className="w-full font-sans text-[14px] leading-snug text-ink-2">The derivative is the slope of the tangent line.</p>
          </div>
        </div>
      </div>
      <div className="mt-3 rounded-[12px] border border-line px-4 py-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Transcript</p>
        <p className="mt-1.5 border-l-2 border-accent pl-3 font-display text-[16px] leading-snug text-ink">
          Let h shrink to zero. The secant settles into one line that just touches the curve at P.
        </p>
      </div>
      <div className="mt-3 rounded-[12px] border border-line px-4 py-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Quick check</p>
        <p className="mt-1 text-[15px] leading-snug text-ink">Why is the tangent’s slope the limit of the secant slopes?</p>
        <div className="mt-2.5 flex flex-wrap gap-2 text-[13px]">
          <span className="rounded-full bg-accent px-3 py-1 font-medium text-white">Got it</span>
          <span className="rounded-full border border-line-strong px-3 py-1 text-ink-2">Explain differently</span>
        </div>
      </div>
    </div>
  )
}

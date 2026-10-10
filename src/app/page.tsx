import Link from 'next/link'
import { ArrowRight, Image as ImageIcon, MousePointer2, RotateCcw } from 'lucide-react'
import { buttonClass } from '@/components/ui'
import { LessonIllustration, SiteFooter, SiteHeader } from '@/components/site-chrome'
import { SiteScene } from '@/components/site-scene'

const benefits = [
  { icon: ImageIcon, title: 'Real pictures, exact diagrams' },
  { icon: MousePointer2, title: 'Figures you can move' },
  { icon: RotateCcw, title: 'Checks that re-explain' },
]

const steps = [
  { n: '01', title: 'Say your goal', desc: 'In your own words.' },
  { n: '02', title: 'Take a quick check', desc: 'No score. No timer.' },
  { n: '03', title: 'Learn at your pace', desc: 'Lessons written for you.' },
]

export default function HomePage() {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <SiteHeader />

      <main>
        {/* Hero: one promise, one action, then the product itself. */}
        <section className="mx-auto grid max-w-[1120px] gap-10 px-5 pb-16 pt-10 md:px-8 md:pb-24 md:pt-20 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16">
          <div>
            <h1 className="font-display text-[44px] leading-[1.04] text-ink sm:text-[56px] md:text-[68px]">
              Start from what you know. Learn <em className="italic text-accent">what’s next.</em>
            </h1>
            <p className="mt-5 max-w-[34rem] text-[17px] leading-relaxed text-ink-2 md:text-lg">An AI tutor that shows every idea, at your pace.</p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
              <Link href="/signup" className={buttonClass('primary', 'lg')}>
                Get started
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </Link>
              <p className="text-center text-sm text-muted sm:text-left">Have an account? <Link href="/login" className="font-medium text-accent underline-offset-4 hover:underline">Sign in</Link></p>
            </div>
          </div>

          <figure>
            <SiteScene kind="projectile" />
            <figcaption className="mt-3 text-center text-[13px] text-faint">Live from the app. Drag a slider.</figcaption>
          </figure>
        </section>

        {/* The lesson */}
        <section className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-[1120px] gap-10 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-16">
            <div>
              <h2 className="font-display text-[34px] leading-tight md:text-[44px]">Watch it, hear it, ask about it.</h2>
              <ul className="mt-8 grid gap-3">
                {benefits.map(({ icon: Icon, title }) => (
                  <li key={title} className="flex items-center gap-3 text-[17px] font-semibold">
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"><Icon className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden /></span>
                    {title}
                  </li>
                ))}
              </ul>
            </div>
            <figure aria-label="A lesson in progress">
              <LessonIllustration />
            </figure>
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-[1120px] px-5 py-16 md:px-8 md:py-24">
          <h2 className="max-w-2xl font-display text-[34px] leading-tight md:text-[44px]">Your first lesson in minutes.</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {steps.map(({ n, title, desc }) => (
              <li key={n} className="border-t border-ink pt-5">
                <p className="tnum font-display text-[15px] text-accent">{n}</p>
                <h3 className="mt-2 text-lg font-semibold">{title}</h3>
                <p className="mt-1 text-[15px] text-muted">{desc}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Start */}
        <section className="mx-auto max-w-[1120px] px-5 pb-16 md:px-8 md:pb-24">
          <div className="grid gap-6 rounded-[18px] bg-accent px-6 py-10 text-white md:grid-cols-[1.4fr_1fr] md:items-center md:px-12 md:py-14">
            <div>
              <h2 className="font-display text-[30px] leading-tight md:text-[40px]">What do you want to learn?</h2>
              <p className="mt-3 text-[15px] text-white/80">Under 18? A parent or guardian agrees first.</p>
            </div>
            <div className="flex md:justify-end">
              <Link
                href="/signup"
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-white px-6 text-[15px] font-medium text-accent transition-colors duration-150 hover:bg-[#F1EEE7] sm:w-auto"
              >
                Get started
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}

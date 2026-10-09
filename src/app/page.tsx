import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { buttonClass } from '@/components/ui'
import { LessonIllustration, SiteFooter, SiteHeader, demoAvailable } from '@/components/site-chrome'

const lessonFeatures = [
  {
    title: 'A tutor that owns its board',
    desc: 'Your tutor writes and draws on its own whiteboard, one line at a time, and can point at, change or redraw any part of it when you ask.',
  },
  {
    title: 'Exact diagrams, real pictures',
    desc: 'Graphs and shapes are computed from the maths. Organs, cells and circuits come from free scientific illustration libraries, each credited to its author.',
  },
  {
    title: 'Figures you can move',
    desc: 'For ideas that change, the tutor demonstrates on a live figure, then hands it to you: drag the point, move the slider, find the answer yourself.',
  },
  {
    title: 'Checks that re-explain',
    desc: 'Short questions see whether an idea landed. A miss gets a “not yet” and another way to see it, never a red cross. Anything that looks wrong can be reported in one tap.',
  },
]

const steps = [
  {
    n: '01',
    title: 'It gets to know you',
    desc: 'A short conversation about what you want to learn, why it matters to you, your class or year, the time you have, and how you are feeling today. Skip anything you like.',
  },
  {
    n: '02',
    title: 'It finds where to start',
    desc: 'A quick adaptive check of about 6 to 10 questions. Each answer decides the next, and you tap how sure you were. You see what you know now and what is next. No score, no label.',
  },
  {
    n: '03',
    title: 'It teaches at your level and pace',
    desc: 'Lessons are written for you, with examples from your interests and your purpose, sized to your week. A short mastery check unlocks each next topic.',
  },
]

const principles = [
  { label: 'Prior knowledge first', desc: 'Teaching starts from what you can already do, not from your class level alone.' },
  { label: 'No learning-style labels', desc: 'Research does not support matching lessons to a “style”, so we never sort you into one.' },
  { label: 'Mastery before moving on', desc: 'Each topic ends with a short check; a miss leads to a review, not a penalty.' },
  { label: 'How you feel counts', desc: 'Quick private check-ins let the tutor slow down, show an example or suggest a break.' },
]

export default function HomePage() {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-[1120px] gap-12 px-5 pb-16 pt-12 md:px-8 md:pb-24 md:pt-20 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16">
          <div>
            <p className="mb-5 text-[13px] font-medium uppercase tracking-[0.08em] text-accent">An AI tutor for one learner at a time</p>
            <h1 className="font-display text-[44px] leading-[1.04] text-ink sm:text-[56px] md:text-[68px]">
              Start from what you know. Learn <em className="italic text-accent">what’s next.</em>
            </h1>
            <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-ink-2 md:text-lg">
              GeniusMap is an AI tutor. It asks what you want to learn, why, and how you&apos;re feeling, runs a
              short adaptive check to find what you already know, then teaches you on a live whiteboard with a
              natural voice and animations, at your level and your pace.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/signup" className={buttonClass('primary', 'lg')}>
                Get started
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </Link>
              {demoAvailable ? (
                <Link href="/learn/demo" className={buttonClass('secondary', 'lg')}>Watch a sample lesson</Link>
              ) : (
                <Link href="/login" className={buttonClass('secondary', 'lg')}>I already have an account</Link>
              )}
            </div>
            <p className="mt-5 text-sm text-muted">Works on your phone. Takes about five minutes to set up.</p>
          </div>

          <figure>
            <LessonIllustration />
            <figcaption className="mt-3 text-center text-[13px] text-faint">An illustration of a lesson in progress.</figcaption>
          </figure>
        </section>

        {/* Live Tutor */}
        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-[1120px] px-5 py-16 md:px-8 md:py-24">
            <div className="max-w-2xl">
              <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">The lesson</p>
              <h2 className="mt-3 font-display text-[34px] leading-tight md:text-[44px]">A lesson you can watch, hear and question.</h2>
              <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
                Built for understanding rather than memorising, in subjects that can be taught at a board, from
                quadratic equations to sizing a solar system. Every lesson is written by the AI for you; no one
                else&apos;s syllabus decides your starting point.
              </p>
            </div>
            <ul className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2">
              {lessonFeatures.map(({ title, desc }) => (
                <li key={title} className="border-t border-ink pt-5">
                  <h3 className="text-lg font-semibold">{title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">{desc}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-[1120px] px-5 py-16 md:px-8 md:py-24">
          <div className="max-w-2xl">
            <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">How it works</p>
            <h2 className="mt-3 font-display text-[34px] leading-tight md:text-[44px]">Know you, find your level, then teach.</h2>
          </div>
          <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
            {steps.map(({ n, title, desc }) => (
              <li key={n} className="border-t border-ink pt-5">
                <p className="tnum font-display text-[15px] text-accent">{n}</p>
                <h3 className="mt-3 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{desc}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Principles */}
        <section className="border-t border-line">
          <div className="mx-auto grid max-w-[1120px] gap-10 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
            <div>
              <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">How it decides</p>
              <h2 className="mt-3 font-display text-[34px] leading-tight md:text-[44px]">What you know, not what type you are.</h2>
              <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
                The intake and the adaptive check follow well-studied ideas: teach from prior knowledge, check mastery
                before moving on, and pay attention to confidence and mood. <Link href="/about" className="font-medium text-accent underline-offset-4 hover:underline">Read how it works</Link>.
              </p>
            </div>
            <dl className="grid grid-cols-1 border-t border-line sm:grid-cols-2">
              {principles.map(({ label, desc }) => (
                <div key={label} className="border-b border-line py-4 sm:odd:pr-6 sm:even:border-l sm:even:pl-6">
                  <dt className="text-[15px] font-semibold">{label}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-muted">{desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Start */}
        <section className="mx-auto max-w-[1120px] px-5 pb-16 md:px-8 md:pb-24">
          <div className="grid gap-8 rounded-[18px] bg-accent px-6 py-10 text-white md:grid-cols-[1.4fr_1fr] md:items-center md:px-12 md:py-14">
            <div>
              <h2 className="font-display text-[30px] leading-tight md:text-[40px]">Tell it what you want to learn.</h2>
              <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/80">
                A few questions, a short check, and your first lesson is written for you. If you&apos;re under 18,
                we ask a parent or guardian to agree first.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row md:justify-end">
              <Link
                href="/signup"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[10px] bg-white px-6 text-[15px] font-medium text-accent transition-colors duration-150 hover:bg-[#F1EEE7]"
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

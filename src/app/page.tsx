import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Logo, ScoreBars, buttonClass } from '@/components/ui'

const steps = [
  {
    n: '01',
    title: 'Answer 24 short statements',
    desc: 'Each one describes an everyday behaviour. You say how much it sounds like you, from “not me” to “exactly me”. There are no right answers.',
  },
  {
    n: '02',
    title: 'Read your profile',
    desc: 'You get a score for each of the eight intelligences, a plain-language summary of how you tend to learn, study suggestions and career directions to explore.',
  },
  {
    n: '03',
    title: 'Work on matched projects',
    desc: 'Connect with your tutor using their code. They see your profile, assign projects that fit it, and review your work. Approved projects move you up through the levels.',
  },
]

const intelligences = [
  { label: 'Linguistic', desc: 'Thinking in words; reading, writing, explaining.' },
  { label: 'Logical–mathematical', desc: 'Reasoning, patterns, cause and effect.' },
  { label: 'Spatial', desc: 'Visualising, mapping, design and form.' },
  { label: 'Musical', desc: 'Rhythm, pitch and sensitivity to sound.' },
  { label: 'Bodily–kinesthetic', desc: 'Learning by doing, movement and craft.' },
  { label: 'Interpersonal', desc: 'Reading people and working in groups.' },
  { label: 'Intrapersonal', desc: 'Reflection and self-knowledge.' },
  { label: 'Naturalist', desc: 'Noticing and classifying the living world.' },
]

const exampleScores = {
  spatial: 8,
  logicalMathematical: 7,
  intrapersonal: 7,
  naturalist: 6,
  linguistic: 5,
  bodilyKinesthetic: 5,
}

export default function HomePage() {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      {/* Nav */}
      <header className="pt-safe sticky top-0 z-40 border-b border-line/80 bg-canvas/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between px-5 md:px-8">
          <Logo />
          <nav className="flex items-center gap-1 sm:gap-2" aria-label="Account">
            <Link href="/login" className={buttonClass('ghost', 'md')}>Sign in</Link>
            <Link href="/signup" className={buttonClass('primary', 'md')}>Get started</Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-[1120px] gap-12 px-5 pb-16 pt-12 md:px-8 md:pb-24 md:pt-20 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-16">
          <div>
            <p className="mb-5 text-[13px] font-medium uppercase tracking-[0.08em] text-accent">For students and tutors</p>
            <h1 className="font-display text-[44px] leading-[1.04] text-ink sm:text-[56px] md:text-[68px]">
              Learn the way your mind <em className="italic text-accent">already</em> works.
            </h1>
            <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-ink-2 md:text-lg">
              GeniusMap helps you understand where your strengths lie across Howard Gardner&apos;s eight
              intelligences, then gives your tutor what they need to set work that fits you.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/signup" className={buttonClass('primary', 'lg')}>
                Take the assessment
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </Link>
              <Link href="/login" className={buttonClass('secondary', 'lg')}>I already have an account</Link>
            </div>
            <p className="mt-5 text-sm text-muted">Free to use. Takes a few minutes.</p>
          </div>

          {/* Example profile */}
          <figure className="relative">
            <div className="rounded-[18px] border border-line bg-surface p-6 shadow-[var(--shadow-raised)] md:p-8">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Strongest area</p>
                  <p className="mt-1.5 font-display text-[28px] leading-tight">Spatial</p>
                </div>
                <span className="rounded-full border border-line bg-sunken px-2.5 py-1 text-[12px] text-muted">Example</span>
              </div>
              <ScoreBars scores={exampleScores} compact />
              <div className="mt-6 border-t border-line pt-5">
                <p className="font-display text-[17px] italic leading-snug text-ink-2">
                  “You understand things best when you can see how the parts fit together.”
                </p>
              </div>
            </div>
            <figcaption className="mt-3 text-center text-[13px] text-faint">An illustrative profile, not real student data.</figcaption>
          </figure>
        </section>

        {/* How it works */}
        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-[1120px] px-5 py-16 md:px-8 md:py-24">
            <div className="max-w-2xl">
              <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">How it works</p>
              <h2 className="mt-3 font-display text-[34px] leading-tight md:text-[44px]">Three steps, from self-knowledge to real work.</h2>
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
          </div>
        </section>

        {/* The eight intelligences */}
        <section className="mx-auto max-w-[1120px] px-5 py-16 md:px-8 md:py-24">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
            <div>
              <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">The framework</p>
              <h2 className="mt-3 font-display text-[34px] leading-tight md:text-[44px]">Eight ways of being smart.</h2>
              <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
                The model comes from Howard Gardner&apos;s <em>Frames of Mind</em> (1983). We use it as a lens for
                reflection and conversation with your tutor, not as a test of ability or a fixed label.
              </p>
            </div>
            <dl className="grid grid-cols-1 border-t border-line sm:grid-cols-2">
              {intelligences.map(({ label, desc }) => (
                <div key={label} className="border-b border-line py-4 sm:odd:pr-6 sm:even:border-l sm:even:pl-6">
                  <dt className="text-[15px] font-semibold">{label}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-muted">{desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Tutors */}
        <section className="mx-auto max-w-[1120px] px-5 pb-16 md:px-8 md:pb-24">
          <div className="grid gap-8 rounded-[18px] bg-accent px-6 py-10 text-white md:grid-cols-[1.4fr_1fr] md:items-center md:px-12 md:py-14">
            <div>
              <h2 className="font-display text-[30px] leading-tight md:text-[40px]">Teaching a group?</h2>
              <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/80">
                Sign up as a tutor to get a short code your students use to connect. You&apos;ll see each
                student&apos;s profile, create and assign projects, and grade submitted work from one place.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row md:justify-end">
              <Link
                href="/signup"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[10px] bg-white px-6 text-[15px] font-medium text-accent transition-colors duration-150 hover:bg-[#F1EEE7]"
              >
                Create a tutor account
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="pb-safe mx-auto flex max-w-[1120px] flex-col gap-4 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between md:px-8">
          <Logo />
          <p>© {new Date().getFullYear()} GeniusMap</p>
        </div>
      </footer>
    </div>
  )
}

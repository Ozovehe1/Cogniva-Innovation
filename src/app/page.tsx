import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { ScoreBars, buttonClass } from '@/components/ui'
import { LessonIllustration, SiteFooter, SiteHeader, demoAvailable } from '@/components/site-chrome'

const lessonFeatures = [
  {
    title: 'Written out, step by step',
    desc: 'Each lesson plays on a whiteboard. Ideas are written one line at a time and equations change in place, so you can follow how one step becomes the next.',
  },
  {
    title: 'Diagrams that move',
    desc: 'Graphs, shapes and points are drawn as they are explained. Where a still drawing is not enough, tutors can add a short rendered animation.',
  },
  {
    title: 'Spoken, with a transcript',
    desc: 'The explanation is read aloud using your device’s voice, and every line is kept in a transcript you can scroll back through. Turn the voice off at any time.',
  },
  {
    title: 'Checks that re-explain',
    desc: 'Short questions stop the lesson to see whether an idea landed. If it did not, the tutor explains it again in a different way rather than repeating itself.',
  },
]

const steps = [
  {
    n: '01',
    title: 'Map how you like to learn',
    desc: 'Answer 24 short statements about everyday behaviour. You get a profile across Howard Gardner’s eight intelligences: a picture of your learning preferences, not a verdict on ability.',
  },
  {
    n: '02',
    title: 'Learn with Live Tutor',
    desc: 'Work through lessons your tutors have written and approved, on the whiteboard, at your own pace. Pause, replay any step, and ask for another explanation when you need one.',
  },
  {
    n: '03',
    title: 'Put it to work in projects',
    desc: 'Connect with your tutor using their code. They see your profile, set projects that suit how you work, and review what you submit. Approved projects move you up through the levels.',
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
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-[1120px] gap-12 px-5 pb-16 pt-12 md:px-8 md:pb-24 md:pt-20 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16">
          <div>
            <p className="mb-5 text-[13px] font-medium uppercase tracking-[0.08em] text-accent">Live Tutor · For students and tutors</p>
            <h1 className="font-display text-[44px] leading-[1.04] text-ink sm:text-[56px] md:text-[68px]">
              Learn the way your mind <em className="italic text-accent">already</em> works.
            </h1>
            <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-ink-2 md:text-lg">
              GeniusMap teaches on a live whiteboard. Each idea is written out step by step, drawn as it is
              explained and read aloud, with quick checks that explain it another way when it hasn&apos;t
              landed. Tutors write and approve every lesson.
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
            <p className="mt-5 text-sm text-muted">Free to use. Works on your phone.</p>
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
              <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">Live Tutor</p>
              <h2 className="mt-3 font-display text-[34px] leading-tight md:text-[44px]">A lesson you can watch, hear and question.</h2>
              <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
                Live Tutor is built for understanding rather than memorising. It works for any subject a tutor can
                explain at a board, from calculus to chemistry, and it is not tied to any one exam or curriculum.
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
            <h2 className="mt-3 font-display text-[34px] leading-tight md:text-[44px]">From how you think, to what you understand, to what you make.</h2>
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

        {/* The eight intelligences */}
        <section className="mx-auto max-w-[1120px] px-5 py-16 md:px-8 md:py-24">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
            <div>
              <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">Your profile</p>
              <h2 className="mt-3 font-display text-[34px] leading-tight md:text-[44px]">A lens on how you learn, not a label.</h2>
              <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
                The model comes from Howard Gardner&apos;s <em>Frames of Mind</em> (1983). We treat your profile as a
                set of learning preferences, not a diagnosis or a measure of ability. When you ask Live Tutor for
                another explanation, it leans on your profile to choose the angle, and your tutor uses it when
                choosing which projects to set you.
              </p>
              <div className="mt-8 rounded-[14px] border border-line bg-surface p-5">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Strongest preference</p>
                    <p className="mt-1 font-display text-[24px] leading-tight">Spatial</p>
                  </div>
                  <span className="rounded-full border border-line bg-sunken px-2.5 py-1 text-[12px] text-muted">Example</span>
                </div>
                <ScoreBars scores={exampleScores} compact />
              </div>
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
                Set out your objectives and get a drafted lesson to edit, preview it on the whiteboard, and
                approve it before any student sees it. Describe an animation and review the
                rendered clip before it goes in. Your students connect with a short code, and you see their
                profiles, assign projects and grade work from one place.
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

      <SiteFooter />
    </div>
  )
}

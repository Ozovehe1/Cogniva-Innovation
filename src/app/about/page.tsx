import Link from 'next/link'
import { ArrowRight, BadgeCheck, Brain, Captions, Flag, Hand, ImageIcon, MousePointer2, PenLine, Shapes, Sparkles, Video } from 'lucide-react'
import { buttonClass } from '@/components/ui'
import { SiteFooter, SiteHeader } from '@/components/site-chrome'
import { SiteScene } from '@/components/site-scene'

export const metadata = {
  title: 'About · Ideanimo',
  description: 'An AI tutor that starts from what you know, shows every idea, and checks its own maths.',
  openGraph: {
    title: 'About Ideanimo',
    description: 'An AI tutor that starts from what you know and shows every idea.',
  },
}

/* Copy rule for this page: say what the app does today, name what is still coming, never more. Short lines only. */

const journey = [
  { n: '01', title: 'Say your goal', body: 'In your own words. About a minute.' },
  { n: '02', title: 'A short check', body: '6–10 questions. New topic? No check.' },
  { n: '03', title: 'Your path', body: 'What you know, and what’s next.' },
  { n: '04', title: 'Mastery, then onwards', body: 'Three of four right unlocks the next.' },
]

const tutor = [
  { icon: PenLine, title: 'Its own whiteboard', body: 'It points at, changes or redraws any part.' },
  { icon: Shapes, title: 'Exact diagrams', body: 'Computed from the maths.' },
  { icon: MousePointer2, title: 'Figures you can move', body: 'Drag the point, find the answer.' },
  { icon: ImageIcon, title: 'Real pictures, credited', body: 'Free science libraries. Tap to zoom.' },
  { icon: Video, title: 'Short animations', body: 'Checked before you see them.' },
  { icon: Captions, title: 'Voice and transcript', body: 'Replay any step, or mute it.' },
  { icon: Sparkles, title: 'Ask, any time', body: 'It knows your lessons.' },
  { icon: Brain, title: 'Written for you alone', body: 'Never reused for anyone else.' },
]

const guard = [
  { icon: BadgeCheck, title: 'It checks its own work', body: 'Maths recalculated, questions tested.' },
  { icon: Flag, title: 'Report a mistake in one tap', body: 'Hidden for you at once.' },
  { icon: Hand, title: 'Mistakes become tests', body: 'Confirmed ones are tested from then on.' },
]

const science = [
  { principle: 'Dual coding', what: 'Every idea shown, not just told.' },
  { principle: 'Cognitive load', what: 'One idea per step.' },
  { principle: 'Retrieval practice', what: 'Short checks make it stick.' },
  { principle: 'Worked example, then your turn', what: 'It shows, then you try.' },
  { principle: 'Growth, not grades', what: '“Not yet”, never a red cross.' },
  { principle: 'Spacing', what: 'Reviews just before you forget.' },
]

export default function AboutPage() {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-[1120px] gap-10 px-5 pb-14 pt-10 md:px-8 md:pb-20 md:pt-20 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16">
          <div>
            <h1 className="max-w-[52rem] font-display text-[40px] leading-[1.05] sm:text-[52px] md:text-[62px]">
              A tutor that shows you <em className="italic text-accent">every idea.</em>
            </h1>
            <p className="mt-5 max-w-[40rem] text-[17px] leading-relaxed text-ink-2 md:text-lg">It starts from what you know and checks its own maths.</p>
            <div className="mt-7">
              <Link href="/signup" className={buttonClass('primary', 'lg')}>Get started<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>
            </div>
          </div>
          <figure>
            <SiteScene kind="heart" />
            <figcaption className="mt-3 text-center text-[13px] text-faint">A live scene from the app.</figcaption>
          </figure>
        </section>

        {/* Journey */}
        <section className="border-y border-line bg-surface" aria-labelledby="journey-title">
          <div className="mx-auto max-w-[1120px] px-5 py-14 md:px-8 md:py-20">
            <h2 id="journey-title" className="max-w-2xl font-display text-[32px] leading-tight md:text-[42px]">From goal to first lesson in minutes.</h2>
            <ol className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
              {journey.map(({ n, title, body }) => (
                <li key={n} className="border-t border-ink pt-5">
                  <p className="tnum font-display text-[15px] text-accent">{n}</p>
                  <h3 className="mt-2 text-lg font-semibold">{title}</h3>
                  <p className="mt-1 text-[15px] text-muted">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* The tutor */}
        <section className="mx-auto max-w-[1120px] px-5 py-14 md:px-8 md:py-20" aria-labelledby="tutor-title">
          <h2 id="tutor-title" className="max-w-2xl font-display text-[32px] leading-tight md:text-[42px]">Watch it, hear it, move it.</h2>
          <ul className="mt-10 grid gap-3 sm:grid-cols-2">
            {tutor.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex items-center gap-4 rounded-[14px] border border-line bg-surface px-4 py-3.5 shadow-[var(--shadow-card)]">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"><Icon className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden /></span>
                <div className="min-w-0">
                  <h3 className="text-[16px] font-semibold leading-snug">{title}</h3>
                  <p className="mt-0.5 text-[14px] leading-snug text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Correctness */}
        <section className="border-y border-line bg-surface" aria-labelledby="guard-title">
          <div className="mx-auto grid max-w-[1120px] gap-8 px-5 py-14 md:px-8 md:py-20 lg:grid-cols-[1fr_1.7fr] lg:gap-16">
            <div>
              <h2 id="guard-title" className="font-display text-[32px] leading-tight md:text-[40px]">AI can be wrong. So it checks.</h2>
              <p className="mt-3 text-[15px] text-ink-2">No person reads a lesson before you do.</p>
            </div>
            <ul className="grid gap-5">
              {guard.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-4 border-t border-line pt-4">
                  <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent" strokeWidth={1.9} aria-hidden />
                  <div><h3 className="text-[17px] font-semibold">{title}</h3><p className="mt-0.5 text-[15px] text-muted">{body}</p></div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Learning science */}
        <section className="mx-auto max-w-[1120px] px-5 py-14 md:px-8 md:py-20" aria-labelledby="science-title">
          <div className="grid gap-8 lg:grid-cols-[1fr_1.7fr] lg:gap-16">
            <div>
              <h2 id="science-title" className="font-display text-[32px] leading-tight md:text-[40px]">Built on how people learn.</h2>
              <p className="mt-3 text-[15px] text-ink-2">No “learning styles”: the evidence isn’t there.</p>
            </div>
            <dl className="divide-y divide-line border-y border-line">
              {science.map(({ principle, what }) => (
                <div key={principle} className="grid gap-0.5 py-3.5 sm:grid-cols-[13rem_1fr] sm:gap-6">
                  <dt className="text-[15px] font-semibold text-accent">{principle}</dt>
                  <dd className="text-[15px] text-ink-2">{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Privacy & care */}
        <section className="border-t border-line" aria-labelledby="care-title">
          <div className="mx-auto grid max-w-[1120px] gap-8 px-5 py-14 md:px-8 md:py-20 lg:grid-cols-2 lg:gap-16">
            <h2 id="care-title" className="font-display text-[32px] leading-tight md:text-[40px]">Your answers teach you. Nothing else.</h2>
            <ul className="space-y-3 text-[15px] leading-relaxed text-ink-2">
              <li className="border-l-2 border-accent pl-4">Under 18: a parent or guardian agrees first (Nigeria Data Protection Act 2023).</li>
              <li className="border-l-2 border-accent pl-4">Mood check-ins are private and deleted after 14 days.</li>
              <li className="border-l-2 border-accent pl-4">Edit or delete any goal, lesson or your whole account.</li>
              <li className="border-l-2 border-accent pl-4">If you write about a crisis, the lesson pauses and shows helplines: SURPIN 0800 078 7746, MANI 0809 111 6264, or 112. The AI is not a counsellor.</li>
            </ul>
          </div>
        </section>

        {/* Honest status + CTA */}
        <section className="mx-auto max-w-[1120px] px-5 pb-16 md:px-8 md:pb-24">
          <div className="rounded-[18px] border border-line bg-surface p-6 shadow-[var(--shadow-card)] md:p-10">
            <h2 className="font-display text-[26px] leading-tight md:text-[32px]">Where things stand</h2>
            <ul className="mt-4 grid gap-2.5 text-[15px] leading-relaxed text-ink-2 md:grid-cols-2 md:gap-x-10">
              <li className="border-l-2 border-accent pl-4">Runs on free AI services: busy times can pause a lesson, and Ask has a daily limit.</li>
              <li className="border-l-2 border-line-strong pl-4">Still improving: animations, and fit for learners in Nigeria. <Link href="/credits" className="font-medium text-accent underline-offset-4 hover:underline">Credits &amp; licences</Link></li>
            </ul>
            <div className="mt-7">
              <Link href="/signup" className={buttonClass('primary', 'lg')}>Get started<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}

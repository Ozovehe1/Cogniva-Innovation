import Link from 'next/link'
import { ArrowRight, BadgeCheck, Brain, Captions, Flag, Hand, ImageIcon, MessageCircle, MousePointer2, PenLine, Shapes, Sparkles, Video } from 'lucide-react'
import { buttonClass } from '@/components/ui'
import { SiteFooter, SiteHeader, demoAvailable } from '@/components/site-chrome'

export const metadata = {
  title: 'About · GeniusMap',
  description: 'How GeniusMap teaches: a short start, a quick check of what you know, then an AI tutor that owns its whiteboard, draws exact diagrams, hands you live figures to explore, and checks its own maths.',
  openGraph: {
    title: 'About GeniusMap',
    description: 'An AI tutor that starts from what you know, shows every idea, and lets you report a mistake in one tap.',
  },
}

/* Copy rule for this page: say what the app does today, name what is still coming, never more. */

const journey = [
  { n: '01', title: 'A quick start', body: 'Say what you want to learn in your own words, your age and class, and how familiar it feels. About a minute. If you’re under 18, a parent or guardian agrees first.' },
  { n: '02', title: 'A short check', body: 'Six to ten questions, each chosen from your last answer, opening with an easy one. You tap how sure you were. If you’re brand new to a topic, there’s no check: you start from the basics.' },
  { n: '03', title: 'Your path', body: 'What you know now and what comes next, in order. Each topic gets a lesson written for you, with examples from your interests and a pace that fits your week.' },
  { n: '04', title: 'Mastery, then onwards', body: 'Four fresh questions end each topic. Three right unlocks the next. A miss leads to a quick look at the ideas underneath, never a penalty.' },
]

const tutor = [
  { icon: PenLine, title: 'A tutor that owns its board', body: 'Your tutor writes on its own whiteboard, line by line, with a pen you can watch. It keeps track of everything on the board, so it can point at, change or redraw any part when you ask.' },
  { icon: Shapes, title: 'Exact diagrams', body: 'Graphs, triangles, circles and Venn diagrams are computed from the maths, not sketched by guesswork, so the right angle is right and the curve crosses where it should.' },
  { icon: MousePointer2, title: 'Live figures you can move', body: 'For ideas that change, the board hands over to a live figure. The tutor demonstrates first, then you drag the point or the slider yourself. Some checks are answered by moving the figure to a goal.' },
  { icon: ImageIcon, title: 'Real pictures, always credited', body: 'Hearts, cells, circuits and atoms come from free scientific illustration libraries whenever one fits. Each library picture shows its author and licence, and you can tap it to zoom. When no library picture fits, the tutor draws a simple labelled diagram instead.' },
  { icon: Video, title: 'Short animations', body: 'Some ideas are clearer in motion, so a lesson or an answer can include a short animation rendered with Manim. Each one is checked before it is shown; one that fails the check is never shown. We are still widening what they can draw.' },
  { icon: Captions, title: 'A natural voice, with a transcript', body: 'Every step is spoken aloud and written into a transcript with the maths typeset. Turn the voice off any time, replay any step, or download the lesson as a video.' },
  { icon: Sparkles, title: 'Genie, and Ask', body: 'Genie is the tutor’s face: it listens while you type and talks as it explains. You can hide it. Ask GeniusMap anything, any time: it answers on the board, with simulations or a practice set, and knows your lessons.' },
  { icon: Brain, title: 'Written for you alone', body: 'Your lessons are written for you and never reused for another learner. They follow your level, your purpose, your interests and how sure you said you feel.' },
]

const guard = [
  { icon: BadgeCheck, title: 'It checks its own work', body: 'Numbers in an answer are recalculated with exact maths before you see them, generated questions are tested against their own answers, and a picture is checked against the topic it is meant to show.' },
  { icon: Flag, title: 'Report a mistake in one tap', body: 'Every answer, picture, figure, animation and question has a “Report a mistake” button. What you report is hidden for you at once, and you can ask for a corrected version straight away.' },
  { icon: Hand, title: 'Mistakes become tests', body: 'Reports are reviewed. Confirmed ones stop that picture being used for the topic and become test cases the tutor must pass from then on.' },
]

const science = [
  { principle: 'Dual coding', what: 'Every idea is shown, not just told: a picture or a moving figure with the voice, and short labels instead of paragraphs on the board.' },
  { principle: 'Cognitive load', what: 'One idea per step, one button that matters at a time, and the board never crowded. Lessons pause at checks instead of rushing on.' },
  { principle: 'Retrieval practice', what: 'Short checks inside lessons and a mastery check at the end: remembering is what makes it stick.' },
  { principle: 'Worked example, then your turn', what: 'The tutor demonstrates, then hands you the figure or the next step to try.' },
  { principle: 'Growth, not grades', what: 'A wrong answer says “not yet” and shows where to look. No timers, no red crosses, no scores on your profile.' },
  { principle: 'Spacing', what: 'Your Today plan brings back earlier topics for short reviews just before they would fade.' },
]

export default function AboutPage() {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-[1120px] px-5 pb-14 pt-12 md:px-8 md:pb-20 md:pt-20">
          <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-accent">About GeniusMap</p>
          <h1 className="mt-4 max-w-[52rem] font-display text-[40px] leading-[1.05] sm:text-[52px] md:text-[62px]">
            A tutor that shows you every idea, <em className="italic text-accent">starting from what you know.</em>
          </h1>
          <p className="mt-6 max-w-[40rem] text-[17px] leading-relaxed text-ink-2 md:text-lg">
            GeniusMap is an AI tutor. It finds what you already know with a short check, builds a path to your goal, then
            teaches each topic on a live whiteboard: exact diagrams, real pictures, figures you can move and a natural
            voice. It checks its own maths, and you can flag anything that looks wrong in one tap.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/signup" className={buttonClass('primary', 'lg')}>Get started<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>
            {demoAvailable
              ? <Link href="/learn/demo" className={buttonClass('secondary', 'lg')}>Watch a sample lesson</Link>
              : <Link href="/login" className={buttonClass('secondary', 'lg')}>Sign in</Link>}
          </div>
        </section>

        {/* Journey */}
        <section className="border-y border-line bg-surface" aria-labelledby="journey-title">
          <div className="mx-auto max-w-[1120px] px-5 py-16 md:px-8 md:py-24">
            <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">How it works</p>
            <h2 id="journey-title" className="mt-3 max-w-2xl font-display text-[32px] leading-tight md:text-[42px]">From “I want to learn this” to your first lesson in minutes.</h2>
            <ol className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {journey.map(({ n, title, body }) => (
                <li key={n} className="border-t border-ink pt-5">
                  <p className="tnum font-display text-[15px] text-accent">{n}</p>
                  <h3 className="mt-2 text-lg font-semibold">{title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* The tutor */}
        <section className="mx-auto max-w-[1120px] px-5 py-16 md:px-8 md:py-24" aria-labelledby="tutor-title">
          <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">The lesson</p>
          <h2 id="tutor-title" className="mt-3 max-w-2xl font-display text-[32px] leading-tight md:text-[42px]">Watch it, hear it, move it, question it.</h2>
          <ul className="mt-12 grid gap-4 sm:grid-cols-2">
            {tutor.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4 rounded-[14px] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"><Icon className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden /></span>
                <div className="min-w-0">
                  <h3 className="text-[17px] font-semibold leading-snug">{title}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Correctness */}
        <section className="border-y border-line bg-surface" aria-labelledby="guard-title">
          <div className="mx-auto grid max-w-[1120px] gap-10 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-[1fr_1.7fr] lg:gap-16">
            <div>
              <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">Getting it right</p>
              <h2 id="guard-title" className="mt-3 font-display text-[32px] leading-tight md:text-[40px]">An AI can be wrong. So it checks, and you can flag it.</h2>
              <p className="mt-5 text-[15px] leading-relaxed text-ink-2">Lessons are written by AI and are not read by a person before you see them. These guards catch most mistakes; your reports catch the rest.</p>
            </div>
            <ul className="grid gap-6">
              {guard.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-4 border-t border-line pt-5">
                  <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent" strokeWidth={1.9} aria-hidden />
                  <div><h3 className="text-[17px] font-semibold">{title}</h3><p className="mt-1.5 text-[15px] leading-relaxed text-muted">{body}</p></div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Learning science */}
        <section className="mx-auto max-w-[1120px] px-5 py-16 md:px-8 md:py-24" aria-labelledby="science-title">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.7fr] lg:gap-16">
            <div>
              <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">Built on how people learn</p>
              <h2 id="science-title" className="mt-3 font-display text-[32px] leading-tight md:text-[40px]">Every screen follows a piece of learning research.</h2>
              <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
                We don’t sort you into a “learning style”: reviews of the research find little evidence it helps. What does help
                is teaching from what you already know, and the ideas on the right.
              </p>
            </div>
            <dl className="divide-y divide-line border-y border-line">
              {science.map(({ principle, what }) => (
                <div key={principle} className="grid gap-1 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
                  <dt className="text-[15px] font-semibold text-accent">{principle}</dt>
                  <dd className="text-[15px] leading-relaxed text-ink-2">{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Privacy & care */}
        <section className="border-t border-line" aria-labelledby="care-title">
          <div className="mx-auto grid max-w-[1120px] gap-10 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">Privacy and care</p>
              <h2 id="care-title" className="mt-3 font-display text-[32px] leading-tight md:text-[40px]">Your answers are used to teach you, nothing else.</h2>
            </div>
            <ul className="space-y-3 text-[15px] leading-relaxed text-ink-2">
              <li className="border-l-2 border-accent pl-4">Learners under 18 need a parent or guardian to agree before anything beyond their age is saved, as Nigeria’s Data Protection Act 2023 requires.</li>
              <li className="border-l-2 border-accent pl-4">Mood and confidence check-ins are visible only to you and are deleted after 14 days.</li>
              <li className="border-l-2 border-accent pl-4">Your path is a starting point that updates as you learn. It is never a label and never limits what you may study. You can edit or delete any goal, lesson or your whole account.</li>
              <li className="border-l-2 border-accent pl-4">If something you write suggests you are going through something serious, the lesson pauses and shows Nigerian helplines: SURPIN 0800 078 7746, MANI 0809 111 6264, or 112 in an emergency. The AI does not act as a counsellor.</li>
            </ul>
          </div>
        </section>

        {/* Honest status + CTA */}
        <section className="mx-auto max-w-[1120px] px-5 pb-16 md:px-8 md:pb-24">
          <div className="rounded-[18px] border border-line bg-surface p-6 shadow-[var(--shadow-card)] md:p-10">
            <h2 className="font-display text-[26px] leading-tight md:text-[32px]">Where things stand</h2>
            <ul className="mt-5 grid gap-3 text-[15px] leading-relaxed text-ink-2 md:grid-cols-2 md:gap-x-10">
              <li className="border-l-2 border-accent pl-4">Available now: the quick start, the check, your path, lessons with the board, live figures, pictures, voice and mastery checks, Ask, and Report a mistake.</li>
              <li className="border-l-2 border-accent pl-4">GeniusMap runs on free AI services. When they are busy, a new lesson pauses and resumes on its own, and Ask has a daily message limit.</li>
              <li className="border-l-2 border-line-strong pl-4">Still improving: animations for every subject, and how far the check and the questions fit learners in Nigeria. They will be refined as more people learn here.</li>
              <li className="border-l-2 border-line-strong pl-4">The pictures and open-source tools we use are listed, with their licences, on our <Link href="/credits" className="font-medium text-accent underline-offset-4 hover:underline">credits page</Link>.</li>
            </ul>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/signup" className={buttonClass('primary', 'lg')}>Get started<ArrowRight className="h-4 w-4" strokeWidth={2} /></Link>
              <Link href="/credits" className={buttonClass('secondary', 'lg')}><MessageCircle className="h-4 w-4" strokeWidth={1.9} />Credits &amp; licences</Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}

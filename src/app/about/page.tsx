import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { buttonClass } from '@/components/ui'
import { SiteFooter, SiteHeader, demoAvailable } from '@/components/site-chrome'

export const metadata = {
  title: 'About · GeniusMap',
  description: 'GeniusMap teaches on a live whiteboard with step-by-step writing, animated diagrams, voice narration and checks that re-explain. Tutors write and approve every lesson.',
}

const lessonParts = [
  {
    title: 'The whiteboard',
    body: 'A lesson is a script of small steps: write a line, draw an axis, plot a curve, mark a point, turn one equation into the next. The player draws each step in order, so the explanation unfolds the way it would at a real board. You can pause, step back, or replay any step.',
  },
  {
    title: 'Animated diagrams',
    body: 'Graphs, shapes and highlights are drawn as they are talked about. For motion the board cannot draw, a tutor can describe an animation; it is written and rendered with Manim, and the tutor reviews the clip before placing it in the lesson.',
  },
  {
    title: 'Voice and transcript',
    body: 'Each step carries a line of narration. It is read aloud with the voice built into your browser or phone, and written into a running transcript, with the maths typeset, so nothing you heard disappears. The voice can be switched off and the choice is remembered.',
  },
  {
    title: 'Understanding checks',
    body: 'Lessons stop at short checks: a “does this make sense?”, a multiple-choice question or a short answer. Ask to see it again, or ask for a different explanation. A wrong answer gets a walk-through aimed at the likely misunderstanding, then the same question again.',
  },
]

export default function AboutPage() {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <SiteHeader />

      <main>
        <section className="mx-auto max-w-[1120px] px-5 pb-14 pt-12 md:px-8 md:pb-20 md:pt-20">
          <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-accent">About GeniusMap</p>
          <h1 className="mt-4 max-w-[52rem] font-display text-[40px] leading-[1.06] sm:text-[52px] md:text-[60px]">
            Explanations that adapt to the learner, with a tutor in charge of every lesson.
          </h1>
          <p className="mt-6 max-w-[40rem] text-[17px] leading-relaxed text-ink-2 md:text-lg">
            GeniusMap is a learning platform for students and tutors anywhere. It combines Live Tutor, a whiteboard
            that teaches step by step, with a short profile of how each student prefers to learn and project work
            that puts ideas into practice.
          </p>
        </section>

        {/* Live Tutor */}
        <section className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-[1120px] gap-10 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-[1fr_1.7fr] lg:gap-16">
            <div>
              <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">Live Tutor</p>
              <h2 className="mt-3 font-display text-[32px] leading-tight md:text-[40px]">How a lesson works.</h2>
              <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
                Live Tutor is the newest part of GeniusMap. It is meant for understanding an idea properly, in any
                subject a tutor can teach at a board, and is not built around a particular exam or country&apos;s
                syllabus.
              </p>
            </div>
            <dl className="grid gap-x-8 gap-y-9 sm:grid-cols-2">
              {lessonParts.map(({ title, body }) => (
                <div key={title} className="border-t border-ink pt-5">
                  <dt className="text-lg font-semibold">{title}</dt>
                  <dd className="mt-2 text-[15px] leading-relaxed text-muted">{body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Tutors */}
        <section className="mx-auto grid max-w-[1120px] gap-10 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">Tutors</p>
            <h2 className="mt-3 font-display text-[32px] leading-tight md:text-[40px]">Nothing reaches a student without a tutor&apos;s approval.</h2>
          </div>
          <div className="space-y-4 text-[15px] leading-relaxed text-ink-2">
            <p>
              A tutor starts a lesson from a title and a list of objectives. GeniusMap drafts a whiteboard script,
              which the tutor can preview, edit, regenerate with notes, or rewrite. Students only see a lesson once
              the tutor approves it, and any change sends it back to draft.
            </p>
            <p>
              Animations follow the same rule: the tutor describes what should move, reviews the rendered clip,
              and approves it before adding it to a lesson.
            </p>
            <p>
              During a lesson, the re-explanations written on the spot by AI follow the tutor&apos;s lesson and
              objectives. If one cannot be produced, the player falls back to the alternative explanation the tutor
              wrote, or replays the section.
            </p>
          </div>
        </section>

        {/* Profile */}
        <section className="border-t border-line">
          <div className="mx-auto grid max-w-[1120px] gap-10 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">The intelligence profile</p>
              <h2 className="mt-3 font-display text-[32px] leading-tight md:text-[40px]">A lens on preferences, not a diagnosis.</h2>
            </div>
            <div className="space-y-4 text-[15px] leading-relaxed text-ink-2">
              <p>
                Students answer 24 statements about everyday behaviour and get a profile across the eight
                intelligences described by Howard Gardner in <em>Frames of Mind</em> (1983): linguistic,
                logical–mathematical, spatial, musical, bodily–kinesthetic, interpersonal, intrapersonal and
                naturalist.
              </p>
              <p>
                Gardner&apos;s theory is a way of thinking about different strengths, and researchers still debate it.
                We use the profile as a starting point for conversation and choice: it describes how someone tends to
                prefer to learn today, not what they are capable of. It never decides what a student is allowed to
                study.
              </p>
              <p>
                In practice it shapes two things. When a student asks Live Tutor to explain something differently,
                the new explanation takes their profile into account, for example leaning on a picture for someone
                with a strong spatial preference. And tutors see it when choosing which projects to set.
              </p>
            </div>
          </div>
        </section>

        {/* Honest status */}
        <section className="mx-auto max-w-[1120px] px-5 pb-16 md:px-8 md:pb-24">
          <div className="rounded-[18px] border border-line bg-surface p-6 md:p-10">
            <h2 className="font-display text-[26px] leading-tight md:text-[32px]">Where things stand</h2>
            <ul className="mt-5 grid gap-3 text-[15px] leading-relaxed text-ink-2 md:grid-cols-2 md:gap-x-10">
              <li className="border-l-2 border-accent pl-4">The profile, tutor connections, projects and grading are available now.</li>
              <li className="border-l-2 border-accent pl-4">Live Tutor lessons are available to signed-in students once tutors approve them.</li>
              <li className="border-l-2 border-line-strong pl-4">Narration uses the voice your device provides, so it sounds different from phone to phone. A more natural voice is planned.</li>
              <li className="border-l-2 border-line-strong pl-4">The lesson library is small and grows as tutors write and approve lessons.</li>
            </ul>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/signup" className={buttonClass('primary', 'lg')}>
                Create an account
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </Link>
              {demoAvailable ? (
                <Link href="/learn/demo" className={buttonClass('secondary', 'lg')}>Watch a sample lesson</Link>
              ) : (
                <Link href="/login" className={buttonClass('secondary', 'lg')}>Sign in</Link>
              )}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { buttonClass } from '@/components/ui'
import { SiteFooter, SiteHeader, demoAvailable } from '@/components/site-chrome'

export const metadata = {
  title: 'About · GeniusMap',
  description: 'How GeniusMap works: an AI tutor that learns your goal, level and how you feel, finds what you know with a short adaptive check, then teaches on a live whiteboard with a natural voice, at your pace.',
  openGraph: {
    title: 'About GeniusMap',
    description: 'An AI tutor that starts from what you know. No human tutors, no learning-style labels.',
  },
}

const stages = [
  {
    title: 'A conversation, not a form',
    body: 'One question at a time: are you in school, which class or year, what you want to be able to do and why, what it is for and by when, how much time you have each week, how sure you feel, and how you are feeling today. The tutor reflects your answers back so you can correct it. Every question can be skipped or answered “not sure”. It takes about five minutes.',
  },
  {
    title: 'A short adaptive check',
    body: 'The AI maps the skills between where you are and your goal, starting just below your stated level, then asks about 6 to 10 multiple-choice questions, opening with an easy one. A confident right answer counts the skills beneath it as known; a miss marks what depends on it as still to learn. You tap how sure you were after each answer. The result is two lists: what you know now, and what you are ready to learn next.',
  },
  {
    title: 'Lessons written for you',
    body: 'Each topic on your path gets its own lesson. Its level and the amount of support come from the check and from how sure you said you feel; examples come from your interests and your purpose; length and pace come from your week and your deadline. An exam goal covers the whole topic with exam-style practice; a project goal covers only what the project needs.',
  },
  {
    title: 'Mastery, then the next topic',
    body: 'A topic ends with four fresh questions. Three right unlocks the next one. Two misses in a row lead to a quick re-check of the ideas underneath, and anything that has slipped goes back into your path before you move on.',
  },
]

const lessonParts = [
  { title: 'The whiteboard', body: 'A lesson is a sequence of small steps: write a line, draw an axis, plot a curve, turn one equation into the next. You can pause, step back, replay any step, and pick up exactly where you stopped on any device.' },
  { title: 'Voice and transcript', body: 'Each step is spoken in a natural voice and written into a running transcript, with the maths typeset. If the natural voice is unavailable, your device’s voice is used. The voice can be turned off.' },
  { title: 'Animations', body: 'A lesson can include a short animation rendered with Manim. The animation code is written by the AI from the lesson plan, checked automatically before it runs, and rendered in an isolated sandbox. Nothing a learner types is ever run as code.' },
  { title: 'Checks and check-ins', body: 'Lessons stop for short questions. A wrong answer gets a walk-through aimed at the likely misunderstanding. About every 12 minutes, or after two wrong answers, a one-tap check-in asks how it feels; a low answer slows things down and offers a worked example or a break.' },
]

export default function AboutPage() {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <SiteHeader />

      <main>
        <section className="mx-auto max-w-[1120px] px-5 pb-14 pt-12 md:px-8 md:pb-20 md:pt-20">
          <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-accent">About GeniusMap</p>
          <h1 className="mt-4 max-w-[52rem] font-display text-[40px] leading-[1.06] sm:text-[52px] md:text-[60px]">
            An AI tutor that starts from what you already know.
          </h1>
          <p className="mt-6 max-w-[40rem] text-[17px] leading-relaxed text-ink-2 md:text-lg">
            GeniusMap gets to know your goal, your reasons, your level and how you feel, runs a short adaptive check to
            find what you know and what comes next, then teaches you on a live whiteboard with a natural voice and
            animations, at your level and your pace. There are no human tutors and no learning-style labels.
          </p>
        </section>

        <section className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-[1120px] gap-10 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-[1fr_1.7fr] lg:gap-16">
            <div>
              <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">How it works</p>
              <h2 className="mt-3 font-display text-[32px] leading-tight md:text-[40px]">From a conversation to your first lesson.</h2>
            </div>
            <ol className="grid gap-x-8 gap-y-9 sm:grid-cols-2">
              {stages.map(({ title, body }, i) => (
                <li key={title} className="border-t border-ink pt-5">
                  <p className="tnum font-display text-[15px] text-accent">{String(i + 1).padStart(2, '0')}</p>
                  <h3 className="mt-2 text-lg font-semibold">{title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto grid max-w-[1120px] gap-10 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-[1fr_1.7fr] lg:gap-16">
          <div>
            <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">The lesson</p>
            <h2 className="mt-3 font-display text-[32px] leading-tight md:text-[40px]">Watch it, hear it, question it.</h2>
          </div>
          <dl className="grid gap-x-8 gap-y-9 sm:grid-cols-2">
            {lessonParts.map(({ title, body }) => (
              <div key={title} className="border-t border-ink pt-5">
                <dt className="text-lg font-semibold">{title}</dt>
                <dd className="mt-2 text-[15px] leading-relaxed text-muted">{body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-t border-line">
          <div className="mx-auto grid max-w-[1120px] gap-10 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">Why no learning styles</p>
              <h2 className="mt-3 font-display text-[32px] leading-tight md:text-[40px]">What you know matters more than what “type” you are.</h2>
            </div>
            <div className="space-y-4 text-[15px] leading-relaxed text-ink-2">
              <p>
                Reviews of the research have found little evidence that matching teaching to a measured learning style
                improves learning, so GeniusMap does not test for one and never shows you a type. The format of a lesson
                follows the content: a graph for a function, a diagram for a circuit.
              </p>
              <p>
                What the evidence does support is teaching from prior knowledge, checking mastery before moving on, and
                step-by-step feedback. Questions about confidence, goals and maths anxiety are adapted from published
                research scales and only adjust support and pacing. They have mostly been studied outside Nigeria, so we
                treat them as a guide rather than a verdict.
              </p>
            </div>
          </div>
        </section>

        <section className="border-t border-line">
          <div className="mx-auto grid max-w-[1120px] gap-10 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">Privacy and care</p>
              <h2 className="mt-3 font-display text-[32px] leading-tight md:text-[40px]">Your answers are used to teach you, nothing else.</h2>
            </div>
            <ul className="space-y-3 text-[15px] leading-relaxed text-ink-2">
              <li className="border-l-2 border-accent pl-4">Learners under 18 need a parent or guardian to agree before anything beyond their age is saved, as Nigeria’s Data Protection Act 2023 requires.</li>
              <li className="border-l-2 border-accent pl-4">Mood and confidence check-ins are visible only to you and are deleted after 14 days.</li>
              <li className="border-l-2 border-accent pl-4">Your path is a starting point that updates as you learn. It is never a label and never limits what you may study.</li>
              <li className="border-l-2 border-accent pl-4">If something you write suggests you are going through something serious, the lesson pauses and shows Nigerian helplines: SURPIN 0800 078 7746, MANI 0809 111 6264, or 112 in an emergency. The AI does not act as a counsellor.</li>
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-[1120px] px-5 pb-16 md:px-8 md:pb-24">
          <div className="rounded-[18px] border border-line bg-surface p-6 md:p-10">
            <h2 className="font-display text-[26px] leading-tight md:text-[32px]">Where things stand</h2>
            <ul className="mt-5 grid gap-3 text-[15px] leading-relaxed text-ink-2 md:grid-cols-2 md:gap-x-10">
              <li className="border-l-2 border-accent pl-4">The intake, adaptive check, learning path, lessons and mastery checks are available now.</li>
              <li className="border-l-2 border-accent pl-4">Lessons are generated by AI and are not reviewed by a person before you see them. If something looks wrong, trust your judgement and ask for another explanation.</li>
              <li className="border-l-2 border-line-strong pl-4">A new lesson takes a minute or two to write. When the AI service is busy, writing pauses and resumes on its own.</li>
              <li className="border-l-2 border-line-strong pl-4">GeniusMap is new. The check and the questions will be refined as more learners use them.</li>
            </ul>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/signup" className={buttonClass('primary', 'lg')}>
                Get started
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

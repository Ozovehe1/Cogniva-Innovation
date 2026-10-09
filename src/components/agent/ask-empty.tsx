'use client'
import { ArrowUpRight, BookOpen, FlaskConical, PenLine, Target } from 'lucide-react'
import { cx } from '@/components/ui'

const GENERAL = [
  { icon: PenLine, text: 'Explain how a ball thrown up comes back down, on the board' },
  { icon: BookOpen, text: 'What did we cover in my last lesson?' },
  { icon: Target, text: 'Give me a quick practice set on my current topic' },
  { icon: FlaskConical, text: 'Show me a simulation of a pendulum' },
]
const IN_LESSON = [
  { icon: PenLine, text: 'Explain this step another way, on the board' },
  { icon: BookOpen, text: 'Give me one more example' },
  { icon: Target, text: 'Quiz me on this lesson' },
]

/**
 * Ask's empty state: a question that invites curiosity, what the tutor can do (so the learner knows the options),
 * and a few one-tap starters (recognition over recall; Hick: three or four, not ten). Each starter is a 48 px row.
 */
export function AskEmpty({ inLesson, compact, onPick }: { inLesson: boolean; compact: boolean; onPick: (text: string) => void }) {
  const items = inLesson ? IN_LESSON : GENERAL
  return (
    <div className={cx('mx-auto max-w-xl', compact ? 'py-4' : 'py-6 md:py-10')}>
      <h2 className="font-display text-[26px] leading-tight text-ink md:text-[30px]">{inLesson ? 'Stuck on something in this lesson?' : 'What do you want to understand?'}</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">Ask anything. Your tutor explains on the board, draws diagrams, builds simulations and checks the maths. It knows your lessons and your path.</p>
      <p className="mt-6 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Try one</p>
      <ul className="mt-2 grid gap-2">
        {items.map(({ icon: Icon, text }) => (
          <li key={text}>
            <button type="button" onClick={() => onPick(text)}
              className="group flex min-h-12 w-full items-center gap-3 rounded-[12px] border border-line bg-surface px-3.5 py-2.5 text-left text-[14.5px] leading-snug text-ink shadow-[var(--shadow-card)] transition-[border-color,transform] duration-150 hover:border-accent-line active:scale-[0.99]">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"><Icon className="h-4 w-4" strokeWidth={1.9} aria-hidden /></span>
              <span className="min-w-0 flex-1">{text}</span>
              <ArrowUpRight className="h-4 w-4 flex-shrink-0 text-faint transition-colors group-hover:text-accent" strokeWidth={2} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

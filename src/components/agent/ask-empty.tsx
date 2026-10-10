'use client'
import { ArrowUpRight, BookOpen, Clapperboard, FlaskConical, HeartPulse, PenLine, Target } from 'lucide-react'
import { cx } from '@/components/ui'

const GENERAL = [
  { icon: HeartPulse, text: 'Explain how the heart pumps blood' },
  { icon: PenLine, text: 'Why does a ball thrown up come back down?' },
  { icon: FlaskConical, text: 'Show me a simulation of a pendulum' },
]
const IN_LESSON = [
  { icon: Clapperboard, text: 'Show me this step another way' },
  { icon: BookOpen, text: 'Give me one more example' },
  { icon: Target, text: 'Quiz me on this lesson' },
]

/**
 * Ask's empty state: a question that invites curiosity and three one-tap starters that show what it can do
 * (show, don't tell: no capability paragraph). Starters (recognition over recall; Hick: three or four, not ten). Each starter is a 48 px row.
 */
export function AskEmpty({ inLesson, compact, onPick }: { inLesson: boolean; compact: boolean; onPick: (text: string) => void }) {
  const items = inLesson ? IN_LESSON : GENERAL
  return (
    <div className={cx('mx-auto max-w-xl', compact ? 'py-4' : 'py-6 md:py-10')}>
      <h2 className="font-display text-[26px] leading-tight text-ink md:text-[30px]">{inLesson ? 'Stuck on something in this lesson?' : 'What do you want to understand?'}</h2>
      <p className="mt-5 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Try one</p>
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

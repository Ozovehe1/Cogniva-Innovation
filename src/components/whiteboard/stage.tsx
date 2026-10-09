'use client'
/**
 * The lesson stage: a live visual takes the lesson area from the board, then hands it back (docs/design/lesson-ui.md).
 * It opens in the board's own frame (same place, same radius) so the learner keeps their place; "Full screen" grows the
 * same element (shared layoutId) to the whole viewport on phones. While the step's narration plays the only control is
 * a quiet "Skip"; once the narration and the demonstration are done the single primary action is "Back to the board",
 * placed in the thumb zone at the bottom of the frame.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Maximize2, Minimize2 } from 'lucide-react'
import { RichText } from '@/components/rich-text'
import { buttonClass, cx } from '@/components/ui'
import { interactiveAlt, validateInteractive } from '@/lib/agent/interactive'
import type { StageStep } from '@/lib/lesson-schema'
import { FigureSkeleton } from '@/components/agent/interactive'

const InteractiveFigure = dynamic(() => import('@/components/agent/interactive'), { ssr: false, loading: () => <FigureSkeleton /> })

const EASE = [0.2, 0, 0, 1] as const
const AUTO_BACK_MS = 6000

export function StageView({ step, stepKey, narrating, reduced, recording = false, measureFrom, onBack }: {
  step: StageStep
  /** Changes each time the step is played (restarts the demonstration). */
  stepKey: string
  /** The step's narration is still speaking. */
  narrating: boolean
  reduced: boolean
  /** Lesson video recording: no buttons; it closes by itself after the narration. */
  recording?: boolean
  /** The board frame's height when the stage opened: the stage starts at exactly that size and grows to its content,
   * so the board visibly becomes the stage (spatial continuity, §2) instead of one box swapping for another. */
  measureFrom?: () => number
  onBack: () => void
}) {
  const v = useMemo(() => validateInteractive(step.spec), [step.spec])
  const spec = v.spec
  const [handedOver, setHandedOver] = useState(!step.play)
  const [full, setFull] = useState(false)
  // Captured once, on open: later re-renders must not restart the morph.
  const [startH] = useState(() => { const h = measureFrom?.() ?? 0; return h > 80 ? Math.round(h) : null })
  const [morphing, setMorphing] = useState(!!startH && !reduced)
  const ready = handedOver && !narrating
  const backRef = useRef<HTMLButtonElement>(null)
  // The lesson keeps flowing: once the demonstration and narration are done, an untouched stage hands back to the board
  // by itself after a short beat (shown as a filling bar on the button). Touching the figure means the learner is
  // exploring: then it waits for their tap.
  const [explored, setExplored] = useState(false)
  const autoBack = ready && !explored && !recording && !full
  const onBackRef = useRef(onBack)
  useEffect(() => { onBackRef.current = onBack })
  useEffect(() => {
    if (!autoBack) return
    const t = setTimeout(() => onBackRef.current(), AUTO_BACK_MS)
    return () => clearTimeout(t)
  }, [autoBack])
  // A recorded lesson moves on by itself once the narration and demonstration are done.
  useEffect(() => {
    if (!recording || !ready) return
    const t = setTimeout(onBack, 1500)
    return () => clearTimeout(t)
  }, [recording, ready, onBack])
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [full])
  if (!spec) {
    // Invalid figure: never block the lesson.
    return <StageError onBack={onBack} />
  }
  const t = { duration: reduced ? 0.01 : 0.32, ease: EASE }
  const frame = (
    <motion.section
      layoutId={`stage-${stepKey}`}
      transition={t}
      aria-label={spec.title}
      role={full ? 'dialog' : 'region'}
      aria-modal={full || undefined}
      className={cx(
        'flex flex-col overflow-hidden border border-line bg-surface',
        full ? 'fixed inset-0 z-[90] rounded-none' : 'relative w-full rounded-[14px] shadow-[var(--shadow-card)]',
      )}
    >
      <header className="flex items-start justify-between gap-3 px-4 pb-1 pt-3.5">
        <div className="min-w-0">
          <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-accent">Explore</p>
          <h3 className="mt-0.5 font-display text-[20px] leading-snug text-ink"><RichText text={spec.title} /></h3>
        </div>
        {!recording && (
          <button type="button" onClick={() => setFull(f => !f)} aria-label={full ? 'Exit full screen' : 'Full screen'}
            className="-mr-1.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-sunken hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            {full ? <Minimize2 className="h-[18px] w-[18px]" /> : <Maximize2 className="h-[18px] w-[18px]" />}
          </button>
        )}
      </header>
      <div className={cx('min-h-0 px-4', full && 'flex-1 overflow-y-auto')} onPointerDown={() => setExplored(true)} onKeyDown={() => setExplored(true)}>
        {(step.caption || spec.explain) && <p className="text-[15px] leading-relaxed text-ink-2"><RichText text={step.caption ?? spec.explain ?? ''} /></p>}
        <InteractiveFigure key={stepKey} spec={spec} alt={interactiveAlt(spec)} play={step.play} demo={!!step.play} onHandOver={() => setHandedOver(true)} />
      </div>
      {!recording && (
        <footer className="mt-3 flex items-center justify-between gap-3 border-t border-line px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3">
          <p className="text-[13px] leading-snug text-muted" aria-live="polite">{autoBack ? 'Touch the figure to explore it yourself.' : ready ? 'Your turn — explore, then carry on.' : step.play && !handedOver ? 'Watch…' : 'Listen, and try it.'}</p>
          <AnimatePresence mode="wait" initial={false}>
            {ready ? (
              <motion.button key="back" ref={backRef} type="button" onClick={() => { setFull(false); onBack() }}
                initial={{ opacity: 0, y: reduced ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.01 : 0.2, ease: EASE }}
                className={cx(buttonClass('primary', 'lg'), 'relative h-11 flex-shrink-0 overflow-hidden rounded-full px-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent')}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to the board
                {autoBack && !reduced && <motion.span aria-hidden className="pointer-events-none absolute inset-x-3 bottom-1 h-0.5 origin-left rounded-full bg-white/70" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: AUTO_BACK_MS / 1000, ease: 'linear' }} />}
              </motion.button>
            ) : (
              <motion.button key="skip" type="button" onClick={() => { setFull(false); onBack() }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.01 : 0.15 }}
                className={cx(buttonClass('ghost', 'md'), 'h-11 flex-shrink-0 rounded-full text-muted')} aria-label="Skip and go back to the board">
                Skip
              </motion.button>
            )}
          </AnimatePresence>
        </footer>
      )}
    </motion.section>
  )
  return (
    <motion.div
      initial={startH && !reduced ? { opacity: 0.6, height: startH } : { opacity: 0, y: reduced ? 0 : 8 }}
      animate={startH && !reduced ? { opacity: 1, height: 'auto' } : { opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.01 : startH ? 0.32 : 0.28, ease: EASE }}
      onAnimationComplete={() => setMorphing(false)}
      // Clip only while the frame morphs from the board's size (the card's shadow shows once it settles).
      style={morphing ? { overflow: 'hidden', borderRadius: 14 } : undefined}
    >
      {full && <div className="w-full rounded-[14px] border border-dashed border-line" style={{ height: 240 }} aria-hidden="true" />}
      {frame}
    </motion.div>
  )
}

function StageError({ onBack }: { onBack: () => void }) {
  useEffect(() => { const t = setTimeout(onBack, 600); return () => clearTimeout(t) }, [onBack])
  return <div className="rounded-[14px] border border-line bg-surface p-4 text-[14px] text-muted" role="status">This figure could not load; back to the board.</div>
}

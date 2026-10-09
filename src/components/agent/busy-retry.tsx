'use client'
import { useEffect, useRef, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { buttonClass, cx } from '@/components/ui'

/**
 * The last rung of the LLM pool's degradation ladder: every free model is busy for a moment. Never a dead end and
 * never alarming (docs/design/lesson-ui.md §0):
 * - reduced threat: calm sunken card with accent ink, no danger red, no ticking numbers (a quiet fill shows the wait);
 * - autonomy (SDT): "Try now" is always available, and the question is kept, so nothing has to be retyped;
 * - Zeigarnik / continuity: it retries once on its own when capacity is expected back, in place.
 */
export function BusyRetry({ retryAt, totalMs, onRetry, compact = false }: { retryAt: number; totalMs: number; onRetry: () => void; compact?: boolean }) {
  const [left, setLeft] = useState(totalMs)
  const fired = useRef(false)
  useEffect(() => {
    const tick = () => {
      const l = Math.max(0, retryAt - Date.now())
      setLeft(l)
      if (l === 0 && !fired.current) { fired.current = true; onRetry() }
    }
    const t = setInterval(tick, 250)
    return () => clearInterval(t)
  }, [retryAt, onRetry])
  const done = Math.min(1, 1 - left / Math.max(1000, totalMs))
  return (
    <div role="status" aria-live="polite" className={cx('rounded-[14px] border border-line bg-sunken', compact ? 'px-3 py-2.5' : 'px-4 py-3')}>
      <p className="text-[15px] leading-[1.5] text-ink">Lots of learners are asking at once, so I’m waiting for a free moment.</p>
      <p className="mt-0.5 text-[13px] text-muted">Your question is saved. I’ll answer it {left > 0 ? 'in a moment' : 'now'}.</p>
      <div className="mt-2.5 flex items-center gap-3">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-line" aria-hidden>
          <div className="h-full rounded-full bg-accent transition-[width] duration-250 ease-linear motion-reduce:transition-none" style={{ width: `${Math.round(done * 100)}%` }} />
        </div>
        <button type="button" onClick={() => { fired.current = true; onRetry() }} className={buttonClass('secondary', 'md', 'h-11 gap-1.5')}>
          <RotateCw className="h-3.5 w-3.5" aria-hidden />Try now
        </button>
      </div>
    </div>
  )
}

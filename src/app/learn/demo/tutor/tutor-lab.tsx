'use client'
import React, { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { AgentBlock, SvgBlock } from '@/components/agent/blocks'
import { TutorPresence } from '@/components/genie/tutor-presence'
import { genie, setGenieVisible, type GenieMood } from '@/components/genie/presence'
import { syntheticMouth } from '@/components/genie/lipsync'
import { cx } from '@/components/ui'
import { FIXTURE_ATOM, FIXTURE_HEART } from '@/lib/illustrations/fixtures'
import type { Step } from '@/lib/lesson-schema'

const MOODS: GenieMood[] = ['idle', 'listening', 'thinking', 'talking', 'happy', 'encouraging']

/** A lesson board with a library figure (credit line inside the picture) and notes beside it (no arrows: on a phone the notes reflow under the figure). */
const BOARD: Step[] = [
  { type: 'write', id: 'title', text: 'The heart', x: 24, y: 24, size: 'lg' },
  { type: 'draw', id: 'fig1', shape: { kind: 'figure', x: 70, y: 96, w: 280, h: 377, svg: FIXTURE_HEART.svg, alt: FIXTURE_HEART.alt } },
  { type: 'write', id: 'l1', text: 'Aorta: blood out to the body', x: 480, y: 136, size: 'sm', maxWidth: 290 },
  { type: 'write', id: 'l2', text: 'Left ventricle: the strongest pump', x: 480, y: 286, size: 'sm', maxWidth: 290 },
] as unknown as Step[]

export function TutorLab() {
  const p = useSearchParams()
  const mood = (p.get('mood') ?? '') as GenieMood
  const only = p.get('only')
  const hidden = p.get('hidden') === '1'
  useEffect(() => {
    setGenieVisible(!hidden)
    if (mood === 'thinking') genie.set('thinking', true, 'lab')
    if (mood === 'listening') genie.set('listening', true, 'lab')
    if (mood === 'happy' || mood === 'encouraging') genie.react(mood, 600_000)
    const off = mood === 'talking' ? genie.addSpeaker(() => syntheticMouth()) : () => {}
    return () => { off(); genie.set('thinking', false, 'lab'); genie.set('listening', false, 'lab') }
  }, [mood, hidden])
  const show = (k: string) => !only || only.split(',').includes(k)
  return (
    <div className="space-y-6">
      {show('presence') && (
        <section data-lab="presence" className="space-y-3">
          <TutorPresence variant="lesson" look={{ x: 0.2, y: 0.55 }} className="rounded-[14px] border border-line bg-surface py-1.5 pl-2 pr-1.5 shadow-[var(--shadow-card)]" title={<p className="font-display text-[19px] text-ink">The heart</p>} />
          <nav aria-label="Tutor states" className="flex flex-wrap gap-2">
            {MOODS.map(m => (
              <a key={m} href={`?mood=${m}`} aria-current={m === (mood || 'idle') ? 'page' : undefined} className={cx('inline-flex h-11 items-center rounded-full border px-4 text-[13px] font-medium', m === (mood || 'idle') ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-ink-2')}>{m}</a>
            ))}
          </nav>
        </section>
      )}
      {show('board') && <section data-lab="board"><AgentBlock block={{ kind: 'board', id: 'lab-heart', title: 'The heart', steps: BOARD, diagram: true, start: BOARD.length }} /></section>}
      {show('card') && <section data-lab="card"><SvgBlock svg={FIXTURE_ATOM.svg} alt={FIXTURE_ATOM.alt} credit={FIXTURE_ATOM.credit} /></section>}
      {show('loading') && <section data-lab="loading"><SvgBlock svg="" url="/genie/never.svg" forceState="loading" alt="Plant cell (Wikimedia Commons)" credit={FIXTURE_ATOM.credit} /></section>}
      {show('error') && <section data-lab="error"><SvgBlock svg="" url="/genie/missing-illustration.svg" alt="Plant cell (Wikimedia Commons)" credit={{ ...FIXTURE_ATOM.credit, title: 'Plant cell structure' }} /></section>}
      {show('drawn') && <section data-lab="drawn"><SvgBlock svg={'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 300"><rect x="220" y="150" width="200" height="90" rx="6" fill="#1F4D3A" opacity="0.15" stroke="#14141A" stroke-width="2"/><line x1="320" y1="150" x2="320" y2="60" stroke="#A4502A" stroke-width="3"/><text x="332" y="80" font-family="Inter, sans-serif" font-size="16">Normal force</text><line x1="320" y1="240" x2="320" y2="290" stroke="#23406A" stroke-width="3"/><text x="332" y="285" font-family="Inter, sans-serif" font-size="16">Weight</text></svg>'} alt="Forces on a book resting on a table: weight down, normal force up (drawn by the tutor)." /></section>}
    </div>
  )
}

'use client'
import React from 'react'
import { ArrowRight, ArrowUp, Check, RotateCcw, Undo2, Volume2 } from 'lucide-react'
import { Pending, buttonClass, type ActionState } from '@/components/ui'
import { InkMark, QuietLine, StageList, WaitNote } from '@/components/system/wait'
import { ToolChips } from '@/components/agent/tool-chips'
import { TurnStatus, VisualPlaceholder } from '@/components/agent/turn-status'
import { ClipWait } from '@/components/agent/blocks'
import { LessonPreparing } from '@/components/lesson-preparing'
import LessonLoading from '@/app/(student)/learn/[id]/loading'
import AskLoading from '@/app/(student)/ask/loading'

const STATES: ActionState[] = ['idle', 'busy', 'done', 'failed']
const PREP_OUTLINE = { status: 'outlining', sectionsReady: 0 }
const PREP_DRAFT = { status: 'drafting', sectionsReady: 0 }
const T = (name: string, label: string, state: string) => ({ name, label, state })

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-10 scroll-mt-4" data-lab={id}>
      <p className="mb-3 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">{title}</p>
      {children}
    </section>
  )
}

function Turn({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-[14px] border border-dashed border-line p-3">
      <div className="flex justify-end"><div className="max-w-[85%] rounded-[16px] rounded-br-[6px] bg-accent px-4 py-2.5 text-[15px] leading-relaxed text-white">{q}</div></div>
      {children}
    </div>
  )
}

export function WaitingLab() {
  return (
    <div>
      <h1 className="mb-6 font-display text-[28px] text-ink">Waiting states</h1>

      <Section id="buttons" title="Buttons: idle · working · done · failed">
        <div className="space-y-3">
          {[
            { v: 'primary' as const, s: 'lg' as const, idle: <>Check my answers</>, busy: 'Checking', done: 'Checked' },
            { v: 'primary' as const, s: 'md' as const, idle: <>Start lesson<ArrowRight className="h-4 w-4" strokeWidth={2} /></>, busy: 'Opening', done: 'Opened' },
            { v: 'secondary' as const, s: 'md' as const, idle: <><RotateCcw className="h-3.5 w-3.5" />Explain another way</>, busy: 'Asking', done: 'Sent' },
            { v: 'primary' as const, s: 'sm' as const, idle: <><Check className="h-3.5 w-3.5" strokeWidth={2.5} />Confirm</>, busy: 'Confirming', done: 'Confirmed' },
            { v: 'ghost' as const, s: 'sm' as const, idle: <><Undo2 className="h-3.5 w-3.5" />Undo</>, busy: 'Undoing', done: 'Undone' },
            { v: 'secondary' as const, s: 'md' as const, idle: <><Volume2 className="h-3.5 w-3.5 text-accent" />Listen</>, busy: 'Preparing voice', done: 'Playing' },
          ].map((b, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              {STATES.map(st => (
                <button key={st} type="button" disabled={st === 'busy'} className={buttonClass(b.v, b.s)} data-state={st}>
                  <Pending state={st} label={b.busy} doneLabel={b.done}>{b.idle}</Pending>
                </button>
              ))}
            </div>
          ))}
          <div className="flex items-center gap-3">
            {[false, true].map(busy => (
              <button key={String(busy)} type="button" disabled={busy} aria-label="Send" aria-busy={busy} className="flex h-11 w-11 items-center justify-center rounded-full">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white">{busy ? <InkMark width={16} /> : <ArrowUp className="h-4 w-4" strokeWidth={2.25} />}</span>
              </button>
            ))}
            <span className="text-[13px] text-muted">Send: idle · tutor answering</span>
          </div>
        </div>
      </Section>

      <Section id="ask-reading" title="Ask: just sent">
        <Turn q="Why does a pendulum’s period depend on its length?"><TurnStatus tools={[]} hasText={false} hasBlocks={false} /></Turn>
      </Section>

      <Section id="ask-tool" title="Ask: drawing on the board (visual on its way)">
        <Turn q="Show me how a pendulum swings">
          <ToolChips tools={[T('compute', 'Checking the maths', 'done'), T('draw_on_board', 'Drawing on the board', 'start')]} hideRunning />
          <TurnStatus tools={[T('compute', 'Checking the maths', 'done'), T('draw_on_board', 'Drawing on the board', 'start')]} hasText={false} hasBlocks={false} />
          <VisualPlaceholder tool={T('draw_on_board', 'Drawing on the board', 'start')} />
        </Turn>
      </Section>

      <Section id="ask-picture" title="Ask / tutor sheet: finding a picture while text streams">
        <Turn q="What does a plant cell look like?">
          <ToolChips tools={[T('find_illustration', 'Finding an illustration', 'start')]} hideRunning />
          <p className="text-[15.5px] leading-relaxed text-ink">A plant cell has a rigid wall outside its membrane, a large central vacuole, and chloroplasts where photosynthesis happens.</p>
          <TurnStatus tools={[T('find_illustration', 'Finding an illustration', 'start')]} hasText hasBlocks={false} />
          <VisualPlaceholder tool={T('find_illustration', 'Finding an illustration', 'start')} />
        </Turn>
      </Section>

      <Section id="ask-graph" title="Ask: plot and simulation placeholders">
        <div className="grid gap-3 md:grid-cols-2">
          <VisualPlaceholder tool={T('plot', 'Plotting', 'start')} />
          <VisualPlaceholder tool={T('simulate', 'Building a simulation', 'start')} />
        </div>
      </Section>

      <Section id="clip" title="Animation rendering (ClipBlock)">
        <div className="space-y-4">
          <figure className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-[var(--shadow-card)]"><ClipWait phase="queued" attempts={1} /></figure>
          <figure className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-[var(--shadow-card)]"><ClipWait phase="rendering" attempts={1} /></figure>
        </div>
      </Section>

      <Section id="lesson-ready" title="Lesson being written">
        <div className="space-y-4">
          <LessonPreparing lessonId="lab" own forceState={PREP_OUTLINE} />
          <LessonPreparing lessonId="lab" own forceState={PREP_DRAFT} />
        </div>
      </Section>

      <Section id="next-part" title="Check questions being written">
        <div className="space-y-3">
          <WaitNote sub="Each one is checked before you see it. No timer.">Writing four fresh questions for you</WaitNote>
        </div>
      </Section>

      <Section id="path" title="Learning path build">
        <div className="space-y-6">
          <StageList stages={[{ label: 'Laying out the ideas up to your goal', state: 'now' }, { label: 'Choosing your first idea and writing its lesson', state: 'next' }]} />
          <StageList stages={[{ label: 'Laying out the ideas up to your goal', state: 'done' }, { label: 'Choosing your first idea and writing its lesson', state: 'now' }]} />
          <span aria-busy="true" className={buttonClass('primary', 'lg', 'pointer-events-none w-full cursor-progress')}><Pending busy label="Writing your first lesson">Start your first lesson<ArrowRight className="h-4 w-4" strokeWidth={2} /></Pending></span>
        </div>
      </Section>

      <Section id="video" title="Video download">
        <div className="space-y-3">
          {[{ t: 'Setting up the recording', v: null as number | null }, { t: 'Recording the lesson with its voice', v: 0.42 }].map((x, i) => (
            <div key={i} className="rounded-[14px] border border-line bg-surface p-3.5 shadow-[var(--shadow-raised)] md:w-[22rem]">
              <div className="flex items-start gap-3">
                <InkMark className="mt-1 flex-shrink-0 text-accent" width={16} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{x.t}</p>
                  <p className="mt-0.5 text-[12px] leading-snug text-muted">Usually about two minutes. Keep learning meanwhile; it downloads by itself when it’s ready. If you leave, tap Video again later.</p>
                  <QuietLine className="mt-2.5" label="Video progress" value={x.v} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="route-lesson" title="Page loading: lesson"><LessonLoading /></Section>
      <Section id="route-ask" title="Page loading: Ask"><AskLoading /></Section>
    </div>
  )
}

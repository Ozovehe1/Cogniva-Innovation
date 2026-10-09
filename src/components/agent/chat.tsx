'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Plus } from 'lucide-react'
import { SafetyPause } from '@/components/safety-pause'
import { cx } from '@/components/ui'
import { AgentBlock } from './blocks'
import { BusyRetry } from './busy-retry'
import { AgentText } from './agent-text'
import { AskEmpty } from './ask-empty'
import { ToolChips, dedupeTools } from './tool-chips'
import { TurnStatus, VisualPlaceholder, VISUAL_TOOL } from './turn-status'
import { InkMark } from '@/components/system/wait'
import { genie } from '@/components/genie/presence'
import { syntheticMouth } from '@/components/genie/lipsync'
import type { Block, ChatEvent } from '@/lib/agent/types'
import { FlaggedNotice, ReportButton } from '@/components/report/report-mistake'

export interface ChatFlag { reportId: string; category?: string | null }
export interface ChatMessage { role: 'user' | 'assistant'; content: string; blocks?: Block[]; tools?: { name: string; label: string; state: string }[]; error?: string | null; flagged?: ChatFlag | null; retry?: { at: number; ms: number; text: string } | null }

/** Teaching output a learner can report (not plans, sources or confirmations). */
const REPORTABLE: Partial<Record<Block['kind'], { what: string; surface: 'ask' | 'diagram' | 'illustration' | 'animation' | 'stage' | 'practice' }>> = {
  board: { what: 'this whiteboard', surface: 'ask' }, svg: { what: 'this picture', surface: 'illustration' }, sim: { what: 'this simulation', surface: 'stage' },
  interactive: { what: 'this figure', surface: 'stage' }, clip: { what: 'this animation', surface: 'animation' }, image: { what: 'this figure', surface: 'diagram' },
  code: { what: 'this calculation', surface: 'ask' }, practice: { what: 'these questions', surface: 'practice' },
}
const retryFor = (what: string, category?: string | null) => `The ${what.replace(/^(this|these) /, '')} you showed me earlier had a mistake${category ? ` (${category.replace('_', ' ')})` : ''}. Please redo it correctly and check the maths.`

/** A visual in an answer, with its own "Report a mistake" and, once flagged, a calm placeholder with a corrected retry. */
function ReportableBlock({ block, sessionId, done, onRetry }: { block: Block; sessionId: string | null; done: boolean; onRetry: (prompt: string) => void }) {
  const meta = REPORTABLE[block.kind]
  const [flag, setFlag] = useState<ChatFlag | null>((block as { flagged?: ChatFlag }).flagged ?? null)
  const [show, setShow] = useState(false)
  const [retryPrompt, setRetryPrompt] = useState<string | null>(null)
  if (!meta) return <AgentBlock block={block} />
  if (flag && !show) return <FlaggedNotice what={meta.what} onRetry={() => onRetry(retryPrompt ?? retryFor(meta.what, flag.category))} onShow={() => setShow(true)} />
  return (
    <div>
      <AgentBlock block={block} />
      {done && sessionId && !flag && (
        <div className="-mb-2 mt-0.5 flex justify-end">
          <ReportButton what={meta.what} defaultCategory={block.kind === 'svg' ? 'wrong_picture' : undefined}
            payload={() => ({ surface: meta.surface, sessionId, blockId: block.id, artefact: { kind: block.kind } })}
            onDone={r => { setFlag({ reportId: r.id, category: r.category }); setRetryPrompt(r.retry?.prompt ?? null) }}
            onRetry={r => onRetry(r.retry?.prompt ?? retryFor(meta.what, r.category))} />
        </div>
      )}
    </div>
  )
}

export function AgentChat({ initialSessionId = null, initialMessages = [], lessonId = null, initialPrompt = null, compact = false, minor = null, onSession }: {
  initialSessionId?: string | null; initialMessages?: ChatMessage[]; lessonId?: string | null; initialPrompt?: string | null; compact?: boolean; minor?: boolean | null; onSession?: (id: string) => void
}) {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId)
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [safety, setSafety] = useState<{ open: boolean; minor: boolean | null }>({ open: false, minor })
  const [remaining, setRemaining] = useState<number | null>(null)
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set())
  const endRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const sentInitial = useRef(false)

  // The tutor character: thinking until the answer starts, "talking" while it streams, listening while the learner types.
  const last = messages[messages.length - 1]
  const streaming = busy && last?.role === 'assistant' && !!last.content
  const [typing, setTyping] = useState(false)
  useEffect(() => { genie.set('thinking', busy && !streaming, 'chat') }, [busy, streaming])
  useEffect(() => { genie.set('listening', typing || input.trim().length > 0, 'chat') }, [typing, input])
  const streamingRef = useRef(false)
  streamingRef.current = streaming
  useEffect(() => {
    const off = genie.addSpeaker(() => (streamingRef.current ? syntheticMouth() * 0.8 : null))
    return () => { off(); genie.set('thinking', false, 'chat'); genie.set('listening', false, 'chat') }
  }, [])

  const scroll = useCallback(() => requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })), [])

  const send = useCallback(async (text: string) => {
    const message = text.trim()
    if (!message || busy) return
    setBusy(true)
    setInput('')
    setMessages(m => [...m, { role: 'user', content: message }, { role: 'assistant', content: '', blocks: [], tools: [] }])
    scroll()
    let finished = false, stalled = false, dropped = false
    let idle: ReturnType<typeof setTimeout> | undefined
    const patch = (fn: (a: ChatMessage) => ChatMessage) => setMessages(m => { const c = [...m]; c[c.length - 1] = fn(c[c.length - 1]); return c })
    try {
      // A healthy turn sends a line at least every 8 s (keep-alive pings while tools run). 40 s of silence means the
      // connection or the server died: stop waiting instead of leaving a spinner running forever.
      const ctl = new AbortController()
      const kick = () => { clearTimeout(idle); idle = setTimeout(() => { stalled = true; ctl.abort() }, 40_000) }
      kick()
      const res = await fetch('/api/agent/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, sessionId, lessonId }), signal: ctl.signal })
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); patch(a => ({ ...a, error: j.error ?? 'Could not reach GeniusMap.' })); return }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        kick()
        buf += dec.decode(value, { stream: true })
        let i: number
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1)
          if (!line.trim()) continue
          let e: ChatEvent
          try { e = JSON.parse(line) } catch { continue }
          if (e.t === 'session') {
            setSessionId(e.id); onSession?.(e.id)
            // On the Ask page the chat lives in the URL, so a reload (or back) reopens it with its flags.
            if (!onSession && !lessonId && window.location.pathname === '/ask') window.history.replaceState(null, '', `/ask?session=${e.id}`)
          }
          else if (e.t === 'text') patch(a => ({ ...a, content: a.content + e.d }))
          else if (e.t === 'tool') patch(a => {
            const tools = [...(a.tools ?? [])]
            const k = tools.findIndex(t => t.name === e.name && t.state === 'start')
            if (e.state === 'start' || k < 0) tools.push({ name: e.name, label: e.label, state: e.state }); else tools[k] = { ...tools[k], state: e.state }
            return { ...a, tools }
          })
          else if (e.t === 'block') { patch(a => { const bs = a.blocks ?? []; const k = bs.findIndex(b => b.id === e.block.id && b.kind === e.block.kind); return { ...a, blocks: k >= 0 ? bs.map((b, j) => (j === k ? e.block : b)) : [...bs, e.block] } }); scroll() }
          else if (e.t === 'safety') { setSafety({ open: true, minor: e.minor }); setMessages(m => m.slice(0, -2)) }
          else if (e.t === 'limit') patch(a => ({ ...a, content: e.message }))
          else if (e.t === 'error') patch(a => (e.retryAfterMs ? { ...a, retry: { at: Date.now() + e.retryAfterMs, ms: e.retryAfterMs, text: message } } : { ...a, error: e.message }))
          else if (e.t === 'done') { finished = true; if (typeof e.remaining === 'number') setRemaining(e.remaining) }
        }
      }
    } catch {
      dropped = true
    } finally {
      clearTimeout(idle)
      // The stream ended without "done": the turn was cut off. Running tool chips stop (never an endless spinner), and
      // the learner is told plainly, keeping whatever visuals did arrive.
      if (!finished) patch(a => ({
        ...a,
        tools: (a.tools ?? []).map(t => (t.state === 'start' ? { ...t, state: 'error' } : t)),
        error: a.error ?? (a.retry ? null : stalled ? 'This answer stalled, so I stopped waiting. Ask again and I’ll pick it up.' : dropped ? 'The connection dropped. Try again.' : (a.content || (a.blocks ?? []).length) ? 'This answer was cut short. Ask me to carry on.' : 'Something went wrong while answering. Try again.'),
      }))
      setBusy(false)
      scroll()
    }
  }, [busy, sessionId, lessonId, onSession, scroll])

  useEffect(() => {
    if (initialPrompt && !sentInitial.current) { sentInitial.current = true; void send(initialPrompt) }
  }, [initialPrompt, send])
  useEffect(() => { if (initialMessages.length) scroll() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    if (busy) return
    setSessionId(null); setMessages([]); inputRef.current?.focus()
    if (!onSession && !lessonId && window.location.pathname === '/ask' && window.location.search) window.history.replaceState(null, '', '/ask')
  }

  return (
    <div className={cx('flex flex-col', compact ? 'h-full' : 'min-h-[calc(100dvh-180px)]')}>
      <div className={cx('flex-1', compact && 'overflow-y-auto overscroll-contain px-4 pt-3')}>
        {messages.length === 0 ? (
          <AskEmpty inLesson={!!lessonId} compact={compact} onPick={t => void send(t)} />
        ) : (
          <div className="mx-auto max-w-[760px] space-y-6 pb-4">
            {messages.map((m, i) => m.role === 'user' ? (
              <div key={i} className="flex justify-end"><div className="max-w-[85%] whitespace-pre-wrap rounded-[16px] rounded-br-[6px] bg-accent px-4 py-2.5 text-[15px] leading-relaxed text-white">{m.content}</div></div>
            ) : (
              <div key={i} className="space-y-3">
                <ToolChips tools={m.tools ?? []} hideRunning={busy && i === messages.length - 1} />
                {m.content && m.flagged && !revealed.has(i) ? <FlaggedNotice what="this answer" onRetry={() => void send(retryFor('answer', m.flagged?.category))} onShow={() => setRevealed(r => new Set(r).add(i))} />
                  : m.content ? <AgentText text={m.content} /> : null}
                {busy && i === messages.length - 1 && !m.error && !m.retry && <TurnStatus tools={m.tools ?? []} hasText={!!m.content} hasBlocks={!!(m.blocks ?? []).length} />}
                {m.content && !m.flagged && sessionId && !(busy && i === messages.length - 1) && (
                  <div className="-my-2 -ml-2.5">
                    <ReportButton what="this answer" payload={() => ({ surface: 'ask', sessionId, text: m.content })}
                      onDone={r => setMessages(ms => ms.map((x, k) => (k === i ? { ...x, flagged: { reportId: r.id, category: r.category } } : x)))}
                      onRetry={r => void send(r.retry?.prompt ?? retryFor('answer', r.category))} />
                  </div>
                )}
                {(m.blocks ?? []).map(b => <ReportableBlock key={b.id + b.kind} block={b} sessionId={sessionId} done={!(busy && i === messages.length - 1)} onRetry={p => void send(p)} />)}
                {busy && i === messages.length - 1 && dedupeTools(m.tools ?? []).filter(t => t.state === 'start' && VISUAL_TOOL[t.name]).map(t => <VisualPlaceholder key={`ph-${t.label}`} tool={t} />)}
                {m.retry && !m.error && <BusyRetry compact={compact} retryAt={m.retry.at} totalMs={m.retry.ms} onRetry={() => { if (!busy) { setMessages(ms => ms.filter((_, j) => j !== i && j !== i - 1)); void send(m.retry!.text) } }} />}
                {m.error && <p className="rounded-[10px] border border-danger-line bg-danger-soft px-3 py-2 text-[14px] text-danger">{m.error}</p>}
              </div>
            ))}
            <div ref={endRef} className={compact ? 'scroll-mb-4' : 'scroll-mb-[calc(152px+env(safe-area-inset-bottom))] md:scroll-mb-28'} />
          </div>
        )}
      </div>
      <form onSubmit={e => { e.preventDefault(); void send(input) }}
        className={cx('z-20', compact ? 'border-t border-line bg-surface px-3 pb-[calc(10px+env(safe-area-inset-bottom))] pt-2.5' : 'sticky bottom-[calc(72px+env(safe-area-inset-bottom))] -mx-4 bg-canvas/95 px-4 pb-2 pt-2 backdrop-blur-sm sm:-mx-6 sm:px-6 md:bottom-0 md:-mx-10 md:px-10 md:pb-6')}>
        <div className="mx-auto flex max-w-[760px] items-end gap-2">
          {messages.length > 0 && <button type="button" onClick={reset} aria-label="New chat" className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted hover:text-ink"><Plus className="h-4 w-4" /></button>}
          <div className="flex min-w-0 flex-1 items-end rounded-[22px] border border-line bg-surface pl-4 pr-1.5 shadow-[var(--shadow-card)] focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15">
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} rows={1} maxLength={2000}
              onFocus={() => setTyping(true)} onBlur={() => setTyping(false)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); void send(input) } }}
              placeholder={lessonId ? 'Ask about this lesson…' : 'Ask GeniusMap…'} aria-label="Message"
              className="max-h-36 min-h-11 flex-1 resize-none bg-transparent py-2.5 text-[16px] leading-snug text-ink placeholder:text-faint focus:outline-none focus-visible:outline-none" />
            {/* While the tutor answers, Send stays where it is at full colour with the ink mark (the same size, no jump),
                and is disabled so a second tap cannot send twice; what is happening is said in the turn itself. */}
            <button type="submit" disabled={busy || !input.trim()} aria-label={busy ? 'Sending (your tutor is answering)' : 'Send'} aria-busy={busy}
              className={cx('-mr-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full transition-opacity focus-visible:outline-2 focus-visible:outline-accent', busy ? 'cursor-progress' : 'disabled:opacity-35')}>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white">{busy ? <InkMark width={16} /> : <ArrowUp className="h-4 w-4" strokeWidth={2.25} />}</span>
            </button>
          </div>
        </div>
        {remaining !== null && remaining <= 5 && <p className="mx-auto mt-1.5 max-w-[760px] text-center text-[12px] text-muted">{remaining} message{remaining === 1 ? '' : 's'} left today</p>}
      </form>
      <SafetyPause open={safety.open} minor={safety.minor} onContinue={() => setSafety(s => ({ ...s, open: false }))} />
    </div>
  )
}

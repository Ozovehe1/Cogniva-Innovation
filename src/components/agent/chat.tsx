'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, Loader2, Plus, Sparkles, X } from 'lucide-react'
import { RichText } from '@/components/rich-text'
import { SafetyPause } from '@/components/safety-pause'
import { cx } from '@/components/ui'
import { AgentBlock } from './blocks'
import type { Block, ChatEvent } from '@/lib/agent/types'

export interface ChatMessage { role: 'user' | 'assistant'; content: string; blocks?: Block[]; tools?: { name: string; label: string; state: string }[]; error?: string | null }

const SUGGESTIONS = [
  'Explain how a ball thrown up comes back down, on the board',
  'What did we cover in my last lesson?',
  'Give me a quick practice set on my current topic',
  'Show me a simulation of a pendulum',
]

/** Light markdown for the agent's text: paragraphs, bullet and numbered lists, **bold**, links; maths through RichText (KaTeX). */
function AgentText({ text }: { text: string }) {
  // Models write maths as \( \) and \[ \] too: normalise to $ … $ for RichText.
  const norm = text.replace(/\r/g, '').replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => `$${m.trim()}$`).replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => `$${m.trim()}$`)
  const blocks = norm.split(/\n{2,}/)
  const inline = (s: string, k: string) => {
    const parts = s.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s)\]]+)/g)
    return parts.map((p, i) => p.startsWith('**') && p.endsWith('**') ? <strong key={`${k}${i}`} className="font-semibold text-ink"><RichText text={p.slice(2, -2)} /></strong>
      : /^https?:\/\//.test(p) ? <a key={`${k}${i}`} href={p} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent underline underline-offset-2">{p.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}</a>
      : <RichText key={`${k}${i}`} text={p.replace(/^#{1,4}\s+/, '')} />)
  }
  return (
    <div className="space-y-2.5 text-[15.5px] leading-[1.6] text-ink">
      {blocks.map((b, i) => {
        const lines = b.split('\n').filter(l => l.trim())
        if (lines.length && lines.every(l => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d/.test(lines[0])
          const L = ordered ? 'ol' : 'ul'
          return <L key={i} className={cx('space-y-1 pl-5', ordered ? 'list-decimal' : 'list-disc marker:text-faint')}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), `${i}.${j}.`)}</li>)}</L>
        }
        return <p key={i}>{lines.map((l, j) => <React.Fragment key={j}>{j > 0 && <br />}{inline(l, `${i}.${j}.`)}</React.Fragment>)}</p>
      })}
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
  const endRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const sentInitial = useRef(false)

  const scroll = useCallback(() => requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })), [])

  const send = useCallback(async (text: string) => {
    const message = text.trim()
    if (!message || busy) return
    setBusy(true)
    setInput('')
    setMessages(m => [...m, { role: 'user', content: message }, { role: 'assistant', content: '', blocks: [], tools: [] }])
    scroll()
    const patch = (fn: (a: ChatMessage) => ChatMessage) => setMessages(m => { const c = [...m]; c[c.length - 1] = fn(c[c.length - 1]); return c })
    try {
      const res = await fetch('/api/agent/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, sessionId, lessonId }) })
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); patch(a => ({ ...a, error: j.error ?? 'Could not reach GeniusMap.' })); return }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i: number
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1)
          if (!line.trim()) continue
          let e: ChatEvent
          try { e = JSON.parse(line) } catch { continue }
          if (e.t === 'session') { setSessionId(e.id); onSession?.(e.id) }
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
          else if (e.t === 'error') patch(a => ({ ...a, error: e.message }))
          else if (e.t === 'done' && typeof e.remaining === 'number') setRemaining(e.remaining)
        }
      }
    } catch {
      patch(a => ({ ...a, error: 'The connection dropped. Try again.' }))
    } finally {
      setBusy(false)
      scroll()
    }
  }, [busy, sessionId, lessonId, onSession, scroll])

  useEffect(() => {
    if (initialPrompt && !sentInitial.current) { sentInitial.current = true; void send(initialPrompt) }
  }, [initialPrompt, send])
  useEffect(() => { if (initialMessages.length) scroll() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { if (busy) return; setSessionId(null); setMessages([]); inputRef.current?.focus() }

  return (
    <div className={cx('flex flex-col', compact ? 'h-full' : 'min-h-[calc(100dvh-180px)]')}>
      <div className={cx('flex-1', compact && 'overflow-y-auto overscroll-contain px-4 pt-3')}>
        {messages.length === 0 ? (
          <div className={cx('mx-auto max-w-xl', compact ? 'py-4' : 'py-8 md:py-12')}>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent"><Sparkles className="h-5 w-5" strokeWidth={1.75} /></span>
            <h2 className="mt-4 font-display text-[28px] leading-tight text-ink">{lessonId ? 'Stuck on something in this lesson?' : 'What do you want to understand?'}</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">Ask anything. GeniusMap explains on the board, draws diagrams, builds simulations and checks the maths. It knows your lessons and your path.</p>
            <div className="mt-6 grid gap-2">
              {(lessonId ? ['Explain this step another way, on the board', 'Give me one more example', 'Quiz me on this lesson'] : SUGGESTIONS).map(s => (
                <button key={s} type="button" onClick={() => send(s)} className="rounded-[12px] border border-line bg-surface px-4 py-3 text-left text-[14.5px] text-ink shadow-[var(--shadow-card)] transition-colors hover:border-line-strong">{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-[760px] space-y-6 pb-4">
            {messages.map((m, i) => m.role === 'user' ? (
              <div key={i} className="flex justify-end"><div className="max-w-[85%] whitespace-pre-wrap rounded-[16px] rounded-br-[6px] bg-accent px-4 py-2.5 text-[15px] leading-relaxed text-white">{m.content}</div></div>
            ) : (
              <div key={i} className="space-y-3">
                {(m.tools ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {dedupe(m.tools ?? []).map((t, k) => (
                      <span key={k} className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]', t.state === 'error' ? 'border-clay-line text-clay' : 'border-line text-muted')}>
                        {t.state === 'start' ? <Loader2 className="h-3 w-3 animate-spin" /> : t.state === 'error' ? <X className="h-3 w-3" /> : <Check className="h-3 w-3 text-accent" strokeWidth={2.5} />}{t.label}
                      </span>
                    ))}
                  </div>
                )}
                {m.content ? <AgentText text={m.content} /> : busy && i === messages.length - 1 && !(m.blocks ?? []).length ? <p className="flex items-center gap-2 text-[14px] text-muted"><Loader2 className="h-4 w-4 animate-spin" />Thinking…</p> : null}
                {(m.blocks ?? []).map(b => <AgentBlock key={b.id + b.kind} block={b} />)}
                {m.error && <p className="rounded-[10px] border border-danger-line bg-danger-soft px-3 py-2 text-[14px] text-danger">{m.error}</p>}
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>
      <form onSubmit={e => { e.preventDefault(); void send(input) }}
        className={cx('z-20', compact ? 'border-t border-line bg-surface px-3 pb-[calc(10px+env(safe-area-inset-bottom))] pt-2.5' : 'sticky bottom-[calc(72px+env(safe-area-inset-bottom))] -mx-4 bg-canvas/95 px-4 pb-2 pt-2 backdrop-blur-sm sm:-mx-6 sm:px-6 md:bottom-0 md:-mx-10 md:px-10 md:pb-6')}>
        <div className="mx-auto flex max-w-[760px] items-end gap-2">
          {messages.length > 0 && <button type="button" onClick={reset} aria-label="New chat" className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted hover:text-ink"><Plus className="h-4 w-4" /></button>}
          <div className="flex min-w-0 flex-1 items-end rounded-[22px] border border-line bg-surface pl-4 pr-1.5 shadow-[var(--shadow-card)] focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15">
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} rows={1} maxLength={2000}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); void send(input) } }}
              placeholder={lessonId ? 'Ask about this lesson…' : 'Ask GeniusMap…'} aria-label="Message"
              className="max-h-36 min-h-11 flex-1 resize-none bg-transparent py-2.5 text-[16px] leading-snug text-ink placeholder:text-faint focus:outline-none" />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send" className="mb-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-accent text-white transition-opacity disabled:opacity-35">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" strokeWidth={2.25} />}
            </button>
          </div>
        </div>
        {remaining !== null && remaining <= 5 && <p className="mx-auto mt-1.5 max-w-[760px] text-center text-[12px] text-muted">{remaining} messages left today</p>}
      </form>
      <SafetyPause open={safety.open} minor={safety.minor} onContinue={() => setSafety(s => ({ ...s, open: false }))} />
    </div>
  )
}

function dedupe(tools: { name: string; label: string; state: string }[]) {
  const out: typeof tools = []
  for (const t of tools) { const k = out.findIndex(x => x.label === t.label); if (k >= 0) out[k] = t; else out.push(t) }
  return out
}

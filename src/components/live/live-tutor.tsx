'use client'
/**
 * The Live Tutor in the lesson: collects learner signals (answers, slider/scene/embed changes, idle, hesitation,
 * pauses, replays, "I'm lost"), runs the wake policy locally (so quiet moments cost nothing), wakes the agent at
 * /api/tutor/live, and renders whatever the agent puts up in the adaptive stage slot under the board, even while a
 * check is open. The agent decides what to do; this component never picks a response.
 * Dev trace: add ?trace=1 to the lesson URL (or localStorage 'ideanimo:trace' = '1') to see signal → reasoning →
 * plan → tools → outcome for every wake.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { LifeBuoy, Play, X } from 'lucide-react'
import { AgentBlock } from '@/components/agent/blocks'
import { RichText } from '@/components/rich-text'
import { InkMark } from '@/components/system/wait'
import { buttonClass, cx } from '@/components/ui'
import type { PlayerControl, PlayerEvent } from '@/components/whiteboard/player'
import type { Block } from '@/lib/agent/types'
import { SIGNAL_EVENT, type LearnerSignal } from '@/lib/live/signals'
import { WAKE, newWakeState, noteSlider, shouldWake } from '@/lib/live/policy'
import { genie } from '@/components/genie/presence'

interface Act { id: string; signal: LearnerSignal; text: string; blocks: Block[]; tools: string[]; decision?: { move: string | null; reason: string; plan: string[] }; outcome?: string; ms?: number; busy: boolean }

export function useLiveTutor({ lessonId, control, enabled }: { lessonId: string; control: React.MutableRefObject<PlayerControl | null>; enabled: boolean }) {
  const [acts, setActs] = useState<Act[]>([])
  const [off, setOff] = useState(false)
  const wake = useRef(newWakeState())
  const recent = useRef<LearnerSignal[]>([])
  const lastInput = useRef(Date.now())
  const checkOpenSince = useRef<number | null>(null)
  const checkKey = useRef<string | null>(null)
  const inflight = useRef(false)
  const sliderBuf = useRef(new Map<string, { s: LearnerSignal; first: number | undefined; t: ReturnType<typeof setTimeout> }>())
  const stageVals = useRef(new Map<string, string>())
  const actsRef = useRef<Act[]>([])
  useEffect(() => { actsRef.current = acts }, [acts])

  const stageSummary = useCallback(() => {
    const out: string[] = []
    for (const a of actsRef.current.slice(-3)) for (const b of a.blocks) {
      const x = b as unknown as { kind: string; id: string; tool?: string; title?: string; alt?: string; spec?: { title?: string } }
      const name = x.kind === 'embed' ? `${x.tool}` : x.kind
      const vals = [...stageVals.current.entries()].filter(([k]) => k.includes(x.id) || (x.title && k.includes(x.title)) || (x.spec?.title && k.includes(x.spec.title))).map(([, v]) => v).slice(-2).join('; ')
      out.push(`${name}: ${x.id} "${(x.title ?? x.spec?.title ?? x.alt ?? '').slice(0, 60)}"${vals ? ` — learner set ${vals}` : ''}`)
    }
    return out.slice(-4)
  }, [])

  const send = useCallback(async (s: LearnerSignal) => {
    if (off || !enabled) return
    recent.current = [...recent.current, s].slice(-14)
    const d = shouldWake(wake.current, s, Date.now())
    if (!d.wake || inflight.current) return
    inflight.current = true
    const cur = control.current?.current()
    const act: Act = { id: `${Date.now()}`, signal: s, text: '', blocks: [], tools: [], busy: true }
    setActs(a => [...a.slice(-5), act])
    const upd = (f: (x: Act) => Act) => setActs(a => a.map(x => (x.id === act.id ? f(x) : x)))
    genie.set('thinking', true, 'live')
    try {
      const res = await fetch('/api/tutor/live', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonId, signal: s, recent: recent.current, stage: stageSummary(), cursor: cur ? Math.max(0, cur.origIndex + 1) : 0 }),
        signal: AbortSignal.timeout(110_000),
      })
      if (res.status === 404) { const j = await res.json().catch(() => ({})); if (j.off) setOff(true); setActs(a => a.filter(x => x.id !== act.id)); return }
      if (!res.ok || !res.body) { setActs(a => a.filter(x => x.id !== act.id)); return }
      if ((res.headers.get('content-type') ?? '').includes('application/json')) { setActs(a => a.filter(x => x.id !== act.id)); return }
      const reader = res.body.getReader(), dec = new TextDecoder()
      let buf = '', woke = true, paused = false
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i: number
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1)
          let e: Record<string, unknown>
          try { e = JSON.parse(line) } catch { continue }
          if (e.t === 'wake' && !e.woke) woke = false
          else if (e.t === 'text') { upd(x => ({ ...x, text: x.text + String(e.d) })); if (!paused && control.current?.isPlaying()) { control.current.pause(); paused = true } }
          else if (e.t === 'block') { upd(x => ({ ...x, blocks: [...x.blocks.filter(b => b.id !== (e.block as Block).id), e.block as Block] })); if (!paused && control.current?.isPlaying()) { control.current.pause(); paused = true } }
          else if (e.t === 'tool' && e.state === 'done') upd(x => ({ ...x, tools: [...x.tools, String(e.name)] }))
          else if (e.t === 'decision') upd(x => ({ ...x, decision: { move: (e.move as string) ?? null, reason: String(e.reason ?? ''), plan: (e.plan as string[]) ?? [] } }))
          else if (e.t === 'done') upd(x => ({ ...x, outcome: String(e.outcome ?? ''), ms: Number(e.ms) || undefined, busy: false }))
        }
      }
      if (!woke) setActs(a => a.filter(x => x.id !== act.id))
      else upd(x => ({ ...x, busy: false }))
    } catch {
      setActs(a => a.filter(x => x.id !== act.id))
    } finally {
      inflight.current = false
      genie.set('thinking', false, 'live')
    }
  }, [lessonId, control, off, enabled, stageSummary])

  // Signals from figures, scenes and embeds anywhere on the page.
  useEffect(() => {
    if (!enabled) return
    const onSig = (ev: Event) => {
      const s = (ev as CustomEvent<LearnerSignal>).detail
      if (!s?.kind) return
      lastInput.current = Date.now()
      if (s.kind === 'slider') {
        // One drag = one move: coalesce by control, from its first value to where the learner let go.
        const key = `${s.where}|${s.param}`
        if (s.value !== undefined && s.param) stageVals.current.set(`${s.where} ${s.param}`, `${s.param}=${Number(s.value.toFixed(3))}`)
        const prev = sliderBuf.current.get(key)
        if (prev) clearTimeout(prev.t)
        const first = prev ? prev.first : s.from
        const t = setTimeout(() => {
          sliderBuf.current.delete(key)
          const move = { ...s, from: first, at: Date.now() }
          noteSlider(wake.current, move)
          // Settle: wake only once the learner has let go for a moment (the policy checks it).
          setTimeout(() => void send(move), WAKE.sliderSettleMs + 50)
        }, 900)
        sliderBuf.current.set(key, { s, first, t })
        return
      }
      void send(s)
    }
    window.addEventListener(SIGNAL_EVENT, onSig)
    return () => window.removeEventListener(SIGNAL_EVENT, onSig)
  }, [enabled, send])

  // Idle and hesitation: timers only wake the agent; they never say what to do.
  useEffect(() => {
    if (!enabled) return
    const mark = () => { lastInput.current = Date.now() }
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    evs.forEach(e => window.addEventListener(e, mark, { passive: true }))
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const cur = control.current?.current()
      const atCheck = cur?.step?.type === 'check'
      const now = Date.now()
      if (atCheck) {
        const key = `check ${cur!.origIndex}`
        if (checkKey.current !== key) { checkKey.current = key; checkOpenSince.current = now; lastInput.current = Math.max(lastInput.current, now) }
      } else { checkKey.current = null; checkOpenSince.current = null }
      const quiet = (now - lastInput.current) / 1000
      if (atCheck && quiet >= WAKE.hesitationS && !wake.current.hesitatedAt[checkKey.current!]) {
        const st = cur!.step as { prompt?: string }
        void send({ kind: 'hesitation', at: now, where: checkKey.current!, seconds: Math.round(quiet), detail: st.prompt?.slice(0, 200), step: cur!.origIndex })
      } else if (!atCheck && quiet >= WAKE.idleS && !control.current?.isPlaying()) {
        void send({ kind: 'idle', at: now, seconds: Math.round(quiet), detail: 'lesson paused', step: cur?.origIndex })
      }
    }, 2000)
    return () => { clearInterval(t); evs.forEach(e => window.removeEventListener(e, mark)) }
  }, [enabled, control, send])

  /** Player events → signals (wrong answers, replays). */
  const onPlayerEvent = useCallback((e: PlayerEvent) => {
    if (!enabled) return
    if (e.type === 'check' && e.response === 'answer') { lastInput.current = Date.now(); void send({ kind: 'answer', at: Date.now(), correct: e.correct, answer: e.answer, step: e.origIndex, where: `check ${e.origIndex}` }) }
    else if (e.type === 'check' && e.response === 'again') void send({ kind: 'replay', at: Date.now(), step: e.origIndex, detail: 'watched the part again' })
    else if (e.type === 'restart') void send({ kind: 'replay', at: Date.now(), detail: `restarted the ${e.scope}` })
  }, [enabled, send])

  const lost = useCallback((detail?: string) => { lastInput.current = Date.now(); void send({ kind: 'lost', at: Date.now(), detail, step: control.current?.current().origIndex }) }, [send, control])
  const dismiss = useCallback((id: string) => setActs(a => a.filter(x => x.id !== id)), [])

  return { acts, off, onPlayerEvent, lost, dismiss }
}

const traceOn = () => typeof window !== 'undefined' && (new URLSearchParams(window.location.search).get('trace') === '1' || window.localStorage?.getItem('ideanimo:trace') === '1')

/** The adaptive stage: whatever the tutor put up, under the board, while the lesson waits. */
export function LiveStage({ acts, onDismiss, onResume, onLost, off }: { acts: Act[]; onDismiss: (id: string) => void; onResume: () => void; onLost: () => void; off: boolean }) {
  const [trace, setTrace] = useState(false)
  useEffect(() => { setTrace(traceOn()) }, [])
  const shown = acts.filter(a => a.busy || a.text.trim() || a.blocks.length || trace)
  const last = shown[shown.length - 1]
  return (
    <div className="mt-3" data-live-stage>
      <AnimatePresence initial={false}>
        {last && (
          <motion.section key={last.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-[14px] border border-accent/30 bg-accent-soft/40 p-3.5" aria-live="polite" data-live-act={last.signal.kind}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-accent">Your tutor</span>
              <button type="button" aria-label="Close" onClick={() => onDismiss(last.id)} className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface"><X className="h-4 w-4" /></button>
            </div>
            {last.busy && !last.text && !last.blocks.length && <p className="flex items-center gap-2 text-[14.5px] text-ink-2"><InkMark className="text-accent" width={18} />Looking at what you just did…</p>}
            {last.text.trim() && <div className="text-[15px] leading-relaxed text-ink"><RichText text={last.text.trim()} /></div>}
            {last.blocks.map(b => <div key={b.id} className="mt-3"><AgentBlock block={b} /></div>)}
            {!last.busy && (last.text.trim() || last.blocks.length > 0) && (
              <button type="button" onClick={() => { onResume(); onDismiss(last.id) }} className={cx(buttonClass('secondary', 'md'), 'mt-3 h-10 gap-1.5')}><Play className="h-4 w-4" />Back to the lesson</button>
            )}
            {trace && (
              <div className="mt-3 rounded-[10px] border border-line bg-surface p-2.5 font-mono text-[11.5px] leading-snug text-ink-2" data-live-trace>
                <div>signal: {last.signal.kind}{last.signal.correct === false ? ' (wrong)' : ''}{last.signal.param ? ` ${last.signal.param}` : ''}</div>
                <div>move: {last.decision?.move ?? '…'} — {last.decision?.reason}</div>
                {last.decision?.plan?.length ? <div>plan: {last.decision.plan.join(' → ')}</div> : null}
                <div>tools: {last.tools.join(', ') || 'none'}</div>
                <div>outcome: {last.outcome ?? '…'}{last.ms ? ` · ${(last.ms / 1000).toFixed(1)} s` : ''}</div>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>
      {!off && (
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={onLost} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[14px] text-ink-2 hover:text-ink" data-live-lost>
            <LifeBuoy className="h-4 w-4" />I’m lost
          </button>
        </div>
      )}
    </div>
  )
}

'use client'
import React, { useCallback, useEffect, useState } from 'react'
import { WhiteboardPlayer, type PlayerEvent } from '@/components/whiteboard'
import { getNarrator, type AudioLogEntry } from '@/components/whiteboard/narrator'
import { stepSpeech } from '@/components/whiteboard/speech'
import { RichText } from '@/components/rich-text'
import type { Step } from '@/lib/lesson-schema'
import type { Chapter } from '@/lib/lesson-sections'

/** What the recorder (modal_app/manim_render.py, lesson_video) reads and drives on this page. */
interface RenderHandle {
  ready: boolean
  /** Lines that have no natural audio (they would be silent in the video). */
  missing: number
  lines: number
  total: number
  cursor: number
  done: boolean
  /** Wall-clock ms when start() was called: the video's time zero. */
  startedAt: number | null
  start: () => number
  errors: string[]
}

type W = Window & { __gmAudioLog?: AudioLogEntry[]; __gmRender?: RenderHandle }

// Before anything creates the narrator: it logs every narration play/stop for the recorder (see narrator.ts).
if (typeof window !== 'undefined') (window as W).__gmAudioLog ??= []

const FRAME_W = 1280
const FRAME_H = 720
const BOARD_W_PX = 1088
const TITLE_MS = 2600

/** Run `fn` over `items` with at most `n` at a time. */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

export function RenderPlayer({ lessonId, title, subject, steps, chapters }: { lessonId: string; title: string; subject: string; steps: Step[]; chapters: Chapter[] }) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'title' | 'play'>('loading')

  // Get every line's audio and every clip into the cache first, so the recording never waits on the network.
  useEffect(() => {
    const w = window as W
    const handle: RenderHandle = {
      ready: false, missing: 0, lines: 0, total: steps.length, cursor: 0, done: false, startedAt: null, errors: [],
      start: () => { handle.startedAt = Date.now(); setPhase('title'); return handle.startedAt },
    }
    w.__gmRender = handle
    window.addEventListener('error', e => handle.errors.push(String(e.message).slice(0, 300)))
    let live = true
    void (async () => {
      const n = getNarrator()
      const texts = [...new Set(steps.map(s => stepSpeech(s)).filter(t => t.trim()))]
      handle.lines = texts.length
      let missing = 0
      await pool(texts, 8, async t => { const r = n.prepare ? await n.prepare(t, 20_000) : null; if (!r) missing++ })
      const clips = [...new Set(steps.flatMap(s => (s.type === 'manim_clip' ? [s.url] : [])))]
      await pool(clips, 3, async u => { await fetch(u, { cache: 'force-cache' }).then(r => r.blob()).catch(() => null) })
      await document.fonts?.ready.catch(() => null)
      if (!live) return
      handle.missing = missing
      handle.ready = true
      setPhase('ready')
    })()
    return () => { live = false }
  }, [steps, lessonId])

  useEffect(() => {
    if (phase !== 'title') return
    const t = setTimeout(() => setPhase('play'), TITLE_MS)
    return () => clearTimeout(t)
  }, [phase])

  const onEvent = useCallback((e: PlayerEvent) => {
    const h = (window as W).__gmRender
    if (!h) return
    if (e.type === 'position') h.cursor = e.cursor
    else if (e.type === 'complete') { h.cursor = h.total; h.done = true }
  }, [])

  return (
    <div className="relative overflow-hidden bg-canvas" style={{ width: FRAME_W, height: FRAME_H }} data-render-phase={phase}>
      {phase === 'play' ? (
        <div className="absolute" style={{ width: BOARD_W_PX, left: (FRAME_W - BOARD_W_PX) / 2, top: 20 }}>
          <WhiteboardPlayer steps={steps} chapters={chapters} title={title} autoPlay renderMode onEvent={onEvent} />
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-24 text-center">
          {phase !== 'loading' && (
            <>
              {subject && <p className="text-[14px] font-medium uppercase tracking-[0.12em] text-muted">{subject}</p>}
              <h1 className="mt-3 max-w-[900px] font-display text-[52px] leading-[1.08] text-ink"><RichText text={title} /></h1>
              <p className="mt-6 text-[15px] text-faint">GeniusMap</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

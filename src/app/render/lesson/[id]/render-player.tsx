'use client'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { WhiteboardPlayer, type PlayerEvent } from '@/components/whiteboard'
import { getNarrator, type AudioLogEntry } from '@/components/whiteboard/narrator'
import { stepSpeech } from '@/components/whiteboard/speech'
import { loadPenPaths } from '@/components/whiteboard/clip-pen'
import { RichText } from '@/components/rich-text'
import type { Step } from '@/lib/lesson-schema'
import type { Chapter } from '@/lib/lesson-sections'

/**
 * What the recorder (modal_app/lesson_video.py) reads and drives on this page. The recorder runs the page on a virtual
 * clock (modal_app/lesson_video_clock.js), stepping it frame by frame, so playback here is as it is for a learner.
 */
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

/**
 * Plays steps [from, to) of the lesson: the board starts as it stands after step from-1 (built silently, exactly as it is
 * at that moment of a full playback) and the part ends when step to-1 has finished. Only the first part opens on the
 * title card. Parts rendered side by side and joined make the whole lesson.
 */
export function RenderPlayer({ lessonId, title, subject, steps: allSteps, chapters: allChapters, from = 0, to }: { lessonId: string; title: string; subject: string; steps: Step[]; chapters: Chapter[]; from?: number; to?: number }) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'title' | 'play'>('loading')
  const end = Math.min(allSteps.length, to ?? allSteps.length)
  const steps = useMemo(() => allSteps.slice(0, end), [allSteps, end])
  const chapters = useMemo(() => allChapters.filter(c => c.start < end).map(c => ({ ...c, count: Math.min(c.count, end - c.start) })), [allChapters, end])
  // Checks before this part were answered in an earlier part.
  const answered = useMemo(() => steps.flatMap((s, i) => (i < from && s.type === 'check' ? [i] : [])), [steps, from])

  // Get every line's audio and every clip into the cache first, so the recording never waits on the network.
  useEffect(() => {
    const w = window as W
    const handle: RenderHandle = {
      ready: false, missing: 0, lines: 0, total: steps.length, cursor: 0, done: false, startedAt: null, errors: [],
      start: () => { handle.startedAt = Date.now(); setPhase(from > 0 ? 'play' : 'title'); return handle.startedAt },
    }
    w.__gmRender = handle
    window.addEventListener('error', e => handle.errors.push(String(e.message).slice(0, 300)))
    let live = true
    void (async () => {
      const n = getNarrator()
      const part = steps.slice(from)
      const texts = [...new Set(part.map(s => stepSpeech(s)).filter(t => t.trim()))]
      handle.lines = texts.length
      let missing = 0
      await pool(texts, 8, async t => { const r = n.prepare ? await n.prepare(t, 20_000) : null; if (!r) missing++ })
      const clips = [...new Set(part.flatMap(s => (s.type === 'manim_clip' ? [s.url] : [])))]
      await pool(clips, 3, async u => { await Promise.all([fetch(u, { cache: 'force-cache' }).then(r => r.blob()).catch(() => null), loadPenPaths(u)]) })
      await document.fonts?.ready.catch(() => null)
      if (!live) return
      handle.missing = missing
      handle.ready = true
      setPhase('ready')
    })()
    return () => { live = false }
  }, [steps, lessonId, from])

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
          <WhiteboardPlayer steps={steps} chapters={chapters} title={title} autoPlay renderMode onEvent={onEvent} initialIndex={from} answered={answered} />
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-24 text-center">
          {phase !== 'loading' && (
            <>
              {subject && <p className="text-[14px] font-medium uppercase tracking-[0.12em] text-muted">{subject}</p>}
              <h1 className="mt-3 max-w-[900px] font-display text-[52px] leading-[1.08] text-ink"><RichText text={title} /></h1>
              <p className="mt-6 text-[15px] text-faint">Ideanimo</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

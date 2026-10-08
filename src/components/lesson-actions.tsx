'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, FileText, Film, Globe, X } from 'lucide-react'
import { Spinner, buttonClass, cx } from './ui'

export { LessonDelete } from './delete-dialog'

type VideoStatus = 'none' | 'queued' | 'preparing' | 'rendering' | 'done' | 'failed'
interface VideoState { status: VideoStatus; progress: number; etaSec: number | null; error?: string | null; cached?: boolean }

const POLL_MS = 5000
const active = (s: VideoStatus | undefined) => s === 'queued' || s === 'preparing' || s === 'rendering'

function etaLabel(v: VideoState) {
  if (v.status === 'queued' || v.status === 'preparing') return 'Getting the video ready…'
  const min = v.etaSec ? Math.max(1, Math.round(v.etaSec / 60)) : null
  return min ? `Rendering video… about ${min} min` : 'Rendering video…'
}

/**
 * Download menu: a self-contained HTML copy of the lesson, its transcript as text, or a video of it as it plays.
 * The video is rendered only when asked for (then cached while the lesson is unchanged); progress shows in a small
 * toast and the MP4 downloads by itself when it is ready.
 */
export function LessonDownload({ lessonId }: { lessonId: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [video, setVideo] = useState<VideoState | null>(null)
  const [toast, setToast] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** A render this page started or joined: download it when it finishes. */
  const waiting = useRef(false)
  const api = `/api/lessons/${lessonId}/video`

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  const download = useCallback(() => { window.location.assign(`${api}?download=1`) }, [api])

  const apply = useCallback((v: VideoState) => {
    setVideo(v)
    if (v.status === 'done' && waiting.current) { waiting.current = false; download() }
    if (v.status === 'failed') waiting.current = false
  }, [download])

  // While a render runs, check on it every few seconds.
  useEffect(() => {
    if (!active(video?.status)) return
    const t = setTimeout(async () => {
      const res = await fetch(api, { cache: 'no-store' }).catch(() => null)
      const j = res?.ok ? await res.json().catch(() => null) as VideoState | null : null
      // A failed poll keeps the last state and tries again on the next tick.
      if (j) apply(j)
      else setVideo(v => (v ? { ...v } : v))
    }, POLL_MS)
    return () => clearTimeout(t)
  }, [video, api, apply])

  const startVideo = async () => {
    setOpen(false)
    setError(null)
    setToast(true)
    if (active(video?.status)) { waiting.current = true; return }
    setBusy(true)
    const res = await fetch(api, { method: 'POST' }).catch(() => null)
    setBusy(false)
    const j = res ? await res.json().catch(() => null) as (VideoState & { error?: string }) | null : null
    if (!res || !res.ok || !j || !j.status) { setError(j?.error ?? 'Could not start the video. Check your connection and try again.'); return }
    waiting.current = true
    apply(j)
  }

  // A finished download note goes away by itself.
  useEffect(() => {
    if (!toast || video?.status !== 'done' || error) return
    const t = setTimeout(() => setToast(false), 6000)
    return () => clearTimeout(t)
  }, [toast, video?.status, error])

  const item = 'flex w-full items-start gap-3 rounded-[10px] px-3 py-2.5 text-left hover:bg-sunken'
  const rendering = active(video?.status)
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} className={buttonClass('secondary', 'md')}>
        <Download className="h-4 w-4" strokeWidth={1.75} />Download<ChevronDown className="h-3.5 w-3.5 text-muted" strokeWidth={2} />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 z-40 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-[14px] border border-line bg-surface p-1.5 shadow-[var(--shadow-raised)]">
          <a role="menuitem" href={`/api/lessons/${lessonId}/export?format=html`} download onClick={() => setOpen(false)} className={item}>
            <Globe className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" strokeWidth={1.75} />
            <span><span className="block text-sm font-medium text-ink">Offline lesson (.html)</span><span className="block text-[12px] leading-snug text-muted">Transcript, boards and clips in one file. Print it to save a PDF.</span></span>
          </a>
          <a role="menuitem" href={`/api/lessons/${lessonId}/export?format=txt`} download onClick={() => setOpen(false)} className={item}>
            <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" strokeWidth={1.75} />
            <span><span className="block text-sm font-medium text-ink">Transcript (.txt)</span><span className="block text-[12px] leading-snug text-muted">Just the words, with the in-lesson checks.</span></span>
          </a>
          <button type="button" role="menuitem" onClick={startVideo} disabled={busy} className={item} data-video-status={video?.status ?? 'none'}>
            {rendering || busy ? <Spinner className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" /> : <Film className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" strokeWidth={1.75} />}
            <span>
              <span className="block text-sm font-medium text-ink">Video (.mp4)</span>
              <span className="block text-[12px] leading-snug text-muted">
                {rendering && video ? etaLabel(video) : video?.status === 'done' ? 'Ready. Tap to download again.' : 'The lesson as it plays, with the voice. Made when you tap.'}
              </span>
            </span>
          </button>
        </div>
      )}
      {toast && (
        <div role="status" aria-live="polite"
          className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 rounded-[14px] border border-line bg-surface p-3.5 shadow-[var(--shadow-raised)] md:inset-x-auto md:bottom-6 md:right-6 md:w-[22rem]">
          <div className="flex items-start gap-3">
            {error || video?.status === 'failed'
              ? <Film className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted" strokeWidth={1.75} />
              : video?.status === 'done' ? <Download className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" strokeWidth={1.75} /> : <Spinner className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">
                {error ? 'Video not started' : video?.status === 'failed' ? 'The video couldn’t be made' : video?.status === 'done' ? (video.cached ? 'Downloading your video' : 'Your video is ready') : video ? etaLabel(video) : 'Starting the video…'}
              </p>
              <p className="mt-0.5 text-[12px] leading-snug text-muted">
                {error ?? (video?.status === 'failed' ? (video.error ?? 'Something went wrong while recording.') : video?.status === 'done'
                  ? <>It should download now. <button type="button" onClick={download} className="font-medium text-accent underline-offset-2 hover:underline">Download again</button></>
                  : 'You can keep learning or leave this page. It will be ready here when you come back.')}
              </p>
              {rendering && video && (
                <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-label="Video progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(video.progress * 100)}>
                  <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(3, Math.round(video.progress * 100))}%` }} />
                </div>
              )}
              {(error || video?.status === 'failed') && !error?.includes('a day') && (
                <button type="button" onClick={startVideo} className={cx(buttonClass('secondary', 'sm'), 'mt-2.5')}>Try again</button>
              )}
            </div>
            <button type="button" onClick={() => setToast(false)} aria-label="Hide" className="-m-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink">
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

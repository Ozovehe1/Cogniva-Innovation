'use client'
import { useEffect } from 'react'
import { getNarrator } from '@/components/whiteboard/narrator'

/**
 * Mounted on the dashboard and lesson lists: wakes the narration voice (it scales to
 * zero when idle), asks the server to voice the up-next lesson, and fetches that
 * lesson's opening lines into this tab's narrator, so pressing Start speaks at once.
 */
export function VoiceWarm({ lessonId, lines = [] }: { lessonId?: string | null; lines?: string[] }) {
  const key = `${lessonId ?? ''}|${lines.join('|')}`
  useEffect(() => {
    void fetch('/api/tts/warm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lessonId: lessonId ?? null }), keepalive: true }).catch(() => {})
    if (lines.length) getNarrator().preload?.(lines)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return null
}

'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { Pending, buttonClass } from './ui'

/** Creates the AI lesson for a ready topic (drafting starts on the server), then opens it. */
export function TopicStart({ topicId, label = 'Start lesson', variant = 'primary', size = 'md' }: { topicId: string; label?: string; variant?: 'primary' | 'secondary'; size?: 'md' | 'lg' }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    setBusy(true); setError(null)
    const res = await fetch(`/api/topics/${topicId}/start`, { method: 'POST' }).catch(() => null)
    const data = await res?.json().catch(() => ({})) as { lessonId?: string; error?: string } | undefined
    if (res?.ok && data?.lessonId) router.push(`/learn/${data.lessonId}`)
    else { setBusy(false); setError(data?.error ?? 'Could not start the lesson. Try again.') }
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={go} disabled={busy} className={buttonClass(variant, size)}>
        <Pending state={busy ? 'busy' : error ? 'failed' : 'idle'} label="Opening" failedLabel={label}>{label}<ArrowRight className="h-4 w-4" strokeWidth={2} /></Pending>
      </button>
      {error && <span role="status" className="text-[13px] text-ink-2">{error}</span>}
    </span>
  )
}

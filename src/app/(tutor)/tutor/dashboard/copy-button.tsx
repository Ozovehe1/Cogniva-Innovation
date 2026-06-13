'use client'
import { useState } from 'react'

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button onClick={copy}
      className="px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 transition"
      style={{
        background: copied ? 'rgba(34,197,94,0.15)' : 'rgba(124,58,237,0.15)',
        color: copied ? '#22C55E' : '#A78BFA',
        border: `1px solid ${copied ? 'rgba(34,197,94,0.25)' : 'rgba(124,58,237,0.25)'}`,
      }}>
      {copied ? '✓ Copied' : 'Copy ID'}
    </button>
  )
}

'use client'
import { useState } from 'react'
import { buttonClass } from '@/components/ui'

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button onClick={copy} className={buttonClass('secondary', 'sm', 'flex-shrink-0')}>
      {copied ? 'Copied' : 'Copy ID'}
    </button>
  )
}

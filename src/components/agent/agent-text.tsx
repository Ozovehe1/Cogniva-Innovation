'use client'
import React from 'react'
import { RichText } from '@/components/rich-text'
import { cx } from '@/components/ui'

/**
 * Light markdown for the agent's text: paragraphs, bullet and numbered lists, **bold**, links; maths through RichText
 * (KaTeX). Markdown links show their label (not a raw URL), markdown images are dropped (pictures arrive as their own
 * credited blocks), and the server's history notes ("[shown in chat: …]") never reach the learner.
 */
export function AgentText({ text }: { text: string }) {
  // Models write maths as \( \) and \[ \] too: normalise to $ … $ for RichText.
  const norm = text.replace(/\r/g, '')
    .replace(/\[shown in chat:[^\]\n]*\]/gi, '')
    .replace(/!\[[^\]\n]*\]\([^)\s]+\)/g, '')
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => `$${m.trim()}$`).replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => `$${m.trim()}$`)
    .replace(/\n{3,}/g, '\n\n').trim()
  // A list that starts right under a sentence (no blank line, as models often write) is still a list.
  const isItem = (l: string) => /^\s*([-*•]|\d+[.)])\s+/.test(l)
  const blocks = norm.split('\n').reduce<string[]>((acc, l, i, all) => {
    const prev = i ? all[i - 1] : ''
    if (i && prev.trim() && l.trim() && isItem(l) !== isItem(prev)) acc.push('')
    acc.push(l)
    return acc
  }, []).join('\n').split(/\n{2,}/)
  const link = (href: string, label: string, k: string) => (
    <a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow" className="break-words font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">{label}</a>
  )
  const inline = (s: string, k: string) => {
    const parts = s.split(/(\*\*[^*]+\*\*|(?<![*\w])\*[^*\s](?:[^*\n]*[^*\s])?\*(?![*\w])|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)\]]+)/g)
    return parts.map((p, i) => {
      if (p.startsWith('**') && p.endsWith('**')) return <strong key={`${k}${i}`} className="font-semibold text-ink"><RichText text={p.slice(2, -2)} /></strong>
      if (/^\*[^*\n]+\*$/.test(p)) return <em key={`${k}${i}`} className="text-ink-2"><RichText text={p.slice(1, -1)} /></em>
      const md = /^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(p)
      if (md) return link(md[2], md[1], `${k}${i}`)
      if (/^https?:\/\//.test(p)) return link(p, p.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 42) + (p.length > 52 ? '…' : ''), `${k}${i}`)
      return <RichText key={`${k}${i}`} text={p.replace(/^#{1,4}\s+/, '')} />
    })
  }
  return (
    <div className="space-y-2.5 text-[15.5px] leading-[1.6] text-ink">
      {blocks.filter(b => b.trim()).map((b, i) => {
        const lines = b.split('\n').filter(l => l.trim())
        if (lines.length && lines.every(l => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d/.test(lines[0])
          const L = ordered ? 'ol' : 'ul'
          return <L key={i} className={cx('space-y-1 pl-5', ordered ? 'list-decimal marker:text-muted' : 'list-disc marker:text-faint')}>{lines.map((l, j) => <li key={j} className="pl-0.5">{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), `${i}.${j}.`)}</li>)}</L>
        }
        if (lines.length === 1 && /^#{1,4}\s+/.test(lines[0])) return <p key={i} className="pt-1 font-semibold text-ink">{inline(lines[0], `${i}.h.`)}</p>
        return <p key={i}>{lines.map((l, j) => <React.Fragment key={j}>{j > 0 && <br />}{inline(l, `${i}.${j}.`)}</React.Fragment>)}</p>
      })}
    </div>
  )
}

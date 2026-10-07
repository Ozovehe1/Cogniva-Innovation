import React from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { prepareMathText, texToPlain } from '@/lib/math-text'

/** Multiplication typed as * is shown as ×, never KaTeX's ∗ (repairTex does the same). */
function renderInline(tex: string, display: boolean) {
  return katex.renderToString(display ? `\\displaystyle ${tex}` : tex, { throwOnError: false, displayMode: false, output: 'html', strict: 'ignore' })
}

/**
 * The one renderer for AI-written text anywhere in the app: questions, options,
 * feedback, transcript lines, notes and topic titles. Inline $...$ / \(...\) and
 * bare LaTeX (\times, ^{...}, \text{...}) render with KaTeX; a snippet KaTeX cannot
 * parse even after repair is shown as plain Unicode, never as backslash commands.
 * Works in server and client components. Long maths wraps or scrolls on a phone.
 */
export function RichText({ text, display = false, className }: { text: string | null | undefined; display?: boolean; className?: string }) {
  const segs = prepareMathText(String(text ?? ''))
  return (
    <span className={className ? `rt ${className}` : 'rt'}>
      {segs.map((s, i) => {
        if (s.t === 'text') return <React.Fragment key={i}>{s.v}</React.Fragment>
        if (!s.ok) return <span key={i} className="rt-plain">{texToPlain(s.v)}</span>
        return <span key={i} className={display || s.display ? 'rt-math rt-display' : 'rt-math'} dangerouslySetInnerHTML={{ __html: renderInline(s.v, display || s.display) }} />
      })}
    </span>
  )
}

/** Plain-string version for places that cannot hold markup (document titles, aria labels). */
export { toPlainText } from '@/lib/math-text'

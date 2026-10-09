'use client'
import { useEffect } from 'react'

/** Last-resort boundary (the root layout itself failed): plain inline styles, no app CSS or fonts are guaranteed. */
export default function GlobalError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => { console.error(error) }, [error])
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100dvh', background: '#F7F5F0', color: '#14141A', fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif', display: 'grid', placeItems: 'center', padding: 20 }}>
        <main style={{ maxWidth: 420 }}>
          <p style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#66666F', margin: 0 }}>Something went wrong</p>
          <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 400, fontSize: 32, lineHeight: 1.1, margin: '12px 0 0' }}>GeniusMap didn’t load. It’s on our side, not yours.</h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: '#66666F' }}>Your lessons and progress are saved. Try again, or come back in a few minutes.</p>
          <button type="button" onClick={() => unstable_retry()} style={{ marginTop: 16, height: 48, padding: '0 24px', borderRadius: 10, border: 0, background: '#1F4D3A', color: '#fff', fontSize: 15, fontWeight: 500 }}>Try again</button>
          {error.digest && <p style={{ fontSize: 12, color: '#8E8C86', marginTop: 16 }}>Reference: {error.digest}</p>}
        </main>
      </body>
    </html>
  )
}

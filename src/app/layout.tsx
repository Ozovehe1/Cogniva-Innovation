import type { Metadata, Viewport } from 'next'
import { Inter, Newsreader } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-newsreader',
  display: 'swap',
  style: ['normal', 'italic'],
})

const DESCRIPTION = 'An AI tutor that gets to know your goal, your level and how you feel, finds what you know with a short adaptive check, then teaches you on a live whiteboard with a natural voice, at your pace.'

export const metadata: Metadata = {
  metadataBase: new URL('https://cogniva-innovation.vercel.app'),
  title: { default: 'GeniusMap · An AI tutor at your level and pace', template: '%s' },
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: 'GeniusMap',
    title: 'GeniusMap · An AI tutor at your level and pace',
    description: DESCRIPTION,
    url: '/',
  },
  twitter: { card: 'summary', title: 'GeniusMap · An AI tutor at your level and pace', description: DESCRIPTION },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#F7F5F0',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable}`}>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">{children}</body>
    </html>
  )
}

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

export const metadata: Metadata = {
  title: 'GeniusMap',
  description: 'Understand how you learn best, and work on projects your tutor matches to your strengths.',
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

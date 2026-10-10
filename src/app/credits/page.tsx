import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { SiteFooter, SiteHeader } from '@/components/site-chrome'

export const metadata = {
  title: 'Credits & licences · Ideanimo',
  description: 'The free illustration libraries and open-source software Ideanimo is built with, and how each picture is credited.',
}

/* Library counts are from src/lib/illustrations/library.json (Oct 2026: servier 3,020, bio 2,773, commons 2,538). Every library picture is also credited where it is shown. */
const libraries = [
  { name: 'Servier Medical Art', url: 'https://smart.servier.com/', what: 'Medical and biology drawings: organs, cells, the heart, the brain.', licences: 'CC BY 4.0', count: 'about 3,000' },
  { name: 'Bioicons', url: 'https://bioicons.com/', what: 'Science icons from many authors: lab equipment, molecules, cells, organisms.', licences: 'CC0, CC BY 3.0 / 4.0, CC BY-SA, MIT (per icon)', count: 'about 2,800' },
  { name: 'Wikimedia Commons', url: 'https://commons.wikimedia.org/', what: 'Diagrams from physics, chemistry, geography and engineering.', licences: 'Public domain, CC0, CC BY, CC BY-SA (per file)', count: 'about 2,500' },
]

const software = [
  ['Next.js, React', 'MIT'], ['Manim Community (animations)', 'MIT'], ['Kokoro-82M (the natural voice)', 'Apache 2.0'], ['JSXGraph (live figures)', 'LGPL / MIT'],
  ['Penrose (exact diagrams)', 'MIT'], ['KaTeX (maths typesetting)', 'MIT'], ['Rive runtime (Genie)', 'MIT'], ['three.js (the 3D hand)', 'MIT'],
  ['GSAP (board motion)', 'GSAP standard licence (free)'], ['Rough.js, perfect-freehand (the pen)', 'MIT'], ['Framer Motion', 'MIT'], ['Lucide icons', 'ISC'],
  ['Inter, Newsreader (fonts)', 'SIL Open Font License'], ['VTracer (tracing pictures to SVG)', 'MIT'],
] as const

export default function CreditsPage() {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <SiteHeader />
      <main className="mx-auto max-w-[860px] px-5 pb-20 pt-12 md:px-8 md:pt-16">
        <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-accent">Credits &amp; licences</p>
        <h1 className="mt-3 font-display text-[38px] leading-[1.08] md:text-[50px]">Built with other people’s generous work.</h1>
        <p className="mt-5 max-w-[38rem] text-[16px] leading-relaxed text-ink-2">
          Most pictures in lessons come from free illustration libraries, and the app is built on open-source software. Thank you to
          every author below.
        </p>

        <section className="mt-12" aria-labelledby="pics">
          <h2 id="pics" className="font-display text-[26px] leading-tight md:text-[30px]">Pictures</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
            Every library picture is credited where you see it: its title, author, source and licence sit right under it, each linked. Where a
            licence asks us to say what we changed, the credit says so (for example “vectorised” when a photo-style original was traced
            to a drawing). Pictures under share-alike licences keep that licence.
          </p>
          <ul className="mt-6 grid gap-3">
            {libraries.map(l => (
              <li key={l.name} className="rounded-[14px] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-[17px] font-semibold text-ink hover:text-accent">
                    {l.name}<ExternalLink className="h-3.5 w-3.5 text-muted" strokeWidth={2} aria-hidden /><span className="sr-only">(opens in a new tab)</span>
                  </a>
                  <span className="tnum text-[13px] text-muted">{l.count} pictures</span>
                </div>
                <p className="text-[15px] leading-relaxed text-ink-2">{l.what}</p>
                <p className="mt-2 text-[13px] text-muted"><span className="font-medium text-ink-2">Licences:</span> {l.licences}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[14px] leading-relaxed text-muted">
            Spotted a picture that’s wrong, or credited wrongly? Tap <span className="font-medium text-ink-2">Report a mistake</span> under it and choose “Wrong picture”.
          </p>
        </section>

        <section className="mt-14" aria-labelledby="sw">
          <h2 id="sw" className="font-display text-[26px] leading-tight md:text-[30px]">Software</h2>
          <dl className="mt-5 divide-y divide-line border-y border-line">
            {software.map(([name, lic]) => (
              <div key={name} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 py-3">
                <dt className="text-[15px] text-ink">{name}</dt>
                <dd className="text-[14px] text-muted">{lic}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[14px] leading-relaxed text-muted">Lessons and answers are written by AI models (Google Gemini and open models served by Groq).</p>
        </section>

        <p className="mt-14 text-[15px]"><Link href="/about" className="font-medium text-accent underline-offset-4 hover:underline">← How Ideanimo works</Link></p>
      </main>
      <SiteFooter />
    </div>
  )
}

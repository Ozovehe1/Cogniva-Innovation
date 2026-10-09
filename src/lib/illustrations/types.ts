/** One entry of the free illustration library (see scripts/build-illustration-index.mjs). */
export interface LibraryItem {
  id: string
  /** bio = Bioicons, servier = Servier Medical Art, commons = Wikimedia Commons */
  src: 'bio' | 'servier' | 'commons'
  /** title */
  t: string
  /** keywords (category, search topic, file words) */
  k: string
  /** description (Commons) */
  d?: string
  lic: string
  licUrl: string | null
  by: string
  /** the image file (SVG, or PNG for Servier) */
  file: string
  /** the page to credit and link */
  page: string
  fmt: 'svg' | 'png'
  bytes?: number
}

/** The attribution shown with every library illustration (CC BY needs title, author, source and licence). */
export interface Credit {
  title: string
  author: string
  source: string
  license: string
  licenseUrl?: string | null
  url: string
  /** 'vectorised' when a raster original was traced to SVG (a change the licence asks us to note). */
  changes?: string
}

export const SOURCE_NAME: Record<LibraryItem['src'], string> = { bio: 'Bioicons', servier: 'Servier Medical Art', commons: 'Wikimedia Commons' }

export function creditLine(c: Credit): string {
  return `“${c.title}” by ${c.author}${c.source && c.source !== c.author ? ` (${c.source})` : ''}, ${c.license}${c.changes ? `; ${c.changes}` : ''}`
}

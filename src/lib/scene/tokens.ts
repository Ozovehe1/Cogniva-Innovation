/**
 * "Night Lab": the one art direction every live scene uses (research/visual-stack.md §5). A deep-ink stage inside the
 * app's cream cards; light only on what is changing; gold means "something is happening". Specs never carry colours,
 * fonts or pixels: the engine reads them from here.
 */
export const NL = {
  bg: '#0E1322',
  bgLift: '#17203A',
  panel: '#0B0F1B',
  grid: 'rgba(255,255,255,0.06)',
  field: '#7FB2FF',
  fieldLine: 'rgba(127,178,255,0.30)',
  fieldHi: 'rgba(160,205,255,0.85)',
  particle: '159,212,255',
  gold: '#FFD166',
  goldRgb: '255,209,102',
  north: '#FF6B5E',
  south: '#4C8DFF',
  copper: '#D9864A',
  copperD: '#7A4524',
  copperHi: 'rgba(255,220,180,0.55)',
  text: '#E8ECF3',
  muted: '#8E9AB5',
  faint: '#5A6684',
  steel: '#9AA6BF',
  steelD: '#3A4560',
  oxy: '#FF6B5E',
  deoxy: '#6F8DFF',
  tissue: '#C9576A',
  tissueD: '#7E2E40',
  green: '#7BD389',
  dial: '#F6F3EC',
  needle: '#C0392B',
} as const

export const FONT = 'Inter, "Inter Fallback", ui-sans-serif, system-ui, -apple-system, "Segoe UI", "DejaVu Sans", sans-serif'
export const MONO = 'ui-monospace, Menlo, "DejaVu Sans Mono", monospace'

/** Phone-first type scale (CSS px at the drawn size). */
export const TYPE = { caption: 13, label: 12, small: 11, big: 15 } as const

/** Strokes ≥ 1.5 px and arrowheads ≥ 7 px at 390 px. */
export const STROKE = { hair: 1, thin: 1.5, base: 2, bold: 3 } as const

export const EASE = {
  linear: (t: number) => t,
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  out: (t: number) => 1 - (1 - t) ** 3,
  in: (t: number) => t * t * t,
  /** A soft overshoot that settles (instrument-like). */
  spring: (t: number) => 1 - Math.exp(-6 * t) * Math.cos(9 * t),
} as const
export type EaseName = keyof typeof EASE

/** Caption pill: ≤ 44 characters fits 390 px in one line. */
export const CAPTION_MAX = 44
export const LABEL_MAX = 22

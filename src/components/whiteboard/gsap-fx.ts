/**
 * GSAP for the board's motion cues, loaded on first use (keeps it out of the first page load): MorphSVG (a shape
 * becomes another), MotionPath (glide along a path), DrawSVG (a bright pen traces an outline). The pen-drawn ink
 * itself stays on the board's own engine (./pen), which the hand follows. All free in the public gsap package.
 */
import type { gsap as Gsap } from 'gsap'

let loading: Promise<typeof Gsap> | null = null

export function loadGsap(): Promise<typeof Gsap> {
  loading ??= Promise.all([import('gsap'), import('gsap/DrawSVGPlugin'), import('gsap/MorphSVGPlugin'), import('gsap/MotionPathPlugin')])
    .then(([g, d, m, p]) => {
      g.gsap.registerPlugin(d.DrawSVGPlugin, m.MorphSVGPlugin, p.MotionPathPlugin)
      return g.gsap
    })
    .catch(err => { loading = null; throw err })
  return loading
}

/** Whether the board is likely to need GSAP (warm the chunk while the first steps are drawn). */
export function needsGsap(types: Iterable<string>): boolean {
  for (const t of types) if (t === 'morph' || t === 'along' || t === 'pulse') return true
  return false
}

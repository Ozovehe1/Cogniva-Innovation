/** Shared (browser + server) facts about the external stage tools. */

export type EmbedKind = 'circuit' | 'molecule' | 'mermaid' | 'physics' | 'geogebra' | 'phet' | 'desmos'

export const PHYSICS_KINDS = {
  drop: { title: 'Dropping two objects', params: ['massA', 'massB', 'airDrag'], defaults: { massA: 1, massB: 5, airDrag: 0 }, range: { massA: [0.2, 20], massB: [0.2, 20], airDrag: [0, 0.05] } },
  incline: { title: 'A block on a ramp', params: ['angle', 'friction', 'mass'], defaults: { angle: 30, friction: 0.2, mass: 2 }, range: { angle: [0, 60], friction: [0, 1], mass: [0.5, 10] } },
  collision: { title: 'Two carts colliding', params: ['massA', 'massB', 'speedA', 'bounce'], defaults: { massA: 2, massB: 1, speedA: 4, bounce: 1 }, range: { massA: [0.5, 10], massB: [0.5, 10], speedA: [0.5, 10], bounce: [0, 1] } },
  projectile: { title: 'Launching a ball', params: ['angle', 'speed'], defaults: { angle: 45, speed: 12 }, range: { angle: [5, 85], speed: [2, 20] } },
} as const satisfies Record<string, { title: string; params: readonly string[]; defaults: Record<string, number>; range: Record<string, readonly [number, number]> }>
export type PhysicsKind = keyof typeof PHYSICS_KINDS

export interface PhetSim { slug: string; title: string; url: string; licence: 'CC BY 4.0' | 'CC BY-NC 4.0' }

/**
 * Historical versions built before 2026-03-29 are CC BY 4.0 (buildTimestamp checked 2026-10-10 on phet.colorado.edu);
 * sims with no such version use `latest` (CC BY-NC 4.0, fine while Ideanimo is non-commercial).
 */
const PHET: [string, string, string | null][] = [
  ['ohms-law', "Ohm's Law", '1.4.29'],
  ['faradays-law', "Faraday's Law", '1.4.23'],
  ['gravity-and-orbits', 'Gravity and Orbits', '1.6.27'],
  ['projectile-motion', 'Projectile Motion', '1.0.33'],
  ['states-of-matter-basics', 'States of Matter: Basics', '1.2.21'],
  ['molecule-shapes', 'Molecule Shapes', '1.6.18'],
  ['wave-on-a-string', 'Wave on a String', '1.2.2'],
  ['ph-scale', 'pH Scale', '1.7.4'],
  ['natural-selection', 'Natural Selection', '1.5.13'],
  ['forces-and-motion-basics', 'Forces and Motion: Basics', '2.6.2'],
  ['pendulum-lab', 'Pendulum Lab', '1.0.33'],
  ['graphing-quadratics', 'Graphing Quadratics', '1.4.2'],
  ['circuit-construction-kit-dc', 'Circuit Construction Kit: DC', null],
  ['energy-skate-park-basics', 'Energy Skate Park: Basics', null],
  ['build-an-atom', 'Build an Atom', null],
  ['balancing-chemical-equations', 'Balancing Chemical Equations', null],
]
export const PHET_SIMS: PhetSim[] = PHET.map(([slug, title, v]) => ({ slug, title, url: `https://phet.colorado.edu/sims/html/${slug}/${v ?? 'latest'}/${slug}_all.html`, licence: v ? 'CC BY 4.0' : 'CC BY-NC 4.0' }))
export const phetSim = (slug: string) => PHET_SIMS.find(s => s.slug === slug) ?? null
export const PHET_CREDIT = 'PhET Interactive Simulations, University of Colorado Boulder, https://phet.colorado.edu'

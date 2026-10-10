/**
 * Cell structure (animal or plant): membrane (and cell wall for plants), nucleus with nucleolus and pores, rough ER
 * studded with ribosomes, Golgi stacks, mitochondria with cristae, and for plants chloroplasts with grana and a large
 * vacuole. Alive, not a diagram: the cytoplasm streams (particles drift round the cell, chloroplasts ride the stream
 * in plants), mitochondria give off small ATP sparks, vesicles bud from the Golgi to the membrane.
 */
import { halo, rng, stageBackground, type KindRuntime, type Params, type View } from '../engine'
import { blob } from '../primitives'
import { NL } from '../tokens'
import type { KindInfo } from '../types'

export const CELL_INFO: KindInfo = {
  id: 'cell',
  blurb: 'cell structure, cell_type "animal" or "plant": nucleus, membrane, (cell wall, chloroplasts, vacuole for plants), mitochondria, ER with ribosomes, Golgi; cytoplasm streams; highlight organelles one by one',
  params: {
    cell_type: { type: 'enum', options: ['animal', 'plant'], default: 'animal', label: 'Animal or plant cell' },
    streaming: { type: 'number', min: 0, max: 2, default: 1, step: 0.1, label: 'Cytoplasm streaming' },
  },
  targets: ['membrane', 'cell_wall', 'nucleus', 'nucleolus', 'mitochondria', 'chloroplasts', 'vacuole', 'er', 'ribosomes', 'golgi', 'cytoplasm'],
  example: {
    title: 'Inside a plant cell',
    params: { cell_type: 'plant' },
    beats: [
      { do: 'highlight', target: 'nucleus', dur: 1.8, caption: 'Nucleus: holds the DNA, runs the cell' },
      { do: 'highlight', target: 'chloroplasts', dur: 1.8, caption: 'Chloroplasts: make food from light' },
      { do: 'highlight', target: 'mitochondria', dur: 1.8, caption: 'Mitochondria: release energy (ATP)' },
      { do: 'highlight', target: 'vacuole', dur: 1.8, caption: 'Vacuole: stores water, keeps cell firm' },
      { do: 'highlight', target: 'cell_wall', dur: 1.8, caption: 'Cell wall: a strong outer layer' },
    ],
    controls: [],
    labels: [{ target: 'nucleus', text: 'nucleus' }, { target: 'chloroplasts', text: 'chloroplast' }, { target: 'mitochondria', text: 'mitochondrion' }, { target: 'vacuole', text: 'vacuole' }],
    drag: false,
    alt: 'A plant cell with its wall, membrane, nucleus, chloroplasts, mitochondria and a large vacuole; the cytoplasm streams slowly round the cell.',
  },
}

interface Mito { x: number; y: number; a: number; l: number }
interface S { t: number; ps: { a: number; r: number; s: number }[]; mitos: Mito[]; chl: { a: number; r: number; rot: number }[]; sparks: { x: number; y: number; life: number }[]; ves: { f: number; k: number }[]; r: () => number; rot: number }

const plant = (P: Params) => P.cell_type === 'plant'
/** Cell outline half-sizes (world units). */
const RX = 2.75, RY = 1.95

function nucleusPos(P: Params) { return plant(P) ? { x: -1.45, y: 0.45, rx: 0.68, ry: 0.6 } : { x: -0.15, y: 0.1, rx: 0.78, ry: 0.68 } }
const ellipsePt = (a: number, r: number) => ({ x: Math.cos(a) * RX * r, y: Math.sin(a) * RY * r })

export const cell: KindRuntime<S> = {
  info: CELL_INFO,
  aspect: 0.78,
  plot: 0,
  world: () => ({ x0: -3.05, x1: 3.05, y0: -2.25, y1: 2.25 }),
  init: P => {
    const r = rng(21)
    const pl = plant(P)
    const mitos: Mito[] = pl
      ? [{ x: 0.3, y: -1.25, a: 0.3, l: 0.55 }, { x: 1.9, y: -0.55, a: -1.2, l: 0.5 }, { x: -0.6, y: 1.3, a: 0.9, l: 0.48 }]
      : [{ x: 1.55, y: 0.95, a: 0.5, l: 0.6 }, { x: 1.7, y: -0.75, a: -0.6, l: 0.55 }, { x: -1.7, y: -0.8, a: 1.0, l: 0.55 }, { x: -1.9, y: 0.85, a: -0.4, l: 0.5 }]
    return {
      t: 0, r, rot: 0, mitos, sparks: [],
      ps: Array.from({ length: 70 }, () => ({ a: r() * Math.PI * 2, r: 0.55 + r() * 0.37, s: 0.6 + r() * 0.8 })),
      chl: pl ? Array.from({ length: 7 }, (_, i) => ({ a: i / 7 * Math.PI * 2 + 0.3, r: 0.86, rot: r() })) : [],
      ves: Array.from({ length: 3 }, (_, i) => ({ f: i / 3, k: i })),
    }
  },
  step: (s, P, dt) => {
    const k = Number(P.streaming ?? 1)
    s.t += dt
    s.rot += dt * 0.08 * k
    for (const p of s.ps) p.a += dt * 0.12 * k * p.s
    for (const c of s.chl) c.a += dt * 0.06 * k
    for (const v of s.ves) { v.f += dt * 0.25; if (v.f > 1) { v.f -= 1; v.k++ } }
    if (s.r() < dt * 3) { const m = s.mitos[Math.floor(s.r() * s.mitos.length)]; s.sparks.push({ x: m.x + (s.r() - 0.5) * 0.4, y: m.y + (s.r() - 0.5) * 0.3, life: 0 }) }
    s.sparks = s.sparks.filter(q => (q.life += dt) < 1.2)
  },
  draw: (c, s, P, v, fx) => {
    stageBackground(c, v, 0.5, 0.5)
    const pl = plant(P), u = v.u, cx = v.X(0), cy = v.Y(0)
    const e = (k: string) => fx.emph(k)
    const ring = (k: string) => (e(k) > 0.05 ? `rgba(255,209,102,${0.55 + 0.45 * e(k)})` : null)
    // Cell wall (plant): a rigid rounded rectangle; membrane: a soft blob.
    if (pl) {
      c.save(); if (e('cell_wall') > 0) { c.shadowColor = NL.gold; c.shadowBlur = 20 * e('cell_wall') }
      c.strokeStyle = ring('cell_wall') ?? '#6FAF6A'; c.lineWidth = 7
      c.beginPath(); c.roundRect(v.X(-RX - 0.12), v.Y(RY + 0.12), (2 * RX + 0.24) * u, (2 * RY + 0.24) * u, 0.5 * u); c.stroke()
      c.strokeStyle = 'rgba(160,220,150,0.35)'; c.lineWidth = 1.5; c.stroke()
      c.restore()
    }
    const memE = e('membrane'), cyE = e('cytoplasm')
    if (pl) {
      c.save(); c.fillStyle = cyE > 0 ? `rgba(120,150,110,${0.28 + 0.15 * cyE})` : 'rgba(70,110,80,0.28)'
      c.beginPath(); c.roundRect(v.X(-RX), v.Y(RY), 2 * RX * u, 2 * RY * u, 0.42 * u); c.fill()
      c.strokeStyle = ring('membrane') ?? 'rgba(190,230,190,0.6)'; c.lineWidth = 2 + 2 * memE; if (memE > 0) { c.shadowColor = NL.gold; c.shadowBlur = 16 * memE } c.stroke(); c.restore()
    } else {
      blob(c, cx, cy, RX * u, RY * u, { fill: cyE > 0 ? `rgba(110,130,190,${0.24 + 0.15 * cyE})` : 'rgba(90,110,170,0.22)', stroke: ring('membrane') ?? 'rgba(170,190,255,0.65)', wobble: 0.035, seed: 2, t: s.t, w: 2.2 + 2 * memE })
    }
    // Cytoplasm streaming: soft particles circulating.
    if (!fx.reduced) for (const p of s.ps) {
      const q = ellipsePt(p.a, p.r)
      c.fillStyle = pl ? 'rgba(180,230,170,0.35)' : 'rgba(170,190,255,0.35)'
      c.beginPath(); c.arc(v.X(q.x), v.Y(q.y), 1.5, 0, Math.PI * 2); c.fill()
    }
    // Vacuole (plant): large, central-right, slightly translucent.
    if (pl) {
      const ve = e('vacuole')
      if (ve > 0) halo(c, v.X(0.75), v.Y(0.15), 1.9 * u, NL.goldRgb, ve)
      blob(c, v.X(0.75), v.Y(0.18), 1.35 * u, 1.05 * u, { fill: 'rgba(120,170,230,0.20)', stroke: ring('vacuole') ?? 'rgba(150,200,255,0.6)', wobble: 0.05, seed: 5, t: s.t * 0.6, w: 1.8 + 2 * ve })
    }
    // ER: wavy lines arcing round the nucleus, studded with ribosomes.
    const n = nucleusPos(P)
    const erE = e('er'), riE = e('ribosomes')
    c.save(); c.strokeStyle = ring('er') ?? 'rgba(127,178,255,0.65)'; c.lineWidth = 2 + erE; if (erE > 0) { c.shadowColor = NL.gold; c.shadowBlur = 14 * erE }
    const erPts: [number, number][] = []
    for (let k = 0; k < 3; k++) {
      const R = 1.0 + k * 0.17
      c.beginPath()
      for (let i = 0; i <= 40; i++) {
        const a = (pl ? -0.9 : 0.6) + i / 40 * 1.9
        const wv = 0.05 * Math.sin(i * 1.3 + k)
        const x = n.x + Math.cos(a) * (n.rx * R + wv) * 1.1, y = n.y + Math.sin(a) * (n.ry * R + wv) * 1.1
        if (i % 5 === 2) erPts.push([x, y])
        if (i) c.lineTo(v.X(x), v.Y(y)); else c.moveTo(v.X(x), v.Y(y))
      }
      c.stroke()
    }
    c.restore()
    for (const [x, y] of erPts) { c.fillStyle = riE > 0.05 ? NL.gold : '#B8C4FF'; c.beginPath(); c.arc(v.X(x), v.Y(y), 2 + riE, 0, Math.PI * 2); c.fill() }
    // Free ribosomes.
    for (let i = 0; i < 14; i++) { const q = ellipsePt(i * 2.4 + 0.5, 0.35 + ((i * 37) % 10) / 22); c.fillStyle = riE > 0.05 ? NL.gold : 'rgba(184,196,255,0.7)'; c.beginPath(); c.arc(v.X(q.x * 0.9 + 0.2), v.Y(q.y * 0.9), 1.6 + riE, 0, Math.PI * 2); c.fill() }
    // Golgi: stacked curved cisternae, vesicles budding towards the membrane.
    const gx = pl ? -0.75 : 1.0, gy = pl ? -1.05 : -1.15, gE = e('golgi')
    if (gE > 0) halo(c, v.X(gx), v.Y(gy), 0.9 * u, NL.goldRgb, gE)
    c.save(); c.lineCap = 'round'
    for (let k = 0; k < 4; k++) {
      c.strokeStyle = ring('golgi') ?? `rgba(255,178,120,${0.85 - k * 0.12})`; c.lineWidth = 4.2 - k * 0.4
      c.beginPath(); c.arc(v.X(gx), v.Y(gy - 0.55 - k * 0.12), (0.62 - k * 0.07) * u, -Math.PI * 0.78, -Math.PI * 0.22); c.stroke()
    }
    c.restore()
    for (const ve of s.ves) {
      const a = -Math.PI / 2 + (ve.k % 3 - 1) * 0.5
      const x = gx + Math.cos(a) * (0.1 + ve.f * 0.75), y = gy - 0.5 + Math.sin(-a) * -(0.1 + ve.f * 0.55) * 0.6
      c.fillStyle = `rgba(255,190,140,${0.9 * (1 - ve.f)})`; c.beginPath(); c.arc(v.X(x), v.Y(y), 3, 0, Math.PI * 2); c.fill()
    }
    // Mitochondria: bean shape with cristae folds; ATP sparks.
    const mE = e('mitochondria')
    for (const m of s.mitos) {
      const X = v.X(m.x), Y = v.Y(m.y), L = m.l * u, W = L * 0.48
      if (mE > 0) halo(c, X, Y, L * 1.4, NL.goldRgb, mE)
      c.save(); c.translate(X, Y); c.rotate(-m.a)
      c.fillStyle = '#C46A3C'; c.strokeStyle = ring('mitochondria') ?? '#F2A46B'; c.lineWidth = 2 + mE
      c.beginPath(); c.ellipse(0, 0, L / 2, W / 2, 0, 0, Math.PI * 2); c.fill(); c.stroke()
      c.strokeStyle = '#FFD2A6'; c.lineWidth = 1.4; c.beginPath()
      for (let i = 0; i <= 10; i++) { const x = -L * 0.38 + L * 0.76 * i / 10; const y = (i % 2 ? 1 : -1) * W * 0.3; if (i) c.lineTo(x, y); else c.moveTo(x, y) }
      c.stroke(); c.restore()
    }
    for (const q of s.sparks) { const a = 1 - q.life / 1.2; c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(${NL.goldRgb},${0.7 * a})`; c.beginPath(); c.arc(v.X(q.x), v.Y(q.y + q.life * 0.25), 2.2, 0, Math.PI * 2); c.fill(); c.restore() }
    // Chloroplasts (plant): green ovals with grana stacks, riding the stream round the edge.
    const chE = e('chloroplasts')
    for (const ch of s.chl) {
      const q = ellipsePt(ch.a, ch.r)
      const X = v.X(q.x), Y = v.Y(q.y), L = 0.52 * u, W = 0.28 * u
      if (chE > 0) halo(c, X, Y, L * 1.3, NL.goldRgb, chE)
      c.save(); c.translate(X, Y); c.rotate(-ch.a + Math.PI / 2)
      const g = c.createLinearGradient(0, -W / 2, 0, W / 2); g.addColorStop(0, '#8DE08F'); g.addColorStop(1, '#2E8B4E')
      c.fillStyle = g; c.strokeStyle = ring('chloroplasts') ?? '#B7F5B4'; c.lineWidth = 1.6 + chE
      c.beginPath(); c.ellipse(0, 0, L / 2, W / 2, 0, 0, Math.PI * 2); c.fill(); c.stroke()
      c.fillStyle = '#1F6B3A'; for (let k = -1; k <= 1; k++) { c.beginPath(); c.roundRect(k * L * 0.25 - 3, -W * 0.22, 6, W * 0.44, 2); c.fill() }
      c.restore()
    }
    // Nucleus: double membrane with pores, chromatin texture, nucleolus.
    const nE = e('nucleus'), noE = e('nucleolus')
    if (nE > 0) halo(c, v.X(n.x), v.Y(n.y), n.rx * u * 2, NL.goldRgb, nE)
    blob(c, v.X(n.x), v.Y(n.y), n.rx * u, n.ry * u, { fill: '#3B3170', stroke: ring('nucleus') ?? '#B9A8FF', wobble: 0.03, seed: 4, w: 2.4 + nE * 2 })
    c.save(); c.strokeStyle = 'rgba(185,168,255,0.4)'; c.lineWidth = 1; c.beginPath(); c.ellipse(v.X(n.x), v.Y(n.y), n.rx * u * 0.9, n.ry * u * 0.9, 0, 0, Math.PI * 2); c.stroke(); c.restore()
    c.fillStyle = 'rgba(190,175,255,0.22)'
    for (let i = 0; i < 18; i++) { const a = i * 2.39, rr = 0.25 + ((i * 53) % 10) / 16; c.beginPath(); c.arc(v.X(n.x + Math.cos(a) * n.rx * rr * 0.8), v.Y(n.y + Math.sin(a) * n.ry * rr * 0.8), 2.2, 0, Math.PI * 2); c.fill() }
    if (noE > 0) halo(c, v.X(n.x + 0.18), v.Y(n.y - 0.08), 0.5 * u, NL.goldRgb, noE)
    c.fillStyle = '#7E6BE0'; c.beginPath(); c.arc(v.X(n.x + 0.18), v.Y(n.y - 0.08), 0.2 * u, 0, Math.PI * 2); c.fill()
    if (noE > 0.05) { c.strokeStyle = NL.gold; c.lineWidth = 2; c.stroke() }
  },
  anchors: (s, P, v) => {
    const n = nucleusPos(P), pl = plant(P)
    const m = s.mitos[0], ch = s.chl[0] ? ellipsePt(s.chl[0].a, s.chl[0].r) : { x: 0, y: 0 }
    const gx = pl ? -0.75 : 1.0, gy = pl ? -1.05 : -1.15
    const er = { x: n.x + Math.cos(pl ? 0 : 1.5) * n.rx * 1.25, y: n.y + Math.sin(pl ? 0 : 1.5) * n.ry * 1.25 }
    return {
      nucleus: { x: v.X(n.x), y: v.Y(n.y + n.ry * 0.7), r: 6 },
      nucleolus: { x: v.X(n.x + 0.18), y: v.Y(n.y - 0.08), r: 0.2 * v.u },
      mitochondria: { x: v.X(m.x), y: v.Y(m.y), r: m.l * v.u * 0.5 },
      chloroplasts: { x: v.X(ch.x), y: v.Y(ch.y), r: 0.26 * v.u },
      vacuole: { x: v.X(0.75), y: v.Y(0.18 + 0.6), r: 6 },
      er: { x: v.X(er.x), y: v.Y(er.y), r: 4 },
      ribosomes: { x: v.X(er.x), y: v.Y(er.y), r: 4 },
      golgi: { x: v.X(gx), y: v.Y(gy - 0.55), r: 0.5 * v.u },
      membrane: { x: v.X(RX * 0.98), y: v.Y(RY * 0.55), r: 4 },
      cell_wall: { x: v.X(RX + 0.12), y: v.Y(-RY * 0.6), r: 4 },
      cytoplasm: { x: v.X(1.6), y: v.Y(-1.2), r: 4 },
    }
  },
  keepouts: (s, P, v: View) => {
    const n = nucleusPos(P)
    const box = (x: number, y: number, r: number) => ({ x: v.X(x) - r * v.u, y: v.Y(y) - r * v.u, w: 2 * r * v.u, h: 2 * r * v.u })
    return [
      { x: v.X(n.x - n.rx), y: v.Y(n.y + n.ry), w: 2 * n.rx * v.u, h: 2 * n.ry * v.u },
      ...s.mitos.map(m => box(m.x, m.y, m.l * 0.45)),
    ]
  },
}

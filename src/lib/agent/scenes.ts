/**
 * Hand-built animated scenes for ideas a plotted figure cannot show well: a bar magnet's field and induction in a coil,
 * the field round a current-carrying wire, charges drifting along a wire. Each scene is a pure function of its slider
 * values plus a little live state (time, the magnet's speed), returning an SVG string; the client re-draws it every
 * animation frame (components/agent/scene-view.tsx). Everything here is fixed geometry and numbers: nothing from a
 * model is ever placed in the markup. Sized for a phone (drawn 400 wide, shown ~330 px): strokes ≥ 1.6 px, arrowheads
 * ≥ 9 px, labels ≥ 13 px after scaling.
 */

export type SceneKind = 'magnet_coil' | 'bar_magnet' | 'wire_field' | 'charge_drift'
export const SCENE_KINDS: SceneKind[] = ['magnet_coil', 'bar_magnet', 'wire_field', 'charge_drift']

/** Live state the client keeps between frames. */
export interface SceneLive {
  /** Seconds since the scene opened. */
  t: number
  /** magnet_coil: induced current (signed, about −1..1), smoothed. */
  emf?: number
  /** magnet_coil: galvanometer needle angle (degrees, signed), springy. */
  needle?: number
  /** magnet_coil / wire_field: phase for the current dots and field-arrow flow. */
  phase?: number
  /** wire_field: compass needle angles (radians), springy. */
  compass?: number[]
  /** charge_drift: how far the charges have drifted (world units), and how many passed the gate. */
  drift?: number
  passed?: number
}

const f1 = (v: number) => (Math.round(v * 10) / 10).toString()
const INK = '#14141A', MUTED = '#66666F', FIELD = '#3E6A8A', COPPER = '#B4652F', COPPER_D = '#7A3F18', N_RED = '#C0392B', S_BLUE = '#2D5BA8', BG = '#FBFAF7'
const FONT = 'font-family="Inter, DejaVu Sans, sans-serif"'

/* ───────────── Magnet and coil ───────────── */

/** World geometry (x: −5..5, y: −3.2..3.2), 40 px per unit. */
const MC = { W: 400, H: 256, U: 40, X0: -5, Y1: 3.2, half: 0.9, thick: 0.5, coilX0: 1.9, coilX1: 4.5, coilR: 0.95, turns: 8, coilC: 3.2 }
const mx = (x: number) => (x - MC.X0) * MC.U
const my = (y: number) => (MC.Y1 - y) * MC.U

/** Field through the coil for a magnet centred at m (relative units, peaks with the magnet inside the coil). */
export const coilFlux = (m: number) => 10 / (1 + (MC.coilC - m) ** 2 * 0.9)
export const coilFluxSlope = (m: number) => { const d = MC.coilC - m; return 10 * 1.8 * d / (1 + d * d * 0.9) ** 2 }

/** Bar-magnet field lines as world polylines from the N face round to the S face, magnet centred at the origin
 * pointing +x. Two-pole model (a source at the N end, a sink at the S end), traced numerically once: lines leave the
 * N end, curve round and enter the S end, as in a textbook picture. */
function dipoleLines(): [number, number][][] {
  const d = MC.half - 0.12
  const B = (x: number, y: number): [number, number] => {
    const ax = x - d, bx = x + d, ra = (ax * ax + y * y) ** 1.5 + 1e-6, rb = (bx * bx + y * y) ** 1.5 + 1e-6
    return [ax / ra - bx / rb, y / ra - y / rb]
  }
  const out: [number, number][][] = []
  for (const deg of [22, 42, 62, 84, 108]) {
    for (const sgn of [1, -1]) {
      const a = sgn * deg * Math.PI / 180
      let x = d + 0.2 * Math.cos(a), y = 0.2 * Math.sin(a)
      const pts: [number, number][] = []
      for (let i = 0; i < 1400; i++) {
        if (!(Math.abs(x) < MC.half + 0.03 && Math.abs(y) < MC.thick / 2 + 0.03)) pts.push([x, y])
        const [u, v] = B(x, y), n = Math.hypot(u, v) || 1
        const h = 0.035 + 0.02 * Math.hypot(x, y)
        x += h * u / n; y += h * v / n
        if (Math.hypot(x + d, y) < 0.22 || Math.abs(x) > 14 || Math.abs(y) > 9) break
      }
      out.push(pts)
    }
  }
  return out
}
const DIPOLE = dipoleLines()

/** A filled arrowhead at (x, y) pointing along angle a (screen radians). */
const head = (x: number, y: number, a: number, s: number, fill: string, op = 1) =>
  `<path d="M${f1(x + s * Math.cos(a))},${f1(y + s * Math.sin(a))}L${f1(x + s * 0.75 * Math.cos(a + 2.5))},${f1(y + s * 0.75 * Math.sin(a + 2.5))}L${f1(x + s * 0.75 * Math.cos(a - 2.5))},${f1(y + s * 0.75 * Math.sin(a - 2.5))}Z" fill="${fill}" opacity="${op}"/>`

function polyPath(pts: [number, number][], ox: number) {
  let d = ''
  pts.forEach(([x, y], i) => { d += `${i ? 'L' : 'M'}${f1(mx(x + ox))},${f1(my(y))}` })
  return d
}
const pathLen = (pts: [number, number][]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0) * MC.U

export function magnetCoilSvg(m: number, live: SceneLive, slider: { min: number; max: number }, coil = true): string {
  const W = MC.W, H = MC.H
  const p: string[] = []
  const emf = live.emf ?? 0, needle = live.needle ?? 0, phase = live.phase ?? 0, t = live.t
  const glow = Math.min(1, Math.abs(emf))
  p.push(`<defs><clipPath id="mcclip"><rect x="0" y="0" width="${W}" height="${H}" rx="10"/></clipPath>
<linearGradient id="mcN" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E25B4B"/><stop offset="1" stop-color="${N_RED}"/></linearGradient>
<linearGradient id="mcS" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4E7BC6"/><stop offset="1" stop-color="${S_BLUE}"/></linearGradient></defs>`)
  p.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`)
  p.push('<g clip-path="url(#mcclip)">')
  // Coil back halves (behind the magnet): the far side of each turn, lighter.
  const turnX = (i: number) => MC.coilX0 + (MC.coilX1 - MC.coilX0) * (i + 0.5) / MC.turns
  const rx = 0.2 * MC.U, ry = MC.coilR * MC.U
  for (let i = 0; i < (coil ? MC.turns : 0); i++) {
    const cx = mx(turnX(i)), top = my(MC.coilR), bot = my(-MC.coilR)
    p.push(`<path d="M${f1(cx)},${f1(top)}A${f1(rx)},${f1(ry)} 0 0 1 ${f1(cx)},${f1(bot)}" fill="none" stroke="${COPPER}" stroke-opacity="0.38" stroke-width="3.2" stroke-linecap="round"/>`)
  }
  // Field lines, flowing N → S outside the magnet (moving dashes show direction), with one arrowhead each.
  for (const line of DIPOLE) {
    const d = polyPath(line, m)
    const len = pathLen(line)
    p.push(`<path d="${d}" fill="none" stroke="${FIELD}" stroke-opacity="0.55" stroke-width="1.7"/>`)
    p.push(`<path d="${d}" fill="none" stroke="${FIELD}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="1.5 22" stroke-dashoffset="${f1(-((t * 26) % 23.5))}" opacity="0.9"/>`)
    // Arrowhead at the top of the loop (θ ≈ 90°), pointing along the line.
    let k = 0
    line.forEach((q, i) => { if (Math.abs(q[1]) > Math.abs(line[k][1])) k = i })
    const a = line[Math.max(0, k - 1)], b = line[Math.min(line.length - 1, k + 1)]
    if (len > 40) p.push(head(mx(a[0] + m), my(a[1]), Math.atan2(my(b[1]) - my(a[1]), mx(b[0]) - mx(a[0])), 8, FIELD))
  }
  // The axis line through the magnet into the coil.
  const ax0 = mx(m + MC.half), ax1 = W
  p.push(`<line x1="${f1(ax0)}" y1="${f1(my(0))}" x2="${f1(ax1)}" y2="${f1(my(0))}" stroke="${FIELD}" stroke-opacity="0.55" stroke-width="1.7"/>`)
  p.push(`<line x1="0" y1="${f1(my(0))}" x2="${f1(mx(m - MC.half))}" y2="${f1(my(0))}" stroke="${FIELD}" stroke-opacity="0.55" stroke-width="1.7"/>`)
  p.push(head(Math.min(W - 14, mx(m + MC.half) + 26), my(0), 0, 6.5, FIELD))
  // The magnet: S (blue) half on the left, N (red) half on the right, letters inside.
  const bx = mx(m - MC.half), bw = 2 * MC.half * MC.U, by = my(MC.thick / 2), bh = MC.thick * MC.U
  p.push(`<rect x="${f1(bx + 2)}" y="${f1(by + 4)}" width="${f1(bw)}" height="${f1(bh)}" rx="4" fill="#000" opacity="0.08"/>`)
  p.push(`<rect x="${f1(bx)}" y="${f1(by)}" width="${f1(bw / 2)}" height="${f1(bh)}" rx="3" fill="url(#mcS)"/><rect x="${f1(bx + bw / 2)}" y="${f1(by)}" width="${f1(bw / 2)}" height="${f1(bh)}" rx="3" fill="url(#mcN)"/>`)
  p.push(`<rect x="${f1(bx + bw / 2 - 3)}" y="${f1(by)}" width="6" height="${f1(bh)}" fill="url(#mcN)"/><rect x="${f1(bx + bw / 2 - 3)}" y="${f1(by)}" width="3" height="${f1(bh)}" fill="url(#mcS)"/>`)
  p.push(`<text x="${f1(bx + bw / 4)}" y="${f1(by + bh / 2 + 5)}" ${FONT} font-size="16" font-weight="700" fill="#fff" text-anchor="middle">S</text><text x="${f1(bx + bw * 3 / 4)}" y="${f1(by + bh / 2 + 5)}" ${FONT} font-size="16" font-weight="700" fill="#fff" text-anchor="middle">N</text>`)
  // Motion cue: a speed arrow above the magnet while it moves.
  const v = live.emf !== undefined ? Math.sign(emf) : 0
  if (Math.abs(emf) > 0.08) {
    const y = by - 12, c = bx + bw / 2, L = 14 + 18 * glow
    p.push(`<line x1="${f1(c - v * L / 2)}" y1="${f1(y)}" x2="${f1(c + v * L / 2)}" y2="${f1(y)}" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>${head(c + v * L / 2, y, v > 0 ? 0 : Math.PI, 6, INK)}`)
  }
  if (coil) {
  // Coil front halves (in front of the magnet), glowing while a current flows; current dots run round the wire.
  const hot = `rgb(${Math.round(180 + 60 * glow)},${Math.round(101 + 40 * glow)},${Math.round(47 - 20 * glow)})`
  for (let i = 0; i < MC.turns; i++) {
    const cx = mx(turnX(i)), top = my(MC.coilR), bot = my(-MC.coilR)
    // The front stroke leans to the next turn (a helix), so the winding reads as one wire.
    const nx = i < MC.turns - 1 ? mx(turnX(i + 1)) : cx
    const d = `M${f1(cx)},${f1(top)}C${f1(cx - rx * 1.25)},${f1(top + ry * 0.4)} ${f1((cx + nx) / 2 - rx * 1.25)},${f1(bot - ry * 0.4)} ${f1((cx + nx) / 2)},${f1(bot)}`
    p.push(`<path d="${d}" fill="none" stroke="${COPPER_D}" stroke-width="5" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${hot}" stroke-width="3.2" stroke-linecap="round"/>`)
    if (glow > 0.06) p.push(`<path d="${d}" fill="none" stroke="#FFE7A8" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="2 9" stroke-dashoffset="${f1(-phase * 11)}" opacity="${f1(Math.min(1, glow * 1.6))}"/>`)
  }
  // Leads to the galvanometer.
  const gx = mx(MC.coilC), gy = H - 30, gr = 25
  const l0 = mx(turnX(0)), l1 = mx(turnX(MC.turns - 1))
  const lead = `M${f1(l0)},${f1(my(-MC.coilR))}L${f1(l0)},${f1(gy)}L${f1(gx - gr)},${f1(gy)}M${f1(gx + gr)},${f1(gy)}L${f1(l1 + 6)},${f1(gy)}L${f1(l1 + 6)},${f1(my(-MC.coilR) - 2)}`
  p.push(`<path d="${lead}" fill="none" stroke="${COPPER_D}" stroke-width="2.4" stroke-linejoin="round"/>`)
  if (glow > 0.06) p.push(`<path d="${lead}" fill="none" stroke="#F2B544" stroke-width="2.4" stroke-dasharray="3 9" stroke-dashoffset="${f1(-phase * 11)}" opacity="${f1(Math.min(1, glow * 1.6))}"/>`)
  // Galvanometer: dial, scale, zero mark, needle.
  p.push(`<circle cx="${f1(gx)}" cy="${f1(gy)}" r="${gr}" fill="#fff" stroke="${INK}" stroke-width="2"/>`)
  for (let k = -4; k <= 4; k++) { const a = (-90 + k * 14) * Math.PI / 180, r1 = gr - 4, r2 = gr - (k === 0 ? 11 : 8); p.push(`<line x1="${f1(gx + r1 * Math.cos(a))}" y1="${f1(gy + 4 + r1 * Math.sin(a))}" x2="${f1(gx + r2 * Math.cos(a))}" y2="${f1(gy + 4 + r2 * Math.sin(a))}" stroke="${MUTED}" stroke-width="${k === 0 ? 1.8 : 1.2}"/>`) }
  const na = (-90 + needle) * Math.PI / 180
  p.push(`<line x1="${f1(gx)}" y1="${f1(gy + 6)}" x2="${f1(gx + (gr - 6) * Math.cos(na))}" y2="${f1(gy + 6 + (gr - 6) * Math.sin(na))}" stroke="${N_RED}" stroke-width="2.4" stroke-linecap="round"/><circle cx="${f1(gx)}" cy="${f1(gy + 6)}" r="3" fill="${INK}"/>`)
  p.push(`<text x="${f1(l0 - 8)}" y="${f1(gy + 5)}" ${FONT} font-size="13" fill="${MUTED}" text-anchor="end" stroke="${BG}" stroke-width="4" paint-order="stroke">current meter</text>`)
  }
  // Status line (top left): what is happening right now.
  const moving = Math.abs(emf) > 0.08
  const msg = !coil ? 'Field lines leave N, curve round and enter S' : moving ? (emf > 0 ? 'Magnet moving in: current flows' : 'Magnet moving out: current flows the other way') : 'Magnet still: field not changing, no current'
  const col = coil && moving ? '#8A5A00' : MUTED
  p.push(`<rect x="8" y="8" width="${f1(Math.min(W - 16, 16 + msg.length * 7.6))}" height="24" rx="12" fill="#fff" stroke="#E5E1D8"/><text x="18" y="25" ${FONT} font-size="13" font-weight="600" fill="${col}">${msg}</text>`)
  if (coil) p.push(`<text x="${f1(mx(MC.coilC))}" y="${f1(my(MC.coilR) - 10)}" ${FONT} font-size="13" fill="${COPPER_D}" text-anchor="middle" font-weight="600" stroke="${BG}" stroke-width="4" paint-order="stroke">coil</text>`)
  p.push('</g>')
  void slider
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${p.join('')}</svg>`
}

/** One frame of magnet_coil physics: smoothed magnet speed → induced current → springy needle. */
export function stepMagnetCoil(live: SceneLive, m: number, mPrev: number, dt: number): SceneLive {
  const v = dt > 0 ? (m - mPrev) / dt : 0
  const target = Math.tanh(coilFluxSlope(m) * v * 0.55)
  const emf = (live.emf ?? 0) + (target - (live.emf ?? 0)) * Math.min(1, dt * 10)
  const needle0 = live.needle ?? 0
  // A damped spring towards 52° × current (overshoots a little, like a real meter).
  const goal = 52 * emf
  const nv = ((live as { nv?: number }).nv ?? 0) + ((goal - needle0) * 60 - ((live as { nv?: number }).nv ?? 0) * 9) * dt
  const needle = Math.max(-60, Math.min(60, needle0 + nv * dt))
  return { ...live, t: live.t + dt, emf, needle, phase: (live.phase ?? 0) + emf * dt * 6, ...({ nv } as object) }
}

/* ───────────── Field round a wire ───────────── */

export function wireFieldSvg(I: number, live: SceneLive, slider: { min: number; max: number }): string {
  const W = 400, H = 280, cx = 200, cy = 140
  const p: string[] = []
  const mag = Math.min(1, Math.abs(I) / Math.max(1e-6, Math.max(Math.abs(slider.min), Math.abs(slider.max))))
  const dir = I >= 0 ? 1 : -1 // + : current out of the page → field anticlockwise
  const phase = live.phase ?? 0
  p.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`)
  // Field circles with arrowheads travelling round them (speed ∝ current), fading with distance.
  const radii = [44, 78, 112]
  radii.forEach((r, i) => {
    const op = (0.2 + 0.8 * mag) * (1 - i * 0.2)
    p.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${FIELD}" stroke-width="1.8" stroke-opacity="${f1(op * 0.7)}"/>`)
    if (mag > 0.04) for (let k = 0; k < 4; k++) {
      // Screen y points down: anticlockwise on screen is decreasing screen angle.
      const a = -dir * (phase / (1 + i * 0.6)) + k * Math.PI / 2 + i * 0.4
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a)
      p.push(head(x, y, a - dir * Math.PI / 2, 7.5, FIELD, op))
    }
  })
  // Compasses round the wire: each needle (red = north end) points along the field, or north when the current is off.
  const comp = live.compass ?? []
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4 + Math.PI / 8, r = 150
    const x = cx + r * Math.cos(a) * 1.05, y = cy + r * Math.sin(a) * 0.72
    if (x < 18 || x > W - 18 || y < 18 || y > H - 18) continue
    const na = comp[k] ?? -Math.PI / 2
    p.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="15" fill="#fff" stroke="#CFC9BC" stroke-width="1.4"/>`)
    p.push(`<path d="M${f1(x + 11 * Math.cos(na))},${f1(y + 11 * Math.sin(na))}L${f1(x + 3.2 * Math.cos(na + Math.PI / 2))},${f1(y + 3.2 * Math.sin(na + Math.PI / 2))}L${f1(x + 3.2 * Math.cos(na - Math.PI / 2))},${f1(y + 3.2 * Math.sin(na - Math.PI / 2))}Z" fill="${N_RED}"/>`)
    p.push(`<path d="M${f1(x - 11 * Math.cos(na))},${f1(y - 11 * Math.sin(na))}L${f1(x + 3.2 * Math.cos(na + Math.PI / 2))},${f1(y + 3.2 * Math.sin(na + Math.PI / 2))}L${f1(x + 3.2 * Math.cos(na - Math.PI / 2))},${f1(y + 3.2 * Math.sin(na - Math.PI / 2))}Z" fill="#9AA0AA"/><circle cx="${f1(x)}" cy="${f1(y)}" r="1.8" fill="${INK}"/>`)
  }
  // The wire, end on: copper disc with a dot (current towards you) or a cross (away from you).
  p.push(`<circle cx="${cx}" cy="${cy}" r="17" fill="${COPPER}" stroke="${COPPER_D}" stroke-width="2.5"/>`)
  if (mag > 0.04) {
    if (dir > 0) p.push(`<circle cx="${cx}" cy="${cy}" r="5" fill="#fff"/>`)
    else p.push(`<path d="M${cx - 7},${cy - 7}L${cx + 7},${cy + 7}M${cx + 7},${cy - 7}L${cx - 7},${cy + 7}" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>`)
  }
  const msg = mag <= 0.04 ? 'No current: no field, compasses point north' : dir > 0 ? 'Current towards you: field turns anticlockwise' : 'Current away from you: field turns clockwise'
  p.push(`<rect x="8" y="8" width="${f1(Math.min(W - 16, 16 + msg.length * 7.6))}" height="24" rx="12" fill="#fff" stroke="#E5E1D8"/><text x="18" y="25" ${FONT} font-size="13" font-weight="600" fill="${mag <= 0.04 ? MUTED : '#8A5A00'}">${msg}</text>`)
  p.push(`<text x="${cx}" y="${cy + 36}" ${FONT} font-size="13" font-weight="600" fill="${COPPER_D}" text-anchor="middle">wire</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${p.join('')}</svg>`
}

export function stepWireField(live: SceneLive, I: number, maxI: number, dt: number): SceneLive {
  const mag = Math.min(1, Math.abs(I) / Math.max(1e-6, maxI))
  const dir = I >= 0 ? 1 : -1
  const comp = live.compass ? [...live.compass] : Array.from({ length: 8 }, () => -Math.PI / 2)
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4 + Math.PI / 8
    // Field direction on screen (tangent, anticlockwise for dir > 0) blended with Earth's field (north = up).
    const fx = dir * Math.sin(a) * mag * 3, fy = -dir * Math.cos(a) * mag * 3 - 0.35
    const goal = Math.atan2(fy, fx)
    let d = goal - comp[k]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI
    comp[k] += d * Math.min(1, dt * 6)
  }
  return { ...live, t: live.t + dt, compass: comp, phase: (live.phase ?? 0) + dt * (0.6 + 2.2 * mag) }
}

/* ───────────── Charges drifting along a wire ───────────── */

const CHARGES = Array.from({ length: 26 }, (_, i) => ({ x: ((i * 37) % 26) / 26, y: 0.18 + 0.64 * (((i * 53) % 17) / 16) }))

export function chargeDriftSvg(V: number, live: SceneLive, slider: { min: number; max: number }): string {
  const W = 400, H = 220, x0 = 46, x1 = 384, y0 = 70, y1 = 150, gate = 250
  const p: string[] = []
  const drift = live.drift ?? 0, rel = Math.min(1, V / Math.max(1e-6, slider.max))
  p.push(`<defs><linearGradient id="cdw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3D6BE"/><stop offset="0.5" stop-color="#E8BC97"/><stop offset="1" stop-color="#D9A57C"/></linearGradient></defs>`)
  p.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`)
  // The cell (battery) on the left: long plate +, short plate −.
  p.push(`<line x1="20" y1="${y0 + 8}" x2="20" y2="${y1 - 8}" stroke="${INK}" stroke-width="3"/><line x1="32" y1="${y0 + 22}" x2="32" y2="${y1 - 22}" stroke="${INK}" stroke-width="5"/>`)
  p.push(`<text x="20" y="${y0 - 2}" ${FONT} font-size="13" fill="${MUTED}" text-anchor="middle">cell</text>`)
  // The wire, cut open: a copper tube with fixed ions in a lattice.
  p.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="16" fill="url(#cdw)" stroke="${COPPER_D}" stroke-width="2"/>`)
  for (let i = 0; i < 10; i++) for (let j = 0; j < 3; j++) { const x = x0 + 22 + i * 33 + (j % 2) * 16, y = y0 + 18 + j * 22; if (x < x1 - 10) p.push(`<text x="${x}" y="${y + 4}" ${FONT} font-size="12" fill="${COPPER_D}" fill-opacity="0.45" text-anchor="middle">+</text>`) }
  // The counting gate.
  p.push(`<line x1="${gate}" y1="${y0 - 10}" x2="${gate}" y2="${y1 + 10}" stroke="${INK}" stroke-width="1.6" stroke-dasharray="4 4"/>`)
  p.push(`<text x="${gate}" y="${y1 + 26}" ${FONT} font-size="13" fill="${INK}" text-anchor="middle">charges past here: <tspan font-weight="700">${Math.floor(live.passed ?? 0)}</tspan></text>`)
  // Free charges drifting right (each also jiggles: thermal motion), wrapping round.
  const L = x1 - x0 - 24
  for (const [i, c] of CHARGES.entries()) {
    const jx = Math.sin(live.t * 7 + i * 1.7) * 2.2, jy = Math.cos(live.t * 6 + i * 2.3) * 2.2
    const x = x0 + 12 + ((c.x * L + drift * 40) % L + L) % L + jx, y = y0 + 6 + c.y * (y1 - y0 - 12) + jy
    p.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="5.5" fill="${S_BLUE}"/><path d="M${f1(x - 2.6)},${f1(y)}L${f1(x + 2.6)},${f1(y)}" stroke="#fff" stroke-width="1.6"/>`)
  }
  // The flow arrow: thicker for a bigger current.
  if (rel > 0.03) {
    const w = 2 + 5 * rel
    p.push(`<line x1="120" y1="${y0 - 22}" x2="${f1(300)}" y2="${y0 - 22}" stroke="#8A5A00" stroke-width="${f1(w)}" stroke-linecap="round"/>${head(306, y0 - 22, 0, 8 + w, '#8A5A00')}`)
    p.push(`<text x="120" y="${y0 - 34}" ${FONT} font-size="13" font-weight="600" fill="#8A5A00">flow of charge</text>`)
  } else p.push(`<text x="120" y="${y0 - 22}" ${FONT} font-size="13" font-weight="600" fill="${MUTED}">no push: charges only jiggle</text>`)
  void slider
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${p.join('')}</svg>`
}

export function stepChargeDrift(live: SceneLive, V: number, dt: number): SceneLive {
  const d = (live.drift ?? 0) + V * dt * 0.9
  // About one charge per (1 / (V × 1.1)) s passes the gate.
  return { ...live, t: live.t + dt, drift: d, passed: (live.passed ?? 0) + V * dt * 1.1 }
}

/** Which scene a spec title names (older saved lessons carry the template without a scene key). */
export function sceneForTitle(title: string): SceneKind | null {
  if (title === 'A moving magnet and a coil') return 'magnet_coil'
  if (title === 'The field around a bar magnet') return 'bar_magnet'
  if (title === 'Magnetic field around a wire') return 'wire_field'
  if (title === 'Charges drifting along a wire') return 'charge_drift'
  return null
}

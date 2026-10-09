/**
 * Interactive maths figures (rendered with JSXGraph in the chat). The model never writes code: it emits a JSON spec
 * that is validated here (names, ranges, caps, every expression compiled by the app's own safe expression parser).
 * Expressions may use x (and y in fields, ODEs and surfaces), slider names, and each point's coordinates as
 * <name>x / <name>y (point A gives ax, ay). Shared by the server (validation, static SVG fallback) and the client.
 */
import { compileExpr } from '../lesson-schema'
import { SCENE_KINDS, chargeDriftSvg, magnetCoilSvg, sceneForTitle, stepWireField, wireFieldSvg, type SceneKind } from './scenes'

export type IxColor = 'ink' | 'accent' | 'clay' | 'navy' | 'amber'
export const IX_HEX: Record<IxColor, string> = { ink: '#14141A', accent: '#1F4D3A', clay: '#A4502A', navy: '#23406A', amber: '#8A5A00' }

export interface IxSlider { name: string; label: string; min: number; max: number; step: number; value: number }
export interface IxPoint { name: string; x: number; y: number; xExpr?: string; yExpr?: string; drag: boolean; label: string; color: IxColor; hidden?: boolean }
/** A point that slides along a function graph (on = function name, starts at x) or around a circle (circle = index into circles, starts at angle). */
export interface IxGlider { name: string; on: string; x: number; label: string; color: IxColor; circle?: number; angle?: number }
export interface IxFunction { name: string; expr: string; label: string; color: IxColor; dashed: boolean }
export interface IxSegment { from: string; to: string; color: IxColor; arrow: boolean; dashed: boolean; line: boolean }
export interface IxPolygon { points: string[]; color: IxColor }
export interface IxCircle { name?: string; center: string; through?: string; radius?: string; color: IxColor }
export interface IxReadout { label: string; expr: string; unit?: string }
export interface IxSpec {
  title: string
  explain?: string
  x: [number, number]
  y: [number, number]
  sliders: IxSlider[]
  points: IxPoint[]
  gliders: IxGlider[]
  functions: IxFunction[]
  segments: IxSegment[]
  polygons: IxPolygon[]
  circles: IxCircle[]
  field?: { dx: string; dy: string; kind: 'vector' | 'slope' }
  ode?: { expr: string; from: string; color: IxColor }
  surface?: { expr: string; z?: [number, number]; label?: string }
  readouts: IxReadout[]
  /** A hand-built animated scene drawn instead of the plotted figure (fixed templates only; sliders still drive it). */
  scene?: SceneKind
}

const RESERVED = new Set(['x', 'y', 'e', 'pi', 't', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'ln', 'log', 'sqrt', 'abs', 'sinh', 'cosh', 'tanh', 'floor', 'ceil'])
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const str = (v: unknown, n = 80) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
/** Common slips from code-minded models: Math.sin → sin, ** → ^, Math.PI → pi. Anything else must parse as is. */
const normExpr = (e: string) => e.replace(/\b(?:Math|math|np|numpy)\./g, '').replace(/\*\*/g, '^').replace(/\bPI\b/g, 'pi').replace(/\bE\b/g, 'e')
const ex = (v: unknown, n: number) => normExpr(str(v, n))
const color = (v: unknown, d: IxColor): IxColor => (typeof v === 'string' && v in IX_HEX ? (v as IxColor) : d)
const arr = (v: unknown, n: number): Record<string, unknown>[] => (Array.isArray(v) ? v.slice(0, n).map(x => (x && typeof x === 'object' ? x : {}) as Record<string, unknown>) : [])
const range = (v: unknown): [number, number] | null => (Array.isArray(v) && v.length === 2 && num(v[0]) !== null && num(v[1]) !== null && num(v[0])! < num(v[1])! && num(v[1])! - num(v[0])! <= 1e6 ? [num(v[0])!, num(v[1])!] : null)
const coordVars = (name: string) => [`${name.toLowerCase()}x`, `${name.toLowerCase()}y`]

/** Validate a raw spec from the model. Returns the normalised spec, or null with the reasons. */
export function validateInteractive(input: unknown): { spec: IxSpec | null; errors: string[] } {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const errors: string[] = []
  const title = str(o.title, 80) || 'Explore'
  const x = range(o.x_range ?? o.x) ?? [-5, 5]
  const y = range(o.y_range ?? o.y) ?? [-5, 5]
  const names = new Set<string>()
  const vars: string[] = []
  const claim = (name: string, at: string, kind: 'slider' | 'point') => {
    const ok = kind === 'slider' ? /^[a-zA-Z]{1,8}$/.test(name) : /^[A-Za-z]{1,3}$/.test(name)
    if (!ok || RESERVED.has(name.toLowerCase())) { errors.push(`${at}: name "${name}" must be ${kind === 'slider' ? '1-8 letters' : '1-3 letters'}, not x, y, e, pi, t or a function name`); return false }
    const extra = kind === 'point' ? coordVars(name) : [name.toLowerCase()]
    const key = `${kind}:${name.toLowerCase()}`
    if (names.has(key) || extra.some(v => vars.includes(v))) { errors.push(`${at}: name "${name}" is used twice`); return false }
    names.add(key)
    vars.push(...extra)
    return true
  }
  const check = (expr: string, at: string, extra: string[] = [], allowX = true) => {
    if (!expr) { errors.push(`${at}: expression is required`); return false }
    const c = compileExpr(expr, [...vars, ...extra], allowX)
    if (!c.ok) { errors.push(`${at} "${expr.slice(0, 40)}": ${c.error}`); return false }
    return true
  }

  const sliders: IxSlider[] = []
  arr(o.sliders, 5).forEach((q, i) => {
    const name = str(q.name, 12)
    const min = num(q.min), max = num(q.max)
    if (min === null || max === null || min >= max) { errors.push(`sliders[${i}] needs min < max`); return }
    if (!claim(name, `sliders[${i}]`, 'slider')) return
    const value = Math.min(max, Math.max(min, num(q.value) ?? (min + max) / 2))
    const step = num(q.step) && num(q.step)! > 0 ? Math.min(num(q.step)!, max - min) : (max - min) / 100
    sliders.push({ name, label: str(q.label, 40) || name, min, max, step, value })
  })

  const points: IxPoint[] = []
  arr(o.points, 10).forEach((q, i) => {
    const name = str(q.name, 3)
    const xe = typeof q.x === 'string' && num(q.x) === null ? normExpr(q.x.trim().slice(0, 120)) : ''
    const ye = typeof q.y === 'string' && num(q.y) === null ? normExpr(q.y.trim().slice(0, 120)) : ''
    // Dependent coordinates may use sliders and earlier points (checked before this point's own name is claimed).
    if (xe && !check(xe, `points[${i}].x`, [], false)) return
    if (ye && !check(ye, `points[${i}].y`, [], false)) return
    if (!claim(name, `points[${i}]`, 'point')) return
    const px = xe ? 0 : num(q.x), py = ye ? 0 : num(q.y)
    if (px === null || py === null) { errors.push(`points[${i}] needs numeric x and y (or expressions)`); return }
    points.push({ name, x: px, y: py, xExpr: xe || undefined, yExpr: ye || undefined, drag: !xe && !ye && q.draggable !== false, label: str(q.label, 24) || name, color: color(q.color, q.draggable === false ? 'ink' : 'clay') })
  })

  // Glider names are claimed before functions so a function can follow a glider (a tangent at P uses px, py).
  const gliderRaw = arr(o.gliders, 3).map((q, i) => ({ q, i, ok: claim(str(q.name, 3), `gliders[${i}]`, 'point') }))

  const functions: IxFunction[] = []
  arr(o.functions, 4).forEach((q, i) => {
    const expr = ex(q.expr, 200).replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=\s*/i, '')
    if (!check(expr, `functions[${i}].expr`)) return
    const name = str(q.name, 8) || `f${i + 1}`
    functions.push({ name, expr, label: str(q.label, 30), color: color(q.color, (['accent', 'navy', 'clay', 'amber'] as IxColor[])[i % 4]), dashed: q.dashed === true })
  })

  const gliders: IxGlider[] = []
  const circleGliders: { q: Record<string, unknown>; i: number; name: string; on: string }[] = []
  for (const { q, i, ok } of gliderRaw) {
    if (!ok) continue
    const name = str(q.name, 3)
    const on = str(q.on, 8)
    const f = functions.find(fn => fn.name === on)
    // Not a function: maybe a circle (by name, or "circle" when there is exactly one). Resolved once circles are read.
    const rawCircles = arr(o.circles, 3)
    if (!f && (rawCircles.some(c => str(c.name, 8) === on) || (/circle/i.test(on) && rawCircles.length === 1))) { circleGliders.push({ q, i, name, on }); continue }
    if (!f) { errors.push(`gliders[${i}].on must name one of the functions (${functions.map(fn => fn.name).join(', ') || 'none given'})`); continue }
    if (new RegExp(`\\b${name.toLowerCase()}[xy]\\b`, 'i').test(f.expr)) { errors.push(`gliders[${i}] cannot ride on ${on}, which depends on ${name} itself`); continue }
    gliders.push({ name, on, x: num(q.x) ?? (x[0] + x[1]) / 2, label: str(q.label, 24) || name, color: color(q.color, 'clay') })
  }

  const pointNames = new Set([...points.map(p => p.name), ...gliders.map(g => g.name), ...circleGliders.map(g => g.name)])
  // An end given as [x, y] (numbers or expressions, e.g. ["px", 0] for the foot below P) becomes a hidden helper point.
  let aux = 0
  const known = (n: unknown, at: string): boolean => {
    // Models sometimes send the [x, y] end as a string ("[-2, 4]" or "(px, 0)").
    if (typeof n === 'string' && !pointNames.has(n)) { const m = n.trim().match(/^[[(]?\s*([^,[\]()]+?)\s*,\s*([^,[\]()]+?)\s*[\])]?$/); if (m) n = [m[1], m[2]] }
    // ...or as an object {x, y}.
    if (n && typeof n === 'object' && !Array.isArray(n) && 'x' in n && 'y' in n) n = [(n as Record<string, unknown>).x, (n as Record<string, unknown>).y]
    if (Array.isArray(n) && n.length === 2) {
      const [ax, ay] = n.map(v => (typeof v === 'number' ? String(v) : ex(v, 120)))
      if (!check(ax, `${at}[0]`, [], false) || !check(ay, `${at}[1]`, [], false)) return false
      const name = `Z${'ABCDEFGHIJKLMNOPQRSTUVWXY'[aux++ % 25]}`
      if (!claim(name, at, 'point')) return false
      points.push({ name, x: num(ax) ?? 0, y: num(ay) ?? 0, xExpr: num(ax) === null ? ax : undefined, yExpr: num(ay) === null ? ay : undefined, drag: false, label: '', color: 'ink', hidden: true })
      pointNames.add(name)
      ;(known as unknown as { last: string }).last = name
      return true
    }
    const ok = typeof n === 'string' && pointNames.has(n)
    if (!ok) errors.push(`${at}: "${String(n)}" is not a point (use a point name, or [x, y] with numbers or expressions)`)
    else (known as unknown as { last: string }).last = n as string
    return ok
  }
  const lastName = () => (known as unknown as { last: string }).last

  const segments: IxSegment[] = []
  arr(o.segments, 10).forEach((q, i) => {
    if (!known(q.from, `segments[${i}].from`)) return
    const from = lastName()
    if (!known(q.to, `segments[${i}].to`)) return
    segments.push({ from, to: lastName(), color: color(q.color, 'navy'), arrow: q.arrow === true, dashed: q.dashed === true, line: q.line === true })
  })
  const polygons: IxPolygon[] = []
  arr(o.polygons, 3).forEach((q, i) => {
    const pts = Array.isArray(q.points) ? q.points.slice(0, 8) : []
    if (pts.length < 3) { errors.push(`polygons[${i}] needs 3+ points`); return }
    const names: string[] = []
    for (const [j, p] of pts.entries()) { if (!known(p, `polygons[${i}].points[${j}]`)) return; names.push(lastName()) }
    polygons.push({ points: names, color: color(q.color, 'accent') })
  })
  const circles: IxCircle[] = []
  arr(o.circles, 3).forEach((q, i) => {
    if (!known(q.center, `circles[${i}].center`)) return
    const center = lastName()
    const name = str(q.name, 8) || undefined
    if (q.through !== undefined) { if (!known(q.through, `circles[${i}].through`)) return; circles.push({ name, center, through: lastName(), color: color(q.color, 'navy') }); return }
    const r = typeof q.radius === 'number' ? String(q.radius) : ex(q.radius, 80)
    if (!check(r, `circles[${i}].radius`, [], false)) return
    circles.push({ name, center, radius: r, color: color(q.color, 'navy') })
  })
  for (const { q, i, name, on } of circleGliders) {
    const ci = circles.findIndex(c => c.name === on) >= 0 ? circles.findIndex(c => c.name === on) : circles.length === 1 ? 0 : -1
    if (ci < 0) { errors.push(`gliders[${i}].on: circle "${on}" could not be drawn`); continue }
    const c = circles[ci]
    const glided = new Set(circleGliders.map(g => g.name))
    if (c.center === name || c.through === name || glided.has(c.center) || (c.through && glided.has(c.through))) { errors.push(`gliders[${i}] cannot ride on a circle defined by a point that itself rides on a circle`); continue }
    if (c.radius && new RegExp(`\\b${name.toLowerCase()}[xy]\\b`, 'i').test(c.radius)) { errors.push(`gliders[${i}] cannot ride on a circle whose radius depends on ${name}`); continue }
    const deg = num(q.angle_deg), rad = num(q.angle)
    gliders.push({ name, on, x: 0, circle: ci, angle: rad ?? (deg !== null ? deg * Math.PI / 180 : Math.PI / 4), label: str(q.label, 24) || name, color: color(q.color, 'clay') })
  }

  let field: IxSpec['field']
  if (o.field && typeof o.field === 'object') {
    const f = o.field as Record<string, unknown>
    const kind = f.kind === 'slope' ? 'slope' : 'vector'
    const dx = kind === 'slope' ? '1' : ex(f.dx, 160), dy = ex(f.dy, 160)
    if (check(dx, 'field.dx', ['y']) && check(dy, 'field.dy', ['y'])) field = { dx, dy, kind }
  }
  let ode: IxSpec['ode']
  if (o.ode && typeof o.ode === 'object') {
    const f = o.ode as Record<string, unknown>
    const expr = ex(f.dydx ?? f.expr, 160).replace(/^\s*(dy\/dx|y')\s*=\s*/i, '')
    if (check(expr, 'ode.dydx', ['y']) && known(f.from, 'ode.from')) ode = { expr, from: String(f.from), color: color(f.color, 'clay') }
  }
  let surface: IxSpec['surface']
  // Models also send the surface as a bare string ("z = x^2 + y^2") or as a one-item `surfaces` list.
  const rawSurface = typeof o.surface === 'string' ? { expr: o.surface } : o.surface ?? (Array.isArray(o.surfaces) ? o.surfaces[0] : undefined)
  if (rawSurface && typeof rawSurface === 'object') {
    const f = (typeof (rawSurface as Record<string, unknown>).z === 'string' && !(rawSurface as Record<string, unknown>).expr ? { ...(rawSurface as Record<string, unknown>), expr: (rawSurface as Record<string, unknown>).z } : rawSurface) as Record<string, unknown>
    const expr = ex(f.expr, 160).replace(/^\s*z\s*=\s*/i, '')
    if (check(expr, 'surface.expr', ['y'])) surface = { expr, z: range(f.z_range) ?? undefined, label: str(f.label, 30) || undefined }
  }

  const readouts: IxReadout[] = []
  arr(o.readouts, 4).forEach((q, i) => {
    const expr = ex(q.expr, 160)
    if (!check(expr, `readouts[${i}].expr`, [], false)) return
    readouts.push({ label: str(q.label, 30) || expr.slice(0, 30), expr, unit: str(q.unit, 10) || undefined })
  })

  const sceneRaw = str(o.scene, 20) as SceneKind
  const scene = SCENE_KINDS.includes(sceneRaw) ? sceneRaw : sceneForTitle(title) ?? undefined
  const spec: IxSpec = { title, explain: str(o.explain, 300) || undefined, x, y, sliders, points, gliders, functions, segments, polygons, circles, field, ode, surface, readouts, ...(scene ? { scene } : {}) }
  const things = points.length + functions.length + (field ? 1 : 0) + (surface ? 1 : 0)
  if (!things) errors.push('give at least one function, point, field or surface')
  if (surface && (points.length || gliders.length || field || ode)) errors.push('a 3D surface stands alone: use sliders with it, not points, fields or ODEs')
  const interactive = points.some(p => p.drag) || gliders.length || sliders.length || surface
  if (!interactive) errors.push('nothing to interact with: add a draggable point, a glider or a slider')
  // Hard errors make the spec unusable; the model gets them back and fixes the call.
  return { spec: errors.length ? null : spec, errors }
}

/* ───────────── Evaluation (shared by the client renderer and the static fallback) ───────────── */

export type IxEnv = Record<string, number>

export function compileSpec(spec: IxSpec) {
  const vars = [...spec.sliders.map(s => s.name.toLowerCase()), ...[...spec.points, ...spec.gliders].flatMap(p => coordVars(p.name))]
  const c = (expr: string, extra: string[] = []) => { const r = compileExpr(expr, [...vars, ...extra], true); return r.ok ? r.fn : () => NaN }
  return {
    fn: Object.fromEntries(spec.functions.map(f => [f.name, c(f.expr)])) as Record<string, (x: number, v?: IxEnv) => number>,
    px: Object.fromEntries(spec.points.filter(p => p.xExpr).map(p => [p.name, c(p.xExpr!)])) as Record<string, (x: number, v?: IxEnv) => number>,
    py: Object.fromEntries(spec.points.filter(p => p.yExpr).map(p => [p.name, c(p.yExpr!)])) as Record<string, (x: number, v?: IxEnv) => number>,
    radius: spec.circles.map(ci => (ci.radius ? c(ci.radius) : null)),
    fieldDx: spec.field ? c(spec.field.dx, ['y']) : null,
    fieldDy: spec.field ? c(spec.field.dy, ['y']) : null,
    ode: spec.ode ? c(spec.ode.expr, ['y']) : null,
    surface: spec.surface ? c(spec.surface.expr, ['y']) : null,
    readouts: spec.readouts.map(r => c(r.expr)),
  }
}
export type IxCompiled = ReturnType<typeof compileSpec>

/** Initial positions of every point (dependent points and gliders evaluated in order). */
export function initialEnv(spec: IxSpec, k: IxCompiled): { env: IxEnv; pos: Record<string, [number, number]> } {
  const env: IxEnv = Object.fromEntries(spec.sliders.map(s => [s.name.toLowerCase(), s.value]))
  const pos: Record<string, [number, number]> = {}
  for (const p of spec.points) {
    const px = p.xExpr ? k.px[p.name](0, env) : p.x, py = p.yExpr ? k.py[p.name](0, env) : p.y
    pos[p.name] = [px, py]; env[`${p.name.toLowerCase()}x`] = px; env[`${p.name.toLowerCase()}y`] = py
  }
  for (const g of spec.gliders) {
    if (g.circle !== undefined) continue
    const gy = k.fn[g.on]?.(g.x, env) ?? NaN
    pos[g.name] = [g.x, gy]; env[`${g.name.toLowerCase()}x`] = g.x; env[`${g.name.toLowerCase()}y`] = gy
  }
  for (const g of spec.gliders) {
    if (g.circle === undefined) continue
    const [cx, cy, r] = circleAt(spec, k, g.circle, pos, env)
    const gx = cx + r * Math.cos(g.angle ?? 0), gy = cy + r * Math.sin(g.angle ?? 0)
    pos[g.name] = [gx, gy]; env[`${g.name.toLowerCase()}x`] = gx; env[`${g.name.toLowerCase()}y`] = gy
  }
  // Points that follow a glider (the foot ["px", 0] below P) are evaluated again now the gliders are placed.
  for (const p of spec.points) {
    if (!p.xExpr && !p.yExpr) continue
    const px = p.xExpr ? k.px[p.name](0, env) : p.x, py = p.yExpr ? k.py[p.name](0, env) : p.y
    pos[p.name] = [px, py]; env[`${p.name.toLowerCase()}x`] = px; env[`${p.name.toLowerCase()}y`] = py
  }
  return { env, pos }
}

/** Centre and radius of circle i given current point positions. */
export function circleAt(spec: IxSpec, k: IxCompiled, i: number, pos: Record<string, [number, number]>, env: IxEnv): [number, number, number] {
  const ci = spec.circles[i]
  const c = pos[ci.center] ?? [NaN, NaN]
  const r = ci.through ? Math.hypot((pos[ci.through]?.[0] ?? NaN) - c[0], (pos[ci.through]?.[1] ?? NaN) - c[1]) : Math.abs(k.radius[i]?.(0, env) ?? NaN)
  return [c[0], c[1], r]
}

/** dy/dx = f(x, y) solved both ways from (x0, y0) with RK4, clipped to the view. */
export function odeCurve(f: (x: number, v?: IxEnv) => number, env: IxEnv, x0: number, y0: number, xr: [number, number], yr: [number, number], n = 240): [number, number][] {
  const h = (xr[1] - xr[0]) / n
  const slope = (x: number, y: number) => f(x, { ...env, y })
  const run = (dir: 1 | -1) => {
    const out: [number, number][] = []
    let x = x0, y = y0
    const span = yr[1] - yr[0]
    for (let i = 0; i < n; i++) {
      const s = dir * h
      const k1 = slope(x, y), k2 = slope(x + s / 2, y + s * k1 / 2), k3 = slope(x + s / 2, y + s * k2 / 2), k4 = slope(x + s, y + s * k3)
      y += s * (k1 + 2 * k2 + 2 * k3 + k4) / 6; x += s
      if (!Number.isFinite(y) || x < xr[0] - h || x > xr[1] + h || y < yr[0] - span || y > yr[1] + span) break
      out.push([x, y])
    }
    return out
  }
  return [...run(-1).reverse(), [x0, y0], ...run(1)]
}

/* ───────────── Static SVG (the board figure and the no-JavaScript / text fallback) ───────────── */

const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)
const f1 = (n: number) => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : '0')

function niceStep(raw: number) {
  if (!(raw > 0)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const m = raw / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
}

/** Widen the shorter range so one unit is as long across as up in a frame of the given width/height (circles stay round). */
export function equalUnits(spec: IxSpec, aspect: number): IxSpec {
  let [x0, x1] = spec.x, [y0, y1] = spec.y
  const w = x1 - x0, h = y1 - y0
  if (w / h > aspect) { const nh = w / aspect, c = (y0 + y1) / 2; y0 = c - nh / 2; y1 = c + nh / 2 }
  else if (w / h < aspect) { const nw = h * aspect, c = (x0 + x1) / 2; x0 = c - nw / 2; x1 = c + nw / 2 }
  return { ...spec, x: [x0, x1], y: [y0, y1] }
}

/**
 * The figure's frame and bounding box. Figures with circles (the unit circle, geometry) keep 1:1 units so a circle is
 * never drawn as an ellipse: the frame takes the ranges' own aspect (clamped to 1–1.6 so it suits a phone) and the
 * shorter range widens symmetrically when the clamp bites. Other figures keep the 3:2 frame and their own ranges.
 */
export function figureGeom(spec: IxSpec): { aspect: number; bbox: [number, number, number, number] } {
  if (spec.surface) return { aspect: 1 / 0.9, bbox: [-8, 8, 8, -8] }
  if (!spec.circles.length) return { aspect: 1.5, bbox: [spec.x[0], spec.y[1], spec.x[1], spec.y[0]] }
  const aspect = Math.min(1.6, Math.max(1, (spec.x[1] - spec.x[0]) / (spec.y[1] - spec.y[0])))
  const e = equalUnits(spec, aspect)
  return { aspect, bbox: [e.x[0], e.y[1], e.x[1], e.y[0]] }
}

export function interactiveSvg(spec0: IxSpec, opts: { recap?: boolean } = {}): string {
  // A scene's still: the moment that teaches (magnet entering the coil with the meter swung; field on; charges moving).
  if (spec0.scene && spec0.sliders[0]) {
    const sl = spec0.sliders[0], range = { min: sl.min, max: sl.max }
    if (spec0.scene === 'magnet_coil') return magnetCoilSvg(Math.min(sl.max, 1.6), { t: 0.4, emf: 0.75, needle: 39, phase: 0.3 }, range)
    if (spec0.scene === 'wire_field') { const I = Math.max(Math.abs(sl.min), Math.abs(sl.max)); return wireFieldSvg(I, stepWireField({ t: 0 }, I, I, 1), range) }
    return chargeDriftSvg(sl.max * 0.7, { t: 0.3, drift: 1.2, passed: 6 }, range)
  }
  // The recap still is shown about 340 px wide on a phone: a smaller canvas with larger type keeps every label
  // readable there (≥ 12 px rendered; docs/design/lesson-ui.md §4, §13). The chat/lesson still keeps 640 × 420.
  const R = !!opts.recap
  const W = R ? 400 : 640, H = R ? 280 : 420, P = R ? 30 : 36
  const FT = R ? 13 : 12, FP = R ? 18 : 15, FL = R ? 16 : 14
  // Circles stay round in the still too (its plot area is (W-2P) x (H-2P)).
  const spec = spec0.circles.length && !spec0.surface ? equalUnits(spec0, (W - 2 * P) / (H - 2 * P)) : spec0
  const k = compileSpec(spec)
  const { env, pos } = initialEnv(spec, k)
  const parts: string[] = []
  if (spec.surface) {
    // Isometric wireframe of z = f(x, y).
    const zf = k.surface!
    const N = 18
    const zs: number[] = []
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) zs.push(zf(spec.x[0] + (spec.x[1] - spec.x[0]) * i / N, { ...env, y: spec.y[0] + (spec.y[1] - spec.y[0]) * j / N }))
    const fin = zs.filter(Number.isFinite)
    const zr = spec.surface.z ?? [Math.min(...fin, 0), Math.max(...fin, 1)]
    const ca = Math.cos(0.6), sa = Math.sin(0.6)
    const sc = W / 640
    const proj = (u: number, v: number, z: number) => { const a = (u - 0.5) * ca - (v - 0.5) * sa, b = (u - 0.5) * sa + (v - 0.5) * ca, c = (Math.min(zr[1], Math.max(zr[0], z)) - zr[0]) / (zr[1] - zr[0] || 1) - 0.5; return [W / 2 + a * 380 * sc, H / 2 + 20 * sc + b * 150 * sc - c * 210 * sc] }
    for (let i = 0; i <= N; i++) {
      let d1 = '', d2 = ''
      for (let j = 0; j <= N; j++) {
        const [x1, y1] = proj(i / N, j / N, zs[i * (N + 1) + j]); d1 += `${j ? 'L' : 'M'}${f1(x1)},${f1(y1)}`
        const [x2, y2] = proj(j / N, i / N, zs[j * (N + 1) + i]); d2 += `${j ? 'L' : 'M'}${f1(x2)},${f1(y2)}`
      }
      parts.push(`<path d="${d1}" fill="none" stroke="${IX_HEX.accent}" stroke-width="1.1" opacity="0.8"/><path d="${d2}" fill="none" stroke="${IX_HEX.navy}" stroke-width="1.1" opacity="0.6"/>`)
    }
    parts.push(`<text x="${W / 2}" y="${H - 10}" font-size="${FL}" text-anchor="middle" fill="#3D3D47">z = ${esc(spec.surface.expr)}</text>`)
  } else {
    const sx = (x: number) => P + (x - spec.x[0]) / (spec.x[1] - spec.x[0]) * (W - 2 * P)
    const sy = (y: number) => H - P - (y - spec.y[0]) / (spec.y[1] - spec.y[0]) * (H - 2 * P)
    const stx = niceStep((spec.x[1] - spec.x[0]) / (R ? 5 : 8)), sty = niceStep((spec.y[1] - spec.y[0]) / (R ? 4 : 6))
    for (let v = Math.ceil(spec.x[0] / stx) * stx; v <= spec.x[1] + 1e-9; v += stx) parts.push(`<line x1="${f1(sx(v))}" x2="${f1(sx(v))}" y1="${P}" y2="${H - P}" stroke="#E5E1D8"/>${Math.abs(v) > 1e-9 ? `<text x="${f1(sx(v))}" y="${f1(Math.min(H - P + 16, Math.max(P + 14, sy(0) + FT + 4)))}" font-size="${FT}" text-anchor="middle" fill="#66666F">${Number(v.toPrecision(6))}</text>` : ''}`)
    for (let v = Math.ceil(spec.y[0] / sty) * sty; v <= spec.y[1] + 1e-9; v += sty) parts.push(`<line x1="${P}" x2="${W - P}" y1="${f1(sy(v))}" y2="${f1(sy(v))}" stroke="#E5E1D8"/>${Math.abs(v) > 1e-9 ? `<text x="${f1(Math.max(P - 4, Math.min(W - P - 4, sx(0) - 6)))}" y="${f1(sy(v) + 4)}" font-size="${FT}" text-anchor="end" fill="#66666F">${Number(v.toPrecision(6))}</text>` : ''}`)
    if (spec.y[0] <= 0 && spec.y[1] >= 0) parts.push(`<line x1="${P}" x2="${W - P}" y1="${f1(sy(0))}" y2="${f1(sy(0))}" stroke="#14141A" stroke-width="1.3"/>`)
    if (spec.x[0] <= 0 && spec.x[1] >= 0) parts.push(`<line x1="${f1(sx(0))}" x2="${f1(sx(0))}" y1="${P}" y2="${H - P}" stroke="#14141A" stroke-width="1.3"/>`)
    parts.push(`<clipPath id="ixclip"><rect x="${P}" y="${P}" width="${W - 2 * P}" height="${H - 2 * P}"/></clipPath><g clip-path="url(#ixclip)">`)
    if (spec.field) {
      const n = 14
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n * 0.66; j++) {
        const x = spec.x[0] + (spec.x[1] - spec.x[0]) * i / n, y = spec.y[0] + (spec.y[1] - spec.y[0]) * j / (n * 0.66)
        let dx = k.fieldDx!(x, { ...env, y }), dy = k.fieldDy!(x, { ...env, y })
        const len = Math.hypot(dx * (W - 2 * P) / (spec.x[1] - spec.x[0]), dy * (H - 2 * P) / (spec.y[1] - spec.y[0]))
        if (!Number.isFinite(len) || len === 0) continue
        const L = 14 / len; dx *= L; dy *= L
        const x1 = sx(x), y1 = sy(y), x2 = sx(x + dx), y2 = sy(y + dy)
        parts.push(spec.field.kind === 'slope' ? `<line x1="${f1(2 * x1 - x2)}" y1="${f1(2 * y1 - y2)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="#8C8C99" stroke-width="1.3"/>` : `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="#8C8C99" stroke-width="1.3"/><circle cx="${f1(x2)}" cy="${f1(y2)}" r="1.8" fill="#8C8C99"/>`)
      }
    }
    const curve = (pts: [number, number][], hex: string, dashed = false) => {
      let d = '', pen = false
      for (const [x, y] of pts) { if (!Number.isFinite(y) || y < spec.y[0] - (spec.y[1] - spec.y[0]) || y > spec.y[1] + (spec.y[1] - spec.y[0])) { pen = false; continue } d += `${pen ? 'L' : 'M'}${f1(sx(x))},${f1(sy(y))}`; pen = true }
      parts.push(`<path d="${d}" fill="none" stroke="${hex}" stroke-width="2.6" stroke-linecap="round"${dashed ? ' stroke-dasharray="7 6"' : ''}/>`)
    }
    for (const f of spec.functions) curve(Array.from({ length: 301 }, (_, i) => { const x = spec.x[0] + (spec.x[1] - spec.x[0]) * i / 300; return [x, k.fn[f.name](x, env)] as [number, number] }), IX_HEX[f.color], f.dashed)
    if (spec.ode) { const p0 = pos[spec.ode.from]; curve(odeCurve(k.ode!, env, p0[0], p0[1], spec.x, spec.y), IX_HEX[spec.ode.color]) }
    for (const pg of spec.polygons) parts.push(`<polygon points="${pg.points.map(n => `${f1(sx(pos[n][0]))},${f1(sy(pos[n][1]))}`).join(' ')}" fill="${IX_HEX[pg.color]}" fill-opacity="0.12" stroke="none"/>`)
    spec.circles.forEach((ci, i) => {
      const c = pos[ci.center]
      const r = ci.through ? Math.hypot(pos[ci.through][0] - c[0], pos[ci.through][1] - c[1]) : k.radius[i]!(0, env)
      parts.push(`<ellipse cx="${f1(sx(c[0]))}" cy="${f1(sy(c[1]))}" rx="${f1(Math.abs(r) * (W - 2 * P) / (spec.x[1] - spec.x[0]))}" ry="${f1(Math.abs(r) * (H - 2 * P) / (spec.y[1] - spec.y[0]))}" fill="none" stroke="${IX_HEX[ci.color]}" stroke-width="2.2"/>`)
    })
    for (const s of spec.segments) {
      const a = pos[s.from], b = pos[s.to]
      parts.push(`<line x1="${f1(sx(a[0]))}" y1="${f1(sy(a[1]))}" x2="${f1(sx(b[0]))}" y2="${f1(sy(b[1]))}" stroke="${IX_HEX[s.color]}" stroke-width="2.2"${s.dashed ? ' stroke-dasharray="7 6"' : ''}/>`)
      if (s.arrow) { const ang = Math.atan2(sy(b[1]) - sy(a[1]), sx(b[0]) - sx(a[0])); const hx = sx(b[0]), hy = sy(b[1]); parts.push(`<path d="M${f1(hx - 11 * Math.cos(ang - 0.45))},${f1(hy - 11 * Math.sin(ang - 0.45))}L${f1(hx)},${f1(hy)}L${f1(hx - 11 * Math.cos(ang + 0.45))},${f1(hy - 11 * Math.sin(ang + 0.45))}" fill="none" stroke="${IX_HEX[s.color]}" stroke-width="2.2"/>`) }
    }
    parts.push('</g>')
    for (const p of [...spec.points, ...spec.gliders]) {
      const [x, y] = pos[p.name]
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      if ('hidden' in p && p.hidden) continue
      const drag = 'drag' in p ? p.drag : true
      parts.push(`<circle cx="${f1(sx(x))}" cy="${f1(sy(y))}" r="${drag ? (R ? 7 : 6.5) : (R ? 5 : 4.5)}" fill="${IX_HEX[p.color]}"${drag ? ' stroke="#fff" stroke-width="2"' : ''}/><text x="${f1(sx(x) + 10)}" y="${f1(sy(y) - 10)}" font-size="${FP}" font-weight="${R ? 600 : 400}" fill="${IX_HEX[p.color]}">${esc(p.label)}</text>`)
    }
    spec.functions.filter(f => f.label).forEach((f, i) => parts.push(`<text x="${W - P - 4}" y="${P + FL + 2 + i * (FL + 4)}" font-size="${FL}" text-anchor="end" fill="${IX_HEX[f.color]}">${esc(f.label)}</text>`))
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="DejaVu Sans, Inter, sans-serif"><rect width="${W}" height="${H}" fill="#FBFAF7"/>${parts.join('')}</svg>`
}

/** One-line text fallback: what the figure shows and what to drag. */
export function interactiveAlt(spec: IxSpec): string {
  const what = [
    spec.functions.length ? `graph of ${spec.functions.map(f => `y = ${f.expr}`).join(', ')}` : '',
    spec.field ? `${spec.field.kind} field` : '', spec.ode ? `solution curve of dy/dx = ${spec.ode.expr}` : '', spec.surface ? `surface z = ${spec.surface.expr}` : '',
    spec.polygons.length ? 'a shape' : '', spec.points.some(p => !p.hidden) ? `points ${spec.points.filter(p => !p.hidden).map(p => p.name).join(', ')}` : '',
  ].filter(Boolean).join('; ')
  const drag = [...spec.points.filter(p => p.drag).map(p => p.name), ...spec.gliders.map(g => g.name)]
  return `${spec.title}: ${what}.${drag.length ? ` Drag ${drag.join(', ')}.` : ''}${spec.sliders.length ? ` Sliders: ${spec.sliders.map(s => s.label).join(', ')}.` : ''}`.slice(0, 300)
}

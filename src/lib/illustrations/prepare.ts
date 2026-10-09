/**
 * Turns a library entry into a ready, credited SVG: fetch once (polite user agent, size and time limits),
 * vectorise raster originals with VTracer (WASM, limited palette), clean the markup, add the attribution strip,
 * and cache the result in Supabase Storage so each source file is downloaded at most once. Server only.
 */
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SOURCE_NAME, creditLine, type Credit, type LibraryItem } from './types'

const UA = 'GeniusMap/1.0 (education app; https://cogniva-innovation.vercel.app; abdulcosman01@gmail.com)'
const BUCKET = 'illustrations'
const MAX_SRC = 2_500_000
const MAX_OUT = 400_000
/** Bumped when the output format changes, so cached copies are rebuilt. */
const VERSION = 'v1'

export interface Prepared {
  svg: string; credit: Credit; width: number; height: number; cached: boolean; vectorised: boolean; ms: number
  /** Public URL of the cached, credited SVG (null without storage): boards reference it instead of inlining it. */
  url: string | null
}

/* ───────────── Cleaning (deny-list; the result is only ever shown inside <img>/<image>) ───────────── */

const DROP_TAGS = /^(script|foreignobject|iframe|object|embed|audio|video|canvas|animate\w*|set|metadata|handler|listener|discard)$/i
const NS_JUNK = /^(sodipodi|inkscape|rdf|cc|dc|i|x|sketch|serif|ns\d+|xml|ai|graph|figma):/i

export function cleanLibrarySvg(input: string): { svg: string | null; removed: string[] } {
  const removed = new Set<string>()
  const src = String(input ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?(\[[\s\S]*?\])?\s*>/gi, '')
  const start = src.search(/<svg[\s>]/i)
  if (start < 0) return { svg: null, removed: ['no <svg>'] }
  const tokenRe = /<\/?([a-zA-Z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|([^<]+)/g
  const out: string[] = []
  const stack: string[] = []
  let skip = 0
  let m: RegExpExecArray | null
  tokenRe.lastIndex = start
  while ((m = tokenRe.exec(src))) {
    const [whole, rawTag, attrs, selfClose, cdata, text] = m
    if (cdata !== undefined || text !== undefined) {
      if (skip || !stack.length) continue
      const t = cdata ?? text!
      // Inside <style>: no external loads or imports.
      if (stack[stack.length - 1] === 'style') { out.push(t.replace(/@import[^;]*;?/gi, '').replace(/url\(\s*(?!['"]?#)[^)]*\)/gi, 'none').replace(/</g, '')); continue }
      out.push(cdata !== undefined ? t.replace(/&/g, '&amp;').replace(/</g, '&lt;') : t)
      continue
    }
    const tag = rawTag.replace(/^svg:/i, '')
    const low = tag.toLowerCase()
    const closing = whole.startsWith('</')
    const dropped = DROP_TAGS.test(low) || NS_JUNK.test(tag)
    // <a> links are dropped but their children kept.
    if (low === 'a') { removed.add('a'); continue }
    if (closing) {
      if (dropped) { if (skip) skip--; continue }
      if (skip) continue
      const i = stack.lastIndexOf(tag)
      if (i >= 0) while (stack.length > i) out.push(`</${stack.pop()}>`)
      if (!stack.length) break
      continue
    }
    if (dropped) { removed.add(low); if (!selfClose) skip++; continue }
    if (skip) continue
    const kept: string[] = []
    const attrRe = /([^\s=>/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
    let a: RegExpExecArray | null
    while ((a = attrRe.exec(attrs ?? ''))) {
      const name = a[1]
      const n = name.toLowerCase()
      let val = (a[3] ?? a[4] ?? a[5] ?? '').trim()
      if (/^on/i.test(n) || NS_JUNK.test(name) && !/^xml:space$/i.test(name)) { removed.add(`@${n}`); continue }
      if (/^xmlns:(sodipodi|inkscape|rdf|cc|dc|i|x|sketch|serif|ns\d+|ai|graph)$/i.test(n)) continue
      if (n === 'href' || n === 'xlink:href') {
        // Local references and embedded raster images only: never a file path or an external URL.
        if (!/^#[\w.:-]+$/.test(val) && !/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(val)) { removed.add('@href'); continue }
      }
      if (/javascript:|vbscript:|expression\(|@import/i.test(val)) { removed.add(`@${n}`); continue }
      if (/url\s*\(/i.test(val)) val = val.replace(/url\(\s*(['"]?)(?!#)[^)]*\)/gi, 'none')
      kept.push(`${name}="${val.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`)
    }
    if (low === 'svg' && !stack.length) {
      if (!kept.some(k => k.startsWith('xmlns='))) kept.push('xmlns="http://www.w3.org/2000/svg"')
      if (!kept.some(k => k.startsWith('xmlns:xlink='))) kept.push('xmlns:xlink="http://www.w3.org/1999/xlink"')
    }
    const name = tag
    out.push(`<${name}${kept.length ? ' ' + kept.join(' ') : ''}${selfClose ? '/>' : '>'}`)
    if (!selfClose) stack.push(name)
  }
  while (stack.length) out.push(`</${stack.pop()}>`)
  const svg = out.join('').replace(/>\s+</g, '><')
  if (!/^<svg[\s>]/.test(svg)) return { svg: null, removed: [...removed] }
  return { svg, removed: [...removed] }
}

/** The drawing's size from its root element (viewBox first, then width/height in any unit). */
export function svgBox(svg: string): { x: number; y: number; w: number; h: number } | null {
  const root = svg.match(/^<svg\b[^>]*>/)?.[0] ?? ''
  const vb = root.match(/viewBox="([^"]+)"/i)?.[1]?.trim().split(/[\s,]+/).map(Number)
  if (vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) return { x: vb[0], y: vb[1], w: vb[2], h: vb[3] }
  const num = (k: string) => { const v = root.match(new RegExp(`\\s${k}="([\\d.]+)`))?.[1]; return v ? Number(v) : NaN }
  const w = num('width'), h = num('height')
  return w > 0 && h > 0 ? { x: 0, y: 0, w, h } : null
}

/** Wrap a cleaned SVG with a white background and a small credit strip underneath (it travels with the image). */
export function withCredit(svg: string, credit: Credit): { svg: string; width: number; height: number } | null {
  const box = svgBox(svg)
  if (!box) return null
  // Normalise to a 640-wide frame so the credit text has a consistent size.
  const W = 640, H = Math.round((box.h / box.w) * W)
  const line = creditLine(credit)
  const fs = Math.max(8, Math.min(12, (W - 16) / (line.length * 0.52)))
  const band = Math.round(fs * 1.9)
  const inner = svg
    .replace(/^<svg\b([^>]*)>/, (_, attrs: string) => `<svg${attrs.replace(/\s(width|height|x|y|viewBox|preserveAspectRatio)="[^"]*"/gi, '')} x="0" y="0" width="${W}" height="${H}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" preserveAspectRatio="xMidYMid meet">`)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const out = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H + band}" width="${W}" height="${H + band}"><rect x="0" y="0" width="${W}" height="${H + band}" fill="#ffffff"/>${inner}<text x="${W - 6}" y="${H + band - Math.round(fs * 0.62)}" font-family="Inter, Arial, sans-serif" font-size="${fs.toFixed(1)}" fill="#6b6b73" text-anchor="end">${esc(line)}</text></svg>`
  return { svg: out, width: W, height: H + band }
}

/* ───────────── Fetch, vectorise, cache ───────────── */

async function download(url: string, timeoutMs = 9000): Promise<Uint8Array> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA }, signal: ctl.signal, redirect: 'follow' })
    if (!r.ok) throw new Error(`source answered ${r.status}`)
    const len = Number(r.headers.get('content-length') ?? 0)
    if (len > MAX_SRC) throw new Error('source file too large')
    const buf = new Uint8Array(await r.arrayBuffer())
    if (buf.length > MAX_SRC) throw new Error('source file too large')
    return buf
  } finally { clearTimeout(timer) }
}

/** Trace a raster illustration to SVG with a limited palette (flat, clean regions). */
export async function vectorise(png: Uint8Array): Promise<string> {
  const { convertBuffer } = await import('@visioncortex/vtracer')
  return convertBuffer(png, { mode: 'spline', filterSpeckle: 6, colorPrecision: 6, layerDifference: 16, maxColors: 16, optimize: 2, simplify: 1, pathPrecision: 1, cornerThreshold: 60 })
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function creditFor(item: LibraryItem, vectorised = false): Credit {
  return {
    // Commons titles end in a language code ("Heart diagram en"): not part of the name.
    title: cap(item.t.replace(/\s+(en|EN|eng)$/, '')).slice(0, 80), author: item.by.slice(0, 60), source: SOURCE_NAME[item.src], license: item.lic, licenseUrl: item.licUrl, url: item.page,
    changes: vectorised ? 'vectorised' : undefined,
  }
}

const key = (item: LibraryItem) => `${item.src}/${createHash('sha1').update(`${VERSION}:${item.id}:${item.file}`).digest('hex').slice(0, 24)}.svg`

let bucketReady = false
async function ensureBucket(admin: SupabaseClient) {
  if (bucketReady) return
  // Public read: the board shows these as <image href> (credited, sanitised SVG); only the server writes.
  const { data } = await admin.storage.getBucket(BUCKET)
  if (!data) await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: '1MB', allowedMimeTypes: ['image/svg+xml'] }).catch(() => undefined)
  else if (!data.public) await admin.storage.updateBucket(BUCKET, { public: true, fileSizeLimit: '1MB', allowedMimeTypes: ['image/svg+xml'] }).catch(() => undefined)
  bucketReady = true
}

/** A ready, credited SVG for one library entry (from the cache when it has been used before). */
export async function prepareIllustration(item: LibraryItem, admin: SupabaseClient | null): Promise<Prepared> {
  const t0 = Date.now()
  const vectorised = item.fmt === 'png'
  const credit = creditFor(item, vectorised)
  const path = key(item)
  if (admin) {
    const { data } = await admin.storage.from(BUCKET).download(path).catch(() => ({ data: null }))
    if (data) {
      const svg = await data.text()
      const b = svgBox(svg)
      if (b) return { svg, credit, width: b.w, height: b.h, cached: true, vectorised, ms: Date.now() - t0, url: admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl }
    }
  }
  const bytes = await download(item.file)
  let raw: string
  if (vectorised) raw = await vectorise(bytes)
  else raw = new TextDecoder().decode(bytes)
  const clean = cleanLibrarySvg(raw)
  if (!clean.svg) throw new Error('not a usable SVG')
  const framed = withCredit(clean.svg, credit)
  if (!framed) throw new Error('SVG has no size')
  if (framed.svg.length > MAX_OUT) throw new Error(`SVG too large (${Math.round(framed.svg.length / 1024)} KB)`)
  let url: string | null = null
  if (admin) {
    await ensureBucket(admin).catch(() => undefined)
    const up = await admin.storage.from(BUCKET).upload(path, new Blob([framed.svg], { type: 'image/svg+xml' }), { contentType: 'image/svg+xml', upsert: true, cacheControl: '31536000' }).catch(() => ({ error: true }))
    if (!up.error) url = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  }
  return { svg: framed.svg, credit, width: framed.width, height: framed.height, cached: false, vectorised, ms: Date.now() - t0, url }
}

/* ───────────── Live Wikimedia Commons search (when the offline index has nothing) ───────────── */

const OK_LIC = /^(cc0|public domain|pd\b|pd-|cc[- ]by(-sa)?[- ]?\d|cc[- ]by(-sa)?$)/i
const strip = (s: unknown) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const liveCache = new Map<string, LibraryItem[]>()

export async function searchCommonsLive(query: string): Promise<LibraryItem[]> {
  const q = query.trim().toLowerCase().slice(0, 80)
  if (!q) return []
  if (liveCache.has(q)) return liveCache.get(q)!
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch=${encodeURIComponent(`${q} filemime:image/svg+xml`)}&prop=imageinfo&iiprop=url|size|extmetadata&iiextmetadatafilter=LicenseShortName|LicenseUrl|Artist|ImageDescription`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 6000)
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA }, signal: ctl.signal })
    const j = await r.json() as { query?: { pages?: Record<string, { title: string; index?: number; imageinfo?: { url: string; descriptionurl: string; size: number; extmetadata?: Record<string, { value?: string }> }[] }> } }
    const items: LibraryItem[] = []
    for (const p of Object.values(j.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
      const ii = p.imageinfo?.[0]
      const m = ii?.extmetadata ?? {}
      const lic = strip(m.LicenseShortName?.value)
      if (!ii || !OK_LIC.test(lic) || /nc|nd/i.test(lic.replace(/^cc0/i, '')) || ii.size > 1_500_000) continue
      const name = p.title.replace(/^File:/, '').replace(/\.svg$/i, '')
      items.push({ id: `commons:${name}`.slice(0, 160), src: 'commons', t: name.replace(/[_-]+/g, ' '), k: q, d: strip(m.ImageDescription?.value).slice(0, 200), lic: /^pd|public domain/i.test(lic) ? 'Public domain' : lic, licUrl: m.LicenseUrl?.value ?? null, by: strip(m.Artist?.value).slice(0, 80) || 'Wikimedia Commons contributor', file: ii.url, page: ii.descriptionurl, fmt: 'svg', bytes: ii.size })
    }
    if (liveCache.size > 200) liveCache.clear()
    liveCache.set(q, items)
    return items
  } catch { return [] } finally { clearTimeout(timer) }
}

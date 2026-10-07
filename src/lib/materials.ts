/**
 * Class materials (server only): file rules, text extraction for PDF / PPTX / DOCX
 * with pure-JS libraries (no native binaries, so it runs on Vercel), and helpers that
 * turn extracted text into prompt context for lesson drafting.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const MATERIALS_BUCKET = 'lesson-materials'
/** Upload limit shown to tutors (the bucket allows a little more for headroom). */
export const MATERIAL_MAX_BYTES = 20 * 1024 * 1024
export const MATERIALS_PER_LESSON = 12
/** Extracted text kept per file. Enough for a long textbook chapter. */
const MAX_TEXT_CHARS = 400_000
/** Signed links are short-lived: long enough to open or download, not to share. */
export const SIGNED_URL_SECONDS = 120

export type MaterialKind = 'pdf' | 'pptx' | 'docx'
export type MaterialStatus = 'uploading' | 'reading' | 'ready' | 'failed'

export const MIME_BY_KIND: Record<MaterialKind, string> = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

export interface MaterialRow {
  id: string
  lesson_id: string
  tutor_id: string
  file_name: string
  mime: string
  size: number
  path: string
  extracted_text: string | null
  page_count: number | null
  status: MaterialStatus
  error: string | null
  visible_to_students: boolean
  created_at: string
  updated_at: string
}

/** Columns safe to send to the browser (no extracted text). */
export const MATERIAL_PUBLIC_COLS = 'id, lesson_id, file_name, mime, size, page_count, status, error, visible_to_students, created_at, updated_at'

/** Works out the kind from the file name and the browser's MIME type (which is often empty for Office files). */
export function kindOf(fileName: string, mime?: string | null): MaterialKind | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  if (ext === 'pdf' || mime === MIME_BY_KIND.pdf) return 'pdf'
  if (ext === 'pptx' || mime === MIME_BY_KIND.pptx) return 'pptx'
  if (ext === 'docx' || mime === MIME_BY_KIND.docx) return 'docx'
  return null
}

/** Storage-safe file name: keeps the extension, drops anything unusual. */
export function safeFileName(name: string) {
  const base = name.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(-100)
  return base.replace(/^[.-]+/, '') || 'file'
}

/* ───────────── Extraction ───────────── */

function decodeXml(s: string) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

/** Paragraph texts from a DrawingML part (slides, notes): <a:p> paragraphs of <a:t> runs. */
function drawingParagraphs(xml: string): string[] {
  const out: string[] = []
  for (const p of xml.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? []) {
    const runs = [...p.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map(m => decodeXml(m[1]))
    const line = runs.join('').replace(/\s+/g, ' ').trim()
    if (line) out.push(line)
  }
  return out
}

async function extractPptx(buf: Buffer): Promise<{ text: string; pages: number }> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buf)
  const num = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0)
  const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b))
  const parts: string[] = []
  for (const name of slides) {
    const n = num(name)
    const xml = await zip.file(name)!.async('string')
    const lines = drawingParagraphs(xml)
    // Speaker notes often carry the actual explanation.
    const rels = await zip.file(`ppt/slides/_rels/slide${n}.xml.rels`)?.async('string')
    const notesTarget = rels ? /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(rels)?.[1] : undefined
    const notesXml = notesTarget ? await zip.file(`ppt/notesSlides/${notesTarget}`)?.async('string') : undefined
    const notes = notesXml ? drawingParagraphs(notesXml).filter(l => !/^\d+$/.test(l)) : []
    parts.push([`## Slide ${n}`, ...lines, ...(notes.length ? ['Speaker notes: ' + notes.join(' ')] : [])].join('\n'))
  }
  return { text: parts.join('\n\n'), pages: slides.length }
}

async function extractDocx(buf: Buffer): Promise<{ text: string; pages: number | null }> {
  const mammoth = await import('mammoth')
  const { value } = await mammoth.extractRawText({ buffer: buf })
  return { text: value, pages: null }
}

async function extractPdf(buf: Buffer): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buf))
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  const pages = Array.isArray(text) ? text : [text]
  return { text: pages.map((t, i) => `## Page ${i + 1}\n${t.trim()}`).join('\n\n'), pages: totalPages }
}

/** Plain text of a PDF, PPTX or DOCX file, tidied and capped. Throws with a readable message. */
export async function extractMaterialText(buf: Buffer, kind: MaterialKind): Promise<{ text: string; pages: number | null }> {
  let r: { text: string; pages: number | null }
  try {
    r = kind === 'pdf' ? await extractPdf(buf) : kind === 'pptx' ? await extractPptx(buf) : await extractDocx(buf)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/password|encrypt/i.test(msg)) throw new Error('The file is password-protected.')
    throw new Error(`The file could not be read (${msg.slice(0, 120)}).`)
  }
  const text = r.text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS)
  // Headings alone ("## Page 3") don't count as content.
  const content = text.replace(/^## (Page|Slide) \d+$/gm, '').replace(/\s+/g, ' ').trim()
  if (content.length < 40) {
    throw new Error(kind === 'pdf'
      ? 'No text was found. The PDF looks like scanned images; export it with selectable text and upload again.'
      : 'No text was found in the file.')
  }
  return { text, pages: r.pages }
}

/* ───────────── Prompt context ───────────── */

export interface MaterialSource { fileName: string; text: string }

/** Ready materials of a lesson, oldest first (service role or tutor client). */
export async function loadMaterialSources(db: SupabaseClient, lessonId: string): Promise<MaterialSource[]> {
  const { data } = await db
    .from('lesson_materials').select('file_name, extracted_text, status')
    .eq('lesson_id', lessonId).eq('status', 'ready').order('created_at', { ascending: true })
  return ((data ?? []) as { file_name: string; extracted_text: string | null }[])
    .filter(r => r.extracted_text && r.extracted_text.trim())
    .map(r => ({ fileName: r.file_name, text: r.extracted_text! }))
}

interface Chunk { file: string; heading: string; text: string; order: number }

/** Splits sources into ~1,500-character chunks on paragraph boundaries, keeping page/slide headings. */
function chunk(sources: MaterialSource[], size = 1500): Chunk[] {
  const out: Chunk[] = []
  let order = 0
  for (const s of sources) {
    let heading = ''
    let buf = ''
    const push = () => { if (buf.trim()) out.push({ file: s.fileName, heading, text: buf.trim(), order: order++ }); buf = '' }
    for (const para of s.text.split(/\n{2,}|\n(?=## )/)) {
      const h = /^## ((?:Page|Slide) \d+)/.exec(para)
      if (h) { push(); heading = h[1] }
      if (buf.length + para.length > size) push()
      buf += (buf ? '\n' : '') + para.slice(0, size * 2)
    }
    push()
  }
  return out
}

const STOP = new Set('the a an and or of to in on for with is are be by as at from this that these those it its into we you they their our your can will then than which what when how why where also each per not but if so do does use using used'.split(' '))
const words = (s: string) => s.toLowerCase().match(/[a-z0-9\u00c0-\u024f]{3,}/g)?.filter(w => !STOP.has(w)) ?? []

function label(c: Chunk) { return `[${c.file}${c.heading ? `, ${c.heading}` : ''}]` }

/**
 * An even sample across all materials for planning the outline: the start of every
 * part of the material, up to `budget` characters, in document order.
 */
export function outlineDigest(sources: MaterialSource[], budget = 36_000): string {
  const chunks = chunk(sources, 1200)
  if (chunks.length === 0) return ''
  const total = chunks.reduce((a, c) => a + c.text.length, 0)
  if (total <= budget) return chunks.map(c => `${label(c)}\n${c.text}`).join('\n\n')
  // Take a slice of every chunk proportional to the budget, so late chapters are represented too.
  const share = Math.max(160, Math.floor(budget / chunks.length) - 40)
  return chunks.map(c => `${label(c)}\n${c.text.slice(0, share)}${c.text.length > share ? ' …' : ''}`).join('\n\n').slice(0, budget)
}

/**
 * The parts of the materials most relevant to one section (keyword overlap with its
 * title, goal and key points), returned in document order.
 */
export function sectionExcerpts(sources: MaterialSource[], query: string, budget = 14_000): string {
  const chunks = chunk(sources)
  if (chunks.length === 0) return ''
  const total = chunks.reduce((a, c) => a + c.text.length, 0)
  if (total <= budget) return chunks.map(c => `${label(c)}\n${c.text}`).join('\n\n')
  const q = words(query)
  const df = new Map<string, number>()
  const tokenized = chunks.map(c => { const w = new Set(words(c.text)); for (const t of w) df.set(t, (df.get(t) ?? 0) + 1); return w })
  const scored = chunks.map((c, i) => {
    let s = 0
    for (const t of q) if (tokenized[i].has(t)) s += Math.log(1 + chunks.length / (df.get(t) ?? 1))
    return { c, s }
  })
  const picked: Chunk[] = []
  let used = 0
  const ranked = scored.sort((a, b) => b.s - a.s)
  for (const { c, s } of ranked) {
    if (s <= 0 && picked.length > 0) break
    if (used + c.text.length > budget) continue
    picked.push(c); used += c.text.length
  }
  if (picked.length === 0) picked.push({ ...ranked[0].c, text: ranked[0].c.text.slice(0, budget) })
  return picked.sort((a, b) => a.order - b.order).map(c => `${label(c)}\n${c.text}`).join('\n\n')
}

/** Style notes derived from the materials; stored on lessons.style_notes. */
export interface StyleNotes {
  subject: string
  level: string
  notation: string[]
  diagramTypes: string[]
  terminology: string[]
  summary: string
}

const strList = (v: unknown, n: number, len = 160) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim().slice(0, len)).slice(0, n) : []

export function cleanStyleNotes(raw: unknown): StyleNotes | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const s = (v: unknown, len: number) => (typeof v === 'string' ? v.trim().slice(0, len) : '')
  const notes: StyleNotes = {
    subject: s(o.subject, 120),
    level: s(o.level, 120),
    notation: strList(o.notation, 12),
    diagramTypes: strList(o.diagramTypes ?? o.diagram_types, 10),
    terminology: strList(o.terminology, 16, 80),
    summary: s(o.summary, 600),
  }
  return notes.subject || notes.notation.length || notes.summary ? notes : null
}

/** Style notes as prompt lines (drafting and Manim). */
export function styleNotesPrompt(n: StyleNotes | null | undefined): string {
  if (!n) return ''
  return [
    'Follow the class materials\' conventions:',
    n.subject ? `- Subject and scope: ${n.subject}${n.level ? ` (${n.level})` : ''}.` : '',
    n.notation.length ? `- Notation used in the materials (use exactly this): ${n.notation.join('; ')}.` : '',
    n.terminology.length ? `- Terms the materials use: ${n.terminology.join(', ')}.` : '',
    n.diagramTypes.length ? `- Diagram types the materials use: ${n.diagramTypes.join('; ')}.` : '',
  ].filter(Boolean).join('\n')
}

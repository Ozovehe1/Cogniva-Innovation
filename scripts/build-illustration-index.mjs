#!/usr/bin/env node
/**
 * Builds src/lib/illustrations/library.json: a keyword index of free, openly licensed science illustrations.
 *   node scripts/build-illustration-index.mjs [cacheDir]
 *
 * Sources (all reuse-with-attribution licences; each entry keeps its own licence, author and source page):
 *   bio      Bioicons (bioicons.com), read from the project's own metadata file on GitHub (one request)
 *            and served through the jsDelivr CDN. CC0 / CC BY 3.0-4.0 / CC BY-SA / MIT / BSD per icon.
 *   servier  Servier Medical Art (smart.servier.com), from its public Yoast image sitemaps (4 requests).
 *            CC BY 4.0, PNG only: vectorised with VTracer when first used.
 *   commons  Wikimedia Commons SVGs found by the Commons API for a list of school topics
 *            (one request per topic, 1.2 s apart). Only CC0 / public domain / CC BY / CC BY-SA files are kept.
 *
 * Every response is cached in cacheDir, so a re-run only fetches what is missing. Nothing here runs at request
 * time; the app only reads the JSON this writes.
 */
import fs from 'node:fs'
import path from 'node:path'

const CACHE = process.argv[2] || '/tmp/illus-cache'
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src/lib/illustrations/library.json')
const UA = 'GeniusMapIllustrationIndexer/1.0 (education app; contact abdulcosman01@gmail.com)'
fs.mkdirSync(CACHE, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
let last = 0
async function get(url, file, { json = false, gapMs = 1200 } = {}) {
  const f = path.join(CACHE, file)
  if (fs.existsSync(f)) { const t = fs.readFileSync(f, 'utf8'); return json ? JSON.parse(t) : t }
  const wait = last + gapMs - Date.now()
  if (wait > 0) await sleep(wait)
  last = Date.now()
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } })
    if (r.status === 429 || r.status >= 500) { await sleep(5000 * (i + 1)); continue }
    if (!r.ok) throw new Error(`${r.status} ${url}`)
    const t = await r.text()
    fs.writeFileSync(f, t)
    return json ? JSON.parse(t) : t
  }
  throw new Error(`gave up on ${url}`)
}

const words = s => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.,()/]+/g, ' ').replace(/\s+/g, ' ').trim()
const LIC = {
  'cc-0': ['CC0', 'https://creativecommons.org/publicdomain/zero/1.0/'],
  'cc-by-3.0': ['CC BY 3.0', 'https://creativecommons.org/licenses/by/3.0/'],
  'cc-by-4.0': ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
  'cc-by-sa-3.0': ['CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0/'],
  'cc-by-sa-4.0': ['CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'],
  mit: ['MIT', 'https://opensource.org/license/mit'],
  bsd: ['BSD', 'https://opensource.org/license/bsd-3-clause'],
}

/* ───────────── Bioicons ───────────── */
async function bioicons() {
  const icons = await get('https://raw.githubusercontent.com/duerrsimon/bioicons/main/static/icons/icons.json', 'bio_icons.json', { json: true })
  const out = []
  for (const i of icons) {
    const lic = LIC[i.license]
    if (!lic) continue
    // Logos of software companies are not teaching material.
    if (/machine_learning|logos?$/i.test(i.category)) continue
    const rel = `static/icons/${i.license}/${i.category}/${i.author}/${i.name}.svg`
    out.push({
      id: `bio:${i.category}/${i.name}`.slice(0, 120), src: 'bio', t: words(i.name), k: words(i.category).toLowerCase(),
      lic: lic[0], licUrl: lic[1], by: i.author.replace(/_/g, ' '),
      file: `https://cdn.jsdelivr.net/gh/duerrsimon/bioicons@main/${rel.split('/').map(encodeURIComponent).join('/')}`,
      page: `https://bioicons.com/?query=${encodeURIComponent(i.name)}`, fmt: 'svg',
    })
  }
  return out
}

/* ───────────── Servier Medical Art ───────────── */
async function servier() {
  const out = []
  const seen = new Set()
  for (const n of ['', '2', '3', '4']) {
    const xml = await get(`https://smart.servier.com/smart_image-sitemap${n}.xml`, `servier_sitemap${n}.xml`, { gapMs: 2000 })
    for (const [, u] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const page = u.match(/<loc>([^<]+)<\/loc>/)?.[1]
      const img = u.match(/<image:loc>([^<]+)<\/image:loc>/)?.[1]
      if (!page || !img || !/\/smart_image\//.test(page) || !/\.png$/i.test(img)) continue
      const slug = page.replace(/\/$/, '').split('/').pop()
      if (seen.has(slug)) continue
      seen.add(slug)
      const title = words(decodeURIComponent(slug).replace(/-(\d+|ov|[a-z])$/i, '').replace(/-(\d+|ov)$/i, ''))
      const fileWords = words(decodeURIComponent(img.split('/').pop()).replace(/\.png$/i, '')).replace(/\b\d+\b/g, '').toLowerCase()
      out.push({ id: `servier:${slug}`, src: 'servier', t: title, k: fileWords, lic: 'CC BY 4.0', licUrl: 'https://creativecommons.org/licenses/by/4.0/', by: 'Servier Medical Art', file: img, page, fmt: 'png' })
    }
  }
  return out
}

/* ───────────── Wikimedia Commons (school topics) ───────────── */
const TOPICS = `animal cell; plant cell; cell membrane; mitochondrion; chloroplast; nucleus cell; bacteria structure; virus structure; DNA; DNA double helix; RNA; chromosome; mitosis; meiosis; protein synthesis; photosynthesis; cellular respiration; enzyme; osmosis; diffusion;
human heart; heart anatomy; blood circulation; blood vessels; lungs; respiratory system; digestive system; stomach; liver; kidney; nephron; urinary system; nervous system; neuron; brain anatomy; eye anatomy; ear anatomy; skin layers; skeleton; human skeleton; skull; muscle; joints; teeth; tongue; endocrine system; reproductive system female; reproductive system male; menstrual cycle; immune system; antibody; blood cells;
flower parts; leaf structure; root structure; stem cross section; seed germination; pollination; plant transpiration; xylem phloem; food chain; food web; ecosystem; carbon cycle; nitrogen cycle; water cycle; life cycle frog; life cycle butterfly; insect anatomy; fish anatomy; bird anatomy; evolution; natural selection; classification kingdoms; punnett square; genetics inheritance;
atom; Bohr model; atomic structure; electron shells; periodic table; covalent bond; ionic bond; water molecule; states of matter; particle model; chemical reaction; distillation apparatus; filtration; chromatography; titration; electrolysis; pH scale; laboratory equipment; Bunsen burner; crystal lattice; methane molecule; carbon dioxide molecule; glucose molecule;
electric circuit; series circuit; parallel circuit; circuit symbols; resistor; battery cell; light bulb; switch circuit; electric motor; generator; transformer; magnet field lines; electromagnet; Ohm's law; lever; lever classes; pulley; inclined plane; wheel and axle; simple machines; gear; forces diagram; free body diagram; friction; gravity; Newton's laws; pendulum; projectile motion; wave; transverse wave; longitudinal wave; sound wave; electromagnetic spectrum; light refraction; reflection mirror; lens convex; prism dispersion; human eye optics; heat transfer; convection; conduction; radiation; thermometer; energy transformation; hydraulic press; nuclear fission; radioactive decay;
solar system; planets; sun structure; moon phases; lunar eclipse; solar eclipse; earth layers; earth structure; plate tectonics; volcano; earthquake; rock cycle; seasons earth; earth orbit; atmosphere layers; greenhouse effect; galaxy; star life cycle; constellation; tides; weather fronts; clouds types; river; soil layers; fossil;
triangle; circle parts; pythagorean theorem; coordinate plane; number line; fractions; geometric shapes; angles; prism geometry; cylinder; cone; sphere; pyramid; computer; logic gates; microscope; telescope; thermometer; magnifying glass`.split(';').map(s => s.trim()).filter(Boolean)

const OK_LIC = /^(cc0|public domain|pd\b|pd-|cc[- ]by(-sa)?[- ]?\d|cc[- ]by(-sa)?$)/i
const strip = s => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

async function commons() {
  const out = []
  const seen = new Set()
  for (const topic of TOPICS) {
    const q = `${topic} filemime:image/svg+xml`
    const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=15&gsrsearch=${encodeURIComponent(q)}&prop=imageinfo&iiprop=url|size|extmetadata&iiextmetadatafilter=LicenseShortName|LicenseUrl|Artist|ImageDescription|ObjectName|Categories`
    let j
    try { j = await get(url, `commons_${topic.replace(/\W+/g, '_')}.json`, { json: true }) } catch (e) { console.warn(String(e)); continue }
    const pages = Object.values(j?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    for (const p of pages) {
      const ii = p.imageinfo?.[0]
      if (!ii || seen.has(p.title)) continue
      const m = ii.extmetadata ?? {}
      const lic = strip(m.LicenseShortName?.value)
      if (!OK_LIC.test(lic) || /nc|nd/i.test(lic.replace(/^cc0/i, ''))) continue
      if (ii.size > 1_500_000) continue
      seen.add(p.title)
      const name = p.title.replace(/^File:/, '').replace(/\.svg$/i, '')
      out.push({
        id: `commons:${name}`.slice(0, 160), src: 'commons', t: words(name), k: `${topic.toLowerCase()} ${strip(m.Categories?.value).replace(/\|/g, ' ').toLowerCase()}`.slice(0, 300),
        d: strip(m.ImageDescription?.value).slice(0, 200),
        lic: /^pd|public domain/i.test(lic) ? 'Public domain' : lic, licUrl: m.LicenseUrl?.value || null,
        by: strip(m.Artist?.value).slice(0, 80) || 'Wikimedia Commons contributor', file: ii.url, page: ii.descriptionurl, fmt: 'svg', bytes: ii.size,
      })
    }
    process.stdout.write('.')
  }
  console.log()
  return out
}

const [bio, srv, com] = [await bioicons(), await servier(), await commons()]
const all = [...bio, ...srv, ...com]
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify({ built: new Date().toISOString().slice(0, 10), count: all.length, items: all }))
console.log(`bioicons ${bio.length}, servier ${srv.length}, commons ${com.length} -> ${OUT} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`)

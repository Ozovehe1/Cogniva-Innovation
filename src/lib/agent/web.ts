/**
 * Internet access for the agent, at $0 and child-safe:
 *  - search: Wikipedia (REST search + page summaries) and arXiv (Atom API), keyless. When the learner needs
 *    something current or the encyclopedia has nothing, Groq's built-in browser search on gpt-oss (Exa) is
 *    used, rate-budgeted: one call costs ~30K tokens of the model's 200K/day free allowance.
 *  - fetch: only https pages on an allowlist (Wikimedia projects, arXiv) or a URL a search in this run returned;
 *    no IP literals, no private hosts, 1.5 MB / 8 s cap, text only.
 * Every query, result title/snippet and page passes the blocklist (guard.ts); page text is returned wrapped as
 * data with instruction-like lines removed. Every result carries its URL so answers can cite it. Server only.
 */
import { asData, blockedUrl, injectionHeuristic, unsafeQuery, unsafeText } from './guard'
import { chat, groqEnabled } from './llm'

const UA = 'Ideanimo/1.0 (https://ideanimo.vercel.app; education)'
export interface WebResult { title: string; url: string; snippet: string; source: 'wikipedia' | 'arxiv' | 'web' }

const stripHtml = (s: string) => s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()

async function getJson(url: string, ms = 8000) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(ms) })
  if (!r.ok) throw new Error(`${new URL(url).hostname} ${r.status}`)
  return r.json()
}

export async function wikipediaSearch(q: string, limit = 4): Promise<WebResult[]> {
  const j = await getJson(`https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(q)}&limit=${limit}`) as { pages?: { key: string; title: string; excerpt?: string; description?: string }[] }
  const pages = (j.pages ?? []).slice(0, limit)
  const out = await Promise.all(pages.map(async p => {
    let snippet = stripHtml(p.excerpt ?? '')
    try {
      const s = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(p.key)}`, 6000) as { extract?: string; type?: string }
      if (s.extract && s.type !== 'disambiguation') snippet = s.extract
    } catch { /* keep the excerpt */ }
    return { title: p.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key)}`, snippet: snippet.slice(0, 900), source: 'wikipedia' as const }
  }))
  return out
}

export async function arxivSearch(q: string, limit = 3): Promise<WebResult[]> {
  const r = await fetch(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&max_results=${limit}&sortBy=relevance`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) })
  if (!r.ok) throw new Error(`arxiv ${r.status}`)
  const xml = await r.text()
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, limit).map(m => {
    const e = m[1]
    const pick = (t: string) => stripHtml((new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(e)?.[1] ?? ''))
    const id = pick('id')
    return { title: pick('title').slice(0, 200), url: id.replace(/^http:/, 'https:'), snippet: pick('summary').slice(0, 700), source: 'arxiv' as const }
  })
}

/** Groq browser search (gpt-oss, Exa). Returns the sources it read; the answer text itself is not used. */
async function groqBrowserSearch(q: string): Promise<WebResult[]> {
  if (!groqEnabled()) return []
  const r = await chat({ purpose: 'light', builtin: 'browser_search', maxTokens: 500, messages: [{ role: 'user', content: `Search the web for: ${q}\nAnswer in two sentences.` }] })
  const results = (r.executed ?? []).flatMap(e => e.search_results?.results ?? [])
  return results.filter(x => x.url && x.title).slice(0, 5).map(x => ({ title: String(x.title).slice(0, 200), url: String(x.url), snippet: String(x.content ?? '').slice(0, 700), source: 'web' as const }))
}

export interface SearchOutcome { blocked?: string; results: WebResult[]; used: string[] }

export async function webSearch(q: string, opts: { academic?: boolean; current?: boolean } = {}): Promise<SearchOutcome> {
  const query = q.replace(/\s+/g, ' ').trim().slice(0, 200)
  const bad = unsafeQuery(query)
  if (bad) return { blocked: `This search isn't available on Ideanimo (blocked term: "${bad}").`, results: [], used: [] }
  const used: string[] = []
  const jobs: Promise<WebResult[]>[] = []
  if (!opts.current) { jobs.push(wikipediaSearch(query).catch(() => [])); used.push('wikipedia') }
  if (opts.academic) { jobs.push(arxivSearch(query).catch(() => [])); used.push('arxiv') }
  let results = (await Promise.all(jobs)).flat()
  if (opts.current || results.length === 0) {
    const web = await groqBrowserSearch(query).catch(() => [])
    if (web.length) used.push('groq-browser-search')
    results = [...results, ...web]
  }
  // Child-safe filter on every result, then injection-defang the snippets.
  results = results.filter(r => !blockedUrl(r.url) && !unsafeText(`${r.title} ${r.snippet}`))
    .map(r => ({ ...r, snippet: injectionHeuristic(r.snippet).length ? '[snippet removed: instruction-like text]' : r.snippet }))
  return { results: results.slice(0, 7), used }
}

const ALLOW_HOSTS = [/(^|\.)wikipedia\.org$/, /(^|\.)wikimedia\.org$/, /(^|\.)wikibooks\.org$/, /(^|\.)wikiversity\.org$/, /(^|\.)arxiv\.org$/]

export async function fetchPage(url: string, allowedFromSearch: Set<string>): Promise<{ ok: boolean; title?: string; text?: string; url: string; error?: string }> {
  let u: URL
  try { u = new URL(url) } catch { return { ok: false, url, error: 'not a valid URL' } }
  if (u.protocol !== 'https:') return { ok: false, url, error: 'only https pages can be opened' }
  const host = u.hostname.toLowerCase()
  if (/^\d+\.\d+\.\d+\.\d+$|^\[|localhost|\.local$|\.internal$/.test(host)) return { ok: false, url, error: 'that address is not allowed' }
  if (blockedUrl(url)) return { ok: false, url, error: 'that site is blocked on Ideanimo' }
  if (!ALLOW_HOSTS.some(r => r.test(host)) && !allowedFromSearch.has(u.toString()) && !allowedFromSearch.has(url)) return { ok: false, url, error: 'only pages from Wikipedia, arXiv or this chat\'s search results can be opened' }
  // Wikipedia: the clean REST summary + plain-text sections instead of HTML.
  try {
    const res = await fetch(u.toString(), { headers: { 'User-Agent': UA, Accept: 'text/html,text/plain' }, redirect: 'follow', signal: AbortSignal.timeout(8000) })
    if (!res.ok) return { ok: false, url, error: `the page answered ${res.status}` }
    if (blockedUrl(res.url)) return { ok: false, url, error: 'that page redirects to a blocked site' }
    const type = res.headers.get('content-type') ?? ''
    if (!/text\/html|text\/plain|xml/.test(type)) return { ok: false, url, error: `unsupported content (${type.split(';')[0]})` }
    const reader = res.body!.getReader()
    let size = 0
    const chunks: Uint8Array[] = []
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; chunks.push(value); if (size > 1_500_000) { await reader.cancel(); break } }
    const html = new TextDecoder().decode(Buffer.concat(chunks))
    const title = stripHtml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').slice(0, 200)
    const main = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? /<body[\s\S]*?<\/body>/i.exec(html)?.[0] ?? html
    const text = stripHtml(main.replace(/<(nav|footer|header|aside|table)[\s\S]*?<\/\1>/gi, ' ').replace(/<sup[\s\S]*?<\/sup>/gi, ''))
    if (unsafeText(`${title} ${text.slice(0, 4000)}`)) return { ok: false, url, error: 'that page is not suitable for Ideanimo' }
    return { ok: true, url: res.url, title, text: asData(res.url, text.slice(0, 6000), 6000) }
  } catch (err) {
    return { ok: false, url, error: err instanceof Error ? err.message.slice(0, 160) : 'could not open the page' }
  }
}

/** Eval cases for the free illustration library (wired into the static and visual groups of src/lib/agent/eval.ts). */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CaseResult } from '../agent/eval'
import { searchLibrary } from './search'
import { cleanLibrarySvg, prepareIllustration } from './prepare'
import { findIllustration } from './find'

export const SCHOOL_TOPICS = ['cell', 'heart', 'photosynthesis', 'circuit', 'atom', 'lungs', 'plant cell', 'DNA', 'lever', 'solar system']

/** No network: the index answers the ten school topics, and the cleaner removes anything active or external. */
export async function illustrationStaticCases(): Promise<CaseResult[]> {
  const out: CaseResult[] = []
  const t0 = Date.now()
  const res = await Promise.all(SCHOOL_TOPICS.map(async t => ({ t, h: (await searchLibrary(t, { want: 'diagram', limit: 1 }))[0] })))
  const hit = res.filter(r => r.h && r.h.score >= 6)
  out.push({ id: 'illus-index-hit-rate', group: 'static', pass: hit.length >= 9, detail: `${hit.length}/${res.length}: ${res.map(r => `${r.t}→${r.h ? r.h.item.t : 'none'}`).join('; ').slice(0, 300)}`, ms: Date.now() - t0 })
  out.push({ id: 'illus-index-licences', group: 'static', pass: hit.every(r => /^(CC0|Public domain|CC BY(-SA)? [\d.]+( \w+)?|MIT|BSD)$/.test(r.h!.item.lic) && !!r.h!.item.page), detail: [...new Set(hit.map(r => r.h!.item.lic))].join(', ') })
  const dirty = '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><style>@import url(https://x.y/a.css); .a{fill:url(https://x.y/p)}</style><a href="javascript:alert(1)"><circle cx="5" cy="5" r="4"/></a><image href="file:///etc/passwd"/><use xlink:href="https://evil.example/x.svg#a"/><foreignObject><div>x</div></foreignObject><sodipodi:namedview/><text x="1" y="9">ok</text></svg>'
  const c = cleanLibrarySvg(dirty).svg ?? ''
  out.push({ id: 'illus-clean-svg', group: 'static', pass: /<circle/.test(c) && />ok</.test(c) && !/script|onload|javascript|foreignObject|https?:|file:|@import|sodipodi/i.test(c), detail: c.slice(0, 160) })
  return out
}

/** Live: one Commons SVG and one vectorised Servier PNG end to end (cached after the first run). */
export async function illustrationVisualCases(admin: SupabaseClient): Promise<CaseResult[]> {
  const out: CaseResult[] = []
  for (const [id, topic] of [['illus-find-heart', 'human heart'], ['illus-find-plant-cell', 'plant cell']] as const) {
    const t0 = Date.now()
    try {
      const f = await findIllustration({ topic }, admin)
      out.push({ id, group: 'visual', pass: !!f && /^<svg[\s>]/.test(f.svg) && f.svg.includes(f.credit.license) && !/<script|on\w+=/i.test(f.svg), detail: f ? `${f.item.t} (${f.item.src}, ${f.item.lic}) ${Math.round(f.svg.length / 1024)} KB ${f.cached ? 'cached' : 'fetched'}` : 'nothing found', ms: Date.now() - t0 })
    } catch (err) { out.push({ id, group: 'visual', pass: false, detail: String(err).slice(0, 200), ms: Date.now() - t0 }) }
  }
  const t1 = Date.now()
  try {
    const hit = (await searchLibrary('heart', { limit: 30 })).find(h => h.item.src === 'servier')
    const p = hit ? await prepareIllustration(hit.item, admin) : null
    out.push({ id: 'illus-vectorise-servier', group: 'visual', pass: !!p && p.vectorised && /<path/.test(p.svg) && /Servier/.test(p.svg), detail: p ? `${hit!.item.t}: ${Math.round(p.svg.length / 1024)} KB, ${p.ms} ms ${p.cached ? 'cached' : 'traced'}` : 'no Servier heart', ms: Date.now() - t1 })
  } catch (err) { out.push({ id: 'illus-vectorise-servier', group: 'visual', pass: false, detail: String(err).slice(0, 200), ms: Date.now() - t1 }) }
  return out
}
